export type Channel = {
    type: number
    channelType: number
    dataItemFormatType: number
    dataType: number
    channelSettingType: number
    id: number
    name: string
    description: string
    rawValue: number | null
    decodedValue: number | boolean | string | null
    onOffStatus: boolean | null
    error1: boolean | null
    error2: boolean | null
    unavailable: boolean | null
    updatedAt: number | null
}
