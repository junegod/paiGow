import WebSocket from 'ws'

const url = process.env.ONLINE_WS_URL ?? 'ws://127.0.0.1:8787'
const protocolVersion = '2026-09-05-room-v2'
const socket = new WebSocket(url)

socket.on('open', () => {
  socket.send(JSON.stringify({ type: 'create-room', playerName: 'A', protocolVersion }))
})

socket.on('message', (data) => {
  const message = JSON.parse(String(data))
  if (message.type === 'error') {
    console.error(message.code, message.message)
    process.exitCode = 1
  } else {
    console.log(message.type, message.player?.seat, message.room?.roomCode)
  }
  socket.close()
})

socket.on('close', () => {
  process.exit(0)
})
