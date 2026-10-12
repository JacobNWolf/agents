import path from 'node:path'
import { ensureDir, isDirectory, pathExists } from './fs.js'
import { getProjectPaths } from './paths.js'
import type { ResolvedMcpServer } from '../types.js'

/** Locate the consuming project even when an imported runtime embeds another plugin. */
export function pluginProjectRoot(server: ResolvedMcpServer): string | undefined {
  const root = server.env?.PLUGIN_ROOT
  const data = server.env?.PLUGIN_DATA
  if (!root || !data || !path.isAbsolute(root) || !path.isAbsolute(data)) return undefined
  for (let parent = path.dirname(root); path.dirname(parent) !== parent; parent = path.dirname(parent)) {
    if (path.basename(parent) !== 'plugins' || path.basename(path.dirname(parent)) !== '.agents') continue
    const projectRoot = path.dirname(path.dirname(parent))
    if (isDescendant(getProjectPaths(projectRoot).agentsPluginDataDir, data)) return projectRoot
  }
  return undefined
}

/** Create the dedicated data directories referenced by imported plugin servers. */
export async function syncPluginData(projectRoot: string, servers: ResolvedMcpServer[], check: boolean, changed: string[]): Promise<void> {
  const paths = getProjectPaths(projectRoot)
  const seen = new Set<string>()
  for (const server of servers) {
    const root = server.env?.PLUGIN_ROOT
    const data = server.env?.PLUGIN_DATA
    if (server.transport !== 'stdio' || !root || !data) continue
    if (!isDescendant(path.join(paths.agentsDir, 'plugins'), root) || !isDescendant(paths.agentsPluginDataDir, data)) continue
    if (seen.has(data)) continue
    seen.add(data)
    if (await pathExists(data)) {
      if (!(await isDirectory(data))) throw new Error(`Plugin data path is not a directory: ${data}`)
      continue
    }
    changed.push(path.relative(projectRoot, data))
    if (!check) await ensureDir(data)
  }
}

function isDescendant(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
