import { db } from './db'
import { compressImage, ITEM_PHOTO } from './images'
import { saveItem } from './logic'
import type { Item } from './types'

/**
 * Product names, barcodes and pictures from Open Food Facts (openfoodfacts.org), a free database made by volunteers.
 * Pictures are CC BY-SA, data is ODbL: credit Open Food Facts contributors. Only a barcode is sent to them, nothing about the shop.
 * It is a community list, so a barcode can be missing, or belong to another pack size or country than the one on the shelf.
 */
export interface OffProduct { code: string; name: string; brand: string; quantity: string; image?: string; nepal: boolean }

const API = 'https://world.openfoodfacts.org/api/v2/product/'
export const validCode = (c: string) => /^\d{8,14}$/.test(c)

export async function lookupBarcode(code: string, fetcher: typeof fetch = fetch): Promise<OffProduct | null> {
  if (!validCode(code)) return null
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 9000)
  try {
    const r = await fetcher(`${API}${code}.json?fields=product_name,product_name_en,brands,quantity,image_front_url,image_front_small_url,countries_tags`, { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!r.ok) return null
    const j = await r.json()
    const p = j?.product
    if (j?.status !== 1 || !p) return null
    const name = String(p.product_name_en || p.product_name || '').trim()
    if (!name) return null
    return { code, name, brand: String(p.brands ?? '').split(',')[0].trim(), quantity: String(p.quantity ?? ''), image: p.image_front_url || p.image_front_small_url || undefined, nepal: Array.isArray(p.countries_tags) && p.countries_tags.includes('en:nepal') }
  } catch { return null } finally { clearTimeout(timer) }
}

/** Downloads the product picture and shrinks it like any other item picture. */
export async function fetchPhoto(url: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (!/^https:\/\/images\.openfoodfacts\.org\//.test(url)) return null
  try {
    const r = await fetcher(url, { credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!r.ok) return null
    return await compressImage(await r.blob(), ITEM_PHOTO)
  } catch { return null }
}

/**
 * Well-known packs for the sample shop. Each barcode was found in Open Food Facts, and it is only used after the live lookup
 * confirms the name, so a wrong or removed entry is skipped. Plain goods (sugar, rice, salt, eggs, milk) have no single barcode.
 */
export const SAMPLE_CODES: { en: string; code: string; must: RegExp }[] = [
  { en: 'Wai Wai noodles', code: '8906013030015', must: /wai/i },
  { en: 'Rara noodles', code: '8908002377217', must: /rara/i },
  { en: 'Dhaara oil 1L', code: '8943440002833', must: /dhara/i },
  { en: 'Surf Excel 1kg', code: '8909106057449', must: /surf/i },
  { en: 'Colgate toothpaste', code: '8901314765314', must: /colgate/i },
  { en: 'Good Day biscuit', code: '8901063092280', must: /good\s*day/i },
  { en: 'Parle-G biscuit', code: '8901719134845', must: /parle/i },
]

/** Gives the sample items their real barcode and picture, when online. Returns how many items were updated. */
export async function enrichSampleItems(deps: { lookup?: typeof lookupBarcode; photo?: typeof fetchPhoto } = {}): Promise<number> {
  const lookup = deps.lookup ?? lookupBarcode
  const photo = deps.photo ?? fetchPhoto
  let done = 0
  const items = await db.items.toArray()
  for (const s of SAMPLE_CODES) {
    const it = items.find((i) => i.active && i.nameEn === s.en)
    if (!it || (it.barcode && it.photo)) continue
    if (items.some((x) => x.id !== it.id && x.barcode === s.code)) continue // that barcode is already on another item
    const p = await lookup(s.code)
    if (!p || !s.must.test(p.name + ' ' + p.brand)) continue
    const img = it.photo ? undefined : p.image ? await photo(p.image) : undefined
    const next: Item = { ...it, barcode: it.barcode || s.code, ...(img ? { photo: img } : {}) }
    if (next.barcode !== it.barcode || next.photo !== it.photo) { await saveItem(next); done++ }
  }
  return done
}
/** True when there are sample items that could still get a barcode or picture. */
export async function sampleItemsToEnrich(): Promise<number> {
  const items = await db.items.toArray()
  return SAMPLE_CODES.filter((s) => items.some((i) => i.active && i.nameEn === s.en && !(i.barcode && i.photo))).length
}
