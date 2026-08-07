import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  JUDGE_EMOTIONS,
  RELATION_TYPES,
  toUserProfile,
  type AssessmentResult,
  type ChatMessage,
  type ClientSnapshot,
  type EmotionMark,
  type RelationType,
  type UserId,
  type UserProfile,
} from '../../shared/types';
import { emitAck, getSocket } from './lib/socket';
import {
  cloudCreateRoom,
  cloudGameAccept,
  cloudGameAnswer,
  cloudGameDecline,
  cloudGameInvite,
  cloudJoinRoom,
  cloudLeaveRoom,
  cloudLogin,
  cloudPullMessages,
  cloudSendMessage,
  cloudSingleAssessment,
  cloudSingleEmotions,
  cloudSingleExit,
  cloudSingleSend,
  cloudSingleStart,
  cloudStatus,
  cloudUpdateProfile,
  cloudCompleteRoom,
  cloudGetReport,
  cloudRoomEmotions,
  cloudRoomAssessment,
  cloudUpdateRoomMeta,
  type CloudChatMessage,
  type CloudJoinedRoom,
} from './lib/cloudApi';
import type { DualGame, JoinedRoomSummary, PersonProfile, Presence, SingleCase } from '../../shared/types';
import { AI_ROLES, type AiRoleId } from '../../shared/aiRoles';
import { QuizModal } from './components/QuizModal';
import { MouthpieceModal } from './components/MouthpieceModal';
import { GameModal } from './components/GameModal';
import { ProfilePage } from './components/ProfilePage';
import { RecordsModal } from './components/RecordsModal';
import { SheetModal } from './components/SheetModal';
import { HomeScreen } from './components/HomeScreen';
import { FindBuddyDemo } from './components/FindBuddyDemo';
import { emptyPersonProfile, shortFromName } from '../../shared/profile';

type Screen =
  | 'login'
  | 'home'
  | 'profile'
  | 'dual'
  | 'single-pick'
  | 'single'
  | 'find-buddy';
type Ack = {
  ok: boolean;
  error?: string;
  polished?: string;
  tip?: string;
  thin?: boolean;
  report?: string;
  generating?: boolean;
  userId?: UserId;
  nickname?: string;
  lastRoomId?: string | null;
  joinedRoomIds?: string[];
  roomId?: string;
  code?: string;
  exited?: boolean;
};

const ACCOUNT_KEY = 'lumi-account';

type StoredAccount = { userId: UserId; nickname: string };

function readStoredAccount(): StoredAccount | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as StoredAccount;
    if (o?.userId && o?.nickname) return { userId: String(o.userId), nickname: String(o.nickname) };
  } catch {
    /* ignore */
  }
  return null;
}

function writeStoredAccount(account: StoredAccount) {
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  } catch {
    /* ignore */
  }
}

function clearStoredAccount() {
  try {
    localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    /* ignore */
  }
}

type CloudPullResult = Awaited<ReturnType<typeof cloudPullMessages>>;

function toChatMessages(msgs: CloudChatMessage[]): ChatMessage[] {
  return msgs.map((m) => ({
    id: m.id,
    user: m.user as ChatMessage['user'],
    text: m.text,
    time: m.time,
    kind: (m.kind as ChatMessage['kind']) || 'chat',
    ...(m.image ? { image: m.image } : {}),
  }));
}

function joinedFromCloud(rooms: CloudJoinedRoom[]): JoinedRoomSummary[] {
  return rooms.map((r) => ({
    id: r.id,
    code: r.code,
    groupName: r.groupName,
    memberCount: r.memberCount,
  }));
}

/** 将云端 pull 结果转成 ClientSnapshot，空字段给默认值避免 UI 崩溃 */
function applyCloudRoomSnapshot(
  pull: CloudPullResult,
  userId: UserId,
  prev: ClientSnapshot | null,
  joinedRooms?: JoinedRoomSummary[]
): ClientSnapshot {
  const members = pull.members || [];
  const memberIds = members.map((m) => m.userId);
  const nicknames: Record<string, string> = {};
  const profiles: Record<string, PersonProfile> = { ...(prev?.profiles || {}) };
  const online: Record<string, boolean> = { ...(prev?.online || {}) };
  const presence: Record<string, Presence> = {};
  const emotions: Record<string, EmotionMark[]> = {};
  const assessments: Record<string, AssessmentResult | null> = {};
  const recessCount: Record<string, number> = {};
  const recessUntil: Record<string, string | null> = {};
  const recessPrivateCursor: Record<string, number | null> = {};
  const softPrivateUsed: Record<string, boolean> = {};
  const completeAccepted: Record<string, boolean> = {};
  const exitAccepted: Record<string, boolean> = {};

  for (const m of members) {
    nicknames[m.userId] = m.nickname;
    online[m.userId] = true;
    presence[m.userId] = 'court';
    emotions[m.userId] = prev?.dual?.emotions?.[m.userId] || [];
    assessments[m.userId] = prev?.dual?.assessments?.[m.userId] ?? null;
    recessCount[m.userId] = prev?.dual?.recessCount?.[m.userId] || 0;
    recessUntil[m.userId] = prev?.dual?.recessUntil?.[m.userId] ?? null;
    recessPrivateCursor[m.userId] = prev?.dual?.recessPrivateCursor?.[m.userId] ?? null;
    softPrivateUsed[m.userId] = prev?.dual?.softPrivateUsed?.[m.userId] || false;
    completeAccepted[m.userId] = false;
    exitAccepted[m.userId] = false;
    if (m.profile && typeof m.profile === 'object') {
      profiles[m.userId] = {
        ...emptyPersonProfile(m.nickname),
        ...(m.profile as Partial<PersonProfile>),
        displayName:
          (m.profile as Partial<PersonProfile>).displayName || m.nickname,
      };
    } else if (!profiles[m.userId]) {
      profiles[m.userId] = emptyPersonProfile(m.nickname);
    }
  }

  const rooms = joinedRooms || prev?.account?.joinedRooms || [];
  const nick =
    prev?.account?.nickname || nicknames[userId] || profiles[userId]?.displayName || '我';

  return {
    dual: {
      id: pull.room.id,
      playMode: 'dual',
      createdAt: prev?.dual?.createdAt || new Date().toISOString(),
      groupName: pull.room.groupName || '群聊',
      aiName: pull.room.aiName || 'Lumi',
      aiRole: pull.room.aiRole || prev?.dual?.aiRole || 'default',
      memberIds,
      nicknames,
      privateMessages: {
        ...(prev?.dual?.privateMessages || {}),
        [userId]: toChatMessages(pull.privateMessages || []),
      },
      courtMessages: toChatMessages(pull.courtMessages || []),
      emotions,
      assessments,
      openingStatements: Object.fromEntries(
        memberIds.map((id) => [id, prev?.dual?.openingStatements?.[id] ?? null])
      ),
      presence,
      recessCount,
      recessUntil,
      recessPrivateCursor,
      softPrivateUsed,
      courtIntroSent: prev?.dual?.courtIntroSent ?? true,
      completeAccepted,
      exitAccepted,
      completed: Boolean(pull.room.completed),
      reports: {
        text: pull.room.reports?.text ?? prev?.dual?.reports?.text ?? null,
        generatedAt:
          pull.room.reports?.generatedAt ??
          prev?.dual?.reports?.generatedAt ??
          null,
        generating: Boolean(
          pull.room.reports?.generating ?? prev?.dual?.reports?.generating
        ),
      },
      games: (() => {
        const list = Array.isArray(pull.games)
          ? (pull.games as DualGame[])
          : pull.game
            ? [pull.game as DualGame]
            : [];
        return list.filter((g) => g && g.phase !== 'result');
      })(),
      game: (() => {
        const list = Array.isArray(pull.games)
          ? (pull.games as DualGame[])
          : pull.game
            ? [pull.game as DualGame]
            : [];
        const active = list.filter((g) => g && g.phase !== 'result');
        return active[0] || null;
      })(),
      nicknameCustomized: prev?.dual?.nicknameCustomized || {},
    },
    single: prev?.single || {},
    online,
    records: prev?.records || [],
    profiles,
    account: {
      userId,
      nickname: nick,
      lastRoomId: pull.room.id,
      joinedRoomIds: rooms.map((r) => r.id),
      joinedRooms: rooms,
    },
    room: {
      id: pull.room.id,
      code: pull.room.code,
      memberIds,
      createdAt: prev?.room?.createdAt || new Date().toISOString(),
    },
  };
}

function cleanChatMarkdown(text: string) {
  return text
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*\n])\*([^*\n]+)\*(?!\*)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*•]\s+/gm, '· ')
    .replace(/`+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderTextWithMentions(text: string) {
  const cleaned = cleanChatMarkdown(text);
  const lines = cleaned.split('\n');
  return lines.map((line, li) => {
    const parts = line.split(/(@[\u4e00-\u9fa5A-Za-z]+)/g);
    return (
      <span key={li}>
        {li > 0 ? <br /> : null}
        {parts.map((p, i) =>
          p.startsWith('@') ? (
            <span key={i} className="mention">
              {p}
            </span>
          ) : (
            <span key={i}>{p}</span>
          )
        )}
      </span>
    );
  });
}

function ToolIconEmotion() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  );
}

function ToolIconQuiz() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 12h6M9 16h4" />
    </svg>
  );
}

export default function App() {
  const storedInit = readStoredAccount();
  const [userId, setUserId] = useState<UserId | null>(null);
  const [loginNickname, setLoginNickname] = useState(() => storedInit?.nickname || '');
  const [screen, setScreen] = useState<Screen>('login');
  const [state, setState] = useState<ClientSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cloudEnabled, setCloudEnabled] = useState<boolean | null>(null);
  const [dualView, setDualView] = useState<'private' | 'court'>('court');
  const [text, setText] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [privateInfoOpen, setPrivateInfoOpen] = useState(false);
  const [singleInfoOpen, setSingleInfoOpen] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [metaConfirm, setMetaConfirm] = useState<
    | { type: 'groupName'; value: string }
    | { type: 'nickname'; value: string }
    | { type: 'aiName'; value: string }
    | null
  >(null);
  const [groupSearch, setGroupSearch] = useState('');
  const [privateSearch, setPrivateSearch] = useState('');
  const [singleSearch, setSingleSearch] = useState('');
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [aiNameDraft, setAiNameDraft] = useState('');
  const [emotionOpen, setEmotionOpen] = useState(false);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [openingPhase, setOpeningPhase] = useState<'loading' | 'confirm' | 'error'>('loading');
  const [openingIntent, setOpeningIntent] = useState<'enter' | 'return'>('enter');
  const [openingError, setOpeningError] = useState('');
  const [openingTip, setOpeningTip] = useState('');
  const [polished, setPolished] = useState('');
  const [emotionDraft, setEmotionDraft] = useState<Record<string, number>>({});
  const [completeOpen, setCompleteOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [joinRoomOpen, setJoinRoomOpen] = useState(false);
  const [joinCodeDraft, setJoinCodeDraft] = useState('');
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [createAiRole, setCreateAiRole] = useState<AiRoleId>('default');
  const [roomCodeCopied, setRoomCodeCopied] = useState(false);
  const [gamePickOpen, setGamePickOpen] = useState(false);
  /** 答完后本地关掉弹窗的局（不取消游戏） */
  const [dismissedGameIds, setDismissedGameIds] = useState<string[]>([]);
  const [recessOpen, setRecessOpen] = useState(false);
  const [recessChoice, setRecessChoice] = useState<number | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [mouthpieceOpen, setMouthpieceOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState('');
  const [stickToBottom, setStickToBottom] = useState(true);
  const [showJumpBottom, setShowJumpBottom] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stickRef = useRef(true);
  const screenRef = useRef(screen);
  const roomIdRef = useRef<string | null>(null);
  const restoringRef = useRef(false);
  const cloudEnabledRef = useRef<boolean | null>(null);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);
  useEffect(() => {
    roomIdRef.current = state?.room?.id ?? null;
  }, [state?.room?.id]);
  useEffect(() => {
    cloudEnabledRef.current = cloudEnabled;
  }, [cloudEnabled]);

  useEffect(() => {
    let cancelled = false;
    async function probe() {
      for (let i = 0; i < 4; i++) {
        try {
          const s = await cloudStatus();
          if (cancelled) return;
          const on = Boolean(s.supabase);
          cloudEnabledRef.current = on;
          setCloudEnabled(on);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 600 * (i + 1)));
        }
      }
      if (cancelled) return;
      // 线上站禁止回退本机 Socket
      const host = window.location.hostname;
      const isLocal =
        host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
      cloudEnabledRef.current = false;
      setCloudEnabled(false);
      if (!isLocal) {
        setError(
          '云端接口暂不可用。请稍后刷新；若持续失败，到 Vercel → Settings → Environment Variables 确认已配置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY，并 Redeploy。'
        );
      }
    }
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // 等云端探测完成；云端模式不连 Socket
    if (cloudEnabled !== false) return;

    const s = getSocket();
    const onState = (snap: ClientSnapshot) => setState(snap);
    const onKicked = () => {
      setUserId(null);
      setState(null);
      setScreen('login');
    };
    const onDualExited = () => {
      setExitOpen(false);
      setCompleteOpen(false);
      setMoreOpen(false);
      setScreen('home');
    };

    async function restoreOnConnect() {
      const stored = readStoredAccount();
      if (!stored || restoringRef.current) return;
      restoringRef.current = true;
      try {
        const res = await emitAck<Ack>('login', { userId: stored.userId });
        if (!res?.ok) {
          if (res?.error?.includes('不存在')) clearStoredAccount();
          return;
        }
        setUserId(res.userId!);
        writeStoredAccount({
          userId: res.userId!,
          nickname: res.nickname || stored.nickname,
        });
        const rid = roomIdRef.current;
        if (screenRef.current === 'dual' && rid) {
          await emitAck<Ack>('room:join', { roomId: rid });
        } else if (screenRef.current === 'login') {
          setScreen('home');
        }
      } catch {
        /* ignore reconnect errors */
      } finally {
        restoringRef.current = false;
      }
    }

    s.on('state', onState);
    s.on('kicked', onKicked);
    s.on('dual:exited', onDualExited);
    s.on('connect', () => {
      void restoreOnConnect();
    });
    if (s.connected) void restoreOnConnect();
    return () => {
      s.off('state', onState);
      s.off('kicked', onKicked);
      s.off('dual:exited', onDualExited);
    };
  }, [cloudEnabled]);

  // 云端探测完成后补一次会话恢复（socket connect 可能早于探测结果）
  useEffect(() => {
    if (cloudEnabled === null) return;
    const stored = readStoredAccount();
    if (!stored) return;
    if (cloudEnabled) {
      void (async () => {
        if (restoringRef.current || userId) return;
        restoringRef.current = true;
        try {
          const res = await cloudLogin({ userId: stored.userId });
          setUserId(res.userId);
          writeStoredAccount({
            userId: res.userId,
            nickname: res.nickname || stored.nickname,
          });
          setLoginNickname(res.nickname || stored.nickname);
          const rooms = joinedFromCloud(res.joinedRooms);
          setState({
            dual: null,
            single: {},
            online: {},
            records: [],
            profiles: {},
            account: {
              userId: res.userId,
              nickname: res.nickname,
              lastRoomId: null,
              joinedRoomIds: rooms.map((r) => r.id),
              joinedRooms: rooms,
            },
            room: null,
          });
          if (screenRef.current === 'login') setScreen('home');
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes('不存在')) clearStoredAccount();
        } finally {
          restoringRef.current = false;
        }
      })();
      return;
    }
    const s = getSocket();
    if (s.connected && !userId) {
      void (async () => {
        if (restoringRef.current) return;
        restoringRef.current = true;
        try {
          const res = await emitAck<Ack>('login', { userId: stored.userId });
          if (!res?.ok) {
            if (res?.error?.includes('不存在')) clearStoredAccount();
            return;
          }
          setUserId(res.userId!);
          writeStoredAccount({
            userId: res.userId!,
            nickname: res.nickname || stored.nickname,
          });
          if (screenRef.current === 'login') setScreen('home');
        } catch {
          /* ignore */
        } finally {
          restoringRef.current = false;
        }
      })();
    }
  }, [cloudEnabled]);

  // 登录后发心跳；服务端靠心跳判定在线，避免幽灵 socket 一直显示在线
  useEffect(() => {
    if (!userId || cloudEnabled === true) return;
    const s = getSocket();
    const beat = () => {
      if (s.connected) s.emit('heartbeat');
    };
    beat();
    const t = window.setInterval(beat, 4000);
    return () => window.clearInterval(t);
  }, [userId, cloudEnabled]);

  function isNearBottom(el: HTMLDivElement, px = 80) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < px;
  }

  function scrollMessagesToBottom(smooth = true) {
    const el = messagesRef.current;
    if (!el) return;
    const top = el.scrollHeight;
    if (smooth) {
      el.scrollTo({ top, behavior: 'smooth' });
    } else {
      el.scrollTop = top;
    }
    stickRef.current = true;
    setStickToBottom(true);
    setShowJumpBottom(false);
  }

  /** 布局未完成时多刷几次，避免切群聊后历史空白要手动滚动才出现 */
  function forceStickBottom() {
    stickRef.current = true;
    setStickToBottom(true);
    setShowJumpBottom(false);
    const run = () => {
      const el = messagesRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    };
    run();
    requestAnimationFrame(() => {
      run();
      requestAnimationFrame(run);
    });
    window.setTimeout(run, 50);
    window.setTimeout(run, 120);
  }

  function onMessagesScroll() {
    const el = messagesRef.current;
    if (!el) return;
    const near = isNearBottom(el);
    stickRef.current = near;
    setStickToBottom(near);
    setShowJumpBottom(!near);
  }

  const dual = state?.dual ?? null;
  const room = state?.room ?? null;
  const account = state?.account ?? null;

  // 云端：在群聊内轮询（仅有变化时更新，避免整页重绘卡顿）
  useEffect(() => {
    if (cloudEnabled !== true || screen !== 'dual' || !userId || !dual?.id) return;
    const roomId = dual.id;
    let cancelled = false;
    let lastSig = '';
    const tick = async () => {
      try {
        const pull = await cloudPullMessages(userId, roomId);
        if (cancelled) return;
        const games = Array.isArray(pull.games) ? pull.games : [];
        const sig = [
          pull.courtMessages?.length || 0,
          pull.privateMessages?.length || 0,
          games.length,
          games
            .map(
              (g) =>
                `${(g as DualGame).id}:${(g as DualGame).phase}:${JSON.stringify((g as DualGame).answers)}`
            )
            .join('|'),
        ].join('#');
        if (sig === lastSig) return;
        lastSig = sig;
        setState((prev) => applyCloudRoomSnapshot(pull, userId, prev));
      } catch {
        /* ignore transient poll errors */
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [cloudEnabled, screen, userId, dual?.id]);

  // 换房时清空本地「已关闭弹窗」记录
  useEffect(() => {
    setDismissedGameIds([]);
  }, [dual?.id]);

  const users: Record<string, UserProfile> = useMemo(() => {
    const out: Record<string, UserProfile> = {};
    const add = (id: string, name: string) => {
      out[id] = toUserProfile(id, name);
    };
    const nick = account?.nickname || loginNickname || '我';
    if (userId) {
      const pn = state?.profiles?.[userId]?.displayName || nick;
      add(userId, pn);
    }
    const memberIds = dual?.memberIds || room?.memberIds || [];
    for (const id of memberIds) {
      const name =
        dual?.nicknames?.[id] ||
        state?.profiles?.[id]?.displayName ||
        (id === userId ? nick : undefined) ||
        '用户';
      add(id, name);
    }
    for (const [id, p] of Object.entries(state?.profiles || {})) {
      if (!out[id]) add(id, p.displayName || '用户');
    }
    return out;
  }, [
    userId,
    account?.nickname,
    loginNickname,
    dual?.memberIds,
    dual?.nicknames,
    room?.memberIds,
    state?.profiles,
  ]);

  const me = userId ? users[userId] || toUserProfile(userId, account?.nickname || loginNickname || '我') : null;
  const otherId =
    (dual?.memberIds || room?.memberIds || []).find((id) => id !== userId) || null;
  const other = otherId
    ? users[otherId] ||
      toUserProfile(
        otherId,
        dual?.nicknames?.[otherId] || state?.profiles?.[otherId]?.displayName || '对方'
      )
    : null;
  const single = userId ? state?.single?.[userId] ?? null : null;
  /** 服务端共享沟通记录：穿透链接各端同看 */
  const records = state?.records ?? [];
  const profiles = state?.profiles;
  const myProfile =
    userId && profiles?.[userId]
      ? profiles[userId]
      : emptyPersonProfile(me?.name || '我');
  const profileOf = (id: UserId): PersonProfile =>
    profiles?.[id] || emptyPersonProfile(users[id]?.name || '用户');
  const personalName = (id: UserId) => profileOf(id).displayName || users[id]?.name || '用户';
  const avatarOf = (id: UserId) => profileOf(id).avatar || null;
  const myPresence = userId && dual ? dual.presence[userId] : 'offline';
  const hasOpening = Boolean(userId && dual?.openingStatements?.[userId]?.polished);
  const myEmotions =
    screen === 'single'
      ? single?.emotions || []
      : userId && dual
        ? dual.emotions[userId] || []
        : [];
  const myAssessment =
    screen === 'single'
      ? single?.assessment
      : userId && dual
        ? dual.assessments[userId]
        : null;
  const hasAssessment = Boolean(myAssessment);
  const dualNicknames = dual?.nicknames || {};
  const aiDisplayName = dual?.aiName || 'Lumi';
  const groupName = dual?.groupName || '树洞';

  const labelForDualUser = (id: UserId) => dualNicknames[id] || personalName(id);
  const shortForUser = (id: UserId) =>
    shortFromName(labelForDualUser(id), users[id]?.shortName || '?');
  const speakerLabel = (uid: ChatMessage['user']) => {
    if (uid === 'lumi') return screen === 'dual' ? aiDisplayName : 'Lumi';
    if (uid === 'system') return '系统';
    if (typeof uid === 'string' && uid) {
      if (screen === 'dual') return labelForDualUser(uid);
      return personalName(uid);
    }
    return String(uid);
  };

  useEffect(() => {
    if (screen !== 'dual' || !dual || !userId) return;
    setNicknameDraft(labelForDualUser(userId));
    setAiNameDraft(aiDisplayName);
    setGroupNameDraft(groupName);
  }, [
    screen,
    dual?.id,
    dual?.nicknames,
    dual?.aiName,
    dual?.groupName,
    userId,
  ]);

  const groupSearchResults = useMemo(() => {
    if (!dual || !groupSearch.trim()) return [];
    const key = groupSearch.trim().toLowerCase();
    return dual.courtMessages
      .filter((m) => (m.text || '').toLowerCase().includes(key))
      .slice(-60);
  }, [dual, groupSearch]);

  const privateSearchResults = useMemo(() => {
    if (!dual || !userId || !privateSearch.trim()) return [];
    const key = privateSearch.trim().toLowerCase();
    return (dual.privateMessages[userId] || [])
      .filter((m) => (m.text || '').toLowerCase().includes(key))
      .slice(-60);
  }, [dual, userId, privateSearch]);

  const singleSearchResults = useMemo(() => {
    if (!single || !singleSearch.trim()) return [];
    const key = singleSearch.trim().toLowerCase();
    return single.messages.filter((m) => (m.text || '').toLowerCase().includes(key)).slice(-60);
  }, [single, singleSearch]);

  useEffect(() => {
    if (!focusMessageId) return;
    const t = window.setTimeout(() => setFocusMessageId(null), 1800);
    return () => window.clearTimeout(t);
  }, [focusMessageId]);

  // 切页 / 切私聊群聊：等布局后贴底
  useLayoutEffect(() => {
    if (screen !== 'dual' && screen !== 'single') return;
    forceStickBottom();
  }, [dualView, screen, dual?.id]);

  useEffect(() => {
    setPlusOpen(false);
    if (screen !== 'dual') {
      setGroupInfoOpen(false);
      setPrivateInfoOpen(false);
      return;
    }
    if (dualView === 'court') setPrivateInfoOpen(false);
    if (dualView === 'private') setGroupInfoOpen(false);
  }, [screen, dualView]);

  // 消息区高度变化（切换视图后内容渲染）时若应贴底则再贴一次
  useEffect(() => {
    const el = messagesRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [screen, dualView]);

  const messages = useMemo(() => {
    if (!userId) return [];
    if (screen === 'single' && single) return single.messages;
    if (screen === 'dual' && dual) {
      if (dualView === 'court') return dual.courtMessages;
      return dual.privateMessages[userId] || [];
    }
    return [];
  }, [screen, dual, single, dualView, userId]);

  // 新消息：仅在贴底时跟滚，否则显示「回到底部」
  useEffect(() => {
    if (screen !== 'dual' && screen !== 'single') return;
    if (stickRef.current) {
      forceStickBottom();
    } else {
      setShowJumpBottom(true);
    }
  }, [messages.length, busy, screen, dualView]);

  // 双方都同意后也打开一次，方便看结果 / 报告
  useEffect(() => {
    if (screen !== 'dual' || !dual?.completed) return;
    setCompleteOpen(true);
  }, [screen, dual?.completed, dual?.id]);

  const hasCourtHistory = Boolean(
    dual && (dual.courtMessages.length > 0 || dual.completed || myPresence === 'court')
  );

  /** 私聊可发言：单人或双人私聊页且未结束 */
  const canPrivateChat =
    screen === 'single' || (screen === 'dual' && !!dual && !dual.completed && dualView === 'private');

  /** 群聊可发言：双人群聊页且未结束 */
  const canCourtChat =
    screen === 'dual' && !!dual && !dual.completed && dualView === 'court';

  const canSend = !busy && (canPrivateChat || canCourtChat);

  const composerLocked = screen === 'dual' && !!dual && dual.completed;

  const lockHint = useMemo(() => {
    if (screen === 'dual' && dual?.completed) return '本轮已结束，仅可查看历史消息';
    return '';
  }, [screen, dual?.completed]);

  async function run(fn: () => Promise<Ack | void>) {
    setBusy(true);
    setError('');
    try {
      const host = window.location.hostname;
      const isLocal =
        host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
      if (!isLocal) {
        throw new Error(
          '当前是线上环境，应使用云端接口。请刷新页面后重试；若仍失败，检查 Vercel 环境变量与部署状态。'
        );
      }
      const s = getSocket();
      if (!s.connected) {
        throw new Error('未连上服务器。请确认本机已运行 npm run dev（需要 5173 和 3001 都正常）。');
      }
      const res = (await fn()) as Ack | void;
      if (res && res.ok === false) throw new Error(res.error || '失败');
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      alert(msg);
      throw e;
    } finally {
      setBusy(false);
    }
  }

  /** 云端 HTTP 操作（不依赖 Socket） */
  async function runCloud<T>(fn: () => Promise<T>): Promise<T> {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      alert(msg);
      throw e;
    } finally {
      setBusy(false);
    }
  }

  function patchDualGames(games: DualGame[]) {
    const active = games.filter((g) => g && g.phase !== 'result');
    setState((prev) => {
      if (!prev?.dual) return prev;
      return {
        ...prev,
        dual: {
          ...prev.dual,
          games: active,
          game: active[0] || null,
        },
      };
    });
  }

  function activeGames(): DualGame[] {
    const list = dual?.games?.length
      ? dual.games
      : dual?.game
        ? [dual.game]
        : [];
    return list.filter((g) => g && g.phase !== 'result');
  }

  function gameWithPeer(peerId: UserId): DualGame | undefined {
    return activeGames().find(
      (g) =>
        g.playerIds.includes(peerId) &&
        (!userId || g.playerIds.includes(userId))
    );
  }

  /** 当前应弹出的游戏：优先待接受邀请，其次自己还在答的局 */
  function pickUiGame(): DualGame | null {
    if (!userId) return null;
    const list = activeGames().filter(
      (g) => g.playerIds.includes(userId) && !dismissedGameIds.includes(g.id)
    );
    const pendingInvite = list.find(
      (g) => g.startedBy !== userId && !g.accepted[userId]
    );
    if (pendingInvite) return pendingInvite;
    const answering = list.find((g) => {
      const answers = g.answers[userId] || [];
      const total = g.questionIds?.length || 10;
      const done =
        answers.length >= total && answers.every((a) => a != null);
      return g.phase === 'playing' && g.accepted[userId] && !done;
    });
    if (answering) return answering;
    // 已答完但未 dismiss 的等待页
    return list.find((g) => g.phase === 'playing') || null;
  }

  async function loginWithNickname() {
    const nick = loginNickname.trim();
    if (!nick) {
      alert('请输入昵称');
      return;
    }
    if (cloudEnabled === null) {
      alert('正在连接云端，请稍候再试');
      return;
    }
    setBusy(true);
    try {
      if (cloudEnabled === true) {
        const res = await cloudLogin({ nickname: nick });
        const rooms = joinedFromCloud(res.joinedRooms);
        setUserId(res.userId);
        writeStoredAccount({ userId: res.userId, nickname: res.nickname || nick });
        setLoginNickname(res.nickname || nick);
        setState({
          dual: null,
          single: {},
          online: {},
          records: [],
          profiles: {},
          account: {
            userId: res.userId,
            nickname: res.nickname,
            lastRoomId: null,
            joinedRoomIds: rooms.map((r) => r.id),
            joinedRooms: rooms,
          },
          room: null,
        });
        setScreen('home');
        return;
      }
      const host = window.location.hostname;
      const isLocal =
        host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
      if (!isLocal) {
        alert(
          '云端未就绪：请到 Vercel 配置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY 后重新部署，再刷新页面。'
        );
        return;
      }
      const res = await emitAck<Ack>('login', { nickname: nick });
      if (!res?.ok || !res.userId) {
        alert(res?.error || '无法进入');
        return;
      }
      setUserId(res.userId);
      writeStoredAccount({ userId: res.userId, nickname: res.nickname || nick });
      setLoginNickname(res.nickname || nick);
      setScreen('home');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    if (cloudEnabled !== true) {
      getSocket().emit('logout');
    }
    clearStoredAccount();
    setUserId(null);
    setState(null);
    setScreen('login');
  }

  useEffect(() => {
    const leave = () => {
      if (cloudEnabledRef.current === true) return;
      try {
        getSocket().emit('logout');
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pagehide', leave);
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('beforeunload', leave);
    };
  }, []);

  function enterDual() {
    setScreen('dual');
    setDualView('court');
    setGroupInfoOpen(false);
    setPrivateInfoOpen(false);
    setPlusOpen(false);
    requestAnimationFrame(() => forceStickBottom());
    window.setTimeout(() => forceStickBottom(), 80);
    window.setTimeout(() => forceStickBottom(), 200);
  }

  async function createRoom() {
    if (cloudEnabled === null) {
      alert('正在连接云端，请稍候再试');
      return;
    }
    if (cloudEnabled === true && userId) {
      await runCloud(async () => {
        const created = await cloudCreateRoom(userId, { aiRole: createAiRole });
        const pull = await cloudPullMessages(userId, created.room.id);
        setState((prev) =>
          applyCloudRoomSnapshot(
            pull,
            userId,
            prev,
            joinedFromCloud(created.joinedRooms)
          )
        );
        setCreateRoomOpen(false);
        enterDual();
      });
      return;
    }
    if (cloudEnabled !== true) {
      alert(
        '云端未就绪，无法创建群聊。请刷新页面；若仍失败，检查 Vercel 的 Supabase 环境变量。'
      );
      return;
    }
    await run(async () => {
      const res = await emitAck<Ack>('room:create', { aiRole: createAiRole });
      if (res?.ok) {
        setCreateRoomOpen(false);
        enterDual();
      }
      return res;
    });
  }

  function openCreateRoom() {
    setCreateAiRole('default');
    setCreateRoomOpen(true);
  }

  function openJoinRoom() {
    setJoinCodeDraft('');
    setJoinRoomOpen(true);
  }

  async function confirmJoinRoom() {
    const code = joinCodeDraft.trim().toUpperCase();
    if (!code) {
      alert('请输入房间码');
      return;
    }
    if (cloudEnabled === null) {
      alert('正在连接云端，请稍候再试');
      return;
    }
    if (cloudEnabled === true && userId) {
      await runCloud(async () => {
        const joined = await cloudJoinRoom(userId, { code });
        const pull = await cloudPullMessages(userId, joined.room.id);
        setState((prev) =>
          applyCloudRoomSnapshot(
            pull,
            userId,
            prev,
            joinedFromCloud(joined.joinedRooms)
          )
        );
        setJoinRoomOpen(false);
        setJoinCodeDraft('');
        enterDual();
      });
      return;
    }
    await run(async () => {
      const res = await emitAck<Ack>('room:join', { code });
      if (res?.ok) {
        setJoinRoomOpen(false);
        setJoinCodeDraft('');
        enterDual();
      }
      return res;
    });
  }

  async function enterRoomById(roomId: string) {
    if (room?.id === roomId) {
      enterDual();
      return;
    }
    if (cloudEnabled === null) {
      alert('正在连接云端，请稍候再试');
      return;
    }
    if (cloudEnabled === true && userId) {
      await runCloud(async () => {
        const joined = await cloudJoinRoom(userId, { roomId });
        const pull = await cloudPullMessages(userId, joined.room.id);
        setState((prev) =>
          applyCloudRoomSnapshot(
            pull,
            userId,
            prev,
            joinedFromCloud(joined.joinedRooms)
          )
        );
        enterDual();
      });
      return;
    }
    await run(async () => {
      const res = await emitAck<Ack>('room:join', { roomId });
      if (res?.ok) enterDual();
      return res;
    });
  }

  async function startSingleFlow() {
    if (cloudEnabled === null) {
      alert('正在连接云端，请稍候再试');
      return;
    }
    // 云端单人模式不依赖群聊房间
    if (cloudEnabled === true) {
      setScreen('single-pick');
      return;
    }
    if (!room) {
      await run(async () => {
        const res = await emitAck<Ack>('room:create', {});
        if (!res?.ok) return res;
        setScreen('single-pick');
        return res;
      });
      return;
    }
    setScreen('single-pick');
  }

  // 进入双人页：默认群聊视图
  useEffect(() => {
    if (screen !== 'dual' || !dual || !userId) return;
    const key = `lumi-autoview-${dual.id}-${userId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    setDualView('court');
  }, [screen, dual?.id, dual?.presence, userId]);

  /** 标签只切换视图，不改 presence */
  function handleCourtTabClick() {
    if (!dual) return;
    setMoreOpen(false);
    setMentionOpen(false);
    setDualView('court');
  }

  function handlePrivateTabClick() {
    setDualView('private');
    setMoreOpen(false);
    setMentionOpen(false);
  }

  /** 群聊底部「去私聊」：软切换（不计 3 次） */
  async function goPrivateSoft() {
    if (!dual || !userId || dual.completed) return;
    if (cloudEnabled === true) {
      setDualView('private');
      return;
    }
    await run(() => emitAck<Ack>('dual:go_private', {}));
    setDualView('private');
  }

  /** 私聊底部「回到群聊」：生成/确认开场白后回群 */
  async function startCourtFlow() {
    if (!dual || !userId) return;
    setDualView('court');
  }

  function insertMention(name: string) {
    if (!canSend) return;
    const piece = `@${name} `;
    setText((t) => (t ? `${t}${t.endsWith(' ') ? '' : ' '}${piece}` : piece));
    setMentionOpen(false);
    inputRef.current?.focus();
  }

  async function send(extra?: { image?: string }) {
    const t = text.trim();
    const image = extra?.image;
    if ((!t && !image) || !userId || !canSend) return;
    setText('');
    setMentionOpen(false);
    if (inputRef.current) inputRef.current.style.height = 'auto';
    if (screen === 'single') {
      if (cloudEnabled === true && userId) {
        await runCloud(async () => {
          const res = await cloudSingleSend(userId, {
            text: t || undefined,
            image,
          });
          patchSingle(res.single as SingleCase);
        });
      } else {
        await run(() => emitAck<Ack>('single:send', { text: t, image }));
      }
    } else if (cloudEnabled === true && dual) {
      await runCloud(async () => {
        await cloudSendMessage(userId, dual.id, {
          channel: dualView === 'court' ? 'court' : 'private',
          text: t || undefined,
          image,
        });
        const pull = await cloudPullMessages(userId, dual.id);
        setState((prev) => applyCloudRoomSnapshot(pull, userId, prev));
      });
    } else if (dualView === 'court') {
      await run(() => emitAck<Ack>('dual:court_send', { text: t, image }));
    } else {
      await run(() => emitAck<Ack>('dual:private_send', { text: t, image }));
    }
  }

  function onPickImage(file: File | null) {
    if (!file || !canSend) return;
    if (!file.type.startsWith('image/')) {
      alert('请选择图片');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      alert('图片请小于 4MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result || '');
      void send({ image: data });
    };
    reader.readAsDataURL(file);
  }

  async function openOpening(intent: 'enter' | 'return') {
    setOpeningIntent(intent);
    setPolished('');
    setOpeningError('');
    setOpeningTip('');
    setOpeningPhase('loading');
    setOpeningOpen(true);
    await generateOpening(intent);
  }

  async function generateOpening(intent: 'enter' | 'return' = openingIntent) {
    setOpeningPhase('loading');
    setOpeningError('');
    setOpeningTip('');
    setBusy(true);
    try {
      const s = getSocket();
      if (!s.connected) {
        throw new Error('未连上服务器，请确认本机服务已启动');
      }
      const res = await emitAck<Ack>('dual:polish_opening', { intent });
      if (res?.ok && res.polished) {
        setPolished(res.polished);
        setOpeningTip(res.tip || '');
        setOpeningPhase('confirm');
        return;
      }
      setOpeningError(res?.error || '生成失败，请稍后重试');
      setOpeningPhase('error');
    } catch (e) {
      setOpeningError(e instanceof Error ? e.message : String(e));
      setOpeningPhase('error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmOpeningAndGo() {
    const text = polished.trim();
    if (!text) {
      alert('开场白不能为空，请编辑后再确认');
      return;
    }
    await run(() => emitAck<Ack>('dual:confirm_opening', { polished: text }));
    setOpeningOpen(false);
    if (openingIntent === 'return') {
      await run(() => emitAck<Ack>('dual:return_court', {}));
    } else {
      await run(() => emitAck<Ack>('dual:enter_court', {}));
    }
    setDualView('court');
  }

  async function saveEmotions() {
    const emotions: EmotionMark[] = Object.entries(emotionDraft).map(([name, level]) => ({
      name,
      level,
    }));
    if (!emotions.length) {
      alert('请至少选一个情绪');
      return;
    }
    if (screen === 'single') {
      if (cloudEnabled === true && userId) {
        await runCloud(async () => {
          const res = await cloudSingleEmotions(userId, emotions);
          patchSingle(res.single as SingleCase);
        });
      } else {
        await run(() => emitAck<Ack>('single:set_emotions', { emotions }));
      }
    } else if (cloudEnabled === true && userId && dual) {
      await runCloud(async () => {
        await cloudRoomEmotions(userId, dual.id, emotions);
        const pull = await cloudPullMessages(userId, dual.id);
        setState((prev) => applyCloudRoomSnapshot(pull, userId, prev));
      });
    } else {
      await run(() => emitAck<Ack>('dual:set_emotions', { emotions }));
    }
    setEmotionOpen(false);
    setEmotionDraft({});
  }

  async function saveQuiz(assessment: AssessmentResult) {
    if (screen === 'single') {
      if (cloudEnabled === true && userId) {
        await runCloud(async () => {
          const res = await cloudSingleAssessment(userId, assessment);
          patchSingle(res.single as SingleCase);
        });
      } else {
        await run(() => emitAck<Ack>('single:set_assessment', { assessment }));
      }
    } else if (cloudEnabled === true && userId && dual) {
      await runCloud(async () => {
        await cloudRoomAssessment(userId, dual.id, assessment);
        const pull = await cloudPullMessages(userId, dual.id);
        setState((prev) => applyCloudRoomSnapshot(pull, userId, prev));
      });
    } else {
      await run(() => emitAck<Ack>('dual:set_assessment', { assessment }));
    }
    setQuizOpen(false);
  }

  async function saveDualMeta(payload: {
    groupName?: string;
    aiName?: string;
    nickname?: string;
  }) {
    if (screen !== 'dual' || !dual || !userId) return;
    if (cloudEnabled === true) {
      await runCloud(async () => {
        await cloudUpdateRoomMeta(userId, dual.id, payload);
        const pull = await cloudPullMessages(userId, dual.id);
        setState((prev) => applyCloudRoomSnapshot(pull, userId, prev));
      });
      return;
    }
    await run(() => emitAck<Ack>('dual:update_meta', payload));
  }

  function patchSingle(single: SingleCase | null) {
    if (!userId) return;
    setState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        single: { ...(prev.single || {}), [userId]: single },
      };
    });
  }

  async function saveProfile(patch: Partial<PersonProfile>) {
    if (cloudEnabled === true && userId) {
      await runCloud(async () => {
        const res = await cloudUpdateProfile(userId, patch);
        setState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            profiles: {
              ...(prev.profiles || {}),
              [userId]: res.profile as PersonProfile,
            },
          };
        });
      });
      return;
    }
    await run(() => emitAck<Ack>('profile:update', patch));
  }

  function revealMessage(id: string) {
    setFocusMessageId(id);
    requestAnimationFrame(() => {
      const el = document.getElementById(`msg-${id}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // 双方完成调解且报告就绪后：打开报告（存档由服务端完成，全端共享）
  useEffect(() => {
    if (screen !== 'dual' || !dual?.completed || !userId) return;
    const body = dual.reports?.text || '';
    if (!body) return;

    setReportText(body);

    const openFlag = `lumi-report-opened-${dual.id}`;
    if (!sessionStorage.getItem(openFlag)) {
      sessionStorage.setItem(openFlag, '1');
      setCompleteOpen(false);
      setReportOpen(true);
    }
  }, [dual?.completed, dual?.id, dual?.reports?.generatedAt, dual?.reports?.text, screen, userId]);

  async function exitRound() {
    if (screen === 'single') {
      const ok = confirm('确定退出本轮倾诉吗？结束后可在「沟通记录」查看摘要。');
      if (!ok) return;
      if (cloudEnabled === true && userId) {
        await runCloud(async () => {
          await cloudSingleExit(userId);
          patchSingle(null);
        });
      } else {
        await run(() => emitAck<Ack>('single:exit', {}));
      }
      setScreen('home');
      return;
    }
    setMoreOpen(false);
    setExitOpen(true);
  }

  async function acceptExitRound() {
    if (cloudEnabled === true && userId && room) {
      await runCloud(async () => {
        const res = await cloudLeaveRoom(userId, room.id);
        const rooms = joinedFromCloud(res.joinedRooms);
        setState((prev) => ({
          dual: null,
          single: prev?.single ?? {},
          online: prev?.online ?? {},
          records: prev?.records ?? [],
          profiles: prev?.profiles ?? {},
          account: prev?.account
            ? {
                ...prev.account,
                lastRoomId: null,
                joinedRoomIds: rooms.map((r) => r.id),
                joinedRooms: rooms,
              }
            : {
                userId,
                nickname: loginNickname || '我',
                lastRoomId: null,
                joinedRoomIds: rooms.map((r) => r.id),
                joinedRooms: rooms,
              },
          room: null,
        }));
        setExitOpen(false);
        setScreen('home');
      });
      return;
    }
    const res = await run(() => emitAck<Ack>('dual:accept_exit', {}));
    if (res?.exited) {
      setExitOpen(false);
      setScreen('home');
    }
  }

  async function refreshCloudRoom() {
    if (!userId || !room) return;
    await runCloud(async () => {
      const pull = await cloudPullMessages(userId, room.id);
      setState((prev) => applyCloudRoomSnapshot(pull, userId, prev));
    });
  }

  async function generateReport() {
    setReportOpen(true);
    if (screen === 'single') {
      setReportText('报告生成中……');
      try {
        const res = await run(() => emitAck<Ack>('single:analyze', {}));
        setReportText(res?.report || '已生成，请查看聊天中的 Lumi 回复。');
      } catch {
        setReportText('生成失败，请稍后重试。');
      }
      return;
    }

    const cached = dual?.reports?.text || reportText;
    if (cached && !dual?.reports?.generating) {
      setReportText(cached);
      return;
    }

    setReportText('报告生成中……');
    try {
      if (cloudEnabled === true && userId && dual) {
        await runCloud(async () => {
          const res = await cloudGetReport(userId, dual.id);
          setReportText(res.report || '暂无报告');
          if (res.report && !res.generating) {
            setState((prev) => {
              if (!prev?.dual) return prev;
              return {
                ...prev,
                dual: {
                  ...prev.dual,
                  completed: true,
                  reports: {
                    text: res.report || null,
                    generatedAt: new Date().toISOString(),
                    generating: false,
                  },
                },
              };
            });
          }
        });
        return;
      }
      const res = await run(() => emitAck<Ack>('dual:analyze', {}));
      if (res?.generating) {
        setReportText('报告生成中……');
        return;
      }
      setReportText(res?.report || '暂无报告');
    } catch {
      setReportText('生成失败，请稍后重试。');
    }
  }

  async function acceptComplete() {
    if (!dual || !userId) return;
    if (cloudEnabled === true) {
      await runCloud(async () => {
        const res = await cloudCompleteRoom(userId, dual.id);
        setCompleteOpen(false);
        const pull = await cloudPullMessages(userId, dual.id);
        setState((prev) => applyCloudRoomSnapshot(pull, userId, prev));
        if (res.report) {
          setReportText(res.report);
          setReportOpen(true);
        } else if (res.generating) {
          setReportText('报告生成中……');
          setReportOpen(true);
        }
      });
      return;
    }
    await run(() => emitAck<Ack>('dual:accept_complete', {}));
    setCompleteOpen(false);
  }

  /** 双人主 CTA */
  function primaryCta() {
    if (screen !== 'dual' || !dual) return null;
    if (dual.completed) {
      return (
        <button className="judge-primary-cta" onClick={() => void generateReport()}>
          查看报告
        </button>
      );
    }
    // 已在群聊身份
    if (myPresence === 'court') {
      if (dualView === 'private') {
        return (
          <button className="judge-primary-cta" onClick={() => setDualView('court')}>
            回到群聊
          </button>
        );
      }
      const softUsed = Boolean(dual.softPrivateUsed?.[userId!]);
      const recessUsed = dual.recessCount?.[userId!] || 0;
      if (softUsed) {
        return (
          <button
            className="judge-primary-cta"
            disabled={busy || recessUsed >= 3}
            onClick={() => setRecessOpen(true)}
          >
            回到私聊 ({recessUsed}/3)
          </button>
        );
      }
      return (
        <button className="judge-primary-cta" disabled={busy} onClick={() => void goPrivateSoft()}>
          去私聊
        </button>
      );
    }
    // 私聊身份（含休庭）：回到群聊并确认开场白
    return (
      <button
        className="judge-primary-cta"
        disabled={busy}
        onClick={() => void startCourtFlow()}
      >
        回到群聊（总结想对对方说的话）
      </button>
    );
  }

  if (screen === 'login') {
    return (
      <div className="app-shell">
        <div className="page page-pad" style={{ justifyContent: 'center' }}>
          <div className="brand-wrap">
            <img className="brand-logo" src="/lumi-fed.png" alt="Lumi" />
            <div className="brand">Lumi</div>
          </div>
          <div className="sub">输入昵称进入 · 树洞留言板 · 生成或输入群聊码开始调解</div>
          <div className="field" style={{ marginTop: 20 }}>
            <label htmlFor="login-nickname">昵称</label>
            <input
              id="login-nickname"
              className="info-input"
              value={loginNickname}
              placeholder="怎么称呼你"
              maxLength={24}
              disabled={busy}
              onChange={(e) => setLoginNickname(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void loginWithNickname();
              }}
            />
          </div>
          <button
            type="button"
            className="btn"
            style={{ marginTop: 16, width: '100%' }}
            disabled={busy || !loginNickname.trim() || cloudEnabled === null}
            onClick={() => void loginWithNickname()}
          >
            {busy ? (
              <span className="btn-loading">
                <span className="spinner" />
                进入中…
              </span>
            ) : cloudEnabled === null ? (
              <span className="btn-loading">
                <span className="spinner" />
                连接中…
              </span>
            ) : (
              '进入'
            )}
          </button>
        </div>
        {busy && (
          <div className="global-loading" role="status" aria-live="polite">
            <span className="spinner" aria-hidden />
            <span>加载中…</span>
          </div>
        )}
      </div>
    );
  }

  if (screen === 'home' && me) {
    return (
      <div className="app-shell">
        <HomeScreen
          me={me}
          userId={userId!}
          users={users}
          joinedRooms={account?.joinedRooms || []}
          recordsCount={records.length}
          online={state?.online ?? null}
          displayName={personalName(userId!)}
          avatarUrl={avatarOf(userId!)}
          displayNames={Object.fromEntries(
            Object.keys(users).map((id) => [id, personalName(id)])
          )}
          onLogout={logout}
          onCreateRoom={openCreateRoom}
          onJoinRoom={openJoinRoom}
          onEnterRoom={(id) => void enterRoomById(id)}
          onStartSingle={() => void startSingleFlow()}
          onFindBuddy={() => setScreen('find-buddy')}
          onOpenRecords={() => setRecordsOpen(true)}
          onOpenProfile={() => setScreen('profile')}
        />
        {recordsOpen && (
          <RecordsModal
            records={records}
            meId={userId!}
            meName={personalName(userId!)}
            users={users}
            onClose={() => setRecordsOpen(false)}
          />
        )}
        {createRoomOpen && (
          <SheetModal
            title="创建群聊"
            subtitle="选择 Lumi 角色，生成群聊码后可邀请对方"
            onClose={() => setCreateRoomOpen(false)}
            hideCloseButton
            footer={
              <>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setCreateRoomOpen(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void createRoom()}
                >
                  确认创建
                </button>
              </>
            }
          >
            <div className="desc" style={{ marginBottom: 12 }}>
              选择本群的 Lumi 角色（创建后固定）。生成后会出现在「已加入的房间」列表。
            </div>
            <div className="choice-grid">
              {AI_ROLES.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  className={`choice-card${createAiRole === role.id ? ' selected' : ''}`}
                  onClick={() => setCreateAiRole(role.id)}
                >
                  <strong>{role.label}</strong>
                  <span>{role.blurb}</span>
                </button>
              ))}
            </div>
          </SheetModal>
        )}
        {joinRoomOpen && (
          <SheetModal
            title="输入群聊码"
            subtitle="输入对方分享的 6 位群聊码"
            onClose={() => setJoinRoomOpen(false)}
            hideCloseButton
            footer={
              <>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setJoinRoomOpen(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !joinCodeDraft.trim()}
                  onClick={() => void confirmJoinRoom()}
                >
                  加入
                </button>
              </>
            }
          >
            <label className="info-label" htmlFor="join-room-code">
              群聊码
            </label>
            <input
              id="join-room-code"
              className="info-input"
              value={joinCodeDraft}
              placeholder="例如 ABC123"
              maxLength={8}
              autoFocus
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
              onChange={(e) => setJoinCodeDraft(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void confirmJoinRoom();
              }}
            />
          </SheetModal>
        )}
        {busy && (
          <div className="global-loading" role="status" aria-live="polite">
            <span className="spinner" aria-hidden />
            <span>加载中…</span>
          </div>
        )}
      </div>
    );
  }

  if (screen === 'find-buddy') {
    return (
      <div className="app-shell">
        <FindBuddyDemo onBack={() => setScreen('home')} />
      </div>
    );
  }

  if (screen === 'profile' && me && userId) {
    return (
      <div className="app-shell">
        <ProfilePage
          me={me}
          userId={userId}
          profile={myProfile}
          groupNickname={dual?.nicknames?.[userId]}
          groupNicknameCustomized={Boolean(dual?.nicknameCustomized?.[userId])}
          busy={busy}
          onBack={() => setScreen('home')}
          onSave={saveProfile}
        />
      </div>
    );
  }

  if (screen === 'single-pick') {
    return (
      <div className="app-shell">
        <div className="page page-pad">
          <div className="chat-header" style={{ margin: '0 -16px 8px' }}>
            <button className="btn-ghost" onClick={() => setScreen('home')}>
              返回
            </button>
            <h1>选择关系类型</h1>
          </div>
          <div className="relation-grid">
            {RELATION_TYPES.map((r) => (
              <button
                key={r.id}
                className="relation-card"
                onClick={() =>
                  void (cloudEnabled === true && userId
                    ? runCloud(async () => {
                        const res = await cloudSingleStart(
                          userId,
                          r.id as RelationType
                        );
                        patchSingle(res.single as SingleCase);
                        setScreen('single');
                      })
                    : run(async () => {
                        await emitAck<Ack>('single:start', {
                          relationType: r.id as RelationType,
                        });
                        setScreen('single');
                      }))
                }
              >
                <div className="emoji">{r.emoji}</div>
                <div className="label">{r.label}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const showGroupInfoPage = screen === 'dual' && dualView === 'court' && groupInfoOpen;
  const showPrivateInfoPage = screen === 'dual' && dualView === 'private' && privateInfoOpen;
  const showSingleInfoPage = screen === 'single' && singleInfoOpen;
  const showingInfoPage = showGroupInfoPage || showPrivateInfoPage || showSingleInfoPage;

  return (
    <div className="app-shell">
      <div className="page chat-page">
        <div className="chat-top">
          <div className="chat-header">
            <button
              type="button"
              className="chat-home-btn"
              onClick={() => {
                if (showGroupInfoPage) {
                  setGroupInfoOpen(false);
                  return;
                }
                if (showPrivateInfoPage) {
                  setPrivateInfoOpen(false);
                  return;
                }
                if (showSingleInfoPage) {
                  setSingleInfoOpen(false);
                  return;
                }
                if (screen === 'dual' && dualView === 'private') {
                  setDualView('court');
                  setPrivateInfoOpen(false);
                  return;
                }
                setScreen('home');
                setGroupInfoOpen(false);
                setPrivateInfoOpen(false);
                setSingleInfoOpen(false);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                <path d="M14.5 6 8.5 12l6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <h1>
              {screen === 'single'
                ? `单人 · ${RELATION_TYPES.find((r) => r.id === single?.relationType)?.label || ''}`
                : dualView === 'private'
                  ? `${aiDisplayName} 私聊`
                  : groupName}
            </h1>
            {!showingInfoPage ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {screen === 'dual' && (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busy}
                    onClick={() =>
                      void (cloudEnabled === true
                        ? refreshCloudRoom()
                        : run(() => emitAck<Ack>('room:refresh', {})))
                    }
                  >
                    刷新
                  </button>
                )}
                <button
                  type="button"
                  className="chat-info-btn"
                  onClick={() => {
                    if (screen === 'single') {
                      setSingleInfoOpen(true);
                      return;
                    }
                    if (dualView === 'private') {
                      setPrivateInfoOpen(true);
                    } else {
                      setGroupInfoOpen(true);
                    }
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <circle cx="5" cy="12" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="19" cy="12" r="1.8" />
                  </svg>
                </button>
              </div>
            ) : (
              <div className="chat-header-side-spacer" />
            )}
          </div>
        </div>

        {showGroupInfoPage && (
          <div className="info-page">
            <div className="info-card">
              <div className="info-label">群成员</div>
              <div className="info-members-grid">
                <button
                  type="button"
                  className="info-member-item info-member-lumi"
                  onClick={() => {
                    setGroupInfoOpen(false);
                    setDualView('private');
                    setPlusOpen(false);
                  }}
                >
                  <img className="info-member-img" src="/lumi-fed.png" alt={aiDisplayName} />
                  <span className="info-member-name">{aiDisplayName}</span>
                </button>
                {(dual?.memberIds || []).map((id) => (
                  <div key={id} className="info-member-item">
                    {avatarOf(id) ? (
                      <img className="info-member-img" src={avatarOf(id)!} alt="" />
                    ) : (
                      <div className="info-member-avatar" aria-hidden>
                        {shortForUser(id)}
                      </div>
                    )}
                    <span className="info-member-name">{labelForDualUser(id)}</span>
                  </div>
                ))}
              </div>
            </div>
            {room?.code ? (
              <div className="info-card">
                <div className="info-label">房间码</div>
                <div className="info-edit-row">
                  <input
                    className="info-input"
                    value={room.code}
                    readOnly
                    aria-readonly="true"
                  />
                  <button
                    type="button"
                    className="btn secondary info-save-btn"
                    onClick={() => {
                      void (async () => {
                        try {
                          await navigator.clipboard.writeText(room.code);
                          setRoomCodeCopied(true);
                          window.setTimeout(() => setRoomCodeCopied(false), 1500);
                        } catch {
                          alert(`房间码：${room.code}`);
                        }
                      })();
                    }}
                  >
                    {roomCodeCopied ? '已复制' : '复制'}
                  </button>
                </div>
              </div>
            ) : null}
            <div className="info-card">
              <div className="info-label">群名称</div>
              <div className="info-edit-row">
                <input
                  className="info-input"
                  value={groupNameDraft}
                  onChange={(e) => setGroupNameDraft(e.target.value)}
                />
                <button
                  className="btn secondary info-save-btn"
                  disabled={busy}
                  onClick={() => setMetaConfirm({ type: 'groupName', value: groupNameDraft.trim() })}
                >
                  保存
                </button>
              </div>
            </div>
            <div className="info-card">
              <div className="info-label">我的群昵称</div>
              <div className="info-edit-row">
                <input
                  className="info-input"
                  value={nicknameDraft}
                  onChange={(e) => setNicknameDraft(e.target.value)}
                />
                <button
                  className="btn secondary info-save-btn"
                  disabled={!userId || busy}
                  onClick={() => {
                    if (!userId) return;
                    setMetaConfirm({ type: 'nickname', value: nicknameDraft.trim() });
                  }}
                >
                  保存
                </button>
              </div>
            </div>
            <div className="info-card">
              <div className="info-label">AI 昵称</div>
              <div className="info-edit-row">
                <input
                  className="info-input"
                  value={aiNameDraft}
                  onChange={(e) => setAiNameDraft(e.target.value)}
                />
                <button
                  className="btn secondary info-save-btn"
                  disabled={busy}
                  onClick={() => setMetaConfirm({ type: 'aiName', value: aiNameDraft.trim() })}
                >
                  保存
                </button>
              </div>
            </div>
            <div className="info-card">
              <div className="info-label">查找聊天记录</div>
              <input
                className="info-input"
                value={groupSearch}
                onChange={(e) => setGroupSearch(e.target.value)}
                placeholder="输入关键词"
              />
              <div className="info-search-list">
                {groupSearch.trim() ? (
                  groupSearchResults.length ? (
                    groupSearchResults.map((m) => (
                      <button
                        key={m.id}
                        className="info-search-item"
                        onClick={() => {
                          setGroupInfoOpen(false);
                          revealMessage(m.id);
                        }}
                      >
                        <strong>{speakerLabel(m.user)}：</strong>
                        {m.text}
                      </button>
                    ))
                  ) : (
                    <div className="desc">未找到匹配内容</div>
                  )
                ) : (
                  <div className="desc">输入关键词后可查看匹配消息，并支持回到群聊继续查看上下文。</div>
                )}
              </div>
            </div>
            <div className="info-actions">
              <button className="btn secondary" disabled={busy} onClick={() => setCompleteOpen(true)}>
                结案
              </button>
              <button className="btn danger" disabled={busy} onClick={() => void exitRound()}>
                退出房间
              </button>
            </div>
          </div>
        )}

        {showPrivateInfoPage && (
          <div className="info-page">
            <div className="info-card">
              <div className="info-label">查找聊天记录</div>
              <input
                className="info-input"
                value={privateSearch}
                onChange={(e) => setPrivateSearch(e.target.value)}
                placeholder="输入关键词"
              />
              <div className="info-search-list">
                {privateSearch.trim() ? (
                  privateSearchResults.length ? (
                    privateSearchResults.map((m) => (
                      <button
                        key={m.id}
                        className="info-search-item"
                        onClick={() => {
                          setPrivateInfoOpen(false);
                          revealMessage(m.id);
                        }}
                      >
                        <strong>{speakerLabel(m.user)}：</strong>
                        {m.text}
                      </button>
                    ))
                  ) : (
                    <div className="desc">未找到匹配内容</div>
                  )
                ) : (
                  <div className="desc">输入关键词后可查看匹配消息，并支持回到私聊继续查看上下文。</div>
                )}
              </div>
            </div>
          </div>
        )}

        {showSingleInfoPage && (
          <div className="info-page">
            <div className="info-card">
              <div className="info-label">查找聊天记录</div>
              <input
                className="info-input"
                value={singleSearch}
                onChange={(e) => setSingleSearch(e.target.value)}
                placeholder="输入关键词"
              />
              <div className="info-search-list">
                {singleSearch.trim() ? (
                  singleSearchResults.length ? (
                    singleSearchResults.map((m) => (
                      <button
                        key={m.id}
                        className="info-search-item"
                        onClick={() => {
                          setSingleInfoOpen(false);
                          revealMessage(m.id);
                        }}
                      >
                        <strong>{speakerLabel(m.user)}：</strong>
                        {m.text}
                      </button>
                    ))
                  ) : (
                    <div className="desc">未找到匹配内容</div>
                  )
                ) : (
                  <div className="desc">输入关键词后可查看匹配消息，并支持回到会话继续查看上下文。</div>
                )}
              </div>
            </div>
            <div className="info-actions">
              <button className="btn secondary" disabled={busy} onClick={() => void generateReport()}>
                生成报告
              </button>
              <button className="btn danger" disabled={busy} onClick={() => void exitRound()}>
                退出本轮
              </button>
            </div>
          </div>
        )}

        {!showingInfoPage && (
          <>
            <div className="messages-wrap">
              <div
                key={`${screen}-${dualView}-${dual?.id || 'none'}`}
                ref={messagesRef}
                className="messages"
                onScroll={onMessagesScroll}
                onClick={() => {
                  setMentionOpen(false);
                  setMoreOpen(false);
                  setPlusOpen(false);
                }}
              >
                {messages.map((m) => {
                  const cls =
                    m.user === 'system' || m.kind === 'system'
                      ? 'system'
                      : m.user === 'lumi'
                        ? 'lumi'
                        : m.user === userId
                          ? 'me'
                          : 'other';
                  const who = m.user === 'system' ? '' : speakerLabel(m.user);
                  if (cls === 'lumi') {
                    const canEnterPrivate = screen === 'dual' && dualView === 'court';
                    return (
                      <div
                        id={`msg-${m.id}`}
                        key={m.id}
                        className={`msg-row lumi ${focusMessageId === m.id ? 'focused' : ''}`}
                      >
                        <button
                          type="button"
                          className={`msg-avatar-btn ${canEnterPrivate ? 'clickable' : ''}`}
                          onClick={() => {
                            if (!canEnterPrivate) return;
                            setDualView('private');
                            setGroupInfoOpen(false);
                            setPlusOpen(false);
                          }}
                        >
                          <img className="msg-avatar" src="/lumi-fed.png" alt={aiDisplayName} />
                        </button>
                        <div className="msg-col">
                          <div className="who">{aiDisplayName}</div>
                          <div className="bubble lumi">
                            {m.image && <img className="bubble-image" src={m.image} alt="上传图片" />}
                            {m.text && m.text !== '[图片]' ? renderTextWithMentions(m.text) : null}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const msgUser =
                    typeof m.user === 'string' && m.user !== 'lumi' && m.user !== 'system'
                      ? m.user
                      : null;
                  return (
                    <div
                      id={`msg-${m.id}`}
                      key={m.id}
                      className={`msg-row ${cls} ${focusMessageId === m.id ? 'focused' : ''}`}
                    >
                      {msgUser &&
                        (avatarOf(msgUser) ? (
                          <img
                            className={`msg-user-avatar img ${cls}`}
                            src={avatarOf(msgUser)!}
                            alt=""
                          />
                        ) : (
                          <div className={`msg-user-avatar ${cls}`} aria-hidden>
                            {shortForUser(msgUser)}
                          </div>
                        ))}
                      <div className={`msg-col ${cls === 'me' ? 'me' : ''}`}>
                        {who && cls !== 'me' && cls !== 'system' ? <div className="who outside">{who}</div> : null}
                        <div className={`bubble ${cls}`}>
                          {m.image && <img className="bubble-image" src={m.image} alt="上传图片" />}
                          {m.text && m.text !== '[图片]' ? renderTextWithMentions(m.text) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {busy && (
                  <div className="loading">
                    <span className="spinner" aria-hidden />
                    <span>{aiDisplayName} 思考中…</span>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
              {showJumpBottom && (
                <button
                  type="button"
                  className="jump-bottom-btn"
                  onClick={() => scrollMessagesToBottom(true)}
                >
                  有新消息 · 回到底部
                </button>
              )}
            </div>

            <div className="chat-dock">
              {lockHint && <div className="dock-lock-hint">{lockHint}</div>}
              <div className={`chat-bottom ${composerLocked ? 'locked' : ''}`}>
                <div className={`mention-menu ${mentionOpen ? 'open' : ''}`}>
                  <div className="mention-menu-title">选择要@的人</div>
                  <button
                    className="mention-item"
                    disabled={!canSend}
                    onClick={() => insertMention(aiDisplayName)}
                    >
                    <img className="mention-item-avatar img" src="/lumi-fed.png" alt={aiDisplayName} />
                    <div>
                      <div className="mention-item-name">{aiDisplayName}</div>
                      <div className="mention-item-desc">一起把话说清楚</div>
                    </div>
                  </button>
                  {screen === 'dual' && dualView === 'court' && other && (
                    <button
                      className="mention-item"
                      disabled={!canSend}
                      onClick={() => insertMention(labelForDualUser(other.id))}
                    >
                      <div className="mention-item-avatar" style={{ background: other.gradient }}>
                        {avatarOf(other.id) ? (
                          <img src={avatarOf(other.id)!} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
                        ) : (
                          other.shortName
                        )}
                      </div>
                      <div>
                        <div className="mention-item-name">{labelForDualUser(other.id)}</div>
                        <div className="mention-item-desc">好友</div>
                      </div>
                    </button>
                  )}
                </div>
                {plusOpen && (
                  <div className="plus-panel">
                    {screen === 'dual' && dualView === 'court' && (
                      <button
                        className="plus-action-btn"
                        disabled={
                          busy ||
                          !!dual?.completed ||
                          (dual?.memberIds || []).filter((id) => id !== userId)
                            .length < 1
                        }
                        onClick={() => {
                          setPlusOpen(false);
                          setGamePickOpen(true);
                        }}
                      >
                        {(dual?.memberIds || []).filter((id) => id !== userId)
                          .length < 1
                          ? '默契小游戏（需其他成员）'
                          : '默契小游戏'}
                      </button>
                    )}
                    {(screen === 'single' || (screen === 'dual' && dualView === 'private')) && (
                      <>
                        <button
                          className="plus-action-btn"
                          disabled={busy}
                          onClick={() => {
                            const existing: Record<string, number> = {};
                            myEmotions.forEach((e) => {
                              existing[e.name] = e.level;
                            });
                            setEmotionDraft(existing);
                            setEmotionOpen(true);
                            setPlusOpen(false);
                          }}
                        >
                          标记情绪
                        </button>
                        <button
                          className="plus-action-btn"
                          disabled={busy || hasAssessment}
                          onClick={() => {
                            setQuizOpen(true);
                            setPlusOpen(false);
                          }}
                        >
                          {hasAssessment ? '关系速测（已完成）' : '关系速测'}
                        </button>
                        <button
                          className="plus-action-btn"
                          disabled={busy}
                          onClick={() => {
                            setMouthpieceOpen(true);
                            setPlusOpen(false);
                          }}
                        >
                          嘴替
                        </button>
                      </>
                    )}
                    <button
                      className="plus-action-btn"
                      disabled={!canSend}
                      onClick={() => {
                        fileRef.current?.click();
                        setPlusOpen(false);
                      }}
                    >
                      上传图片
                    </button>
                  </div>
                )}
                <div className="composer-row">
                  <button
                    className="voice-btn"
                    title="语音输入（开发中）"
                    disabled={composerLocked || !canSend}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (composerLocked || !canSend) return;
                      alert('语音输入开发中，敬请期待。');
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <rect x="9" y="2" width="6" height="12" rx="3" />
                      <path d="M5 10a7 7 0 0 0 14 0" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                    </svg>
                  </button>
                  <div className="chat-input-wrapper">
                    <button
                      className={`at-inline-btn ${mentionOpen ? 'active' : ''}`}
                      title="@某人"
                      disabled={composerLocked || !canSend}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (composerLocked || !canSend) return;
                      setPlusOpen(false);
                      setMentionOpen((v) => !v);
                    }}
                  >
                      @
                    </button>
                    <textarea
                      ref={inputRef}
                      className="chat-input"
                      rows={1}
                      placeholder={
                        composerLocked
                          ? '本轮已结束'
                          : screen === 'dual'
                            ? dualView === 'court'
                              ? '在群聊里说点什么…'
                              : `跟 ${aiDisplayName} 说说…`
                            : '说点什么…'
                      }
                      value={text}
                      disabled={!canSend}
                      onChange={(e) => {
                        const v = e.target.value;
                        setText(v);
                        e.target.style.height = 'auto';
                        e.target.style.height = `${Math.min(e.target.scrollHeight, 88)}px`;
                        // 输入 @ 时弹出提及菜单（显示当前房间 Lumi 人设名）
                        if (v.endsWith('@') || /(?:^|\s)@$/.test(v)) {
                          setPlusOpen(false);
                          setMentionOpen(true);
                        }
                      }}
                      onFocus={() => {
                        if (stickRef.current) {
                          setTimeout(() => scrollMessagesToBottom(false), 50);
                        }
                      }}
                      onKeyDown={(e) => {
                        const ne = e.nativeEvent as KeyboardEvent;
                        if (ne.isComposing || ne.keyCode === 229) return;
                        if (e.key === '@') {
                          setPlusOpen(false);
                          setMentionOpen(true);
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                    />
                    <button
                      className="send-btn"
                      disabled={!canSend || !text.trim()}
                      onClick={() => void send()}
                      title="发送"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                    </button>
                  </div>
                  <button
                    className={`plus-btn ${plusOpen ? 'active' : ''}`}
                    disabled={composerLocked || !canSend}
                    onClick={() => {
                      if (composerLocked || !canSend) return;
                      setMentionOpen(false);
                      setPlusOpen((v) => !v);
                    }}
                  >
                    <span aria-hidden>+</span>
                  </button>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden-input"
                  onChange={(e) => {
                    onPickImage(e.target.files?.[0] || null);
                    e.target.value = '';
                  }}
                />
              </div>
              {error && <div className="error dock-error">{error}</div>}
            </div>
          </>
        )}
      </div>

      {quizOpen && (
        <QuizModal
          counterpartLabel={
            screen === 'single'
              ? RELATION_TYPES.find((r) => r.id === single?.relationType)?.counterpart || '对方'
              : other?.id
                ? labelForDualUser(other.id)
                : 'TA'
          }
          busy={busy}
          onClose={() => setQuizOpen(false)}
          onComplete={saveQuiz}
        />
      )}

      {mouthpieceOpen && (
        <MouthpieceModal
          busy={busy}
          cloudEnabled={cloudEnabled === true}
          userId={userId}
          roomId={screen === 'dual' ? dual?.id : null}
          onClose={() => setMouthpieceOpen(false)}
          onInsert={(t) => {
            setText(t);
            inputRef.current?.focus();
          }}
        />
      )}

      {gamePickOpen && dual && userId && (
        <SheetModal
          title="默契小游戏"
          subtitle="选择要邀请的群成员"
          onClose={() => setGamePickOpen(false)}
          hideCloseButton
          footer={
            <button
              type="button"
              className="btn secondary"
              onClick={() => setGamePickOpen(false)}
            >
              取消
            </button>
          }
        >
          <div className="game-pick-list">
            {(dual.memberIds || [])
              .filter((id) => id !== userId)
              .map((id) => {
                const ongoing = gameWithPeer(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className="game-pick-item"
                    disabled={busy}
                    onClick={() => {
                      if (ongoing) {
                        // 重新打开已关掉的进行中弹窗
                        setDismissedGameIds((prev) =>
                          prev.filter((gid) => gid !== ongoing.id)
                        );
                        setGamePickOpen(false);
                        return;
                      }
                      void (cloudEnabled === true && userId && dual
                        ? runCloud(async () => {
                            const res = await cloudGameInvite(
                              userId,
                              dual.id,
                              id
                            );
                            patchDualGames(
                              (res.games as DualGame[]) ||
                                (res.game ? [res.game as DualGame] : [])
                            );
                            setDismissedGameIds((prev) =>
                              prev.filter(
                                (gid) =>
                                  gid !== (res.game as DualGame | undefined)?.id
                              )
                            );
                            setGamePickOpen(false);
                            const pull = await cloudPullMessages(
                              userId,
                              dual.id
                            );
                            setState((prev) =>
                              applyCloudRoomSnapshot(pull, userId, prev)
                            );
                          })
                        : run(async () => {
                            const res = await emitAck<Ack>('dual:game_invite', {
                              targetUserId: id,
                            });
                            if (res?.ok) setGamePickOpen(false);
                            return res;
                          }));
                    }}
                  >
                    {avatarOf(id) ? (
                      <img
                        className="game-pick-avatar"
                        src={avatarOf(id)!}
                        alt=""
                      />
                    ) : (
                      <div
                        className="game-pick-avatar game-pick-avatar-fallback"
                        style={{
                          background: (
                            users[id] ||
                            toUserProfile(id, labelForDualUser(id))
                          ).gradient,
                        }}
                      >
                        {shortForUser(id)}
                      </div>
                    )}
                    <span className="game-pick-name">{labelForDualUser(id)}</span>
                    <span className="game-pick-action">
                      {ongoing ? '进行中·打开' : '邀请'}
                    </span>
                  </button>
                );
              })}
            {(dual.memberIds || []).filter((id) => id !== userId).length ===
            0 ? (
              <p className="desc">群里还没有其他成员，等对方加入后再发起吧。</p>
            ) : null}
          </div>
        </SheetModal>
      )}

      {(() => {
        const g = pickUiGame();
        if (screen !== 'dual' || !g || !userId) return null;
        if (!g.playerIds.includes(userId)) return null;
        const isStarter = g.startedBy === userId;
        const isInvitee = !isStarter;
        // 被邀请方进入群聊时再弹窗
        if (isInvitee && dualView !== 'court') return null;
        const peerId =
          g.playerIds.find((id) => id !== userId) || g.playerIds[1];
        const gameId = g.id;
        return (
          <GameModal
            game={g}
            userId={userId}
            otherId={peerId}
            nameMe={labelForDualUser(userId)}
            nameOther={labelForDualUser(peerId)}
            nameA={labelForDualUser(g.playerIds[0])}
            nameB={labelForDualUser(g.playerIds[1])}
            meProfile={
              users[userId] || toUserProfile(userId, labelForDualUser(userId))
            }
            otherProfile={
              users[peerId] || toUserProfile(peerId, labelForDualUser(peerId))
            }
            busy={busy}
            onAccept={async () => {
              if (cloudEnabled === true && userId && dual) {
                await runCloud(async () => {
                  const res = await cloudGameAccept(userId, dual.id, gameId);
                  patchDualGames(
                    (res.games as DualGame[]) ||
                      (res.game ? [res.game as DualGame] : [])
                  );
                });
                return;
              }
              await run(() =>
                emitAck<Ack>('dual:game_accept', { gameId })
              );
            }}
            onDecline={async () => {
              if (cloudEnabled === true && userId && dual) {
                await runCloud(async () => {
                  const res = await cloudGameDecline(userId, dual.id, gameId);
                  patchDualGames((res.games as DualGame[]) || []);
                  const pull = await cloudPullMessages(userId, dual.id);
                  setState((prev) =>
                    applyCloudRoomSnapshot(pull, userId, prev)
                  );
                });
                return;
              }
              await run(() =>
                emitAck<Ack>('dual:game_decline', { gameId })
              );
            }}
            onCancel={async () => {
              if (cloudEnabled === true && userId && dual) {
                await runCloud(async () => {
                  const res = await cloudGameDecline(userId, dual.id, gameId);
                  patchDualGames((res.games as DualGame[]) || []);
                  const pull = await cloudPullMessages(userId, dual.id);
                  setState((prev) =>
                    applyCloudRoomSnapshot(pull, userId, prev)
                  );
                });
                return;
              }
              await run(() =>
                emitAck<Ack>('dual:game_decline', { gameId })
              );
            }}
            onAnswer={async (optionIndex, questionIndex) => {
              if (cloudEnabled === true && userId && dual) {
                await runCloud(async () => {
                  const res = await cloudGameAnswer(userId, dual.id, {
                    optionIndex,
                    questionIndex,
                    gameId,
                  });
                  patchDualGames(
                    (res.games as DualGame[]) ||
                      (res.game && (res.game as DualGame).phase !== 'result'
                        ? [res.game as DualGame]
                        : [])
                  );
                  if ((res.game as DualGame)?.phase === 'result') {
                    const pull = await cloudPullMessages(userId, dual.id);
                    setState((prev) =>
                      applyCloudRoomSnapshot(pull, userId, prev)
                    );
                  }
                });
                return;
              }
              await run(() =>
                emitAck<Ack>('dual:game_answer', {
                  optionIndex,
                  questionIndex,
                  gameId,
                })
              );
            }}
            onDismiss={() => {
              setDismissedGameIds((prev) =>
                prev.includes(gameId) ? prev : [...prev, gameId]
              );
            }}
          />
        );
      })()}

      {reportOpen && (
        <SheetModal
          title={screen === 'single' ? '沟通报告' : '结案报告'}
          subtitle={
            screen === 'dual'
              ? '双方同看 · 事实以群聊与开场为准'
              : '事实以倾诉对话为准 · 无群聊'
          }
          onClose={() => setReportOpen(false)}
          hideCloseButton
          wide
          footer={
            <>
              <button
                className="btn secondary"
                onClick={() => {
                  const full = cleanChatMarkdown(
                reportText ||
                (dual?.reports?.generating ? '报告生成中……' : dual?.reports?.text || '')
                  );
                  if (!full.trim()) {
                    alert('暂无报告可复制');
                    return;
                  }
                  void navigator.clipboard.writeText(full).then(
                    () => alert('已复制全文'),
                    () => alert('复制失败，请手动选择文本')
                  );
                }}
              >
                复制全文
              </button>
              <button className="btn secondary" onClick={() => setReportOpen(false)}>
                关闭
              </button>
            </>
          }
        >
          <div className="report-box">
            {(reportText.includes('生成中') || dual?.reports?.generating) &&
            !dual?.reports?.text &&
            !reportText.includes('【调解报告】') ? (
              <div className="loading-block">
                <span className="spinner" />
                <span>报告生成中，请稍候…</span>
              </div>
            ) : (
              cleanChatMarkdown(
                reportText ||
                  (dual?.reports?.generating ? '报告生成中……' : '暂无报告')
              )
            )}
          </div>
        </SheetModal>
      )}

      {emotionOpen && (
        <SheetModal
          title="标记情绪"
          subtitle="可多选，并调节强度"
          onClose={() => setEmotionOpen(false)}
          hideCloseButton
          wide
          footer={
            <>
              <button className="btn secondary" onClick={() => setEmotionOpen(false)}>
                关闭
              </button>
              <button className="btn" disabled={busy} onClick={() => void saveEmotions()}>
                保存
              </button>
            </>
          }
        >
          <div className="emotion-grid">
            {JUDGE_EMOTIONS.map((e) => {
              const selected = emotionDraft[e.name] != null;
              return (
                <button
                  key={e.name}
                  className={`emotion-card ${selected ? 'selected' : ''}`}
                  onClick={() =>
                    setEmotionDraft((prev) => {
                      const next = { ...prev };
                      if (next[e.name] != null) delete next[e.name];
                      else next[e.name] = 3;
                      return next;
                    })
                  }
                >
                  <strong>{e.name}</strong>
                  <span>{e.def}</span>
                  {selected && (
                    <div className="slider-row" onClick={(ev) => ev.stopPropagation()}>
                      <input
                        type="range"
                        min={1}
                        max={5}
                        value={emotionDraft[e.name]}
                        onChange={(ev) =>
                          setEmotionDraft((prev) => ({
                            ...prev,
                            [e.name]: Number(ev.target.value),
                          }))
                        }
                      />
                      <span>{emotionDraft[e.name]}/5</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </SheetModal>
      )}

      {openingOpen && (
        <SheetModal
          title="想说给对方的话"
          subtitle={
            openingPhase === 'loading'
              ? '正在根据私聊整理开场白…'
              : openingPhase === 'error'
                ? '生成遇到问题'
                : '可直接改措辞，确认后进入群聊'
          }
          onClose={() => setOpeningOpen(false)}
          hideCloseButton
          wide
          closeOnBackdrop={false}
          footer={
            openingPhase === 'loading' ? (
              <button className="btn secondary" onClick={() => setOpeningOpen(false)}>
                关闭
              </button>
            ) : openingPhase === 'error' ? (
              <>
                <button className="btn secondary" onClick={() => setOpeningOpen(false)}>
                  关闭
                </button>
                <button className="btn" disabled={busy} onClick={() => void generateOpening()}>
                  再试一次
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => void generateOpening()}
                >
                  再生成一次
                </button>
                <button
                  className="btn"
                  disabled={busy || !polished.trim()}
                  onClick={() => void confirmOpeningAndGo()}
                >
                  确认并进入群聊
                </button>
              </>
            )
          }
        >
          {openingPhase === 'loading' ? (
            <div className="field">
              <div className="loading-block">
                <span className="spinner" />
                <span>正在根据私聊整理开场白…</span>
              </div>
              <div className="desc">只根据你的私聊内容摘要，不会要求再填一遍。</div>
            </div>
          ) : openingPhase === 'error' ? (
            <div className="field">
              <div className="desc">{openingError || '生成失败'}</div>
            </div>
          ) : (
            <div className="field">
              <label>开场白（给对方看）</label>
              <div className="desc">
                根据私聊整理而成；可改措辞，确认后以你的名义在群聊说出。
              </div>
              {openingTip ? (
                <div className="desc" style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>
                  {openingTip}
                </div>
              ) : null}
              <textarea
                className="polished-box polished-edit"
                value={polished}
                onChange={(e) => setPolished(e.target.value)}
                rows={8}
              />
            </div>
          )}
        </SheetModal>
      )}

      {recessOpen && (
        <SheetModal
          title="回到私聊"
          subtitle="群聊会提示返回时间；回来前须根据私聊重新确认开场白"
          onClose={() => setRecessOpen(false)}
          hideCloseButton
          footer={
            <>
              <button className="btn secondary" onClick={() => setRecessOpen(false)}>
                关闭
              </button>
              <button
                className="btn"
                disabled={busy || recessChoice == null}
                onClick={() =>
                  void run(async () => {
                    await emitAck<Ack>('dual:leave_private', { minutes: recessChoice! });
                    setRecessOpen(false);
                    setRecessChoice(null);
                    setDualView('private');
                  })
                }
              >
                确认
              </button>
            </>
          }
        >
          <div className="choice-grid">
            {[5, 15, 30].map((m) => (
              <button
                key={m}
                className={`choice-card ${recessChoice === m ? 'selected' : ''}`}
                disabled={busy}
                onClick={() => setRecessChoice(m)}
              >
                <strong>{m} 分钟后</strong>
                <span>再回来继续聊聊</span>
              </button>
            ))}
          </div>
        </SheetModal>
      )}

      {completeOpen && dual && userId && (
        <SheetModal
          title="结案"
          subtitle={
            dual.completed ? '本轮已结束，可查看结案报告' : '确认后将立即结案并生成报告'
          }
          onClose={() => setCompleteOpen(false)}
          hideCloseButton
          footer={
            <>
              <button className="btn secondary" onClick={() => setCompleteOpen(false)}>
                关闭
              </button>
              {!dual.completed ? (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void acceptComplete()}
                >
                  生成结案报告
                </button>
              ) : (
                <button className="btn" onClick={() => void generateReport()}>
                  查看报告
                </button>
              )}
            </>
          }
        >
          <div className="desc">
            {dual.completed
              ? '结案报告已生成，可随时查看。'
              : '将根据全部群聊、你的私聊、情绪标记与关系速测立即生成结案报告（无需对方同意）。'}
          </div>
        </SheetModal>
      )}

      {exitOpen && dual && userId && (
        <SheetModal
          title="退出房间"
          subtitle="退出后将离开当前房间，并清除本机对该房的记忆"
          onClose={() => setExitOpen(false)}
          hideCloseButton
          footer={
            <>
              <button className="btn secondary" onClick={() => setExitOpen(false)}>
                关闭
              </button>
              <button className="btn" disabled={busy} onClick={() => void acceptExitRound()}>
                确认退出
              </button>
            </>
          }
        >
          <div className="desc">确认退出房间？对方仍可继续，你可稍后用房间码重新加入。</div>
        </SheetModal>
      )}

      {metaConfirm && (
        <SheetModal
          title="确认修改？"
          subtitle="修改后双方都会看到最新名称"
          onClose={() => setMetaConfirm(null)}
          hideCloseButton
          footer={
            <>
              <button className="btn secondary" onClick={() => setMetaConfirm(null)}>
                关闭
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (!metaConfirm) return;
                    if (metaConfirm.type === 'groupName') {
                      await saveDualMeta({ groupName: metaConfirm.value });
                    } else if (metaConfirm.type === 'nickname') {
                      await saveDualMeta({ nickname: metaConfirm.value });
                    } else {
                      await saveDualMeta({ aiName: metaConfirm.value });
                    }
                    setMetaConfirm(null);
                  })
                }
              >
                确认修改
              </button>
            </>
          }
        >
          <div className="desc">
            {metaConfirm.type === 'groupName'
              ? `群名称将改为「${metaConfirm.value || '树洞'}」`
              : metaConfirm.type === 'nickname'
                ? `你的群昵称将改为「${metaConfirm.value || '默认昵称'}」`
                : `AI 昵称将改为「${metaConfirm.value || 'Lumi'}」`}
          </div>
        </SheetModal>
      )}
      {busy && (
        <div className="global-loading" role="status" aria-live="polite">
          <span className="spinner" aria-hidden />
          <span>加载中…</span>
        </div>
      )}
    </div>
  );
}
