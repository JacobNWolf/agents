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

it.each(['split', 'multiline'])('reads a complete matching SSE response without waiting for EOF (%s)', async mode => {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n')
    response.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id + 100, result: { tools: [{ name: 'wrong' }] } })}\n\n`)
    if (mode === 'multiline') {
      response.write(`data: {"jsonrpc":"2.0","id":${body.id},\ndata: "result":{"resultType":"complete","tools":[{"name":"séarch"}]}}\n\n`)
    } else {
      const payload = Buffer.from(`data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { resultType: 'complete', tools: [{ name: 'séarch' }] } })}\n\n`)
      const index = payload.indexOf(Buffer.from('é')) + 1
      response.write(payload.subarray(0, index))
      const timer = setTimeout(() => response.write(payload.subarray(index)), 20)
      response.on('close', () => clearTimeout(timer))
    }
    // Keep the response open until the client cancels it.
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing port')
  const result = await probeServerTools({ name: 'stream', transport: 'http', url: `http://127.0.0.1:${address.port}/mcp` }, 300)
  expect(result.ok).toBe(true)
  expect(result.tools.map(tool => tool.name)).toEqual(['séarch'])
})
