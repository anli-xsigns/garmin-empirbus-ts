export const buildToggleCommand = (id: number, on?: boolean, off?: boolean, toggle?: boolean) => {
  let flags = 0
  if (on) flags |= 1
  if (off) flags |= 2
  if (toggle) flags |= 4
  return { messagetype: 17, messagecmd: 0, size: 3, data: [id & 255, id >> 8, flags] }
}

export const buildDimmerCommand = (id: number, level: number, timeMs: number) => {
  return { messagetype: 17, messagecmd: 3, size: 5, data: [id & 255, id >> 8, timeMs, level & 255, (level >> 8) & 255] }
}