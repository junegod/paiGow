import WebSocket from 'ws'

const sockets = [new WebSocket('ws://127.0.0.1:8787'), new WebSocket('ws://127.0.0.1:8787')]
let created = null
let joined = null
let guestHostNotice = false
let ceremonySeen = false
let actionSubmitted = false

sockets[0].on('open', () => sockets[0].send(JSON.stringify({type:'create-room',playerName:'Host'})))
sockets[0].on('message', data => {
  const message = JSON.parse(String(data))
  if (message.type === 'room-created') {
    created = message
    sockets[1].send(JSON.stringify({type:'join-room',roomCode:message.roomCode,playerName:'Guest'}))
  }
})

sockets[1].on('message', data => {
  const message = JSON.parse(String(data))
  if (message.type === 'room-joined') joined = message
  if (message.type === 'host-changed') guestHostNotice = true
})

setTimeout(() => {
  if (!created || !joined) throw new Error('join failed')
  sockets[0].send(JSON.stringify({type:'start-match',playerToken:created.player.token}))
  sockets[0].on('message', data => {
    const message = JSON.parse(String(data))
    if (message.type === 'room-state' && message.state.currentRound && !ceremonySeen) {
      ceremonySeen = true
      sockets[0].send(JSON.stringify({type:'leave-room',playerToken:created.player.token}))
    }
  })
  sockets[1].on('message', data => {
    const message = JSON.parse(String(data))
    if (message.type === 'room-state' && message.room.hostSeat === joined.player.seat && message.state.currentRound && !actionSubmitted) {
      actionSubmitted = true
      const round = message.state.currentRound
      const seatState = round.seats.find(item => item.seat === round.currentSeat)
      const action = { seat: round.currentSeat, intent: 'lead-open', selectedCardIds: seatState.hand.slice(0,1).map(card => card.id) }
      sockets[1].send(JSON.stringify({type:'submit-action',playerToken:joined.player.token,action}))
      setTimeout(() => {
        console.log(JSON.stringify({ok:ceremonySeen,guestHostNotice,actionSubmitted}))
        sockets.forEach(socket => socket.close())
      }, 800)
    }
  })
}, 300)

sockets.forEach(socket => socket.on('error', error => { console.error(error); process.exit(1) }))
