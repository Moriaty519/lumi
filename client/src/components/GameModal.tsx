/** 默契小游戏 UI */

import type { DualGame, UserId, UserProfile } from '../../../shared/types';
import {
  GAME_QUESTION_COUNT,
  buildGameQuestionsFromIds,
} from '../../../shared/game';
import { SheetModal } from './SheetModal';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

export function GameModal(props: {
  game: DualGame;
  userId: UserId;
  otherId: UserId;
  nameMe: string;
  nameOther: string;
  /** A 选项对应的玩家昵称（playerIds[0]） */
  nameA: string;
  /** B 选项对应的玩家昵称（playerIds[1]） */
  nameB: string;
  meProfile: UserProfile;
  otherProfile: UserProfile;
  busy?: boolean;
  onAccept: () => void | Promise<void>;
  onDecline: () => void | Promise<void>;
  onAnswer: (optionIndex: number, questionIndex: number) => void | Promise<void>;
  /** 答完后仅关掉弹窗，不取消本局 */
  onDismiss: () => void;
  /** 发起方中途取消本局 */
  onCancel?: () => void | Promise<void>;
}) {
  const {
    game,
    userId,
    otherId,
    nameMe,
    nameOther,
    nameA,
    nameB,
    meProfile,
    otherProfile,
    busy,
  } = props;

  const questionIds =
    game.questionIds?.length > 0
      ? game.questionIds
      : Array.from({ length: GAME_QUESTION_COUNT }, (_, i) => i);
  const questions = buildGameQuestionsFromIds(questionIds, nameA, nameB);
  const total = questions.length;

  const myAnswers = game.answers[userId] || [];
  const peerAnswers = game.answers[otherId] || [];
  const myNextQi = myAnswers.findIndex((a) => a == null);
  const myDone = myNextQi < 0 && myAnswers.length >= total;
  const peerDone =
    peerAnswers.length >= total && peerAnswers.every((a) => a != null);
  const peerJoined = Boolean(game.accepted[otherId]);
  const isStarter = game.startedBy === userId;

  // 结果改由 Lumi 发群聊，不再弹结果页
  if (game.phase === 'result') return null;

  // 被邀请方尚未接受
  const needsPeerJoin =
    game.phase === 'playing' && !game.accepted[userId] && !isStarter;

  if (needsPeerJoin || (game.phase === 'invite' && !game.accepted[userId])) {
    return (
      <SheetModal
        title="默契小游戏"
        subtitle="测测你们的默契程度"
        className="modal-game"
        hideCloseButton
        closeOnBackdrop={false}
        footer={
          <>
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => void props.onDecline()}
            >
              婉拒
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void props.onAccept()}
            >
              接受邀请
            </button>
          </>
        }
      >
        <div className="game-invite">
          <div className="game-invite-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="6" width="18" height="12" rx="2" />
              <path d="M7 12h4m-2-2v4" />
              <circle cx="16" cy="10" r="1" />
              <circle cx="18" cy="14" r="1" />
            </svg>
          </div>
          <h3>默契挑战邀请</h3>
          <p>
            {nameOther}向你发起了默契小游戏，一共 {total} 道题。
            <br />
            接受后独立作答；对方可能已先答完，你答完后结果会发到群聊～
          </p>
          <div className="invite-status">
            <div className="invite-status-item">
              <div
                className={`invite-status-avatar ${peerJoined ? 'accepted' : 'pending'}`}
                style={{ background: otherProfile.gradient }}
              >
                {otherProfile.shortName}
              </div>
              <div className="invite-status-name">{nameOther}</div>
            </div>
            <div className="invite-status-item">
              <div
                className={`invite-status-avatar ${game.accepted[userId] ? 'accepted' : 'pending'}`}
                style={{ background: meProfile.gradient }}
              >
                {meProfile.shortName}
              </div>
              <div className="invite-status-name">{nameMe}（我）</div>
            </div>
          </div>
        </div>
      </SheetModal>
    );
  }

  if (game.phase === 'playing') {
    if (myDone) {
      return (
        <SheetModal
          title="默契小游戏"
          subtitle="已答完 · 答案已保存"
          className="modal-game"
          hideCloseButton
          closeOnBackdrop={false}
          footer={
            <>
              {isStarter ? (
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => void props.onCancel?.()}
                >
                  取消本局
                </button>
              ) : null}
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => props.onDismiss()}
              >
                关闭
              </button>
            </>
          }
        >
          <div className="game-invite">
            <h3>你已答完全部题目</h3>
            <p>
              {peerDone
                ? '结果即将发到群聊…'
                : peerJoined
                  ? `答案已保存。等 ${nameOther} 答完后，Lumi 会把结果发到群聊。`
                  : `答案已保存。等 ${nameOther} 进入并答完后，Lumi 会把结果发到群聊。`}
            </p>
            <div className="waiting-other">
              <div className="spinner" />
              <span>{peerDone ? '汇总中…' : '可先关闭，随时回来'}</span>
            </div>
          </div>
        </SheetModal>
      );
    }

    const qi = myNextQi >= 0 ? myNextQi : 0;
    const question = questions[qi];
    if (!question) return null;
    const progress = ((qi + 1) / total) * 100;
    return (
      <SheetModal
        title="默契小游戏"
        subtitle={`第 ${qi + 1} / ${total} 题`}
        className="modal-game modal-game-play"
        hideCloseButton
        closeOnBackdrop={false}
        footer={
          isStarter ? (
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => void props.onCancel?.()}
            >
              取消本局
            </button>
          ) : undefined
        }
      >
        <div className="game-play" key={`play-${qi}`}>
          <div className="game-progress">
            <div className="game-progress-bar">
              <div className="game-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="game-progress-text">
              {qi + 1} / {total}
            </div>
          </div>
          {!peerJoined && isStarter ? (
            <p className="desc" style={{ marginBottom: 8 }}>
              对方尚未进入，你可以先答完并关闭；对方答完后结果会发到群聊。
            </p>
          ) : null}
          <div className="game-question-title">{question.question}</div>
          <div className="game-options" key={`opts-${qi}-${question.question}`}>
            {question.options.map((opt, i) => (
              <button
                key={`q${qi}-opt${i}`}
                type="button"
                className="game-option"
                disabled={busy}
                onClick={() => void props.onAnswer(i, qi)}
              >
                <span className="game-option-letter">{OPTION_LETTERS[i]}</span>
                <span className="game-option-text">{opt.replace(/^[A-D]\.\s*/, '')}</span>
              </button>
            ))}
          </div>
        </div>
      </SheetModal>
    );
  }

  return null;
}
