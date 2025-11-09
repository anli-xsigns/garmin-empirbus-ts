import { MessageType } from './messages'

export const buildToggleCommand = (id: number) => {
    return [
        { messagetype: MessageType.mfdControl, messagecmd: 1, size: 3, data: [id & 255, id >> 8, 1] },
        { messagetype: MessageType.mfdControl, messagecmd: 1, size: 3, data: [id & 255, id >> 8, 0] }
    ]
}

export const buildDimmerCommand = (id: number, level: number) => {
    return { messagetype: MessageType.mfdControl, messagecmd: 3, size: 5, data: [id & 255, id >> 8, 0, level & 255, (level >> 8) & 255] }
}
