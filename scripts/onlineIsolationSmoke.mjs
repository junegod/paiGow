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

/** 等待指定消息类型和附加条件，避免依赖固定轮询。 */
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

/** 创建一个房间并让指定客人加入。 */
async function createJoinedRoom(hostSocket, guestSocket, roomName) {
  const createdPromise = waitForMessage(hostSocket, 'room-created')
  send(hostSocket, { type: 'create-room', playerName: `${roomName}房主` })
  const created = await createdPromise

  const joinedPromise = waitForMessage(guestSocket, 'room-joined')
  send(guestSocket, {
    type: 'join-room',
    roomCode: created.roomCode,
    playerName: `${roomName}客人`,
  })
  const joined = await joinedPromise
  return { created, joined }
}

const sockets = Array.from({ length: 4 }, () => new WebSocket(url))
const [aHostSocket, aGuestSocket, bHostSocket, bGuestSocket] = sockets
const roomStateCodes = sockets.map(() => [])

sockets.forEach((socket, socketIndex) => {
  socket.on('message', (data) => {
    const message = JSON.parse(String(data))
    if (message.type === 'room-state') {
      roomStateCodes[socketIndex].push(message.room.roomCode)
    }
  })
})

try {
  await Promise.all(sockets.map(waitForOpen))
  const roomA = await createJoinedRoom(aHostSocket, aGuestSocket, 'A房')
  const roomB = await createJoinedRoom(bHostSocket, bGuestSocket, 'B房')

  roomStateCodes.forEach((codes) => codes.splice(0))
  const startedPromise = waitForMessage(
    bGuestSocket,
    'room-state',
    (message) => Boolean(message.state.currentRound),
  )
  send(bHostSocket, { type: 'start-match', playerToken: roomB.created.player.token })
  await startedPromise

  await new Promise((resolve) => setTimeout(resolve, 200))
  const aReceivedForeignRoom = roomStateCodes[0].includes(roomB.created.roomCode)
    || roomStateCodes[1].includes(roomB.created.roomCode)
  if (aReceivedForeignRoom) {
    throw new Error('A 房间客户端收到了 B 房间的状态消息。')
  }

  console.log(JSON.stringify({
    ok: true,
    roomA: roomA.created.roomCode,
    roomB: roomB.created.roomCode,
    receivedRoomCodes: {
      aHost: roomStateCodes[0],
      aGuest: roomStateCodes[1],
      bHost: roomStateCodes[2],
      bGuest: roomStateCodes[3],
    },
  }))
} finally {
  sockets.forEach((socket) => socket.close())
}
