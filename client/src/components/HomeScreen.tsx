/**
 * 首页 UI v2
 * 副文案：你的树洞搭子
 *
 * 回退到上一版（v1）：
 *   localStorage.setItem('lumi-home-ui', 'legacy')
 * 恢复本版：
 *   localStorage.removeItem('lumi-home-ui')
 */
import type { HomeScreenProps } from './HomeScreen.legacy';
import { HomeScreenLegacy } from './HomeScreen.legacy';

export type { HomeScreenProps };

export function useHomeUiVersion(): 'v2' | 'legacy' {
  try {
    return localStorage.getItem('lumi-home-ui') === 'legacy' ? 'legacy' : 'v2';
  } catch {
    return 'v2';
  }
}

export function HomeScreen(props: HomeScreenProps) {
  if (useHomeUiVersion() === 'legacy') {
    return <HomeScreenLegacy {...props} />;
  }
  return <HomeScreenV2 {...props} />;
}

function HomeScreenV2(props: HomeScreenProps) {
  const { me, userId, users, recordsCount, joinedRooms = [] } = props;
  const displayName = props.displayName || me.name;
  const avatarUrl = props.avatarUrl;

  return (
    <div className="page page-pad home-page">
      <header className="home-top">
        <button
          type="button"
          className="home-user"
          onClick={() => props.onOpenProfile?.()}
          aria-label="进入个人主页"
        >
          {avatarUrl ? (
            <img className="avatar home-avatar home-avatar-img" src={avatarUrl} alt="" />
          ) : (
            <div className="avatar home-avatar" style={{ width: 36, height: 36 }}>
              {displayName.slice(0, 1) || me.shortName}
            </div>
          )}
          <span className="home-user-name">{displayName}</span>
        </button>
        <button className="btn-ghost" onClick={props.onLogout}>
          切换
        </button>
      </header>

      <div className="home-hero">
        <img className="home-logo" src="/lumi-fed.png" alt="Lumi" />
        <h1 className="home-title">lumi</h1>
        <p className="home-tagline">你的树洞搭子</p>
      </div>

      <div className="home-actions-row">
        <button type="button" className="home-action-chip" onClick={props.onCreateRoom}>
          创建群聊
        </button>
        <button type="button" className="home-action-chip" onClick={props.onJoinRoom}>
          输入群聊码
        </button>
        <button type="button" className="home-action-chip" onClick={props.onStartSingle}>
          单人模式
        </button>
        {props.onFindBuddy && (
          <button type="button" className="home-action-chip" onClick={props.onFindBuddy}>
            找搭子
          </button>
        )}
      </div>

      <section className="home-room-section">
        <h2 className="home-room-section-title">已加入的房间</h2>
        {joinedRooms.length === 0 ? (
          <p className="home-room-empty">还没有房间，创建一个或加入好友的房间吧</p>
        ) : (
          <ul className="home-room-list">
            {joinedRooms.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="home-room-item"
                  onClick={() => props.onEnterRoom(r.id)}
                >
                  <span className="home-room-item-main">
                    <strong>{r.groupName}</strong>
                    <span className="home-room-code">{r.code}</span>
                  </span>
                  <span className="home-room-item-meta">{r.memberCount} 人 ›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button type="button" className="home-records-link" onClick={props.onOpenRecords}>
        沟通记录
        {recordsCount > 0 ? ` · ${recordsCount}` : ''}
        <span aria-hidden> ›</span>
      </button>
    </div>
  );
}
