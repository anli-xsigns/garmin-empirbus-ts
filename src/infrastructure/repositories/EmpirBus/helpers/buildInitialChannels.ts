import type { Channel } from '../../../../domain/Channel'
import { toCamelCase } from '../../../../shared/case'
import signals from '../../../../signal-info.json'
import { MapById } from './MapById'

export const buildInitialChannels = (): MapById<Channel> => {
    const map: MapById<Channel> = {}
    for (const s of signals as any[]) {
        const id = Number(s.signalId)
        const description = String(s.description || '')
        const name = toCamelCase(String((s as any).name || description))
        map[id] = {
            channelSettingType: s.channelSettingType,
            channelType: s.channelType,
            dataItemFormatType: s.dataItemFormatType,
            dataType: s.dataType,
            decodedValue: null,
            description,
            error1: null,
            error2: null,
            id,
            mfdType: null,
            name,
            onOffStatus: null,
            rawValue: null,
            type: s.type,
            unavailable: null,
            updatedAt: null,
        }
    }
    return map
}
