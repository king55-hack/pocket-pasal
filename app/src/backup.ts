import Dexie from 'dexie'
import { db } from './db'
import { activeDb, forgetShop, listShops } from './shops'

/** Login tokens and this phone's own id never go into a backup file, so a copied backup cannot be used to log in. */
const LOCAL_ONLY = ['cloud', 'deviceId']

export async function makeBackup(): Promise<{ blob: Blob; filename: string }> {
  const dump: Record<string, unknown> = {}
  for (const tb of db.tables) dump[tb.name] = tb.name === 'kv' ? (await db.kv.toArray()).filter((r) => !LOCAL_ONLY.includes(r.k)) : await tb.toArray()
  return { blob: new Blob([JSON.stringify(dump)], { type: 'application/json' }), filename: 'pasal-backup-' + new Date().toISOString().slice(0, 10) + '.json' }
}

/** Puts a backup file back. A file that is not a backup is refused and nothing changes. */
export async function restoreBackup(f: File): Promise<void> {
  if (f.size > 50 * 1024 * 1024) throw new Error('too big')
  const dump = JSON.parse(await f.text())
  const ok = dump && typeof dump === 'object' && !Array.isArray(dump) && db.tables.every((tb) => dump[tb.name] === undefined || (Array.isArray(dump[tb.name]) && dump[tb.name].every((r: unknown) => r && typeof r === 'object')))
  if (!ok || !Array.isArray(dump.users) || !Array.isArray(dump.items)) throw new Error('bad file')
  const keep = (await db.kv.bulkGet(LOCAL_ONLY)).filter(Boolean)
  await db.transaction('rw', db.tables, async () => {
    for (const tb of db.tables) {
      await tb.clear()
      if (dump[tb.name]) await tb.bulkAdd(tb.name === 'kv' ? dump.kv.filter((r: { k: string }) => !LOCAL_ONLY.includes(r.k)) : dump[tb.name])
    }
    await db.kv.bulkPut(keep as { k: string; v: unknown }[])
  })
}

/** Erases this business from the phone and starts over (or opens another business on the phone). Cloud data is not touched. */
export async function wipeThisPhone(): Promise<void> {
  const name = activeDb()
  forgetShop(name)
  db.close()
  await Dexie.delete(name)
  try {
    localStorage.removeItem('pasal-login-lock')
    const next = listShops()[0]
    localStorage.setItem('pasal-active', next ? next.db : 'pasal')
  } catch { /* private mode */ }
  location.reload()
}
