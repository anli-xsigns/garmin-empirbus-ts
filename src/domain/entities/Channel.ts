export type ChannelKind = {
  type: number
  channelType: number
  dataItemFormatType: number
  dataType: number
  channelSettingType: number
}

export type Channel = ChannelKind & {
  id: number
  name: string
  description: string
  rawValue: number | null
  decodedValue: number | boolean | string | null
  updatedAt: number | null
}
