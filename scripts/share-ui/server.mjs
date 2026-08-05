#!/usr/bin/env node
/**
 * Lumi 一键分享控制台
 * - 立刻打开本机窗口（加载中）
 * - 后台启动 npm run dev + cpolar
 * - 同一窗口展示链接 / 复制 / 结束分享
 */
import http from 'http';
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '../..');
const CPOLAR = '/Applications/cpolar';
const PORT = 3927;
const PID_DIR = '/tmp/lumi-share';
const DEV_LOG = '/tmp/lumi-share-dev.log';
const CPOLAR_LOG = '/tmp/lumi-share-cpolar.log';

fs.mkdirSync(PID_DIR, { recursive: true });

const state = {
  phase: 'boot', // boot | starting_app | starting_tunnel | ready | error | stopped
  message: '正在打开分享面板…',
  detail: '',
  url: '',
  error: '',
  startedAt: Date.now(),
};

function writePid(name, pid) {
  fs.writeFileSync(path.join(PID_DIR, `${name}.pid`), String(pid));
}

function readPid(name) {
  try {
    return Number(fs.readFileSync(path.join(PID_DIR, `${name}.pid`), 'utf8').trim());
  } catch {
    return 0;
  }
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function portOpen(port) {
  try {
    execSync(`curl -s -o /dev/null --connect-timeout 1 http://127.0.0.1:${port}/`, {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function killPid(pid) {
  if (!pid || !alive(pid)) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* ignore */
    }
  }
}

function stopTunnel() {
  const pid = readPid('cpolar');
  killPid(pid);
  try {
    execSync(`pkill -f "${CPOLAR} http 5173"`, { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(path.join(PID_DIR, 'cpolar.pid'));
  } catch {
    /* ignore */
  }
  state.url = '';
}

function stopAll() {
  stopTunnel();
  const dev = readPid('dev');
  killPid(dev);
  try {
    for (const port of [5173, 3001]) {
      const out = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' }).trim();
      if (out) {
        for (const p of out.split(/\s+/)) {
          try {
            process.kill(Number(p), 'SIGTERM');
          } catch {
            /* ignore */
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(path.join(PID_DIR, 'dev.pid'));
  } catch {
    /* ignore */
  }
}

function extractUrl(text) {
  const m = text.match(
    /https:\/\/[a-zA-Z0-9._-]+\.(?:cpolar\.(?:cn|top|io)|cpolar\.com)[^\s"'<>]*/
  );
  return m ? m[0].replace(/[),.;]+$/, '') : '';
}

function readCpolarLogs() {
  let t = '';
  for (const f of [CPOLAR_LOG, `${CPOLAR_LOG}.stdout`]) {
    try {
      t += fs.readFileSync(f, 'utf8');
    } catch {
      /* ignore */
    }
  }
  return t;
}

function setPhase(phase, message, detail = '') {
  state.phase = phase;
  state.message = message;
  state.detail = detail;
  state.error = phase === 'error' ? message : '';
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureAppRunning() {
  if (portOpen(5173)) {
    setPhase('starting_tunnel', '本机项目已在运行', '正在开通外网入口…');
    return;
  }
  setPhase('starting_app', '正在启动本机项目…', '第一次可能需要一两分钟，请稍候');
  const child = spawn('npm', ['run', 'dev'], {
    cwd: PROJECT,
    env: {
      ...process.env,
      PATH: `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH || ''}`,
    },
    detached: true,
    stdio: ['ignore', fs.openSync(DEV_LOG, 'w'), fs.openSync(DEV_LOG, 'a')],
  });
  writePid('dev', child.pid);
  child.unref();

  for (let i = 0; i < 90; i++) {
    if (portOpen(5173)) {
      setPhase('starting_tunnel', '本机项目已就绪', '正在开通外网入口…');
      return;
    }
    setPhase(
      'starting_app',
      '正在启动本机项目…',
      `已等待 ${i + 1} 秒（通常 20～60 秒）`
    );
    await sleep(1000);
  }
  throw new Error('本机项目启动超时。请确认已安装依赖（在项目目录执行过 npm install）。');
}

async function ensureTunnel() {
  if (!fs.existsSync(CPOLAR)) {
    throw new Error('找不到 cpolar（/Applications/cpolar）。请先安装并完成登录。');
  }

  // 重启隧道，保证拿到当前链接
  stopTunnel();
  await sleep(600);
  try {
    fs.writeFileSync(CPOLAR_LOG, '');
  } catch {
    /* ignore */
  }

  setPhase('starting_tunnel', '正在开通外网入口…', '向 cpolar 申请可分享链接');
  const child = spawn(CPOLAR, ['http', '5173', `-log=${CPOLAR_LOG}`, '-log-level=INFO'], {
    detached: true,
    stdio: ['ignore', fs.openSync(`${CPOLAR_LOG}.stdout`, 'w'), fs.openSync(`${CPOLAR_LOG}.stdout`, 'a')],
  });
  writePid('cpolar', child.pid);
  child.unref();

  for (let i = 0; i < 45; i++) {
    const url = extractUrl(readCpolarLogs());
    if (url) {
      state.url = url;
      setPhase('ready', '链接已就绪，可以发给对方了', '分享期间请保持本窗口打开，不要关机');
      try {
        fs.writeFileSync(path.join(PID_DIR, 'url.txt'), url);
      } catch {
        /* ignore */
      }
      return;
    }
    setPhase('starting_tunnel', '正在开通外网入口…', `申请中 ${i + 1} 秒`);
    await sleep(1000);
  }
  throw new Error('未能拿到分享链接。请检查网络，或打开终端手动运行：/Applications/cpolar http 5173');
}

async function bootPipeline() {
  try {
    await ensureAppRunning();
    await ensureTunnel();
  } catch (e) {
    setPhase('error', e instanceof Error ? e.message : String(e), '可点「重试」再试一次');
  }
}

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lumi · 分享链接</title>
  <style>
    :root {
      --bg0: #e6efe4;
      --bg1: #f4f8f2;
      --ink: #243028;
      --muted: #5f6f64;
      --line: rgba(60, 90, 70, 0.12);
      --green: #5f9a5e;
      --green-deep: #3f7a45;
      --danger: #c0392b;
      --surface: rgba(255,255,255,0.78);
      --shadow: 0 18px 50px rgba(40, 60, 45, 0.12);
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; height: 100%;
      font-family: "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(900px 420px at 12% -10%, rgba(127,183,126,0.35), transparent 60%),
        radial-gradient(700px 380px at 100% 0%, rgba(155,123,184,0.18), transparent 55%),
        linear-gradient(165deg, var(--bg0), var(--bg1));
    }
    body {
      display: grid;
      place-items: center;
      padding: 28px 16px;
      min-height: 100%;
    }
    .panel {
      width: min(440px, 100%);
      background: var(--surface);
      backdrop-filter: blur(16px);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
      padding: 28px 26px 22px;
      animation: rise .45s ease both;
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: none; }
    }
    .brand {
      font-size: 13px;
      letter-spacing: 0.08em;
      color: var(--green-deep);
      font-weight: 600;
      margin-bottom: 10px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 26px;
      line-height: 1.25;
      font-weight: 700;
    }
    .sub {
      margin: 0 0 22px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.55;
      min-height: 44px;
    }
    .stage {
      border: 1px dashed var(--line);
      border-radius: 16px;
      padding: 18px 16px;
      background: rgba(255,255,255,0.55);
      margin-bottom: 18px;
    }
    .loading {
      display: flex;
      gap: 14px;
      align-items: center;
    }
    .spinner {
      width: 28px; height: 28px;
      border-radius: 50%;
      border: 3px solid rgba(95,154,94,0.2);
      border-top-color: var(--green);
      animation: spin .8s linear infinite;
      flex: none;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .steps { font-size: 13px; color: var(--muted); line-height: 1.5; }
    .steps strong { color: var(--ink); display: block; font-size: 15px; margin-bottom: 2px; }
    .link-box {
      word-break: break-all;
      font-size: 14px;
      line-height: 1.5;
      padding: 12px 14px;
      border-radius: 12px;
      background: #eef6ee;
      border: 1px solid rgba(95,154,94,0.25);
      color: var(--green-deep);
      font-weight: 560;
    }
    .actions {
      display: grid;
      gap: 10px;
    }
    button {
      appearance: none;
      border: none;
      border-radius: 12px;
      padding: 12px 14px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: transform .12s ease, opacity .12s ease;
    }
    button:active { transform: scale(0.98); }
    button:disabled { opacity: 0.45; cursor: default; transform: none; }
    .btn-primary {
      background: linear-gradient(135deg, #7fb77e, #5f9a5e);
      color: #fff;
      box-shadow: 0 8px 18px rgba(95,154,94,0.28);
    }
    .btn-secondary {
      background: #fff;
      color: var(--ink);
      border: 1px solid var(--line);
    }
    .btn-danger {
      background: #fff5f4;
      color: var(--danger);
      border: 1px solid rgba(192,57,43,0.18);
    }
    .hint {
      margin-top: 14px;
      font-size: 12px;
      color: var(--muted);
      line-height: 1.5;
      text-align: center;
    }
    .toast {
      position: fixed;
      left: 50%;
      bottom: 28px;
      transform: translateX(-50%) translateY(20px);
      background: rgba(36,48,40,0.92);
      color: #fff;
      padding: 10px 16px;
      border-radius: 999px;
      font-size: 13px;
      opacity: 0;
      pointer-events: none;
      transition: .25s ease;
    }
    .toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    .error {
      color: var(--danger);
      font-size: 14px;
      line-height: 1.5;
      white-space: pre-wrap;
    }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <main class="panel">
    <div class="brand">LUMI · 关系大法官</div>
    <h1 id="title">正在准备分享</h1>
    <p class="sub" id="sub">请稍候，马上给你可发给对方的链接。</p>

    <div class="stage" id="stageLoading">
      <div class="loading">
        <div class="spinner" aria-hidden="true"></div>
        <div class="steps">
          <strong id="msg">加载中…</strong>
          <span id="detail">正在连接本机服务</span>
        </div>
      </div>
    </div>

    <div class="stage hidden" id="stageReady">
      <div class="link-box" id="url"></div>
    </div>

    <div class="stage hidden" id="stageError">
      <div class="error" id="err"></div>
    </div>

    <div class="actions">
      <button class="btn-primary hidden" id="btnCopy" type="button">复制链接</button>
      <button class="btn-secondary hidden" id="btnRetry" type="button">重试</button>
      <button class="btn-danger" id="btnStop" type="button">结束分享</button>
    </div>
    <p class="hint" id="hint">分享期间请不要关机。结束后对方将无法再打开链接。</p>
  </main>
  <div class="toast" id="toast"></div>

  <script>
    const $ = (id) => document.getElementById(id);
    const toast = (t) => {
      const el = $('toast');
      el.textContent = t;
      el.classList.add('show');
      clearTimeout(toast._t);
      toast._t = setTimeout(() => el.classList.remove('show'), 1800);
    };

    function render(s) {
      $('msg').textContent = s.message || '加载中…';
      $('detail').textContent = s.detail || '';
      const loading = s.phase === 'boot' || s.phase === 'starting_app' || s.phase === 'starting_tunnel';
      const ready = s.phase === 'ready' && s.url;
      const error = s.phase === 'error';
      const stopped = s.phase === 'stopped';

      $('stageLoading').classList.toggle('hidden', !(loading || stopped));
      $('stageReady').classList.toggle('hidden', !ready);
      $('stageError').classList.toggle('hidden', !error);

      if (ready) {
        $('title').textContent = '可以发给对方了';
        $('sub').textContent = '链接已自动复制到剪贴板。对方用浏览器打开即可。';
        $('url').textContent = s.url;
        $('btnCopy').classList.remove('hidden');
        $('btnRetry').classList.add('hidden');
        $('btnStop').textContent = '结束分享';
        $('btnStop').disabled = false;
        $('hint').textContent = '分享期间请保持电脑开机。点「结束分享」会关闭外网入口。';
      } else if (error) {
        $('title').textContent = '没能生成链接';
        $('sub').textContent = '可以点「重试」，或稍后再试。';
        $('err').textContent = s.error || s.message || '未知错误';
        $('btnCopy').classList.add('hidden');
        $('btnRetry').classList.remove('hidden');
        $('btnStop').textContent = '关闭';
      } else if (stopped) {
        $('title').textContent = '已结束分享';
        $('sub').textContent = '外网入口已关闭。可以关闭本页面。';
        $('msg').textContent = '分享已停止';
        $('detail').textContent = '如需再次分享，重新双击桌面「Lumi一键分享链接」即可';
        $('btnCopy').classList.add('hidden');
        $('btnRetry').classList.add('hidden');
        $('btnStop').textContent = '关闭页面';
        $('hint').textContent = '';
      } else {
        $('title').textContent = '正在准备分享';
        $('sub').textContent = '请稍候，马上给你可发给对方的链接。';
        $('btnCopy').classList.add('hidden');
        $('btnRetry').classList.add('hidden');
        $('btnStop').textContent = '取消并结束';
      }
    }

    async function poll() {
      try {
        const res = await fetch('/api/status');
        const s = await res.json();
        render(s);
        if (s.phase === 'ready' && s.url && !poll._copied) {
          poll._copied = true;
          try {
            await navigator.clipboard.writeText(s.url);
            toast('链接已复制');
          } catch (_) {}
        }
        if (s.phase !== 'stopped') {
          setTimeout(poll, 800);
        }
      } catch (_) {
        setTimeout(poll, 1200);
      }
    }

    $('btnCopy').onclick = async () => {
      const text = $('url').textContent.trim();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        toast('已复制到剪贴板');
      } catch (_) {
        toast('复制失败，请手动选中链接');
      }
    };

    $('btnRetry').onclick = async () => {
      poll._copied = false;
      await fetch('/api/retry', { method: 'POST' });
      toast('正在重试…');
    };

    $('btnStop').onclick = async () => {
      const label = $('btnStop').textContent;
      if (label === '关闭页面') {
        window.close();
        document.body.innerHTML = '<p style="text-align:center;margin-top:40vh;color:#5f6f64">可以关闭此标签页了</p>';
        return;
      }
      $('btnStop').disabled = true;
      await fetch('/api/stop', { method: 'POST' });
      toast('已结束分享');
      poll._copied = false;
    };

    poll();
  </script>
</body>
</html>`;

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(HTML);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    sendJson(res, 200, state);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/stop') {
    stopTunnel();
    setPhase('stopped', '已结束分享', '外网入口已关闭');
    sendJson(res, 200, { ok: true });
    // 稍后再关服务，方便前端拿到 stopped 状态
    setTimeout(() => {
      try {
        server.close();
      } catch {
        /* ignore */
      }
      process.exit(0);
    }, 1500);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/retry') {
    setPhase('boot', '正在重试…', '');
    state.url = '';
    bootPipeline();
    sendJson(res, 200, { ok: true });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

function alreadyListening() {
  try {
    execSync(`curl -s -o /dev/null --connect-timeout 1 http://127.0.0.1:${PORT}/`, {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (alreadyListening()) {
    spawn('open', [`http://127.0.0.1:${PORT}/`], { detached: true, stdio: 'ignore' }).unref();
    process.exit(0);
  }

  await new Promise((resolve, reject) => {
    server.listen(PORT, '127.0.0.1', resolve);
    server.on('error', reject);
  });

  spawn('open', [`http://127.0.0.1:${PORT}/`], { detached: true, stdio: 'ignore' }).unref();
  setPhase('starting_app', '正在启动本机项目…', '窗口已打开，后台继续准备');
  bootPipeline();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
