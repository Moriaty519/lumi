import { randomUUID, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  AssessmentResult,
  ChatMessage,
  DualCase,
  DualGame,
  EmotionMark,
  JudgeRecord,
  OpeningStatement,
  RelationType,
  RoomInfo,
  SingleCase,
  UserAccount,
  UserId,
} from '../shared/types.js';
import { toUserProfile } from '../shared/types.js';
import { getAiRole, isAiRoleId, normalizeRoomLabel } from '../shared/aiRoles.js';
import {
  GAME_QUESTION_COUNT,
  formatGameResultCourtMessage,
  gameLevelFromPercent,
  pickGameQuestionIds,
} from '../shared/game.js';
import {
  emptyPersonProfile,
  normalizeProfilePatch,
  type PersonProfile,
} from '../shared/profile.js';
import { formatBeijingClock } from '../shared/time.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ROOMS_INDEX_FILE = path.join(DATA_DIR, 'rooms-index.json');

function nowTime() {
  return formatBeijingClock();
}

function msg(
  user: ChatMessage['user'],
  text: string,
  kind: ChatMessage['kind'] = 'chat',
  image?: string
): ChatMessage {
  return { id: randomUUID(), user, text, time: nowTime(), kind, ...(image ? { image } : {}) };
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (e) {
    console.warn('[store] load failed', file, e);
    return fallback;
  }
}

function writeJson(file: string, data: unknown) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data));
}

function genRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[bytes[i]! % alphabet.length];
  return code;
}

type PersistedRoom = {
  info: RoomInfo;
  dual: DualCase | null;
  singles: Record<string, SingleCase | null>;
  records: JudgeRecord[];
  archivedCaseIds: string[];
};

type RoomsIndex = { rooms: { id: string; code: string }[] };
type UsersFile = { users: UserAccount[] };

// ─── User registry ───────────────────────────────────────────

export class UserRegistry {
  users = new Map<UserId, UserAccount>();
  byNickname = new Map<string, UserId>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const data = loadJson<UsersFile>(USERS_FILE, { users: [] });
    for (const u of data.users || []) {
      this.users.set(u.id, u);
      this.byNickname.set(u.nickname, u.id);
    }
    console.log(`[users] loaded ${this.users.size} accounts`);
  }

  private schedulePersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      writeJson(USERS_FILE, { users: [...this.users.values()] });
    }, 80);
  }

  get(id: UserId) {
    return this.users.get(id) || null;
  }

  getByNickname(nickname: string) {
    const id = this.byNickname.get(nickname);
    return id ? this.users.get(id) || null : null;
  }

  /** 昵称登录：已存在则登录，否则创建（全局唯一） */
  loginOrCreate(rawNickname: string): UserAccount {
    const nickname = rawNickname.trim().replace(/\s+/g, ' ').slice(0, 20);
    if (!nickname) throw new Error('请输入昵称');
    if (nickname.length < 1) throw new Error('昵称太短');
    const existing = this.getByNickname(nickname);
    if (existing) return existing;

    const account: UserAccount = {
      id: randomUUID(),
      nickname,
      createdAt: new Date().toISOString(),
      profile: emptyPersonProfile(nickname),
      joinedRoomIds: [],
      lastRoomId: null,
    };
    this.users.set(account.id, account);
    this.byNickname.set(nickname, account.id);
    this.schedulePersist();
    return account;
  }

  updateProfile(userId: UserId, patch: Partial<PersonProfile>): PersonProfile {
    const acc = this.users.get(userId);
    if (!acc) throw new Error('账号不存在');
    if (patch.avatar && typeof patch.avatar === 'string') {
      if (!patch.avatar.startsWith('data:image/')) throw new Error('头像格式无效');
      if (patch.avatar.length > 1_200_000) throw new Error('头像过大，请压缩后重试');
    }
    // 禁止通过 profile 改成已被占用的显示名以外的「账号昵称」；
    // displayName 可改，账号 nickname 保持登录名不变（个人页展示用 displayName）
    const next = normalizeProfilePatch(patch, acc.profile);
    acc.profile = next;
    this.schedulePersist();
    return next;
  }

  rememberRoom(userId: UserId, roomId: string) {
    const acc = this.users.get(userId);
    if (!acc) return;
    acc.lastRoomId = roomId;
    if (!acc.joinedRoomIds.includes(roomId)) {
      acc.joinedRoomIds = [roomId, ...acc.joinedRoomIds].slice(0, 50);
    }
    this.schedulePersist();
  }

  forgetRoom(userId: UserId, roomId?: string | null) {
    const acc = this.users.get(userId);
    if (!acc) return;
    if (roomId) {
      acc.joinedRoomIds = acc.joinedRoomIds.filter((id) => id !== roomId);
      if (acc.lastRoomId === roomId) acc.lastRoomId = null;
    } else {
      acc.lastRoomId = null;
    }
    this.schedulePersist();
  }

  accountSummary(userId: UserId) {
    const acc = this.users.get(userId);
    if (!acc) return null;
    // 清理已不存在的房间引用，避免列表「幽灵」占位
    const validIds = acc.joinedRoomIds.filter((id) => roomManager.get(id));
    if (validIds.length !== acc.joinedRoomIds.length) {
      acc.joinedRoomIds = validIds;
      if (acc.lastRoomId && !validIds.includes(acc.lastRoomId)) {
        acc.lastRoomId = validIds[0] || null;
      }
      this.schedulePersist();
    }
    return {
      userId: acc.id,
      nickname: acc.nickname,
      lastRoomId: acc.lastRoomId,
      joinedRoomIds: [...acc.joinedRoomIds],
      joinedRooms: roomManager.summariesForUser(acc.joinedRoomIds),
    };
  }

  displayName(userId: UserId) {
    const acc = this.users.get(userId);
    if (!acc) return '用户';
    return acc.profile.displayName || acc.nickname;
  }
}

export const userRegistry = new UserRegistry();

// ─── 单人模式（不依赖房间；每人一份）────────────────────────

const personalSingles = new Map<UserId, SingleCase | null>();

export function getPersonalSingle(userId: UserId): SingleCase | null {
  return personalSingles.get(userId) ?? null;
}

export function ensurePersonalSingle(
  userId: UserId,
  relationType: RelationType
): SingleCase {
  const existing = personalSingles.get(userId) ?? null;
  if (existing && existing.relationType === relationType) return existing;
  const s: SingleCase = {
    id: randomUUID(),
    playMode: 'single',
    userId,
    relationType,
    createdAt: new Date().toISOString(),
    messages: [
      msg(
        'lumi',
        '我是 Lumi。这里只有你和我。想到什么就说，也可以先标记情绪或做关系速测。'
      ),
    ],
    emotions: [],
    assessment: null,
  };
  personalSingles.set(userId, s);
  return s;
}

export function clearPersonalSingle(userId: UserId) {
  personalSingles.set(userId, null);
}

export function addPersonalSingleMessage(
  userId: UserId,
  from: ChatMessage['user'],
  text: string,
  image?: string
) {
  const s = personalSingles.get(userId);
  if (!s) throw new Error('单人会话不存在');
  const m = msg(from, text, 'chat', image);
  s.messages.push(m);
  return m;
}

// ─── Room store ──────────────────────────────────────────────

type PersistedSessionLike = {
  dual: DualCase | null;
  singles: Record<string, SingleCase | null>;
};

export class Store {
  roomId: string;
  code: string;
  memberIds: UserId[] = [];
  dual: DualCase | null = null;
  singles: Record<string, SingleCase | null> = {};
  online: Record<string, boolean> = {};
  sockets: Record<string, UserId> = {};
  lastSeen: Record<string, number> = {};
  records: JudgeRecord[] = [];
  archivedCaseIds = new Set<string>();
  private sessionFile: string;
  private recordsFile: string;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private recordsPersistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(info: RoomInfo) {
    this.roomId = info.id;
    this.code = info.code;
    this.memberIds = [...info.memberIds];
    this.sessionFile = path.join(DATA_DIR, `room.${info.id}.session.json`);
    this.recordsFile = path.join(DATA_DIR, `room.${info.id}.records.json`);

    const saved = loadJson<PersistedSessionLike | null>(this.sessionFile, null);
    if (saved) {
      this.dual = saved.dual ?? null;
      this.singles = saved.singles || {};
      if (this.dual?.memberIds?.length) {
        this.memberIds = [...new Set([...this.memberIds, ...this.dual.memberIds])];
      }
    }
    const rec = loadJson<{ records?: JudgeRecord[]; archivedCaseIds?: string[] }>(
      this.recordsFile,
      { records: [], archivedCaseIds: [] }
    );
    this.records = Array.isArray(rec.records) ? rec.records : [];
    this.archivedCaseIds = new Set(rec.archivedCaseIds || []);
  }

  info(): RoomInfo {
    return {
      id: this.roomId,
      code: this.code,
      memberIds: [...this.memberIds],
      createdAt: this.dual?.createdAt || new Date().toISOString(),
    };
  }

  occupiedUserIds(isAlive: (socketId: string) => boolean): Set<UserId> {
    const set = new Set<UserId>();
    for (const [sid, uid] of Object.entries(this.sockets)) {
      if (isAlive(sid)) set.add(uid);
    }
    return set;
  }

  persist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      try {
        writeJson(this.sessionFile, {
          dual: this.dual,
          singles: this.singles,
        });
      } catch (e) {
        console.warn(`[store:${this.code}] persist failed:`, e);
      }
    }, 80);
  }

  persistRecords() {
    if (this.recordsPersistTimer) clearTimeout(this.recordsPersistTimer);
    this.recordsPersistTimer = setTimeout(() => {
      try {
        writeJson(this.recordsFile, {
          records: this.records,
          archivedCaseIds: [...this.archivedCaseIds],
        });
      } catch (e) {
        console.warn(`[store:${this.code}] persist records failed:`, e);
      }
    }, 80);
  }

  isCaseArchived(caseId: string) {
    return this.archivedCaseIds.has(caseId);
  }

  addRecord(rec: JudgeRecord): boolean {
    if (rec.caseId) {
      const existing = this.records.find((x) => x.caseId === rec.caseId);
      if (existing) {
        let changed = false;
        if (rec.privateMessagesByUser) {
          existing.privateMessagesByUser = {
            ...(existing.privateMessagesByUser || {}),
            ...rec.privateMessagesByUser,
          };
          changed = true;
        }
        if (rec.emotionsByUser) {
          existing.emotionsByUser = {
            ...(existing.emotionsByUser || {}),
            ...rec.emotionsByUser,
          };
          changed = true;
        }
        if (rec.reportText && !existing.reportText) {
          existing.reportText = rec.reportText;
          changed = true;
        }
        if (
          rec.courtMessages?.length &&
          (existing.courtMessages?.length || 0) < rec.courtMessages.length
        ) {
          existing.courtMessages = rec.courtMessages;
          changed = true;
        }
        if (changed) this.persistRecords();
        this.archivedCaseIds.add(rec.caseId);
        return changed;
      }
    }
    if (this.records.some((x) => x.id === rec.id)) return false;
    this.records = [rec, ...this.records].slice(0, 40);
    if (rec.caseId) this.archivedCaseIds.add(rec.caseId);
    this.persistRecords();
    return true;
  }

  recordsForViewer(viewerId: UserId | null): JudgeRecord[] {
    if (!viewerId) return [];
    return this.records
      .filter((r) => {
        if (r.mode === 'single') return r.ownerId === viewerId;
        return true;
      })
      .map((r) => {
        if (r.mode !== 'dual') return { ...r };
        const myPriv =
          r.privateMessagesByUser?.[viewerId] ||
          (r.ownerId === viewerId ? r.privateMessages : undefined) ||
          [];
        const myEmo =
          r.emotionsByUser?.[viewerId] ||
          (r.ownerId === viewerId ? r.emotions : undefined) ||
          [];
        const otherIds = (r.memberIds || []).filter((id) => id !== viewerId);
        const otherEmo = otherIds.flatMap((id) => r.emotionsByUser?.[id] || []);
        const otherName =
          otherIds.map((id) => r.memberNames?.[id] || id).join('、') || r.otherName;

        return {
          ...r,
          ownerId: viewerId,
          ownerName: userRegistry.displayName(viewerId),
          otherName,
          emotions: myEmo.length ? myEmo : r.emotions || [],
          emotionsOther: otherEmo,
          assessmentLabel:
            r.assessmentByUser?.[viewerId] ||
            (r.ownerId === viewerId ? r.assessmentLabel : undefined) ||
            r.assessmentLabel,
          privateMessages: myPriv,
          privateMessagesByUser: undefined,
          emotionsByUser: undefined,
          assessmentByUser: undefined,
        };
      });
  }

  profilesForMembers(): Record<string, PersonProfile> {
    const out: Record<string, PersonProfile> = {};
    for (const id of this.memberIds) {
      const acc = userRegistry.get(id);
      out[id] = acc
        ? { ...acc.profile }
        : emptyPersonProfile(userRegistry.displayName(id));
    }
    return out;
  }

  snapshot(viewerId?: UserId | null) {
    this.refreshOnlineFromHeartbeat();
    const online: Record<string, boolean> = {};
    for (const id of this.memberIds) {
      online[id] = Boolean(this.online[id]);
    }
    return {
      dual: this.dual,
      single: viewerId
        ? { [viewerId]: getPersonalSingle(viewerId) }
        : { ...this.singles },
      online,
      records: this.recordsForViewer(viewerId ?? null),
      profiles: this.profilesForMembers(),
      account: viewerId ? userRegistry.accountSummary(viewerId) : null,
      room: this.info(),
    };
  }

  static HEARTBEAT_MS = 12_000;

  refreshOnlineFromHeartbeat() {
    const now = Date.now();
    const ttl = Store.HEARTBEAT_MS;
    const next: Record<string, boolean> = {};
    for (const id of this.memberIds) {
      next[id] = now - (this.lastSeen[id] || 0) < ttl;
    }
    this.online = next;
  }

  heartbeat(userId: UserId) {
    this.lastSeen[userId] = Date.now();
    this.refreshOnlineFromHeartbeat();
  }

  clearPresence(userId: UserId) {
    const still = Object.values(this.sockets).some((u) => u === userId);
    if (!still) this.lastSeen[userId] = 0;
    this.refreshOnlineFromHeartbeat();
  }

  pruneAndRefreshOnline(isAlive: (socketId: string) => boolean) {
    for (const sid of Object.keys(this.sockets)) {
      if (!isAlive(sid)) delete this.sockets[sid];
    }
    for (const uid of this.memberIds) {
      const still = Object.values(this.sockets).some((u) => u === uid);
      if (!still) this.lastSeen[uid] = 0;
    }
    this.refreshOnlineFromHeartbeat();
  }

  logoutSocket(socketId: string) {
    const uid = this.sockets[socketId];
    delete this.sockets[socketId];
    if (uid) this.clearPresence(uid);
    else this.refreshOnlineFromHeartbeat();
  }

  addMember(userId: UserId) {
    if (!this.memberIds.includes(userId)) {
      this.memberIds.push(userId);
    }
    const c = this.ensureDual();
    this.ensureMemberFields(c, userId);
    userRegistry.rememberRoom(userId, this.roomId);
  }

  removeMember(userId: UserId) {
    this.memberIds = this.memberIds.filter((id) => id !== userId);
    if (this.dual) {
      this.dual.memberIds = this.dual.memberIds.filter((id) => id !== userId);
    }
    userRegistry.forgetRoom(userId, this.roomId);
  }

  private ensureMemberFields(c: DualCase, userId: UserId) {
    const name = userRegistry.displayName(userId);
    if (!c.memberIds.includes(userId)) c.memberIds.push(userId);
    if (c.nicknames[userId] == null) c.nicknames[userId] = name;
    if (!c.privateMessages[userId]) c.privateMessages[userId] = [];
    if (!c.emotions[userId]) c.emotions[userId] = [];
    if (c.assessments[userId] === undefined) c.assessments[userId] = null;
    if (c.openingStatements[userId] === undefined) c.openingStatements[userId] = null;
    if (!c.presence[userId]) c.presence[userId] = 'offline';
    if (c.recessCount[userId] == null) c.recessCount[userId] = 0;
    if (c.recessUntil[userId] === undefined) c.recessUntil[userId] = null;
    if (c.recessPrivateCursor[userId] === undefined) c.recessPrivateCursor[userId] = null;
    if (c.softPrivateUsed[userId] == null) c.softPrivateUsed[userId] = false;
    if (c.completeAccepted[userId] == null) c.completeAccepted[userId] = false;
    if (c.exitAccepted[userId] == null) c.exitAccepted[userId] = false;
    if (!c.nicknameCustomized) c.nicknameCustomized = {};
    if (c.nicknameCustomized[userId] == null) c.nicknameCustomized[userId] = false;
  }

  ensureDual(): DualCase {
    if (!this.dual) {
      this.dual = {
        id: randomUUID(),
        playMode: 'dual',
        createdAt: new Date().toISOString(),
        groupName: '树洞',
        aiName: 'Lumi',
        aiRole: 'default',
        memberIds: [...this.memberIds],
        nicknames: {},
        privateMessages: {},
        courtMessages: [],
        emotions: {},
        assessments: {},
        openingStatements: {},
        presence: {},
        recessCount: {},
        recessUntil: {},
        recessPrivateCursor: {},
        softPrivateUsed: {},
        courtIntroSent: false,
        completeAccepted: {},
        exitAccepted: {},
        completed: false,
        reports: { text: null, generatedAt: null, generating: false },
        game: null,
        games: [],
        nicknameCustomized: {},
      };
    }
    if (!this.dual.memberIds) this.dual.memberIds = [...this.memberIds];
    for (const id of this.memberIds) this.ensureMemberFields(this.dual, id);
    if (this.dual.courtIntroSent == null) this.dual.courtIntroSent = false;
    if (!this.dual.groupName) this.dual.groupName = '树洞';
    if (!this.dual.aiName) this.dual.aiName = 'Lumi';
    if (!this.dual.aiRole) this.dual.aiRole = 'default';
    if (!this.dual.reports) {
      this.dual.reports = { text: null, generatedAt: null, generating: false };
    }
    this.normalizeGames(this.dual);
    return this.dual;
  }

  /** 兼容旧单局 game → games[]；去掉已出结果的局 */
  private normalizeGames(c: DualCase): DualGame[] {
    let list: DualGame[] = Array.isArray(c.games) ? [...c.games] : [];
    if (list.length === 0 && c.game && c.game.phase !== 'result') {
      list = [
        {
          ...c.game,
          id: c.game.id || randomUUID(),
        },
      ];
    }
    list = list
      .filter((g) => g && g.phase !== 'result')
      .map((g) => ({ ...g, id: g.id || randomUUID() }));
    c.games = list;
    c.game = list[0] || null;
    return list;
  }

  private samePair(a: [UserId, UserId], b: [UserId, UserId]) {
    return (
      (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0])
    );
  }

  private findGame(gameId?: string, userId?: UserId): DualGame {
    const c = this.ensureDual();
    const list = this.normalizeGames(c);
    if (gameId) {
      const g = list.find((x) => x.id === gameId);
      if (!g) throw new Error('找不到该局游戏');
      return g;
    }
    if (userId) {
      const mine = list.filter((x) => x.playerIds.includes(userId));
      if (mine.length === 0) throw new Error('当前没有进行中的游戏');
      if (mine.length > 1) throw new Error('请指定游戏局');
      return mine[0]!;
    }
    throw new Error('当前没有进行中的游戏');
  }

  humanMemberIds(): UserId[] {
    return [...this.memberIds];
  }

  otherHuman(userId: UserId): UserId | null {
    const humans = this.humanMemberIds().filter((id) => id !== userId);
    return humans.length === 1 ? humans[0]! : humans[0] || null;
  }

  peerForGame(userId: UserId): UserId {
    const humans = this.humanMemberIds();
    if (humans.length !== 2) throw new Error('默契小游戏需要房间内恰好两名用户');
    const other = humans.find((id) => id !== userId);
    if (!other) throw new Error('找不到对方');
    return other;
  }

  private emptyGameAnswers(
    playerIds: [UserId, UserId],
    count = GAME_QUESTION_COUNT
  ): Record<string, (number | null)[]> {
    return {
      [playerIds[0]]: Array.from({ length: count }, () => null),
      [playerIds[1]]: Array.from({ length: count }, () => null),
    };
  }

  private nickname(uid: UserId) {
    const c = this.ensureDual();
    return c.nicknames[uid] || userRegistry.displayName(uid);
  }

  /**
   * 发起默契小游戏：指定群内一名用户。
   * 同房可多局（不同两人一对）；同一对进行中不可重复发起。
   * 发起方立即进入 playing 可独自答完；被邀请方进入群聊后接受再答题。
   */
  inviteGame(userId: UserId, targetUserId: UserId): DualGame {
    const c = this.ensureDual();
    if (c.completed) throw new Error('本轮已结束');
    const list = this.normalizeGames(c);
    if (!targetUserId || targetUserId === userId) {
      throw new Error('请选择要邀请的用户');
    }
    if (!this.memberIds.includes(targetUserId)) {
      throw new Error('对方不在本房间');
    }
    const playerIds: [UserId, UserId] = [userId, targetUserId];
    if (list.some((g) => this.samePair(g.playerIds, playerIds))) {
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
      answers: this.emptyGameAnswers(playerIds, questionIds.length),
      score: 0,
      playerIds,
    };
    list.push(game);
    c.games = list;
    c.game = game;
    this.addCourt(
      'system',
      `${this.nickname(userId)}向${this.nickname(targetUserId)}发起了默契小游戏`,
      'system'
    );
    return game;
  }

  /** 被邀请方接受邀请后才能答题 */
  acceptGame(userId: UserId, gameId?: string): DualGame {
    const g = this.findGame(gameId, userId);
    if (g.phase !== 'invite' && g.phase !== 'playing') {
      throw new Error('当前没有进行中的游戏');
    }
    if (!g.playerIds.includes(userId)) throw new Error('你不在本局游戏中');
    if (g.startedBy === userId) throw new Error('发起方无需再接受');
    g.accepted[userId] = true;
    if (g.phase === 'invite') g.phase = 'playing';
    this.normalizeGames(this.ensureDual());
    return g;
  }

  /** 发起方取消 / 被邀请方婉拒 */
  declineGame(userId: UserId, gameId?: string) {
    const c = this.ensureDual();
    const g = this.findGame(gameId, userId);
    if (!g.playerIds.includes(userId)) throw new Error('你不在本局游戏中');
    const name = this.nickname(userId);
    const wasStarter = g.startedBy === userId;
    c.games = this.normalizeGames(c).filter((x) => x.id !== g.id);
    c.game = c.games[0] || null;
    this.addCourt(
      'system',
      wasStarter ? `${name}取消了默契小游戏` : `${name}婉拒了默契小游戏`,
      'system'
    );
  }

  /** 独立答题：发起方可先答；被邀请方须先接受；双方都答完才出结果并发群 */
  answerGame(
    userId: UserId,
    optionIndex: number,
    questionIndex?: number,
    gameId?: string
  ): DualGame {
    const c = this.ensureDual();
    const g = this.findGame(gameId, userId);
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
      const nameA = this.nickname(a);
      const nameB = this.nickname(b);
      this.addCourt(
        'lumi',
        formatGameResultCourtMessage({
          nameA,
          nameB,
          questionIds: g.questionIds || [],
          answersA,
          answersB,
          score,
          percent,
          level,
          comment,
        })
      );
      // 出结果后移除本局，同一对可再开
      c.games = this.normalizeGames(c).filter((x) => x.id !== g.id);
      c.game = c.games[0] || null;
    } else {
      this.normalizeGames(c);
    }
    return g;
  }

  /** @deprecated 结果改发群聊，不再需要关闭清局 */
  closeGame(gameId?: string) {
    const c = this.ensureDual();
    if (gameId) {
      c.games = this.normalizeGames(c).filter((x) => x.id !== gameId);
    } else {
      c.games = [];
    }
    c.game = c.games[0] || null;
  }

  restartGame(userId: UserId, gameId?: string): DualGame {
    const c = this.ensureDual();
    if (c.completed) throw new Error('本轮已结束');
    let target: UserId | undefined;
    try {
      const prev = this.findGame(gameId, userId);
      target = prev.playerIds.find((id) => id !== userId);
      this.declineGame(userId, prev.id);
    } catch {
      target = this.memberIds.find((id) => id !== userId);
    }
    if (!target) throw new Error('请选择要邀请的用户');
    return this.inviteGame(userId, target);
  }

  addPrivate(userId: UserId, from: ChatMessage['user'], text: string, image?: string) {
    const c = this.ensureDual();
    this.ensureMemberFields(c, userId);
    const m = msg(from, text, 'chat', image);
    c.privateMessages[userId].push(m);
    return m;
  }

  addCourt(
    from: ChatMessage['user'],
    text: string,
    kind: ChatMessage['kind'] = 'chat',
    image?: string
  ) {
    const c = this.ensureDual();
    const m = msg(from, text, kind, image);
    c.courtMessages.push(m);
    return m;
  }

  resetDual() {
    const members = [...this.memberIds];
    this.dual = null;
    const c = this.ensureDual();
    for (const id of members) this.ensureMemberFields(c, id);
    return c;
  }

  clearSingle(userId: UserId) {
    clearPersonalSingle(userId);
    this.singles[userId] = null;
  }

  setEmotions(userId: UserId, emotions: EmotionMark[]) {
    const c = this.ensureDual();
    this.ensureMemberFields(c, userId);
    c.emotions[userId] = emotions;
  }

  setAssessment(userId: UserId, assessment: AssessmentResult) {
    const c = this.ensureDual();
    this.ensureMemberFields(c, userId);
    c.assessments[userId] = assessment;
  }

  setDualMeta(
    userId: UserId,
    payload: { groupName?: string; aiName?: string; nickname?: string }
  ) {
    const c = this.ensureDual();
    this.ensureMemberFields(c, userId);
    const norm = (v: string) => v.trim().replace(/\s+/g, ' ').slice(0, 20);
    if (typeof payload.groupName === 'string') {
      const next = norm(payload.groupName);
      c.groupName = next || '树洞';
    }
    if (typeof payload.aiName === 'string') {
      const next = norm(payload.aiName);
      c.aiName = next || 'Lumi';
    }
    if (typeof payload.nickname === 'string') {
      const next = norm(payload.nickname);
      c.nicknames[userId] =
        next || userRegistry.displayName(userId);
      if (!c.nicknameCustomized) c.nicknameCustomized = {};
      c.nicknameCustomized[userId] = true;
    }
  }

  /** 同步个人资料到房间展示（头像等来自全局账号） */
  syncProfileFromAccount(userId: UserId, patch: Partial<PersonProfile>) {
    const next = userRegistry.updateProfile(userId, patch);
    if (typeof patch.displayName === 'string' && this.dual) {
      const c = this.ensureDual();
      if (!c.nicknameCustomized) c.nicknameCustomized = {};
      if (!c.nicknameCustomized[userId]) {
        c.nicknames[userId] = next.displayName;
      }
    }
    this.persist();
    return next;
  }

  setOpening(userId: UserId, polished: string) {
    const c = this.ensureDual();
    this.ensureMemberFields(c, userId);
    const statement: OpeningStatement = {
      polished,
      confirmedAt: new Date().toISOString(),
      relayed: false,
    };
    c.openingStatements[userId] = statement;
    return statement;
  }

  ensureCourtIntro() {
    const c = this.ensureDual();
    if (c.courtIntroSent) return;
    c.courtIntroSent = true;
    const who = c.aiName || 'Lumi';
    this.addCourt(
      'lumi',
      [
        `欢迎来到树洞～我是 ${who}。`,
        '这里可以慢慢说：不必急着对错，把卡住的事摊开一起看看就行。',
        '',
        '想单独说时，点我的头像进私聊（对方看不到）。',
        '群聊里也可以 @ 我。',
      ].join('\n')
    );
  }

  bootstrapCourt(userId: UserId) {
    const c = this.ensureDual();
    this.ensureMemberFields(c, userId);
    this.ensureCourtIntro();
    if (c.presence[userId] === 'offline') {
      c.presence[userId] = 'court';
      c.recessUntil[userId] = null;
    }
  }

  goPrivateChat(userId: UserId) {
    const c = this.ensureDual();
    this.ensureMemberFields(c, userId);
    if (c.completed) throw new Error('本轮已结束');
    if (c.presence[userId] !== 'court') throw new Error('当前不在群聊');
    if (c.softPrivateUsed[userId]) {
      throw new Error('请点「回到私聊」并选择返回时间');
    }
    c.softPrivateUsed[userId] = true;
    c.presence[userId] = 'private';
    c.openingStatements[userId] = null;
    c.recessPrivateCursor[userId] = (c.privateMessages[userId] || []).length;
  }

  enterCourt(userId: UserId, selfName: string) {
    const c = this.ensureDual();
    this.ensureMemberFields(c, userId);
    if (c.completed) throw new Error('本轮已结束');
    const opening = c.openingStatements[userId];
    if (!opening?.polished) throw new Error('请先确认「想说给对方的话」');

    c.presence[userId] = 'court';
    c.recessUntil[userId] = null;

    const events: ChatMessage[] = [];
    if (!opening.relayed) {
      events.push(
        this.addCourt('system', `${selfName}分享了想对对方说的话`, 'system')
      );
      events.push(this.addCourt(userId, opening.polished, 'opening'));
      opening.relayed = true;
    }
    return events;
  }

  leaveToPrivate(userId: UserId, selfName: string, minutes: number) {
    const c = this.ensureDual();
    this.ensureMemberFields(c, userId);
    if (c.presence[userId] !== 'court') throw new Error('当前不在群聊');
    if (c.recessCount[userId] >= 3) throw new Error('回到私聊次数已达上限（3次）');

    c.recessCount[userId] += 1;
    c.presence[userId] = 'private';
    c.recessPrivateCursor[userId] = (c.privateMessages[userId] || []).length;

    const resume = new Date(Date.now() + minutes * 60_000);
    const hhmm = formatBeijingClock(resume);
    c.recessUntil[userId] = hhmm;
    c.openingStatements[userId] = null;

    const m = this.addCourt(
      'system',
      `${selfName}回到私聊，返回时间为${hhmm}之前`,
      'system'
    );
    return { message: m, until: hhmm };
  }

  returnToCourt(userId: UserId, selfName: string) {
    const c = this.ensureDual();
    this.ensureMemberFields(c, userId);
    if (c.completed) throw new Error('本轮已结束');
    const opening = c.openingStatements[userId];
    if (!opening?.polished) throw new Error('请先重新确认「想说给对方的话」');

    c.presence[userId] = 'court';
    c.recessUntil[userId] = null;

    const events: ChatMessage[] = [];
    events.push(this.addCourt('system', `${selfName}已回到群聊`, 'system'));
    if (!opening.relayed) {
      events.push(this.addCourt(userId, opening.polished, 'opening'));
      opening.relayed = true;
    }
    return events;
  }

  /** 单人结案：立即完成并触发生成报告（由上层调 AI） */
  completeCase(userId: UserId): boolean {
    const c = this.ensureDual();
    if (c.completed) return true;
    const name = this.nickname(userId);
    c.completed = true;
    c.completeAccepted[userId] = true;
    this.addCourt('system', `${name}生成了结案报告`, 'system');
    this.addCourt('lumi', '辛苦了。本轮先到这里。之后想说还可以再来～');
    return true;
  }

  ensureSingle(userId: UserId, relationType: RelationType) {
    const s = ensurePersonalSingle(userId, relationType);
    this.singles[userId] = s;
    return s;
  }

  addSingleMessage(userId: UserId, from: ChatMessage['user'], text: string, image?: string) {
    return addPersonalSingleMessage(userId, from, text, image);
  }

  ensureWelcome(userId: UserId) {
    const c = this.ensureDual();
    this.ensureMemberFields(c, userId);
    if (!c.privateMessages[userId].length) {
      const who = c.aiName || 'Lumi';
      this.addPrivate(
        userId,
        'lumi',
        `我是 ${who}，这里是你的私密空间，对方看不到。想到什么说什么就行。也可以点「+」用标记情绪、关系速测或嘴替。`
      );
    }
  }

  displayUsers(): Record<string, ReturnType<typeof toUserProfile>> {
    const out: Record<string, ReturnType<typeof toUserProfile>> = {};
    for (const id of this.memberIds) {
      out[id] = toUserProfile(id, this.nickname(id));
    }
    return out;
  }
}

// ─── Room manager ────────────────────────────────────────────

export class RoomManager {
  rooms = new Map<string, Store>();
  byCode = new Map<string, string>();

  constructor() {
    const index = loadJson<RoomsIndex>(ROOMS_INDEX_FILE, { rooms: [] });
    for (const row of index.rooms || []) {
      const sessionPath = path.join(DATA_DIR, `room.${row.id}.session.json`);
      const infoPathExists = fs.existsSync(sessionPath);
      let memberIds: UserId[] = [];
      if (infoPathExists) {
        const saved = loadJson<PersistedSessionLike | null>(sessionPath, null);
        memberIds = saved?.dual?.memberIds || [];
      }
      const info: RoomInfo = {
        id: row.id,
        code: row.code,
        memberIds,
        createdAt: new Date().toISOString(),
      };
      const store = new Store(info);
      this.rooms.set(row.id, store);
      this.byCode.set(row.code.toUpperCase(), row.id);
    }
    console.log(`[rooms] loaded ${this.rooms.size} rooms`);
  }

  private persistIndex() {
    const rooms = [...this.rooms.values()].map((s) => ({
      id: s.roomId,
      code: s.code,
    }));
    writeJson(ROOMS_INDEX_FILE, { rooms });
  }

  get(roomId: string | null | undefined) {
    if (!roomId) return null;
    return this.rooms.get(roomId) || null;
  }

  getByCode(code: string) {
    const id = this.byCode.get(code.trim().toUpperCase());
    return id ? this.rooms.get(id) || null : null;
  }

  /** 首页列表：按用户已加入房间 id 生成摘要（已不存在的会跳过） */
  summariesForUser(joinedRoomIds: string[]) {
    const out: {
      id: string;
      code: string;
      groupName: string;
      memberCount: number;
    }[] = [];
    for (const id of joinedRoomIds) {
      const store = this.rooms.get(id);
      if (!store) continue;
      out.push({
        id: store.roomId,
        code: store.code,
        groupName: store.dual?.groupName || '树洞',
        memberCount: store.memberIds.length,
      });
    }
    return out;
  }

  createRoom(
    ownerId: UserId,
    opts: { aiRole?: string; groupName?: string; aiName?: string } = {}
  ): Store {
    let code = genRoomCode();
    while (this.byCode.has(code)) code = genRoomCode();
    const role = getAiRole(isAiRoleId(opts.aiRole) ? opts.aiRole : 'default');
    const groupName = normalizeRoomLabel(
      typeof opts.groupName === 'string' ? opts.groupName : role.defaultGroupName,
      role.defaultGroupName
    );
    const aiName = normalizeRoomLabel(
      typeof opts.aiName === 'string' ? opts.aiName : role.displayName,
      role.displayName
    );
    const info: RoomInfo = {
      id: randomUUID(),
      code,
      memberIds: [ownerId],
      createdAt: new Date().toISOString(),
    };
    const store = new Store(info);
    store.addMember(ownerId);
    const dual = store.ensureDual();
    dual.aiRole = role.id;
    dual.aiName = aiName;
    dual.groupName = groupName;
    store.ensureWelcome(ownerId);
    store.bootstrapCourt(ownerId);
    this.rooms.set(info.id, store);
    this.byCode.set(code, info.id);
    this.persistIndex();
    store.persist();
    return store;
  }

  joinRoom(userId: UserId, rawCode: string): Store {
    const store = this.getByCode(rawCode);
    if (!store) throw new Error('房间码无效');
    store.addMember(userId);
    store.ensureDual();
    store.ensureWelcome(userId);
    store.bootstrapCourt(userId);
    store.persist();
    this.persistIndex();
    return store;
  }

  leaveRoom(userId: UserId, roomId: string) {
    const store = this.get(roomId);
    if (!store) {
      userRegistry.forgetRoom(userId, roomId);
      return null;
    }
    store.removeMember(userId);
    // 踢掉该用户在房间的 socket 映射由上层处理
    store.persist();
    this.persistIndex();
    return store;
  }

  allStores(): Store[] {
    return [...this.rooms.values()];
  }
}

export const roomManager = new RoomManager();

export function emptySnapshot() {
  return {
    dual: null,
    single: {} as Record<string, SingleCase | null>,
    online: {} as Record<string, boolean>,
    records: [] as JudgeRecord[],
    profiles: {} as Record<string, PersonProfile>,
    account: null,
    room: null as RoomInfo | null,
  };
}

export function allActiveStores(): Store[] {
  return roomManager.allStores();
}
