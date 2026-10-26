import type { Dispatch, SetStateAction } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, kvGet, kvSet } from './db'
import { fmtDate, fmtTime, neDigits } from './format'
import { PLANREQ, RANK } from './logic'
import { SHARED_SETTINGS, syncNow, touchSettings, type SyncResult } from './sync'
import type { Cloud } from './api'
import { DEFAULT_PERMS, type Perms, type Plan, type Settings, type User } from './types'

export const DEFAULTS: Settings = {
  shopName: '', company: '', shopType: 'kirana', pan: '', vatRegistered: false,
  province: '', district: '', muni: '', ward: '',
  lang: 'ne', cal: 'BS', simple: true, big: false, paper: '58',
  mod: { credit: true, vat: true, barcode: true, qr: true, returns: true, purch: true, staff: true, cctv: false, delivery: false, orders: true, alerts: true },
  plan: 'free', planUntil: 0, trialEnds: 0, openingCash: 0, billFooter: '',
}

export const TABS = ['home', 'sale', 'items', 'books', 'bills', 'more']
export interface Route { name: string; params?: any }

interface Ctx {
  ready: boolean
  hasShop: boolean
  s: Settings
  save: (p: Partial<Settings>) => Promise<void>
  user: User | null
  login: (u: User | null) => void
  own: boolean
  perms: Perms
  plan: Plan
  trialDays: number
  can: (f: string) => boolean
  on: (mod: string) => boolean
  t: (ne: string, en: string) => string
  n: (x: number | string) => string
  m: (x: number) => string
  date: (ts: number) => string
  time: (ts: number) => string
  route: Route
  go: (name: string, params?: any) => void
  back: () => void
  toast: (msg: string) => void
  toastMsg: string
  online: boolean
  pending: number
  refresh: () => Promise<void>
  cloud: Cloud | null
  syncing: boolean
  syncAll: () => Promise<SyncResult>
  cart: { itemId: string; qty: number }[]
  setCart: Dispatch<SetStateAction<{ itemId: string; qty: number }[]>>
  kind: 'tax' | 'cash'
  setKind: (k: 'tax' | 'cash') => void
}
const C = createContext<Ctx>(null as never)
export const useApp = () => useContext(C)

export function Provider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [hasShop, setHasShop] = useState(false)
  const [s, setS] = useState<Settings>(DEFAULTS)
  const [user, setUser] = useState<User | null>(null)
  // Read the user again from the database so a change of permissions shows up without logging in again.
  const liveUser = useLiveQuery(() => (user ? db.users.get(user.id) : undefined), [user?.id])
  const cur = user ? (liveUser ?? user) : null
  const perms: Perms = useMemo(() => (cur?.role === 'owner'
    ? { sell: true, credit: true, viewCost: true, editItems: true, purchase: true, returns: 'direct', books: true, orders: true, cctv: true }
    : { ...DEFAULT_PERMS, ...(cur?.perms ?? {}) }), [cur])
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }])
  const [toastMsg, setToastMsg] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [cart, setCart] = useState<{ itemId: string; qty: number }[]>([])
  const [kind, setKind] = useState<'tax' | 'cash'>('tax')
  const tm = useRef<number>(0)
  const pending = useLiveQuery(() => db.outbox.count(), [], 0) ?? 0
  const cloudRow = useLiveQuery(() => db.kv.get('cloud'), [])
  const cloud = (cloudRow?.v as Cloud | null | undefined) ?? null
  const [syncing, setSyncing] = useState(false)

  const refresh = useCallback(async () => {
    const st = await kvGet<Settings | null>('settings', null)
    if (st) setS({ ...DEFAULTS, ...st, mod: { ...DEFAULTS.mod, ...st.mod } })
    setHasShop(!!st?.shopName)
  }, [])
  useEffect(() => { refresh().then(() => setReady(true)) }, [refresh])
  useEffect(() => {
    const a = () => setOnline(true), b = () => setOnline(false)
    addEventListener('online', a); addEventListener('offline', b)
    return () => { removeEventListener('online', a); removeEventListener('offline', b) }
  }, [])

  const save = useCallback(async (p: Partial<Settings>) => {
    const shared = SHARED_SETTINGS.some((k) => k in p)
    const next = { ...s, ...p, ...(shared ? { updatedAt: Date.now() } : {}) }
    setS(next); setHasShop(!!next.shopName)
    await kvSet('settings', next)
    if (shared && next.shopName) await touchSettings()
  }, [s])

  const trialActive = s.trialEnds > Date.now()
  // A paid plan keeps working for 7 days after it ends, so a shop that is offline is not locked out.
  const paidActive = s.plan !== 'free' && s.planUntil + 7 * 86400000 > Date.now()
  const plan: Plan = trialActive ? 'max' : paidActive ? s.plan : 'free'
  const trialDays = trialActive ? Math.ceil((s.trialEnds - Date.now()) / 86400000) : 0
  const can = useCallback((f: string) => !PLANREQ[f] || RANK[plan] >= RANK[PLANREQ[f]], [plan])
  const on = useCallback((k: string) => !!s.mod[k] && can(k), [s.mod, can])

  const syncAll = useCallback(async () => {
    setSyncing(true)
    const r = await syncNow()
    await refresh()
    setSyncing(false)
    return r
  }, [refresh])
  const hasCloud = !!cloud
  useEffect(() => {
    if (!hasCloud) return
    const go2 = () => { if (navigator.onLine) syncAll() }
    go2()
    const iv = setInterval(go2, 60000)
    addEventListener('online', go2)
    return () => { clearInterval(iv); removeEventListener('online', go2) }
  }, [hasCloud, syncAll])
  useEffect(() => {
    if (!hasCloud || pending === 0 || !navigator.onLine) return
    const id = setTimeout(() => syncAll(), 3000)
    return () => clearTimeout(id)
  }, [hasCloud, pending, syncAll])

  const t = useCallback((ne: string, en: string) => (s.lang === 'ne' ? ne : en), [s.lang])
  const n = useCallback((x: number | string) => (s.lang === 'ne' ? neDigits(String(x)) : String(x)), [s.lang])
  const m = useCallback((x: number) => {
    const r = Math.round(x * 100) / 100
    const str = r.toLocaleString('en-IN', { maximumFractionDigits: 2 })
    return (s.lang === 'ne' ? 'रु ' : 'Rs ') + (s.lang === 'ne' ? neDigits(str) : str)
  }, [s.lang])
  const date = useCallback((ts: number) => fmtDate(ts, s.cal, s.lang), [s.cal, s.lang])
  const time = useCallback((ts: number) => fmtTime(ts, s.lang), [s.lang])

  const route = stack[stack.length - 1]
  const go = useCallback((name: string, params?: any) => {
    setStack((st) => (TABS.includes(name) ? [{ name, params }] : [...st, { name, params }]))
  }, [])
  const back = useCallback(() => setStack((st) => (st.length > 1 ? st.slice(0, -1) : [{ name: 'home' }])), [])
  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    clearTimeout(tm.current)
    tm.current = window.setTimeout(() => setToastMsg(''), 2600)
  }, [])
  const login = useCallback((u: User | null) => { setUser(u); setCart([]); setStack([{ name: 'home' }]) }, [])

  const value = useMemo<Ctx>(() => ({
    ready, hasShop, s, save, user: cur, login, own: cur?.role === 'owner', perms, plan, trialDays, can, on, t, n, m, date, time,
    route, go, back, toast, toastMsg, online, pending, refresh, cloud, syncing, syncAll, cart, setCart, kind, setKind,
  }), [ready, hasShop, s, save, cur, login, perms, plan, trialDays, can, on, t, n, m, date, time, route, go, back, toast, toastMsg, online, pending, refresh, cloud, syncing, syncAll, cart, kind])

  return <C.Provider value={value}>{children}</C.Provider>
}
