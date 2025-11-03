import type { Channel } from '../entities/Channel'

export interface ChannelRepository {
  all(): Promise<Channel[]>
  onUpdate(fn: (c: Channel) => void): void
  connect(): Promise<void>
  close(): void
  toggle(id: number, on?: boolean): void
  dim(id: number, level: number): void
}