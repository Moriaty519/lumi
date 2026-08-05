import { useEffect, useMemo, useRef, useState } from 'react';
import type { PersonProfile, UserId, UserProfile } from '../../../shared/types';
import {
  GENDER_OPTIONS,
  INTEREST_PRESETS,
  MBTI_QUIZ,
  MBTI_TYPES,
  ZODIAC_OPTIONS,
  scoreMbtiQuiz,
  shortFromName,
  type Gender,
} from '../../../shared/profile';
import { SheetModal } from './SheetModal';

type Props = {
  me: UserProfile;
  userId: UserId;
  profile: PersonProfile;
  groupNickname?: string;
  groupNicknameCustomized?: boolean;
  busy?: boolean;
  onBack: () => void;
  onSave: (patch: Partial<PersonProfile>) => void | Promise<void>;
};

export function ProfilePage(props: Props) {
  const { me, profile, busy } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [nameDraft, setNameDraft] = useState(profile.displayName);
  const [mbtiDraft, setMbtiDraft] = useState(profile.mbti);
  const [quizOpen, setQuizOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, 'a' | 'b'>>({});

  useEffect(() => {
    setNameDraft(profile.displayName);
    setMbtiDraft(profile.mbti);
  }, [profile.displayName, profile.mbti]);

  const short = shortFromName(profile.displayName, me.shortName);
  const syncHint = props.groupNicknameCustomized
    ? `群昵称已单独设置（当前「${props.groupNickname || '—'}」），修改个人昵称不会同步到群内`
    : '群昵称尚未单独修改，保存个人昵称会同步到群内';

  async function savePatch(patch: Partial<PersonProfile>) {
    await props.onSave(patch);
  }

  function onPickAvatar(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      alert('图片请小于 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result || '');
      // 过大则尝试压缩
      const img = new Image();
      img.onload = () => {
        const max = 512;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          void savePatch({ avatar: data });
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/jpeg', 0.82);
        void savePatch({ avatar: compressed });
      };
      img.onerror = () => void savePatch({ avatar: data });
      img.src = data;
    };
    reader.readAsDataURL(file);
  }

  function toggleInterest(tag: string) {
    const set = new Set(profile.interests);
    if (set.has(tag)) set.delete(tag);
    else set.add(tag);
    void savePatch({ interests: [...set] });
  }

  function startQuiz() {
    setQuizAnswers({});
    setQuizIndex(0);
    setQuizOpen(true);
  }

  function answerQuiz(choice: 'a' | 'b') {
    const q = MBTI_QUIZ[quizIndex];
    if (!q) return;
    const next = { ...quizAnswers, [q.id]: choice };
    setQuizAnswers(next);
    if (quizIndex < MBTI_QUIZ.length - 1) {
      setQuizIndex(quizIndex + 1);
      return;
    }
    const result = scoreMbtiQuiz(next);
    setMbtiDraft(result);
    setQuizOpen(false);
    void savePatch({ mbti: result });
  }

  const quizProgress = useMemo(
    () => ((quizIndex + 1) / MBTI_QUIZ.length) * 100,
    [quizIndex]
  );

  return (
    <div className="page page-pad profile-page">
      <header className="chat-header" style={{ margin: '0 -16px 8px' }}>
        <button type="button" className="btn-ghost" onClick={props.onBack}>
          返回
        </button>
        <h1>个人主页</h1>
        <span style={{ width: 48 }} />
      </header>

      <section className="profile-hero">
        <button
          type="button"
          className="profile-avatar-btn"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          aria-label="更换头像"
        >
          {profile.avatar ? (
            <img className="profile-avatar-img" src={profile.avatar} alt="" />
          ) : (
            <div className="profile-avatar-fallback" style={{ background: me.gradient }}>
              {short}
            </div>
          )}
          <span className="profile-avatar-edit">更换</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            onPickAvatar(e.target.files?.[0] || null);
            e.target.value = '';
          }}
        />
        <p className="profile-avatar-hint">头像会在群聊中同步显示</p>
      </section>

      <section className="profile-card">
        <div className="profile-field-label">昵称</div>
        <div className="info-edit-row">
          <input
            className="info-input"
            value={nameDraft}
            maxLength={20}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="你的昵称"
          />
          <button
            type="button"
            className="btn secondary info-save-btn"
            disabled={busy || !nameDraft.trim()}
            onClick={() => void savePatch({ displayName: nameDraft.trim() })}
          >
            保存
          </button>
        </div>
        <p className="profile-field-hint">{syncHint}</p>
      </section>

      <section className="profile-card">
        <div className="profile-field-label">性别</div>
        <div className="profile-chip-row">
          {GENDER_OPTIONS.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`profile-chip ${profile.gender === g.id ? 'active' : ''}`}
              disabled={busy}
              onClick={() =>
                void savePatch({
                  gender: (profile.gender === g.id ? '' : g.id) as Gender | '',
                })
              }
            >
              {g.label}
            </button>
          ))}
        </div>
      </section>

      <section className="profile-card">
        <div className="profile-field-label">二维码</div>
        <button
          type="button"
          className="profile-qr-entry"
          onClick={() => setQrOpen(true)}
        >
          <span className="profile-qr-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <path d="M14 14h3v3M20 14v6M14 20h3" />
            </svg>
          </span>
          <span>
            <strong>我的二维码</strong>
            <em>点击查看（落地页扫码稍后接入）</em>
          </span>
        </button>
      </section>

      <section className="profile-card">
        <div className="profile-field-label">MBTI</div>
        <div className="info-edit-row">
          <select
            className="info-input"
            value={mbtiDraft}
            onChange={(e) => setMbtiDraft(e.target.value)}
          >
            <option value="">未填写</option>
            {MBTI_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn secondary info-save-btn"
            disabled={busy}
            onClick={() => void savePatch({ mbti: mbtiDraft })}
          >
            保存
          </button>
        </div>
        <button type="button" className="profile-link-btn" disabled={busy} onClick={startQuiz}>
          做 8 道题测一测
        </button>
      </section>

      <section className="profile-card">
        <div className="profile-field-label">星座</div>
        <select
          className="info-input"
          value={profile.zodiac}
          disabled={busy}
          onChange={(e) => void savePatch({ zodiac: e.target.value })}
        >
          <option value="">未填写</option>
          {ZODIAC_OPTIONS.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </section>

      <section className="profile-card">
        <div className="profile-field-label">兴趣</div>
        <div className="profile-chip-row">
          {INTEREST_PRESETS.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`profile-chip ${profile.interests.includes(tag) ? 'active' : ''}`}
              disabled={busy}
              onClick={() => toggleInterest(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      </section>

      {qrOpen && (
        <SheetModal
          title="我的二维码"
          subtitle="占位 · 扫码落地页稍后开发"
          hideCloseButton
          closeOnBackdrop={false}
          onClose={() => setQrOpen(false)}
          footer={
            <button type="button" className="btn secondary" onClick={() => setQrOpen(false)}>
              关闭
            </button>
          }
        >
          <div className="profile-qr-panel">
            <div className="profile-qr-placeholder" aria-hidden>
              {Array.from({ length: 81 }, (_, i) => (
                <span
                  key={i}
                  className={
                    ((i * 7 + (props.userId.charCodeAt(0) % 7)) % 5 === 0 ? 'on' : '') ||
                    ((i % 9 === 0 || i % 9 === 8 || i < 9 || i >= 72) && i % 2 === 0
                      ? 'on'
                      : '')
                  }
                />
              ))}
            </div>
            <p className="profile-qr-caption">
              {profile.displayName}
              <br />
              扫码跳转落地页（开发中）
            </p>
          </div>
        </SheetModal>
      )}

      {quizOpen && (
        <SheetModal
          title="MBTI 快测"
          subtitle={`第 ${quizIndex + 1} / ${MBTI_QUIZ.length} 题`}
          hideCloseButton
          closeOnBackdrop={false}
          footer={
            <button type="button" className="btn secondary" onClick={() => setQuizOpen(false)}>
              关闭
            </button>
          }
        >
          <div className="game-progress">
            <div className="game-progress-bar">
              <div className="game-progress-fill" style={{ width: `${quizProgress}%` }} />
            </div>
          </div>
          <div className="game-question-title">{MBTI_QUIZ[quizIndex]?.question}</div>
          <div className="game-options">
            <button
              type="button"
              className="game-option"
              disabled={busy}
              onClick={() => answerQuiz('a')}
            >
              <span className="game-option-letter">A</span>
              <span className="game-option-text">{MBTI_QUIZ[quizIndex]?.a}</span>
            </button>
            <button
              type="button"
              className="game-option"
              disabled={busy}
              onClick={() => answerQuiz('b')}
            >
              <span className="game-option-letter">B</span>
              <span className="game-option-text">{MBTI_QUIZ[quizIndex]?.b}</span>
            </button>
          </div>
        </SheetModal>
      )}
    </div>
  );
}
