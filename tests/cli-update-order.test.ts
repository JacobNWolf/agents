import { afterEach, expect, it, vi } from 'vitest'
import { runMcpAdd } from '../src/commands/mcp-add.js'
import { maybeNotifyAboutUpdate } from '../src/core/updateCheck.js'

vi.mock('../src/commands/mcp-add.js', () => ({ runMcpAdd: vi.fn() }))
vi.mock('../src/core/updateCheck.js', () => ({ maybeNotifyAboutUpdate: vi.fn(async () => {}) }))

const originalArgv = process.argv
afterEach(() => {
  process.argv = originalArgv
  vi.unstubAllEnvs()
})

it('starts optional update writes only after the command has released its config lock', async () => {
  vi.stubEnv('AGENTS_NO_UPDATE_CHECK', '')
  process.argv = ['node', 'agents', 'mcp', 'add', 'docs', '--command', 'node', '--no-sync', '--non-interactive']
  let finish!: () => void
  vi.mocked(runMcpAdd).mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  await import('../src/cli.js')
  await vi.waitFor(() => expect(runMcpAdd).toHaveBeenCalledOnce())
  try {
    expect(maybeNotifyAboutUpdate).not.toHaveBeenCalled()
  } finally {
    finish()
  }
  await vi.waitFor(() => expect(maybeNotifyAboutUpdate).toHaveBeenCalledOnce())
})
