# Lumi 关系大法官（全栈）

本地可跑 · Socket.io 真实时 · DeepSeek

## 准备

```bash
cd /Users/work/Desktop/lumi/7.27测试/lumi-judge
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY
npm install
npm run dev
```

- 电脑浏览器：http://localhost:5173  
- 手机（同 Wi‑Fi）：http://\<电脑局域网IP\>:5173  

查本机 IP（macOS）：`ipconfig getifaddr en0`

## 功能摘要

- 首页选身份：雪雪 / 北海  
- **双人**：私聊 → 想说给对方的话（润色确认）→ 异步进群（`已进入群聊` + `@对方` 代说）→ 回到私聊（3 次，系统提示返回时间）→ 继续须重写 → 完成须双方同意  
- **单人**：选关系类型 → 倾诉 / 情绪 / AI 分析  
- 双端状态经 **Socket.io** 推送，不用轮询  

## 目录

- `server/` Express + Socket.io + DeepSeek  
- `client/` Vite React  
- `shared/` 共享类型  
