import { randomBytes, randomUUID } from 'crypto';
import { getSupabase } from './supabase.js';
import { emptyPersonProfile, type PersonProfile } from '../shared/profile.js';
import { formatBeijingClock } from '../shared/time.js';
import {
  GAME_QUESTION_COUNT,
  formatGameResultCourtMessage,
  gameLevelFromPercent,
  pickGameQuestionIds,
} from '../shared/game.js';
import { AI_ROLES, getAiRole, isAiRoleId, type AiRoleId } from '../shared/aiRoles.js';
import type {
  AssessmentResult,
  DualGame,
  EmotionMark,
  JoinedRoomSummary,
  RelationType,
  SingleCase,
  UserId,
} from '../shared/types.js';

function genRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[bytes[i]! % alphabet.length];
  return code;
}

function clockNow() {
  return formatBeijingClock();
}

export type CloudAccount = {
  id: string;
  nickname: string;
  profile: PersonProfile;
  createdAt: string;
};

export type CloudMessage = {
  id: string;
  roomId: string;
  channel: 'court' | 'private';
  sender: string;
  privateTo: string | null;
  text: string;
  kind: string;
  image?: string | null;
  createdAt: string;
  time: string;
};

function mapAccount(row: {
  id: string;
  nickname: string;
  profile: PersonProfile | null;
  created_at: string;
}): CloudAccount {
  const base = emptyPersonProfile(row.nickname);
  return {
    id: row.id,
    nickname: row.nickname,
    profile: { ...base, ...(row.profile || {}), displayName: row.profile?.displayName || row.nickname },
    createdAt: row.created_at,
  };
}

export async function loginOrCreateAccount(rawNickname: string): Promise<CloudAccount> {
  const nickname = rawNickname.trim().replace(/\s+/g, ' ').slice(0, 20);
  if (!nickname) throw new Error('请输入昵称');
  const db = getSupabase();

  const { data: existing, error: findErr } = await db
    .from('accounts')
    .select('*')
    .eq('nickname', nickname)
    .maybeSingle();
  if (findErr) throw new Error(findErr.message);
  if (existing) return mapAccount(existing);

  const profile = emptyPersonProfile(nickname);
  const { data, error } = await db
    .from('accounts')
    .insert({ nickname, profile })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapAccount(data);
}

export async function getAccount(userId: string): Promise<CloudAccount | null> {
  const db = getSupabase();
  const { data, error } = await db.from('accounts').select('*').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapAccount(data) : null;
}

export async function updateAccountProfile(
  userId: string,
  profile: PersonProfile
): Promise<PersonProfile> {
  const db = getSupabase();
  const { data, error } = await db
    .from('accounts')
    .update({ profile })
    .eq('id', userId)
    .select('profile, nickname')
    .single();
  if (error) throw new Error(error.message);
  return { ...emptyPersonProfile(data.nickname), ...data.profile };
}

export async function listJoinedRooms(userId: string): Promise<JoinedRoomSummary[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from('room_members')
    .select('room_id, rooms(id, code, group_name)')
    .eq('user_id', userId)
    .is('left_at', null)
    .order('joined_at', { ascending: false });
  if (error) throw new Error(error.message);

  const rooms = (data || [])
    .map((row) => {
      const r = row.rooms as unknown as
        | { id: string; code: string; group_name: string }
        | { id: string; code: string; group_name: string }[]
        | null;
      const room = Array.isArray(r) ? r[0] : r;
      if (!room) return null;
      return {
        id: room.id,
        code: room.code,
        groupName: room.group_name || '树洞',
        memberCount: 0,
      };
    })
    .filter(Boolean) as JoinedRoomSummary[];

  // 补人数
  for (const room of rooms) {
    const { count } = await db
      .from('room_members')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', room.id)
      .is('left_at', null);
    room.memberCount = count || 0;
  }
  return rooms;
}

async function ensureMember(roomId: string, userId: string, nickname: string) {
  const db = getSupabase();
  const { data: existing } = await db
    .from('room_members')
    .select('*')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    if (existing.left_at) {
      const { error } = await db
        .from('room_members')
        .update({ left_at: null, joined_at: new Date().toISOString() })
        .eq('room_id', roomId)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
    }
  } else {
    const { error } = await db.from('room_members').insert({
      room_id: roomId,
      user_id: userId,
      display_nickname: nickname,
    });
    if (error) throw new Error(error.message);
  }

  await db.from('room_user_state').upsert({
    room_id: roomId,
    user_id: userId,
    presence: 'court',
    updated_at: new Date().toISOString(),
  });
}

export async function createRoom(
  userId: string,
  opts: { aiRole?: string } = {}
) {
  const db = getSupabase();
  const account = await getAccount(userId);
  if (!account) throw new Error('账号不存在');

  const role = getAiRole(isAiRoleId(opts.aiRole) ? opts.aiRole : 'default');

  let code = genRoomCode();
  for (let i = 0; i < 8; i++) {
    const { data: clash } = await db.from('rooms').select('id').eq('code', code).maybeSingle();
    if (!clash) break;
    code = genRoomCode();
  }

  const baseRow = {
    code,
    group_name: '树洞',
    ai_name: role.displayName,
    ai_role: role.id,
  };

  let room: Awaited<ReturnType<typeof getRoom>>;
  {
    const { data, error } = await db.from('rooms').insert(baseRow).select('*').single();
    if (error) {
      // 未执行 schema_ai_role.sql 时降级：不写 ai_role
      if (/ai_role|PGRST204/i.test(error.message) || error.code === 'PGRST204') {
        const { data: d2, error: e2 } = await db
          .from('rooms')
          .insert({
            code,
            group_name: '树洞',
            ai_name: role.displayName,
          })
          .select('*')
          .single();
        if (e2) throw new Error(e2.message);
        room = d2;
      } else {
        throw new Error(error.message);
      }
    } else {
      room = data;
    }
  }
  if (!room) throw new Error('创建房间失败');

  // 无 ai_role 列时，把角色记在 reports 里供后续对话使用
  if (!room.ai_role) {
    const reports = {
      ...((room.reports as Record<string, unknown> | null) || {}),
      aiRole: role.id,
    };
    await db.from('rooms').update({ reports }).eq('id', room.id);
    room = { ...room, ai_role: role.id, reports };
  }

  await ensureMember(room.id, userId, account.nickname);

  const who = role.displayName;
  await insertMessage({
    roomId: room.id,
    channel: 'court',
    sender: 'lumi',
    text: [
      `欢迎来到树洞～我是 ${who}。`,
      role.id === 'default'
        ? '这里是树洞留言板：你留言后我会回复，其他人打开时再刷新查看。'
        : `当前角色：${role.label}。这里是树洞留言板：你留言后我会回复，其他人打开时再刷新查看。`,
      `房间码：${room.code}（可分享给朋友一起加入）`,
      '点我的头像可以进入私聊。',
    ].join('\n'),
    kind: 'chat',
  });

  await insertMessage({
    roomId: room.id,
    channel: 'private',
    sender: 'lumi',
    privateTo: userId,
    text: `我是 ${who}，这里是你的私密空间，其他人看不到。想到什么说什么就行。`,
    kind: 'chat',
  });

  return room;
}

export async function joinRoomByCode(userId: string, rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  if (!code) throw new Error('请输入房间码');
  const db = getSupabase();
  const account = await getAccount(userId);
  if (!account) throw new Error('账号不存在');

  const { data: room, error } = await db.from('rooms').select('*').eq('code', code).maybeSingle();
  if (error) throw new Error(error.message);
  if (!room) throw new Error('房间码无效');

  await ensureMember(room.id, userId, account.nickname);

  // 若无私聊欢迎则补一条
  const { count } = await db
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', room.id)
    .eq('channel', 'private')
    .eq('private_to', userId);
  if (!count) {
    await insertMessage({
      roomId: room.id,
      channel: 'private',
      sender: 'lumi',
      privateTo: userId,
      text: '我是 Lumi，这里是你的私密空间，其他人看不到。想到什么说什么就行。',
      kind: 'chat',
    });
  }

  return room;
}

export async function joinRoomById(userId: string, roomId: string) {
  const db = getSupabase();
  const account = await getAccount(userId);
  if (!account) throw new Error('账号不存在');
  const { data: room, error } = await db.from('rooms').select('*').eq('id', roomId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!room) throw new Error('房间不存在');
  await ensureMember(room.id, userId, account.nickname);
  return room;
}

export async function leaveRoom(userId: string, roomId: string) {
  const db = getSupabase();
  const { error } = await db
    .from('room_members')
    .update({ left_at: new Date().toISOString() })
    .eq('room_id', roomId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

export async function getRoom(roomId: string) {
  const db = getSupabase();
  const { data, error } = await db.from('rooms').select('*').eq('id', roomId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** 房间所选 Lumi 角色（兼容未加 ai_role 列、写在 reports 里的情况） */
export function resolveRoomAiRole(room: {
  ai_role?: string | null;
  ai_name?: string | null;
  reports?: Record<string, unknown> | null;
} | null): AiRoleId {
  if (!room) return 'default';
  if (isAiRoleId(room.ai_role)) return room.ai_role;
  const fromReports = room.reports?.aiRole;
  if (isAiRoleId(fromReports)) return fromReports;
  const byName = AI_ROLES.find((r) => r.displayName === room.ai_name);
  return byName?.id || 'default';
}

export async function listRoomMembers(roomId: string) {
  const db = getSupabase();
  const { data, error } = await db
    .from('room_members')
    .select('user_id, display_nickname, accounts(id, nickname, profile)')
    .eq('room_id', roomId)
    .is('left_at', null);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function insertMessage(input: {
  roomId: string;
  channel: 'court' | 'private';
  sender: string;
  text: string;
  kind?: string;
  image?: string;
  privateTo?: string | null;
}): Promise<CloudMessage> {
  if (input.channel === 'private' && !input.privateTo && input.sender !== 'lumi' && input.sender !== 'system') {
    // private user messages must have private_to = self; caller should set
  }
  const db = getSupabase();
  const row = {
    id: randomUUID(),
    room_id: input.roomId,
    channel: input.channel,
    sender: input.sender,
    private_to: input.privateTo ?? null,
    text: input.text || '',
    kind: input.kind || 'chat',
    image: input.image || null,
  };
  const { data, error } = await db.from('messages').insert(row).select('*').single();
  if (error) throw new Error(error.message);
  return {
    id: data.id,
    roomId: data.room_id,
    channel: data.channel,
    sender: data.sender,
    privateTo: data.private_to,
    text: data.text,
    kind: data.kind,
    image: data.image,
    createdAt: data.created_at,
    time: clockNow(),
  };
}

/** 拉取树洞：公开群聊全量 + 当前用户私聊 */
export async function pullMessages(roomId: string, userId: string) {
  const db = getSupabase();

  const { data: court, error: cErr } = await db
    .from('messages')
    .select('*')
    .eq('room_id', roomId)
    .eq('channel', 'court')
    .order('created_at', { ascending: true });
  if (cErr) throw new Error(cErr.message);

  const { data: priv, error: pErr } = await db
    .from('messages')
    .select('*')
    .eq('room_id', roomId)
    .eq('channel', 'private')
    .eq('private_to', userId)
    .order('created_at', { ascending: true });
  if (pErr) throw new Error(pErr.message);

  const map = (m: {
    id: string;
    room_id: string;
    channel: 'court' | 'private';
    sender: string;
    private_to: string | null;
    text: string;
    kind: string;
    image: string | null;
    created_at: string;
  }): CloudMessage => ({
    id: m.id,
    roomId: m.room_id,
    channel: m.channel,
    sender: m.sender,
    privateTo: m.private_to,
    text: m.text,
    kind: m.kind,
    image: m.image,
    createdAt: m.created_at,
    time: formatBeijingClock(new Date(m.created_at)),
  });

  return {
    court: (court || []).map(map),
    private: (priv || []).map(map),
  };
}

function emptyGameAnswers(
  playerIds: [UserId, UserId],
  count = GAME_QUESTION_COUNT
): Record<string, (number | null)[]> {
  return {
    [playerIds[0]]: Array.from({ length: count }, () => null),
    [playerIds[1]]: Array.from({ length: count }, () => null),
  };
}

function samePair(a: [UserId, UserId], b: [UserId, UserId]) {
  return (
    (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0])
  );
}

function normalizeGamesList(input: {
  games?: DualGame[] | null;
  game?: DualGame | null;
}): DualGame[] {
  let list: DualGame[] = Array.isArray(input.games) ? [...input.games] : [];
  if (list.length === 0 && input.game && input.game.phase !== 'result') {
    list = [{ ...input.game, id: input.game.id || randomUUID() }];
  }
  return list
    .filter((g) => g && g.phase !== 'result')
    .map((g) => ({ ...g, id: g.id || randomUUID() }));
}

export async function memberNickname(roomId: string, userId: string): Promise<string> {
  const members = await listRoomMembers(roomId);
  const m = members.find((x) => x.user_id === userId);
  if (!m) return '用户';
  const acc = m.accounts as unknown as
    | { nickname?: string }
    | { nickname?: string }[]
    | null;
  const a = Array.isArray(acc) ? acc[0] : acc;
  return m.display_nickname || a?.nickname || '用户';
}

export async function assertActiveMember(roomId: string, userId: string) {
  const members = await listRoomMembers(roomId);
  if (!members.some((m) => m.user_id === userId)) {
    throw new Error('你不在本房间');
  }
  return members.map((m) => m.user_id as UserId);
}

async function readRoomGames(roomId: string): Promise<{
  completed: boolean;
  games: DualGame[];
  reports: Record<string, unknown>;
}> {
  const room = await getRoom(roomId);
  if (!room) throw new Error('房间不存在');
  const reports = (room.reports || {
    text: null,
    generatedAt: null,
  }) as Record<string, unknown> & {
    game?: DualGame | null;
    games?: DualGame[] | null;
  };
  const fromCol = room.game as DualGame | DualGame[] | null | undefined;
  const games = normalizeGamesList({
    games:
      reports.games ||
      (Array.isArray(fromCol) ? fromCol : undefined) ||
      undefined,
    game:
      (!Array.isArray(fromCol) ? fromCol : null) ||
      reports.game ||
      null,
  });
  return {
    completed: Boolean(room.completed),
    games,
    reports,
  };
}

async function writeRoomGames(roomId: string, games: DualGame[]) {
  const db = getSupabase();
  const room = await getRoom(roomId);
  if (!room) throw new Error('房间不存在');
  const prev = (room.reports || {
    text: null,
    generatedAt: null,
  }) as Record<string, unknown>;
  const active = normalizeGamesList({ games });
  const reports = {
    ...prev,
    games: active,
    game: active[0] || null,
  };

  const { error: repErr } = await db
    .from('rooms')
    .update({ reports })
    .eq('id', roomId);
  if (repErr) throw new Error(repErr.message);

  const { error: gameErr } = await db
    .from('rooms')
    .update({ game: active[0] || null })
    .eq('id', roomId);
  if (
    gameErr &&
    !/column .*game/i.test(gameErr.message) &&
    gameErr.code !== 'PGRST204'
  ) {
    throw new Error(gameErr.message);
  }
}

function pickGame(
  games: DualGame[],
  userId: UserId,
  gameId?: string
): DualGame {
  if (gameId) {
    const g = games.find((x) => x.id === gameId);
    if (!g) throw new Error('找不到该局游戏');
    return g;
  }
  const mine = games.filter((x) => x.playerIds.includes(userId));
  if (mine.length === 0) throw new Error('当前没有进行中的游戏');
  if (mine.length > 1) throw new Error('请指定游戏局');
  return mine[0]!;
}

/** 发起默契小游戏（云端；同房可多局） */
export async function inviteGame(
  roomId: string,
  userId: UserId,
  targetUserId: UserId
): Promise<DualGame> {
  const memberIds = await assertActiveMember(roomId, userId);
  const { completed, games } = await readRoomGames(roomId);
  if (completed) throw new Error('本轮已结束');
  if (!targetUserId || targetUserId === userId) {
    throw new Error('请选择要邀请的用户');
  }
  if (!memberIds.includes(targetUserId)) {
    throw new Error('对方不在本房间');
  }
  const playerIds: [UserId, UserId] = [userId, targetUserId];
  if (games.some((g) => samePair(g.playerIds, playerIds))) {
    throw new Error('你们已有进行中的默契小游戏');
  }
  const questionIds = pickGameQuestionIds(GAME_QUESTION_COUNT);
  const game: DualGame = {
    id: randomUUID(),
    phase: 'playing',
    startedBy: userId,
    accepted: { [userId]: true, [targetUserId]: false },
    questionIds,
    currentQuestion: 0,
    answers: emptyGameAnswers(playerIds, questionIds.length),
    score: 0,
    playerIds,
  };
  await writeRoomGames(roomId, [...games, game]);
  const nameA = await memberNickname(roomId, userId);
  const nameB = await memberNickname(roomId, targetUserId);
  await insertMessage({
    roomId,
    channel: 'court',
    sender: 'system',
    text: `${nameA}向${nameB}发起了默契小游戏`,
    kind: 'system',
  });
  return game;
}

export async function acceptGame(
  roomId: string,
  userId: UserId,
  gameId?: string
): Promise<DualGame> {
  await assertActiveMember(roomId, userId);
  const { games } = await readRoomGames(roomId);
  const g = pickGame(games, userId, gameId);
  if (g.phase !== 'invite' && g.phase !== 'playing') {
    throw new Error('当前没有进行中的游戏');
  }
  if (!g.playerIds.includes(userId)) throw new Error('你不在本局游戏中');
  if (g.startedBy === userId) throw new Error('发起方无需再接受');
  g.accepted[userId] = true;
  if (g.phase === 'invite') g.phase = 'playing';
  await writeRoomGames(
    roomId,
    games.map((x) => (x.id === g.id ? g : x))
  );
  return g;
}

export async function declineGame(
  roomId: string,
  userId: UserId,
  gameId?: string
): Promise<null> {
  await assertActiveMember(roomId, userId);
  const { games } = await readRoomGames(roomId);
  const g = pickGame(games, userId, gameId);
  if (!g.playerIds.includes(userId)) throw new Error('你不在本局游戏中');
  const name = await memberNickname(roomId, userId);
  const wasStarter = g.startedBy === userId;
  await writeRoomGames(
    roomId,
    games.filter((x) => x.id !== g.id)
  );
  await insertMessage({
    roomId,
    channel: 'court',
    sender: 'system',
    text: wasStarter ? `${name}取消了默契小游戏` : `${name}婉拒了默契小游戏`,
    kind: 'system',
  });
  return null;
}

export async function answerGame(
  roomId: string,
  userId: UserId,
  optionIndex: number,
  questionIndex?: number,
  gameId?: string
): Promise<DualGame> {
  await assertActiveMember(roomId, userId);
  const { games } = await readRoomGames(roomId);
  const g = pickGame(games, userId, gameId);
  if (g.phase !== 'playing') throw new Error('游戏未在进行中');
  if (!g.playerIds.includes(userId)) throw new Error('你不在本局游戏中');
  if (g.startedBy !== userId && !g.accepted[userId]) {
    throw new Error('请先接受邀请');
  }
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3) {
    throw new Error('无效选项');
  }
  const total = g.questionIds?.length || GAME_QUESTION_COUNT;
  if (!g.answers[userId]) {
    g.answers[userId] = Array.from({ length: total }, () => null);
  }
  const qi =
    typeof questionIndex === 'number'
      ? questionIndex
      : g.answers[userId].findIndex((a) => a == null);
  if (qi < 0 || qi >= total) throw new Error('题目已结束');
  if (g.answers[userId][qi] != null) throw new Error('本题已作答');

  g.answers[userId][qi] = optionIndex;

  const [a, b] = g.playerIds;
  const answersA = g.answers[a] || [];
  const answersB = g.answers[b] || [];
  const doneA = answersA.length >= total && answersA.every((x) => x != null);
  const doneB = answersB.length >= total && answersB.every((x) => x != null);

  if (doneA && doneB) {
    let score = 0;
    for (let i = 0; i < total; i++) {
      if (answersA[i] === answersB[i]) score += 1;
    }
    const percent = Math.round((score / total) * 100);
    const { level, comment } = gameLevelFromPercent(percent);
    g.score = score;
    g.phase = 'result';
    g.percent = percent;
    g.level = level;
    g.comment = comment;
    const nameA = await memberNickname(roomId, a);
    const nameB = await memberNickname(roomId, b);
    await insertMessage({
      roomId,
      channel: 'court',
      sender: 'lumi',
      text: formatGameResultCourtMessage({
        nameA,
        nameB,
        questionIds: g.questionIds || [],
        answersA,
        answersB,
        score,
        percent,
        level,
        comment,
      }),
      kind: 'chat',
    });
    await writeRoomGames(
      roomId,
      games.filter((x) => x.id !== g.id)
    );
  } else {
    await writeRoomGames(
      roomId,
      games.map((x) => (x.id === g.id ? g : x))
    );
  }
  return g;
}

export async function closeGame(
  roomId: string,
  userId: UserId,
  gameId?: string
): Promise<null> {
  await assertActiveMember(roomId, userId);
  const { games } = await readRoomGames(roomId);
  await writeRoomGames(
    roomId,
    gameId ? games.filter((x) => x.id !== gameId) : []
  );
  return null;
}

export async function restartGame(
  roomId: string,
  userId: UserId,
  gameId?: string
): Promise<DualGame> {
  const { completed, games } = await readRoomGames(roomId);
  if (completed) throw new Error('本轮已结束');
  const memberIds = await assertActiveMember(roomId, userId);
  let target: UserId | undefined;
  try {
    const prev = pickGame(games, userId, gameId);
    target = prev.playerIds.find((id) => id !== userId);
    await declineGame(roomId, userId, prev.id);
  } catch {
    target = memberIds.find((id) => id !== userId);
  }
  if (!target) throw new Error('请选择要邀请的用户');
  return inviteGame(roomId, userId, target);
}

export async function listActiveGames(roomId: string): Promise<DualGame[]> {
  const { games } = await readRoomGames(roomId);
  return games;
}

// ─── 单人模式（Supabase）──────────────────────────────────

type SingleRow = {
  user_id: string;
  id: string;
  relation_type: string;
  messages: ChatMessageLike[];
  emotions: EmotionMark[];
  assessment: AssessmentResult | null;
  created_at: string;
  updated_at: string;
};

type ChatMessageLike = {
  id: string;
  user: string;
  text: string;
  time: string;
  kind?: string;
  image?: string;
};

function mapSingle(row: SingleRow): SingleCase {
  return {
    id: row.id,
    playMode: 'single',
    userId: row.user_id,
    relationType: row.relation_type as RelationType,
    createdAt: row.created_at,
    messages: (Array.isArray(row.messages) ? row.messages : []).map((m) => ({
      id: m.id,
      user: m.user,
      text: m.text,
      time: m.time,
      kind: (m.kind as 'chat' | 'system' | 'opening' | undefined) || 'chat',
      ...(m.image ? { image: m.image } : {}),
    })),
    emotions: Array.isArray(row.emotions) ? row.emotions : [],
    assessment: row.assessment || null,
  };
}

function singleWelcomeMsg(): ChatMessageLike {
  return {
    id: randomUUID(),
    user: 'lumi',
    text: '我是 Lumi。这里只有你和我。想到什么就说，也可以先标记情绪或做关系速测。',
    time: clockNow(),
    kind: 'chat',
  };
}

export async function getSingleSession(userId: string): Promise<SingleCase | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from('single_sessions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    if (/single_sessions/i.test(error.message) || error.code === 'PGRST205') {
      throw new Error(
        '数据库缺少 single_sessions：请在 Supabase SQL Editor 执行 supabase/schema_single.sql'
      );
    }
    throw new Error(error.message);
  }
  return data ? mapSingle(data as SingleRow) : null;
}

export async function startSingleSession(
  userId: string,
  relationType: RelationType
): Promise<SingleCase> {
  const existing = await getSingleSession(userId);
  if (existing && existing.relationType === relationType) return existing;

  const db = getSupabase();
  const id = randomUUID();
  const row = {
    user_id: userId,
    id,
    relation_type: relationType,
    messages: [singleWelcomeMsg()],
    emotions: [],
    assessment: null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db
    .from('single_sessions')
    .upsert(row, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapSingle(data as SingleRow);
}

export async function appendSingleMessage(
  userId: string,
  from: string,
  text: string,
  image?: string
): Promise<SingleCase> {
  const s = await getSingleSession(userId);
  if (!s) throw new Error('请先选择关系类型');
  const next = {
    id: randomUUID(),
    user: from,
    text: text || (image ? '[图片]' : ''),
    time: clockNow(),
    kind: 'chat',
    ...(image ? { image } : {}),
  };
  const messages = [...s.messages, next];
  const db = getSupabase();
  const { data, error } = await db
    .from('single_sessions')
    .update({ messages, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapSingle(data as SingleRow);
}

export async function setSingleEmotions(
  userId: string,
  emotions: EmotionMark[]
): Promise<SingleCase> {
  const s = await getSingleSession(userId);
  if (!s) throw new Error('请先选择关系类型');
  const db = getSupabase();
  const { data, error } = await db
    .from('single_sessions')
    .update({ emotions, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapSingle(data as SingleRow);
}

export async function setSingleAssessment(
  userId: string,
  assessment: AssessmentResult
): Promise<SingleCase> {
  const s = await getSingleSession(userId);
  if (!s) throw new Error('请先选择关系类型');
  const db = getSupabase();
  const { data, error } = await db
    .from('single_sessions')
    .update({ assessment, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapSingle(data as SingleRow);
}

export async function clearSingleSession(userId: string): Promise<null> {
  const db = getSupabase();
  const { error } = await db.from('single_sessions').delete().eq('user_id', userId);
  if (error) throw new Error(error.message);
  return null;
}

export async function recentCourtForAi(roomId: string, limit = 20) {
  const db = getSupabase();
  const { data, error } = await db
    .from('messages')
    .select('sender, text, kind')
    .eq('room_id', roomId)
    .eq('channel', 'court')
    .neq('kind', 'system')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data || []).reverse();
}

export async function recentPrivateForAi(roomId: string, userId: string, limit = 12) {
  const db = getSupabase();
  const { data, error } = await db
    .from('messages')
    .select('sender, text')
    .eq('room_id', roomId)
    .eq('channel', 'private')
    .eq('private_to', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data || []).reverse();
}

export type RoomUserStateRow = {
  user_id: string;
  emotions: EmotionMark[];
  assessment: AssessmentResult | null;
};

export async function listRoomUserStates(roomId: string): Promise<RoomUserStateRow[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from('room_user_state')
    .select('user_id, emotions, assessment')
    .eq('room_id', roomId);
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    user_id: row.user_id,
    emotions: Array.isArray(row.emotions) ? (row.emotions as EmotionMark[]) : [],
    assessment: (row.assessment as AssessmentResult | null) || null,
  }));
}

export async function setRoomEmotions(
  roomId: string,
  userId: string,
  emotions: EmotionMark[]
) {
  await assertActiveMember(roomId, userId);
  const db = getSupabase();
  const { error } = await db.from('room_user_state').upsert({
    room_id: roomId,
    user_id: userId,
    emotions,
    presence: 'court',
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function setRoomAssessment(
  roomId: string,
  userId: string,
  assessment: AssessmentResult
) {
  await assertActiveMember(roomId, userId);
  const db = getSupabase();
  const { error } = await db.from('room_user_state').upsert({
    room_id: roomId,
    user_id: userId,
    assessment,
    presence: 'court',
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export type RoomReports = {
  text: string | null;
  generatedAt: string | null;
  generating?: boolean;
  aiRole?: string;
  games?: DualGame[];
  game?: DualGame | null;
};

export function readReports(room: {
  reports?: Record<string, unknown> | null;
}): RoomReports {
  const r = (room.reports || {}) as RoomReports;
  return {
    text: typeof r.text === 'string' ? r.text : null,
    generatedAt: typeof r.generatedAt === 'string' ? r.generatedAt : null,
    generating: Boolean(r.generating),
    aiRole: typeof r.aiRole === 'string' ? r.aiRole : undefined,
    games: Array.isArray(r.games) ? r.games : undefined,
    game: (r.game as DualGame | null | undefined) || null,
  };
}

export async function markRoomCompleted(roomId: string, userId: string) {
  await assertActiveMember(roomId, userId);
  const db = getSupabase();
  const room = await getRoom(roomId);
  if (!room) throw new Error('房间不存在');
  if (room.completed) return room;

  const name = await memberNickname(roomId, userId);
  const { error } = await db
    .from('rooms')
    .update({ completed: true })
    .eq('id', roomId);
  if (error) throw new Error(error.message);

  await insertMessage({
    roomId,
    channel: 'court',
    sender: 'system',
    text: `${name}生成了结案报告`,
    kind: 'system',
  });
  return getRoom(roomId);
}

export async function saveRoomReport(
  roomId: string,
  patch: Partial<RoomReports> & Record<string, unknown>
) {
  const db = getSupabase();
  const room = await getRoom(roomId);
  if (!room) throw new Error('房间不存在');
  const prev = (room.reports || {}) as Record<string, unknown>;
  const reports = { ...prev, ...patch };
  const { error } = await db.from('rooms').update({ reports }).eq('id', roomId);
  if (error) throw new Error(error.message);
  return reports as RoomReports;
}

export async function privateLinesForAi(
  roomId: string,
  userId: string,
  limit = 40
): Promise<string> {
  const rows = await recentPrivateForAi(roomId, userId, limit);
  if (!rows.length) return '（暂无私聊）';
  const me = await memberNickname(roomId, userId);
  return rows
    .map((m) => `${m.sender === 'lumi' ? 'Lumi' : me}: ${m.text}`)
    .join('\n');
}
