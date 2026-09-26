import type { SeatId } from '@/rules-core/types'

/** 断线后需要恢复的联机会话。 */
export interface OnlineSessionSnapshot {
  /** 用于找回原房间的六位号码。 */
  roomCode: string
  /** 座位身份凭证，仅保存在本机，不展示给其他玩家。 */
  playerToken: string
  /** 恢复连接后沿用的玩家昵称。 */
  playerName: string
  /** 服务端座位，显示时仍需转换为自己的视角。 */
  seat: SeatId
}

/** 浏览器 localStorage 里的联机会话键。 */
const ONLINE_SESSION_STORAGE_KEY = 'da-suo-zi.online-session'

/**
 * 读取本地联机会话。
 *
 * @returns 会话或 null。
 */
export function readOnlineSession(): OnlineSessionSnapshot | null {
  try {
    const rawSession = localStorage.getItem(ONLINE_SESSION_STORAGE_KEY)

    if (!rawSession) {
      return null
    }

    const session = JSON.parse(rawSession) as OnlineSessionSnapshot

    return session.roomCode && session.playerToken
      ? session
      : null
  } catch {
    return null
  }
}

/**
 * 保存本地联机会话，断线或刷新后自动找回座位。
 *
 * @param session 需要保存的会话。
 */
export function saveOnlineSession(session: OnlineSessionSnapshot): void {
  localStorage.setItem(ONLINE_SESSION_STORAGE_KEY, JSON.stringify(session))
}

/**
 * 离开联机模式时清理本地会话。
 */
export function clearOnlineSession(): void {
  localStorage.removeItem(ONLINE_SESSION_STORAGE_KEY)
}
