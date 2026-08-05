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
    socket = io(url, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
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
