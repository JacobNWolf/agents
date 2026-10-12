import { createServer, type Server } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { probeServerTools } from '../src/core/mcpProbe.js'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections()
    server.close(() => resolve())
  })))
})

it.each([false, true])('enforces one server deadline across all HTTP requests (legacy=%s)', async legacy => {
  const methods: string[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    methods.push(body.method)
    const timer = setTimeout(() => {
      if (legacy && body.params?._meta) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32600, message: 'initialize first' } }))
      } else if (body.method === 'notifications/initialized') {
        response.writeHead(202)
        response.end()
      } else {
        const page = Number(body.params?.cursor ?? 0)
        const result = body.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: {} }
          : { resultType: 'complete', tools: [{ name: `tool-${page}` }], ...(page < 4 ? { nextCursor: String(page + 1) } : {}) }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
      }
    }, 80)
    response.on('close', () => clearTimeout(timer))
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing port')
  const start = performance.now()
  const result = await probeServerTools({ name: 'deadline', transport: 'http', url: `http://127.0.0.1:${address.port}/mcp` }, 200)
  expect(result.ok).toBe(false)
  expect(result.error).toBe('timed out after 200ms')
  expect(performance.now() - start).toBeLessThan(800)
  expect(methods.length).toBeLessThan(5)
})
