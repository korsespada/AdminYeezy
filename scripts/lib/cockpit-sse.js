async function readSseContent(response) {
  if (!response.body) throw new Error('Cockpit Tools returned no response stream')

  const decoder = new TextDecoder()
  let pending = ''
  let content = ''

  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true })
    const events = pending.split(/\r?\n\r?\n/)
    pending = events.pop() || ''
    for (const event of events) content += contentFromEvent(event)
  }

  pending += decoder.decode()
  if (pending.trim()) content += contentFromEvent(pending)
  return content.trim()
}

function contentFromEvent(event) {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim()

  if (!data || data === '[DONE]') return ''

  let payload
  try {
    payload = JSON.parse(data)
  } catch {
    throw new Error('Cockpit Tools returned an invalid SSE event')
  }

  if (payload.error) {
    throw new Error(`Cockpit Tools: ${payload.error.message || payload.error}`)
  }

  const value = payload?.choices?.[0]?.delta?.content
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('')
  }
  return ''
}

module.exports = { readSseContent }
