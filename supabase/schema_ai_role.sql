-- ============================================================
-- 在 Supabase 里怎么执行（一步步点）
-- ============================================================
-- 1. 浏览器打开 https://supabase.com 并登录
-- 2. 点开你的项目（例如 sodqajwzriazslxkkvob）
-- 3. 左侧菜单点「SQL Editor」（SQL 编辑器）
-- 4. 点右上角「New query」新建查询
-- 5. 把下面这一整行复制粘贴进白色编辑框
-- 6. 点右下角绿色「Run」按钮
-- 7. 下方出现 Success 就表示成功了
-- ============================================================

alter table rooms add column if not exists ai_role text not null default 'default';
