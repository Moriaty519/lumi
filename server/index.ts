import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import './loadEnv.js';
import { chatLumi } from './ai.js';
import {
  addPersonalSingleMessage,
  allActiveStores,
  clearPersonalSingle,
  emptySnapshot,
  ensurePersonalSingle,
  getPersonalSingle,
  roomManager,
  userRegistry,
  type Store,
} from './store.js';
import { mountCloudHttpApi } from './httpCloud.js';
import { isSupabaseConfigured, supabaseConfigDebug } from './supabase.js';
import {
  RELATION_TYPES,
  type ChatMessage,
  type JudgeRecord,
  type JudgeRecordMessage,
  type RelationType,
  type UserId,
} from '../shared/types.js';
import { formatAssessmentSummary } from '../shared/quiz.js';
import { formatBeijingDateTime } from '../shared/time.js';
import type { PersonProfile } from '../shared/profile.js';

function roomAiRole(store: { dual?: { aiRole?: string } | null }) {
  return store.dual?.aiRole || 'default';
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
const isProd = process.env.NODE_ENV === 'production';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '8mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasKey: Boolean(
      process.env.DEEPSEEK_API_KEY && !process.env.DEEPSEEK_API_KEY.includes('your-key')
    ),
    supabase: isSupabaseConfigured(),
    supabaseDebug: supabaseConfigDebug(),
  });
});

mountCloudHttpApi(app);

app.get('/api/debug/online', (_req, res) => {
  const alive = (sid: string) => io.sockets.sockets.has(sid);
  for (const s of allActiveStores()) s.pruneAndRefreshOnline(alive);
  res.json({
    rooms: allActiveStores().map((s) => ({
      id: s.roomId,
      code: s.code,
      memberIds: s.memberIds,
      online: s.online,
      sockets: s.sockets,
    })),
    users: userRegistry.users.size,
    now: Date.now(),
  });
});

if (isProd) {
  const dist = path.join(__dirname, '../client-dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
  maxHttpBufferSize: 8e6,
  pingInterval: 10000,
  pingTimeout: 8000,
});

function isAlive(sid: string) {
  return io.sockets.sockets.has(sid);
}

function roomChannel(roomId: string) {
  return `room:${roomId}`;
}

function broadcast(roomId?: string | null) {
  const stores = roomId
    ? ([roomManager.get(roomId)].filter(Boolean) as Store[])
    : allActiveStores();

  for (const s of stores) {
    s.pruneAndRefreshOnline(isAlive);
    s.persist();
  }

  for (const [, sock] of io.sockets.sockets) {
    const uid = sock.data.userId as UserId | undefined;
    const rid = sock.data.roomId as string | undefined;
    if (!uid) {
      sock.emit('state', emptySnapshot());
      continue;
    }
    if (roomId && rid !== roomId) continue;
    const store = rid ? roomManager.get(rid) : null;
    if (!store) {
      sock.emit('state', {
        ...emptySnapshot(),
        account: userRegistry.accountSummary(uid),
        room: null,
      });
      continue;
    }
    sock.emit('state', store.snapshot(uid));
  }
}

function pushAccountState(sock: {
  data: { userId?: UserId; roomId?: string };
  emit: (ev: string, data: unknown) => void;
}) {
  const uid = sock.data.userId;
  if (!uid) {
    sock.emit('state', emptySnapshot());
    return;
  }
  const rid = sock.data.roomId;
  const store = rid ? roomManager.get(rid) : null;
  if (store) {
    sock.emit('state', store.snapshot(uid));
  } else {
    const acc = userRegistry.get(uid);
    sock.emit('state', {
      ...emptySnapshot(),
      account: userRegistry.accountSummary(uid),
      profiles: acc ? { [uid]: { ...acc.profile } } : {},
      single: { [uid]: getPersonalSingle(uid) },
    });
  }
}

/** 把含单人会话的最新状态推给指定用户的所有连接 */
function pushUserState(uid: UserId) {
  for (const [, sock] of io.sockets.sockets) {
    if (sock.data.userId !== uid) continue;
    pushAccountState(sock);
  }
}

function displayUsers(store: Store) {
  return store.displayUsers();
}

function nameOf(store: Store, uid: UserId) {
  return displayUsers(store)[uid]?.name || userRegistry.displayName(uid);
}

function otherId(store: Store, userId: UserId): UserId | null {
  return store.otherHuman(userId);
}

function fmtEmotions(list: { name: string; level: number }[]) {
  if (!list?.length) return '（未标记）';
  return list.map((e) => `${e.name}(${e.level})`).join('、');
}

function toRecordMsgs(list: ChatMessage[]): JudgeRecordMessage[] {
  return list.map((m) => ({
    user: m.user,
    text: m.text,
    time: m.time,
    kind: m.kind,
  }));
}

function privateChatForRecord(store: Store, uid: UserId) {
  return (store.dual?.privateMessages[uid] || []).filter(
    (m) => m.kind !== 'system' && (m.user === uid || m.user === 'lumi')
  );
}

function archiveDualCase(
  store: Store,
  source: 'exit' | 'complete',
  byUser?: UserId
): boolean {
  const c = store.dual;
  if (!c) return false;
  if (store.isCaseArchived(c.id)) return false;

  const members = c.memberIds?.length ? c.memberIds : store.memberIds;
  const users = displayUsers(store);
  const court = c.courtMessages;
  const courtNonSystem = court.filter((m) => m.kind !== 'system');

  const privateMessagesByUser: Record<string, JudgeRecordMessage[]> = {};
  const emotionsByUser: Record<string, { name: string; level: number }[]> = {};
  const assessmentByUser: Record<string, string | undefined> = {};
  const memberNames: Record<string, string> = {};
  let speakTotal = 0;

  for (const uid of members) {
    const priv = privateChatForRecord(store, uid);
    privateMessagesByUser[uid] = toRecordMsgs(priv);
    emotionsByUser[uid] = c.emotions[uid] || [];
    const a = c.assessments[uid];
    assessmentByUser[uid] = a?.attachSelf?.label || a?.level || undefined;
    memberNames[uid] = users[uid]?.name || userRegistry.displayName(uid);
    speakTotal +=
      priv.filter((m) => m.user === uid).length +
      courtNonSystem.filter((m) => m.user === uid).length;
  }

  const names = members.map((id) => memberNames[id]).join(' & ');
  const summary = [
    source === 'complete' ? '完成调解' : '退出保存',
    `群聊 ${courtNonSystem.length} 条`,
    `发言合计 ${speakTotal}`,
    c.reports?.text ? '含调解报告' : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const viewer = byUser || members[0];
  const rec: JudgeRecord = {
    id: `${Date.now()}-${source}-dual`,
    mode: 'dual',
    title: '双人 · 树洞',
    savedAt: formatBeijingDateTime(),
    summary,
    shared: true,
    ownerId: byUser,
    ownerName: byUser ? memberNames[byUser] : undefined,
    caseId: c.id,
    source,
    emotions: viewer ? emotionsByUser[viewer] || [] : [],
    emotionsOther: members
      .filter((id) => id !== viewer)
      .flatMap((id) => emotionsByUser[id] || []),
    emotionsByUser,
    otherName: members
      .filter((id) => id !== viewer)
      .map((id) => memberNames[id])
      .join('、'),
    assessmentLabel: viewer ? assessmentByUser[viewer] : undefined,
    assessmentByUser,
    privateCount: speakTotal,
    courtCount: courtNonSystem.length,
    privateMessagesByUser,
    privateMessages: viewer ? privateMessagesByUser[viewer] : [],
    courtMessages: toRecordMsgs(court),
    reportText: c.reports?.text || undefined,
    memberIds: members,
    memberNames,
  };
  return store.addRecord(rec);
}

function archiveSingleCase(userId: UserId, store: Store | null): boolean {
  const s = getPersonalSingle(userId);
  if (!s) return false;
  if (store?.isCaseArchived(s.id)) return false;

  const rel = RELATION_TYPES.find((r) => r.id === s.relationType);
  const msgs = s.messages.filter(
    (m) => m.kind !== 'system' && (m.user === userId || m.user === 'lumi')
  );
  const userSpeak = msgs.filter((m) => m.user === userId);
  const preview =
    userSpeak
      .slice(-2)
      .map((m) => m.text)
      .join(' / ') || '（暂无用户发言）';

  const ownerName = store
    ? nameOf(store, userId)
    : userRegistry.displayName(userId);

  const rec: JudgeRecord = {
    id: `${Date.now()}-exit-single`,
    mode: 'single',
    title: `单人 · ${rel?.label || ''}`,
    savedAt: formatBeijingDateTime(),
    summary: preview,
    shared: true,
    ownerId: userId,
    ownerName,
    caseId: s.id,
    source: 'exit',
    emotions: s.emotions || [],
    assessmentLabel: s.assessment?.attachSelf?.label || s.assessment?.level,
    privateCount: userSpeak.length,
    relationLabel: rel?.label,
    relationEmoji: rel?.emoji,
    singleMessages: toRecordMsgs(msgs),
  };
  if (store) return store.addRecord(rec);
  return false;
}

/** 结案报告：全量群聊 + 当前用户私聊 + 情绪 + 量表；其他成员公开数据一并对照 */
async function generateReportsAfterComplete(store: Store, forUserId?: UserId) {
  const roomId = store.roomId;
  const c = store.dual;
  if (!c?.completed) return;
  store.ensureDual();
  if (c.reports?.text) return;
  if (c.reports?.generating) return;
  c.reports.generating = true;
  broadcast(roomId);

  try {
    const users = displayUsers(store);
    const members = c.memberIds?.length ? c.memberIds : store.memberIds;
    const court = c.courtMessages
      .filter((m) => m.kind !== 'system')
      .slice(-60)
      .map((m) => ({
        user: m.user === 'lumi' ? 'Lumi' : nameOf(store, m.user as UserId),
        text: m.text,
        kind: m.kind,
      }));

    const quizBrief = (uid: UserId) => {
      const a = c.assessments[uid];
      return a ? formatAssessmentSummary(a) : '（未完成关系速测）';
    };

    const openings: Record<string, string | null> = {};
    const privateTopics: Record<string, string> = {};
    for (const uid of members) {
      openings[nameOf(store, uid)] = c.openingStatements[uid]?.polished || null;
      // 结案：当前用户私聊完整纳入；其他人仅摘要提示
      if (forUserId && uid === forUserId) {
        privateTopics[nameOf(store, uid)] = privatePerspective(store, uid, 40);
      } else {
        privateTopics[nameOf(store, uid)] = privatePerspective(store, uid, 12);
      }
    }

    const aiBody = await chatLumi({
      scene: 'mediation_report',
      aiRole: roomAiRole(store),
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            openings,
            courtChat: court,
            privateTopicsHint: privateTopics,
            note: 'privateTopicsHint 仅供理解背景；落笔不得写未在群聊/开场出现的情节。优先结合报告发起者的私聊与量表。',
          }),
        },
      ],
    });

    const section1 = (() => {
      const m = aiBody.match(/一、调解概要([\s\S]*?)(?=四、|五、|$)/);
      return (m ? m[1] : aiBody).trim();
    })();
    const section4 = (() => {
      const m = aiBody.match(
        /四、(?:树洞|关系调解室|一起聊聊)里的观察([\s\S]*?)(?=五、|$)/
      );
      return (m ? m[1] : '').trim();
    })();
    const section5 = (() => {
      const m = aiBody.match(/五、共同卡点与下一步([\s\S]*)$/);
      return (m ? m[1] : '').trim();
    })();

    const partyLine = members.map((id) => nameOf(store, id)).join(' & ');
    const emotionLines = members.map(
      (id) => `${nameOf(store, id)}：${fmtEmotions(c.emotions[id] || [])}`
    );
    const quizLines = members.flatMap((id) => [
      `【${nameOf(store, id)}】`,
      quizBrief(id),
      '',
    ]);

    const text = [
      '【调解报告】',
      `当事人：${partyLine}`,
      `生成时间：${formatBeijingDateTime()}`,
      '',
      '一、调解概要',
      section1 || '（暂缺）',
      '',
      '二、双方情绪对照',
      ...emotionLines,
      '',
      '三、双方量表对照',
      ...quizLines,
      '四、树洞里的观察',
      section4 || '（暂缺）',
      '',
      '五、共同卡点与下一步',
      section5 || '（暂缺）',
      '',
      '——',
      '说明：事实与表述以群聊与开场陈述为准；私聊未直接引用。',
      '本报告由 AI 辅助整理，供回顾参考，不构成心理诊断或治疗建议。',
    ].join('\n');

    c.reports = {
      text,
      generatedAt: new Date().toISOString(),
      generating: false,
    };
    archiveDualCase(store, 'complete', forUserId);
    store.addCourt('system', '调解报告已生成，可点「查看报告」', 'system');
    store.addCourt(
      'lumi',
      '报告好了。里面整理了情绪、量表，以及树洞里的观察。'
    );
    broadcast(roomId);
  } catch (e) {
    c.reports.generating = false;
    const msg = e instanceof Error ? e.message : String(e);
    store.addCourt('system', `报告生成失败：${msg}`, 'system');
    broadcast(roomId);
  }
}

function tryGroundWhoSaidWhat(
  text: string,
  courtMessages: { user: string; text: string; kind?: string }[],
  store: Store
): string | null {
  const ask = text.replace(/@\s*lumi/gi, '').trim();
  const users = displayUsers(store);
  const names = Object.values(users).map((u) => u.name);
  if (!names.length) return null;
  const nameAlt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const m = ask.match(
    new RegExp(
      `(${nameAlt}|对方|TA|他|她).{0,6}(说了什么|说了啥|讲了什么|说了哪些|说过什么)`
    )
  );
  if (!m) return null;

  const label = m[1];
  let target: UserId | null = null;
  for (const [id, u] of Object.entries(users)) {
    if (label === u.name) {
      target = id;
      break;
    }
  }
  if (!target) return null;

  const name = users[target]!.name;
  const said = courtMessages.filter((msg) => msg.user === target);
  if (!said.length) {
    return `目前群聊里还没看到${name}的发言哦。等${name}进来聊聊或确认「想说给对方的话」之后，我再帮你转述。`;
  }
  const lines = said.map((msg) => {
    const tag = msg.kind === 'opening' ? '（开场）' : '';
    return `${name}${tag}：${msg.text}`;
  });
  return `群聊里目前和${name}相关的内容是：\n\n${lines.join('\n\n')}`;
}

function hasPrivateSubstance(store: Store, uid: UserId): boolean {
  return (store.dual?.privateMessages[uid] || []).some(
    (m) =>
      m.kind !== 'system' &&
      m.user === uid &&
      substantiveUserText(m.text).replace(/\s/g, '').length >= 4
  );
}

function privatePerspective(store: Store, uid: UserId, limit = 16): string {
  const name = nameOf(store, uid);
  if (!hasPrivateSubstance(store, uid)) return '（尚无实质私聊）';
  const lines = (store.dual?.privateMessages[uid] || [])
    .filter((m) => m.kind !== 'system')
    .slice(-limit)
    .map((m) => {
      const who = m.user === 'lumi' ? 'Lumi' : name;
      return `${who}: ${m.text}`;
    });
  return lines.length ? lines.join('\n') : '（尚无实质私聊）';
}

function substantiveUserText(text: string): string {
  return text
    .replace(/@[\u4e00-\u9fa5A-Za-z0-9_]+/g, '')
    .replace(/【想说给对方的话】[\s\S]*/g, '')
    .trim();
}

function privateChatForOpening(
  store: Store,
  userId: UserId,
  me: string,
  limit = 18
): { lines: string; userSubstance: string } {
  const raw = store.dual?.privateMessages[userId] || [];
  const useful = (m: ChatMessage) =>
    m.kind !== 'system' &&
    (m.user === userId || m.user === 'lumi') &&
    Boolean(m.text?.trim()) &&
    !m.text.startsWith('【想说给对方的话】');
  const toLine = (m: ChatMessage) =>
    m.user === 'lumi' ? `【Lumi】${m.text}` : `【${me}】${m.text}`;

  const cursor = store.dual?.recessPrivateCursor?.[userId];
  let picked: ChatMessage[];

  if (cursor == null || cursor <= 0) {
    picked = raw.filter(useful).slice(-limit);
  } else {
    const after = raw.slice(cursor).filter(useful);
    const earlier = raw.slice(0, cursor).filter(useful);
    if (after.length >= limit) {
      picked = after.slice(-limit);
    } else {
      const need = limit - after.length;
      picked = [...earlier.slice(-need), ...after];
    }
  }

  const userSubstance = picked
    .filter((m) => m.user === userId)
    .map((m) => substantiveUserText(m.text))
    .filter(Boolean)
    .join('\n');

  return { lines: picked.map(toLine).join('\n'), userSubstance };
}

io.on('connection', (socket) => {
  let userId: UserId | null = null;
  let roomId: string | null = null;

  const st = () => {
    if (!roomId) throw new Error('未加入房间');
    const s = roomManager.get(roomId);
    if (!s) throw new Error('房间不存在');
    return s;
  };

  const requireUser = () => {
    if (!userId) throw new Error('未登录');
    return userId;
  };

  socket.emit('state', emptySnapshot());

  /** 昵称登录（已存在则登录，否则创建） */
  socket.on(
    'login',
    (
      payload: { nickname?: string; userId?: UserId } | string,
      ack?: (r: unknown) => void
    ) => {
      try {
        let account;
        if (typeof payload === 'string') {
          // 兼容：旧客户端传 userId 字符串时拒绝
          ack?.({ ok: false, error: '请使用昵称登录' });
          return;
        }
        if (payload?.userId && !payload?.nickname) {
          account = userRegistry.get(payload.userId);
          if (!account) {
            ack?.({ ok: false, error: '账号不存在，请重新输入昵称' });
            return;
          }
        } else {
          account = userRegistry.loginOrCreate(payload?.nickname || '');
        }

        // 同账号只保留当前连接（全局踢旧）
        for (const s of allActiveStores()) {
          for (const [sid, bound] of Object.entries(s.sockets)) {
            if (bound === account.id && sid !== socket.id) {
              delete s.sockets[sid];
              const other = io.sockets.sockets.get(sid);
              other?.emit('kicked', { reason: '同一账号已在别处登录' });
              other?.disconnect(true);
            }
          }
        }

        if (userId && userId !== account.id && roomId) {
          try {
            st().logoutSocket(socket.id);
            socket.leave(roomChannel(roomId));
          } catch {
            /* ignore */
          }
        }

        userId = account.id;
        socket.data.userId = account.id;
        roomId = null;
        socket.data.roomId = undefined;

        pushAccountState(socket);
        ack?.({
          ok: true,
          userId: account.id,
          nickname: account.nickname,
          lastRoomId: account.lastRoomId,
          joinedRoomIds: account.joinedRoomIds,
          profile: account.profile,
        });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  socket.on(
    'room:create',
    (
      payload: { aiRole?: string; groupName?: string; aiName?: string } | undefined,
      ack?: (r: unknown) => void
    ) => {
    try {
      const uid = requireUser();
      // 切换会话时只断开旧房连接，不「退出房间」（保留已加入列表记忆）
      if (roomId) {
        const old = roomManager.get(roomId);
        old?.logoutSocket(socket.id);
        socket.leave(roomChannel(roomId));
        broadcast(roomId);
      }
      const store = roomManager.createRoom(uid, {
        aiRole: payload?.aiRole,
        groupName: payload?.groupName,
        aiName: payload?.aiName,
      });
      roomId = store.roomId;
      socket.data.roomId = roomId;
      store.sockets[socket.id] = uid;
      store.heartbeat(uid);
      socket.join(roomChannel(roomId));
      broadcast(roomId);
      // 顺带推一份含更新后 joinedRooms 的账号态给本连接
      pushAccountState(socket);
      ack?.({
        ok: true,
        roomId: store.roomId,
        code: store.code,
      });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  );

  socket.on(
    'room:join',
    (payload: { code?: string; roomId?: string }, ack?: (r: unknown) => void) => {
      try {
        const uid = requireUser();
        let store: Store | null = null;
        if (payload?.roomId) {
          store = roomManager.get(payload.roomId);
          if (!store) throw new Error('房间不存在');
          store.addMember(uid);
          store.ensureWelcome(uid);
          store.bootstrapCourt(uid);
        } else if (payload?.code) {
          store = roomManager.joinRoom(uid, payload.code);
        } else {
          throw new Error('请输入房间码');
        }

        if (roomId && roomId !== store.roomId) {
          try {
            const old = roomManager.get(roomId);
            old?.logoutSocket(socket.id);
            socket.leave(roomChannel(roomId));
            broadcast(roomId);
          } catch {
            /* ignore */
          }
        }

        roomId = store.roomId;
        socket.data.roomId = roomId;
        // 同房同账号踢旧
        for (const [sid, bound] of Object.entries(store.sockets)) {
          if (bound === uid && sid !== socket.id) {
            delete store.sockets[sid];
            const other = io.sockets.sockets.get(sid);
            other?.emit('kicked', { reason: '同一账号已在别处登录' });
            other?.disconnect(true);
          }
        }
        store.sockets[socket.id] = uid;
        store.heartbeat(uid);
        socket.join(roomChannel(roomId));
        broadcast(roomId);
        ack?.({ ok: true, roomId: store.roomId, code: store.code });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  socket.on('room:leave', (_payload, ack?: (r: unknown) => void) => {
    try {
      const uid = requireUser();
      if (!roomId) {
        ack?.({ ok: true });
        return;
      }
      const rid = roomId;
      const store = roomManager.get(rid);
      store?.logoutSocket(socket.id);
      roomManager.leaveRoom(uid, rid);
      socket.leave(roomChannel(rid));
      roomId = null;
      socket.data.roomId = undefined;
      broadcast(rid);
      pushAccountState(socket);
      socket.emit('dual:exited', { reason: 'left_room' });
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  socket.on('room:refresh', (_payload, ack?: (r: unknown) => void) => {
    try {
      const uid = requireUser();
      if (!roomId) throw new Error('未加入房间');
      const store = st();
      store.pruneAndRefreshOnline(isAlive);
      socket.emit('state', store.snapshot(uid));
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  socket.on('heartbeat', () => {
    if (!userId || !roomId) return;
    try {
      const store = st();
      const before = { ...store.online };
      store.heartbeat(userId);
      const changed = Object.keys({ ...before, ...store.online }).some(
        (k) => before[k] !== store.online[k]
      );
      if (changed) broadcast(roomId);
    } catch {
      /* ignore */
    }
  });

  socket.on('logout', () => {
    if (userId && roomId) {
      try {
        st().logoutSocket(socket.id);
        socket.leave(roomChannel(roomId));
        broadcast(roomId);
      } catch {
        /* ignore */
      }
    }
    userId = null;
    roomId = null;
    socket.data.userId = undefined;
    socket.data.roomId = undefined;
    socket.emit('state', emptySnapshot());
  });

  socket.on('disconnect', () => {
    const rid = roomId;
    if (userId && rid) {
      try {
        roomManager.get(rid)?.logoutSocket(socket.id);
        broadcast(rid);
      } catch {
        /* ignore */
      }
    }
    userId = null;
    roomId = null;
  });

  socket.on('dual:ensure', () => {
    try {
      const uid = requireUser();
      st().ensureDual();
      st().ensureWelcome(uid);
      st().bootstrapCourt(uid);
      broadcast(roomId);
    } catch {
      /* ignore */
    }
  });

  socket.on(
    'dual:update_meta',
    (
      payload: { groupName?: string; aiName?: string; nickname?: string } | undefined,
      ack?: (r: unknown) => void
    ) => {
      try {
        const uid = requireUser();
        st().ensureDual();
        st().setDualMeta(uid, {
          groupName: payload?.groupName,
          aiName: payload?.aiName,
          nickname: payload?.nickname,
        });
        broadcast(roomId);
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  socket.on(
    'profile:update',
    (payload: Partial<PersonProfile> | undefined, ack?: (r: unknown) => void) => {
      try {
        const uid = requireUser();
        if (roomId) {
          st().syncProfileFromAccount(uid, payload || {});
          broadcast(roomId);
        } else {
          userRegistry.updateProfile(uid, payload || {});
          pushAccountState(socket);
        }
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  socket.on(
    'dual:game_invite',
    (payload: { targetUserId?: string } | undefined, ack?: (r: unknown) => void) => {
      try {
        const uid = requireUser();
        const target = payload?.targetUserId;
        if (!target || typeof target !== 'string') {
          throw new Error('请选择要邀请的用户');
        }
        st().inviteGame(uid, target);
        broadcast(roomId);
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  socket.on('dual:game_accept', (payload: { gameId?: string } | undefined, ack?: (r: unknown) => void) => {
    try {
      const uid = requireUser();
      st().acceptGame(uid, payload?.gameId);
      broadcast(roomId);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  socket.on('dual:game_decline', (payload: { gameId?: string } | undefined, ack?: (r: unknown) => void) => {
    try {
      const uid = requireUser();
      st().declineGame(uid, payload?.gameId);
      broadcast(roomId);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  socket.on(
    'dual:game_answer',
    (
      payload: {
        optionIndex?: number;
        questionIndex?: number;
        gameId?: string;
      },
      ack?: (r: unknown) => void
    ) => {
      try {
        const uid = requireUser();
        const optionIndex = payload?.optionIndex;
        if (typeof optionIndex !== 'number') throw new Error('缺少选项');
        st().answerGame(uid, optionIndex, payload?.questionIndex, payload?.gameId);
        broadcast(roomId);
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  socket.on('dual:game_close', (payload: { gameId?: string } | undefined, ack?: (r: unknown) => void) => {
    try {
      requireUser();
      st().closeGame(payload?.gameId);
      broadcast(roomId);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  socket.on('dual:game_restart', (payload: { gameId?: string } | undefined, ack?: (r: unknown) => void) => {
    try {
      const uid = requireUser();
      st().restartGame(uid, payload?.gameId);
      broadcast(roomId);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  socket.on(
    'dual:private_send',
    async (payload: { text?: string; image?: string }, ack?: (r: unknown) => void) => {
      try {
        const uid = requireUser();
        const text = (payload?.text || '').trim();
        const image = payload?.image;
        if (!text && !image) throw new Error('空消息');
        const store = st();
        store.ensureDual();
        store.ensureWelcome(uid);
        if (store.dual!.completed) throw new Error('本轮已结束');
        store.addPrivate(uid, uid, text || (image ? '[图片]' : ''), image);
        broadcast(roomId);

        if (image && !text) {
          ack?.({ ok: true });
          return;
        }

        const aiName = store.dual?.aiName || 'Lumi';
        const mentionLumi =
          /@\s*(lumi|关系大法官|罗辑)/i.test(text) ||
          new RegExp(
            `@\\s*${aiName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
            'i'
          ).test(text);
        const courtLines = (store.dual!.courtMessages || [])
          .filter((m) => m.kind !== 'system')
          .slice(-16)
          .map((m) => {
            const name =
              m.user === 'lumi' ? 'Lumi' : nameOf(store, m.user as UserId);
            const tag = m.kind === 'opening' ? '（开场）' : '';
            return `${name}${tag}: ${m.text}`;
          })
          .join('\n');

        const history = [
          {
            role: 'system' as const,
            content:
              '【公开群聊实录 · 可结合理解背景】\n' +
              (courtLines || '（暂无群聊发言）'),
          },
          ...store.dual!.privateMessages[uid]
            .filter((m) => m.user === uid || m.user === 'lumi')
            .slice(-12)
            .map((m) => ({
              role: (m.user === 'lumi' ? 'assistant' : 'user') as
                | 'assistant'
                | 'user',
              content: m.text,
            })),
        ];

        const reply = await chatLumi({
          scene: 'private_chat',
          messages: history,
          aiRole: roomAiRole(store),
          extraSystem: mentionLumi ? '用户特意 @ 了你。' : undefined,
        });
        store.addPrivate(uid, 'lumi', reply);
        broadcast(roomId);
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  socket.on(
    'dual:set_emotions',
    async (
      payload: { emotions: { name: string; level: number }[] },
      ack?: (r: unknown) => void
    ) => {
      try {
        const uid = requireUser();
        const store = st();
        store.ensureDual();
        store.setEmotions(uid, payload.emotions || []);
        broadcast(roomId);
        const list = (payload.emotions || [])
          .map((e) => `${e.name}(${e.level}/5)`)
          .join('、');
        const reply = await chatLumi({
          scene: 'emotion_ack',
          messages: [{ role: 'user', content: `我标记的情绪：${list || '无'}` }],
          aiRole: roomAiRole(store),
        });
        store.addPrivate(uid, 'lumi', reply);
        broadcast(roomId);
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  socket.on(
    'dual:set_assessment',
    async (payload: { assessment: unknown }, ack?: (r: unknown) => void) => {
      try {
        const uid = requireUser();
        const store = st();
        store.ensureDual();
        store.setAssessment(uid, payload.assessment as never);
        broadcast(roomId);
        const reply = await chatLumi({
          scene: 'quiz_feedback',
          messages: [
            {
              role: 'user',
              content: `我的速测结果：${JSON.stringify(payload.assessment)}`,
            },
          ],
          aiRole: roomAiRole(store),
        });
        store.addPrivate(uid, 'lumi', reply);
        broadcast(roomId);
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  socket.on(
    'dual:polish_opening',
    async (
      _payload: { intent?: 'enter' | 'return' } | undefined,
      ack?: (r: unknown) => void
    ) => {
      try {
        const uid = requireUser();
        const store = st();
        const me = nameOf(store, uid);
        const oid = otherId(store, uid);
        const other = oid ? nameOf(store, oid) : '对方';
        const { lines, userSubstance } = privateChatForOpening(store, uid, me);
        const thin = userSubstance.replace(/\s/g, '').length < 12;

        const polished = await chatLumi({
          scene: 'opening_polish',
          aiRole: roomAiRole(store),
          messages: [
            {
              role: 'user',
              content: [
                `说话人（「我」）：${me}`,
                `听的人（「你」）：${other}`,
                `私聊是${me}对 Lumi 说的；其中「他/她/对方」指${other}，请改成对「你」说。`,
                '请总结私聊要点，并用非暴力沟通（观察→感受→需要→请求）润色成一段当面说的话。',
                '',
                '私聊记录（【姓名】=谁说的）：',
                lines || '（暂无私聊，写一句简短真诚、愿意继续沟通的话）',
              ].join('\n'),
            },
          ],
        });
        ack?.({
          ok: true,
          polished,
          thin,
          tip: thin
            ? '私聊内容还比较少，开场白可能较简略；也可以再聊几句后点「再生成一次」。'
            : undefined,
        });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  socket.on('dual:go_private', (_payload, ack?: (r: unknown) => void) => {
    try {
      const uid = requireUser();
      st().ensureWelcome(uid);
      st().goPrivateChat(uid);
      broadcast(roomId);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  socket.on(
    'ai:mouthpiece',
    async (
      payload: { wantToSay: string; wantThemToDo: string },
      ack?: (r: unknown) => void
    ) => {
      try {
        const uid = requireUser();
        const store = roomId ? st() : null;
        const me = store
          ? nameOf(store, uid)
          : userRegistry.displayName(uid);
        const single = getPersonalSingle(uid);
        let listener = '对方';
        let chatLines = '';
        let chatLabel = '【说话人私聊摘要 · 自行挑选适合对对方说的要点并入】';

        if (single) {
          const rel = RELATION_TYPES.find((r) => r.id === single.relationType);
          listener = rel?.counterpart || '对方';
          chatLabel = '【说话人倾诉摘要 · 自行挑选适合对对方说的要点并入】';
          chatLines = single.messages
            .filter(
              (m) => m.kind !== 'system' && (m.user === uid || m.user === 'lumi')
            )
            .slice(-18)
            .map((m) => `${m.user === 'lumi' ? 'Lumi' : me}: ${m.text}`)
            .join('\n');
        } else if (store) {
          const oid = otherId(store, uid);
          if (oid) listener = nameOf(store, oid);
          chatLines = (store.dual?.privateMessages[uid] || [])
            .filter(
              (m) => m.kind !== 'system' && (m.user === uid || m.user === 'lumi')
            )
            .slice(-18)
            .map((m) => `${m.user === 'lumi' ? 'Lumi' : me}: ${m.text}`)
            .join('\n');
        }

        const polished = await chatLumi({
          scene: 'mouthpiece',
          aiRole: store ? roomAiRole(store) : 'default',
          messages: [
            {
              role: 'user',
              content: [
                `说话人：${me}；听的人：${listener}。`,
                '请改写成「我」对对方直接说的一段话（不要回复我本人）：',
                `想说：${payload.wantToSay}`,
                `希望对方：${payload.wantThemToDo || '（未填）'}`,
                '',
                chatLabel,
                chatLines || '（暂无对话）',
              ].join('\n'),
            },
          ],
        });
        ack?.({ ok: true, polished });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  socket.on(
    'dual:confirm_opening',
    (payload: { polished: string }, ack?: (r: unknown) => void) => {
      try {
        const uid = requireUser();
        const store = st();
        store.ensureDual();
        const polished = (payload.polished || '').trim();
        if (!polished) throw new Error('开场白不能为空');
        store.setOpening(uid, polished);
        store.addPrivate(uid, uid, `【想说给对方的话】\n${polished}`);
        store.addPrivate(
          uid,
          'lumi',
          '已确认开场白。进入群聊后会以你的名义说给对方听。'
        );
        broadcast(roomId);
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  socket.on('dual:enter_court', (_payload, ack?: (r: unknown) => void) => {
    try {
      const uid = requireUser();
      const store = st();
      store.enterCourt(uid, nameOf(store, uid));
      broadcast(roomId);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  socket.on(
    'dual:leave_private',
    (payload: { minutes?: number }, ack?: (r: unknown) => void) => {
      try {
        const uid = requireUser();
        const store = st();
        store.leaveToPrivate(uid, nameOf(store, uid), payload?.minutes || 15);
        broadcast(roomId);
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  socket.on('dual:return_court', (_payload, ack?: (r: unknown) => void) => {
    try {
      const uid = requireUser();
      const store = st();
      store.returnToCourt(uid, nameOf(store, uid));
      broadcast(roomId);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  socket.on(
    'dual:court_send',
    async (payload: { text?: string; image?: string }, ack?: (r: unknown) => void) => {
      try {
        const uid = requireUser();
        const store = st();
        const c = store.ensureDual();
        if (c.completed) throw new Error('本轮已结束');
        const text = (payload?.text || '').trim();
        const image = payload?.image;
        if (!text && !image) throw new Error('空消息');
        store.addCourt(uid, text || (image ? '[图片]' : ''), 'chat', image);
        broadcast(roomId);

        const aiName = c.aiName || 'Lumi';
        const mentionedAi =
          /@\s*(lumi|关系大法官|罗辑)/i.test(text) ||
          new RegExp(
            `@\\s*${aiName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
            'i'
          ).test(text);

        if (text && mentionedAi) {
          const factual = c.courtMessages.filter((m) => m.kind !== 'system');
          const grounded = tryGroundWhoSaidWhat(text, factual, store);
          if (grounded) {
            store.addCourt('lumi', grounded);
            broadcast(roomId);
            ack?.({ ok: true });
            return;
          }

          const transcript = factual
            .slice(-20)
            .map((m) => {
              const name =
                m.user === 'lumi' ? 'Lumi' : nameOf(store, m.user as UserId);
              const tag = m.kind === 'opening' ? '（开场）' : '';
              return `${name}${tag}: ${m.text}`;
            })
            .join('\n');

          const members = c.memberIds?.length ? c.memberIds : store.memberIds;
          const presenceLabel = (id: UserId) => {
            if (!store.online[id]) return '离线';
            if (c.presence[id] === 'court') return '在群聊';
            if (c.presence[id] === 'private') return '在线·未进群聊';
            return '在线·未进群聊';
          };

          const presenceLines = members
            .map((id) => `${nameOf(store, id)} ${presenceLabel(id)}`)
            .join('；');
          const privateBlocks = members
            .map(
              (id) =>
                `${nameOf(store, id)}私聊：\n${privatePerspective(store, id)}`
            )
            .join('\n\n');

          const history = [
            {
              role: 'system' as const,
              content: [
                `在场：${presenceLines}`,
                `发言者 ${nameOf(store, uid)}：${
                  hasPrivateSubstance(store, uid) ? '已有实质私聊' : '尚无实质私聊'
                }`,
                privateBlocks,
                `群聊实录：\n${transcript || '（暂无）'}`,
              ].join('\n\n'),
            },
            {
              role: 'user' as const,
              content: `${nameOf(store, uid)}: ${text}`,
            },
          ];

          const reply = await chatLumi({
            scene: 'court_chat',
            messages: history,
            aiRole: roomAiRole(store),
            extraSystem: `当前发言者：${nameOf(store, uid)}。`,
          });
          store.addCourt('lumi', reply);
          broadcast(roomId);
        }
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  /** 结案：单人点击即生成报告（无需双方同意） */
  socket.on('dual:accept_complete', (_payload, ack?: (r: unknown) => void) => {
    try {
      const uid = requireUser();
      const store = st();
      store.completeCase(uid);
      broadcast(roomId);
      ack?.({ ok: true });
      void generateReportsAfterComplete(store, uid);
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** 退出房间：单人即可，清除云端记忆 */
  socket.on('dual:accept_exit', (_payload, ack?: (r: unknown) => void) => {
    try {
      const uid = requireUser();
      if (!roomId) {
        ack?.({ ok: true, exited: true });
        return;
      }
      const rid = roomId;
      const store = st();
      archiveDualCase(store, 'exit', uid);
      store.logoutSocket(socket.id);
      roomManager.leaveRoom(uid, rid);
      socket.leave(roomChannel(rid));
      roomId = null;
      socket.data.roomId = undefined;
      broadcast(rid);
      pushAccountState(socket);
      socket.emit('dual:exited', { reason: 'left_room' });
      ack?.({ ok: true, exited: true });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  socket.on('dual:reset', (_payload, ack?: (r: unknown) => void) => {
    ack?.({ ok: false, error: '请使用退出房间' });
  });

  socket.on('dual:analyze', (_payload, ack?: (r: unknown) => void) => {
    try {
      const uid = requireUser();
      const c = st().ensureDual();
      const text = c.reports?.text || null;
      if (text) {
        ack?.({
          ok: true,
          report: text,
          generating: Boolean(c.reports?.generating),
        });
        return;
      }
      if (c.completed) {
        void generateReportsAfterComplete(st(), uid);
        ack?.({ ok: true, generating: true, report: '报告生成中，请稍候…' });
        return;
      }
      ack?.({ ok: false, error: '请先点击结案生成报告' });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  socket.on(
    'single:start',
    (payload: { relationType: RelationType }, ack?: (r: unknown) => void) => {
      try {
        const uid = requireUser();
        ensurePersonalSingle(uid, payload.relationType);
        pushUserState(uid);
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  socket.on(
    'single:send',
    async (payload: { text?: string; image?: string }, ack?: (r: unknown) => void) => {
      try {
        const uid = requireUser();
        const s = getPersonalSingle(uid);
        if (!s) throw new Error('请先选择关系类型');
        const text = (payload?.text || '').trim();
        const image = payload?.image;
        if (!text && !image) throw new Error('空消息');
        addPersonalSingleMessage(uid, uid, text || (image ? '[图片]' : ''), image);
        pushUserState(uid);

        if (image && !text) {
          ack?.({ ok: true });
          return;
        }

        const history = s.messages.slice(-12).map((m) => ({
          role: (m.user === 'lumi' ? 'assistant' : 'user') as 'assistant' | 'user',
          content: m.text,
        }));
        const reply = await chatLumi({
          scene: 'single_chat',
          messages: history,
          extraSystem: `当前关系类型：${s.relationType}`,
        });
        addPersonalSingleMessage(uid, 'lumi', reply);
        pushUserState(uid);
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  socket.on(
    'single:set_emotions',
    async (
      payload: { emotions: { name: string; level: number }[] },
      ack?: (r: unknown) => void
    ) => {
      try {
        const uid = requireUser();
        const s = getPersonalSingle(uid);
        if (!s) throw new Error('请先选择关系类型');
        s.emotions = payload.emotions || [];
        pushUserState(uid);
        const list = s.emotions.map((e) => `${e.name}(${e.level}/5)`).join('、');
        const reply = await chatLumi({
          scene: 'emotion_ack',
          messages: [{ role: 'user', content: `我标记的情绪：${list || '无'}` }],
        });
        addPersonalSingleMessage(uid, 'lumi', reply);
        pushUserState(uid);
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  socket.on(
    'single:set_assessment',
    async (payload: { assessment: unknown }, ack?: (r: unknown) => void) => {
      try {
        const uid = requireUser();
        const s = getPersonalSingle(uid);
        if (!s) throw new Error('请先选择关系类型');
        s.assessment = payload.assessment as never;
        pushUserState(uid);
        const reply = await chatLumi({
          scene: 'quiz_feedback',
          messages: [
            {
              role: 'user',
              content: `我的速测结果：${JSON.stringify(payload.assessment)}`,
            },
          ],
        });
        addPersonalSingleMessage(uid, 'lumi', reply);
        pushUserState(uid);
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  socket.on('single:analyze', (_payload, ack?: (r: unknown) => void) => {
    try {
      const uid = requireUser();
      const s = getPersonalSingle(uid);
      if (!s) throw new Error('请先选择关系类型');
      void (async () => {
        try {
          const me = userRegistry.displayName(uid);
          const rel = RELATION_TYPES.find((r) => r.id === s.relationType);
          const chat = s.messages
            .filter(
              (m) => m.kind !== 'system' && (m.user === uid || m.user === 'lumi')
            )
            .slice(-40)
            .map((m) => ({
              user: m.user === 'lumi' ? 'Lumi' : me,
              text: m.text,
            }));

          const aiBody = await chatLumi({
            scene: 'single_analysis',
            messages: [
              {
                role: 'user',
                content: JSON.stringify({
                  party: me,
                  relationType: rel?.label || s.relationType,
                  counterpart: rel?.counterpart || '对方',
                  chat,
                  note: '无群聊。事与话只依据 chat；情绪与量表由系统另附。',
                }),
              },
            ],
          });

          const section1 = (() => {
            const m = aiBody.match(/一、梳理概要([\s\S]*?)(?=四、|五、|$)/);
            return (m ? m[1] : aiBody).trim();
          })();
          const section4 = (() => {
            const m = aiBody.match(/四、倾诉中的观察([\s\S]*?)(?=五、|$)/);
            return (m ? m[1] : '').trim();
          })();
          const section5 = (() => {
            const m = aiBody.match(/五、卡点与下一步([\s\S]*)$/);
            return (m ? m[1] : '').trim();
          })();

          const text = [
            '【沟通报告】',
            `当事人：${me} · ${rel?.label || '关系'}`,
            `生成时间：${formatBeijingDateTime()}`,
            '',
            '一、梳理概要',
            section1 || '（暂缺）',
            '',
            '二、情绪标记',
            fmtEmotions(s.emotions),
            '',
            '三、关系速测',
            s.assessment
              ? formatAssessmentSummary(s.assessment)
              : '（未完成关系速测）',
            '',
            '四、倾诉中的观察',
            section4 || '（暂缺）',
            '',
            '五、卡点与下一步',
            section5 || '（暂缺）',
            '',
            '——',
            '说明：单人模式无群聊；事实与表述以倾诉对话为准。',
            '本报告由 AI 辅助整理，供本人回顾参考，不构成心理诊断或治疗建议。',
          ].join('\n');

          addPersonalSingleMessage(
            uid,
            'lumi',
            '报告好了。里面整理了你的情绪、速测，以及倾诉里的观察。可点「生成报告」查看。'
          );
          pushUserState(uid);
          ack?.({ ok: true, report: text });
        } catch (e) {
          ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      })();
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  socket.on('single:exit', (_payload, ack?: (r: unknown) => void) => {
    try {
      const uid = requireUser();
      const store = roomId ? roomManager.get(roomId) : null;
      archiveSingleCase(uid, store);
      clearPersonalSingle(uid);
      if (store) store.clearSingle(uid);
      pushUserState(uid);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`Lumi Judge server http://${HOST}:${PORT}`);
  console.log(`[cloud] supabase=${isSupabaseConfigured()}`, supabaseConfigDebug());
  setInterval(() => {
    for (const s of allActiveStores()) {
      const before = { ...s.online };
      s.pruneAndRefreshOnline(isAlive);
      const changed = Object.keys({ ...before, ...s.online }).some(
        (k) => before[k] !== s.online[k]
      );
      if (changed) broadcast(s.roomId);
    }
  }, 5000);
});
