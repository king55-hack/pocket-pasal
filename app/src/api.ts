import { kvGet, kvSet, uid } from './db'

/** Set VITE_API_URL when building for production. */
export const API: string = (import.meta.env.VITE_API_URL as string | undefined) || 'http://127.0.0.1:8787'

export interface Cloud {
  email: string
  access: string
  refresh: string
  /** Last server sequence number this phone has applied. */
  cursor: number
  lastSync: number
  lastError?: string
}
export const getCloud = () => kvGet<Cloud | null>('cloud', null)
export const setCloud = (c: Cloud | null) => kvSet('cloud', c)

export async function device() {
  let id = await kvGet<string>('deviceId', '')
  if (!id) { id = uid(); await kvSet('deviceId', id) }
  const ua = navigator.userAgent
  const name = /Android/i.test(ua) ? 'Android phone' : /iPhone|iPad/i.test(ua) ? 'iPhone / iPad' : /Windows/i.test(ua) ? 'Windows PC' : /Mac/i.test(ua) ? 'Mac' : 'Browser'
  return { id, name }
}

export interface ApiError { status: number; code: string; data?: any }
const fail = (status: number, code: string, data?: any): ApiError => ({ status, code, data })

async function send(path: string, method: string, body?: unknown, token?: string) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 20000)
  try {
    const r = await fetch(API + path, {
      method, signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw fail(r.status, data?.error || 'error', data)
    return data
  } catch (e: any) {
    if (e && typeof e.status === 'number') throw e
    throw fail(0, 'network')
  } finally { clearTimeout(timer) }
}

/** Public calls (login, OTP). */
export const post = (path: string, body: unknown) => send(path, 'POST', body)

let refreshing: Promise<Cloud | null> | null = null
async function refresh(): Promise<Cloud | null> {
  const c = await getCloud()
  if (!c) return null
  try {
    const t = await send('/auth/refresh', 'POST', { refresh: c.refresh })
    const next = { ...c, access: t.access, refresh: t.refresh }
    await setCloud(next)
    return next
  } catch (e: any) {
    // Only drop the login when the server says the token is dead, not when we are merely offline.
    if (e.status === 401 || e.status === 403) await setCloud(null)
    throw e
  }
}

/** Calls that need the owner's session. Refreshes the short-lived token once if it has expired. */
export async function authed(path: string, method = 'GET', body?: unknown) {
  const c = await getCloud()
  if (!c) throw fail(401, 'not_connected')
  try {
    return await send(path, method, body, c.access)
  } catch (e: any) {
    if (e.status !== 401) throw e
    refreshing ||= refresh().finally(() => { refreshing = null })
    const n = await refreshing
    if (!n) throw e
    return send(path, method, body, n.access)
  }
}
