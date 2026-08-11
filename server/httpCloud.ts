import type { Express, Request, Response } from 'express';
import { chatLumi } from './ai.js';
import { isSupabaseConfigured, supabaseConfigDebug } from './supabase.js';
import * as cloud from './cloud.js';
import { getAiRole } from '../shared/aiRoles.js';
import { normalizeProfilePatch, emptyPersonProfile } from '../shared/profile.js';
import type { PersonProfile } from '../shared/profile.js';
import type { EmotionMark, RelationType } from '../shared/types.js';
import { RELATION_TYPES } from '../shared/types.js';
import { formatAssessmentSummary } from '../shared/quiz.js';
import { formatBeijingDateTime } from '../shared/time.js';

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>
) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(400).json({ ok: false, error: msg });
    });
  };
}

function requireUserId(req: Request): string {
  const uid =
    (req.header('x-user-id') || '').trim() ||
    (typeof req.body?.userId === 'string' ? req.body.userId : '') ||
    (typeof req.query.userId === 'string' ? req.query.userId : '');
  if (!uid) throw new Error('缺少用户身份');
  return uid;
}

export function mountCloudHttpApi(app: Express) {
  app.get('/api/cloud/status', (_req, res) => {
    res.json({
      ok: true,
      supabase: isSupabaseConfigured(),
      mode: isSupabaseConfigured() ? 'cloud' : 'local-json',
      debug: supabaseConfigDebug(),
    });
  });

  if (!isSupabaseConfigured()) {
    console.warn(
      '[cloud] Supabase 未配置，/api/cloud/* 将返回 503。请填写 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  const guard = (_req: Request, res: Response, next: () => void) => {
    if (!isSupabaseConfigured()) {
      res.status(503).json({
        ok: false,
        error: '云端未就绪：请配置 Supabase 环境变量并执行 supabase/schema.sql',
      });
      return;
    }
    next();
  };

  app.use('/api/cloud', guard);

  /** 昵称登录 */
  app.post(
    '/api/cloud/login',
    asyncHandler(async (req, res) => {
      const nickname = String(req.body?.nickname || '');
      const byId = typeof req.body?.userId === 'string' ? req.body.userId : '';
      let account;
      if (byId && !nickname) {
        account = await cloud.getAccount(byId);
        if (!account) throw new Error('账号不存在，请重新输入昵称');
      } else {
        account = await cloud.loginOrCreateAccount(nickname);
      }
      const joinedRooms = await cloud.listJoinedRooms(account.id);
      res.json({
        ok: true,
        userId: account.id,
        nickname: account.nickname,
        profile: account.profile,
        joinedRooms,
      });
    })
  );

  /** 个人资料 */
  app.post(
    '/api/cloud/profile',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const account = await cloud.getAccount(userId);
      if (!account) throw new Error('账号不存在');
      const next = normalizeProfilePatch(
        (req.body?.profile || {}) as Partial<PersonProfile>,
        account.profile || emptyPersonProfile(account.nickname)
      );
      const saved = await cloud.updateAccountProfile(userId, next);
      res.json({ ok: true, profile: saved });
    })
  );

  /** 已加入房间列表 */
  app.get(
    '/api/cloud/rooms',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const joinedRooms = await cloud.listJoinedRooms(userId);
      res.json({ ok: true, joinedRooms });
    })
  );

  /** 创建房间（创建群聊 + 选 Lumi 角色） */
  app.post(
    '/api/cloud/rooms/create',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const aiRole = String(req.body?.aiRole || 'default');
      const room = await cloud.createRoom(userId, {
        aiRole,
        groupName:
          typeof req.body?.groupName === 'string' ? req.body.groupName : undefined,
        aiName: typeof req.body?.aiName === 'string' ? req.body.aiName : undefined,
      });
      const joinedRooms = await cloud.listJoinedRooms(userId);
      res.json({
        ok: true,
        room: {
          id: room.id,
          code: room.code,
          groupName: room.group_name,
          aiName: room.ai_name,
          aiRole: room.ai_role || aiRole,
        },
        joinedRooms,
      });
    })
  );

  /** 加入房间（输入群聊码或 roomId） */
  app.post(
    '/api/cloud/rooms/join',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const code = req.body?.code as string | undefined;
      const roomId = req.body?.roomId as string | undefined;
      const room = roomId
        ? await cloud.joinRoomById(userId, roomId)
        : await cloud.joinRoomByCode(userId, code || '');
      const joinedRooms = await cloud.listJoinedRooms(userId);
      res.json({
        ok: true,
        room: {
          id: room.id,
          code: room.code,
          groupName: room.group_name,
          aiName: room.ai_name,
          aiRole: cloud.resolveRoomAiRole(room),
        },
        joinedRooms,
      });
    })
  );

  /** 退出房间 */
  app.post(
    '/api/cloud/rooms/leave',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const roomId = String(req.body?.roomId || '');
      if (!roomId) throw new Error('缺少 roomId');
      await cloud.leaveRoom(userId, roomId);
      const joinedRooms = await cloud.listJoinedRooms(userId);
      res.json({ ok: true, joinedRooms });
    })
  );

  /** 拉取树洞留言（刷新） */
  app.get(
    '/api/cloud/rooms/:roomId/messages',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const roomId = String(req.params.roomId || '');
      const room = await cloud.getRoom(roomId);
      if (!room) throw new Error('房间不存在');
      const members = await cloud.listRoomMembers(roomId);
      const messages = await cloud.pullMessages(roomId, userId);
      const games = await cloud.listActiveGames(roomId);
      res.json({
        ok: true,
        room: {
          id: room.id,
          code: room.code,
          groupName: room.group_name,
          aiName: room.ai_name,
          aiRole: cloud.resolveRoomAiRole(room),
          completed: room.completed,
          reports: cloud.readReports(room),
        },
        game: games[0] || null,
        games,
        members: members.map((m) => {
          const acc = m.accounts as unknown as
            | { id: string; nickname: string; profile: PersonProfile }
            | { id: string; nickname: string; profile: PersonProfile }[]
            | null;
          const a = Array.isArray(acc) ? acc[0] : acc;
          return {
            userId: m.user_id,
            nickname: m.display_nickname || a?.nickname || '用户',
            nicknameCustomized: Boolean(m.nickname_customized),
            profile: a?.profile || emptyPersonProfile(a?.nickname || '用户'),
          };
        }),
        courtMessages: messages.court.map((m) => ({
          id: m.id,
          user: m.sender,
          text: m.text,
          time: m.time,
          kind: m.kind,
          image: m.image || undefined,
        })),
        privateMessages: messages.private.map((m) => ({
          id: m.id,
          user: m.sender,
          text: m.text,
          time: m.time,
          kind: m.kind,
          image: m.image || undefined,
        })),
      });
    })
  );

  /**
   * 树洞发消息：写入用户留言 → AI 回复 → 两条都落库
   * body: { channel: 'court'|'private', text?, image? }
   */
  app.post(
    '/api/cloud/rooms/:roomId/messages',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const roomId = String(req.params.roomId || '');
      const channel = (req.body?.channel === 'private' ? 'private' : 'court') as
        | 'court'
        | 'private';
      const text = String(req.body?.text || '').trim();
      const image = typeof req.body?.image === 'string' ? req.body.image : undefined;
      if (!text && !image) throw new Error('空消息');

      const room = await cloud.getRoom(roomId);
      if (!room) throw new Error('房间不存在');
      if (room.completed) throw new Error('本轮已结束');

      const userMsg = await cloud.insertMessage({
        roomId,
        channel,
        sender: userId,
        text: text || (image ? '[图片]' : ''),
        image,
        privateTo: channel === 'private' ? userId : null,
        kind: 'chat',
      });

      let lumiMsg = null as Awaited<ReturnType<typeof cloud.insertMessage>> | null;

      // 纯图片暂不调 AI
      if (text) {
        const mentionLumi =
          /@\s*(lumi|关系大法官|罗辑)/i.test(text) ||
          (Boolean(room.ai_name) &&
            new RegExp(
              `@\\s*${String(room.ai_name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
              'i'
            ).test(text)) ||
          channel === 'private';
        if (channel === 'private' || mentionLumi) {
          const aiRole = cloud.resolveRoomAiRole(room);
          const aiLabel = room.ai_name || getAiRole(aiRole).displayName;
          const courtLines = (await cloud.recentCourtForAi(roomId, 16))
            .map((m) => `${m.sender === 'lumi' ? aiLabel : m.sender}: ${m.text}`)
            .join('\n');
          const priv = await cloud.recentPrivateForAi(roomId, userId, 12);
          const history =
            channel === 'private'
              ? [
                  {
                    role: 'system' as const,
                    content:
                      '【公开群聊实录 · 可结合理解背景】\n' +
                      (courtLines || '（暂无群聊发言）'),
                  },
                  ...priv.map((m) => ({
                    role: (m.sender === 'lumi' ? 'assistant' : 'user') as
                      | 'assistant'
                      | 'user',
                    content: m.text,
                  })),
                ]
              : [
                  {
                    role: 'system' as const,
                    content: `群聊实录：\n${courtLines || '（暂无）'}`,
                  },
                  { role: 'user' as const, content: text },
                ];

          const reply = await chatLumi({
            scene: channel === 'private' ? 'private_chat' : 'court_chat',
            messages: history,
            aiRole,
            extraSystem:
              channel === 'court' ? '用户在树洞公开区 @ 了你。' : undefined,
          });

          lumiMsg = await cloud.insertMessage({
            roomId,
            channel,
            sender: 'lumi',
            text: reply,
            privateTo: channel === 'private' ? userId : null,
            kind: 'chat',
          });
        }
      }

      res.json({
        ok: true,
        userMessage: {
          id: userMsg.id,
          user: userMsg.sender,
          text: userMsg.text,
          time: userMsg.time,
          kind: userMsg.kind,
          image: userMsg.image || undefined,
        },
        lumiMessage: lumiMsg
          ? {
              id: lumiMsg.id,
              user: 'lumi',
              text: lumiMsg.text,
              time: lumiMsg.time,
              kind: lumiMsg.kind,
            }
          : null,
      });
    })
  );

  /** 默契小游戏 */
  app.post(
    '/api/cloud/rooms/:roomId/game/invite',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const roomId = String(req.params.roomId || '');
      const targetUserId = String(req.body?.targetUserId || '');
      const game = await cloud.inviteGame(roomId, userId, targetUserId);
      const games = await cloud.listActiveGames(roomId);
      res.json({ ok: true, game, games });
    })
  );

  app.post(
    '/api/cloud/rooms/:roomId/game/accept',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const roomId = String(req.params.roomId || '');
      const gameId =
        typeof req.body?.gameId === 'string' ? req.body.gameId : undefined;
      const game = await cloud.acceptGame(roomId, userId, gameId);
      const games = await cloud.listActiveGames(roomId);
      res.json({ ok: true, game, games });
    })
  );

  app.post(
    '/api/cloud/rooms/:roomId/game/decline',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const roomId = String(req.params.roomId || '');
      const gameId =
        typeof req.body?.gameId === 'string' ? req.body.gameId : undefined;
      await cloud.declineGame(roomId, userId, gameId);
      const games = await cloud.listActiveGames(roomId);
      res.json({ ok: true, game: null, games });
    })
  );

  app.post(
    '/api/cloud/rooms/:roomId/game/answer',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const roomId = String(req.params.roomId || '');
      const optionIndex = Number(req.body?.optionIndex);
      const questionIndex =
        typeof req.body?.questionIndex === 'number'
          ? req.body.questionIndex
          : undefined;
      const gameId =
        typeof req.body?.gameId === 'string' ? req.body.gameId : undefined;
      const game = await cloud.answerGame(
        roomId,
        userId,
        optionIndex,
        questionIndex,
        gameId
      );
      const games = await cloud.listActiveGames(roomId);
      res.json({ ok: true, game, games });
    })
  );

  /** 单人模式 */
  app.get(
    '/api/cloud/single',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const single = await cloud.getSingleSession(userId);
      res.json({ ok: true, single });
    })
  );

  app.post(
    '/api/cloud/single/start',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const relationType = String(req.body?.relationType || '') as RelationType;
      if (!relationType) throw new Error('请选择关系类型');
      const single = await cloud.startSingleSession(userId, relationType);
      res.json({ ok: true, single });
    })
  );

  app.post(
    '/api/cloud/single/send',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const text = String(req.body?.text || '').trim();
      const image =
        typeof req.body?.image === 'string' ? req.body.image : undefined;
      if (!text && !image) throw new Error('空消息');

      let single = await cloud.appendSingleMessage(
        userId,
        userId,
        text || (image ? '[图片]' : ''),
        image
      );

      if (text) {
        const history = single.messages.slice(-12).map((m) => ({
          role: (m.user === 'lumi' ? 'assistant' : 'user') as
            | 'assistant'
            | 'user',
          content: m.text,
        }));
        const reply = await chatLumi({
          scene: 'single_chat',
          messages: history,
          extraSystem: `当前关系类型：${single.relationType}`,
        });
        single = await cloud.appendSingleMessage(userId, 'lumi', reply);
      }

      res.json({ ok: true, single });
    })
  );

  app.post(
    '/api/cloud/single/emotions',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const emotions = (req.body?.emotions || []) as {
        name: string;
        level: number;
      }[];
      let single = await cloud.setSingleEmotions(userId, emotions);
      const list = emotions.map((e) => `${e.name}(${e.level}/5)`).join('、');
      const reply = await chatLumi({
        scene: 'emotion_ack',
        messages: [{ role: 'user', content: `我标记的情绪：${list || '无'}` }],
      });
      single = await cloud.appendSingleMessage(userId, 'lumi', reply);
      res.json({ ok: true, single });
    })
  );

  app.post(
    '/api/cloud/single/assessment',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const assessment = req.body?.assessment;
      if (!assessment) throw new Error('缺少速测结果');
      let single = await cloud.setSingleAssessment(userId, assessment);
      const reply = await chatLumi({
        scene: 'quiz_feedback',
        messages: [
          {
            role: 'user',
            content: `我的速测结果：${JSON.stringify(assessment)}`,
          },
        ],
      });
      single = await cloud.appendSingleMessage(userId, 'lumi', reply);
      res.json({ ok: true, single });
    })
  );

  app.post(
    '/api/cloud/single/exit',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      await cloud.clearSingleSession(userId);
      res.json({ ok: true, single: null });
    })
  );

  /** 更新群名 / AI 昵称 / 我的群昵称 */
  app.post(
    '/api/cloud/rooms/:roomId/meta',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const roomId = String(req.params.roomId || '');
      const result = await cloud.updateRoomMeta(roomId, userId, {
        groupName:
          typeof req.body?.groupName === 'string' ? req.body.groupName : undefined,
        aiName: typeof req.body?.aiName === 'string' ? req.body.aiName : undefined,
        nickname:
          typeof req.body?.nickname === 'string' ? req.body.nickname : undefined,
      });
      res.json({
        ok: true,
        room: {
          id: result.room.id,
          code: result.room.code,
          groupName: result.room.group_name,
          aiName: result.room.ai_name,
          aiRole: cloud.resolveRoomAiRole(result.room),
          completed: result.room.completed,
        },
        nickname: result.nickname,
      });
    })
  );

  /** 双人：标记情绪 */
  app.post(
    '/api/cloud/rooms/:roomId/emotions',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const roomId = String(req.params.roomId || '');
      const emotions = (req.body?.emotions || []) as EmotionMark[];
      await cloud.setRoomEmotions(roomId, userId, emotions);
      const list = emotions.map((e) => `${e.name}(${e.level}/5)`).join('、');
      const room = await cloud.getRoom(roomId);
      const reply = await chatLumi({
        scene: 'emotion_ack',
        aiRole: cloud.resolveRoomAiRole(room),
        messages: [{ role: 'user', content: `我标记的情绪：${list || '无'}` }],
      });
      await cloud.insertMessage({
        roomId,
        channel: 'private',
        sender: 'lumi',
        text: reply,
        privateTo: userId,
        kind: 'chat',
      });
      res.json({ ok: true });
    })
  );

  /** 双人：关系速测 */
  app.post(
    '/api/cloud/rooms/:roomId/assessment',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const roomId = String(req.params.roomId || '');
      const assessment = req.body?.assessment;
      if (!assessment) throw new Error('缺少速测结果');
      await cloud.setRoomAssessment(roomId, userId, assessment);
      const room = await cloud.getRoom(roomId);
      const reply = await chatLumi({
        scene: 'quiz_feedback',
        aiRole: cloud.resolveRoomAiRole(room),
        messages: [
          {
            role: 'user',
            content: `我的速测结果：${JSON.stringify(assessment)}`,
          },
        ],
      });
      await cloud.insertMessage({
        roomId,
        channel: 'private',
        sender: 'lumi',
        text: reply,
        privateTo: userId,
        kind: 'chat',
      });
      res.json({ ok: true });
    })
  );

  /** 嘴替（群聊或单人） */
  app.post(
    '/api/cloud/mouthpiece',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const roomId = String(req.body?.roomId || '');
      const wantToSay = String(
        req.body?.wantToSay ||
          '请结合我最近的聊天内容，帮我整理一段我可以直接对对方说的话。'
      );
      const wantThemToDo = String(req.body?.wantThemToDo || '');

      let me = '我';
      let listener = '对方';
      let chatLines = '';
      let chatLabel = '【说话人私聊摘要 · 自行挑选适合对对方说的要点并入】';
      let aiRole: string = 'default';

      if (roomId) {
        await cloud.assertActiveMember(roomId, userId);
        const room = await cloud.getRoom(roomId);
        if (!room) throw new Error('房间不存在');
        aiRole = cloud.resolveRoomAiRole(room);
        me = await cloud.memberNickname(roomId, userId);
        const members = await cloud.listRoomMembers(roomId);
        const other = members.find((m) => m.user_id !== userId);
        if (other) listener = await cloud.memberNickname(roomId, other.user_id);
        chatLines = await cloud.privateLinesForAi(roomId, userId, 18);
      } else {
        const single = await cloud.getSingleSession(userId);
        if (!single) throw new Error('请先进入群聊或单人模式');
        me = '我';
        const rel = RELATION_TYPES.find((r) => r.id === single.relationType);
        listener = rel?.counterpart || '对方';
        chatLabel = '【说话人倾诉摘要 · 自行挑选适合对对方说的要点并入】';
        chatLines = single.messages
          .filter(
            (m) =>
              m.kind !== 'system' && (m.user === userId || m.user === 'lumi')
          )
          .slice(-18)
          .map((m) => `${m.user === 'lumi' ? 'Lumi' : me}: ${m.text}`)
          .join('\n');
      }

      const polished = await chatLumi({
        scene: 'mouthpiece',
        aiRole,
        messages: [
          {
            role: 'user',
            content: [
              `说话人：${me}；听的人：${listener}。`,
              '请改写成「我」对对方直接说的一段话（不要回复我本人）：',
              `想说：${wantToSay}`,
              `希望对方：${wantThemToDo || '（未填）'}`,
              '',
              chatLabel,
              chatLines || '（暂无对话）',
            ].join('\n'),
          },
        ],
      });
      res.json({ ok: true, polished });
    })
  );

  /** 结案并生成报告 */
  app.post(
    '/api/cloud/rooms/:roomId/complete',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const roomId = String(req.params.roomId || '');
      await cloud.markRoomCompleted(roomId, userId);
      const result = await generateCloudReport(roomId, userId);
      res.json({ ok: true, ...result });
    })
  );

  /** 查看 / 补生成结案报告 */
  app.post(
    '/api/cloud/rooms/:roomId/report',
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const roomId = String(req.params.roomId || '');
      await cloud.assertActiveMember(roomId, userId);
      const room = await cloud.getRoom(roomId);
      if (!room) throw new Error('房间不存在');
      const reports = cloud.readReports(room);
      if (reports.text) {
        res.json({
          ok: true,
          report: reports.text,
          generating: false,
          completed: Boolean(room.completed),
        });
        return;
      }
      if (!room.completed) {
        throw new Error('请先点击结案生成报告');
      }
      const result = await generateCloudReport(roomId, userId);
      res.json({ ok: true, ...result, completed: true });
    })
  );
}

async function generateCloudReport(roomId: string, forUserId: string) {
  const room = await cloud.getRoom(roomId);
  if (!room) throw new Error('房间不存在');
  if (!room.completed) throw new Error('请先结案');

  const existing = cloud.readReports(room);
  if (existing.text) {
    return { report: existing.text, generating: false };
  }
  if (existing.generating) {
    return { report: '报告生成中，请稍候…', generating: true };
  }

  await cloud.saveRoomReport(roomId, { generating: true });

  try {
    const memberIds = await cloud.assertActiveMember(roomId, forUserId);
    const nameById = new Map<string, string>();
    for (const id of memberIds) {
      nameById.set(id, await cloud.memberNickname(roomId, id));
    }
    const aiLabel = room.ai_name || getAiRole(cloud.resolveRoomAiRole(room)).displayName;

    const courtRows = await cloud.recentCourtForAi(roomId, 60);
    const court = courtRows.map((m) => ({
      user:
        m.sender === 'lumi'
          ? aiLabel
          : m.sender === 'system'
            ? '系统'
            : nameById.get(m.sender) || m.sender,
      text: m.text,
      kind: m.kind,
    }));

    const states = await cloud.listRoomUserStates(roomId);
    const stateById = new Map(states.map((s) => [s.user_id, s]));

    const fmtEmotions = (list: EmotionMark[]) => {
      if (!list?.length) return '（未标记）';
      return list.map((e) => `${e.name}(${e.level})`).join('、');
    };

    const openings: Record<string, string | null> = {};
    const privateTopics: Record<string, string> = {};
    for (const id of memberIds) {
      const name = nameById.get(id) || '用户';
      openings[name] = null;
      privateTopics[name] = await cloud.privateLinesForAi(
        roomId,
        id,
        id === forUserId ? 40 : 12
      );
    }

    const aiBody = await chatLumi({
      scene: 'mediation_report',
      aiRole: cloud.resolveRoomAiRole(room),
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

    const partyLine = memberIds.map((id) => nameById.get(id) || id).join(' & ');
    const emotionLines = memberIds.map((id) => {
      const name = nameById.get(id) || id;
      const em = stateById.get(id)?.emotions || [];
      return `${name}：${fmtEmotions(em)}`;
    });
    const quizLines = memberIds.flatMap((id) => {
      const name = nameById.get(id) || id;
      const a = stateById.get(id)?.assessment;
      return [
        `【${name}】`,
        a ? formatAssessmentSummary(a) : '（未完成关系速测）',
        '',
      ];
    });

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

    await cloud.saveRoomReport(roomId, {
      text,
      generatedAt: new Date().toISOString(),
      generating: false,
    });

    await cloud.insertMessage({
      roomId,
      channel: 'court',
      sender: 'system',
      text: '调解报告已生成，可点「查看报告」',
      kind: 'system',
    });
    await cloud.insertMessage({
      roomId,
      channel: 'court',
      sender: 'lumi',
      text: '报告好了。里面整理了情绪、量表，以及树洞里的观察。',
      kind: 'chat',
    });

    return { report: text, generating: false };
  } catch (e) {
    await cloud.saveRoomReport(roomId, { generating: false });
    throw e;
  }
}
