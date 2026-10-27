import Dexie, { type Table } from 'dexie'
import { activeDb } from './shops'
import type { Category, Invoice, Item, LedgerRow, Party, Purchase, StockMove, User } from './types'

export interface OutboxRow {
  n?: number
  table: string
  rowId: string
  at: number
}

class PasalDB extends Dexie {
  items!: Table<Item, string>
  categories!: Table<Category, string>
  parties!: Table<Party, string>
  invoices!: Table<Invoice, string>
  ledger!: Table<LedgerRow, string>
  stockMoves!: Table<StockMove, string>
  purchases!: Table<Purchase, string>
  users!: Table<User, string>
  kv!: Table<{ k: string; v: unknown }, string>
  outbox!: Table<OutboxRow, number>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      items: 'id,barcode,sold,active',
      parties: 'id,type',
      invoices: 'id,no,at',
      ledger: 'id,partyId,at',
      stockMoves: 'id,itemId,at',
      purchases: 'id,at',
      users: 'id',
      kv: 'k',
      outbox: '++n',
    })
    this.version(2).stores({ categories: 'id' })
  }
}

export const db = new PasalDB(activeDb())

export const uid = () => crypto.randomUUID()

export async function kvGet<T>(k: string, d: T): Promise<T> {
  const r = await db.kv.get(k)
  return r ? (r.v as T) : d
}
export const kvSet = (k: string, v: unknown) => db.kv.put({ k, v })

/** Every local write is also noted here so the sync step (cloud phase) knows what to upload. */
export const queue = (table: string, rowId: string) => db.outbox.add({ table, rowId, at: Date.now() })
