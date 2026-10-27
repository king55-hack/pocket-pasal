import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, uid } from '../db'
import { enrichSampleItems, fetchPhoto, lookupBarcode, SAMPLE_CODES, sampleItemsToEnrich, validCode } from '../off'
import type { Item } from '../types'

const item = (nameEn: string, o: Partial<Item> = {}): Item => ({ id: uid(), nameNe: nameEn, nameEn, price: 10, cost: 7, stock: 5, minStock: 2, unit: 'pcs', vat: false, sold: 0, active: true, ...o })
const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body, blob: async () => new Blob(['x']) }) as unknown as Response)

beforeEach(async () => { await db.delete(); await db.open() })

describe('Open Food Facts lookup', () => {
  it('only asks for real barcodes', async () => {
    const f = reply({})
    expect(validCode('8908002377217')).toBe(true)
    for (const bad of ['', 'abc', '123', '12345678901234567', '8908002377217/../x', '8908002377217?x=1']) expect(validCode(bad)).toBe(false)
    expect(await lookupBarcode('abc', f as unknown as typeof fetch)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
  it('reads the name, brand, size, picture and whether it is sold in Nepal', async () => {
    const f = reply({ status: 1, product: { product_name: 'RARA Instant Noodles', brands: 'Him-Shree Foods (P.) Ltd., Other', quantity: '75 g', image_front_url: 'https://images.openfoodfacts.org/a.jpg', countries_tags: ['en:nepal'] } })
    const p = await lookupBarcode('8908002377217', f as unknown as typeof fetch)
    expect(p).toEqual({ code: '8908002377217', name: 'RARA Instant Noodles', brand: 'Him-Shree Foods (P.) Ltd.', quantity: '75 g', image: 'https://images.openfoodfacts.org/a.jpg', nepal: true })
    const url = (f.mock.calls[0] as unknown as [string, RequestInit])[0]
    expect(url).toContain('https://world.openfoodfacts.org/api/v2/product/8908002377217.json')
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].credentials).toBe('omit') // no cookies or login go to a third party
  })
  it('gives nothing when the product is unknown, unnamed, or the network fails', async () => {
    expect(await lookupBarcode('8908002377217', reply({ status: 0 }) as unknown as typeof fetch)).toBeNull()
    expect(await lookupBarcode('8908002377217', reply({ status: 1, product: { product_name: '' } }) as unknown as typeof fetch)).toBeNull()
    expect(await lookupBarcode('8908002377217', reply({}, false) as unknown as typeof fetch)).toBeNull()
    expect(await lookupBarcode('8908002377217', (async () => { throw new Error('offline') }) as unknown as typeof fetch)).toBeNull()
  })
  it('only downloads pictures from the Open Food Facts picture server', async () => {
    const f = reply({})
    expect(await fetchPhoto('https://evil.example/x.jpg', f as unknown as typeof fetch)).toBeNull()
    expect(await fetchPhoto('http://images.openfoodfacts.org/x.jpg', f as unknown as typeof fetch)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})

describe('sample items get their real barcode and picture', () => {
  const found = (name: string, brand: string) => ({ code: '0', name, brand, quantity: '', image: 'https://images.openfoodfacts.org/x.jpg', nepal: false })
  it('adds a barcode and a picture only when the lookup confirms the name', async () => {
    await db.items.bulkAdd([item('Rara noodles'), item('Wai Wai noodles'), item('Parle-G biscuit'), item('Sugar 1kg')])
    const lookup = vi.fn(async (code: string) => (code === '8908002377217' ? found('RARA Instant Noodles', 'Him-Shree') : code === '8906013030015' ? found('Some other noodles', 'Other brand') : null))
    const photo = vi.fn(async () => 'data:image/jpeg;base64,AAAA')
    const n = await enrichSampleItems({ lookup: lookup as never, photo })
    expect(n).toBe(1)
    const all = await db.items.toArray()
    const rara = all.find((i) => i.nameEn === 'Rara noodles')!
    expect(rara.barcode).toBe('8908002377217')
    expect(rara.photo).toBe('data:image/jpeg;base64,AAAA')
    expect(all.find((i) => i.nameEn === 'Wai Wai noodles')!.barcode).toBeUndefined() // the name did not match, so it is left alone
    expect(all.find((i) => i.nameEn === 'Sugar 1kg')!.barcode).toBeUndefined() // plain goods have no single barcode
  })
  it('never overwrites what the shopkeeper already set, and does not repeat itself', async () => {
    await db.items.add(item('Rara noodles', { barcode: '1111111111111', photo: 'data:image/jpeg;base64,MINE' }))
    const lookup = vi.fn(async () => found('RARA Instant Noodles', 'Him-Shree'))
    expect(await enrichSampleItems({ lookup: lookup as never, photo: async () => 'data:image/jpeg;base64,NEW' })).toBe(0)
    expect(lookup).not.toHaveBeenCalled()
    const r = (await db.items.toArray())[0]
    expect([r.barcode, r.photo]).toEqual(['1111111111111', 'data:image/jpeg;base64,MINE'])
  })
  it('skips a barcode that another item already has', async () => {
    await db.items.bulkAdd([item('Rara noodles'), item('My own noodles', { barcode: '8908002377217' })])
    const lookup = vi.fn(async () => found('RARA Instant Noodles', 'Him-Shree'))
    expect(await enrichSampleItems({ lookup: lookup as never, photo: async () => 'data:image/jpeg;base64,X' })).toBe(0)
  })
  it('counts how many sample items could still be filled', async () => {
    await db.items.bulkAdd([item('Rara noodles'), item('Wai Wai noodles', { barcode: '1', photo: 'x' })])
    expect(await sampleItemsToEnrich()).toBe(1)
  })
  it('only lists barcodes of the right length and unique names', () => {
    expect(SAMPLE_CODES.every((s) => validCode(s.code))).toBe(true)
    expect(new Set(SAMPLE_CODES.map((s) => s.code)).size).toBe(SAMPLE_CODES.length)
  })
})
