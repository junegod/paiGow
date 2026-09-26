/** 可精确控制断网、握手和服务端响应的测试连接，不访问真实网络。 */
export class FakeWebSocket {
  /** 与浏览器 WebSocket 相同的就绪常量。 */
  static readonly OPEN = 1
  /** 测试创建的连接，便于检查是否发生重连。 */
  static instances: FakeWebSocket[] = []
  /** 初始处于连接中，只有测试显式握手才会就绪。 */
  readyState = 0
  /** 客户端发出的原始协议报文。 */
  sent: string[] = []
  /** 连接成功回调。 */
  onopen: (() => void) | null = null
  /** 收到服务端文本消息的回调。 */
  onmessage: ((event: { data: string }) => void) | null = null
  /** 关闭和异常回调，模拟浏览器行为。 */
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  /** 注册连接实例，测试之间由调用方清空列表。 */
  constructor() { FakeWebSocket.instances.push(this) }

  /** 完成握手后通知客户端。 */
  open(): void { this.readyState = 1; this.onopen?.() }

  /**
   * 记录发送内容；断线连接不可发送。
   * @param data 序列化协议消息。
   */
  send(data: string): void {
    if (this.readyState !== 1) { throw new Error('测试连接未就绪') }
    this.sent.push(data)
  }

  /** 模拟正常关闭，半开连接测试则不调用此方法。 */
  close(): void { this.readyState = 3; this.onclose?.() }

  /**
   * 注入服务端响应。
   * @param message 测试所需的协议报文。
   */
  receive(message: unknown): void { this.onmessage?.({ data: JSON.stringify(message) }) }
}
