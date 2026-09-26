import { useRef, useState } from 'react'

/** 联机数据用途版本；说明实质变化时更换版本，要求玩家重新确认。 */
const CONSENT_KEY = 'da-suo-zi.online-consent.v1'

/**
 * 读取已确认的联机说明；存储受限或旧版本未确认时按未授权处理。
 * @returns 当前设备是否保存了本版说明的确认记录。
 */
export function hasOnlineConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'accepted'
  } catch {
    return false
  }
}

/**
 * 将联机入口延迟到玩家确认数据用途后执行，不影响本地单机玩法。
 * @returns 说明开关、受保护的入口和同意、取消、撤回操作。
 */
export function useOnlineConsent() {
  const [requested, setRequested] = useState(false)
  /** 仅保留最近一次入口，防止重复点击确认时连续创建多个房间。 */
  const pendingAction = useRef<(() => void) | null>(null)
  const [granted, setGranted] = useState(hasOnlineConsent)

  /**
   * 保护所有能触发建连的用户入口。
   * @param action 确认后才能执行的联机操作。
   */
  function request(action: () => void): void {
    if (granted) {
      action()
      return
    }
    pendingAction.current = action
    setRequested(true)
  }

  /** 确认说明并执行一次待办；本地存储不可用时本次确认仍有效，下次启动重新询问。 */
  function accept(): void {
    setGranted(true)
    try { localStorage.setItem(CONSENT_KEY, 'accepted') } catch { /* 存储受限时只保留内存确认。 */ }
    const action = pendingAction.current
    pendingAction.current = null
    setRequested(false)
    action?.()
  }

  /** 取消待办并回到当前页面，不建立网络连接，也不限制单机功能。 */
  function cancel(): void {
    pendingAction.current = null
    setRequested(false)
  }

  /** 撤回后下一次联机必须重新确认；调用方应先退出房间并关闭当前连接。 */
  function revoke(): void {
    setGranted(false)
    localStorage.removeItem(CONSENT_KEY)
    cancel()
  }

  return { granted, requested, request, accept, cancel, revoke }
}
