import { MessageType } from './messages'

type WsFactory = (url: string) => WebSocket

export class EmpirBusClient {
  private ws: WebSocket | null = null
  private url: string
  private onMessageFns: Array<(msg: any) => void> = []
  private onStateFns: Array<(state: number) => void> = []
  private wsFactory: WsFactory
  private heartbeat: any = null

  constructor(url: string, wsFactory?: WsFactory) {
    this.url = url
    this.wsFactory = wsFactory || ((u: string) => new WebSocket(u))
  }

  connect() {
    return new Promise<void>((resolve, reject) => {
      try {
        const ws = this.wsFactory(this.url)
        this.ws = ws
        ws.onopen = () => {
          // Start 500ms heartbeat (acknowledgement) to keep subscriptions alive
          if (this.heartbeat) clearInterval(this.heartbeat);
          this.heartbeat = setInterval(() => {
            try { this.sendJson({ messagetype: MessageType.acknowledgement, messagecmd: 0, size: 1, data: [0] }); } catch {}
          }, 500);
          this.notifyState(1)
          resolve()
        }
        ws.onmessage = e => {
          try {
            const data = JSON.parse((e as MessageEvent).data as string)
            this.onMessageFns.forEach(fn => fn(data))
          } catch {}
        }
        ws.onerror = () => {
              if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
          this.notifyState(3)
        }
        ws.onclose = () => {
              if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
          this.notifyState(0)
        }
      } catch (err) {
        reject(err)
      }
    })
  }

  sendJson(data: any) {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return
    this.ws.send(JSON.stringify(data))
  }

  onMessage(fn: (msg: any) => void) {
    this.onMessageFns.push(fn)
  }

  onState(fn: (state: number) => void) {
    this.onStateFns.push(fn)
  }

  close() {
    if (this.ws && this.ws.readyState === this.ws.OPEN) this.ws.close()
  }

  private notifyState(state: number) {
    this.onStateFns.forEach(fn => fn(state))
  }
}