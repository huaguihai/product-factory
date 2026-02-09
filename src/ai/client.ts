/**
 * AI Client - Adapted from the-git-mind/lib/ai/router.ts
 * Supports multi-provider key pool with fallback
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, generateObject } from 'ai';
import { supabaseAdmin } from '../db/supabase';
import { trackCost } from './cost-tracker';

// --- Provider exhaustion cache ---
const exhaustedProviderCache = new Map<string, number>();
const QUOTA_CACHE_TTL_MS = 60000;

function isQuotaExceededError(error: any): boolean {
  const msg = error?.message?.toLowerCase() || '';
  return msg.includes('quota exceeded') ||
    msg.includes('rate limit') ||
    msg.includes('resource exhausted') ||
    msg.includes('too many requests') ||
    msg.includes('无可用渠道');
}

function isProviderExhausted(provider: string, model: string): boolean {
  const key = `${provider}:${model}`;
  const expiry = exhaustedProviderCache.get(key);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    exhaustedProviderCache.delete(key);
    return false;
  }
  return true;
}

function markProviderExhausted(provider: string, model: string) {
  exhaustedProviderCache.set(`${provider}:${model}`, Date.now() + QUOTA_CACHE_TTL_MS);
}

// --- Custom fetch for /responses -> /chat/completions ---
function createCustomFetch(): typeof fetch {
  return async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let finalUrl = url;
    let finalOptions: RequestInit | undefined = init;

    if (url.endsWith('/responses')) {
      finalUrl = url.replace('/responses', '/chat/completions');
      if (init?.body && typeof init.body === 'string') {
        try {
          const body = JSON.parse(init.body);
          const messages: any[] = [];
          if (body.instructions) {
            messages.push({ role: 'system', content: body.instructions });
          }
          if (body.input) {
            if (typeof body.input === 'string') {
              messages.push({ role: 'user', content: body.input });
            } else if (Array.isArray(body.input)) {
              for (const msg of body.input) {
                let contentText = '';
                if (typeof msg.content === 'string') {
                  contentText = msg.content;
                } else if (Array.isArray(msg.content)) {
                  contentText = msg.content
                    .filter((c: any) => c.type === 'input_text' || c.type === 'text')
                    .map((c: any) => c.text)
                    .join('\n');
                }
                if (contentText) {
                  messages.push({ role: msg.role || 'user', content: contentText });
                }
              }
            }
          }
          const chatBody: any = { model: body.model, messages };
          if (body.temperature !== undefined) chatBody.temperature = body.temperature;
          if (body.max_tokens !== undefined) chatBody.max_tokens = body.max_tokens;
          if (body.top_p !== undefined) chatBody.top_p = body.top_p;
          finalOptions = { ...init, body: JSON.stringify(chatBody) };
        } catch (e) {
          console.error('[AI] Failed to transform request body:', e);
        }
      }
    }
    return fetch(finalUrl, finalOptions);
  };
}

// --- Model instance factory ---
function createModelInstance(provider: string, modelId: string, apiKey: string, baseUrl?: string) {
  if (provider === 'google') {
    const config: any = { apiKey };
    if (baseUrl) config.baseURL = baseUrl;
    return createGoogleGenerativeAI(config)(modelId);
  }

  if (['openai', 'deepseek', 'qwen', 'kimi', 'glm', 'doubao', 'groq', 'proxy'].includes(provider)) {
    const config: any = { apiKey, fetch: createCustomFetch() };
    if (baseUrl) {
      let normalizedUrl = baseUrl;
      if (!normalizedUrl.endsWith('/v1') && !normalizedUrl.endsWith('/v1/')) {
        normalizedUrl = `${normalizedUrl.replace(/\/$/, '')}/v1`;
      }
      config.baseURL = normalizedUrl;
    }
    if (!config.baseURL) {
      if (provider === 'deepseek') config.baseURL = 'https://api.deepseek.com/v1';
      if (provider === 'qwen') config.baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
      if (provider === 'kimi') config.baseURL = 'https://api.moonshot.cn/v1';
      if (provider === 'groq') config.baseURL = 'https://api.groq.com/openai/v1';
    }
    return createOpenAI(config)(modelId);
  }

  if (provider === 'anthropic') {
    const config: any = { apiKey };
    if (baseUrl) config.baseURL = baseUrl;
    return createAnthropic(config)(modelId);
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

// --- Key management ---
async function getActiveKey(provider?: string): Promise<{ id: string; key: string; base_url?: string; provider: string; model: string } | null> {
  let query = supabaseAdmin
    .from('ai_api_keys')
    .select('id, key_value, base_url, provider, allowed_models')
    .eq('is_active', true)
    .order('error_count', { ascending: true });

  if (provider) {
    query = query.eq('provider', provider);
  }

  const { data: keys, error } = await query;
  if (error || !keys || keys.length === 0) return null;

  const candidates = keys.slice(0, 3);
  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  const defaultModel = selected.allowed_models?.[0] || 'gemini-2.0-flash';

  return {
    id: selected.id,
    key: selected.key_value,
    base_url: selected.base_url,
    provider: selected.provider,
    model: defaultModel,
  };
}

async function reportKeyError(keyId: string, errorMessage?: string) {
  const { data } = await supabaseAdmin.from('ai_api_keys').select('error_count, total_requests').eq('id', keyId).single();
  if (data) {
    const updateData: any = {
      error_count: (data.error_count || 0) + 1,
      total_requests: (data.total_requests || 0) + 1,
      last_error_at: new Date().toISOString(),
    };
    if (errorMessage) {
      updateData.last_error_message = errorMessage.substring(0, 500);
    }
    await supabaseAdmin.from('ai_api_keys').update(updateData).eq('id', keyId);
  }
}

async function reportKeySuccess(keyId: string) {
  const { data } = await supabaseAdmin.from('ai_api_keys').select('total_requests').eq('id', keyId).single();
  if (data) {
    await supabaseAdmin.from('ai_api_keys').update({
      total_requests: (data.total_requests || 0) + 1,
      last_used_at: new Date().toISOString(),
    }).eq('id', keyId);
  }
}

// --- Main AI call functions ---

export type AITier = 'fast' | 'quality';

/**
 * Generate text using the AI service pool
 */
export async function aiGenerateText(
  prompt: string,
  options: {
    system?: string;
    tier?: AITier;
    agentType?: string;
    temperature?: number;
    timeout?: number;
  } = {}
): Promise<string | null> {
  const { system, tier = 'fast', agentType = 'unknown', temperature = 0.3, timeout = 60000 } = options;

  const keys = await loadAllKeys();
  if (keys.length === 0) {
    console.error('[AI] No AI models available');
    return null;
  }

  for (const keyData of keys) {
    if (isProviderExhausted(keyData.provider, keyData.model)) continue;

    try {
      const model = createModelInstance(keyData.provider, keyData.model, keyData.key, keyData.base_url);
      const result = await Promise.race([
        generateText({ model, prompt, system, temperature }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout)),
      ]);

      await reportKeySuccess(keyData.id);
      await trackCost(agentType, keyData.model, result.usage?.promptTokens || 0, result.usage?.completionTokens || 0);

      return result.text;
    } catch (error: any) {
      console.error(`[AI] Failed with ${keyData.provider}/${keyData.model}: ${error.message}`);
      await reportKeyError(keyData.id, error.message);
      if (isQuotaExceededError(error)) {
        markProviderExhausted(keyData.provider, keyData.model);
      }
    }
  }

  console.error('[AI] All models failed');
  return null;
}

/**
 * Generate JSON using the AI service pool
 */
export async function aiGenerateJson<T = any>(
  prompt: string,
  options: {
    system?: string;
    tier?: AITier;
    agentType?: string;
    temperature?: number;
    timeout?: number;
  } = {}
): Promise<T | null> {
  const text = await aiGenerateText(prompt, options);
  if (!text) return null;

  try {
    let jsonText = text;
    const match = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```\n([\s\S]*?)\n```/);
    if (match) jsonText = match[1];

    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as T;

    return JSON.parse(jsonText) as T;
  } catch (e) {
    console.error('[AI] Failed to parse JSON:', e);
    console.error('[AI] Raw text:', text.substring(0, 500));
    return null;
  }
}

// --- Helper to load all keys ---
async function loadAllKeys(): Promise<Array<{ id: string; key: string; base_url?: string; provider: string; model: string }>> {
  const { data: allKeys } = await supabaseAdmin
    .from('ai_api_keys')
    .select('id, key_value, base_url, provider, allowed_models')
    .eq('is_active', true)
    .order('error_count', { ascending: true });

  if (!allKeys) return [];

  return allKeys.map(k => ({
    id: k.id,
    key: k.key_value,
    base_url: k.base_url,
    provider: k.provider,
    model: k.allowed_models?.[0] || 'gemini-2.0-flash',
  }));
}
