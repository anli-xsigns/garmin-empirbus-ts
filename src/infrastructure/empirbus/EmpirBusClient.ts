import { MessageType } from './messages'
import * as fs from 'fs'
import * as path from 'path'

type WsFactory = (url: string) => WebSocket

export class EmpirBusClient {
  // Logging config (env or programmatic)
  static loggingEnabled: boolean = (process.env.EMPIRBUS_LOG === '1' || !!process.env.EMPIRBUS_LOG_FILE)
  static logFile: string = process.env.EMPIRBUS_LOG_FILE || 'logs\\empirbus.ndjson'
  static configureLogging(opts: { enabled?: boolean; file?: string } = {}) {
    if (typeof opts.enabled === 'boolean') EmpirBusClient.loggingEnabled = opts.enabled
    if (typeof opts.file === 'string' && opts.file.trim()) EmpirBusClient.logFile = opts.file
  }
  private ws: WebSocket | null = null
  private url: string
  private onMessageFns: Array<(msg: any) => void> = []
  private onStateFns: Array<(state: number) => void> = []
  private wsFactory: WsFactory
  private heartbeat: any = null
  private logStream: fs.WriteStream | null = null

  constructor(url: string, wsFactory?: WsFactory) {
    this.url = url
    this.wsFactory = wsFactory || ((u: string) => new WebSocket(u))
    // prepare logging if enabled
    if (EmpirBusClient.loggingEnabled) {
      try {
        const dir = path.dirname(EmpirBusClient.logFile)
        if (dir && dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        this.logStream = fs.createWriteStream(EmpirBusClient.logFile, { flags: 'a' })
      } catch {}
    }
    this.url = url
    this.wsFactory = wsFactory || ((u: string) => new WebSocket(u))
  }

  connect() {
    return new Promise<void>((resolve, reject) => {
      try {
        const ws = this.wsFactory(this.url)
        this.ws = ws
        ws.onopen = () => {
          this.writeLog({ ts: new Date().toISOString(), dir: 'out', raw: '[connected]' })
          // Start 500ms heartbeat (acknowledgement) to keep subscriptions alive
          if (this.heartbeat) clearInterval(this.heartbeat);
          this.heartbeat = setInterval(() => {
            try { this.sendJson({ messagetype: MessageType.acknowledgement, messagecmd: 0, size: 1, data: [0] }); } catch {}
          }, 500);
          this.notifyState(1)
          resolve()
        }
        ws.onmessage = e => {
          try { this.writeLog({ ts: new Date().toISOString(), dir: 'in', raw: (e as MessageEvent).data as string }) } catch {}
          try {
            const data = JSON.parse((e as MessageEvent).data as string)
            this.onMessageFns.forEach(fn => fn(data))
          } catch {}
        }
        ws.onerror = (err: any) => {
              try { this.writeLog({ ts: new Date().toISOString(), dir: 'out', raw: `[error] ${err?.message || 'ws error'}` }) } catch {}
              if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
          this.notifyState(3)
        }
        ws.onclose = () => {
          try { this.writeLog({ ts: new Date().toISOString(), dir: 'out', raw: '[closed]' }) } catch {}
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
    const payload = JSON.stringify(data); this.ws.send(payload); try { this.writeLog({ ts: new Date().toISOString(), dir: 'out', raw: payload }) } catch {}
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

  private writeLog(obj: any) {
    if (!EmpirBusClient.loggingEnabled) return
    try {
      const line = JSON.stringify(obj) + '\n'
      if (this.logStream) this.logStream.write(line)
      else fs.appendFileSync(EmpirBusClient.logFile, line, 'utf8')
    } catch {}
  }

  private notifyState(state: number) {
    this.onStateFns.forEach(fn => fn(state))
  }
}
