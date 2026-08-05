import { useState } from 'react';
import { emitAck } from '../lib/socket';
import { cloudMouthpiece } from '../lib/cloudApi';
import { SheetModal } from './SheetModal';

type Ack = { ok: boolean; error?: string; polished?: string };

export function MouthpieceModal(props: {
  busy?: boolean;
  /** 云端模式 */
  cloudEnabled?: boolean;
  userId?: string | null;
  roomId?: string | null;
  onClose: () => void;
  onInsert?: (text: string) => void;
}) {
  const [phase, setPhase] = useState<'guide' | 'result'>('guide');
  const [result, setResult] = useState('');
  const [localBusy, setLocalBusy] = useState(false);

  async function generate() {
    setLocalBusy(true);
    try {
      let polished = '';
      if (props.cloudEnabled && props.userId) {
        const res = await cloudMouthpiece(props.userId, {
          roomId: props.roomId || undefined,
          wantToSay:
            '请结合我最近的聊天内容，帮我整理一段我可以直接对对方说的话。',
          wantThemToDo: '',
        });
        polished = res.polished;
      } else {
        const res = await emitAck<Ack>('ai:mouthpiece', {
          wantToSay:
            '请结合我最近的聊天内容，帮我整理一段我可以直接对对方说的话。',
          wantThemToDo: '',
        });
        if (!res.ok || !res.polished) throw new Error(res.error || '润色失败');
        polished = res.polished;
      }
      setResult(polished);
      setPhase('result');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setLocalBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(result);
      alert('已复制');
    } catch {
      alert('复制失败，请手动选中复制');
    }
  }

  const busy = props.busy || localBusy;
  const subtitle = phase === 'guide' ? '先看功能说明，再一键生成' : '可编辑后复制或填入输入框';

  return (
    <SheetModal
      title="嘴替"
      subtitle={subtitle}
      onClose={props.onClose}
      hideCloseButton
      footer={
        phase === 'guide' ? (
          <>
            <button className="btn secondary" onClick={props.onClose}>
              关闭
            </button>
            <button className="btn" disabled={busy} onClick={() => void generate()}>
              {busy ? (
                <span className="btn-loading">
                  <span className="spinner" />
                  生成中…
                </span>
              ) : (
                '确认并生成'
              )}
            </button>
          </>
        ) : (
          <>
            <button className="btn secondary" disabled={busy} onClick={() => void generate()}>
              {busy ? (
                <span className="btn-loading">
                  <span className="spinner" />
                  生成中…
                </span>
              ) : (
                '重新生成'
              )}
            </button>
            <button className="btn secondary" disabled={!result.trim()} onClick={() => void copy()}>
              复制
            </button>
          </>
        )
      }
    >
      {phase === 'guide' && (
        <>
          <p className="modal-lead">
            这个功能会直接结合你最近的聊天上下文，自动生成一段更容易让对方听进去的话。你不用手动填写内容，确认后会立即生成，可继续编辑和复制。
          </p>
          {busy && (
            <div className="loading-block">
              <span className="spinner" />
              <span>正在生成嘴替文案…</span>
            </div>
          )}
        </>
      )}

      {phase === 'result' && (
        <div className="field">
          <label>润色结果（给对方看）</label>
          <div className="desc">这是你会说给对方听的话，可直接改措辞，满意后再复制或填入输入框。</div>
          <textarea
            className="polished-box polished-edit"
            value={result}
            onChange={(e) => setResult(e.target.value)}
            rows={8}
          />
        </div>
      )}
    </SheetModal>
  );
}
