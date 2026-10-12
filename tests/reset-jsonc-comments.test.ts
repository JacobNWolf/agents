import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { parse } from 'jsonc-parser'
import { runReset } from '../src/commands/reset.js'
import { getProjectPaths } from '../src/core/paths.js'

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it.each(['zed', 'kilo'] as const)('preserves %s comments with no owned entries and after removing the last entry', async id => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-reset-jsonc-'))
  roots.push(projectRoot)
  vi.stubEnv('AGENTS_HOME_DIR', path.join(projectRoot, 'home'))
  const paths = getProjectPaths(projectRoot)
  const target = id === 'zed' ? paths.zedSettings : paths.kiloConfig
  const generated = id === 'zed' ? paths.generatedZed : paths.generatedKilo
  const key = id === 'zed' ? 'context_servers' : 'mcp'
  await mkdir(path.dirname(target), { recursive: true })
  const notes = '{\n // keep my theme notes\n // "theme": "One Dark"\n}\n'
  await writeFile(target, notes)
  await runReset({ projectRoot, localOnly: true, hard: false })
  expect(await readFile(target, 'utf8')).toBe(notes)
  await mkdir(paths.generatedDir, { recursive: true })
  await writeFile(generated, JSON.stringify({ [key]: { owned: { command: 'owned' } } }))
  await writeFile(target, `{\n // keep my theme notes\n "${key}": { "owned": { "command": "owned" } }\n}\n`)
  await runReset({ projectRoot, localOnly: true, hard: false })
  const cleaned = await readFile(target, 'utf8')
  expect(cleaned).toContain('// keep my theme notes')
  expect(parse(cleaned)).toEqual({ [key]: {} })
})
