import type { Channel } from '../domain/Channel'

export interface IChannelRepository {
  getChannelList(): Promise<Channel[]>
  onUpdate(fn: (c: Channel) => void): void
  connect(): Promise<void>
  toggle(id: number, on?: boolean): void
  dim(id: number, level: number): void
}
