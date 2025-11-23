import * as fs from 'fs'
import * as path from 'path'
import { EmpirBusClientState } from './EmpirBusClientState'
import { LogLine } from './helpers'
import { MessageType } from './MessageType'

export class EmpirBusClient {
    static loggingEnabled: boolean = (process.env.EMPIRBUS_LOG === '1' || !!process.env.EMPIRBUS_LOG_FILE)
    static logFile: string = process.env.EMPIRBUS_LOG_FILE || 'logs\\empirbus.ndjson'
    private heartbeat: any = null
    private onMessageFns: Array<(msg: any) => void> = []
    private onStateFns: Array<(state: EmpirBusClientState) => void> = []
    private ws: WebSocket | null = null
    private logStream: fs.WriteStream | null = null
    private readonly url: string

    constructor(url: string, enableLogging?: boolean) {
        this.url = url
        EmpirBusClient.configureLogging({ enabled: enableLogging })
        this.setupLogging()
    }

    connect() {
        return new Promise<void>((resolve, reject) => {
            try {
                const ws = new WebSocket(this.url)
                this.ws = ws
                ws.onopen = () => {
                    this.writeLog(new LogLine('out', '[connected]'))
                    if (this.heartbeat)
                        clearInterval(this.heartbeat)
                    this.heartbeat = setInterval(() => {
                        this.sendJson({ messagetype: MessageType.acknowledgement, messagecmd: 0, size: 1, data: [0] })
                    }, 4 * 1000)
                    this.notifyState(EmpirBusClientState.Connected)
                    resolve()
                }
                ws.onmessage = e => {
                    this.writeLog(new LogLine('in', (e as MessageEvent).data as string))
                    const data = JSON.parse((e as MessageEvent).data as string)
                    this.onMessageFns.forEach(fn => fn(data))
                }
                ws.onerror = (err: any) => {
                    this.writeLog(new LogLine('out', `[error] ${err?.message || 'ws error'}`))
                    if (this.heartbeat) {
                        clearInterval(this.heartbeat)
                        this.heartbeat = null
                    }
                    this.notifyState(EmpirBusClientState.Error)
                }
                ws.onclose = () => {
                    this.writeLog(new LogLine('out', '[closed]'))
                    if (this.heartbeat) {
                        clearInterval(this.heartbeat)
                        this.heartbeat = null
                    }
                    this.notifyState(EmpirBusClientState.Closed)
                }
            }
            catch (err) {
                reject(err)
            }
        })
    }

    sendJson(data: any) {
        if (!this.ws || this.ws.readyState !== this.ws.OPEN)
            return
        const payload = JSON.stringify(data)
        this.ws.send(payload)
        this.writeLog(new LogLine('out', payload))
    }

    onMessage(fn: (msg: any) => void) {
        this.onMessageFns.push(fn)
    }

    onState(fn: (state: EmpirBusClientState) => void) {
        this.onStateFns.push(fn)
    }

    close() {
        if (this.ws && this.ws.readyState === this.ws.OPEN)
            this.ws.close()
    }

    static configureLogging(opts: { enabled?: boolean; file?: string } = {}) {
        if (typeof opts.enabled === 'boolean')
            EmpirBusClient.loggingEnabled = opts.enabled
        if (typeof opts.file === 'string' && opts.file.trim())
            EmpirBusClient.logFile = opts.file
    }

    private setupLogging(): void {
        if (!EmpirBusClient.loggingEnabled)
            return
        const dir = path.dirname(EmpirBusClient.logFile)
        if (dir && dir !== '.' && !fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true })
        this.logStream = fs.createWriteStream(EmpirBusClient.logFile, { flags: 'a' })
    }

    private writeLog(logLine: LogLine) {
        if (!EmpirBusClient.loggingEnabled)
            return
        try {
            const line = JSON.stringify(logLine) + '\n'
            if (this.logStream)
                this.logStream.write(line)
            else fs.appendFileSync(EmpirBusClient.logFile, line, 'utf8')
        }
        catch {
        }
    }

    private notifyState(state: EmpirBusClientState) {
        this.onStateFns.forEach(fn => fn(state))
    }
}
