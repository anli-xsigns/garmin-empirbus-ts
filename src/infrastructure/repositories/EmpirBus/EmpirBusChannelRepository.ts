import type { IChannelRepository } from '../../../application/IChannelRepository'
import { FailureCode, Result, ResultType, SucceededCode } from '../../../application/result'
import type { Channel } from '../../../domain/Channel'
import { sleep } from '../../../shared/sleep'
import { EmpirBusClient } from '../../empirbus/EmpirBusClient'
import { EmpirBusClientState } from '../../empirbus/EmpirBusClientState'
import { MessageType } from '../../empirbus/MessageType'
import { buildInitialChannels, decodeValue, MapById } from './helpers'

export type SwitchState = boolean | 1 | 0 | 'On' | 'Off' | 'ON' | 'OFF' | 'on' | 'off'
export type DimState = number

export class EmpirBusChannelRepository implements IChannelRepository {

    private client: EmpirBusClient
    private readonly channels: MapById<Channel>
    private subscribers: Array<(c: Channel) => void> = []

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
        this.subscribers.push(fn)
    }

    async connect() {
        await this.client.connect()
        this.client.onMessage(m => this.updateChannelFromMessage(m))
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

    async switch(id: number, toState: SwitchState): Promise<ResultType<string>> {

        const on = toState === true || toState === 1 || toState.toString().toLowerCase() === 'on'
        const desiredState = on ? 1 : 0

        const channel = this.getChannelById(id)
        if (!channel)
            return Result.failed(FailureCode.ChannelNotFound, `Channel ${id} not found`)

        if (channel.rawValue === desiredState)
            return Result.succeeded(SucceededCode.ChannelHadAlreadyDesiredState, `Channel ${id} is already in state ${toState}`)

        const toggle = await this.toggle(id)
        if (toggle.succeeded)
            return Result.succeeded(SucceededCode.ChannelSwitchedSuccessfully, `Channel ${id} successfully switched to state ${toState}`)
        return toggle
    }

    async toggle(id: number): Promise<ResultType<string>> {
        this.client.sendJson({ messagetype: MessageType.mfdControl, messagecmd: 1, size: 3, data: [id & 255, id >> 8, 1] })
        await sleep(100)
        this.client.sendJson({ messagetype: MessageType.mfdControl, messagecmd: 1, size: 3, data: [id & 255, id >> 8, 0] })
        return Result.succeeded(SucceededCode.ChannelToggledSuccessfully, `Channel ${id} toggled successfully`)
    }

    dim(id: number, level: DimState): ResultType<string> {
        const bounded = Math.max(0, Math.round(level))
        this.client.sendJson({ messagetype: MessageType.mfdControl, messagecmd: 3, size: 5, data: [id & 255, id >> 8, 0, bounded & 255, (bounded >> 8) & 255] })
        return Result.succeeded(SucceededCode.ChannelDimmedSuccessfully, `Channel ${id} dimmed successfully`)
    }

    private updateChannelFromMessage(msg: any) {

        if (!this.isProcessableMessage(msg))
            return

        const messageType = Number(msg.messagetype)
        if (!this.isSupportedMessageType(messageType))
            return

        const data = msg.data as number[]
        const channel = this.getChannel(data)
        if (!channel)
            return

        let raw = Number(data[2])
        if (messageType === 16)
            raw = this.processMessageType16(msg, data, raw, channel)
        channel.rawValue = raw
        channel.decodedValue = decodeValue(channel, raw)
        channel.updatedAt = Date.now()
        this.subscribers.forEach(fn => fn(channel))
    }

    private processMessageType16(msg: any, data: number[], raw: number, channel: Channel) {
        if (Number(msg.messagecmd) === 3 && data.length >= 5) {
            const valueTypeIdentifier = Number(data[3]) | 0
            const v0 = Number(data[3] ?? 0) & 0xff
            const v1 = Number(data[4] ?? 0) & 0xff
            raw = (v0 | (v1 << 8)) | 0
            channel.dataItemFormatType = valueTypeIdentifier
        }
        else if (Number(msg.messagecmd) === 5 && data.length >= 8) {
            const valueTypeIdentifier = Number(data[3]) | 0
            const v0 = Number(data[4] ?? 0) & 0xff
            const v1 = Number(data[5] ?? 0) & 0xff
            const v2 = Number(data[6] ?? 0) & 0xff
            const v3 = Number(data[7] ?? 0) & 0xff
            raw = (v0 | (v1 << 8) | (v2 << 16) | (v3 << 24)) | 0
            channel.dataItemFormatType = valueTypeIdentifier
        }
        return raw
    }

    private isSupportedMessageType(type: number) {
        return [16, 17, 32, 33].includes(type)
    }

    private isProcessableMessage(msg: unknown): msg is { messagetype: unknown; data: unknown; messagecmd?: unknown } {
        if (!msg || typeof msg !== 'object')
            return false

        const m = msg as { data?: unknown }
        return Array.isArray(m.data) && m.data.length >= 3
    }

    private getChannel(data: number[]) {
        const id = this.getChannelId(data)
        return this.getChannelById(id)
    }

    private getChannelById(id: number) {
        return this.channels[id]
    }

    private getChannelId(data: number[]) {
        return Number(data[0] | (data[1] << 8))
    }
}
