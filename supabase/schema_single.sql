-- 单人模式会话（Vercel / 云端）
-- 在 Supabase SQL Editor 执行一次

create table if not exists single_sessions (
  user_id uuid primary key references accounts(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  relation_type text not null,
  messages jsonb not null default '[]'::jsonb,
  emotions jsonb not null default '[]'::jsonb,
  assessment jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table single_sessions enable row level security;

-- 默认群名（新房间）；已有房间可手动改 group_name
alter table rooms alter column group_name set default '树洞';
