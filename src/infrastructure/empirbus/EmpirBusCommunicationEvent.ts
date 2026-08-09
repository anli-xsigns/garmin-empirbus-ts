export type EmpirBusCommunicationDirection = 'rx' | 'tx'

export interface EmpirBusMessage {
    messagetype: number
    messagecmd: number
    size: number
    data: number[]
}

export interface EmpirBusCommunicationEvent {
    direction: EmpirBusCommunicationDirection
    timestamp: number
    message: EmpirBusMessage
}
