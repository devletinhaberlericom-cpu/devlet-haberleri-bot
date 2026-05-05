import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../config/index.js';

let _client: SupabaseClient | null = null;

/**
 * Supabase client (service role - sunucu tarafında tam yetki)
 * Sadece backend'de kullanılır.
 */
export function getDb(): SupabaseClient {
  if (_client) return _client;

  const config = getConfig();
  _client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  return _client;
}
