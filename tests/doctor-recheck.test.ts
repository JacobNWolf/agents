import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { createDefaultAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'
import { getProjectPaths } from '../src/core/paths.js'
import { runDoctor } from '../src/commands/doctor.js'
import * as ui from '../src/core/ui.js'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  process.exitCode = undefined
  ui.resetContext()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it.each([false, true])('rechecks repaired syntax without discarding other errors (invalid source=%s)', async invalid => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-doctor-recheck-'))
  roots.push(projectRoot)
  vi.stubEnv('AGENTS_HOME_DIR', path.join(projectRoot, 'home'))
  vi.stubEnv('AGENTS_CODEX_CONFIG_PATH', path.join(projectRoot, 'home/.codex/config.toml'))
  vi.stubEnv('PATH', '')
  const config = createDefaultAgentsConfig({ mcpServers: invalid ? {
    bad: { transport: 'stdio', command: 'node', env: { 'BAD KEY': 'fixture' }, targets: ['cursor'] }
  } : {} })
  await saveAgentsConfig(projectRoot, config)
  await writeFile(path.join(projectRoot, 'AGENTS.md'), '# Fixture instructions\n')
  const paths = getProjectPaths(projectRoot)
  await performSync({ projectRoot, check: false, verbose: false })
  await writeFile(paths.generatedCodex, '[invalid\n')
  let output = ''
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output += String(chunk); return true })
  await runDoctor({ projectRoot, fix: true })
  expect(await readFile(paths.generatedCodex, 'utf8')).not.toContain('[invalid')
  expect(output).not.toContain('Invalid TOML')
  expect(process.exitCode).toBe(invalid ? 1 : undefined)
  if (invalid) expect(output).toContain('BAD KEY')
})
