import { useEffect, useState } from 'react'

import type { OnlineClientStatus } from '@/services/online/OnlineClient'
import type { OnlineRoomState } from '@/services/online/types'
import type { SeatId } from '@/rules-core/types'

interface OnlineRoomPanelProps {
  /** 当前房间公开状态。 */
  room: OnlineRoomState
  /** 当前玩家服务端座位。 */
  playerSeat: SeatId
  /** 当前玩家是否为房主。 */
  isHost: boolean
  /** WebSocket 连接状态。 */
  connectionStatus: OnlineClientStatus
  /** 房间内短通知。 */
  notice: string | null
  /** 当前错误。 */
  error: string | null
  /** 当前机器人名称。 */
  botNames: string[]
  /** 保存机器人名称。 */
  onSaveBotNames: (names: string[]) => void
  /** 房主开局。 */
  onStartMatch: () => void
  /** 离开房间并返回联机大厅。 */
  onLeaveRoom: () => void
}

/**
 * 等待房间界面：以四方桌布局表达座位、房主、真人和断线状态。
 */
export function OnlineRoomPanel({
  room,
  playerSeat,
  isHost,
  connectionStatus,
  notice,
  error,
  botNames,
  onSaveBotNames,
  onStartMatch,
  onLeaveRoom,
}: OnlineRoomPanelProps) {
  const [draftBotNames, setDraftBotNames] = useState(botNames)
  const [copied, setCopied] = useState(false)
  const connected = connectionStatus === 'connected'

  useEffect(() => {
    setDraftBotNames(botNames)
  }, [botNames])

  useEffect(() => {
    if (!copied) {
      return
    }

    const timer = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(timer)
  }, [copied])

  /** 复制房间码；剪贴板不可用时仍保留页面上的可选中文本。 */
  async function copyRoomCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(room.roomCode)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  /** 更新一个机器人名称输入，不在每次键盘输入时请求服务端。 */
  function updateBotName(index: number, value: string): void {
    setDraftBotNames((previousNames) => previousNames.map((name, currentIndex) =>
      currentIndex === index ? value : name,
    ))
  }

  return (
    <main className="app-shell online-shell">
      <section className="online-panel online-waiting-panel">
        <header className="online-panel__topbar">
          <button type="button" className="online-back-button" onClick={onLeaveRoom}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
            返回大厅
          </button>
          <strong className="online-brand-title">打索子</strong>
          <span className={`online-connection online-connection--${connectionStatus}`}>
            <span aria-hidden="true" />
            {connected ? '已连接' : '正在重连'}
          </span>
        </header>

        <div className="online-room-code-panel">
          <span>房间</span>
          <strong>{room.roomCode}</strong>
          <button type="button" onClick={() => void copyRoomCode()}>
            {copied ? '已复制' : '复制房间码'}
          </button>
          <p>分享给好友，一起打索子</p>
        </div>

        <section className="online-seat-table" aria-label="房间座位">
          <div className="online-seat-table__mark" aria-hidden="true">索</div>
          {room.seatConfigs.map((seatConfig) => {
            const roomPlayer = room.players.find((item) => item.seat === seatConfig.seat)
            const online = roomPlayer?.online ?? false
            const human = Boolean(roomPlayer)
            const status = human ? (online ? '在线' : '暂时断线') : '机器人'

            return (
              <article
                key={seatConfig.seat}
                className={`online-seat-card online-seat-card--seat-${seatConfig.seat} ${!online && human ? 'online-seat-card--disconnected' : ''}`}
              >
                <div className="online-seat-card__avatar" aria-hidden="true">
                  {human ? seatConfig.name.slice(0, 1) : '机'}
                </div>
                <div>
                  <strong>{seatConfig.name}</strong>
                  <p>
                    {roomPlayer?.isHost ? <em>房主</em> : null}
                    {seatConfig.seat === playerSeat ? <em>我</em> : null}
                    <span className={online ? 'is-online' : ''}>{status}</span>
                  </p>
                </div>
              </article>
            )
          })}
        </section>

        <footer className="online-waiting-actions">
          <div className="online-waiting-actions__message">
            <strong>{isHost ? '你是房主' : '等待房主开始'}</strong>
            <span>{notice ?? '人齐后由房主开始，空位由机器人补位。'}</span>
          </div>

          {isHost ? (
            <div className="online-bot-editor">
              {draftBotNames.map((name, index) => (
                <label key={index}>
                  <span>机器人 {index + 1}</span>
                  <input
                    value={name}
                    maxLength={12}
                    onChange={(event) => updateBotName(index, event.target.value)}
                  />
                </label>
              ))}
              <button type="button" onClick={() => onSaveBotNames(draftBotNames)}>
                保存名字
              </button>
            </div>
          ) : null}

          <div className="online-waiting-actions__buttons">
            {isHost ? (
              <button
                type="button"
                className="online-primary-button"
                disabled={!connected}
                onClick={onStartMatch}
              >
                开始牌局
              </button>
            ) : null}
            <button type="button" className="online-danger-button" onClick={onLeaveRoom}>
              离开房间
            </button>
          </div>
          {error ? <p className="online-panel__error" role="alert">{error}</p> : null}
        </footer>
      </section>
    </main>
  )
}
