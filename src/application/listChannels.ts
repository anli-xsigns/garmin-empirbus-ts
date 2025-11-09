import blessed from 'blessed'
import { EmpirBusChannelRepository } from '../infrastructure/repositories/EmpirBusChannelRepository'

const WS_URL = process.env.EMPIRBUS_WS || 'ws://192.168.1.1:8888/ws'

type SortKey = 'id' | 'name' | 'updatedAt'
type SortOrder = 'asc' | 'desc'
type Row = {
    id: number
    name: string
    description: string
    rawValue: number
    decodedValue: number | boolean | string | null
    updatedAt: number
    channelType: number
}

const dash = '—'
const toCell = (v: unknown) => v === null || v === undefined ? dash : String(v)

const formatUpdated = (ms?: number) => {
    if (!ms) return dash
    const diff = Math.floor((Date.now() - ms) / 1000)
    if (diff < 60) return `vor ${diff} Sekunden`
    const d = new Date(ms)
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    const s = String(d.getSeconds()).padStart(2, '0')
    return `${h}:${m}:${s}`
}

const repo = new EmpirBusChannelRepository(WS_URL)

let rows: Row[] = []
let sortKey: SortKey = 'id'
let sortOrder: SortOrder = 'asc'
let filter: string | null = null
let typeFilter: 'all' | 'switch' | 'dim' = 'all'

const screen = blessed.screen({ smartCSR: true, title: 'EmpirBus Status' })

const help = blessed.box({
    top: 0, left: 0, width: '100%', height: 3, tags: true,
    content: '{bold}EmpirBus Status{/bold}  ↑↓/PgUp/PgDn Scroll  F1/F2/F3 Sort  1 Switch  3 Dim  0 Alle  / Suche  Esc Filter löschen  Enter/Space/t Toggle  o Ein  f Aus  +/− Dim  q Beenden'
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
    columnWidth: [8, 20, 16, 12, 12, 20]
})

screen.append(help)
screen.append(table)
screen.append(status)
;(table as any).focus()

const getVisible = (): Row[] => {
    let arr = rows.slice()
    if (typeFilter === 'switch') arr = arr.filter(r => Number(r.channelType) === 1)
    else if (typeFilter === 'dim') arr = arr.filter(r => Number(r.channelType) === 3)
    if (filter && filter.trim()) {
        const f = filter.toLowerCase()
        arr = arr.filter(r =>
            String(r.id).toLowerCase().includes(f) ||
            r.name.toLowerCase().includes(f) ||
            String(r.decodedValue ?? '').toLowerCase().includes(f)
        )
    }
    arr.sort((a, b) => {
        if (sortKey === 'id') return sortOrder === 'asc' ? a.id - b.id : b.id - a.id
        if (sortKey === 'name') {
            const av = a.name.toLowerCase()
            const bv = b.name.toLowerCase()
            return sortOrder === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0)
        }
        return sortOrder === 'asc' ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt
    })
    return arr
}

const refresh = () => {
    const vis = getVisible()
    const headers = ['ID', 'Name', 'Description', 'Raw', 'Decoded', 'Zuletzt aktualisiert']
    const data = vis.map(r => [toCell(r.id), toCell(r.name), toCell(r.description), toCell(r.rawValue), toCell(r.decodedValue), toCell(formatUpdated(r.updatedAt))])
    const sel = (table as any).selected ?? 1
    table.setData([headers, ...(data.length ? data : [Array(headers.length).fill('—')])])
    const len = ((table as any).rows?.length ?? 1) - 1
    const next = Math.max(1, Math.min(len, sel))
    if (typeof (table as any).select === 'function')
        (table as any).select(next)
    screen.render()
}

async function main() {
    await repo.connect()
    const initial = await repo.all()
    rows = initial.map(c => ({
        id: (c as any).id,
        name: (c as any).name ?? '',
        description: (c as any).description ?? '',
        rawValue: (c as any).rawValue ?? (c as any).rawValue ?? null,
        decodedValue: (c as any).decodedValue ?? (c as any).decodedValue ?? null,
        updatedAt: (c as any).updatedAt || Date.now(),
        channelType: Number((c as any).channelType || 0)
    }))
    refresh()

    repo.onUpdate(c => {
        const row: Row = {
            id: (c as any).id,
            name: (c as any).name ?? '',
            description: (c as any).description ?? '',
            rawValue: (c as any).rawValue ?? (c as any).rawValue ?? null,
            decodedValue: (c as any).decodedValue ?? (c as any).decodedValue ?? null,
            updatedAt: (c as any).updatedAt || Date.now(),
            channelType: Number((c as any).channelType || 0)
        }
        const idx = rows.findIndex(x => x.id === row.id)
        if (idx >= 0) rows[idx] = row
        else rows.push(row)
    })

    table.key(['space', 'enter', 't'], async () => {
        const vis = getVisible()
        const idx = Math.max(1, (table as any).selected || 1) - 1
        const row = vis[idx]
        if (row)
            await repo.toggle(row.id)
    })

    table.key(['o'], async () => {
        const vis = getVisible()
        const idx = Math.max(1, (table as any).selected || 1) - 1
        const row = vis[idx]
        if (row) {
            if (Number(row.channelType) === 3)
                repo.dim(row.id, 1000)
            else
                await repo.toggle(row.id)
        }
    })

    table.key(['f'], async () => {
        const vis = getVisible()
        const idx = Math.max(1, (table as any).selected || 1) - 1
        const row = vis[idx]
        if (row) {
            if (Number(row.channelType) === 3)
                repo.dim(row.id, 0)
            else
                await repo.toggle(row.id)
        }
    })

    table.key(['+', 'add', 'plus'], async () => {
        const vis = getVisible()
        const idx = Math.max(1, (table as any).selected || 1) - 1
        const row = vis[idx]
        if (!row) return
        const val = row.rawValue
        if (Number(row.channelType) === 3)
            repo.dim(row.id, Math.max(120, Math.min(1000, Math.round(val + 50))))
        else if (val === 0)
            await repo.toggle(row.id)
    })

    table.key(['-', 'subtract', 'minus'], async () => {
        const vis = getVisible()
        const idx = Math.max(1, (table as any).selected || 1) - 1
        const row = vis[idx]
        if (!row) return
        const val = row.rawValue
        if (Number(row.channelType) === 3)
            repo.dim(row.id, Math.max(0, Math.min(1000, Math.round(val - 50))))
        else if (val === 1)
            await repo.toggle(row.id)
    })

    table.key(['up'], () => {
        const lt = (table as any)
        const cur = Math.max(1, (lt.selected ?? 1))
        if (typeof lt.select === 'function') lt.select(Math.max(1, cur - 1))
        screen.render()
    })

    table.key(['down'], () => {
        const lt = (table as any)
        const len = getVisible().length
        const cur = Math.max(1, (lt.selected ?? 1))
        if (typeof lt.select === 'function') lt.select(Math.min(len, cur + 1))
        screen.render()
    })

    table.key(['pageup'], () => {
        const lt = (table as any)
        const page = Math.max(1, ((lt.height || 10) - 5))
        const len = getVisible().length
        const cur = Math.max(1, (lt.selected ?? 1))
        const next = Math.max(1, cur - page)
        if (typeof lt.select === 'function') lt.select(next)
        screen.render()
    })

    table.key(['pagedown'], () => {
        const lt = (table as any)
        const page = Math.max(1, ((lt.height || 10) - 5))
        const len = getVisible().length
        const cur = Math.max(1, (lt.selected ?? 1))
        const next = Math.min(len, cur + page)
        if (typeof lt.select === 'function') lt.select(next)
        screen.render()
    })

    table.key(['home'], () => {
        const lt = (table as any)
        if (typeof lt.select === 'function') lt.select(1)
        screen.render()
    })

    table.key(['end'], () => {
        const lt = (table as any)
        const len = getVisible().length
        if (typeof lt.select === 'function') lt.select(Math.max(1, len))
        screen.render()
    })

    screen.key(['1'], () => {
        typeFilter = 'switch'
        refresh()
    })
    screen.key(['3'], () => {
        typeFilter = 'dim'
        refresh()
    })
    screen.key(['0', 'escape'], () => {
        typeFilter = 'all'
        filter = null
        refresh()
    })

    screen.key(['f1'], () => {
        sortKey = 'id'
        refresh()
    })
    screen.key(['f2'], () => {
        sortKey = 'name'
        refresh()
    })
    screen.key(['f3'], () => {
        sortKey = 'updatedAt'
        refresh()
    })
    screen.key(['a'], () => {
        sortOrder = 'asc'
        refresh()
    })
    screen.key(['d'], () => {
        sortOrder = 'desc'
        refresh()
    })
    screen.key(['s'], () => {
        sortKey = sortKey === 'id' ? 'name' : sortKey === 'name' ? 'updatedAt' : 'id'
        refresh()
    })
    screen.key(['q', 'C-c'], () => process.exit(0))

    screen.key(['/'], () => {
        const prompt = blessed.prompt({ parent: screen, label: ' Suche ', border: 'line', tags: true, keys: true, mouse: true })
        prompt.input('Filter eingeben (leer = kein Filter):', '', (_err: any, value: string) => {
            filter = (value ?? '').trim() || null
            refresh()
        })
    })

    setInterval(refresh, 1000)
}

main().catch(err => {
    status.setContent(`Fehler: ${err?.message ?? err}`)
    screen.render()
})
