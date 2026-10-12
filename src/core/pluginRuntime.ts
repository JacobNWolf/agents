import path from 'node:path'
import { ensureDir, isDirectory, pathExists } from './fs.js'
import { getProjectPaths } from './paths.js'
import type { ResolvedMcpServer } from '../types.js'

/** Create the dedicated data directories referenced by imported plugin servers. */
export async function syncPluginData(projectRoot: string, servers: ResolvedMcpServer[], check: boolean, changed: string[]): Promise<void> {
  const paths = getProjectPaths(projectRoot)
  const seen = new Set<string>()
  for (const server of servers) {
    const root = server.env?.PLUGIN_ROOT
    const data = server.env?.PLUGIN_DATA
    if (server.transport !== 'stdio' || !root || !data) continue
    if (path.dirname(root) !== path.join(paths.agentsDir, 'plugins') || path.dirname(data) !== paths.agentsPluginDataDir) continue
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
