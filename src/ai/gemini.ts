import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { getConfig } from '../config/index.js';

let _client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (_client) return _client;
  const config = getConfig();
  _client = new GoogleGenerativeAI(config.GEMINI_API_KEY);
  return _client;
}

/**
 * Sade wrapper: text in → text out
 *
 * Modeller:
 * - gemini-2.5-flash-lite: 15 RPM, 1500 RPD (en yüksek kota, varsayılan)
 * - gemini-2.5-flash: 10 RPM, 250 RPD (daha kaliteli ama düşük kota)
 */
export async function askAi(opts: {
  system?: string;
  user: string;
  model?: 'gemini-2.5-flash-lite' | 'gemini-2.5-flash' | 'gemini-2.5-pro';
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const modelName = opts.model || 'gemini-2.5-flash-lite';
  const model: GenerativeModel = getClient().getGenerativeModel({
    model: modelName,
    generationConfig: {
      maxOutputTokens: opts.maxTokens || 2000,
      temperature: opts.temperature ?? 0.3,
    },
    systemInstruction: opts.system,
  });

  const result = await model.generateContent(opts.user);
  const text = result.response.text();
  if (!text) throw new Error('Boş yanıt geldi');
  return text;
}

/**
 * JSON yanıt - markdown fence'leri temizler
 */
export async function askAiJson<T = any>(opts: {
  system?: string;
  user: string;
  model?: 'gemini-2.5-flash-lite' | 'gemini-2.5-flash' | 'gemini-2.5-pro';
  maxTokens?: number;
}): Promise<T> {
  const text = await askAi({ ...opts, temperature: 0.1 });
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`JSON parse hatası. Yanıt: ${cleaned.substring(0, 300)}...`);
  }
}
