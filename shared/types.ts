export type UserId = string;

export type { PersonProfile, Gender } from './profile';
import type { PersonProfile } from './profile';

export type RelationType =
  | 'lover'
  | 'parent_child'
  | 'colleague'
  | 'hierarchy'
  | 'teacher_student'
  | 'classmate';

export type PlayMode = 'dual' | 'single';

export type EmotionMark = {
  name: string;
  level: number; // 1-5
};

export type ChatMessage = {
  id: string;
  user: UserId | 'lumi' | 'system';
  text: string;
  time: string;
  kind?: 'chat' | 'system' | 'opening';
  image?: string;
};

export const EMOTION_LEVEL_LABELS: Record<number, string> = {
  1: '轻微',
  2: '有点',
  3: '明显',
  4: '强烈',
  5: '非常强烈',
};

export type JudgeRecordMessage = {
  user: string;
  text: string;
  time?: string;
  kind?: string;
};

export type DualReports = {
  /** 双方同看的一份调解报告（含代码填的情绪/量表 + AI 解读） */
  text: string | null;
  generatedAt: string | null;
  generating?: boolean;
};

export type JudgeRecord = {
  id: string;
  mode: 'dual' | 'single';
  title: string;
  savedAt: string;
  summary: string;
  /** 存档触发者 */
  ownerId?: UserId;
  ownerName?: string;
  emotions: EmotionMark[];
  emotionsOther?: EmotionMark[];
  /** 各成员情绪（按 userId） */
  emotionsByUser?: Record<string, EmotionMark[]>;
  otherName?: string;
  assessmentLabel?: string;
  assessmentByUser?: Record<string, string | undefined>;
  courtCount?: number;
  privateCount?: number;
  source?: 'exit' | 'complete';
  relationLabel?: string;
  relationEmoji?: string;
  /** 当前查看者私聊（投影后） */
  privateMessages?: JudgeRecordMessage[];
  /** 各成员私聊原文（存档用；下发时投影） */
  privateMessagesByUser?: Record<string, JudgeRecordMessage[]>;
  courtMessages?: JudgeRecordMessage[];
  singleMessages?: JudgeRecordMessage[];
  reportText?: string;
  /** @deprecated */
  reportPersonal?: string;
  /** @deprecated */
  reportDual?: string;
  caseId?: string;
  shared?: boolean;
  memberIds?: UserId[];
  memberNames?: Record<string, string>;
};

export type OpeningStatement = {
  polished: string;
  confirmedAt: string;
  relayed: boolean;
};

export type AssessmentResult = {
  completedAt: string;
  attachSelf?: {
    label: string;
    desc: string;
    anxiety: number;
    avoidance: number;
    styleKey: string;
  };
  commSelf?: {
    label: string;
    desc: string;
    mode: string;
    pursue: number;
    withdraw: number;
  };
  attachPartner?: {
    label: string;
    desc: string;
    styleKey: string;
  };
  commPartner?: {
    label: string;
    desc: string;
    mode: string;
  };
  skippedPartner?: boolean;
  level?: string;
};

export type Presence = 'offline' | 'private' | 'court';

/** 默契小游戏（两人一对；各自独立答题，双方答完再出结果；同房可多局） */
export type DualGamePhase = 'invite' | 'playing' | 'result';

export type DualGame = {
  /** 本局唯一 id（同房多局） */
  id: string;
  phase: DualGamePhase;
  startedBy: UserId;
  /** 已进入答题的成员（发起方自动 true；对方点接受后 true） */
  accepted: Record<string, boolean>;
  /** 本局抽中的题库下标（双方一致） */
  questionIds: number[];
  /** @deprecated 独立答题后不再用；保留兼容 */
  currentQuestion: number;
  /** 每人每题选项下标 0–3；未答为 null */
  answers: Record<string, (number | null)[]>;
  score: number;
  percent?: number;
  level?: string;
  comment?: string;
  /** 游戏双方 userId（创建时锁定） */
  playerIds: [UserId, UserId];
};

export type DualCase = {
  id: string;
  playMode: 'dual';
  createdAt: string;
  groupName: string;
  aiName: string;
  /** 创建时选择的 Lumi 角色：default / judge / luoji … */
  aiRole?: string;
  memberIds: UserId[];
  nicknames: Record<string, string>;
  privateMessages: Record<string, ChatMessage[]>;
  courtMessages: ChatMessage[];
  emotions: Record<string, EmotionMark[]>;
  assessments: Record<string, AssessmentResult | null>;
  openingStatements: Record<string, OpeningStatement | null>;
  presence: Record<string, Presence>;
  recessCount: Record<string, number>;
  recessUntil: Record<string, string | null>;
  recessPrivateCursor: Record<string, number | null>;
  softPrivateUsed: Record<string, boolean>;
  courtIntroSent?: boolean;
  /** @deprecated 结案不再需要双方同意 */
  completeAccepted: Record<string, boolean>;
  /** @deprecated 退出房间单人即可 */
  exitAccepted: Record<string, boolean>;
  completed: boolean;
  reports: DualReports;
  /**
   * @deprecated 请用 games；快照里仍会填「当前用户相关的第一局」便于旧 UI
   */
  game?: DualGame | null;
  /** 进行中的默契小游戏（可多局；不同两人一对；出结果后移除） */
  games?: DualGame[];
  nicknameCustomized?: Record<string, boolean>;
};

/** 群聊总开场（Lumi 气泡，每案一次；纯文本换行排版） */
export const DUAL_COURT_INTRO = [
  '欢迎来到树洞～我是你们的好朋友。',
  '这里可以慢慢说：不必急着对错，把卡住的事摊开一起看看就行。',
  '',
  '想单独说时，点我的头像进私聊（对方看不到）。',
  '群聊里也可以 @ 我。',
].join('\n');

export type SingleCase = {
  id: string;
  playMode: 'single';
  userId: UserId;
  relationType: RelationType;
  createdAt: string;
  messages: ChatMessage[];
  emotions: EmotionMark[];
  assessment: AssessmentResult | null;
};

/** 全局账号（昵称即账号） */
export type UserAccount = {
  id: UserId;
  nickname: string;
  createdAt: string;
  profile: PersonProfile;
  joinedRoomIds: string[];
  lastRoomId: string | null;
};

/** 房间元信息（案件数据在 RoomStore） */
export type RoomInfo = {
  id: string;
  code: string;
  memberIds: UserId[];
  createdAt: string;
};

export type UserProfile = {
  id: UserId;
  name: string;
  shortName: string;
  gradient: string;
};

/** 首页已加入房间列表项 */
export type JoinedRoomSummary = {
  id: string;
  code: string;
  groupName: string;
  memberCount: number;
};

export type ClientSnapshot = {
  dual: DualCase | null;
  single: Record<string, SingleCase | null>;
  online: Record<string, boolean>;
  records: JudgeRecord[];
  profiles: Record<string, PersonProfile>;
  /** 当前登录账号摘要 */
  account?: {
    userId: UserId;
    nickname: string;
    lastRoomId: string | null;
    joinedRoomIds: string[];
    joinedRooms: JoinedRoomSummary[];
  } | null;
  /** 当前所在房间 */
  room?: RoomInfo | null;
};

export const USER_GRADIENTS = [
  'linear-gradient(135deg, #FDA7DF, #D980FA)',
  'linear-gradient(135deg, #7ED6DF, #22A6B3)',
  'linear-gradient(135deg, #F8A5C2, #F79F1F)',
  'linear-gradient(135deg, #A29BFE, #6C5CE7)',
  'linear-gradient(135deg, #55EFC4, #00B894)',
];

export function userGradient(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h + userId.charCodeAt(i) * (i + 1)) % 997;
  return USER_GRADIENTS[h % USER_GRADIENTS.length]!;
}

export function toUserProfile(id: UserId, name: string): UserProfile {
  return {
    id,
    name,
    shortName: name.trim().slice(0, 1) || '?',
    gradient: userGradient(id),
  };
}

export const RELATION_TYPES: {
  id: RelationType;
  label: string;
  emoji: string;
  counterpart: string;
}[] = [
  { id: 'lover', label: '情侣', emoji: '💕', counterpart: '伴侣' },
  { id: 'parent_child', label: '亲子', emoji: '👨‍👩‍👧', counterpart: '父母/孩子' },
  { id: 'colleague', label: '同事', emoji: '💼', counterpart: '同事' },
  { id: 'hierarchy', label: '上下级', emoji: '📊', counterpart: '上级/下属' },
  { id: 'teacher_student', label: '师生', emoji: '📚', counterpart: '老师/学生' },
  { id: 'classmate', label: '同学', emoji: '🎓', counterpart: '同学' },
];

/** 通用情绪标记（不限定伴侣咨询语境；含少量正向） */
export const JUDGE_EMOTIONS = [
  { name: '委屈', def: '觉得不被理解，心里酸酸发堵' },
  { name: '失望', def: '期待落空，提不起劲' },
  { name: '恼火', def: '心里有火，想发作又忍着' },
  { name: '焦虑', def: '心里悬着，静不下来' },
  { name: '无助', def: '使不上力，不知从哪下手' },
  { name: '疲惫', def: '心力耗尽，只想歇一歇' },
  { name: '烦躁', def: '容易被小事惹毛' },
  { name: '孤独', def: '周围有人，心里仍空落落' },
  { name: '内疚', def: '觉得自己哪里做得不够好' },
  { name: '困惑', def: '事情想不通，理不出头绪' },
  { name: '不安', def: '隐隐担心，怕事情变糟' },
  { name: '沉重', def: '心里压着事，轻松不起来' },
  { name: '安心', def: '暂时踏实了，松了一口气' },
  { name: '感激', def: '心里暖暖的，想表达谢谢' },
  { name: '轻松', def: '紧绷松开，呼吸顺了一点' },
  { name: '期待', def: '对接下来的事有点盼头' },
  { name: '释然', def: '心里松动了，没那么拧着' },
];
