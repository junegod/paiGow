import WebSocket from 'ws'

const url = process.env.ONLINE_WS_URL ?? 'ws://127.0.0.1:8788'
const socket = new WebSocket(url)

socket.on('open', () => {
  socket.send(JSON.stringify({ type: 'create-room', playerName: 'A' }))
})

socket.on('message', (data) => {
  const message = JSON.parse(String(data))
  console.log(message.type, message.player?.seat, message.room?.roomCode)
  socket.close()
})

socket.on('close', () => {
  process.exit(0)
})
