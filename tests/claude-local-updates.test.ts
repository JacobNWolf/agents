import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { createDefaultAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'

const cli = vi.hoisted(() => ({ servers: new Map<string, string[]>(), adds: 0 }))
vi.mock('../src/core/shell.js', () => ({
  commandExists: (command: string) => command === 'claude',
  runCommand: (_command: string, args: string[]) => {
    const result = { ok: true, code: 0, stdout: '', stderr: '', timedOut: false }
    if (args[1] === 'list') result.stdout = [...cli.servers.keys()].map(name => `${name}: configured`).join('\n')
    if (args[1] === 'remove') cli.servers.delete(args[4])
    if (args[1] === 'add') {
      const name = args.includes('-t') ? args[6] : args[4]
      cli.adds += 1
      if (cli.servers.has(name)) return { ...result, ok: false, code: 1, stderr: 'already exists in local config' }
      cli.servers.set(name, args)
    }
    return result
  }
}))

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  cli.servers.clear()
  cli.adds = 0
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('updates same-named definitions and local credentials, then settles without storing secrets in state', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-update-'))
  roots.push(projectRoot)
  vi.stubEnv('AGENTS_HOME_DIR', path.join(projectRoot, 'home'))
  const config = createDefaultAgentsConfig({ enabledIntegrations: ['claude'], mcpServers: {
    docs: { transport: 'http', url: 'https://old.example/mcp', headers: { Authorization: '${TOKEN}' } }
  } })
  config.integrations.options.claudeScope = 'local'
  await saveAgentsConfig(projectRoot, config)
  await writeFile(path.join(projectRoot, '.agents/local.json'), JSON.stringify({ mcpServers: {
    docs: { headers: { Authorization: 'Bearer fixture-old' } }
  } }))
  await performSync({ projectRoot, check: false, verbose: false })
  config.mcp.servers.docs.url = 'https://new.example/mcp'
  await saveAgentsConfig(projectRoot, config)
  await writeFile(path.join(projectRoot, '.agents/local.json'), JSON.stringify({ mcpServers: {
    docs: { headers: { Authorization: 'Bearer fixture-new' } }
  } }))
  expect((await performSync({ projectRoot, check: true, verbose: false })).changed).toContain('claude-local-scope')
  await performSync({ projectRoot, check: false, verbose: false })
  expect(cli.servers.get('agents__docs')).toContain('https://new.example/mcp')
  expect(cli.servers.get('agents__docs')).toContain('Authorization: Bearer fixture-new')
  const adds = cli.adds
  expect((await performSync({ projectRoot, check: true, verbose: false })).changed).toEqual([])
  await performSync({ projectRoot, check: false, verbose: false })
  expect(cli.adds).toBe(adds)
  expect(await readFile(path.join(projectRoot, '.agents/generated/claude.state.json'), 'utf8')).not.toContain('fixture-new')
})
