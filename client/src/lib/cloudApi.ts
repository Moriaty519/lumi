/** 树洞云端 HTTP API（Supabase） */

export type CloudRoom = {
  id: string;
  code: string;
  groupName: string;
  aiName?: string;
  aiRole?: string;
  completed?: boolean;
  reports?: {
    text?: string | null;
    generatedAt?: string | null;
    generating?: boolean;
  };
};

export type CloudJoinedRoom = {
  id: string;
  code: string;
  groupName: string;
  memberCount: number;
};

export type CloudChatMessage = {
  id: string;
  user: string;
  text: string;
  time: string;
  kind?: string;
  image?: string;
};

async function cloudFetch<T>(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    userId?: string | null;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.userId) headers['x-user-id'] = opts.userId;
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok || (data as { ok?: boolean }).ok === false) {
    throw new Error((data as { error?: string }).error || `请求失败 ${res.status}`);
  }
  return data;
}

export async function cloudStatus() {
  return cloudFetch<{ ok: boolean; supabase: boolean; mode: string }>(
    '/api/cloud/status'
  );
}

export async function cloudLogin(payload: { nickname?: string; userId?: string }) {
  return cloudFetch<{
    ok: boolean;
    userId: string;
    nickname: string;
    profile: unknown;
    joinedRooms: CloudJoinedRoom[];
  }>('/api/cloud/login', { method: 'POST', body: payload });
}

export async function cloudListRooms(userId: string) {
  return cloudFetch<{ ok: boolean; joinedRooms: CloudJoinedRoom[] }>(
    '/api/cloud/rooms',
    { userId }
  );
}

export async function cloudCreateRoom(
  userId: string,
  opts: { aiRole?: string } = {}
) {
  return cloudFetch<{
    ok: boolean;
    room: CloudRoom;
    joinedRooms: CloudJoinedRoom[];
  }>('/api/cloud/rooms/create', {
    method: 'POST',
    body: { aiRole: opts.aiRole || 'default' },
    userId,
  });
}

export async function cloudJoinRoom(
  userId: string,
  payload: { code?: string; roomId?: string }
) {
  return cloudFetch<{
    ok: boolean;
    room: CloudRoom;
    joinedRooms: CloudJoinedRoom[];
  }>('/api/cloud/rooms/join', { method: 'POST', body: payload, userId });
}

export async function cloudLeaveRoom(userId: string, roomId: string) {
  return cloudFetch<{ ok: boolean; joinedRooms: CloudJoinedRoom[] }>(
    '/api/cloud/rooms/leave',
    { method: 'POST', body: { roomId }, userId }
  );
}

export async function cloudPullMessages(userId: string, roomId: string) {
  return cloudFetch<{
    ok: boolean;
    room: CloudRoom;
    game: unknown;
    games: unknown[];
    members: {
      userId: string;
      nickname: string;
      profile: unknown;
    }[];
    courtMessages: CloudChatMessage[];
    privateMessages: CloudChatMessage[];
  }>(`/api/cloud/rooms/${roomId}/messages`, { userId });
}

export async function cloudGameInvite(
  userId: string,
  roomId: string,
  targetUserId: string
) {
  return cloudFetch<{ ok: boolean; game: unknown; games: unknown[] }>(
    `/api/cloud/rooms/${roomId}/game/invite`,
    { method: 'POST', body: { targetUserId }, userId }
  );
}

export async function cloudGameAccept(
  userId: string,
  roomId: string,
  gameId: string
) {
  return cloudFetch<{ ok: boolean; game: unknown; games: unknown[] }>(
    `/api/cloud/rooms/${roomId}/game/accept`,
    { method: 'POST', body: { gameId }, userId }
  );
}

export async function cloudGameDecline(
  userId: string,
  roomId: string,
  gameId: string
) {
  return cloudFetch<{ ok: boolean; game: null; games: unknown[] }>(
    `/api/cloud/rooms/${roomId}/game/decline`,
    { method: 'POST', body: { gameId }, userId }
  );
}

export async function cloudGameAnswer(
  userId: string,
  roomId: string,
  payload: { optionIndex: number; questionIndex?: number; gameId: string }
) {
  return cloudFetch<{ ok: boolean; game: unknown; games: unknown[] }>(
    `/api/cloud/rooms/${roomId}/game/answer`,
    { method: 'POST', body: payload, userId }
  );
}

export async function cloudSendMessage(
  userId: string,
  roomId: string,
  payload: { channel: 'court' | 'private'; text?: string; image?: string }
) {
  return cloudFetch<{
    ok: boolean;
    userMessage: CloudChatMessage;
    lumiMessage: CloudChatMessage | null;
  }>(`/api/cloud/rooms/${roomId}/messages`, {
    method: 'POST',
    body: payload,
    userId,
  });
}

export async function cloudUpdateProfile(userId: string, profile: unknown) {
  return cloudFetch<{ ok: boolean; profile: unknown }>('/api/cloud/profile', {
    method: 'POST',
    body: { profile },
    userId,
  });
}

export async function cloudSingleStart(userId: string, relationType: string) {
  return cloudFetch<{ ok: boolean; single: unknown }>(
    '/api/cloud/single/start',
    { method: 'POST', body: { relationType }, userId }
  );
}

export async function cloudSingleSend(
  userId: string,
  payload: { text?: string; image?: string }
) {
  return cloudFetch<{ ok: boolean; single: unknown }>(
    '/api/cloud/single/send',
    { method: 'POST', body: payload, userId }
  );
}

export async function cloudSingleEmotions(
  userId: string,
  emotions: { name: string; level: number }[]
) {
  return cloudFetch<{ ok: boolean; single: unknown }>(
    '/api/cloud/single/emotions',
    { method: 'POST', body: { emotions }, userId }
  );
}

export async function cloudSingleAssessment(
  userId: string,
  assessment: unknown
) {
  return cloudFetch<{ ok: boolean; single: unknown }>(
    '/api/cloud/single/assessment',
    { method: 'POST', body: { assessment }, userId }
  );
}

export async function cloudSingleExit(userId: string) {
  return cloudFetch<{ ok: boolean; single: null }>('/api/cloud/single/exit', {
    method: 'POST',
    body: {},
    userId,
  });
}

export async function cloudMouthpiece(
  userId: string,
  payload: { roomId?: string; wantToSay?: string; wantThemToDo?: string }
) {
  return cloudFetch<{ ok: boolean; polished: string }>('/api/cloud/mouthpiece', {
    method: 'POST',
    body: payload,
    userId,
  });
}

export async function cloudCompleteRoom(userId: string, roomId: string) {
  return cloudFetch<{
    ok: boolean;
    report?: string;
    generating?: boolean;
  }>(`/api/cloud/rooms/${roomId}/complete`, {
    method: 'POST',
    body: {},
    userId,
  });
}

export async function cloudGetReport(userId: string, roomId: string) {
  return cloudFetch<{
    ok: boolean;
    report?: string;
    generating?: boolean;
    completed?: boolean;
  }>(`/api/cloud/rooms/${roomId}/report`, {
    method: 'POST',
    body: {},
    userId,
  });
}

export async function cloudRoomEmotions(
  userId: string,
  roomId: string,
  emotions: { name: string; level: number }[]
) {
  return cloudFetch<{ ok: boolean }>(
    `/api/cloud/rooms/${roomId}/emotions`,
    { method: 'POST', body: { emotions }, userId }
  );
}

export async function cloudRoomAssessment(
  userId: string,
  roomId: string,
  assessment: unknown
) {
  return cloudFetch<{ ok: boolean }>(
    `/api/cloud/rooms/${roomId}/assessment`,
    { method: 'POST', body: { assessment }, userId }
  );
}

export async function cloudUpdateRoomMeta(
  userId: string,
  roomId: string,
  payload: { groupName?: string; aiName?: string; nickname?: string }
) {
  return cloudFetch<{
    ok: boolean;
    room: CloudRoom;
    nickname?: string;
  }>(`/api/cloud/rooms/${roomId}/meta`, {
    method: 'POST',
    body: payload,
    userId,
  });
}
