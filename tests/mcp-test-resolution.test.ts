import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { createDefaultAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { runMcpTest } from '../src/commands/mcp-test.js'
import * as ui from '../src/core/ui.js'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  process.exitCode = undefined
  ui.resetContext()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('validates resolved env, fallback and project-root placeholders', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-test-resolution-'))
  roots.push(projectRoot)
  vi.stubEnv('AGENTS_HOME_DIR', path.join(projectRoot, 'home'))
  vi.stubEnv('REVIEW_TEST_URL', 'https://example.com/mcp')
  vi.stubEnv('REVIEW_TEST_NODE', process.execPath)
  vi.stubEnv('REVIEW_TEST_MISSING', undefined)
  await mkdir(path.join(projectRoot, 'bin'))
  await writeFile(path.join(projectRoot, 'bin/server'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  await saveAgentsConfig(projectRoot, createDefaultAgentsConfig({ mcpServers: {
    url: { transport: 'http', url: '${REVIEW_TEST_URL}' },
    node: { transport: 'stdio', command: '${REVIEW_TEST_NODE}' },
    fallback: { transport: 'http', url: '${REVIEW_TEST_MISSING:-https://example.com/mcp}' },
    project: { transport: 'stdio', command: '${PROJECT_ROOT}/bin/server' }
  } }))
  let output = ''
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output += String(chunk); return true })
  await runMcpTest({ projectRoot, json: true })
  expect(JSON.parse(output).errors).toBe(0)
  expect(process.exitCode).toBeUndefined()
})

it('reports invalid resolved input without exposing the substituted value', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-test-redaction-'))
  roots.push(projectRoot)
  vi.stubEnv('REVIEW_TEST_URL', 'fixture-secret-private')
  await saveAgentsConfig(projectRoot, createDefaultAgentsConfig({ mcpServers: { docs: { transport: 'http', url: '${REVIEW_TEST_URL}' } } }))
  let output = ''
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output += String(chunk); return true })
  await runMcpTest({ projectRoot, json: true })
  expect(JSON.parse(output).errors).toBe(1)
  expect(output).not.toContain('fixture-secret-private')
})
