import type { IChannelRepository } from '../../../application/IChannelRepository'
import type { Channel } from '../../../domain/Channel'
import { sleep } from '../../../shared/sleep'
import { EmpirBusClient } from '../../empirbus/EmpirBusClient'
import { EmpirBusClientState } from '../../empirbus/EmpirBusClientState'
import { MessageType } from '../../empirbus/MessageType'
import { buildInitialChannels, decodeValue, MapById } from './helpers'

export class EmpirBusChannelRepository implements IChannelRepository {

    private client: EmpirBusClient
    private readonly channels: MapById<Channel>
    private subs: Array<(c: Channel) => void> = []

    constructor(url: string) {

        this.client = new EmpirBusClient(url)
        this.client.onState((state) => {
            if (state === EmpirBusClientState.Connected) {
                this.subscribeAllUpdates()
            }
        })

        this.channels = buildInitialChannels()
    }

    private subscribeAllUpdates() {
        try {
            this.client.sendJson({ messagetype: MessageType.subscriptionRequest, messagecmd: 0, size: 0, data: [] })
        }
        catch {
        }
    }

    getChannelList(): Promise<Channel[]> {
        const list = Object.values(this.channels)
        list.sort((a, b) => a.id - b.id)
        return Promise.resolve(list)
    }

    onUpdate(fn: (c: Channel) => void): void {
        this.subs.push(fn)
    }

    async connect() {
        await this.client.connect()
        this.client.onMessage(m => this.onMessage(m))
        const ids = Object.keys(this.channels).map(x => Number(x))
        const data: number[] = []
        for (const id of ids) {
            data.push(id & 255, id >> 8)
        }
        const subscription = { messagetype: MessageType.subscriptionRequest, messagecmd: 0, size: data.length, data }
        this.client.sendJson(subscription)
        const n2kAll = { messagetype: MessageType.subscriptionRequest, messagecmd: 1, size: 2, data: [0, 0] }
        this.client.sendJson(n2kAll)
    }

    async toggle(id: number): Promise<void> {
        this.client.sendJson({ messagetype: MessageType.mfdControl, messagecmd: 1, size: 3, data: [id & 255, id >> 8, 1] })
        await sleep(100)
        this.client.sendJson({ messagetype: MessageType.mfdControl, messagecmd: 1, size: 3, data: [id & 255, id >> 8, 0] })
    }

    dim(id: number, level: number): void {
        const bounded = Math.max(0, Math.round(level))
        this.client.sendJson({ messagetype: MessageType.mfdControl, messagecmd: 3, size: 5, data: [id & 255, id >> 8, 0, bounded & 255, (bounded >> 8) & 255] })
    }

    private onMessage(msg: any) {
        if (msg && typeof msg === 'object') {
            const t = Number(msg.messagetype)
            if (t === 16 || t === 17 || t === 32 || t === 33) {
                const d = msg.data
                if (Array.isArray(d) && d.length >= 3) {
                    const id = Number(d[0] | (d[1] << 8))
                    let raw = Number(d[2])
                    const ch = this.channels[id]
                    if (ch) {
                        // Generic MFD Status handling (messagecmd=5): valueTypeIdentifier in d[3], value Int32 LE in d[4..7]
                        if (t === 16) {
                            if (Number(msg.messagecmd) === 3 && Array.isArray(d) && d.length >= 5) {
                                const valueTypeIdentifier = Number(d[3]) | 0
                                const v0 = Number(d[3] ?? 0) & 0xff
                                const v1 = Number(d[4] ?? 0) & 0xff
                                raw = (v0 | (v1 << 8)) | 0
                                ch.dataItemFormatType = valueTypeIdentifier
                            }
                            else if (Number(msg.messagecmd) === 5 && Array.isArray(d) && d.length >= 8) {
                                const valueTypeIdentifier = Number(d[3]) | 0
                                const v0 = Number(d[4] ?? 0) & 0xff
                                const v1 = Number(d[5] ?? 0) & 0xff
                                const v2 = Number(d[6] ?? 0) & 0xff
                                const v3 = Number(d[7] ?? 0) & 0xff
                                raw = (v0 | (v1 << 8) | (v2 << 16) | (v3 << 24)) | 0
                                ch.dataItemFormatType = valueTypeIdentifier
                            }
                        }
                        ch.rawValue = raw
                        ch.decodedValue = decodeValue(ch, raw)
                        ch.updatedAt = Date.now()
                        this.subs.forEach(fn => fn({ ...ch }))
                    }
                }
            }
        }
    }
}
