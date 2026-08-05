import { io, Socket } from 'socket.io-client';
import type { ClientSnapshot, UserId } from '../../../shared/types';

const url = import.meta.env.VITE_SERVER_URL || undefined;

let socket: Socket | null = null;

/** HMR 时先断开旧连接，避免幽灵在线 */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
  });
}

export function getSocket() {
  if (!socket) {
    // 生产站（Vercel）不要连 Socket：没有本机 3001，会误导成「未连上服务器」
    const host =
      typeof window !== 'undefined' ? window.location.hostname : '';
    const isLocal =
      !host ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.local');
    socket = io(url, {
      transports: ['websocket', 'polling'],
      autoConnect: isLocal,
      reconnection: isLocal,
      reconnectionAttempts: 20,
      reconnectionDelay: 800,
    });
  }
  return socket;
}

export function emitAck<T = unknown>(
  event: string,
  payload?: unknown
): Promise<T> {
  const s = getSocket();
  return new Promise((resolve, reject) => {
    s.timeout(120000).emit(event, payload ?? {}, (err: Error | null, res: T) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

export type { ClientSnapshot, UserId };
