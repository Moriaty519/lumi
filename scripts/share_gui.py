#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Lumi 一键分享
流程：启动本机服务 → 显示本机/同Wi‑Fi链接 → 用户点「开启内网穿透」
     → 只展示本次 cpolar「Tunnel established」的 https（不做网页校验、不翻历史域名）

注意：本机与穿透目标都用 127.0.0.1，不用 localhost（macOS IPv6 坑）。
"""

from __future__ import annotations

import os
import re
import signal
import socket
import subprocess
import threading
import time
import urllib.request
from pathlib import Path
import tkinter as tk
from tkinter import messagebox

PROJECT = Path("/Users/work/Desktop/lumi/7.27测试/lumi-judge")
CPOLAR = Path("/Applications/cpolar")
PID_DIR = Path("/tmp/lumi-share")
DEV_LOG = Path("/tmp/lumi-share-dev.log")
CPOLAR_LOG = Path("/tmp/lumi-share-cpolar.log")
# 本次建立隧道时日志行：Tunnel established at https://…
ESTABLISHED_RE = re.compile(
    r"Tunnel established at (https://[a-zA-Z0-9.-]+\.cpolar\.(?:cn|top|io))\b"
)
# cpolar 本地状态页里的当前 PublicUrl
PUBLIC_URL_RE = re.compile(
    r'PublicUrl\\?":\\?"(https://[a-zA-Z0-9.-]+\.cpolar\.(?:cn|top|io))'
)

PID_DIR.mkdir(parents=True, exist_ok=True)
ENV = os.environ.copy()
ENV["PATH"] = "/usr/local/bin:/opt/homebrew/bin:" + ENV.get("PATH", "")
FONT = ("PingFang SC", 14)


def lan_ip() -> str:
    for cmd in (["ipconfig", "getifaddr", "en0"], ["ipconfig", "getifaddr", "en1"]):
        try:
            out = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL).strip()
            if out and not out.startswith("127."):
                return out
        except Exception:
            pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass
    return ""


def write_pid(name: str, pid: int) -> None:
    (PID_DIR / f"{name}.pid").write_text(str(pid), encoding="utf-8")


def read_pid(name: str) -> int:
    try:
        return int((PID_DIR / f"{name}.pid").read_text(encoding="utf-8").strip())
    except Exception:
        return 0


def pid_alive(pid: int) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def http_ok(url: str, timeout: float = 1.5) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return 200 <= getattr(r, "status", 200) < 500
    except Exception:
        return False


def app_healthy() -> bool:
    # 必须用 127.0.0.1，避免 localhost→IPv6 误判
    return http_ok("http://127.0.0.1:5173/") and http_ok("http://127.0.0.1:3001/api/health")


def kill_pid(pid: int) -> None:
    if not pid_alive(pid):
        return
    try:
        os.killpg(pid, signal.SIGTERM)
    except Exception:
        try:
            os.kill(pid, signal.SIGTERM)
        except Exception:
            pass


def kill_port(port: int) -> None:
    try:
        out = subprocess.check_output(["lsof", "-ti", f"tcp:{port}"], text=True).strip()
    except Exception:
        return
    for x in out.split():
        try:
            os.kill(int(x), signal.SIGTERM)
        except Exception:
            pass


def stop_cpolar_only() -> None:
    kill_pid(read_pid("cpolar"))
    for pat in (
        f"{CPOLAR} http 5173",
        f"{CPOLAR} http 127.0.0.1:5173",
        "cpolar http 5173",
        "cpolar http 127.0.0.1:5173",
    ):
        try:
            subprocess.run(
                ["pkill", "-f", pat],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            pass
    # 残留 master 进程会占 4040 并返回旧域名
    try:
        subprocess.run(
            ["pkill", "-x", "cpolar"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass
    for name in ("cpolar.pid", "url.txt"):
        try:
            (PID_DIR / name).unlink(missing_ok=True)
        except Exception:
            pass


def stop_local_server() -> None:
    kill_pid(read_pid("dev"))
    kill_port(5173)
    kill_port(3001)
    try:
        (PID_DIR / "dev.pid").unlink(missing_ok=True)
    except Exception:
        pass


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def normalize_tunnel_url(url: str) -> str:
    u = (url or "").strip().rstrip("\\").rstrip("/")
    if u.startswith("http://") and "cpolar." in u:
        u = "https://" + u[len("http://") :]
    return u


def url_from_this_session_log() -> str:
    """只读本次启动清空后的日志：取最后一条 Tunnel established 的 https。"""
    blob = read_text(CPOLAR_LOG) + "\n" + read_text(Path(str(CPOLAR_LOG) + ".stdout"))
    found = [normalize_tunnel_url(u) for u in ESTABLISHED_RE.findall(blob)]
    return found[-1] if found else ""


def url_from_cpolar_status() -> str:
    """读 cpolar 本地状态页当前 PublicUrl（本次进程）。"""
    try:
        with urllib.request.urlopen("http://127.0.0.1:4040/http/in", timeout=1.5) as r:
            html = r.read().decode("utf-8", errors="ignore")
    except Exception:
        return ""
    found = [normalize_tunnel_url(u) for u in PUBLIC_URL_RE.findall(html)]
    https = [u for u in found if u.startswith("https://")]
    return https[0] if https else (found[0] if found else "")


def current_tunnel_url() -> str:
    """
    第二步展示用：只取「这次」隧道地址，不查历史日志、不做网页校验。
    优先日志里 Tunnel established；否则用 4040 状态页。
    """
    return url_from_this_session_log() or url_from_cpolar_status()


def ensure_app(on_status) -> None:
    if app_healthy():
        on_status("本机服务已在运行")
        return

    on_status("正在启动本机项目…")
    for port in (5173, 3001):
        kill_port(port)
    time.sleep(0.5)

    logf = open(DEV_LOG, "w")
    child = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(PROJECT),
        env=ENV,
        stdout=logf,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    write_pid("dev", child.pid)

    for i in range(100):
        if app_healthy():
            on_status("本机服务已就绪")
            return
        front = "OK" if http_ok("http://127.0.0.1:5173/") else "等待"
        back = "OK" if http_ok("http://127.0.0.1:3001/api/health") else "等待"
        on_status(f"启动中 {i + 1}s | 前端:{front} | 后端:{back}")
        time.sleep(1)
    raise RuntimeError("本机启动超时：5173/3001 未同时就绪")


def start_tunnel(on_status) -> str:
    if not CPOLAR.exists():
        raise RuntimeError("找不到 cpolar：/Applications/cpolar")
    if not app_healthy():
        raise RuntimeError("本机服务未就绪，请先等本机/同Wi‑Fi链接可用")

    stop_cpolar_only()
    time.sleep(0.4)
    try:
        CPOLAR_LOG.write_text("", encoding="utf-8")
    except Exception:
        pass

    on_status("正在开通内网穿透…")
    out = open(str(CPOLAR_LOG) + ".stdout", "w")
    # 必须用 127.0.0.1：cpolar 默认 localhost 在 macOS 常走 IPv6，Vite 只听 IPv4 → 穿透打不开
    child = subprocess.Popen(
        [str(CPOLAR), "http", "127.0.0.1:5173", f"-log={CPOLAR_LOG}", "-log-level=INFO"],
        stdout=out,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    write_pid("cpolar", child.pid)

    for i in range(50):
        url = current_tunnel_url()
        if url:
            (PID_DIR / "url.txt").write_text(url + "\n", encoding="utf-8")
            on_status(f"穿透已建立\n{url}")
            return url
        on_status(f"等待 cpolar 分配链接… {i + 1}/50 秒")
        time.sleep(1)
    raise RuntimeError(
        "内网穿透超时：日志里未出现本次 Tunnel established 链接。\n"
        "可点「结束穿透」后再点「开启内网穿透」重试。"
    )


class ShareApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("lumi大法官")
        self.geometry("660x540")
        self.minsize(620, 500)
        self.resizable(False, False)

        self.phase = "loading"
        self._stopping = False
        self._busy = False
        self.local_url = ""
        self.lan_url = ""
        self.tunnel_url = ""

        pad = {"padx": 14, "pady": 4}

        self.btn_status = tk.Button(
            self,
            text="状态：加载中…正在启动本机服务",
            font=("PingFang SC", 16, "bold"),
            anchor="w",
            justify="left",
            padx=12,
            pady=10,
            command=lambda: None,
        )
        self.btn_status.pack(fill="x", **pad)

        self.btn_error = tk.Button(
            self,
            text="错误：无",
            font=("PingFang SC", 13),
            anchor="w",
            justify="left",
            padx=12,
            pady=8,
            command=lambda: None,
        )
        self.btn_error.pack(fill="x", **pad)

        self.btn_local = tk.Button(
            self,
            text="① 本机：等待服务启动…",
            font=FONT,
            anchor="w",
            padx=12,
            pady=10,
            command=lambda: self.use_url(self.local_url, "本机链接"),
        )
        self.btn_local.pack(fill="x", **pad)

        self.btn_lan = tk.Button(
            self,
            text="② 同WiFi：等待服务启动…",
            font=FONT,
            anchor="w",
            padx=12,
            pady=10,
            command=lambda: self.use_url(self.lan_url, "局域网链接"),
        )
        self.btn_lan.pack(fill="x", **pad)

        self.btn_tunnel = tk.Button(
            self,
            text="③ 穿透：尚未开启（先等本机就绪，再点下方开启）",
            font=FONT,
            anchor="w",
            padx=12,
            pady=10,
            command=lambda: self.use_url(self.tunnel_url, "穿透链接"),
        )
        self.btn_tunnel.pack(fill="x", **pad)

        tip = tk.Button(
            self,
            text="提示：点上面三条只复制链接，不会自动打开浏览器｜自行粘贴到浏览器即可",
            font=("PingFang SC", 12),
            anchor="w",
            padx=12,
            pady=6,
            command=lambda: None,
        )
        tip.pack(fill="x", **pad)

        row = tk.Frame(self)
        row.pack(fill="x", padx=14, pady=(10, 6))

        self.btn_start = tk.Button(
            row,
            text="开启内网穿透",
            font=("PingFang SC", 14, "bold"),
            pady=12,
            command=self.start_tunnel_clicked,
            state="disabled",
        )
        self.btn_start.pack(side="left", expand=True, fill="x", padx=(0, 4))

        self.btn_end = tk.Button(
            row,
            text="结束穿透",
            font=("PingFang SC", 14, "bold"),
            pady=12,
            command=self.end_tunnel_only,
        )
        self.btn_end.pack(side="left", expand=True, fill="x", padx=4)

        self.btn_exit = tk.Button(
            row,
            text="全部退出",
            font=("PingFang SC", 14, "bold"),
            pady=12,
            command=self.exit_all,
        )
        self.btn_exit.pack(side="left", expand=True, fill="x", padx=(4, 0))

        self.protocol("WM_DELETE_WINDOW", self.on_close)
        self.after(40, self._front)
        self.after(80, self.boot_local_only)

    def _front(self) -> None:
        try:
            self.lift()
            self.attributes("-topmost", True)
            self.after(400, lambda: self.attributes("-topmost", False))
            self.focus_force()
        except Exception:
            pass

    def ui(self, fn) -> None:
        self.after(0, fn)

    def set_status(self, text: str) -> None:
        def _():
            self.btn_status.configure(text=f"状态：{text}")
            self.title(f"lumi大法官 · {text[:24]}")

        self.ui(_)

    def set_error(self, text: str = "") -> None:
        self.ui(lambda: self.btn_error.configure(text=f"错误：{text}" if text else "错误：无"))

    def show_local_links(self) -> None:
        def _():
            # 关键用 127.0.0.1，不用 localhost（IPv6 问题）
            self.local_url = "http://127.0.0.1:5173"
            ip = lan_ip()
            self.lan_url = f"http://{ip}:5173" if ip else ""

            local_ok = http_ok(self.local_url)
            lan_ok = bool(self.lan_url) and http_ok(self.lan_url)

            self.btn_local.configure(
                text=f"① 本机：{self.local_url}  （{'可复制·点我' if local_ok else '检测失败'}）"
            )
            if self.lan_url:
                self.btn_lan.configure(
                    text=f"② 同WiFi：{self.lan_url}  （{'可复制·点我' if lan_ok else '本机可达，手机请同WiFi'}）"
                )
            else:
                self.btn_lan.configure(text="② 同WiFi：未检测到局域网IP")

            try:
                (PID_DIR / "local.txt").write_text(self.local_url, encoding="utf-8")
                if self.lan_url:
                    (PID_DIR / "lan.txt").write_text(self.lan_url, encoding="utf-8")
            except Exception:
                pass

        self.ui(_)

    def show_tunnel(self, url: str) -> None:
        def _():
            self.phase = "ready"
            self._busy = False
            self.tunnel_url = url
            self.btn_tunnel.configure(text=f"③ 穿透：{url}  （点我复制）")
            self.btn_status.configure(text="状态：穿透已开启 · 三种链接都可用")
            self.btn_error.configure(text="错误：无")
            self.btn_start.configure(state="normal")
            self.clipboard_clear()
            self.clipboard_append(url)
            self.update_idletasks()
            # 本机/局域网保持显示
            self.show_local_links()

        self.ui(_)

    def clear_tunnel_ui(self, msg: str = "已关闭") -> None:
        self.tunnel_url = ""
        self.btn_tunnel.configure(text=f"③ 穿透：{msg}  （可再点「开启内网穿透」）")

    def use_url(self, url: str, name: str) -> None:
        """只复制，不自动打开浏览器"""
        if not url:
            messagebox.showwarning("无法复制", f"{name}还没有生成。")
            return
        self.clipboard_clear()
        self.clipboard_append(url)
        self.update_idletasks()
        messagebox.showinfo("已复制", f"{name}\n{url}\n\n请自行粘贴到浏览器打开。")

    def boot_local_only(self) -> None:
        """只启动本机服务并展示本机/同Wi‑Fi；不自动开穿透"""

        def run():
            try:
                self.set_error("")
                self.set_status("加载中…正在启动本机服务")
                self.ui(lambda: self.btn_start.configure(state="disabled"))
                # 确保不会在启动阶段拉起穿透
                stop_cpolar_only()
                ensure_app(on_status=lambda s: self.set_status(s))
                if self._stopping:
                    return
                self.show_local_links()
                self.phase = "local_only"
                self.set_status("本机已就绪 · 可点「开启内网穿透」")
                self.ui(lambda: self.btn_start.configure(state="normal"))
            except Exception as e:
                if not self._stopping:
                    self.phase = "error"
                    self.set_status("本机启动失败")
                    self.set_error(f"{type(e).__name__} — {e}")
                    self.ui(lambda: self.btn_start.configure(state="disabled"))

        threading.Thread(target=run, daemon=True).start()

    def start_tunnel_clicked(self) -> None:
        if self._busy:
            return
        if self.phase not in ("local_only", "ready", "error"):
            messagebox.showwarning("请稍候", "请先等本机服务启动完成。")
            return
        if not app_healthy():
            messagebox.showwarning("本机未就绪", "请等本机服务启动完成，或关闭后重开本窗口。")
            return
        self._busy = True
        self._stopping = False
        self.btn_start.configure(state="disabled")
        self.set_error("")
        self.set_status("正在开启内网穿透…")
        self.btn_tunnel.configure(text="③ 穿透：开通中…")

        def run():
            try:
                self.show_local_links()
                url = start_tunnel(on_status=lambda s: self.set_status(s))
                if self._stopping:
                    stop_cpolar_only()
                    self.ui(lambda: self.btn_start.configure(state="normal"))
                    self._busy = False
                    return
                self.show_tunnel(url)
            except Exception as e:
                self._busy = False
                self.ui(lambda: self.btn_start.configure(state="normal"))
                self.clear_tunnel_ui("开启失败")
                self.set_status("穿透开启失败 · 本机链接仍可用")
                self.set_error(f"{type(e).__name__} — {e}")

        threading.Thread(target=run, daemon=True).start()

    def end_tunnel_only(self) -> None:
        self._stopping = True
        stop_cpolar_only()
        self._busy = False
        self.phase = "local_only"
        self.clear_tunnel_ui("已关闭")
        self.show_local_links()
        self.set_status("穿透已关闭 · 本机与局域网仍可用")
        self.btn_start.configure(state="normal")

    def exit_all(self) -> None:
        if not messagebox.askyesno(
            "全部退出",
            "将关闭：\n· 内网穿透\n· 本地服务器\n· 本窗口\n\n确定吗？",
        ):
            return
        self._stopping = True
        stop_cpolar_only()
        stop_local_server()
        self.destroy()

    def on_close(self) -> None:
        if self.tunnel_url:
            choice = messagebox.askyesnocancel(
                "关闭窗口",
                "选「是」= 只结束穿透\n选「否」= 全部退出\n选「取消」= 继续",
            )
            if choice is True:
                stop_cpolar_only()
                self.destroy()
            elif choice is False:
                stop_cpolar_only()
                stop_local_server()
                self.destroy()
            return
        self.destroy()


def main() -> None:
    ShareApp().mainloop()


if __name__ == "__main__":
    main()
