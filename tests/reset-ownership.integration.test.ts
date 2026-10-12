import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runReset } from '../src/commands/reset.js'
import { createDefaultAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'
import { getProjectPaths } from '../src/core/paths.js'

const tempDirs: string[] = []
const configs = [
  ['.cursor/mcp.json', 'cursor.mcp.json', 'mcpServers'],
  ['.agents/mcp_config.json', 'antigravity.mcp_config.json', 'mcpServers'],
  ['.antigravity/mcp.json', 'antigravity.mcp_config.json', 'mcpServers'],
  ['.vscode/mcp.json', 'copilot.vscode.mcp.json', 'servers'],
  ['.junie/mcp/mcp.json', 'junie.mcp.json', 'mcpServers']
]

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agents-reset-ownership-'))
  tempDirs.push(root)
  vi.stubEnv('AGENTS_HOME_DIR', path.join(root, 'home'))
  return root
}

describe('reset config ownership', () => {
  it('recovers a legacy preview that uses Windows relative path separators', async () => {
    const projectRoot = await fixture()
    await saveAgentsConfig(projectRoot, createDefaultAgentsConfig({ mcpServers: {} }))
    const paths = getProjectPaths(projectRoot)
    await mkdir(paths.generatedDir, { recursive: true })
    await mkdir(path.dirname(paths.copilotCliGithubMcp), { recursive: true })
    const docs = { command: 'node' }
    await writeFile(paths.copilotCliGithubMcp, JSON.stringify({ mcpServers: { docs } }))
    await writeFile(paths.generatedProjectMcpState, JSON.stringify({ files: { [path.join(projectRoot, 'old/.github/mcp.json')]: ['docs'] } }))
    await writeFile(paths.generatedClaudeProjectMcp, JSON.stringify({ files: { '.github\\mcp.json': { docs } } }))
    await runReset({ projectRoot, localOnly: false, hard: false })
    await expect(readFile(paths.copilotCliGithubMcp)).rejects.toThrow()
  })

  it.each([false, true])('cleans relocated project MCP ownership (legacy absolute state=%s)', async legacy => {
    const parent = await fixture()
    vi.stubEnv('PATH', '')
    const projectRoot = path.join(parent, 'before')
    const config = createDefaultAgentsConfig({ enabledIntegrations: ['claude'], mcpServers: {
      docs: { transport: 'stdio', command: 'node' }
    } })
    config.integrations.options.claudeScope = 'project'
    await saveAgentsConfig(projectRoot, config)
    await performSync({ projectRoot, check: false, verbose: false })
    const paths = getProjectPaths(projectRoot)
    if (legacy) await writeFile(paths.generatedProjectMcpState, JSON.stringify({ files: { [paths.copilotCliMcp]: ['docs'] } }))
    await mkdir(path.join(projectRoot, '.github'), { recursive: true })
    const manual = { mcpServers: { docs: { command: 'manual' } } }
    await writeFile(paths.copilotCliGithubMcp, JSON.stringify(manual))
    const moved = path.join(parent, 'after')
    await rename(projectRoot, moved)
    await runReset({ projectRoot: moved, localOnly: false, hard: false })
    await expect(readFile(path.join(moved, '.mcp.json'))).rejects.toThrow()
    expect(JSON.parse(await readFile(path.join(moved, '.github/mcp.json'), 'utf8'))).toEqual(manual)
  })

  it.each([true, false])('preserves same-named manual project MCP with applied state (managed=%s)', async managed => {
    const projectRoot = await fixture()
    await saveAgentsConfig(projectRoot, createDefaultAgentsConfig({ mcpServers: {
      shared: { transport: 'stdio', command: 'managed' }
    } }))
    await mkdir(path.join(projectRoot, '.agents/generated'), { recursive: true })
    await mkdir(path.join(projectRoot, '.github'), { recursive: true })
    await writeFile(path.join(projectRoot, '.agents/generated/project-mcp.state.json'), JSON.stringify({
      files: managed ? { [path.join(projectRoot, '.mcp.json')]: ['shared'] } : {}
    }))
    const manual = { mcpServers: { shared: { command: 'manual' } }, custom: true }
    await writeFile(path.join(projectRoot, '.github/mcp.json'), JSON.stringify(manual))
    await runReset({ projectRoot, localOnly: true, hard: false })
    expect(JSON.parse(await readFile(path.join(projectRoot, '.github/mcp.json'), 'utf8'))).toEqual(manual)
  })

  it.each([true, false])('preserves unmanaged config entries (localOnly=%s)', async localOnly => {
    const projectRoot = await fixture()
    for (const [relative, , key] of configs) {
      const file = path.join(projectRoot, relative)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, JSON.stringify({ [key]: { manual: { command: 'manual' } }, custom: true }))
    }
    await runReset({ projectRoot, localOnly, hard: false })
    for (const [relative, , key] of configs) {
      expect(JSON.parse(await readFile(path.join(projectRoot, relative), 'utf8'))).toEqual({
        [key]: { manual: { command: 'manual' } }, custom: true
      })
    }
  })

  it('removes managed entries while retaining manual servers and settings', async () => {
    const projectRoot = await fixture()
    for (const [relative, generated, key] of configs) {
      const file = path.join(projectRoot, relative)
      const preview = path.join(projectRoot, '.agents/generated', generated)
      await mkdir(path.dirname(file), { recursive: true })
      await mkdir(path.dirname(preview), { recursive: true })
      await writeFile(preview, JSON.stringify({ [key]: { managed: { command: 'managed' } } }))
      await writeFile(file, JSON.stringify({ [key]: {
        managed: { command: 'managed' }, manual: { command: 'manual' }
      }, custom: true }))
    }
    await runReset({ projectRoot, localOnly: false, hard: false })
    for (const [relative, , key] of configs) {
      expect(JSON.parse(await readFile(path.join(projectRoot, relative), 'utf8'))).toEqual({
        [key]: { manual: { command: 'manual' } }, custom: true
      })
    }
  })

  it('does not claim manual entries solely because their names appear in a preview', async () => {
    const projectRoot = await fixture()
    for (const [relative, generated, key] of configs) {
      const file = path.join(projectRoot, relative)
      const preview = path.join(projectRoot, '.agents/generated', generated)
      await mkdir(path.dirname(file), { recursive: true })
      await mkdir(path.dirname(preview), { recursive: true })
      await writeFile(preview, JSON.stringify({ [key]: { sameName: { command: 'preview-only' } } }))
      await writeFile(file, JSON.stringify({ [key]: { sameName: { command: 'manual' } } }))
    }
    await runReset({ projectRoot, localOnly: false, hard: false })
    for (const [relative, , key] of configs) {
      expect(JSON.parse(await readFile(path.join(projectRoot, relative), 'utf8'))[key])
        .toEqual({ sameName: { command: 'manual' } })
    }
  })

  it('uses the last applied ownership when previews have already changed', async () => {
    const projectRoot = await fixture()
    await mkdir(path.join(projectRoot, '.cursor'), { recursive: true })
    await mkdir(path.join(projectRoot, '.agents/generated'), { recursive: true })
    await writeFile(path.join(projectRoot, '.cursor/mcp.json'), JSON.stringify({ mcpServers: {
      old: { command: 'managed' }, next: { command: 'manual' }
    } }))
    await writeFile(path.join(projectRoot, '.agents/generated/cursor.mcp.json'), JSON.stringify({ mcpServers: {
      next: { command: 'generated' }
    } }))
    await writeFile(path.join(projectRoot, '.agents/generated/cursor.mcp.state.json'), JSON.stringify({ managedNames: ['old'] }))
    await runReset({ projectRoot, localOnly: true, hard: false })
    expect(JSON.parse(await readFile(path.join(projectRoot, '.cursor/mcp.json'), 'utf8')).mcpServers)
      .toEqual({ next: { command: 'manual' } })
  })

})
