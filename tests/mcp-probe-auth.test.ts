import { createServer, type Server } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { probeServerTools } from '../src/core/mcpProbe.js'

const servers: Server[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

async function fixture(expected: string) {
  const headers: Array<string | undefined> = []
  const server = createServer(async (request, response) => {
    headers.push(request.headers.authorization)
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    response.writeHead(request.headers.authorization === expected ? 200 : 401, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { resultType: 'complete', tools: [{ name: 'search' }] } }))
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing port')
  return { url: `http://127.0.0.1:${address.port}/mcp`, headers }
}

it('authenticates using a configured bearer token environment variable', async () => {
  const { url, headers } = await fixture('Bearer fixture-token')
  vi.stubEnv('REVIEW_PROBE_TOKEN', 'fixture-token')
  const result = await probeServerTools({ name: 'docs', transport: 'http', url, bearerTokenEnvVar: 'REVIEW_PROBE_TOKEN' })
  expect(result.ok).toBe(true)
  expect(result.tools).toHaveLength(1)
  expect(headers).toEqual(['Bearer fixture-token'])
})

it('keeps explicit authorization headers without duplicating them under different casing', async () => {
  const { url, headers } = await fixture('Bearer explicit-token')
  vi.stubEnv('REVIEW_PROBE_TOKEN', 'fixture-env-token')
  const result = await probeServerTools({ name: 'docs', transport: 'http', url, bearerTokenEnvVar: 'REVIEW_PROBE_TOKEN', headers: { authorization: 'Bearer explicit-token' } })
  expect(result.ok).toBe(true)
  expect(headers).toEqual(['Bearer explicit-token'])
})

it.each([undefined, 'fixture-secret\ninvalid'])('reports missing or invalid bearer credentials without connecting or printing values', async value => {
  const { url, headers } = await fixture('unused')
  vi.stubEnv('REVIEW_PROBE_TOKEN', value)
  const result = await probeServerTools({ name: 'docs', transport: 'http', url, bearerTokenEnvVar: 'REVIEW_PROBE_TOKEN' })
  expect(result.ok).toBe(false)
  expect(result.error).toContain('REVIEW_PROBE_TOKEN')
  expect(result.error).not.toContain('fixture-secret')
  expect(headers).toEqual([])
})
