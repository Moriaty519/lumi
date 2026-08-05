/** Lumi 角色（创建群聊时选择；后续可继续补充） */

export type AiRoleId = 'default' | 'judge' | 'luoji';

export type AiRoleDef = {
  id: AiRoleId;
  /** 选项上显示的名称 */
  label: string;
  /** 聊天里显示的昵称 */
  displayName: string;
  /** 一句话说明 */
  blurb: string;
  /** 叠在基础好友人设上的补充（越短越好） */
  systemExtra: string;
};

export const AI_ROLES: AiRoleDef[] = [
  {
    id: 'default',
    label: '默认',
    displayName: 'Lumi',
    blurb: '没有额外限制，就是好朋友陪你聊。',
    systemExtra: '',
  },
  {
    id: 'judge',
    label: '关系大法官',
    displayName: '关系大法官',
    blurb: '帮大家把卡住的关系说清楚，不站队。',
    systemExtra:
      '你的标签是「关系大法官」。帮大家把关系里卡住的事说清楚；不站队、少说教，像懂事的朋友。',
  },
  {
    id: 'luoji',
    label: '罗辑',
    displayName: '罗辑',
    blurb: '三体小说人物：冷静、理性，把局势讲明白。',
    systemExtra:
      '你以《三体》中罗辑的口吻交流：冷静、理性、偶尔幽默，用清晰逻辑帮对方看清局势；仍是树洞里的朋友，不要写成说明书。',
  },
];

export function getAiRole(id: string | null | undefined): AiRoleDef {
  return AI_ROLES.find((r) => r.id === id) || AI_ROLES[0]!;
}

export function isAiRoleId(v: unknown): v is AiRoleId {
  return v === 'default' || v === 'judge' || v === 'luoji';
}
