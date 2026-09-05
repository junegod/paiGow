import { ONLINE_PROTOCOL_VERSION } from '@/services/online/types'
import type { OnlineClientMessage, OnlineErrorCode } from '@/services/online/types'

const SUPPORTED_MESSAGE_TYPES = new Set([
  'create-room', 'join-room', 'list-rooms', 'resume-room', 'configure-bots',
  'start-match', 'leave-room', 'submit-action', 'request-room', 'request-state', 'ping',
])

/** 协议解析结果；错误由房间服务统一转换成客户端消息。 */
export type OnlineMessageParseResult =
  | { message: OnlineClientMessage; errorCode?: never; errorMessage?: never }
  | { message?: never; errorCode: OnlineErrorCode; errorMessage: string }

/** 对浏览器 JSON、消息类型和协议版本做运行时校验。 */
export function parseOnlineClientMessage(rawMessage: string): OnlineMessageParseResult {
  let value: unknown
  try {
    value = JSON.parse(rawMessage) as unknown
  } catch {
    return { errorCode: 'bad-message', errorMessage: '消息格式不正确，请刷新页面重试。' }
  }

  if (!value || typeof value !== 'object') {
    return { errorCode: 'bad-message', errorMessage: '消息字段不完整，请刷新页面重试。' }
  }
  const candidate = value as { type?: unknown; protocolVersion?: unknown }
  if (typeof candidate.type !== 'string' || !SUPPORTED_MESSAGE_TYPES.has(candidate.type)) {
    return { errorCode: 'bad-message', errorMessage: '暂不支持的消息类型。' }
  }
  if (candidate.protocolVersion !== ONLINE_PROTOCOL_VERSION) {
    return { errorCode: 'protocol-mismatch', errorMessage: '联机版本已更新，请刷新页面后重新进入。' }
  }
  return { message: value as OnlineClientMessage }
}
