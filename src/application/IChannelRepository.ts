import type { Channel } from '../domain/Channel'
import { EmpirBusClientState } from '../infrastructure/empirbus/EmpirBusClientState'
import { SwitchState } from '../infrastructure/repositories/EmpirBus/EmpirBusChannelRepository'
import { ResultType } from './result'

export interface IChannelRepository {
  connect(): Promise<void>
  dim(id: number, level: number): void
  disconnect(): void
  getChannelList(): Promise<Channel[]>
  onLog(fn: (line: unknown) => void): Unsubscribe
  onState(fn: (state: EmpirBusClientState) => void): Unsubscribe
  onUpdate(fn: (c: Channel) => void): Unsubscribe
  switch(id: number, toState: SwitchState): Promise<ResultType<string>>
  toggle(id: number, on?: boolean): void
}

export type Unsubscribe = () => void
