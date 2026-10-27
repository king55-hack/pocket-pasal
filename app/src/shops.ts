/**
 * Several businesses on one phone. Each business has its own database in the browser, so their items, bills and khata never mix.
 * Switching reloads the app on the other database. The first business keeps the original name ("pasal"), so nothing existing moves.
 */
const LIST = 'pasal-shops'
const ACTIVE = 'pasal-active'

export interface ShopRef { db: string; name: string }

export function activeDb(): string {
  try { return localStorage.getItem(ACTIVE) || 'pasal' } catch { return 'pasal' }
}
export function listShops(): ShopRef[] {
  try {
    const l = JSON.parse(localStorage.getItem(LIST) || '[]')
    return Array.isArray(l) ? l.filter((x) => x && typeof x.db === 'string' && typeof x.name === 'string') : []
  } catch { return [] }
}
const write = (l: ShopRef[]) => { try { localStorage.setItem(LIST, JSON.stringify(l)) } catch { /* private mode */ } }

/** Remember a business by name so it can be picked from the list later. */
export function rememberShop(db: string, name: string) {
  const l = listShops()
  const i = l.findIndex((x) => x.db === db)
  if (i >= 0) { if (l[i].name === name) return; l[i] = { db, name } } else l.push({ db, name })
  write(l)
}
export function forgetShop(db: string) { write(listShops().filter((x) => x.db !== db)) }

export function switchShop(db: string) {
  try { localStorage.setItem(ACTIVE, db) } catch { /* private mode */ }
  location.reload()
}
/** Opens an empty database, so the app starts the shop setup again. */
export function addShop() {
  switchShop('pasal-' + crypto.randomUUID().slice(0, 8))
}
