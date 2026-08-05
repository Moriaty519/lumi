# Vercel 上线清单

更细的点选说明（Supabase SQL / GitHub / Vercel）见 **[SETUP_GUIDE.md](./SETUP_GUIDE.md)**。

## 你要在 Supabase 做的

1. 若还没跑过主结构：SQL Editor 执行 `supabase/schema.sql`
2. **必做**：执行 `supabase/schema_single.sql`（单人模式表 + 默认群名「树洞」）
3. **必做**：执行 `supabase/schema_ai_role.sql`（房间 `ai_role`：默认 / 关系大法官 / 罗辑）
4. 确认 `rooms.group_name` 默认值已是「树洞」（新房间）；旧房间可在表里手动改

### schema_ai_role.sql 怎么执行（最短版）

1. 打开 [supabase.com](https://supabase.com) → 进你的项目  
2. 左侧点 **SQL Editor** → **New query**  
3. 把 `supabase/schema_ai_role.sql` 里的 SQL 粘贴进去  
4. 点 **Run**，看到 Success 即可  

## 你要在 Vercel 配的环境变量

| 变量 | 说明 |
|------|------|
| `SUPABASE_URL` | 项目 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role / secret**（勿用 publishable） |
| `DEEPSEEK_API_KEY` | AI 回复 |
| `DEEPSEEK_BASE_URL` | 可选，默认 `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 可选，默认 `deepseek-chat` |

不要配 `VITE_SUPABASE_*`。不要把 service_role 写进前端。

## 部署命令（本机）

```bash
cd 7.27测试/lumi-judge
npx vercel          # 预览
npx vercel --prod   # 生产
```

或 GitHub 连接仓库后自动 Deploy。Root Directory 指向 `lumi-judge` 项目根（含 `vercel.json`）。

**要不要先 push GitHub？**  
- 用 Vercel 连 GitHub 自动部署 → **要先 push**  
- 用 `npx vercel` 本机直传 → **不必**  

详见 [SETUP_GUIDE.md](./SETUP_GUIDE.md)。

## 当前云端已支持（可上 Vercel）

- 昵称登录 / 恢复账号
- 创建/加入/退出群聊（创建时可选 Lumi 角色）、树洞留言 + 轮询
- 默契小游戏（多局）
- 单人模式（start/send/情绪/速测/退出）
- 个人资料保存
- **结案报告**、**嘴替**（双人云端 HTTP）
- 双人情绪标记 / 关系速测（写入房间，供结案报告使用）

## 仍未上云 / 部署后暂不可用

- 双人「开场白润色 / 休庭」等仍靠本机 Socket
- 沟通记录本地存档与云端未完全统一

上线后先测：登录 → 建房 → 两人聊天 → 小游戏 → 嘴替 → 结案报告 → 单人模式。AI 若超时，需 Vercel Pro（`maxDuration: 60`）或拆成异步生成。
