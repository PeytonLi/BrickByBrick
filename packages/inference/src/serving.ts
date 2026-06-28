// packages/inference/src/serving.ts
import { withRetry, type RetryOptions } from './gemini'

/** Call a vLLM OpenAI-compatible server. `model` is the served name
 *  (the base model id, or the lora-module name e.g. "tuned"). */
export async function inferOnModel(
  serveUrl: string,
  model: string,
  prompt: string,
  opts: RetryOptions = {},
): Promise<string> {
  const base = serveUrl.replace(/\/$/, '')
  return withRetry(async () => {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You implement front-end UI. Return only code.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 2048,
      }),
    })
    if (!res.ok) throw new Error(`infer ${model} → ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return data.choices?.[0]?.message?.content ?? ''
  }, opts)
}
