
import blessed from 'blessed'
import WebSocket from 'ws'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import * as fs from 'fs'
import * as path from 'path'

type Dir = 'in' | 'out'

type LogItem = {
  ts: Date
  dir: Dir
  raw: string
  obj: any | null
}

const argv = yargs(hideBin(process.argv))
  .scriptName('wslog')
  .usage('$0 [options]')
  .option('ws', { type: 'string', describe: 'WebSocket URL (nur bei expliziter Angabe)' })
  .option('file', { type: 'string', describe: 'NDJSON Logdatei (Standard: ./logs/empirbus.ndjson)' })
  .option('max', { type: 'number', default: 2000, describe: 'Max Zeilen im Speicher' })
  .help()
  .parseSync()

if (!(argv as any).file) {
  const defaultDir = path.join(process.cwd(), 'logs')
  try { if (!fs.existsSync(defaultDir)) fs.mkdirSync(defaultDir, { recursive: true }) } catch {}
  ;(argv as any).file = path.join(defaultDir, 'empirbus.ndjson')
}
const filePath = (argv as any).file as string
const displayPath = path.isAbsolute(filePath) ? path.relative(process.cwd(), filePath) : filePath

try {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '', 'utf8')
} catch {}

console.log('wslog reading from file:', filePath)

const logs: LogItem[] = []
let dirFilter: 'all' | Dir = 'all'
let textFilter = ''
let autoScroll = true

function parseLine(line: string): LogItem | null {
  if (!line || !line.trim()) return null
  try {
    const o = JSON.parse(line)
    const raw = (o.raw ?? '').toString()
    return {
      ts: new Date(o.ts ?? Date.now()),
      dir: (o.dir === 'out' ? 'out' : 'in'),
      raw,
      obj: o.obj ?? null
    }
  } catch { return null }
}

function normalizeRaw(s: string): string {
  const one = (s ?? '').replace(/\s+/g, ' ').trim()
  return one.length ? one : '(leer)'
}

function formatRow(item: LogItem, rawWidth: number): string[] {
  const ts = isNaN(item.ts.getTime()) ? '' : item.ts.toISOString().substring(11, 19)
  const dir = item.dir === 'in' ? '<-' : '->'
  const raw = normalizeRaw(item.raw).slice(0, Math.max(8, rawWidth))
  return [String(ts), String(dir), String(raw)]
}

function shouldShow(item: LogItem): boolean {
  if (dirFilter !== 'all' && item.dir !== dirFilter) return false
  if (textFilter) {
    const hay = (item.raw + ' ' + (item.obj ? JSON.stringify(item.obj) : '')).toLowerCase()
    if (!hay.includes(textFilter.toLowerCase())) return false
  }
  return true
}

function pushLog(item: LogItem) {
  logs.unshift(item)
  const mx = (argv.max as number)
  if (logs.length > mx) logs.splice(mx)
}

const screen = blessed.screen({ smartCSR: true, title: 'wslog' })

const header = blessed.box({ parent: screen, top: 0, left: 0, width: '100%', height: 1, tags: true })
const list = blessed.listtable({
  parent: screen, top: 1, left: 0, width: '100%', height: '100%-2',
  keys: true, mouse: true, border: 'line', vi: true, tags: false, align: 'left',
  noCellBorders: true,
  style: {
    header: { bold: true, align: 'left' },
    cell: { align: 'left', selected: { inverse: true } }
  }
})
const help = blessed.box({ parent: screen, bottom: 0, left: 0, width: '100%', height: 1 })

let visibleItems: LogItem[] = []

function updateHeader(extra: string = '') {
  const mode = `file:${displayPath.replace(/\\/g, '/')}`
  const filt = textFilter ? ` | filter:"${textFilter}"` : ''
  const dir = ` | dir:${dirFilter}`
  const auto = ` | AutoScroll:${autoScroll ? 'on' : 'off'}`
  header.setContent(`Quelle: ${mode}${filt}${dir}${auto}${extra} | F=Filter I=In O=Out A=All E=Cycle C=Clear S=Save W=Detail T=AutoScroll Q=Quit`)
}

function calcRawWidth(): number {
  const W = (screen.width || 120) as number
  const rawWidth = W - 2 - 2 - 12 - 6
  return rawWidth > 16 ? rawWidth : 16
}

function buildRows(): string[][] {
  const rows: string[][] = [["Zeit", "Richtung", "Rohdaten"]]
  const rawWidth = calcRawWidth()
  visibleItems = []
  for (const item of logs) {
    if (!shouldShow(item)) continue
    const r = formatRow(item, rawWidth)
    rows.push([r[0] || '', r[1] || '', r[2] || ''])
    visibleItems.push(item)
  }
  return rows
}

function render() {
  const rows = buildRows()
  list.setData(rows)
  updateHeader(` | Zeilen:${rows.length - 1}`)
  screen.render()
}

function promptFilter() {
  const prompt = blessed.prompt({ parent: screen, border: 'line', width: '60%', height: 5, top: 'center', left: 'center', label: ' Filter ' })
  prompt.input('Filter-Text (leer = kein Filter):', textFilter, (_err, value) => {
    textFilter = (value || '').trim()
    render()
  })
}

function openDetail() {
  const sel = (list as any).selected ?? 1
  const idx = Math.max(0, sel - 1)
  const item = visibleItems[idx]
  if (!item) return
  let pretty = ''
  try { pretty = JSON.stringify(JSON.parse(item.raw), null, 2) } catch { pretty = item.raw || '(leer)' }

  const box = blessed.box({
    parent: screen, top: 'center', left: 'center', width: '90%', height: '90%',
    label: ` Details ${item.dir === 'in' ? '<-' : '->'} ${isNaN(item.ts.getTime()) ? '' : item.ts.toISOString()} `,
    border: 'line', keys: true, mouse: true, scrollable: true, alwaysScroll: true,
    scrollbar: { ch: ' ', style: { inverse: true } }, tags: false, content: pretty
  })
  const hint = blessed.box({ parent: box, bottom: 0, left: 1, height: 1, width: 'shrink', tags: true,
    content: '↑/↓/PgUp/PgDn scroll • ESC/Q schließen' })

  box.focus()
  screen.render()
  function closeBox() { box.destroy(); render() }
  box.key(['escape', 'q', 'C-c', 'enter'], closeBox)
}

function cycleDirFilter() {
  if (dirFilter === 'all') dirFilter = 'in'
  else if (dirFilter === 'in') dirFilter = 'out'
  else dirFilter = 'all'
  render()
}

list.focus()
help.setContent('F=Filter I=In O=Out A=All E=Cycle C=Clear S=Save W=Detail T=AutoScroll PgUp/PgDn scroll Q=Quit')
updateHeader()
screen.render()

screen.key(['q', 'C-c'], () => process.exit(0))
screen.key('f', () => promptFilter())
screen.key('i', () => { dirFilter = 'in'; render() })
screen.key('o', () => { dirFilter = 'out'; render() })
screen.key('a', () => { dirFilter = 'all'; render() })
screen.key('e', () => cycleDirFilter())
screen.key('c', () => { logs.length = 0; render() })
screen.key('w', () => openDetail())
screen.key('t', () => { autoScroll = !autoScroll; render() })
screen.key(['pageup'], () => { try { (list as any).scroll(-Math.max(1, (list.height as any) - 3)) } catch {} screen.render() })
screen.key(['pagedown'], () => { try { (list as any).scroll(Math.max(1, (list.height as any) - 3)) } catch {} screen.render() })
screen.key(['home'], () => { try { (list as any).select(0) } catch {} screen.render() })
screen.key(['end'], () => { try { (list as any).select((list as any).rows?.length - 1 || 1) } catch {} screen.render() })

try {
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    const it = parseLine(line)
    if (it) pushLog(it)
  }
} catch {}
render()

let lastSize = 0
try { lastSize = fs.statSync(filePath).size } catch { lastSize = 0 }

fs.watchFile(filePath, { interval: 500 }, (_curr, _prev) => {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size < lastSize) lastSize = 0
    if (stat.size > lastSize) {
      const fd = fs.openSync(filePath, 'r')
      const buf = Buffer.alloc(stat.size - lastSize)
      fs.readSync(fd, buf, 0, buf.length, lastSize)
      fs.closeSync(fd)
      lastSize = stat.size
      const chunk = buf.toString('utf8')
      for (const line of chunk.split(/\r?\n/)) {
        const it = parseLine(line)
        if (it) pushLog(it)
      }
      if (autoScroll) { try { (list as any).select(1) } catch {} }
      render()
    }
  } catch {}
})
