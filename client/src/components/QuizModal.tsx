import { useMemo, useState } from 'react';
import {
  RELATIONSHIP_QUIZ_FLOW,
  buildAssessmentFromAnswers,
  formatAssessmentSummary,
  type QuizStep,
} from '../../../shared/quiz';
import type { AssessmentResult } from '../../../shared/types';
import { SheetModal } from './SheetModal';

type Phase = 'intro' | 'section_intro' | 'quiz' | 'partner_intro' | 'result';

export function QuizModal(props: {
  counterpartLabel?: string;
  onClose: () => void;
  onComplete: (assessment: AssessmentResult) => void | Promise<void>;
  busy?: boolean;
}) {
  const flow = RELATIONSHIP_QUIZ_FLOW;
  const [phase, setPhase] = useState<Phase>('intro');
  const [sectionIndex, setSectionIndex] = useState(0);
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [skippedPartner, setSkippedPartner] = useState(false);
  const [result, setResult] = useState<AssessmentResult | null>(null);

  const section: QuizStep | undefined = flow[sectionIndex];
  const totalQ = useMemo(
    () => flow.reduce((n, s) => n + s.scale.items.length, 0),
    [flow]
  );

  function start() {
    setSectionIndex(0);
    setQIndex(0);
    setPhase('section_intro');
  }

  function beginSection() {
    const s = flow[sectionIndex];
    if (!s) return finish(false);
    if (s.partnerIntro && !skippedPartner) {
      setPhase('partner_intro');
      return;
    }
    setPhase('quiz');
    setQIndex(0);
  }

  function skipPartner() {
    setSkippedPartner(true);
    finish(true);
  }

  function continuePartner() {
    setPhase('quiz');
    setQIndex(0);
  }

  function selectAnswer(value: number) {
    if (!section) return;
    const arr = [...(answers[section.id] || [])];
    arr.push(value);
    const updated = { ...answers, [section.id]: arr };
    setAnswers(updated);

    if (qIndex < section.scale.items.length - 1) {
      setQIndex(qIndex + 1);
      return;
    }

    const nextIndex = sectionIndex + 1;
    if (nextIndex >= flow.length || (skippedPartner && flow[nextIndex]?.optional)) {
      finishWith(updated, skippedPartner);
      return;
    }
    setSectionIndex(nextIndex);
    setQIndex(0);
    const next = flow[nextIndex];
    if (next.partnerIntro) setPhase('partner_intro');
    else setPhase('section_intro');
  }

  function finish(skip: boolean) {
    finishWith(answers, skip);
  }

  function finishWith(ans: Record<string, number[]>, skip: boolean) {
    const assessment = buildAssessmentFromAnswers({
      selfAnswers: ans.attach_comm_self || [],
      partnerAnswers: skip ? null : ans.attach_comm_partner || null,
      skippedPartner: skip,
    });
    setResult(assessment);
    setPhase('result');
  }

  async function confirmResult() {
    if (!result) return;
    await props.onComplete(result);
  }

  const progress =
    section && phase === 'quiz'
      ? Math.round(((qIndex + 1) / section.scale.items.length) * 100)
      : 0;

  const title =
    phase === 'intro'
      ? '关系速测'
      : phase === 'result'
        ? '关系速测结果'
        : phase === 'partner_intro'
          ? `你眼中的 ${props.counterpartLabel || 'TA'}`
          : section?.title || '关系速测';

  const subtitle =
    phase === 'intro'
      ? '依恋与沟通 + 你眼中的 TA · 约 4–6 分钟 · 仅自己可见'
      : phase === 'quiz' && section
        ? `${qIndex + 1} / ${section.scale.items.length}`
        : phase === 'result'
          ? '仅自己可见 · 仅供参考'
          : phase === 'section_intro' && section
            ? `共 ${section.scale.items.length} 题`
            : undefined;

  const footer =
    phase === 'intro' ? (
      <>
        <button className="btn secondary" onClick={props.onClose}>
          关闭
        </button>
        <button className="btn" onClick={start}>
          开始
        </button>
      </>
    ) : phase === 'section_intro' ? (
      <button className="btn" onClick={beginSection}>
        开始答题
      </button>
    ) : phase === 'partner_intro' ? (
      <>
        <button className="btn secondary" onClick={skipPartner}>
          跳过
        </button>
        <button className="btn" onClick={continuePartner}>
          继续
        </button>
      </>
    ) : phase === 'result' ? (
      <>
        <button className="btn secondary" onClick={props.onClose}>
          关闭
        </button>
        <button className="btn" disabled={props.busy} onClick={() => void confirmResult()}>
          保存并告诉 Lumi
        </button>
      </>
    ) : undefined;

  return (
    <SheetModal
      title={title}
      subtitle={subtitle}
      onClose={props.onClose}
      hideCloseButton
      wide
      closeOnBackdrop={false}
      footer={footer}
    >
      {phase === 'intro' && (
        <div className="quiz-intro-meta">
          <p>
            <strong>一、依恋与沟通</strong>（16 题）
          </p>
          <p>
            <strong>二、你眼中的 {props.counterpartLabel || 'TA'}</strong>（10 题，可跳过）
          </p>
          <p className="desc">共约 {totalQ} 题。结果会交给 Lumi 参考，不是诊断。</p>
        </div>
      )}

      {phase === 'section_intro' && section && (
        <>
          <div className="quiz-steps">
            {flow.map((s) => (
              <span
                key={s.id}
                className={`quiz-step ${s.part === section.part ? 'active' : ''} ${
                  s.part < section.part ? 'done' : ''
                }`}
              >
                {s.part}. {s.title}
              </span>
            ))}
          </div>
          <p className="modal-lead">
            {section.id === 'attach_comm_self'
              ? '了解你在关系里的靠近方式，以及冲突时更常追上去谈，还是先躲开冷一冷。'
              : '你印象中对方的靠近方式与沟通习惯。'}
          </p>
        </>
      )}

      {phase === 'partner_intro' && (
        <>
          <p className="modal-lead">
            接下来是你<strong>印象中</strong>对方在关系里的样子——不是替对方作答，也不是事实判断。
          </p>
          <p className="desc">跳过的话，只保留第一部分解读。</p>
        </>
      )}

      {phase === 'quiz' && section && (
        <>
          <div className="quiz-steps">
            {flow.map((s) => (
              <span
                key={s.id}
                className={`quiz-step ${s.part === section.part ? 'active' : ''} ${
                  s.part < section.part ? 'done' : ''
                }`}
              >
                {s.part}. {s.title}
              </span>
            ))}
          </div>
          <div className="game-progress-bar">
            <div className="game-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="quiz-question">{section.scale.items[qIndex].q}</div>
          <div className="quiz-likert">
            {section.scale.likertLabels.map((label, i) => (
              <button
                key={label}
                className="quiz-likert-option"
                onClick={() => selectAnswer(i + 1)}
              >
                <span className="quiz-likert-value">{i + 1}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {phase === 'result' && result && (
        <>
          <div className="polished-box">{formatAssessmentSummary(result)}</div>
          <p className="desc" style={{ marginTop: 10 }}>
            以上基于依恋与沟通速测，不能替代专业评估。印象题为主观感受。
          </p>
        </>
      )}
    </SheetModal>
  );
}
