-- 默契小游戏状态（存在房间上）
-- 在 Supabase SQL Editor 执行一次

alter table rooms add column if not exists game jsonb;
