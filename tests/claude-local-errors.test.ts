import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { createDefaultAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { getProjectPaths } from '../src/core/paths.js'
import { pathExists } from '../src/core/fs.js'
import { performSync } from '../src/core/sync.js'

const cli = vi.hoisted(() => ({ names: new Set<string>(), failAdd: false, failRemove: false }))
vi.mock('../src/core/shell.js', () => ({
  commandExists: (command: string) => command === 'claude',
  runCommand: (_command: string, args: string[]) => {
    const result = { ok: true, code: 0, stdout: '', stderr: '', timedOut: false }
    if (args[1] === 'list') result.stdout = [...cli.names].map(name => `${name}: configured`).join('\n')
    if ((args[1] === 'add' && cli.failAdd) || (args[1] === 'remove' && cli.failRemove)) {
      return { ...result, ok: false, code: 1, stderr: 'permission denied writing local config' }
    }
    if (args[1] === 'remove') cli.names.delete(args[4])
    if (args[1] === 'add') cli.names.add(args.includes('-t') ? args[6] : args[4])
    return result
  }
}))

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  cli.names.clear()
  cli.failAdd = false
  cli.failRemove = false
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-error-'))
  roots.push(projectRoot)
  vi.stubEnv('AGENTS_HOME_DIR', path.join(projectRoot, 'home'))
  const config = createDefaultAgentsConfig({ enabledIntegrations: ['claude', 'junie'], mcpServers: {
    docs: { transport: 'http', url: 'https://example.com/mcp', targets: ['claude'] },
    other: { transport: 'stdio', command: 'node', targets: ['junie'] }
  } })
  config.integrations.options.claudeScope = 'local'
  await saveAgentsConfig(projectRoot, config)
  return { projectRoot, config, paths: getProjectPaths(projectRoot) }
}

it('fails sync on Claude add errors after attempting the other integrations, then retries', async () => {
  const { projectRoot, paths } = await fixture()
  cli.failAdd = true
  await expect(performSync({ projectRoot, check: false, verbose: false })).rejects.toThrow(/permission denied/)
  expect(await pathExists(paths.junieMcp)).toBe(true)
  expect(await pathExists(paths.generatedSyncState)).toBe(false)
  cli.failAdd = false
  await performSync({ projectRoot, check: false, verbose: false })
  expect(cli.names.has('agents__docs')).toBe(true)
})

it.each([false, true])('retains ownership after failed removal (replacement=%s)', async replacement => {
  const { projectRoot, config, paths } = await fixture()
  await performSync({ projectRoot, check: false, verbose: false })
  const before = await readFile(paths.generatedSyncState, 'utf8')
  if (replacement) config.mcp.servers.docs.url = 'https://new.example/mcp'
  else config.integrations.enabled = []
  await saveAgentsConfig(projectRoot, config)
  cli.failRemove = true
  await expect(performSync({ projectRoot, check: false, verbose: false })).rejects.toThrow(/permission denied/)
  expect(JSON.parse(await readFile(paths.generatedClaudeState, 'utf8')).managedNames).toContain('agents__docs')
  expect(await readFile(paths.generatedSyncState, 'utf8')).toBe(before)
  cli.failRemove = false
  await performSync({ projectRoot, check: false, verbose: false })
  expect(cli.names.has('agents__docs')).toBe(replacement)
})
