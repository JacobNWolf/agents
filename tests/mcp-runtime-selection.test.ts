import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { createDefaultAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { runMcpTest } from '../src/commands/mcp-test.js'
import * as ui from '../src/core/ui.js'

const cli = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock('../src/core/shell.js', () => ({
  commandExists: () => true,
  runCommand: (command: string) => {
    cli.calls.push(command)
    return { ok: true, code: 0, stdout: '', stderr: '', timedOut: false }
  }
}))
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  cli.calls.length = 0
  process.exitCode = undefined
  ui.resetContext()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
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
