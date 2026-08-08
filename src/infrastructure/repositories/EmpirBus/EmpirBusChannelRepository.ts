import type { IChannelRepository, Unsubscribe } from '../../../application/IChannelRepository'
import { Failure, FailureCode, Result, ResultType, SucceededCode } from '../../../application/result'
import type { Channel } from '../../../domain/Channel'
import { sleep } from '../../../shared/sleep'
import { EmpirBusClient } from '../../empirbus/EmpirBusClient'
import { EmpirBusClientState } from '../../empirbus/EmpirBusClientState'
import { MessageType } from '../../empirbus/MessageType'
import { buildInitialChannels, decodeValue, MapById } from './helpers'

export type SwitchState = boolean | 1 | 0 | 'On' | 'Off' | 'ON' | 'OFF' | 'on' | 'off'
export type DimState = number

export interface PressForCallbacks {
    onPress?: () => void | Promise<void>
    onRelease?: () => void | Promise<void>
}

export class EmpirBusChannelRepository implements IChannelRepository {
    private client: EmpirBusClient
    private readonly channels: MapById<Channel>
    private subscribers: Array<(c: Channel) => void> = []
    private onStateFns: Array<(state: EmpirBusClientState) => void> = []
    private onLogFns: Array<(line: unknown) => void> = []

    constructor(url: string) {
        this.channels = buildInitialChannels()

        this.client = new EmpirBusClient(url)
        this.client.onLog(line => this.notifyLog(line))
        this.client.onState(state => {
            if (state === EmpirBusClientState.Connected)
                this.subscribeAllUpdates()

            this.notifyState(state)
        })
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

    onLog(fn: (line: unknown) => void): Unsubscribe {
        return this.addListener(this.onLogFns, fn, () => this.onLogFns, next => this.onLogFns = next)
    }

    onState(fn: (state: EmpirBusClientState) => void): Unsubscribe {
        return this.addListener(this.onStateFns, fn, () => this.onStateFns, next => this.onStateFns = next)
    }

    onUpdate(fn: (c: Channel) => void): Unsubscribe {
        return this.addListener(this.subscribers, fn, () => this.subscribers, next => this.subscribers = next)
    }

    private notifyState(state: EmpirBusClientState) {
        this.onStateFns.forEach(fn => fn(state))
    }

    private notifyLog(line: unknown) {
        this.onLogFns.forEach(fn => fn(line))
    }

    async connect() {
        await this.client.connect()
        this.client.onMessage(m => this.updateChannelFromMessage(m))

        this.subscribeToAllChannels()

        const n2kAll = { messagetype: MessageType.subscriptionRequest, messagecmd: 1, size: 2, data: [0, 0] }
        this.client.sendJson(n2kAll)
    }

    disconnect() {
        this.client.close()
    }

    private subscribeToAllChannels() {
        const ids = Object.keys(this.channels).map(x => Number(x))
        const data: number[] = []

        for (const id of ids)
            data.push(id & 255, id >> 8)

        const subscription = { messagetype: MessageType.subscriptionRequest, messagecmd: 0, size: data.length, data }
        this.client.sendJson(subscription)
    }

    async switch(id: number, toState: SwitchState): Promise<ResultType<string>> {
        const on = toState === true
            || toState === 1
            || toState.toString().toLowerCase() === 'on'

        const channel = this.getChannelById(id)
        if (!channel)
            return Result.failed(
                FailureCode.ChannelNotFound,
                `Channel ${id} not found`
            )

        this.toggleCommand(id, true, on, !on)

        return Result.succeeded(
            SucceededCode.ChannelSwitchedSuccessfully,
            `Channel ${id} successfully switched to state ${on ? 'on' : 'off'}`
        )
    }

    async press(id: number): Promise<ResultType<string>> {
        this.momentaryCommand(id, true)

        return Result.succeeded(
            SucceededCode.ChannelToggledSuccessfully,
            `Channel ${id} pressed successfully`
        )
    }

    async release(id: number): Promise<ResultType<string>> {
        this.momentaryCommand(id, false)

        return Result.succeeded(
            SucceededCode.ChannelToggledSuccessfully,
            `Channel ${id} released successfully`
        )
    }

    async pressFor(id: number, durationMs: number, callbacks?: PressForCallbacks): Promise<ResultType<string>> {
        return this.pressForMany([id], durationMs, callbacks)
    }

    async pressForMany(
        ids: number[],
        durationMs: number,
        callbacks?: PressForCallbacks
    ): Promise<ResultType<string>> {
        const boundedDuration = Math.max(0, Math.round(durationMs))
        const uniqueIds = [...new Set(ids)]

        if (uniqueIds.length === 0)
            return Result.failed(FailureCode.ChannelNotFound, 'No channel ids provided')

        const missingIds = uniqueIds.filter(id => !this.getChannelById(id))
        if (missingIds.length > 0)
            return Result.failed(FailureCode.ChannelNotFound, `Channels not found: ${missingIds.join(', ')}`)

        const pressResults = await Promise.all(uniqueIds.map(id => this.press(id)))
        const failedPresses = this.getFailedResults(pressResults)

        if (failedPresses.length > 0)
            return Result.failed(FailureCode.Other, this.joinErrors(failedPresses))

        await callbacks?.onPress?.()

        await sleep(boundedDuration)

        const releaseResults = await Promise.all(uniqueIds.map(id => this.release(id)))
        const failedReleases = this.getFailedResults(releaseResults)

        if (failedReleases.length > 0)
            return Result.failed(FailureCode.Other, this.joinErrors(failedReleases))

        await callbacks?.onRelease?.()

        return Result.succeeded(
            SucceededCode.ChannelToggledSuccessfully,
            `Channels ${uniqueIds.join(', ')} pressed for ${boundedDuration} ms successfully`
        )
    }

    async toggle(id: number): Promise<ResultType<string>> {
        return this.toggleMany([id])
    }

    async toggleMany(ids: number[]): Promise<ResultType<string>> {
        const uniqueIds = [...new Set(ids)]
        if (uniqueIds.length === 0)
            return Result.failed(FailureCode.ChannelNotFound, 'No channel ids provided')

        const missingIds = uniqueIds.filter(id => !this.getChannelById(id))
        if (missingIds.length > 0)
            return Result.failed(FailureCode.ChannelNotFound, `Channels not found: ${missingIds.join(', ')}`)

        const unknownIds = uniqueIds.filter(id => this.getChannelById(id)?.rawValue === null)
        if (unknownIds.length > 0)
            return Result.failed(FailureCode.Other, `Current state is not known for channels: ${unknownIds.join(', ')}`)

        uniqueIds.forEach(id => {
            const channel = this.getChannelById(id)!
            const currentState = (channel.rawValue! & 1) !== 0
            this.toggleCommand(id, true, !currentState, currentState)
        })

        return Result.succeeded(
            SucceededCode.ChannelToggledSuccessfully,
            `Channels ${uniqueIds.join(', ')} toggled successfully`
        )
    }

    dim(id: number, level: DimState): ResultType<string> {
        const bounded = Math.max(0, Math.round(level))

        this.client.sendJson({
            messagetype: MessageType.mfdControl,
            messagecmd: 3,
            size: 5,
            data: [id & 255, id >> 8, 0, bounded & 255, (bounded >> 8) & 255]
        })

        return Result.succeeded(
            SucceededCode.ChannelDimmedSuccessfully,
            `Channel ${id} dimmed successfully`
        )
    }

    private getFailedResults(results: Array<ResultType<string>>) {
        return results.filter(result => result.hasFailed)
    }

    private joinErrors(results: Array<Failure>) {
        return results.flatMap(result => result.errors || []).join(', ')
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

        const raw = messageType === MessageType.mfdStatus
            ? this.processMfdStatusMessage(msg, data, channel)
            : Number(data[2])

        if (raw === null)
            return

        channel.rawValue = raw
        channel.decodedValue = this.decodeChannelValue(channel, raw, Number(msg.messagecmd))
        channel.updatedAt = Date.now()
        this.subscribers.forEach(fn => fn(channel))
    }

    private processMfdStatusMessage(msg: any, data: number[], channel: Channel): number | null {
        const command = Number(msg.messagecmd)

        switch (command) {
            case 0: // toggle / pulse
            case 1: // momentary
                this.applyStatusByte(channel, data[2])
                return Number(data[2])

            case 3: // dimmer update
                if (data.length < 5)
                    return null

                this.applyStatusByte(channel, data[2])
                return this.getUInt16(data, 3)

            case 5: // generic status update
                if (data.length < 8)
                    return null

                this.clearSwitchStatus(channel)
                channel.unavailable = (Number(data[2]) & 0x80) !== 0
                channel.dataItemFormatType = Number(data[3]) & 0xff
                return this.getInt32(data, 4)

            default:
                return Number(data[2])
        }
    }

    private applyStatusByte(channel: Channel, value: number) {
        const status = Number(value) & 0xff
        channel.onOffStatus = (status & 0x01) !== 0
        channel.error1 = (status & 0x02) !== 0
        channel.error2 = (status & 0x08) !== 0
        channel.unavailable = (status & 0x80) !== 0
    }

    private clearSwitchStatus(channel: Channel) {
        channel.onOffStatus = null
        channel.error1 = null
        channel.error2 = null
    }

    private decodeChannelValue(channel: Channel, raw: number, command: number) {
        if (command === 0 || command === 1)
            return channel.onOffStatus

        return decodeValue(channel, raw)
    }

    private getUInt16(data: number[], offset: number) {
        const v0 = Number(data[offset] ?? 0) & 0xff
        const v1 = Number(data[offset + 1] ?? 0) & 0xff
        return v0 | (v1 << 8)
    }

    private getInt32(data: number[], offset: number) {
        const bytes = new Uint8Array(4)
        for (let index = 0; index < bytes.length; index++)
            bytes[index] = Number(data[offset + index] ?? 0) & 0xff

        return new DataView(bytes.buffer).getInt32(0, true)
    }

    private isSupportedMessageType(type: number) {
        return [16, 17, 32, 33].includes(type)
    }

    private isProcessableMessage(msg: unknown): msg is { messagetype: unknown; data: unknown; messagecmd?: unknown } {
        if (!msg || typeof msg !== 'object')
            return false

        const value = msg as { data?: unknown }
        return Array.isArray(value.data) && value.data.length >= 3
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

    private addListener<T>(
        list: Array<(value: T) => void>,
        fn: (value: T) => void,
        getList: () => Array<(value: T) => void>,
        setList: (next: Array<(value: T) => void>) => void
    ): Unsubscribe {
        setList([...list, fn])

        let isActive = true

        return () => {
            if (!isActive)
                return

            isActive = false
            const next = getList().filter(value => value !== fn)
            setList(next)
        }
    }

    toggleCommand(id: number, pressed: boolean, on: boolean, off: boolean): void {
        const flags = (pressed ? 1 : 0) | (on ? 2 : 0) | (off ? 4 : 0)
        this.client.sendJson({
            messagetype: MessageType.mfdControl,
            messagecmd: 0,
            size: 3,
            data: [id & 255, (id >> 8) & 255, flags]
        })
    }

    momentaryCommand(id: number, pressed: boolean): void {
        this.client.sendJson({
            messagetype: MessageType.mfdControl,
            messagecmd: 1,
            size: 3,
            data: [id & 255, (id >> 8) & 255, pressed ? 1 : 0]
        })
    }

    sendRawCommand(command: { messagetype: number; messagecmd: number; size?: number; data: number[] }): void {
        const telegram = {
            messagetype: command.messagetype,
            messagecmd: command.messagecmd,
            size: command.size ?? command.data.length,
            data: [...command.data]
        }
        this.client.sendJson(telegram)
    }
}
