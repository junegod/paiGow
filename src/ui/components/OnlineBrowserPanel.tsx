import type { OnlineClientStatus } from '@/services/online/OnlineClient'
import type { OnlineRoomSummary } from '@/services/online/types'

interface OnlineBrowserPanelProps {
  /** 当前 WebSocket 连接状态。 */
  connectionStatus: OnlineClientStatus
  /** 等待开局的公开房间列表。 */
  rooms: OnlineRoomSummary[]
  /** 是否正在等待首次房间列表。 */
  loading: boolean
  /** 当前昵称输入。 */
  playerName: string
  /** 服务端或网络错误。 */
  error: string | null
  /** 更新昵称输入。 */
  onPlayerNameChange: (value: string) => void
  /** 创建新房间。 */
  onCreateRoom: () => void
  /** 加入指定房间。 */
  onJoinRoom: (roomCode: string) => void
  /** 返回游戏首页。 */
  onBack: () => void
}

/** 返回箭头图标，使用 currentColor 适配按钮状态。 */
function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  )
}

/** 联机状态点；断线和重连通过颜色与文字同时表达。 */
function ConnectionState({ status }: { status: OnlineClientStatus }) {
  const connected = status === 'connected'
  const label = connected ? '已连接' : status === 'reconnecting' ? '正在重连' : '正在连接'

  return (
    <span className={`online-connection online-connection--${status}`}>
      <span aria-hidden="true" />
      {label}
    </span>
  )
}

/**
 * 联机大厅：集中处理昵称、创建房间和房间发现，避免这些流程继续堆在 App 组件中。
 */
export function OnlineBrowserPanel({
  connectionStatus,
  rooms,
  loading,
  playerName,
  error,
  onPlayerNameChange,
  onCreateRoom,
  onJoinRoom,
  onBack,
}: OnlineBrowserPanelProps) {
  const connected = connectionStatus === 'connected'

  return (
    <main className="app-shell online-shell">
      <section className="online-panel online-browser-panel">
        <header className="online-panel__topbar">
          <button type="button" className="online-back-button" onClick={onBack}>
            <BackIcon />
            返回首页
          </button>
          <h1>联机大厅</h1>
          <ConnectionState status={connectionStatus} />
        </header>

        <div className="online-panel__body">
          <section className="online-create-section" aria-labelledby="online-create-title">
            <div className="online-section-heading">
              <h2 id="online-create-title">创建房间</h2>
              <p>输入朋友认识的昵称，创建后分享六位房间码。</p>
            </div>
            <div className="online-create-row">
              <label>
                <span>我的昵称</span>
                <input
                  value={playerName}
                  maxLength={12}
                  placeholder="例如：阿明"
                  onChange={(event) => onPlayerNameChange(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="online-primary-button"
                disabled={!connected}
                onClick={onCreateRoom}
              >
                新建房间
              </button>
            </div>
          </section>

          <section className="online-room-list-section" aria-labelledby="online-room-list-title">
            <div className="online-section-heading online-section-heading--row">
              <div>
                <h2 id="online-room-list-title">开放房间</h2>
                <p>只展示尚未开局且仍有真人在线的房间。</p>
              </div>
              <span>{rooms.length} 个可加入</span>
            </div>

            <div className="online-room-list" aria-live="polite">
              {rooms.map((room) => {
                const full = room.onlineCount >= room.maxCount

                return (
                  <article key={room.roomCode} className="online-room-row">
                    <div className="online-room-row__avatar" aria-hidden="true">
                      {room.hostName.slice(0, 1)}
                    </div>
                    <div className="online-room-row__owner">
                      <strong>{room.hostName} 的房间</strong>
                      <span>等待朋友加入</span>
                    </div>
                    <div className="online-room-row__code">
                      <span>房间码</span>
                      <strong>{room.roomCode}</strong>
                    </div>
                    <div className="online-room-row__count">
                      <span>在线人数</span>
                      <strong>{room.onlineCount}/{room.maxCount}</strong>
                    </div>
                    <button
                      type="button"
                      className="online-row-action"
                      disabled={!connected || full}
                      onClick={() => onJoinRoom(room.roomCode)}
                    >
                      {full ? '已满' : '加入'}
                    </button>
                  </article>
                )
              })}

              {rooms.length === 0 ? (
                <div className="online-room-empty">
                  <span aria-hidden="true">桌</span>
                  <strong>{loading ? '正在查找房间' : '暂时没有等待中的房间'}</strong>
                  <p>{loading ? '很快就好。' : '创建一个房间，再把房间码发给朋友。'}</p>
                </div>
              ) : null}
            </div>
          </section>

          {error ? <p className="online-panel__error" role="alert">{error}</p> : null}
        </div>
      </section>
    </main>
  )
}
