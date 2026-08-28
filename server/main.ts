import http from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  ONLINE_RULE_ENGINE_REVISION,
  OnlineRoomService,
} from './roomService'

const port = Number(process.env.PORT ?? 8787)
const server = http.createServer((request, response) => {
  if (request.headers.upgrade?.toLowerCase() === 'websocket') {
    return
  }

  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify({
    ok: true,
    service: 'da-suo-zi-online',
    rulesRevision: ONLINE_RULE_ENGINE_REVISION,
  }))
})
const websocketServer = new WebSocketServer({ server })
const roomService = new OnlineRoomService()

websocketServer.on('connection', (socket: WebSocket) => {
  socket.on('message', (data) => {
    try {
      const result = roomService.handleMessage(socket, data.toString())
      socket.send(JSON.stringify(result.toSelf))

      if (result.toRoom) {
        for (const client of websocketServer.clients) {
          if (client !== socket && client.readyState === socket.OPEN) {
            client.send(JSON.stringify(result.toRoom.message))
          }
        }
      }
    } catch {
      socket.send(JSON.stringify({
        type: 'error',
        code: 'server-error',
        message: '服务器处理请求失败，请重试。',
      }))
    }
  })

  socket.on('close', () => {
    roomService.handleDisconnect(socket)
  })
})

server.listen(port, '0.0.0.0', () => {
  console.log(`打索子联机服务已启动: http://0.0.0.0:${port}`)
})

function shutdown(): void {
  roomService.stop()
  websocketServer.close()
  server.close(() => {
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
