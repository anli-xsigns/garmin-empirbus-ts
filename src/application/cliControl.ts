
import { EmpirBusChannelRepository } from '../infrastructure/repositories/EmpirBus/EmpirBusChannelRepository'
import { toCamelCase } from '../shared/case'

export type Action = 'on' | 'off' | 'toggle' | 'dim'

type ResolveResult = { id: number, name: string } | null

const findId = (repo: EmpirBusChannelRepository, target: string): ResolveResult => {
  const n = Number(target)
  if (!Number.isNaN(n)) {
    const c = (repo as any).channels?.[n]
    return c ? { id: n, name: c.name } : null
  }
  const needle = toCamelCase(target)
  const list = Object.values((repo as any).channels || {}) as any[]
  const exact = list.find(c => c.name === needle || toCamelCase(c.description || '') === needle)
  if (exact) return { id: exact.id, name: exact.name }
  const partial = list.find(c => (c.name || '').includes(needle))
  return partial ? { id: partial.id, name: partial.name } : null
}

export const runControl = async (ws: string, target: string, action: Action, value?: number) => {
  const repo = new EmpirBusChannelRepository(ws)
  await repo.connect()
  const resolved = findId(repo, target)
  if (!resolved) throw new Error(`Kanal nicht gefunden: ${target}`)
  const chan = (repo as any).channels?.[resolved.id]

  const isSwitchable = Number(chan?.channelType) === 1
  const isDimmable = Number(chan?.channelType) === 3

  if (action === 'dim') {
    if (!isDimmable) throw new Error('dim nur bei dimmbaren Kanälen erlaubt')
    if (typeof value !== 'number' || Number.isNaN(value)) throw new Error('dim benötigt einen Wert 0..100')
    repo.dim(resolved.id, value)
  }
  else if (action === 'on') {
    if (isDimmable)
      repo.dim(resolved.id, 100)
    else
      await repo.toggle(resolved.id)
  }
  else if (action === 'off') {
    if (isDimmable)
      repo.dim(resolved.id, 0)
    else
      await repo.toggle(resolved.id)
  }
  else if (action === 'toggle') {
    await repo.toggle(resolved.id)
  }
}
