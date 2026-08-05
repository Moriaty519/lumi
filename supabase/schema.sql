-- Lumi 树洞留言板 · Supabase schema
-- 在 Supabase Dashboard → SQL Editor 中整段执行

create extension if not exists "pgcrypto";

-- 账号（昵称即账号）
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  nickname text not null unique,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists accounts_nickname_idx on accounts (nickname);

-- 房间（群聊码）
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  group_name text not null default '树洞',
  ai_name text not null default 'Lumi',
  ai_role text not null default 'default',
  completed boolean not null default false,
  reports jsonb not null default '{"text":null,"generatedAt":null}'::jsonb,
  game jsonb,
  created_at timestamptz not null default now()
);

create index if not exists rooms_code_idx on rooms (code);

-- 房间成员
create table if not exists room_members (
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references accounts(id) on delete cascade,
  display_nickname text,
  nickname_customized boolean not null default false,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (room_id, user_id)
);

create index if not exists room_members_user_idx on room_members (user_id);

-- 留言（公开树洞 + 私聊）
-- channel: court = 全员可见；private = 仅 private_to 用户与系统可见
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  channel text not null check (channel in ('court', 'private')),
  sender text not null, -- uuid | 'lumi' | 'system'
  private_to uuid references accounts(id) on delete cascade,
  text text not null default '',
  kind text not null default 'chat', -- chat | system | opening
  image text,
  created_at timestamptz not null default now()
);

create index if not exists messages_room_channel_idx
  on messages (room_id, channel, created_at);

create index if not exists messages_private_to_idx
  on messages (room_id, private_to, created_at);

-- 情绪 / 量表（按人按房）
create table if not exists room_user_state (
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references accounts(id) on delete cascade,
  emotions jsonb not null default '[]'::jsonb,
  assessment jsonb,
  presence text not null default 'court',
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- 服务端用 service_role 访问时绕过 RLS；仍开启 RLS 防止 anon 误用
alter table accounts enable row level security;
alter table rooms enable row level security;
alter table room_members enable row level security;
alter table messages enable row level security;
alter table room_user_state enable row level security;

-- 本阶段全部由服务端 service_role 读写，不建 anon 策略
