import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  // Genel
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  TIMEZONE: z.string().default('Europe/Istanbul'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Google Gemini (zorunlu - AI metin)
  GEMINI_API_KEY: z.string().min(10),

  // Pexels (zorunlu - görsel)
  PEXELS_API_KEY: z.string().min(10),

  // Supabase (zorunlu)
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(10),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),

  // WordPress (zorunlu)
  WORDPRESS_URL: z.string().url(),
  WORDPRESS_USERNAME: z.string().min(1),
  WORDPRESS_APP_PASSWORD: z.string().min(1),

  // Site
  SITE_DOMAIN: z.string().default('devletinhaberleri.com'),
  SITE_BRAND_NAME: z.string().default('Devlet Haberleri'),

  // Job davranışı (GitHub Actions her tetiklemede çalışır)
  POSTS_PER_RUN: z.coerce.number().min(1).max(5).default(1),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (_config) return _config;

  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Config doğrulama hatası:');
    console.error(result.error.flatten().fieldErrors);
    throw new Error('Hatalı yapılandırma. .env dosyanı kontrol et.');
  }

  _config = result.data;
  return _config;
}
