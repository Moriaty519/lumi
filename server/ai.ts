import 'dotenv/config';
import { getAiRole, type AiRoleId } from '../shared/aiRoles.js';

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const BASE_URL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

/** 基础人设：好朋友；具体自称与补充见 aiRoles */
function baseSystem(displayName: string) {
  return (
    `你是 ${displayName}，用户的好朋友。语气自然、口语化。只依据已给材料，不编造。` +
    '用纯文本和换行排版，不要用 Markdown。'
  );
}

const TRANSFORM_SYSTEM =
  '把材料改成说话人当面说给对方的一段话。只输出这段话（第一人称、口语、纯文本）。';

const REPORT_SYSTEM =
  '写树洞小结正文。纯文本，可用「一、二、」小标题。不编造、不闲聊。';

export type AiScene =
  | 'private_chat'
  | 'court_chat'
  | 'emotion_ack'
  | 'quiz_feedback'
  | 'opening_polish'
  | 'mouthpiece'
  | 'single_chat'
  | 'single_analysis'
  | 'dual_analysis'
  | 'mediation_report';

type ChatTurn = { role: 'user' | 'assistant' | 'system'; content: string };

function isTransformScene(scene: AiScene) {
  return scene === 'opening_polish' || scene === 'mouthpiece';
}

function isReportScene(scene: AiScene) {
  return scene === 'mediation_report' || scene === 'single_analysis';
}

function sceneHint(scene: AiScene): string {
  switch (scene) {
    case 'private_chat':
      return '私聊（对方看不到）。接情绪、理事情。勿提替人传话。';
    case 'single_chat':
      return '单人倾诉：接情绪、理卡点。';
    case 'court_chat':
      return '树洞群聊。简短、不站队。只依据群聊内容，不编造私聊。';
    case 'emotion_ack':
      return '刚标记情绪：简短接住即可。';
    case 'quiz_feedback':
      return '刚完成速测：轻松反馈几句，不下结论。';
    case 'opening_polish':
      return (
        '把私聊要点改成当面说给对方的一段话。「我」=说话人，「你」=听的人。' +
        '少评判，保留真实情绪。'
      );
    case 'mouthpiece':
      return '按用户填写为主，整理成一段可当面说的话。';
    case 'single_analysis':
      return (
        '只写三节（标题原样）：一、梳理概要；四、倾诉中的观察；五、卡点与下一步。' +
        '观察有依据，1～3句；「五」不超过3条。'
      );
    case 'dual_analysis':
      return '写简短小结。不站队；暂缺写暂缺。';
    case 'mediation_report':
      return (
        '只写三节（标题原样）：一、调解概要；四、树洞里的观察；五、共同卡点与下一步。' +
        '观察分人写，须有群聊/开场依据；「五」不超过3条。'
      );
    default:
      return '';
  }
}

export async function chatLumi(opts: {
  scene: AiScene;
  messages: ChatTurn[];
  extraSystem?: string;
  /** 房间所选 Lumi 角色 */
  aiRole?: AiRoleId | string | null;
}): Promise<string> {
  if (!API_KEY || API_KEY.includes('your-key')) {
    throw new Error('请先在 .env 中配置 DEEPSEEK_API_KEY');
  }

  const transform = isTransformScene(opts.scene);
  const report = isReportScene(opts.scene);
  const role = getAiRole(opts.aiRole);
  const base = transform
    ? TRANSFORM_SYSTEM
    : report
      ? REPORT_SYSTEM
      : baseSystem(role.displayName);
  const system = [
    base,
    !transform && !report ? role.systemExtra : '',
    sceneHint(opts.scene),
    opts.extraSystem,
  ]
    .filter(Boolean)
    .join('\n');

  const temperature =
    opts.scene === 'court_chat' || report ? 0.35 : transform ? 0.4 : 0.7;

  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature,
      messages: [{ role: 'system', content: system }, ...opts.messages],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`DeepSeek 请求失败 ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  let text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('DeepSeek 返回为空');
  text = text.replace(/^Lumi[:：]\s*/i, '').trim();
  text = text.replace(/^关系大法官[:：]\s*/i, '').trim();
  text = text.replace(/^罗辑[:：]\s*/i, '').trim();
  text = text
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*\n])\*([^*\n]+)\*(?!\*)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*•]\s+/gm, '· ')
    .replace(/`+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (
    (text.startsWith('「') && text.endsWith('」')) ||
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith('“') && text.endsWith('”'))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text;
}
