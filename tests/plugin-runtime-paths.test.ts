import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { createDefaultAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { exportPlugin, importPlugin, PLUGIN_MANIFEST_SCHEMA, PLUGIN_MCP_SCHEMA, type PluginMcpServer } from '../src/core/agentPlugin.js'
import { loadResolvedRegistry } from '../src/core/mcp.js'
import { performSync } from '../src/core/sync.js'
import { pathExists } from '../src/core/fs.js'
import { probeServerTools } from '../src/core/mcpProbe.js'

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(server: PluginMcpServer) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agents-plugin-paths-'))
  roots.push(root)
  vi.stubEnv('AGENTS_HOME_DIR', path.join(root, 'home'))
  const pluginDir = path.join(root, 'plugin')
  const projectRoot = path.join(root, 'project')
  await mkdir(pluginDir)
  await saveAgentsConfig(projectRoot, createDefaultAgentsConfig({ enabledIntegrations: ['codex'], mcpServers: {} }))
  await writeFile(path.join(pluginDir, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_MANIFEST_SCHEMA, name: 'paths' }))
  await writeFile(path.join(pluginDir, 'mcp.json'), JSON.stringify({ $schema: PLUGIN_MCP_SCHEMA, mcpServers: { svc: server } }))
  return { root, pluginDir, projectRoot }
}

it('resolves relative cwd against the installed package and survives relocation', async () => {
  const { root, pluginDir, projectRoot } = await fixture({ type: 'stdio', command: 'node', args: ['server.cjs'], cwd: './work' })
  await mkdir(path.join(pluginDir, 'work'))
  await writeFile(path.join(pluginDir, 'work/server.cjs'), 'console.log("relative cwd works")')
  await importPlugin({ projectRoot, pluginDir })
  await rm(pluginDir, { recursive: true })
  const moved = path.join(root, 'moved')
  await rename(projectRoot, moved)
  const server = (await loadResolvedRegistry(moved)).serversByTarget.codex[0]
  const result = spawnSync(server.command!, server.args, { cwd: server.cwd, encoding: 'utf8' })
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('relative cwd works')
})

it.each([false, true])('re-exports imported runtimes without their private data (assets=%s)', async assets => {
  const { root, pluginDir, projectRoot } = await fixture({
    type: 'stdio', command: 'node',
    args: assets ? ['${PLUGIN_ROOT}/server.cjs'] : ['-e', 'console.log("ok")'],
    cwd: '${PLUGIN_DATA}'
  })
  await writeFile(path.join(pluginDir, 'server.cjs'), 'const fs = require("node:fs"); console.log(fs.readFileSync(process.env.PLUGIN_ROOT + "/asset.txt", "utf8")); fs.writeFileSync(process.env.PLUGIN_DATA + "/created.txt", "ok")')
  await writeFile(path.join(pluginDir, 'asset.txt'), 'ok')
  await importPlugin({ projectRoot, pluginDir })
  const original = (await loadResolvedRegistry(projectRoot)).serversByTarget.codex[0]
  await writeFile(path.join(original.env!.PLUGIN_DATA, 'private.txt'), 'private fixture')
  const bundle = path.join(root, 'bundle')
  await exportPlugin({ projectRoot, outDir: bundle, name: 'bundle' })
  await rm(projectRoot, { recursive: true })
  await rm(pluginDir, { recursive: true })
  const consumer = path.join(root, 'consumer')
  await saveAgentsConfig(consumer, createDefaultAgentsConfig({ enabledIntegrations: ['codex'], mcpServers: {} }))
  await importPlugin({ projectRoot: consumer, pluginDir: bundle })
  const server = (await loadResolvedRegistry(consumer)).serversByTarget.codex[0]
  const run = () => spawnSync(server.command!, server.args, { cwd: server.cwd, env: { ...process.env, ...server.env }, encoding: 'utf8' })
  expect(run().status).toBe(0)
  expect(run().stdout.trim()).toBe('ok')
  expect(await pathExists(path.join(server.env!.PLUGIN_DATA, 'private.txt'))).toBe(false)
  await rm(path.join(consumer, '.agents/plugin-data'), { recursive: true })
  vi.stubEnv('PATH', '')
  await performSync({ projectRoot: consumer, check: false, verbose: false })
  expect(await pathExists(server.cwd!)).toBe(true)
})

it('exports shared skill resources alongside immediate skills', async () => {
  const { root, projectRoot } = await fixture({ type: 'stdio', command: 'node' })
  const skills = path.join(projectRoot, '.agents/skills')
  await mkdir(path.join(skills, 'alpha'), { recursive: true })
  await mkdir(path.join(skills, 'shared'))
  await writeFile(path.join(skills, 'alpha/SKILL.md'), '---\nname: alpha\ndescription: fixture\n---\nRun run.mjs.')
  await writeFile(path.join(skills, 'alpha/run.mjs'), "import { value } from '../shared/helper.mjs'; console.log(value)")
  await writeFile(path.join(skills, 'shared/helper.mjs'), "export const value = 'shared resource works'")
  const outDir = path.join(root, 'shared-bundle')
  await exportPlugin({ projectRoot, outDir, name: 'shared' })
  await rm(projectRoot, { recursive: true })
  const result = spawnSync(process.execPath, [path.join(outDir, 'skills/alpha/run.mjs')], { encoding: 'utf8' })
  expect(result.status).toBe(0)
  expect(result.stdout.trim()).toBe('shared resource works')
})

it('rejects grouped shared resources before flattening changes their relative paths', async () => {
  const { root, projectRoot } = await fixture({ type: 'stdio', command: 'node' })
  const group = path.join(projectRoot, '.agents/skills/team')
  await mkdir(path.join(group, 'alpha'), { recursive: true })
  await mkdir(path.join(group, 'shared'))
  await writeFile(path.join(group, 'alpha/SKILL.md'), '---\nname: alpha\ndescription: fixture\n---\nRun run.mjs.')
  await writeFile(path.join(group, 'alpha/run.mjs'), "import '../shared/helper.mjs'")
  await writeFile(path.join(group, 'shared/helper.mjs'), 'console.log("shared")')
  const outDir = path.join(root, 'bundle')
  await expect(exportPlugin({ projectRoot, outDir, name: 'grouped' })).rejects.toThrow(/shared resources/)
  expect(await pathExists(outDir)).toBe(false)
})

it('resolves a relative command independently of a different cwd', async () => {
  const { pluginDir, projectRoot } = await fixture({ type: 'stdio', command: './bin/server', cwd: '${PLUGIN_ROOT}/work' })
  await mkdir(path.join(pluginDir, 'bin'))
  await mkdir(path.join(pluginDir, 'work'))
  const executable = path.join(pluginDir, 'bin/server')
  await writeFile(executable, `#!${process.execPath}\nconsole.log("relative command works")\n`)
  await chmod(executable, 0o755)
  await importPlugin({ projectRoot, pluginDir })
  const server = (await loadResolvedRegistry(projectRoot)).serversByTarget.codex[0]
  const result = spawnSync(server.command!, server.args, { cwd: server.cwd, encoding: 'utf8' })
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('relative command works')
})

it('re-exports executable commands and recreates nested runtime data before probing', async () => {
  const { root, pluginDir, projectRoot } = await fixture({ type: 'stdio', command: './server', cwd: '${PLUGIN_DATA}' })
  await writeFile(path.join(pluginDir, 'server'), `#!${process.execPath}
const readline = require('node:readline')
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  const result = message.method === 'server/discover'
    ? { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} } }
    : { resultType: 'complete', tools: [{ name: 'ok', inputSchema: { type: 'object' } }] }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
})
`)
  await chmod(path.join(pluginDir, 'server'), 0o755)
  await importPlugin({ projectRoot, pluginDir })
  const outDir = path.join(root, 'executable-bundle')
  await exportPlugin({ projectRoot, outDir, name: 'bundle' })
  const consumer = path.join(root, 'consumer')
  await saveAgentsConfig(consumer, createDefaultAgentsConfig({ enabledIntegrations: ['codex'], mcpServers: {} }))
  await importPlugin({ projectRoot: consumer, pluginDir: outDir })
  const server = (await loadResolvedRegistry(consumer)).serversByTarget.codex[0]
  await rm(path.join(consumer, '.agents/plugin-data'), { recursive: true })
  const result = await probeServerTools(server, 2000)
  expect(result.ok, result.error).toBe(true)
  expect(result.tools.map(tool => tool.name)).toEqual(['ok'])
})

it('excludes secrets ignored by parent Git rules or local excludes from snapshots', async () => {
  const { root, pluginDir, projectRoot } = await fixture({ type: 'stdio', command: 'node' })
  expect(spawnSync('git', ['init', '-q', root]).status).toBe(0)
  await writeFile(path.join(root, '.gitignore'), '.env\nprivate/\n')
  await writeFile(path.join(root, '.git/info/exclude'), 'local-token.txt\n')
  await writeFile(path.join(pluginDir, '.env'), 'TOKEN=fixture-secret')
  await writeFile(path.join(pluginDir, 'local-token.txt'), 'local-secret')
  await mkdir(path.join(pluginDir, 'private'))
  await writeFile(path.join(pluginDir, 'private/secret.txt'), 'nested-secret')
  await symlink('.env', path.join(pluginDir, 'alias.txt'))
  await writeFile(path.join(pluginDir, 'public.txt'), 'public asset')
  await importPlugin({ projectRoot, pluginDir })
  const server = (await loadResolvedRegistry(projectRoot)).serversByTarget.codex[0]
  const installed = server.env!.PLUGIN_ROOT
  for (const name of ['.env', 'local-token.txt', 'private/secret.txt', 'alias.txt']) {
    expect(await pathExists(path.join(installed, name)), name).toBe(false)
  }
  expect(await readFile(path.join(installed, 'public.txt'), 'utf8')).toBe('public asset')
})

it('imports exported bundles from ignored dist directories without copying later local files', async () => {
  const { root, projectRoot, pluginDir } = await fixture({ type: 'stdio', command: 'node', args: ['-e', 'console.log("ok")'] })
  await importPlugin({ projectRoot, pluginDir })
  expect(spawnSync('git', ['init', '-q', projectRoot]).status).toBe(0)
  await writeFile(path.join(projectRoot, '.gitignore'), 'dist/\n.env\n')
  const outDir = path.join(projectRoot, 'dist/agent-plugin')
  await exportPlugin({ projectRoot, outDir, name: 'bundle' })
  await writeFile(path.join(outDir, '.env'), 'TOKEN=private-fixture')
  const consumer = path.join(root, 'consumer')
  await saveAgentsConfig(consumer, createDefaultAgentsConfig({ enabledIntegrations: ['codex'], mcpServers: {} }))
  await importPlugin({ projectRoot: consumer, pluginDir: outDir })
  const server = (await loadResolvedRegistry(consumer)).serversByTarget.codex[0]
  const result = spawnSync(server.command!, server.args, { cwd: server.cwd, encoding: 'utf8' })
  expect(result.status).toBe(0)
  expect(result.stdout.trim()).toBe('ok')
  const snapshots = path.join(consumer, '.agents/plugins')
  const entries = await readdir(snapshots)
  expect(await pathExists(path.join(snapshots, entries[0], '.env'))).toBe(false)
})

it('retains empty runtime working directories through export inventories', async () => {
  const { root, projectRoot, pluginDir } = await fixture({ type: 'stdio', command: 'node', args: ['-e', 'console.log("ok")'], cwd: './work' })
  await mkdir(path.join(pluginDir, 'work'))
  await importPlugin({ projectRoot, pluginDir })
  const outDir = path.join(root, 'bundle')
  await exportPlugin({ projectRoot, outDir, name: 'bundle' })
  const consumer = path.join(root, 'consumer')
  await saveAgentsConfig(consumer, createDefaultAgentsConfig({ enabledIntegrations: ['codex'], mcpServers: {} }))
  await importPlugin({ projectRoot: consumer, pluginDir: outDir })
  const server = (await loadResolvedRegistry(consumer)).serversByTarget.codex[0]
  expect(spawnSync(server.command!, server.args, { cwd: server.cwd, encoding: 'utf8' }).status).toBe(0)
})

it.each(['changed', 'traversal'] as const)('rejects unsafe export inventories (%s)', async mode => {
  const { root, projectRoot, pluginDir } = await fixture({ type: 'stdio', command: 'node' })
  await importPlugin({ projectRoot, pluginDir })
  const outDir = path.join(root, 'bundle')
  await exportPlugin({ projectRoot, outDir, name: 'bundle' })
  if (mode === 'changed') {
    const manifest = JSON.parse(await readFile(path.join(outDir, 'plugin.json'), 'utf8'))
    manifest.description = 'changed after export'
    await writeFile(path.join(outDir, 'plugin.json'), JSON.stringify(manifest))
  } else {
    const inventoryPath = path.join(outDir, '.agents-export.json')
    const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'))
    inventory.files['../private.txt'] = 'fake-digest'
    await writeFile(inventoryPath, JSON.stringify(inventory))
  }
  const consumer = path.join(root, 'consumer')
  await saveAgentsConfig(consumer, createDefaultAgentsConfig({ mcpServers: {} }))
  await expect(importPlugin({ projectRoot: consumer, pluginDir: outDir })).rejects.toThrow(/changed|unsafe path/)
})

it.each(['command', 'cwd'] as const)('rejects %s paths escaping the installed package', async field => {
  const { pluginDir, projectRoot } = await fixture({ type: 'stdio', command: 'node', [field]: './../outside' })
  await expect(importPlugin({ projectRoot, pluginDir })).rejects.toThrow(/outside/)
})

it('provides plugin runtime variables and persistent data across package updates and fresh clones', async () => {
  const { root, pluginDir, projectRoot } = await fixture({
    type: 'stdio', command: 'node', args: ['${PLUGIN_ROOT}/server.cjs', '${PLUGIN_DATA}'], cwd: '${PLUGIN_DATA}'
  })
  await writeFile(path.join(pluginDir, 'server.cjs'), 'console.log(JSON.stringify({ root: process.env.PLUGIN_ROOT, data: process.env.PLUGIN_DATA, arg: process.argv[2] }))')
  await importPlugin({ projectRoot, pluginDir })
  let server = (await loadResolvedRegistry(projectRoot)).serversByTarget.codex[0]
  const result = spawnSync(server.command!, server.args, { cwd: server.cwd, env: { ...process.env, ...server.env }, encoding: 'utf8' })
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({ root: server.env?.PLUGIN_ROOT, data: server.cwd, arg: server.cwd })
  expect(await readFile(path.join(projectRoot, '.gitignore'), 'utf8')).toContain('.agents/plugin-data/')
  const dataDir = server.env!.PLUGIN_DATA
  await writeFile(path.join(dataDir, 'keep.txt'), 'persistent fixture')
  await writeFile(path.join(pluginDir, 'extra.txt'), 'new package version')
  const config = createDefaultAgentsConfig({ enabledIntegrations: ['codex'], mcpServers: {} })
  await saveAgentsConfig(projectRoot, config)
  await importPlugin({ projectRoot, pluginDir })
  server = (await loadResolvedRegistry(projectRoot)).serversByTarget.codex[0]
  expect(server.env?.PLUGIN_DATA).toBe(dataDir)
  expect(await readFile(path.join(dataDir, 'keep.txt'), 'utf8')).toBe('persistent fixture')
  const moved = path.join(root, 'moved-data')
  await rename(projectRoot, moved)
  await rm(path.join(moved, '.agents/plugin-data'), { recursive: true })
  server = (await loadResolvedRegistry(moved)).serversByTarget.codex[0]
  await performSync({ projectRoot: moved, check: true, verbose: false })
  expect(await pathExists(server.env!.PLUGIN_DATA)).toBe(false)
  await performSync({ projectRoot: moved, check: false, verbose: false })
  expect(await pathExists(server.env!.PLUGIN_DATA)).toBe(true)
})
