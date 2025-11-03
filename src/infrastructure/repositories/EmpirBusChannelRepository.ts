import { EmpirBusClient } from '../empirbus/EmpirBusClient'
import { toCamelCase } from '../../shared/case'
import type { Channel } from '../../domain/entities/Channel'
import type { ChannelRepository } from '../../domain/repositories/ChannelRepository'
import signals from '../../signal-info.json'

type MapById<T> = { [id: number]: T }

const buildInitialChannels = (): MapById<Channel> => {
  const map: MapById<Channel> = {}
  for (const s of signals as any[]) {
    const id = Number(s.signalId)
    const description = String(s.description || '')
    const name = toCamelCase(String((s as any).name || description))
    map[id] = {
      id,
      name,
      description,
      type: s.type,
      channelType: s.channelType,
      dataItemFormatType: s.dataItemFormatType,
      dataType: s.dataType,
      channelSettingType: s.channelSettingType,
      value: null,
      updatedAt: null
    }
  }
  return map
}

export class EmpirBusChannelRepository implements ChannelRepository {
  private client: EmpirBusClient
  private channels: MapById<Channel>
  private subs: Array<(c: Channel) => void> = []

  constructor(url: string) {
    this.client = new EmpirBusClient(url)
    this.channels = buildInitialChannels()
  }

  async connect() {
    await this.client.connect()
    this.client.onMessage(m => this.onMessage(m))
    const ids = Object.keys(this.channels).map(x => Number(x))
    const data: number[] = []
    for (const id of ids) {
      data.push(id & 255, id >> 8)
    }
    const subscription = { messagetype: 96, messagecmd: 0, size: data.length, data }
    this.client.sendJson(subscription)
    const n2kAll = { messagetype: 96, messagecmd: 1, size: 2, data: [0, 0] }
    this.client.sendJson(n2kAll)
  }

  close() {
    this.client.close()
  }

  all() {
    return Promise.resolve(Object.values(this.channels))
  }

  onUpdate(fn: (c: Channel) => void) {
    this.subs.push(fn)
  }

  toggle(id: number, on?: boolean) {
    const flags = on ? 1 : 4
    const data = [id & 255, id >> 8, flags]
    this.client.sendJson({ messagetype: 17, messagecmd: 0, size: 3, data })
  }

  dim(id: number, level: number) {
    const data = [id & 255, id >> 8, 0, level & 255, (level >> 8) & 255]
    this.client.sendJson({ messagetype: 17, messagecmd: 3, size: 5, data })
  }

  private onMessage(msg: any) {
    if (msg && typeof msg === 'object') {
      const t = Number(msg.messagetype)
      if (t === 16 || t === 17 || t === 32 || t === 33) {
        const d = msg.data
        if (Array.isArray(d) && d.length >= 3) {
          const id = Number(d[0] | (d[1] << 8))
          const raw = Number(d[2])
          const ch = this.channels[id]
          if (ch) {
            ch.value = raw
            ch.updatedAt = Date.now()
            this.subs.forEach(fn => fn({ ...ch }))
          }
        }
      }
    }
  }
}