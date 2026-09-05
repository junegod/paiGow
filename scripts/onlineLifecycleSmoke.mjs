import WebSocket from 'ws'

const url = process.env.ONLINE_WS_URL ?? 'ws://127.0.0.1:8787'
const protocolVersion = '2026-09-05-room-v2'

/** 等待连接打开，失败时让脚本以非零状态结束。 */
function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
}

/** 等待指定消息类型和附加条件，避免依赖固定 setTimeout。 */
function waitForMessage(socket, type, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', handleMessage)
      reject(new Error(`等待 ${type} 消息超时。`))
    }, 8_000)

    function handleMessage(data) {
      const message = JSON.parse(String(data))
      if (message.type !== type || !predicate(message)) {
        return
      }

      clearTimeout(timer)
      socket.off('message', handleMessage)
      resolve(message)
    }

    socket.on('message', handleMessage)
  })
}

/** 按当前协议发送消息。 */
function send(socket, payload) {
  socket.send(JSON.stringify({ ...payload, protocolVersion }))
}

const hostSocket = new WebSocket(url)
const guestSocket = new WebSocket(url)

try {
  await Promise.all([waitForOpen(hostSocket), waitForOpen(guestSocket)])
  const createdPromise = waitForMessage(hostSocket, 'room-created')
  send(hostSocket, { type: 'create-room', playerName: 'Host' })
  const created = await createdPromise

  const joinedPromise = waitForMessage(guestSocket, 'room-joined')
  send(guestSocket, {
    type: 'join-room',
    roomCode: created.roomCode,
    playerName: 'Guest',
  })
  const joined = await joinedPromise

  const transferredPromise = waitForMessage(
    guestSocket,
    'room-state',
    (message) => message.room.hostSeat === joined.player.seat,
  )
  send(hostSocket, { type: 'leave-room', playerToken: created.player.token })
  await transferredPromise

  const startedPromise = waitForMessage(
    guestSocket,
    'room-state',
    (message) => Boolean(message.state.currentRound),
  )
  send(guestSocket, { type: 'start-match', playerToken: joined.player.token })
  await startedPromise

  console.log(JSON.stringify({
    ok: true,
    roomCode: created.roomCode,
    newHostSeat: joined.player.seat,
  }))
} finally {
  hostSocket.close()
  guestSocket.close()
}
