import type { AssessmentResult } from './types.js';

export const LIKERT_5_AGREE = ['非常不同意', '不同意', '一般', '同意', '非常同意'];

export type QuizItem = {
  q: string;
  dim: 'anxiety' | 'avoidance' | 'pursue' | 'withdraw';
  reverse?: boolean;
};

export type QuizScale = {
  id: string;
  name: string;
  abbr: string;
  items: QuizItem[];
  likertLabels: string[];
  isPerception?: boolean;
};

export type QuizStep = {
  id: string;
  part: number;
  title: string;
  scale: QuizScale;
  optional?: boolean;
  partnerIntro?: boolean;
};

export const ATTACHMENT_STYLES = {
  secure: { label: '偏安全型倾向', desc: '在亲近与独立之间相对平衡。' },
  anxious: { label: '偏焦虑型倾向', desc: '关系波动时，更容易担心失去连接。' },
  avoidant: { label: '偏回避型倾向', desc: '压力来时，更习惯先退回自己的空间。' },
  fearful: { label: '偏矛盾型倾向', desc: '既渴望靠近，又害怕受伤，有时进退两难。' },
} as const;

export const COMM_STYLES = {
  pursue: { label: '偏「追」', desc: '冲突时更想尽快说开、得到回应。' },
  withdraw: { label: '偏「逃」', desc: '冲突时更想先静下来、拉开一点距离。' },
  balanced: { label: '追逃较均衡', desc: '有时想谈开，有时也需要先缓一缓。' },
} as const;

export const ATTACH_COMM_SELF_SCALE: QuizScale = {
  id: 'attach-comm-self',
  name: '依恋与沟通',
  abbr: '依恋·沟通',
  likertLabels: LIKERT_5_AGREE,
  items: [
    { q: '我担心对方不像我关心TA那样关心我。', dim: 'anxiety' },
    { q: '我害怕对方会离开我 / 疏远我。', dim: 'anxiety' },
    { q: '当对方不回应我时，我会很不安。', dim: 'anxiety' },
    { q: '我需要对方经常表达在乎，我才能感到安心。', dim: 'anxiety' },
    { q: '当对方不在身边时，我会担心TA的心思是否还在我身上。', dim: 'anxiety' },
    { q: '我希望和对方更亲近，但常常担心靠太近会把TA推开。', dim: 'anxiety' },
    { q: '我不太习惯依赖对方。', dim: 'avoidance' },
    { q: '向对方倾诉内心深处的感受，让我觉得不太自在。', dim: 'avoidance' },
    { q: '我觉得和对方保持一点距离更舒服。', dim: 'avoidance' },
    { q: '当对方想了解我更多时，我会不自觉地退开。', dim: 'avoidance' },
    { q: '我倾向于在关系里保留一部分自己。', dim: 'avoidance' },
    { q: '我不太愿意完全对对方敞开心扉。', dim: 'avoidance' },
    { q: '发生分歧时，我会反复追问，直到对方回应。', dim: 'pursue' },
    { q: '吵起来的时候，我更需要把话说清楚。', dim: 'pursue' },
    { q: '冲突时我倾向于先沉默或回避。', dim: 'withdraw' },
    { q: '对方想谈问题时，我更想先冷一冷再说。', dim: 'withdraw' },
  ],
};

export const ATTACH_COMM_PARTNER_SCALE: QuizScale = {
  id: 'attach-comm-partner',
  name: '你眼中的 TA',
  abbr: '印象量表',
  isPerception: true,
  likertLabels: LIKERT_5_AGREE,
  items: [
    { q: '我觉得TA在关系紧张时，容易担心我会离开。', dim: 'anxiety' },
    { q: '我觉得TA需要我经常表达在乎，才会比较安心。', dim: 'anxiety' },
    { q: '我觉得TA当我不在身边时，会担心我的心思是否在TA身上。', dim: 'anxiety' },
    { q: '我觉得TA不太习惯依赖我。', dim: 'avoidance' },
    { q: '我觉得TA在我想更亲近时，有时会有意拉开距离。', dim: 'avoidance' },
    { q: '我觉得TA不太愿意完全对我敞开心扉。', dim: 'avoidance' },
    { q: '我觉得分歧时，TA更常追问要把话说清楚。', dim: 'pursue' },
    { q: '我觉得TA吵起来时，更需要立刻沟通。', dim: 'pursue' },
    { q: '我觉得TA冲突时更常先沉默或回避。', dim: 'withdraw' },
    { q: '我觉得TA在我想谈时，更常先说冷静一下。', dim: 'withdraw' },
  ],
};

export const RELATIONSHIP_QUIZ_FLOW: QuizStep[] = [
  { id: 'attach_comm_self', part: 1, title: '依恋与沟通', scale: ATTACH_COMM_SELF_SCALE },
  {
    id: 'attach_comm_partner',
    part: 2,
    title: '你眼中的 TA',
    scale: ATTACH_COMM_PARTNER_SCALE,
    optional: true,
    partnerIntro: true,
  },
];

function scoreDimItems(answers: number[], items: QuizItem[], dim: string) {
  const filtered = items
    .map((item, i) => ({ item, val: answers[i] }))
    .filter((x) => x.item.dim === dim && x.val != null);
  if (!filtered.length) return 0;
  const sum = filtered.reduce((acc, x) => {
    const v = x.item.reverse ? 6 - x.val : x.val;
    return acc + v;
  }, 0);
  return sum / filtered.length;
}

function getAttachmentStyle(anxietyAvg: number, avoidanceAvg: number) {
  const highA = anxietyAvg >= 3;
  const highV = avoidanceAvg >= 3;
  if (!highA && !highV) return 'secure' as const;
  if (highA && !highV) return 'anxious' as const;
  if (!highA && highV) return 'avoidant' as const;
  return 'fearful' as const;
}

export function scoreAttachment(answers: number[], scale: QuizScale) {
  const anxiety = scoreDimItems(answers, scale.items, 'anxiety');
  const avoidance = scoreDimItems(answers, scale.items, 'avoidance');
  const styleKey = getAttachmentStyle(anxiety, avoidance);
  const style = ATTACHMENT_STYLES[styleKey];
  return {
    anxiety: Math.round(anxiety * 10) / 10,
    avoidance: Math.round(avoidance * 10) / 10,
    styleKey,
    label: style.label,
    desc: style.desc,
    isPerception: !!scale.isPerception,
  };
}

export function scoreCommunication(answers: number[], scale: QuizScale) {
  const pursue = scoreDimItems(answers, scale.items, 'pursue');
  const withdraw = scoreDimItems(answers, scale.items, 'withdraw');
  let mode: keyof typeof COMM_STYLES = 'balanced';
  if (pursue - withdraw >= 0.6) mode = 'pursue';
  else if (withdraw - pursue >= 0.6) mode = 'withdraw';
  const style = COMM_STYLES[mode];
  return {
    pursue: Math.round(pursue * 10) / 10,
    withdraw: Math.round(withdraw * 10) / 10,
    mode,
    label: style.label,
    desc: style.desc,
    isPerception: !!scale.isPerception,
  };
}

export function buildAssessmentFromAnswers(opts: {
  selfAnswers: number[];
  partnerAnswers?: number[] | null;
  skippedPartner?: boolean;
}): AssessmentResult {
  const selfAttach = scoreAttachment(opts.selfAnswers, ATTACH_COMM_SELF_SCALE);
  const selfComm = scoreCommunication(opts.selfAnswers, ATTACH_COMM_SELF_SCALE);
  let attachPartner: AssessmentResult['attachPartner'];
  let commPartner: AssessmentResult['commPartner'];
  if (!opts.skippedPartner && opts.partnerAnswers?.length) {
    const a = scoreAttachment(opts.partnerAnswers, ATTACH_COMM_PARTNER_SCALE);
    const c = scoreCommunication(opts.partnerAnswers, ATTACH_COMM_PARTNER_SCALE);
    attachPartner = {
      label: a.label,
      desc: a.desc,
      styleKey: a.styleKey,
    };
    commPartner = {
      label: c.label,
      desc: c.desc,
      mode: c.mode,
    };
  }
  return {
    completedAt: new Date().toISOString(),
    attachSelf: {
      label: selfAttach.label,
      desc: selfAttach.desc,
      anxiety: selfAttach.anxiety,
      avoidance: selfAttach.avoidance,
      styleKey: selfAttach.styleKey,
    },
    commSelf: {
      label: selfComm.label,
      desc: selfComm.desc,
      mode: selfComm.mode,
      pursue: selfComm.pursue,
      withdraw: selfComm.withdraw,
    },
    attachPartner,
    commPartner,
    skippedPartner: !!opts.skippedPartner,
    level: selfAttach.label,
  };
}

export function formatAssessmentSummary(a: AssessmentResult) {
  const lines = [
    `一、依恋与沟通：${a.attachSelf?.label || '—'}；冲突时${a.commSelf?.label || '—'}。`,
  ];
  if (a.attachPartner || a.commPartner) {
    lines.push(
      `二、你眼中的 TA：${a.attachPartner?.label || '—'}；沟通${a.commPartner?.label || '—'}。（主观印象）`
    );
  } else if (a.skippedPartner) {
    lines.push('二、你眼中的 TA：已跳过。');
  }
  return lines.join('\n');
}
