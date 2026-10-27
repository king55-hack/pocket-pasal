import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../ctx'
import { db, uid } from '../db'
import { addCategory, adjustStock, FREE_ITEM_LIMIT, ranked, removeCategory, saveCategory, saveItem } from '../logic'
import { Photo, Scanner } from '../components'
import { enrichSampleItems, fetchPhoto, lookupBarcode, sampleItemsToEnrich, validCode } from '../off'
import { compressImage, ITEM_PHOTO } from '../images'
import type { Category, Item, Party } from '../types'

export const PAGE = 40

export function useCategories() {
  const cats = useLiveQuery(() => db.categories.filter((c) => c.active).toArray(), [], [] as Category[])
  return useMemo(() => cats.slice().sort((a, b) => a.nameNe.localeCompare(b.nameNe)), [cats])
}

/** Row of category buttons that scrolls sideways. '' means all items, '__none' means items with no category. */
export function CategoryChips({ cats, items, value, onChange }: { cats: Category[]; items: Item[]; value: string; onChange: (v: string) => void }) {
  const { t, n } = useApp()
  if (cats.length === 0) return null
  const active = items.filter((i) => i.active)
  const count = (id: string) => active.filter((i) => i.categoryId === id).length
  const known = new Set(cats.map((c) => c.id))
  const none = active.filter((i) => !i.categoryId || !known.has(i.categoryId)).length
  const chip = (id: string, label: string, c: number) => (
    <button key={id} className={'pill' + (value === id ? ' on' : '')} style={{ flex: 'none', whiteSpace: 'nowrap' }} onClick={() => onChange(id)}>{label} <small style={{ opacity: 0.7 }}>{n(c)}</small></button>
  )
  return (
    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, flex: 'none' }}>
      {chip('', t('सबै', 'All'), active.length)}
      {cats.map((c) => chip(c.id, t(c.nameNe, c.nameEn), count(c.id)))}
      {none > 0 && chip('__none', t('वर्गबिना', 'No category'), none)}
    </div>
  )
}
export const inCategory = (i: Item, cat: string, cats: Category[]) =>
  !cat ? true : cat === '__none' ? !i.categoryId || !cats.some((c) => c.id === i.categoryId) : i.categoryId === cat

export function Items() {
  const { t, n, m, go, plan, toast, perms } = useApp()
  const items = useLiveQuery(() => db.items.toArray(), [], [] as Item[])
  const cats = useCategories()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [low, setLow] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const list = useMemo(() => ranked(items, q).filter((i) => (q ? true : inCategory(i, cat, cats)) && (!low || i.stock < i.minStock)), [items, q, cat, cats, low])
  const icons = useMemo(() => new Map(cats.map((c) => [c.id, c.icon])), [cats])
  const todo = useLiveQuery(() => sampleItemsToEnrich(), [items], 0)
  const [online2, setBusyOff] = useState(false)
  async function fillFromWeb() {
    setBusyOff(true)
    const n2 = await enrichSampleItems()
    setBusyOff(false)
    toast(n2 ? t(n2 + ' सामानमा फोटो/बारकोड थपियो', n2 + ' items got a photo or barcode') : t('कुनै थपिएन। इन्टरनेट जाँच्नुस् वा पछि प्रयास गर्नुस्।', 'Nothing was added. Check the internet or try later.'))
  }
  const lowCount = items.filter((i) => i.active && i.stock < i.minStock).length
  const addNew = () => {
    if (plan === 'free' && items.length >= FREE_ITEM_LIMIT) { toast(t('फ्री प्लानमा १०० सामानसम्म', 'Free plan allows 100 items')); go('upgrade', { f: 'books' }); return }
    go('itemedit', {})
  }
  return (
    <div className="body">
      <div className="row"><input className="in g" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE) }} placeholder={t('🔍 सामान खोज्नुस् (नेपाली वा English)', '🔍 Search (Nepali or English)')} />
        {perms.editItems && <button className="btn s" onClick={addNew}>+ {t('नयाँ', 'New')}</button>}</div>
      <CategoryChips cats={cats} items={items} value={q ? '' : cat} onChange={(v) => { setCat(v); setQ(''); setLimit(PAGE) }} />
      <div className="row wrap"><button className={'pill' + (!low ? ' on' : '')} onClick={() => { setLow(false); setLimit(PAGE) }}>{t('सबै', 'All')} {n(items.filter((i) => i.active).length)}</button>
        <button className={'pill' + (low ? ' on' : '')} onClick={() => { setLow(true); setLimit(PAGE) }}>{t('स्टक कम', 'Low stock')} {n(lowCount)}</button>
        {perms.editItems && <button className="pill" onClick={() => go('categories')}>🗂 {t('वर्ग मिलाउनुस्', 'Manage categories')}</button>}</div>
      {perms.editItems && todo > 0 && <button className="btn o" disabled={online2} onClick={fillFromWeb}>🌐 {online2 ? '…' : t('नामी सामानमा फोटो र बारकोड थप्नुस् (इन्टरनेट चाहिन्छ)', 'Add photos and barcodes to well-known items (needs internet)')}</button>}
      <div className="mut" style={{ fontSize: 13 }}>{t('🔥 धेरै बिक्री हुने सामान माथि। रोमन अक्षरमा पनि खोज्न मिल्छ (जस्तै: chini, tel, wai).', '🔥 Best sellers on top. You can also search with Roman letters, such as chini, tel or wai.')}</div>
      {list.length === 0 && <div className="note">{t('सामान भेटिएन।', 'No items found.')}</div>}
      {list.slice(0, limit).map((i) => (
        <button key={i.id} className={'item tap' + (i.stock < i.minStock ? ' low' : '')} onClick={() => perms.editItems && go('itemedit', { id: i.id })}>
          <Photo src={i.photo} icon={i.categoryId ? icons.get(i.categoryId) : undefined} />
          <div style={{ flex: 1, minWidth: 0 }}><b>{t(i.nameNe, i.nameEn)}</b>
            <small>{m(i.price)}{perms.viewCost ? ' · ' + t('लागत', 'cost') + ' ' + m(i.cost) : ''} · {i.sold >= 100 ? '🔥 ' : ''}{t('बिक्री', 'sold')} {n(i.sold)}</small>
            {i.stock < i.minStock && <small className="w">{t('स्टक कम', 'Low stock')} ({t('न्यूनतम', 'min')} {n(i.minStock)})</small>}</div>
          <b className={i.stock < i.minStock ? 'w' : ''}>{n(i.stock)}</b>
        </button>
      ))}
      {list.length > limit && <button className="btn o" onClick={() => setLimit(limit + PAGE)}>{t('थप देखाउनुस् (' + n(list.length - limit) + ' बाँकी)', 'Show more (' + (list.length - limit) + ' left)')}</button>}
    </div>
  )
}

export function ItemEdit({ id }: { id?: string }) {
  const { t, back, toast, on, s } = useApp()
  const existing = useLiveQuery(() => (id ? db.items.get(id) : undefined), [id])
  const suppliers = useLiveQuery(() => db.parties.where('type').equals('supplier').toArray(), [], [] as Party[])
  const cats = useCategories()
  const [f, setF] = useState<Item | null>(null)
  const [scan, setScan] = useState(false)
  const [adj, setAdj] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)
  const [looking, setLooking] = useState(false)
  const [found, setFound] = useState('')
  const [newCat, setNewCat] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const it: Item = f ?? existing ?? { id: uid(), nameNe: '', nameEn: '', price: 0, cost: 0, stock: 0, minStock: 5, unit: 'pcs', vat: s.vatRegistered, sold: 0, active: true }
  // The photo is shrunk after the person picks it, which takes a moment. Reading the latest values when it finishes keeps what was typed in the meantime.
  const latest = useRef(it)
  latest.current = it
  if (id && !existing && !f) return <div className="body" />
  const set = (p: Partial<Item>) => setF({ ...latest.current, ...p })
  const num = (k: keyof Item) => (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: e.target.value === '' ? 0 : +e.target.value } as any)

  async function save() {
    if (!it.nameNe && !it.nameEn) return toast(t('सामानको नाम लेख्नुस्', 'Enter the item name'))
    const out = { ...it, nameNe: it.nameNe || it.nameEn, nameEn: it.nameEn || it.nameNe }
    await saveItem(id ? out : { ...out, stock: 0 })
    if (!id && out.stock > 0) await adjustStock(out.id, out.stock, 'opening')
    toast(t('सेभ भयो', 'Saved'))
    back()
  }
  async function doAdj(sign: 1 | -1) {
    const d = +adj
    if (!d || !id) return
    await adjustStock(id, sign * d, sign > 0 ? 'adjust+' : 'damage')
    setAdj(''); setF(null)
    toast(t('स्टक मिलाइयो', 'Stock updated'))
  }
  async function lookUp() {
    setLooking(true); setFound('')
    const p = await lookupBarcode((it.barcode ?? '').trim())
    if (!p) { toast(t('यो बारकोड इन्टरनेटमा भेटिएन। आफैँ लेख्नुस्।', 'This barcode was not found online. Type it in yourself.')); setLooking(false); return }
    const img = it.photo || !p.image ? undefined : await fetchPhoto(p.image)
    const label = [p.brand, p.name, p.quantity].filter(Boolean).join(' · ')
    set({ ...(it.nameEn ? {} : { nameEn: p.name }), ...(it.nameNe ? {} : { nameNe: p.name }), ...(img ? { photo: img } : {}) })
    setFound(label)
    setLooking(false)
  }
  async function makeCat() {
    if (!newCat.trim()) return
    const c = await addCategory(newCat)
    set({ categoryId: c.id }); setNewCat('')
  }
  return (
    <div className="body">
      <div className="row">
        <button className="photo" style={{ width: 104, height: 104, border: 0, cursor: 'pointer' }} onClick={() => file.current?.click()}>{photoBusy ? <span>…</span> : it.photo ? <img src={it.photo} alt="" /> : <span>📷</span>}</button>
        <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => { const fl = e.target.files?.[0]; e.target.value = ''; if (!fl) return; setPhotoBusy(true); try { set({ photo: await compressImage(fl, ITEM_PHOTO) }) } catch { toast(t('फोटो पढ्न सकिएन। अर्को फोटो छान्नुस्।', 'Could not read that photo. Try another.')) } setPhotoBusy(false) }} />
        <div className="g" style={{ flex: 1, display: 'grid', gap: 8 }}>
          <input className="in" placeholder="नाम (नेपाली)" value={it.nameNe} onChange={(e) => set({ nameNe: e.target.value })} />
          <input className="in" placeholder="Name (English)" value={it.nameEn} onChange={(e) => set({ nameEn: e.target.value })} />
        </div>
      </div>
      <label className="f">{t('वर्ग', 'Category')}<select className="in" value={it.categoryId ?? ''} onChange={(e) => set({ categoryId: e.target.value || undefined })}><option value="">{t('— वर्ग छैन —', '— none —')}</option>{cats.map((c) => <option key={c.id} value={c.id}>{t(c.nameNe, c.nameEn)}</option>)}</select></label>
      <div className="row"><input className="in g" placeholder={t('नयाँ वर्गको नाम', 'New category name')} value={newCat} onChange={(e) => setNewCat(e.target.value)} />
        <button className="btn s" disabled={!newCat.trim()} onClick={makeCat}>+ {t('वर्ग', 'Add')}</button></div>
      <div className="row"><label className="f g">{t('खरिद मूल्य', 'Cost')}<input className="in" inputMode="decimal" value={it.cost || ''} onChange={num('cost')} /></label>
        <label className="f g">{t('बिक्री मूल्य', 'Price')}<input className="in" inputMode="decimal" value={it.price || ''} onChange={num('price')} /></label></div>
      <div className="row"><label className="f g">{t('हालको स्टक', 'Stock')}<input className="in" inputMode="decimal" value={id ? it.stock : it.stock || ''} disabled={!!id} onChange={num('stock')} /></label>
        <label className="f g">{t('न्यूनतम स्टक', 'Min stock')}<input className="in" inputMode="decimal" value={it.minStock || ''} onChange={num('minStock')} /></label></div>
      <div className="row"><label className="f g">{t('एकाइ', 'Unit')}<input className="in" value={it.unit} onChange={(e) => set({ unit: e.target.value })} /></label>
        <label className="f g">{t('बारकोड', 'Barcode')}<input className="in" inputMode="numeric" value={it.barcode ?? ''} onChange={(e) => set({ barcode: e.target.value })} /></label>
        {on('barcode') && <button className="btn s" style={{ alignSelf: 'flex-end' }} onClick={() => setScan(!scan)}>▮▮</button>}</div>
      {scan && <Scanner onClose={() => setScan(false)} onCode={(c) => { set({ barcode: c }); setScan(false) }} />}
      {validCode((it.barcode ?? '').trim()) && (<>
        <button className="btn o" disabled={looking} onClick={lookUp}>🌐 {looking ? '…' : t('बारकोडबाट नाम र फोटो खोज्नुस्', 'Find name and photo from the barcode')}</button>
        {found && <div className="note">{t('भेटियो: ', 'Found: ')}<b>{found}</b><div className="mut" style={{ fontSize: 12 }}>{t('स्रोत: Open Food Facts (स्वयंसेवकले बनाएको सूची)। आफ्नो प्याकसँग मिलाएर हेर्नुस्।', 'Source: Open Food Facts (a list made by volunteers). Check it against your pack.')}</div></div>}
      </>)}
      {on('vat') && s.vatRegistered && <div className="toggle"><span>{t('भ्याट लाग्ने', 'VAT applies')}</span><button className={'sw' + (it.vat ? ' on' : '')} aria-label="vat" onClick={() => set({ vat: !it.vat })} /></div>}
      {suppliers.length > 0 && <label className="f">{t('आपूर्तिकर्ता', 'Supplier')}<select className="in" value={it.supplierId ?? ''} onChange={(e) => set({ supplierId: e.target.value || undefined })}><option value="" />{suppliers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      {id && (<><div className="h">{t('स्टक मिलाउनुस् (गन्ती / बिग्रेको)', 'Adjust stock (count / damaged)')}</div>
        <div className="row"><input className="in g" inputMode="numeric" placeholder="0" value={adj} onChange={(e) => setAdj(e.target.value)} />
          <button className="btn s" onClick={() => doAdj(1)}>+ {t('थप', 'Add')}</button><button className="btn o s" onClick={() => doAdj(-1)}>− {t('घटा', 'Remove')}</button></div></>)}
      <button className="btn stick" disabled={photoBusy} onClick={save}>{t('सेभ गर्नुस्', 'Save')}</button>
      {id && <button className="btn o" onClick={async () => { await saveItem({ ...it, active: false }); toast(t('सामान हटाइयो', 'Item removed')); back() }}>{t('सामान हटाउनुस्', 'Remove item')}</button>}
    </div>
  )
}

export function Categories() {
  const { t, n, toast } = useApp()
  const cats = useCategories()
  const items = useLiveQuery(() => db.items.toArray(), [], [] as Item[])
  const [ne, setNe] = useState('')
  const [en, setEn] = useState('')
  const [edit, setEdit] = useState<Category | null>(null)
  async function add() {
    if (!ne.trim() && !en.trim()) return
    await addCategory(ne.trim() || en.trim(), en.trim() || ne.trim())
    setNe(''); setEn('')
  }
  return (
    <div className="body">
      <div className="note">{t('वर्ग बनाएपछि सामान खोज्न र छान्न सजिलो हुन्छ। सामान मेटिँदैन।', 'Categories make a big shop easier to browse. Removing one never deletes items.')}</div>
      <div className="h">{t('नयाँ वर्ग', 'New category')}</div>
      <input className="in" placeholder="नाम (नेपाली)" value={ne} onChange={(e) => setNe(e.target.value)} />
      <input className="in" placeholder="Name (English, optional)" value={en} onChange={(e) => setEn(e.target.value)} />
      <button className="btn" disabled={!ne.trim() && !en.trim()} onClick={add}>+ {t('वर्ग थप्नुस्', 'Add category')}</button>
      <div className="h">{t('सबै वर्ग', 'All categories')} ({n(cats.length)})</div>
      {cats.length === 0 && <div className="mut">{t('अहिलेसम्म वर्ग छैन।', 'No categories yet.')}</div>}
      {cats.map((c) => edit?.id === c.id ? (
        <div key={c.id} className="st" style={{ flex: 'none', display: 'grid', gap: 8 }}>
          <input className="in" value={edit.nameNe} onChange={(e) => setEdit({ ...edit, nameNe: e.target.value })} />
          <input className="in" value={edit.nameEn} onChange={(e) => setEdit({ ...edit, nameEn: e.target.value })} />
          <div className="row"><button className="btn g" onClick={async () => { await saveCategory(edit); setEdit(null); toast(t('सेभ भयो', 'Saved')) }}>{t('सेभ', 'Save')}</button>
            <button className="btn o g" onClick={() => setEdit(null)}>{t('रद्द', 'Cancel')}</button></div>
        </div>
      ) : (
        <div key={c.id} className="item"><div style={{ flex: 1 }}><b>{t(c.nameNe, c.nameEn)}</b><small>{n(items.filter((i) => i.active && i.categoryId === c.id).length)} {t('सामान', 'items')}</small></div>
          <button className="btn o s" onClick={() => setEdit(c)}>{t('बदल्नुस्', 'Edit')}</button>
          <button className="btn o s" onClick={async () => { await removeCategory(c.id); toast(t('वर्ग हटाइयो', 'Category removed')) }}>{t('हटाउनुस्', 'Remove')}</button></div>
      ))}
    </div>
  )
}
