import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { createDefaultAgentsConfig, loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { runMcpAdd } from '../src/commands/mcp-add.js'

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('infers secret env and headers while retaining public values and placeholders', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-add-secrets-'))
  roots.push(projectRoot)
  vi.stubEnv('AGENTS_HOME_DIR', path.join(projectRoot, 'home'))
  await saveAgentsConfig(projectRoot, createDefaultAgentsConfig({ mcpServers: {} }))
  await runMcpAdd({
    projectRoot, name: 'env', command: 'node',
    env: ['API_TOKEN=fixture-secret', 'MODE=test', 'OTHER_TOKEN=${OTHER_TOKEN}'],
    disabled: false, replace: false, noSync: true, nonInteractive: true
  })
  await runMcpAdd({
    projectRoot, name: 'docs', url: 'https://example.com/mcp',
    headers: ['Authorization=Bearer fixture-token', 'Accept=application/json'],
    disabled: false, replace: false, noSync: true, nonInteractive: true
  })
  const config = await loadAgentsConfig(projectRoot)
  expect(config.mcp.servers.env.env).toEqual({ API_TOKEN: '${API_TOKEN}', MODE: 'test', OTHER_TOKEN: '${OTHER_TOKEN}' })
  expect(config.mcp.servers.docs.headers?.Authorization).toMatch(/^\$\{[A-Z0-9_]+\}$/)
  expect(config.mcp.servers.docs.headers?.Accept).toBe('application/json')
  const local = JSON.parse(await readFile(path.join(projectRoot, '.agents/local.json'), 'utf8'))
  expect(local.mcpServers.env.env).toEqual({ API_TOKEN: 'fixture-secret' })
  expect(local.mcpServers.docs.headers).toEqual({ Authorization: 'Bearer fixture-token' })
})
