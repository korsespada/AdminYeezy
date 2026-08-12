import { afterEach, describe, expect, it, vi } from 'vitest'
import { anthropicMessagesCompletion } from '@/lib/anthropic'

describe('Anthropic provider adapter', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('sends AgentRouter requests to Messages API with the Claude Code wire headers', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ content: [{ type: 'text', text: 'OK' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))

    const payload = await anthropicMessagesCompletion({
      model: 'claude-opus-5',
      system: 'Отвечай кратко.',
      messages: [{ role: 'user', content: 'OK?' }],
      max_tokens: 8,
    }, { baseUrl: 'https://agentrouter.org/v1', apiKey: 'test-key' })

    expect(payload.content).toEqual([{ type: 'text', text: 'OK' }])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://agentrouter.org/v1/messages?beta=true',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': expect.stringContaining('claude-code-20250219'),
          'X-Stainless-Lang': 'js',
        }),
      }),
    )
  })
})
