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
  /** Raw value from bus without any scaling */
  rawValue: number | null
  /** Decoded/humanized value; also mirrored to `value` for backward-compat */
  decodedValue: number | boolean | string | null
  /** @deprecated use decodedValue */
  value: number | boolean | string | null
  updatedAt: number | null
}