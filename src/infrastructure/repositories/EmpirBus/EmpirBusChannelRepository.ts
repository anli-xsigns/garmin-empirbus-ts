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

        const currentState = channel.rawValue !== null
            ? (channel.rawValue & 1) !== 0
            : null

        if (currentState === on) {
            return Result.succeeded(
                SucceededCode.ChannelHadAlreadyDesiredState,
                `Channel ${id} is already in state ${on ? 'on' : 'off'}`
            )
        }

        this.sendToggleCommand(id, on)

        return Result.succeeded(
            SucceededCode.ChannelSwitchedSuccessfully,
            `Channel ${id} successfully switched to state ${on ? 'on' : 'off'}`
        )
    }

    async press(id: number): Promise<ResultType<string>> {
        this.client.sendJson({
            messagetype: MessageType.mfdControl,
            messagecmd: 1,
            size: 3,
            data: [id & 255, id >> 8, 1]
        })

        return Result.succeeded(
            SucceededCode.ChannelToggledSuccessfully,
            `Channel ${id} pressed successfully`
        )
    }

    async release(id: number): Promise<ResultType<string>> {
        this.client.sendJson({
            messagetype: MessageType.mfdControl,
            messagecmd: 1,
            size: 3,
            data: [id & 255, id >> 8, 0]
        })

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
        const channel = this.getChannelById(id)
        if (!channel)
            return Result.failed(
                FailureCode.ChannelNotFound,
                `Channel ${id} not found`
            )

        if (channel.rawValue === null)
            return Result.failed(
                FailureCode.Other,
                `Current state of channel ${id} is not known`
            )

        const currentState = (channel.rawValue & 1) !== 0

        return this.switch(id, !currentState)
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

    private sendToggleCommand(id: number, on: boolean): void {
        const pressed = 1
        const desiredState = on ? 2 : 4
        const flags = pressed | desiredState

        this.client.sendJson({
            messagetype: MessageType.mfdControl,
            messagecmd: 0,
            size: 3,
            data: [
                id & 255,
                (id >> 8) & 255,
                flags
            ]
        })
    }
}
