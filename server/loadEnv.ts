import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

/** 强制从项目根目录加载 .env（不依赖进程 cwd） */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
// Vercel 等平台已注入环境变量：不要用本地 .env 覆盖（且线上通常没有 .env）
const onPlatform = Boolean(process.env.VERCEL || process.env.NOW_REGION);
const result = dotenv.config({
  path: envPath,
  override: !onPlatform,
});
if (result.error) {
  console.warn('[env] 未能加载 .env:', envPath, result.error.message);
} else {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  console.log(
    `[env] loaded ${envPath} | SUPABASE_URL=${Boolean((process.env.SUPABASE_URL || '').trim())} | SERVICE_ROLE_KEY=${key ? 'yes' : 'NO'}`
  );
}
