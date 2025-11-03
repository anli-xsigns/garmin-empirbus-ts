import { EmpirBusChannelRepository } from '../infrastructure/repositories/EmpirBusChannelRepository'

const WS_URL = process.env.EMPIRBUS_WS || 'ws://192.168.1.1:8888/ws'
const repo = new EmpirBusChannelRepository(WS_URL)

const clamp = (s: string, n: number) => s.length > n ? s.slice(0, n) : s
const pad = (s: string, n: number) => {
  const x = clamp(s, n)
  return x + ' '.repeat(Math.max(0, n - x.length))
}

type Col = { key: 'id' | 'name' | 'value' | 'description', title: string, width: number }
const cols: Col[] = [
  { key: 'id', title: 'ID', width: 6 },
  { key: 'name', title: 'Name', width: 28 },
  { key: 'value', title: 'Value', width: 8 },
  { key: 'description', title: 'Description', width: 44 }
]

const topLine = () => {
  const parts = cols.map(c => '─'.repeat(c.width + 2))
  return '┌' + parts.join('┬') + '┐'
}

const midLine = () => {
  const parts = cols.map(c => '─'.repeat(c.width + 2))
  return '├' + parts.join('┼') + '┤'
}

const bottomLine = () => {
  const parts = cols.map(c => '─'.repeat(c.width + 2))
  return '└' + parts.join('┴') + '┘'
}

const header = () => {
  const line = cols.map(c => ' ' + pad(c.title, c.width) + ' ').join('│')
  return '│' + line + '│'
}

const fmtRow = (id: number, name: string, desc: string, value: any) => {
  const idStr = pad(String(id), cols[0].width)
  const nameStr = pad(name, cols[1].width)
  const valRaw = value === null || typeof value === 'undefined' ? '' : String(value)
  const valStr = pad(valRaw, cols[2].width)
  const descStr = pad(desc, cols[3].width)
  const line = [idStr, nameStr, valStr, descStr].map((x, i) => ' ' + x + ' ').join('│')
  return '│' + line + '│'
}

const clearAndDrawHeader = () => {
  process.stdout.write(topLine() + '\n')
  process.stdout.write(header() + '\n')
  process.stdout.write(midLine() + '\n')
}

const run = async () => {
  await repo.connect()
  const channels = await repo.all()
  clearAndDrawHeader()
  for (const c of channels) {
    process.stdout.write(fmtRow(c.id, c.name, c.description, c.value) + '\n')
  }
  process.stdout.write(bottomLine() + '\n')
  repo.onUpdate((c) => {
    process.stdout.write(fmtRow(c.id, c.name, c.description, c.value) + '\n')
  })
}

run()