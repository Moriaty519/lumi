import { useState } from 'react';

type Step = 'intro' | 'portrait' | 'prefer' | 'interests' | 'match' | 'done';

const STEPS: { id: Step; title: string; blurb: string }[] = [
  {
    id: 'intro',
    title: '找搭子',
    blurb: '通过画像、偏好和兴趣，匹配合适的人，一起进树洞群聊（含 Lumi）。',
  },
  {
    id: 'portrait',
    title: '个人画像',
    blurb: '将结合 MBTI + 依恋类型生成摘要标签（对方只能看到摘要）。',
  },
  {
    id: 'prefer',
    title: '交友偏好',
    blurb: '用情景题了解你想找朋友还是恋爱对象、沟通节奏等。',
  },
  {
    id: 'interests',
    title: '兴趣标签',
    blurb: '选择你感兴趣的内容，提高匹配相关度。',
  },
  {
    id: 'match',
    title: '候选列表',
    blurb: '按画像、偏好、兴趣加权后展示候选人，由你自选。',
  },
  {
    id: 'done',
    title: '进入群聊',
    blurb: '确认后将自动建群：你、搭子、Lumi。',
  },
];

const DEMO_TAGS = ['ENFP · 摘要', '安全型依恋 · 摘要', '慢热聊天', '周末探店'];

const DEMO_CANDIDATES = [
  { name: '阿树', tags: ['INFJ', '安全型', '读书'] },
  { name: '小南', tags: ['ISFP', '焦虑型', '音乐'] },
  { name: '可儿', tags: ['ENTP', '安全型', '徒步'] },
];

export function FindBuddyDemo(props: { onBack: () => void }) {
  const [step, setStep] = useState<Step>('intro');
  const idx = STEPS.findIndex((s) => s.id === step);
  const current = STEPS[idx] || STEPS[0]!;

  function goNext() {
    const next = STEPS[idx + 1];
    if (next) setStep(next.id);
  }

  function goPrev() {
    if (idx <= 0) {
      props.onBack();
      return;
    }
    setStep(STEPS[idx - 1]!.id);
  }

  function showDev() {
    alert('开发中，敬请期待');
  }

  return (
    <div className="page page-pad find-buddy-page">
      <header className="chat-header" style={{ margin: '0 -16px 8px' }}>
        <button type="button" className="btn-ghost" onClick={goPrev}>
          {idx === 0 ? '返回' : '上一步'}
        </button>
        <h1>找搭子</h1>
        <span className="find-buddy-step-pill">
          {idx + 1}/{STEPS.length}
        </span>
      </header>

      <p className="find-buddy-demo-banner">演示流程 · 真实匹配尚未开通</p>

      <section className="find-buddy-card">
        <h2 className="find-buddy-title">{current.title}</h2>
        <p className="find-buddy-blurb">{current.blurb}</p>

        {step === 'intro' && (
          <ul className="find-buddy-list">
            <li>画像：MBTI + 依恋类型</li>
            <li>偏好：朋友 / 恋爱等都可选</li>
            <li>兴趣：自选标签</li>
            <li>结果：候选列表自选 → 系统建群</li>
            <li>暂无人：排队等待</li>
          </ul>
        )}

        {step === 'portrait' && (
          <div className="find-buddy-block">
            <div className="profile-chip-row">
              {DEMO_TAGS.slice(0, 2).map((t) => (
                <span key={t} className="profile-chip active">
                  {t}
                </span>
              ))}
            </div>
            <button type="button" className="btn secondary" style={{ marginTop: 12 }} onClick={showDev}>
              去做 MBTI + 依恋测评（开发中）
            </button>
          </div>
        )}

        {step === 'prefer' && (
          <div className="find-buddy-block">
            <button type="button" className="choice-card" onClick={showDev}>
              <strong>情景题示意</strong>
              <span>周末更想：安静聊天 / 一起出门</span>
            </button>
            <button type="button" className="choice-card" onClick={showDev} style={{ marginTop: 8 }}>
              <strong>关系意向示意</strong>
              <span>朋友 · 恋爱 · 都行</span>
            </button>
            <button type="button" className="btn secondary" style={{ marginTop: 12 }} onClick={showDev}>
              开始偏好测试（开发中）
            </button>
          </div>
        )}

        {step === 'interests' && (
          <div className="find-buddy-block">
            <div className="profile-chip-row">
              {['阅读', '音乐', '徒步', '探店', '影视', '游戏'].map((t) => (
                <button key={t} type="button" className="profile-chip" onClick={showDev}>
                  {t}
                </button>
              ))}
            </div>
            <p className="desc" style={{ marginTop: 10 }}>
              示意：点选后需保存（完整能力开发中）
            </p>
          </div>
        )}

        {step === 'match' && (
          <div className="find-buddy-block">
            <div className="find-buddy-candidates">
              {DEMO_CANDIDATES.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  className="find-buddy-candidate"
                  onClick={showDev}
                >
                  <strong>{c.name}</strong>
                  <span>{c.tags.join(' · ')}</span>
                  <em>邀请 / 开发中</em>
                </button>
              ))}
            </div>
            <button type="button" className="btn secondary" style={{ marginTop: 12 }} onClick={showDev}>
              暂时没人，排队等待（开发中）
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="find-buddy-block">
            <p className="desc">示意群成员：你 · 搭子 · Lumi</p>
            <button type="button" className="btn" onClick={showDev}>
              确认建群（开发中）
            </button>
          </div>
        )}
      </section>

      <div className="find-buddy-footer">
        {step !== 'done' ? (
          <button type="button" className="btn" onClick={goNext}>
            下一步
          </button>
        ) : (
          <button type="button" className="btn secondary" onClick={props.onBack}>
            回到首页
          </button>
        )}
      </div>
    </div>
  );
}
