export const MessageType = {
  mfdStatus: 16,
  mfdControl: 17,
  channelInfo: 32,
  channelCmd: 33,
  systemCmd: 48,
  systemReq: 49,
  systemWrite: 50,
  syncCmd: 64,
  alertManagement: 81,
  nmeaMsg: 82,
  subscriptionRequest: 96,
  clientControlCommand: 112,
  acknowledgement: 128
} as const

export const MfdControlCmd = {
  toggle: 0,
  momentary: 1,
  dimmerUpdate: 3,
  statusUpdate: 5
} as const