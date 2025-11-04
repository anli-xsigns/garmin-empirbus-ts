import blessed from 'blessed'
import { EmpirBusChannelRepository } from '../infrastructure/repositories/EmpirBusChannelRepository'

const WS_URL = process.env.EMPIRBUS_WS || 'ws://192.168.1.1:8888/ws'
const repo = new EmpirBusChannelRepository(WS_URL)

type SortKey = 'id' | 'name' | 'updatedAt'
type SortOrder = 'asc' | 'desc'
type Row = {
  id: number
  name: string
  description: string
  value: number | boolean | string | null
  updatedAt: number
}

let rows: Row[] = []
let hasSelectedOnce = false
let sortKey: SortKey = 'id'
let sortOrder: SortOrder = 'asc'
let filter: string | null = null

// ---------- UI ----------
const screen = blessed.screen({ smartCSR: true, title: 'EmpirBus Status' })

const help = blessed.box({
  top: 0, left: 0, width: '100%', height: 3, tags: true,
  content: '{bold}EmpirBus Status{/bold}  Pfeile/PgUp/PgDn=Scroll  / Suchen  1/2/3 Sort  a/d Richtung  s Zyklus  Esc Filter löschen  q Beenden'
})

const status = blessed.box({ bottom: 0, left: 0, width: '100%', height: 1, tags: true, content: '' })

const table = blessed.listtable({
  top: 3, left: 0, width: '100%', height: '100%-4',
  keys: false, mouse: true, vi: false, tags: true,
  border: { type: 'line' },
  style: {
    header: { fg: 'cyan', bold: true },
    cell: { fg: 'white', selected: { inverse: true } },
    border: { fg: 'cyan' }
  },
  interactive: true,
  align: 'left',
  // fixed column widths to keep alignment stable
  columnWidth: [8, 24, 10, 10, 20]
})

screen.append(help);
screen.append(table);
screen.append(status);

// Focus table so arrow keys & PgUp/PgDn work
;(table as any).focus()

const headersBase = ['ID', 'Name', 'Raw', 'Decoded', 'Zuletzt aktualisiert']
function headerWithArrow(label: string, key: SortKey): string {
  const isActive = sortKey === key
  const arrow = isActive ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : ''
  return label + arrow
}
function headersWithSort(): string[] {
  return [
    headerWithArrow('ID', 'id'),
    headerWithArrow('Name', 'name'),
    'Raw',
    'Decoded',
    headerWithArrow('Zuletzt aktualisiert', 'updatedAt'),
  ]
}
const headers = headersWithSort()
table.setData([headers])
// --- Key handlers bound to table to avoid double processing ---
;(table as any).key(['up'], () => { const lt = (table as any); const cur = Math.max(1, (lt.selected ?? 1)); if (typeof lt.select === 'function') lt.select(Math.max(1, cur - 1)); screen.render() })
;(table as any).key(['down'], () => { const lt = (table as any); const len = getVisible().length; const cur = Math.max(1, (lt.selected ?? 1)); if (typeof lt.select === 'function') lt.select(Math.min(len, cur + 1)); screen.render() })
;(table as any).key(['pageup'], () => { const lt = (table as any); const page = Math.max(1, ((lt.height || 10) - 5)); const len = getVisible().length; const cur = Math.max(1, (lt.selected ?? 1)); const next = Math.max(1, cur - page); if (typeof lt.select === 'function') lt.select(next); screen.render() })
;(table as any).key(['pagedown'], () => { const lt = (table as any); const page = Math.max(1, ((lt.height || 10) - 5)); const len = getVisible().length; const cur = Math.max(1, (lt.selected ?? 1)); const next = Math.min(len, cur + page); if (typeof lt.select === 'function') lt.select(next); screen.render() })
;(table as any).key(['home'], () => { const lt = (table as any); if (typeof lt.select === 'function') lt.select(1); screen.render() })
;(table as any).key(['end'], () => { const lt = (table as any); const len = getVisible().length; if (typeof lt.select === 'function') lt.select(Math.max(1, len)); screen.render() })


// ---------- helpers ----------
function buildRow(r: any): string[] {
  const raw = (r as any).rawValue
  const dec = (r as any).decodedValue ?? (r as any).value
  const rawStr = (raw === null || raw === undefined) ? '—' : String(raw)
  const decStr = (dec === null || dec === undefined) ? '—' : String(dec)
  return [String(r.id), r.name, rawStr, decStr, fmtTime(r.updatedAt)]
}

const fmtTime = (ts: number) => {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60) return `vor ${diff} Sekunden`
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2,'0')
  const mm = String(d.getMinutes()).padStart(2,'0')
  const ss = String(d.getSeconds()).padStart(2,'0')
  return `${hh}:${mm}:${ss}`
}

function cmp(a: any, b: any) { return a < b ? -1 : a > b ? 1 : 0 }

function getVisible(): Row[] {
  let arr = rows.slice()
  if (filter && filter.trim()) {
    const f = filter.toLowerCase()
    arr = arr.filter(r =>
      String(r.id).toLowerCase().includes(f) ||
      r.name.toLowerCase().includes(f) ||
      String(r.value ?? '').toLowerCase().includes(f)
    )
  }
  arr.sort((a, b) => {
    let av: any; let bv: any
    if (sortKey === 'id') { av = a.id; bv = b.id }
    else if (sortKey === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase() }
    else { av = a.updatedAt; bv = b.updatedAt }
    const r = cmp(av, bv)
    return sortOrder === 'asc' ? r : -r
  })
  return arr
}

function refresh() {
  const lt = (table as any);
  const prevSelected = typeof lt.selected === 'number' ? lt.selected : null;
  const vis = getVisible();
  const data = vis.map(r => buildRow(r));
  const headers = headersWithSort();
  table.setData([headers, ...data]);
  // Restore selection only
  try { if (prevSelected != null) lt.select(Math.max(1, Math.min(prevSelected, data.length))); } catch {}
  const selRow = Math.max(1, Math.min(((table as any).selected ?? 1), data.length));
  status.setContent(`Quelle: ws | Sort: ${sortKey} (${sortOrder})${filter ? ` | Filter="${filter}"` : ''} | Zeile: ${selRow}/${data.length}`);
  screen.render();
}

// ---------- keyboard ----------
const inspector = blessed.message({ hidden: true, parent: screen, top: 'center', left: 'center', width: '80%', height: 'shrink', border: 'line', label: ' Details ', tags: true, keys: true, mouse: true })
screen.key(['i'], () => {
  const lt = (table as any)
  const sel = Math.max(1, Math.min((lt.selected ?? 1), getVisible().length)) - 1
  const r = getVisible()[sel]
  if (!r) return
  const raw = (r as any).rawValue
  const dec = (r as any).decodedValue ?? (r as any).value
  inspector.display(`{bold}${r.name}{/bold}\nID: ${r.id}\nBeschreibung: ${r.description || '—'}\nRaw: ${raw ?? '—'}\nDecoded: ${dec ?? '—'}\nUpdated: ${fmtTime(r.updatedAt)}`, 0, () => {})
})

// sorting & control keys bound on screen (global)
screen.key(['1'], () => { sortKey = 'id'; refresh() })
screen.key(['2'], () => { sortKey = 'name'; refresh() })
screen.key(['3'], () => { sortKey = 'updatedAt'; refresh() })
screen.key(['a'], () => { sortOrder = 'asc'; refresh() })
screen.key(['d'], () => { sortOrder = 'desc'; refresh() })
screen.key(['s'], () => { sortKey = sortKey === 'id' ? 'name' : sortKey === 'name' ? 'updatedAt' : 'id'; refresh() })
screen.key(['q','C-c'], () => process.exit(0))

// search prompt
const prompt = blessed.prompt({
  parent: screen, top: 'center', left: 'center', width: '80%', height: 'shrink',
  label: ' Suche ', border: 'line', tags: true, keys: true, mouse: true
})
screen.key(['/'], () => {
  prompt.input('Filter eingeben (leer = kein Filter):', '', (_err: any, value: string) => {
    filter = (value ?? '').trim() || null
    refresh()
  })
})
screen.key(['escape'], () => { filter = null; refresh() })

screen.key(['escape'], () => { filter = null; refresh() })

// ---------- data hookup ----------
function upsert(c: Row) {
  const i = rows.findIndex(x => x.id === c.id)
  if (i >= 0) rows[i] = c
  else rows.push(c)
}

async function main() {
  await repo.connect()
  const initial = await repo.all()
  rows = initial.map(c => ({ ...c })) as Row[]
  refresh()

  repo.onUpdate((c) => {
    const row: Row = { ...(c as any) }
    // ensure updatedAt exists
    if (!row.updatedAt) row.updatedAt = Date.now()
    upsert(row)
  })

  // periodic repaint to update "vor x Sekunden"
  setInterval(refresh, 1000)
}

main().catch(err => {
  status.setContent(`Fehler: ${err?.message ?? err}`)
  screen.render()
})
