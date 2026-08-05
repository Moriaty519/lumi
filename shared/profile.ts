export type Gender = 'male' | 'female' | 'other' | 'secret';

export type PersonProfile = {
  displayName: string;
  avatar: string | null;
  gender: Gender | '';
  mbti: string;
  zodiac: string;
  interests: string[];
};

export const INTEREST_PRESETS = [
  '运动',
  '音乐',
  '电影',
  '阅读',
  '动漫',
  '旅行',
  '美食',
  '游戏',
  '摄影',
  '健身',
  '宠物',
  '二次元',
] as const;

export const ZODIAC_OPTIONS = [
  '白羊座',
  '金牛座',
  '双子座',
  '巨蟹座',
  '狮子座',
  '处女座',
  '天秤座',
  '天蝎座',
  '射手座',
  '摩羯座',
  '水瓶座',
  '双鱼座',
] as const;

export const GENDER_OPTIONS: { id: Gender; label: string }[] = [
  { id: 'male', label: '男' },
  { id: 'female', label: '女' },
  { id: 'other', label: '其他' },
  { id: 'secret', label: '保密' },
];

export const MBTI_TYPES = [
  'INTJ',
  'INTP',
  'ENTJ',
  'ENTP',
  'INFJ',
  'INFP',
  'ENFJ',
  'ENFP',
  'ISTJ',
  'ISFJ',
  'ESTJ',
  'ESFJ',
  'ISTP',
  'ISFP',
  'ESTP',
  'ESFP',
] as const;

/** 8 题快速 MBTI（每维度 2 题） */
export type MbtiQuizItem = {
  id: string;
  dim: 'EI' | 'SN' | 'TF' | 'JP';
  question: string;
  a: string;
  b: string;
  /** 选 A 计第一字母，选 B 计第二字母 */
};

export const MBTI_QUIZ: MbtiQuizItem[] = [
  {
    id: 'ei1',
    dim: 'EI',
    question: '周末你更想：',
    a: '约朋友出门，热闹一下',
    b: '一个人待着，安静放松',
  },
  {
    id: 'ei2',
    dim: 'EI',
    question: '认识新朋友时，你通常：',
    a: '主动搭话，很快熟络',
    b: '先观察，等对方先开口',
  },
  {
    id: 'sn1',
    dim: 'SN',
    question: '学习新事物时，你更在意：',
    a: '具体步骤和实际例子',
    b: '整体概念和可能的方向',
  },
  {
    id: 'sn2',
    dim: 'SN',
    question: '聊天时你更常聊：',
    a: '发生了什么、怎么做的',
    b: '意味着什么、以后会怎样',
  },
  {
    id: 'tf1',
    dim: 'TF',
    question: '做决定时你更看重：',
    a: '逻辑是否说得通',
    b: '大家感受是否舒服',
  },
  {
    id: 'tf2',
    dim: 'TF',
    question: '朋友倾诉烦恼时，你更倾向于：',
    a: '帮对方拆解问题、给方案',
    b: '先陪着、接住情绪',
  },
  {
    id: 'jp1',
    dim: 'JP',
    question: '出行安排你更喜欢：',
    a: '提前订好行程，按计划走',
    b: '大致有想法，到了再说',
  },
  {
    id: 'jp2',
    dim: 'JP',
    question: '面对任务截止日期，你通常：',
    a: '尽早做完，心里踏实',
    b: '临近截止效率最高',
  },
];

export function emptyPersonProfile(defaultName: string): PersonProfile {
  return {
    displayName: defaultName,
    avatar: null,
    gender: '',
    mbti: '',
    zodiac: '',
    interests: [],
  };
}

export function shortFromName(name: string, fallback: string) {
  const t = name.trim();
  if (!t) return fallback;
  return t.slice(0, 1);
}

export function scoreMbtiQuiz(answers: Record<string, 'a' | 'b'>): string {
  const tally: Record<string, number> = {
    E: 0,
    I: 0,
    S: 0,
    N: 0,
    T: 0,
    F: 0,
    J: 0,
    P: 0,
  };
  for (const q of MBTI_QUIZ) {
    const ans = answers[q.id];
    if (!ans) continue;
    const [first, second] = q.dim.split('') as [string, string];
    if (ans === 'a') tally[first] = (tally[first] || 0) + 1;
    else tally[second] = (tally[second] || 0) + 1;
  }
  return (
    (tally.E >= tally.I ? 'E' : 'I') +
    (tally.S >= tally.N ? 'S' : 'N') +
    (tally.T >= tally.F ? 'T' : 'F') +
    (tally.J >= tally.P ? 'J' : 'P')
  );
}

export function normalizeProfilePatch(
  patch: Partial<PersonProfile>,
  current: PersonProfile
): PersonProfile {
  const next: PersonProfile = { ...current };
  if (typeof patch.displayName === 'string') {
    const n = patch.displayName.trim().replace(/\s+/g, ' ').slice(0, 20);
    if (n) next.displayName = n;
  }
  if (patch.avatar !== undefined) {
    next.avatar = patch.avatar || null;
  }
  if (patch.gender !== undefined) {
    next.gender = patch.gender || '';
  }
  if (typeof patch.mbti === 'string') {
    const m = patch.mbti.trim().toUpperCase().slice(0, 4);
    next.mbti = m;
  }
  if (typeof patch.zodiac === 'string') {
    next.zodiac = patch.zodiac.trim().slice(0, 12);
  }
  if (Array.isArray(patch.interests)) {
    const set = new Set(
      patch.interests
        .map((x) => String(x).trim())
        .filter(Boolean)
        .slice(0, 12)
    );
    next.interests = [...set];
  }
  return next;
}

export function defaultProfiles(
  names: Record<string, string>
): Record<string, PersonProfile> {
  const out: Record<string, PersonProfile> = {};
  for (const [id, name] of Object.entries(names)) {
    out[id] = emptyPersonProfile(name);
  }
  return out;
}
