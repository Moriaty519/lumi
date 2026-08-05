/**
 * 仅云端 HTTP 的 Express 应用（无 Socket、无本地 JSON）。
 * 本地 `server/index.ts` 仍可挂载完整 Socket；Vercel 只引用本文件。
 */
import express from 'express';
import cors from 'cors';
import './loadEnv.js';
import { mountCloudHttpApi } from './httpCloud.js';
import { isSupabaseConfigured, supabaseConfigDebug } from './supabase.js';

export function createCloudApp() {
  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '8mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      hasKey: Boolean(
        process.env.DEEPSEEK_API_KEY &&
          !process.env.DEEPSEEK_API_KEY.includes('your-key')
      ),
      supabase: isSupabaseConfigured(),
      supabaseDebug: supabaseConfigDebug(),
      runtime: 'cloud-http',
    });
  });

  mountCloudHttpApi(app);
  return app;
}

const app = createCloudApp();
export default app;
