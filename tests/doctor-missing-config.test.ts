import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { createDefaultAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'
import { getProjectPaths } from '../src/core/paths.js'
import { listManagedConfigs } from '../src/integrations/registry.js'
import { runDoctor } from '../src/commands/doctor.js'
import { pathExists } from '../src/core/fs.js'
import * as ui from '../src/core/ui.js'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  process.exitCode = undefined
  ui.resetContext()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it.each(['copilot_vscode', 'cursor', 'zed', 'goose', 'grok'] as const)('reports and repairs missing enabled %s config', async id => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-doctor-missing-'))
  roots.push(projectRoot)
  const home = path.join(projectRoot, 'home')
  vi.stubEnv('AGENTS_HOME_DIR', home)
  vi.stubEnv('AGENTS_GOOSE_CONFIG_PATH', path.join(home, '.config/goose/config.yaml'))
  vi.stubEnv('PATH', '')
  await saveAgentsConfig(projectRoot, createDefaultAgentsConfig({ enabledIntegrations: [id], mcpServers: {
    docs: { transport: 'http', url: 'https://example.com/mcp', targets: [id] }
  } }))
  await writeFile(path.join(projectRoot, 'AGENTS.md'), '# Fixture\n')
  await performSync({ projectRoot, check: false, verbose: false })
  const target = listManagedConfigs(getProjectPaths(projectRoot), [id])[0].filePath
  await unlink(target)
  let output = ''
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output += String(chunk); return true })
  await runDoctor({ projectRoot, fix: false })
  expect(output).toContain('Missing')
  expect(process.exitCode).toBe(1)
  process.exitCode = undefined
  await runDoctor({ projectRoot, fix: true })
  expect(await pathExists(target)).toBe(true)
  expect(process.exitCode).toBeUndefined()
})

it('allows absent configs when the active profile selects no servers', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-doctor-empty-'))
  roots.push(projectRoot)
  vi.stubEnv('AGENTS_HOME_DIR', path.join(projectRoot, 'home'))
  vi.stubEnv('PATH', '')
  const config = createDefaultAgentsConfig({ enabledIntegrations: ['cursor'], mcpServers: {
    docs: { transport: 'http', url: 'https://example.com/mcp' }
  } })
  config.profiles = { empty: { servers: [] } }
  config.activeProfile = 'empty'
  await saveAgentsConfig(projectRoot, config)
  await writeFile(path.join(projectRoot, 'AGENTS.md'), '# Fixture\n')
  await performSync({ projectRoot, check: false, verbose: false })
  await runDoctor({ projectRoot, fix: false })
  expect(process.exitCode).toBeUndefined()
})
