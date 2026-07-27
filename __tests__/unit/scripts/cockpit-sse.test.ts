import { describe, expect, it } from 'vitest'

const { readSseContent } = require('../../../scripts/lib/cockpit-sse') as {
  readSseContent: (response: { body: AsyncIterable<Uint8Array> }) => Promise<string>
}

async function* chunks(...values: string[]) {
  const encoder = new TextEncoder()
  for (const value of values) yield encoder.encode(value)
}

describe('Cockpit SSE parser', () => {
  it('joins content split across network chunks and ignores finish events', async () => {
    const response = {
      body: chunks(
        'data: {"choices":[{"delta":{"content":"{\\"name\\":' ,
        '\\"Топ\\"}"}}]}\r\n\r\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\n',
        'data: [DONE]\r\n\r\n',
      ),
    }

    await expect(readSseContent(response)).resolves.toBe('{"name":"Топ"}')
  })

  it('surfaces an upstream SSE error', async () => {
    const response = {
      body: chunks('data: {"error":{"message":"account unavailable"}}\n\n'),
    }

    await expect(readSseContent(response)).rejects.toThrow('account unavailable')
  })
})
