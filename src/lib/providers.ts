/**
 * Where the coach's model runs. Two wire formats cover every option:
 *
 *  - "openai": the chat-completions request format that OpenAI popularised and
 *    that open-weight servers adopted as a common standard. Ollama, LM Studio,
 *    llama.cpp, vLLM and Hugging Face all accept it. Nothing is sent to OpenAI.
 *  - "anthropic": Anthropic's Messages API, for Claude, via the official SDK.
 */
import type AnthropicClient from '@anthropic-ai/sdk';
import type { LlmApi, LlmSettings } from '../types';

export interface Preset {
  id: string;
  label: string;
  api: LlmApi;
  baseUrl: string;
  model: string;
  /** Hosted services need a key; local servers don't. */
  keyLabel?: string;
  keyWhere?: string;
  jsonMode: boolean;
  openWeight: boolean;
  models: { id: string; note: string }[];
  setup: string[];
}

export const PRESETS: Preset[] = [
  {
    id: 'ollama',
    label: 'Ollama — open-weight, on your computer',
    api: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3:8b',
    jsonMode: true,
    openWeight: true,
    models: [
      { id: 'qwen3:8b', note: 'Good default; runs on most laptops (~5 GB)' },
      { id: 'qwen3:14b', note: 'Better reasoning; needs ~10 GB' },
      { id: 'gpt-oss:20b', note: "OpenAI's open-weight model; ~14 GB" },
      { id: 'gemma3:12b', note: "Google's open-weight model; ~8 GB" },
      { id: 'llama3.1:8b', note: "Meta's open-weight model; fast" },
    ],
    setup: [
      'Install Ollama from ollama.com (Mac, Windows or Linux).',
      'In a terminal: ollama pull qwen3:8b',
      'Keep Ollama running, then tap Test connection.',
      'Phone on the same Wi-Fi? Quit Ollama and start it with OLLAMA_HOST=0.0.0.0 OLLAMA_ORIGINS="*" ollama serve, then use http://<computer IP>:11434/v1 as the server URL.',
    ],
  },
  {
    id: 'huggingface',
    label: 'Hugging Face — open-weight, hosted',
    api: 'openai',
    baseUrl: 'https://router.huggingface.co/v1',
    model: 'openai/gpt-oss-20b',
    keyLabel: 'Hugging Face access token',
    keyWhere: 'huggingface.co → Settings → Access Tokens (a "Read" token with Inference Providers permission)',
    jsonMode: false,
    openWeight: true,
    models: [
      { id: 'openai/gpt-oss-20b', note: 'Open-weight, fast and cheap' },
      { id: 'openai/gpt-oss-120b', note: 'Open-weight, stronger reasoning' },
      { id: 'meta-llama/Llama-3.1-8B-Instruct', note: 'Open-weight, small' },
    ],
    setup: [
      'Create a free Hugging Face account and an access token that can call Inference Providers.',
      'Paste the token below and tap Test connection — it lists the models your account can use.',
      'Usage is billed by Hugging Face (free monthly credits, then pay-as-you-go). No computer needs to stay on.',
    ],
  },
  {
    id: 'lmstudio',
    label: 'LM Studio — open-weight, on your computer',
    api: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    model: 'qwen/qwen3-8b',
    jsonMode: false,
    openWeight: true,
    models: [{ id: 'qwen/qwen3-8b', note: 'Download it in LM Studio first' }],
    setup: ['Install LM Studio, download a model, and start the local server (Developer tab).', 'Tap Test connection to see the loaded model names.'],
  },
  {
    id: 'claude',
    label: 'Claude — Anthropic API (not open-weight)',
    api: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-opus-5-5',
    keyLabel: 'Anthropic API key',
    keyWhere: 'the Claude Console at platform.claude.com → API keys',
    jsonMode: false,
    openWeight: false,
    models: [
      { id: 'claude-opus-5-5', note: 'Most capable Opus; ~$0.05–0.10 per plan' },
      { id: 'claude-sonnet-5-5', note: 'Faster and about half the price' },
      { id: 'claude-haiku-5-5', note: 'Fastest and cheapest' },
    ],
    setup: [
      'Create an API key in the Claude Console (platform.claude.com) and add billing.',
      'Paste the key below and tap Test connection.',
      'The key is stored only in this browser on this device and is never included in exports.',
    ],
  },
  {
    id: 'custom',
    label: 'Other server (llama.cpp, vLLM, …)',
    api: 'openai',
    baseUrl: 'http://localhost:8080/v1',
    model: '',
    jsonMode: true,
    openWeight: true,
    models: [],
    setup: ['Any server that accepts chat-completions requests works. Enter its URL and model name.'],
  },
];

export const DEFAULT_LLM: LlmSettings = {
  enabled: true,
  api: 'openai',
  preset: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
  apiKey: '',
  jsonMode: true,
};

export function presetOf(s: LlmSettings): Preset {
  return PRESETS.find((p) => p.id === s.preset) ?? PRESETS.at(-1)!;
}

export function applyPreset(id: string, current: LlmSettings): LlmSettings {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS.at(-1)!;
  // Keep the key only when staying on the same hosted service.
  return { ...current, preset: p.id, api: p.api, baseUrl: p.baseUrl, model: p.model, jsonMode: p.jsonMode, apiKey: current.preset === p.id ? current.apiKey : '' };
}

/** Models that support Anthropic's server-side refusal fallback. */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

type Sdk = typeof AnthropicClient;
let sdk: Promise<Sdk> | null = null;
/** The SDK is only downloaded when Claude is actually used. */
function loadSdk(): Promise<Sdk> {
  sdk ??= import('@anthropic-ai/sdk').then((m) => m.default);
  return sdk;
}

async function anthropicClient(s: LlmSettings): Promise<{ client: AnthropicClient; Anthropic: Sdk }> {
  const Anthropic = await loadSdk();
  const custom = s.baseUrl && !/^https:\/\/api\.anthropic\.com\/?$/.test(s.baseUrl);
  const client = new Anthropic({
    apiKey: s.apiKey,
    // Personal app: the key lives only in this user's own browser.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    ...(custom ? { baseURL: s.baseUrl } : {}),
  });
  return { client, Anthropic };
}

function anthropicError(Anthropic: Sdk, e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError) return new Error('Anthropic rejected the API key — check it in Settings');
  if (e instanceof Anthropic.PermissionDeniedError) return new Error("This API key can't use that model");
  if (e instanceof Anthropic.NotFoundError) return new Error('Unknown Claude model name');
  if (e instanceof Anthropic.RateLimitError) return new Error('Anthropic rate limit reached — try again in a minute');
  if (e instanceof Anthropic.APIConnectionError) return new Error("Couldn't reach the Anthropic API — check your connection");
  if (e instanceof Anthropic.APIError) return new Error(`Anthropic API error ${e.status ?? ''}: ${e.message}`.trim());
  return e instanceof Error ? e : new Error(String(e));
}

async function chatAnthropic(s: LlmSettings, system: string, user: string, signal?: AbortSignal, maxTokens = 16000): Promise<string> {
  if (!s.apiKey) throw new Error('Add your Anthropic API key in Settings');
  const { client, Anthropic } = await anthropicClient(s);
  try {
    const res = await client.beta.messages.create(
      {
        model: s.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { effort: 'medium' },
        // If a safety classifier declines, retry server-side on Anthropic's recommended fallback model.
        ...(FALLBACK_MODELS.has(s.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal },
    );
    if (res.stop_reason === 'refusal') throw new Error('Claude declined this request');
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    if (res.stop_reason === 'max_tokens' && !text.includes('}')) throw new Error('Claude ran out of output space');
    if (!text.trim()) throw new Error('Claude returned an empty reply');
    return text;
  } catch (e) {
    throw anthropicError(Anthropic, e);
  }
}

async function chatOpenAI(s: LlmSettings, system: string, user: string, signal?: AbortSignal, json = s.jsonMode): Promise<string> {
  const url = s.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (s.apiKey) headers.Authorization = `Bearer ${s.apiKey}`;
  const body: Record<string, unknown> = {
    model: s.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.3,
    stream: false,
  };
  if (json) body.response_format = { type: 'json_object' };
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`Couldn't reach ${s.baseUrl}. Is the model server running and allowing this page?`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) throw new Error(`The server rejected the key (${res.status})`);
    throw new Error(`Model server returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('The model returned an empty reply');
  return content;
}

/** Send one system + user prompt and return the text reply. */
export async function chat(s: LlmSettings, system: string, user: string, signal?: AbortSignal): Promise<string> {
  if (s.api === 'anthropic') return chatAnthropic(s, system, user, signal);
  try {
    return await chatOpenAI(s, system, user, signal);
  } catch (e) {
    // Some servers reject response_format; retry once without it.
    if (s.jsonMode && e instanceof Error && /\b(400|422)\b/.test(e.message)) return chatOpenAI(s, system, user, signal, false);
    throw e;
  }
}

export async function listModels(s: LlmSettings): Promise<string[]> {
  if (s.api === 'anthropic') {
    const { client, Anthropic } = await anthropicClient(s);
    try {
      const page = await client.models.list();
      return page.data.map((m) => m.id);
    } catch (e) {
      throw anthropicError(Anthropic, e);
    }
  }
  const headers: Record<string, string> = {};
  if (s.apiKey) headers.Authorization = `Bearer ${s.apiKey}`;
  const res = await fetch(s.baseUrl.replace(/\/+$/, '') + '/models', { headers });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.data) ? data.data.map((m: { id: string }) => m.id) : [];
}

/** Quick round trip to check the URL, key and model. */
export async function testConnection(s: LlmSettings): Promise<string> {
  const reply =
    s.api === 'anthropic'
      ? await chatAnthropic(s, 'Reply with exactly: OK', 'Connection test', AbortSignal.timeout(60_000), 1024)
      : await chat(s, 'Reply with the JSON {"ok": true}', 'Connection test', AbortSignal.timeout(90_000));
  return reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, 80);
}
