# 上手操作说明（Supabase SQL + GitHub + Vercel）

## 一、在 Supabase 执行 SQL（必做）

这是给云端数据库「加一列字段」：没有这一步，创建群聊时选的 Lumi 角色存不进去。

### 具体点哪里

1. 用浏览器打开 [https://supabase.com](https://supabase.com)，登录。
2. 点进你的项目（Dashboard 里那个项目卡片）。
3. 看左边菜单，找到并点击 **SQL Editor**（中文界面可能叫「SQL 编辑器」）。
4. 点 **New query**（新建查询）。
5. 打开本项目里的文件：`supabase/schema_ai_role.sql`  
   （或直接复制下面这一行）：

```sql
alter table rooms add column if not exists ai_role text not null default 'default';
```

6. 粘贴到中间白色大输入框。
7. 点右下角绿色 **Run**（运行）。
8. 下方出现 **Success** / 成功，就完成了。  
   若提示 column already exists，说明以前跑过，也可以忽略。

如果还没建过表，需要先按同样方式依次执行：

1. `supabase/schema.sql`
2. `supabase/schema_single.sql`
3. `supabase/schema_ai_role.sql`（本文件）

---

## 二、要不要先 push 到 GitHub？

**两种部署方式，任选一种：**

### 方式 A：用 Vercel 网页连接 GitHub（推荐，以后改代码会自动更新）

需要先把代码放到 GitHub：

1. 在 [https://github.com](https://github.com) 新建一个空仓库（例如 `lumi-judge`），不要勾选自动加 README。
2. 在本机终端进入项目目录：

```bash
cd /Users/work/Desktop/lumi/7.27测试/lumi-judge
git status
```

若还没有 git 仓库：

```bash
git init
git add .
git commit -m "Initial commit"
```

3. 关联远程并推送（把 `你的用户名` 换成你的 GitHub 用户名）：

```bash
git remote add origin https://github.com/你的用户名/lumi-judge.git
git branch -M main
git push -u origin main
```

4. 打开 [https://vercel.com](https://vercel.com) → 登录 → **Add New Project** → 选刚推送的 GitHub 仓库。
5. **Root Directory** 若仓库根就是本项目，保持默认；若仓库是上层 `lumi`，则填 `7.27测试/lumi-judge`。
6. 在 Environment Variables 里添加：

| 变量 | 从哪复制 |
|------|----------|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 同上页 → `service_role`（secret，点 Reveal） |
| `DEEPSEEK_API_KEY` | 你的 DeepSeek 密钥 |

7. 点 Deploy。以后每次 `git push`，Vercel 会自动重新部署。

### 方式 B：不经过 GitHub，本机直接部署

也可以，不必先 push：

```bash
cd /Users/work/Desktop/lumi/7.27测试/lumi-judge
npx vercel login
npx vercel          # 预览
npx vercel --prod   # 正式上线
```

首次会问你项目名、目录；环境变量可在命令行交互里加，或之后到 Vercel 网页 → Project → Settings → Environment Variables 里补。

---

## 三、部署后建议自测

1. 打开昵称登录  
2. **创建群聊** → 选角色 → 进房发言  
3. 嘴替  
4. 结案 → 查看报告  
5. 单人模式聊几句  

AI 若超时：Hobby 套餐约 10 秒限制；本项目已配 `maxDuration: 60`，正式用建议 Vercel Pro。
