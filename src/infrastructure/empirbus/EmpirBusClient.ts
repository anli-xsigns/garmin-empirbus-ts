import * as fs from 'fs'
import * as path from 'path'
import { EmpirBusClientState } from './EmpirBusClientState'
import { LogLine } from './helpers'
import { MessageType } from './MessageType'
import WebSocket from 'ws'

type OnLogFn = (logLine: LogLine) => void

export class EmpirBusClient {
    static loggingEnabled: boolean = (process.env.EMPIRBUS_LOG === '1' || !!process.env.EMPIRBUS_LOG_FILE)
    static logFile: string = process.env.EMPIRBUS_LOG_FILE || 'logs\\\\empirbus.ndjson'

    private heartbeat: any = null
    private onMessageFns: Array<(msg: any) => void> = []
    private onStateFns: Array<(state: EmpirBusClientState) => void> = []
    private onLogFns: OnLogFn[] = []
    private ws: WebSocket | null = null
    private logStream: fs.WriteStream | null = null
    private readonly url: string

    constructor(url: string, enableLogging?: boolean) {
        this.url = url
        EmpirBusClient.configureLogging({ enabled: enableLogging })
        this.setupLogging()
    }

    onLog(fn: OnLogFn) {
        this.onLogFns.push(fn)
    }

    connect() {
        this.notifyState(EmpirBusClientState.Connecting)
        return new Promise<void>((resolve, reject) => {
            try {
                const ws = new WebSocket(this.url)
                this.ws = ws

                ws.onopen = () => {
                    this.writeLog(new LogLine('out', '[connected]'))
                    this.stopSendingHeartbeat()
                    this.sendHeartbeatRegularly()
                    this.notifyState(EmpirBusClientState.Connected)
                    resolve()
                }

                ws.on('message', raw => {
                    const text = this.toText(raw)
                    this.writeLog(new LogLine('in', text))
                    const data = JSON.parse(text)
                    this.onMessageFns.forEach(fn => fn(data))
                })

                ws.on('close', (code, reason) => {
                    const reasonText = Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason || '')
                    this.writeLog(new LogLine('out', `[closed] code=${code} reason=${reasonText}`))
                    this.stopSendingHeartbeat()
                    this.notifyState(EmpirBusClientState.Closed)
                })

                ws.on('error', (err: any) => {
                    this.writeLog(new LogLine('out', `[error] ${err?.message || 'ws error'}`))
                    this.stopSendingHeartbeat()
                    this.notifyState(EmpirBusClientState.Error)
                })
            } catch (err) {
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
        const ws = this.ws
        this.ws = null

        this.stopSendingHeartbeat()

        if (!ws)
            return

        try {
            ws.removeAllListeners()
        } catch {
        }

        if (ws.readyState === WebSocket.CLOSED)
            return

        if (ws.readyState === WebSocket.CONNECTING)
            ws.terminate()
        else
            ws.close()
    }

    static configureLogging(opts: { enabled?: boolean; file?: string } = {}) {
        if (typeof opts.enabled === 'boolean')
            EmpirBusClient.loggingEnabled = opts.enabled
        if (typeof opts.file === 'string' && opts.file.trim())
            EmpirBusClient.logFile = opts.file
    }

    private toText(raw: unknown) {
        if (typeof raw === 'string')
            return raw
        if (Buffer.isBuffer(raw))
            return raw.toString('utf8')
        return Buffer.from(raw as ArrayBuffer).toString('utf8')
    }

    private stopSendingHeartbeat() {
        if (!this.heartbeat)
            return
        clearInterval(this.heartbeat)
        this.heartbeat = null
    }

    private sendHeartbeatRegularly() {
        this.heartbeat = setInterval(() => {
            this.sendJson({ messagetype: MessageType.acknowledgement, messagecmd: 0, size: 1, data: [0] })
        }, 4 * 1000)
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
        this.onLogFns.forEach(fn => fn(logLine))
        this.persistLog(logLine)
    }

    private persistLog(logLine: LogLine) {
        if (!EmpirBusClient.loggingEnabled)
            return
        try {
            const line = JSON.stringify(logLine) + '\n'
            if (this.logStream)
                this.logStream.write(line)
            else fs.appendFileSync(EmpirBusClient.logFile, line, 'utf8')
        } catch {
        }
    }

    private notifyState(state: EmpirBusClientState) {
        this.onStateFns.forEach(fn => fn(state))
    }
}
