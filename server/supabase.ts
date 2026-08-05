import './loadEnv.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function isSupabaseConfigured() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return Boolean(url && key && !url.includes('xxxx') && !key.includes('your-'));
}

export function supabaseConfigDebug() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return {
    hasUrl: Boolean(url),
    hasKey: Boolean(key),
    keyKind: key.startsWith('sb_secret')
      ? 'secret'
      : key.startsWith('sb_publishable')
        ? 'publishable'
        : key.startsWith('eyJ')
          ? 'jwt'
          : key
            ? 'other'
            : 'missing',
  };
}

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error('未配置 Supabase：请在 .env 填写 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY');
  }
  if (!client) {
    client = createClient(
      process.env.SUPABASE_URL!.trim(),
      process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
      {
        auth: { persistSession: false, autoRefreshToken: false },
      }
    );
  }
  return client;
}
