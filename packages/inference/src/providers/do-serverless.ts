import OpenAI from 'openai'
import type { SolverSet } from './interface'

const DO_BASE_URL = 'https://inference.do-ai.run/v1/'

function apiKey(): string {
  const key = process.env.DIGITALOCEAN_MODEL_ACCESS_KEY
  if (!key) throw new Error('DIGITALOCEAN_MODEL_ACCESS_KEY is not set')
  return key
}

function resolveModel(envKey: string, fallback: string): string {
  return process.env[envKey] || fallback
}

function createDOClient(): OpenAI {
  return new OpenAI({ baseURL: DO_BASE_URL, apiKey: apiKey() })
}

export function createDOSolverSet(): SolverSet {
  const strongModel = resolveModel('DO_STRONG_MODEL', 'anthropic-claude-4.6-sonnet')
  const weakModel = resolveModel('DO_WEAK_MODEL', 'llama3.3-70b-instruct')

  return {
    strongModel,
    weakModel,
    generate: async (model, systemPrompt, userPrompt) => {
      const client = createDOClient()
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
      messages.push({ role: 'user', content: userPrompt })

      const res = await client.chat.completions.create({
        model,
        messages,
        max_completion_tokens: 8192,
      })
      return res.choices[0]?.message?.content ?? ''
    },
    embed: async (text) => {
      const embedModel = process.env.DO_EMBED_MODEL || 'gte-large'
      const client = createDOClient()
      const res = await client.embeddings.create({
        model: embedModel,
        input: text,
      })
      return res.data[0]?.embedding ?? []
    },
  }
}
