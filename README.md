# Lumi 树洞

线上（Vercel）：云端数据库 + HTTP，树洞留言轮询刷新。  
本机开发：可走 Supabase 云端，或未配 Supabase 时回退本地 Socket。

## 线上部署（GitHub → Vercel）

1. 代码在仓库：https://github.com/Moriaty519/lumi  
2. Vercel Import 该仓库后配置环境变量（见下）再 Deploy  
3. 以后改代码：本地改 → `git push` → Vercel 自动重新部署  

### 必配环境变量（Vercel）

| Key | 从哪拿 |
|-----|--------|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 同上 → `service_role`（点 Reveal，**不要**用 anon/publishable） |
| `DEEPSEEK_API_KEY` | DeepSeek 控制台密钥 |

可选：`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`。

上线前在 Supabase SQL Editor 执行：`supabase/schema.sql` → `schema_single.sql` → `schema_ai_role.sql`。  
更细步骤见 `SETUP_GUIDE.md`、`DEPLOY_VERCEL.md`。

## 本地开发

```bash
cd /Users/work/Desktop/lumi/7.27测试/lumi-judge
cp .env.example .env   # 填入与线上相同的三项密钥
npm install
npm run dev
```

- 电脑：http://localhost:5173  
- `.env` 勿提交（已在 `.gitignore`）

## 功能摘要（当前）

- 昵称登录；首页：**创建群聊** / 输入群聊码 / 单人模式  
- 创建群聊可选 Lumi 角色：默认 / 关系大法官 / 罗辑  
- **树洞群聊**：留言板；发消息后 AI 可回复；其他人打开/刷新拉取（云端轮询，非 Socket 长连接）  
- 私聊、情绪、速测、默契小游戏、嘴替、结案报告  
- 单人：选关系类型 → 倾诉  

## 目录

- `client/` 前端（Vite React）  
- `server/` 本机 Express；含云端 HTTP 逻辑  
- `api/` Vercel Serverless 入口  
- `shared/` 共享类型与角色定义  
- `supabase/` 数据库 SQL  
