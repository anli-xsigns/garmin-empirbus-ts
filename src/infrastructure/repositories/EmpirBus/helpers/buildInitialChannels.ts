import type { IChannelRepository } from '../../../../application/IChannelRepository'
import type { Channel } from '../../../../domain/Channel'
import { toCamelCase } from '../../../../shared/case'
import { EmpirBusClient } from '../../../empirbus/EmpirBusClient'
import { MessageType } from '../../../empirbus/MessageType'
import signals from '../../../../signal-info.json'
import { MapById } from './MapById'

export const buildInitialChannels = (): MapById<Channel> => {
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
            updatedAt: null
        }
    }
    return map
}
