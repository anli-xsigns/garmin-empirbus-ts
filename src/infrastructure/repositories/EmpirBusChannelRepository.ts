import { getTemperatureUnit } from '../../shared/settings'
import { EmpirBusClient } from '../empirbus/EmpirBusClient'
import { toCamelCase } from '../../shared/case'
import type { Channel } from '../../domain/entities/Channel'
import type { ChannelRepository } from '../../domain/repositories/ChannelRepository'
import signals from '../../signal-info.json'
import { MessageType } from '../empirbus/messages'

type MapById<T> = { [id: number]: T }

/**
 * Decode raw channel value coming from bus into user-friendly form.
 * For analog percentage channels (dataItemFormatType=14, dataType=2), map 0..255 -> 0..100 (%).
 */
function decodeValue(ch: Channel, raw: number): number | boolean | string | null {
  // Generic value conversion based on dataItemFormatType (valueTypeIdentifier)
  // DEC3 (14): values are scaled by 1000. For percent-ish channels, render with % and two decimals.
  if (ch && typeof ch.dataItemFormatType === 'number') {
    // Type 22: TEMPERATURE_KELVIN_DEC3 (raw is milli-Kelvin)
    if (ch.dataItemFormatType === 22) {
      const K = Number(raw) / 1000
      const unit = getTemperatureUnit()
      if (unit === 'K') return Number(K.toFixed(2))
      const C = K - 273.15
      if (unit === 'C') return Number(C.toFixed(2))
      // 'F'
      const F = C * 9/5 + 32
      return Number(F.toFixed(2))
    }

    if (ch.dataItemFormatType === 14) {
      const scaled = Number(raw) / 1000
      const text = ((ch.description || ch.name || '') + '').toLowerCase()
      const isPercent = text.includes('%') || text.includes(' value %') || text.includes('percent')
      return isPercent ? `${scaled.toFixed(2)}%` : scaled
    }
  }
  return raw
}



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
      rawValue: null,
      decodedValue: null,
      value: null,
      updatedAt: null
    }
  }
  return map
}

export class EmpirBusChannelRepository implements ChannelRepository {

  // Periodically refresh subscription to ensure continuous updates even if the bus drops them.
  private __subscriptionInterval: any = null;

  private __subscribeAll() {
    try {
      // messagecmd left at 0 for generic subscription; size/data empty to request all updates
      this.client.sendJson({ messagetype: MessageType.subscriptionRequest, messagecmd: 0, size: 0, data: [] })
    } catch {}
  }

  private client: EmpirBusClient
  private channels: MapById<Channel>
  private subs: Array<(c: Channel) => void> = []

  constructor(url: string) {

    this.client = new EmpirBusClient(url)

    this.client.onState((state) => {
      // 1 === OPEN (WebSocket)
      if (state === 1) {
        this.__subscribeAll();
      }
    })

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
          let raw = Number(d[2]);
          const ch = this.channels[id];
          if (ch) {
            // Generic MFD Status handling (messagecmd=5): valueTypeIdentifier in d[3], value Int32 LE in d[4..7]
            if (t === 16 && Number(msg.messagecmd) === 5 && Array.isArray(d) && d.length >= 8) {
              const flags = Number(d[2]) | 0; // Bit7 -> unavailable
              const valueTypeIdentifier = Number(d[3]) | 0;
              const v0 = Number(d[4] ?? 0) & 0xff;
              const v1 = Number(d[5] ?? 0) & 0xff;
              const v2 = Number(d[6] ?? 0) & 0xff;
              const v3 = Number(d[7] ?? 0) & 0xff;
              raw = (v0 | (v1 << 8) | (v2 << 16) | (v3 << 24)) | 0;
              if (typeof ch.dataItemFormatType === 'number') ch.dataItemFormatType = valueTypeIdentifier;
            }ch.rawValue = raw;
            ch.decodedValue = decodeValue(ch, raw);
            ch.value = ch.decodedValue;
            ch.updatedAt = Date.now();
            this.subs.forEach(fn => fn({ ...ch }));
          }
        }
      }
    }
  }
}
