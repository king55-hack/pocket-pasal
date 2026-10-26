export type Role = 'owner' | 'staff'
export type Plan = 'free' | 'pro' | 'max'
export type Method = 'cash' | 'qr' | 'card' | 'credit'

export interface Item {
  id: string
  nameNe: string
  nameEn: string
  barcode?: string
  price: number
  cost: number
  stock: number
  minStock: number
  unit: string
  vat: boolean
  sold: number
  /** Sales before the app kept moves. sold = soldBase + sales in the moves. */
  soldBase?: number
  supplierId?: string
  categoryId?: string
  photo?: string
  active: boolean
  updatedAt?: number
}
export interface Category {
  id: string
  nameNe: string
  nameEn: string
  active: boolean
  updatedAt?: number
}
/** What a staff member may do. The owner can do everything. Checked inside the app on the phone. */
export interface Perms {
  sell: boolean
  credit: boolean
  viewCost: boolean
  editItems: boolean
  purchase: boolean
  returns: 'off' | 'approval' | 'direct'
  books: boolean
  orders: boolean
  cctv: boolean
}
export const DEFAULT_PERMS: Perms = { sell: true, credit: false, viewCost: false, editItems: false, purchase: false, returns: 'approval', books: false, orders: false, cctv: false }
export interface Party {
  id: string
  type: 'customer' | 'supplier'
  name: string
  phone?: string
  /** customer: amount they owe us. supplier: amount we owe them. */
  balance: number
  updatedAt?: number
}
export interface Line {
  itemId: string
  name: string
  nameEn: string
  qty: number
  rate: number
  /** VAT percent for this line (0 or 13). Prices are VAT-exclusive. */
  vat: number
}
export interface Payment {
  method: Method
  amount: number
  /** true when the provider confirmed the money (or it was cash / credit). */
  verified: boolean
  provider?: string
  providerRef?: string
}
export interface Invoice {
  id: string
  no: string
  kind: 'tax' | 'cash' | 'credit_note'
  at: number
  partyId?: string
  lines: Line[]
  subtotal: number
  vat: number
  total: number
  payments: Payment[]
  by: string
  refId?: string
}
export interface LedgerRow {
  id: string
  partyId: string
  at: number
  desc: string
  dr: number
  cr: number
  /** Signed change this row made to the party balance. Balances are rebuilt from these. */
  delta: number
}
export interface StockMove {
  id: string
  itemId: string
  qty: number
  reason: string
  refId?: string
  at: number
}
export interface Purchase {
  id: string
  supplierId?: string
  billNo: string
  at: number
  lines: { itemId: string; qty: number; cost: number }[]
  total: number
  paid: boolean
}
export interface User {
  id: string
  name: string
  role: Role
  salt: string
  hash: string
  active: boolean
  perms?: Partial<Perms>
  updatedAt?: number
}
export interface Settings {
  shopName: string
  company: string
  shopType: string
  /** Free text when the shop type is 'other'. */
  shopTypeOther?: string
  pan: string
  vatRegistered: boolean
  province: string
  district: string
  muni: string
  ward: string
  lang: 'ne' | 'en'
  cal: 'BS' | 'AD'
  simple: boolean
  big: boolean
  paper: '58' | '80' | 'a4'
  mod: Record<string, boolean>
  plan: Plan
  /** When the paid plan runs out (ms). 0 = no paid plan. A 7-day grace applies. */
  planUntil: number
  trialEnds: number
  updatedAt?: number
  openingCash: number
  billFooter: string
  /** The shop's own Fonepay / eSewa / Khalti QR picture, shown when no dynamic QR is available. */
  staticQr?: string
}
