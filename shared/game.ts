/** 默契小游戏：题干模板（选项人名由昵称注入） */

export const GAME_QUESTION_COUNT = 10;

export type GameQuestion = {
  question: string;
  options: string[];
};

/** 题库（每局从中随机抽 GAME_QUESTION_COUNT 道） */
export const GAME_QUESTION_BANK = [
  '谁更爱赖床？',
  '谁更喜欢吃甜食？',
  '谁更擅长做饭？',
  '谁更喜欢看电影？',
  '谁更爱打扫卫生？',
  '谁更喜欢出去玩？',
  '谁更爱听歌？',
  '谁更会讲冷笑话？',
  '谁更容易生气？',
  '谁更像夜猫子？',
  '谁更会照顾人？',
  '谁更常迟到？',
  '谁更喜欢点外卖？',
  '谁更爱拍照？',
  '谁更会存钱？',
  '谁更爱吐槽？',
  '谁更怕黑？',
  '谁更喜欢热闹？',
  '谁更常刷手机？',
  '谁更会做决定？',
  '谁更爱撒娇？',
  '谁更记仇？',
  '谁更喜欢洗澡洗很久？',
  '谁更会认路？',
  '谁更常丢三落四？',
  '谁更爱喝奶茶？',
  '谁更会安慰人？',
  '谁更喜欢早起？',
  '谁更爱看综艺？',
  '谁更会买买买？',
] as const;

export type GameQuestionId = number;

function shuffleIds(ids: number[]): number[] {
  const arr = [...ids];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
  return arr;
}

/** 每局随机抽取题库下标（双方共用同一批） */
export function pickGameQuestionIds(count = GAME_QUESTION_COUNT): number[] {
  const all = GAME_QUESTION_BANK.map((_, i) => i);
  if (count >= all.length) return shuffleIds(all);
  return shuffleIds(all).slice(0, count);
}

export function buildGameQuestion(
  questionId: number,
  nameA: string,
  nameB: string
): GameQuestion {
  const stem = GAME_QUESTION_BANK[questionId] || GAME_QUESTION_BANK[0]!;
  return {
    question: stem,
    options: [`A. ${nameA}`, `B. ${nameB}`, 'C. 都是', 'D. 都不'],
  };
}

/** 按本局 questionIds 生成题目（A/B 为两名玩家昵称，保证下标一致） */
export function buildGameQuestionsFromIds(
  questionIds: number[],
  nameA: string,
  nameB: string
): GameQuestion[] {
  return questionIds.map((id) => buildGameQuestion(id, nameA, nameB));
}

/** @deprecated 固定全量；请用 buildGameQuestionsFromIds */
export function buildGameQuestions(nameA: string, nameB: string): GameQuestion[] {
  return GAME_QUESTION_BANK.map((question) => ({
    question,
    options: [`A. ${nameA}`, `B. ${nameB}`, 'C. 都是', 'D. 都不'],
  }));
}

export function gameLevelFromPercent(percent: number): { level: string; comment: string } {
  if (percent >= 90) {
    return {
      level: '灵魂伴侣',
      comment: '简直是心有灵犀，彼此就是对方肚子里的蛔虫！',
    };
  }
  if (percent >= 70) {
    return {
      level: '默契十足',
      comment: '你们很懂对方，这份默契要好好珍惜哦～',
    };
  }
  if (percent >= 50) {
    return {
      level: '渐入佳境',
      comment: '已经有不少共同点了，继续相处默契会越来越高～',
    };
  }
  if (percent >= 30) {
    return {
      level: '各有千秋',
      comment: '想法还挺不一样的，差异也是一种趣味，慢慢了解对方吧～',
    };
  }
  return {
    level: '欢喜冤家',
    comment: '差别也太大了！不过打是亲骂是爱，吵吵闹闹感情才好嘛～',
  };
}

export function formatGameCourtMessage(
  score: number,
  total: number,
  percent: number,
  level: string,
  comment: string
) {
  return `游戏结束！${score}/${total} 题一致，默契值 ${percent}%，称号「${level}」～ ${comment}`;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

/** 群聊 Lumi 结果气泡：得分 + 每题双方选项 */
export function formatGameResultCourtMessage(input: {
  nameA: string;
  nameB: string;
  questionIds: number[];
  answersA: (number | null)[];
  answersB: (number | null)[];
  score: number;
  percent: number;
  level: string;
  comment: string;
}) {
  const {
    nameA,
    nameB,
    questionIds,
    answersA,
    answersB,
    score,
    percent,
    level,
    comment,
  } = input;
  const questions = buildGameQuestionsFromIds(questionIds, nameA, nameB);
  const total = questions.length;
  const lines: string[] = [
    `默契小游戏结果出炉啦～`,
    `${nameA} & ${nameB}`,
    `一致 ${score}/${total}（${percent}%）· 称号「${level}」`,
    comment,
    '',
    '答题详情：',
  ];
  questions.forEach((q, i) => {
    const a = answersA[i];
    const b = answersB[i];
    const label = (idx: number | null) => {
      if (idx == null) return '—';
      const text = q.options[idx]?.replace(/^[A-D]\.\s*/, '') || '—';
      return `${OPTION_LETTERS[idx] || '?'}. ${text}`;
    };
    const match = a != null && b != null && a === b;
    lines.push(`${i + 1}. ${q.question}`);
    lines.push(`　${nameA}：${label(a)}`);
    lines.push(`　${nameB}：${label(b)}`);
    lines.push(`　${match ? '✓ 一致' : '✗ 不同'}`);
  });
  return lines.join('\n');
}
