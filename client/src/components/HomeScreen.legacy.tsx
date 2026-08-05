/**
 * 首页 UI 存档（v1）
 * 回退方法：在浏览器控制台执行
 *   localStorage.setItem('lumi-home-ui', 'legacy')
 * 然后刷新；恢复新版：
 *   localStorage.removeItem('lumi-home-ui')
 */
import type { JoinedRoomSummary, UserId, UserProfile } from '../../../shared/types';

export type HomeScreenProps = {
  me: UserProfile;
  userId: UserId;
  users: Record<string, UserProfile>;
  displayName?: string;
  avatarUrl?: string | null;
  /** 已加入房间列表（点进房间） */
  joinedRooms?: JoinedRoomSummary[];
  recordsCount: number;
  online?: Record<string, boolean> | null;
  displayNames?: Record<string, string>;
  onOpenProfile?: () => void;
  onLogout: () => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onEnterRoom: (roomId: string) => void;
  onStartSingle: () => void;
  onOpenRecords: () => void;
};

export function HomeScreenLegacy(props: HomeScreenProps) {
  const { me, userId, users, recordsCount, online, joinedRooms = [] } = props;
  const displayName = props.displayName || me.name;

  return (
    <div className="page page-pad">
      <div className="chat-header" style={{ margin: '0 -16px 8px', border: 'none' }}>
        <div className="avatar" style={{ background: me.gradient, width: 36, height: 36 }}>
          {me.shortName}
        </div>
        <h1>{displayName}</h1>
        <button className="btn-ghost" onClick={props.onLogout}>
          切换
        </button>
      </div>
      <div className="brand" style={{ fontSize: 22 }}>
        lumi
      </div>
      <div className="sub">昵称登录 · 点进房间或生成/输入群聊码</div>

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
      </div>

      <div className="home-room-section">
        <div className="home-room-section-title">已加入的房间</div>
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
      </div>

      <button className="records-entry" onClick={props.onOpenRecords}>
        <div>
          <strong>沟通记录</strong>
          <span>
            {recordsCount > 0
              ? `共 ${recordsCount} 条 · 当前身份可见`
              : '结案或退出房间后会出现在这里'}
          </span>
        </div>
        <span className="records-entry-arrow">查看</span>
      </button>
      {online && (
        <div style={{ marginTop: 18, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.keys(online).map((id) => (
            <span key={id} className="status-pill">
              <span className={`dot ${online[id] ? 'on' : ''}`} />
              {props.displayNames?.[id] || users[id]?.name || id.slice(0, 6)}
              {id === userId ? '（我）' : ''}
              {online[id] ? ' 在线' : ' 离线'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
