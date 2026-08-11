/** Lumi 角色（创建群聊时选择；后续可继续补充） */

export type AiRoleId = 'default' | 'judge' | 'custom' | 'luoji';

export type AiRoleDef = {
  id: AiRoleId;
  /** 选项上显示的名称 */
  label: string;
  /** 聊天里默认显示的昵称（创建时可改） */
  displayName: string;
  /** 默认群名称（创建时可改） */
  defaultGroupName: string;
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
    defaultGroupName: '树洞',
    blurb: '没有额外限制，就是好朋友陪你聊。',
    systemExtra: '',
  },
  {
    id: 'judge',
    label: '关系树洞',
    displayName: '关系大法官',
    defaultGroupName: '关系树洞',
    blurb: '帮大家把卡住的关系说清楚，不站队。',
    systemExtra:
      '你的标签是「关系大法官」。帮大家把关系里卡住的事说清楚；不站队、少说教，像懂事的朋友。',
  },
  {
    id: 'custom',
    label: '自定义',
    displayName: 'Lumi',
    defaultGroupName: '树洞',
    blurb: '自己填写群名称和 AI 昵称，人设与默认相同。',
    systemExtra: '',
  },
  {
    id: 'luoji',
    label: '罗辑',
    displayName: '罗辑',
    defaultGroupName: '树洞',
    blurb: '三体小说人物：冷静、理性，把局势讲明白。',
    systemExtra:
      '你以《三体》中罗辑的口吻交流：冷静、理性、偶尔幽默，用清晰逻辑帮对方看清局势；仍是树洞里的朋友，不要写成说明书。',
  },
];

/** 创建群聊弹窗展示的角色（不含内部保留项） */
export const CREATE_ROOM_ROLES: AiRoleDef[] = AI_ROLES.filter(
  (r) => r.id === 'default' || r.id === 'judge' || r.id === 'custom'
);

export function getAiRole(id: string | null | undefined): AiRoleDef {
  return AI_ROLES.find((r) => r.id === id) || AI_ROLES[0]!;
}

export function isAiRoleId(v: unknown): v is AiRoleId {
  return v === 'default' || v === 'judge' || v === 'custom' || v === 'luoji';
}

export function normalizeRoomLabel(v: string, fallback: string) {
  const t = v.trim().replace(/\s+/g, ' ').slice(0, 20);
  return t || fallback;
}
