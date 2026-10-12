import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { createDefaultAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { runMcpTest } from '../src/commands/mcp-test.js'
import * as ui from '../src/core/ui.js'

const cli = vi.hoisted(() => ({ calls: [] as string[], cursorOutput: '' }))
vi.mock('../src/core/shell.js', () => ({
  commandExists: () => true,
  runCommand: (command: string) => {
    cli.calls.push(command)
    return { ok: true, code: 0, stdout: command === 'cursor-agent' ? cli.cursorOutput : '', stderr: '', timedOut: false }
  }
}))
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  cli.calls.length = 0
  cli.cursorOutput = ''
  process.exitCode = undefined
  ui.resetContext()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('only checks enabled integrations and servers selected by the active profile', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-runtime-profile-'))
  roots.push(projectRoot)
  vi.stubEnv('AGENTS_HOME_DIR', path.join(projectRoot, 'home'))
  const config = createDefaultAgentsConfig({ enabledIntegrations: ['cursor'], mcpServers: {
    alpha: { transport: 'http', url: 'https://example.com/mcp' },
    beta: { transport: 'http', url: 'https://example.com/mcp' }
  } })
  config.profiles = { ci: { servers: ['alpha'] } }
  config.activeProfile = 'ci'
  await saveAgentsConfig(projectRoot, config)
  cli.cursorOutput = 'alpha: ready'
  let output = ''
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output += String(chunk); return true })
  await runMcpTest({ projectRoot, json: true, runtime: true })
  const payload = JSON.parse(output)
  expect(payload.errors).toBe(0)
  expect(cli.calls).toEqual(['cursor-agent'])
  expect(payload.runtime.availableIntegrations).toEqual(['cursor'])
  expect(payload.results.find((entry: { name: string }) => entry.name === 'alpha').runtime.cursor.status).toBe('ok')
  expect(payload.results.find((entry: { name: string }) => entry.name === 'beta').runtime).toEqual({})
})

it('does not probe installed CLI integrations in a Codex-only project', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-runtime-codex-'))
  roots.push(projectRoot)
  await saveAgentsConfig(projectRoot, createDefaultAgentsConfig({ enabledIntegrations: ['codex'], mcpServers: {
    docs: { transport: 'http', url: 'https://example.com/mcp' }
  } }))
  let output = ''
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output += String(chunk); return true })
  await runMcpTest({ projectRoot, json: true, runtime: true })
  expect(JSON.parse(output).errors).toBe(0)
  expect(cli.calls).toEqual([])
})

it.each([false, true])('skips disabled runtime servers (local override=%s)', async local => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-runtime-disabled-'))
  roots.push(projectRoot)
  vi.stubEnv('AGENTS_HOME_DIR', path.join(projectRoot, 'home'))
  await saveAgentsConfig(projectRoot, createDefaultAgentsConfig({ enabledIntegrations: ['cursor'], mcpServers: {
    docs: { transport: 'http', url: 'https://example.com/mcp', targets: ['cursor'], enabled: local }
  } }))
  if (local) await writeFile(path.join(projectRoot, '.agents/local.json'), JSON.stringify({ mcpServers: { docs: { enabled: false } } }))
  let output = ''
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output += String(chunk); return true })
  await runMcpTest({ projectRoot, json: true, runtime: true })
  const payload = JSON.parse(output)
  expect(payload.errors).toBe(0)
  expect(payload.results[0].messages).toEqual(['disabled'])
  expect(payload.results[0].runtime).toEqual({})
  expect(cli.calls).toEqual([])
})
