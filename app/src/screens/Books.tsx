import { useState } from 'react'
import { PwInput } from '../components'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../ctx'
import { db } from '../db'
import { startOfDay } from '../format'
import { checkSecret, createPurchase, createReturn, returnedQty } from '../logic'
import { authed } from '../api'
import { kvGet } from '../db'
import { buildReport } from '../reports'
import { bytesToBase64, shareOrSave, toBlob } from '../share'
import { XLSX_MIME } from '../xlsx'
import { Contact } from './Khata'
import type { Invoice, Item, Party, Purchase } from '../types'

type Range = 'day' | 'week' | 'month'
const since = (r: Range) => (r === 'day' ? startOfDay() : startOfDay(Date.now() - (r === 'week' ? 6 : 29) * 86400000))

type ExRange = 'day' | 'week' | 'month' | 'year' | 'all'
const exFrom = (r: ExRange) => (r === 'all' ? 0 : r === 'day' ? startOfDay() : startOfDay(Date.now() - ({ week: 6, month: 29, year: 364 }[r]) * 86400000))

/** Excel file of the books for the PC: made on the phone, then saved, shared, or emailed to the owner. */
function ExportBar() {
  const { t, s, can, perms, cloud, online, date, time, toast, go } = useApp()
  const [r, setR] = useState<ExRange>('month')
  const [busy, setBusy] = useState('')
  const names: Record<ExRange, string> = { day: t('आज', 'Today'), week: t('७ दिन', '7 days'), month: t('३० दिन', '30 days'), year: t('१ वर्ष', '1 year'), all: t('सबै', 'All') }
  const build = () => buildReport({ from: exFrom(r), to: Date.now(), s, t, date, time, canCost: perms.viewCost })
  async function toFile() {
    if (!can('export')) return go('upgrade', { f: 'export' })
    setBusy('file')
    try { const x = await build(); const res = await shareOrSave(toBlob(x.bytes, XLSX_MIME), x.filename, 'Pocket Pasal'); if (res === 'saved') toast(t('Excel फाइल सेभ भयो', 'Excel file saved')) } catch { toast(t('फाइल बन्न सकेन', 'Could not make the file')) }
    setBusy('')
  }
  async function toMail() {
    if (!can('export') || !can('emailbill')) return go('upgrade', { f: 'emailbill' })
    const to = cloud?.email || (await kvGet('ownerEmail', ''))
    if (!to) return toast(t('आफ्नो इमेल भेटिएन', 'Your email was not found'))
    setBusy('mail')
    try {
      const x = await build()
      await authed('/send/email', 'POST', { to, kind: 'report', filename: x.filename, data: bytesToBase64(x.bytes) })
      toast(t(to + ' मा पठाइयो', 'Sent to ' + to))
    } catch (e: any) { toast(e.code === 'mail' ? t('इमेल सेवा अझै तयार छैन', 'The email service is not ready yet') : e.code === 'limit' ? t('आजको इमेल सीमा सकियो', "Today's email limit is used up") : t('इमेल जान सकेन। इन्टरनेट जाँच्नुस्।', 'Could not send. Check the internet.')) }
    setBusy('')
  }
  return (
    <>
      <div className="h">📊 {t('Excel (PC मा हेर्न)', 'Excel (to see on your PC)')}</div>
      <div className="note">{t('बिक्री, खरिद, लेजर, ग्राहकको बाँकी र स्टक एउटै Excel फाइलमा आउँछ। PC मा हेर्न: यहाँबाट आफ्नो इमेलमा पठाउनुस्, वा PC को ब्राउजरमा यही साइट खोलेर लगइन गरेर यही बटन थिच्नुस्।', 'Sales, purchases, ledger, customer dues and stock come in one Excel file. To see it on your PC: email it to yourself from here, or open this site in the PC browser, log in and tap the same button.')}</div>
      <div className="row wrap">{(Object.keys(names) as ExRange[]).map((k) => <button key={k} className={'pill' + (r === k ? ' on' : '')} onClick={() => setR(k)}>{names[k]}</button>)}</div>
      <button className="btn" disabled={!!busy} onClick={toFile}>{busy === 'file' ? '…' : '⬇ ' + t('Excel फाइल बनाउनुस्', 'Make the Excel file')}{!can('export') ? ' 🔒' : ''}</button>
      <button className="btn o" disabled={!!busy || (can('export') && can('emailbill') && (!cloud || !online))} onClick={toMail}>{busy === 'mail' ? '…' : '✉ ' + t('मेरो इमेलमा पठाउनुस्', 'Email it to me')}{!can('emailbill') ? ' 🔒' : ''}</button>
      {can('emailbill') && (!cloud || !online) && <div className="mut" style={{ fontSize: 13 }}>{!cloud ? t('इमेलको लागि क्लाउड खाता जोड्नुस्।', 'Connect the cloud account to use email.') : t('इमेलको लागि इन्टरनेट चाहिन्छ।', 'Email needs internet.')}</div>}
    </>
  )
}

export function Books() {
  const { t, m, n, can, go, date, time, s } = useApp()
  const [tab, setTab] = useState('day')
  const [range, setRange] = useState<Range>('day')
  const from = tab === 'day' ? startOfDay() : since(range)
  const inv = useLiveQuery(() => db.invoices.where('at').aboveOrEqual(from).toArray(), [from], [] as Invoice[])
  const pur = useLiveQuery(() => db.purchases.where('at').aboveOrEqual(from).toArray(), [from], [] as Purchase[])
  const parties = useLiveQuery(() => db.parties.toArray(), [], [] as Party[])
  const need = (k: string) => { go('upgrade', { f: k }) }
  const pick = (k: string) => { if (k !== 'day' && !can('books')) return need('books'); setTab(k) }
  const sign = (i: Invoice) => (i.kind === 'credit_note' ? -1 : 1)
  const byMethod = (mt: string) => inv.flatMap((i) => i.payments.map((p) => ({ ...p, s: sign(i) }))).filter((p) => p.method === mt).reduce((a, p) => a + p.s * p.amount, 0)
  const cash = byMethod('cash'), qr = byMethod('qr'), card = byMethod('card'), credit = byMethod('credit')
  const purCash = pur.filter((p) => p.paid).reduce((a, p) => a + p.total, 0)
  const outVat = inv.reduce((a, i) => a + sign(i) * i.vat, 0)
  const inVat = 0
  const tabs: [string, string][] = [['day', t('दैनिक', 'Day')], ['sales', t('बिक्री', 'Sales')], ['purch', t('खरिद', 'Purchase')], ['led', t('लेजर', 'Ledger')], ...(s.vatRegistered ? [['vat', 'VAT'] as [string, string]] : [])]

  return (
    <div className="body">
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={'pill' + (tab === k ? ' on' : '')} onClick={() => pick(k)}>{l}{k !== 'day' && !can('books') ? ' 🔒' : ''}</button>)}</div>
      {tab !== 'day' && <div className="tabs">{(['day', 'week', 'month'] as Range[]).map((r) => <button key={r} className={'pill' + (range === r ? ' on' : '')} onClick={() => setRange(r)}>{{ day: t('आज', 'Today'), week: t('७ दिन', '7 days'), month: t('३० दिन', '30 days') }[r]}</button>)}</div>}
      {tab === 'day' && (<>
        <table><tbody>
          <tr><td>{t('सुरु नगद', 'Opening cash')}</td><td className="n">{m(s.openingCash)}</td></tr>
          <tr><td>{t('नगद बिक्री', 'Cash sales')}</td><td className="n">{m(cash)}</td></tr>
          <tr><td>QR</td><td className="n">{m(qr)}</td></tr>
          <tr><td>{t('कार्ड', 'Card')}</td><td className="n">{m(card)}</td></tr>
          <tr><td>{t('उधारो बिक्री', 'Credit sales')}</td><td className="n">{m(credit)}</td></tr>
          <tr><td>{t('खरिद (नगद)', 'Purchases (cash)')}</td><td className="n">− {m(purCash)}</td></tr>
          <tr><th>{t('अपेक्षित नगद', 'Expected cash')}</th><th className="n">{m(s.openingCash + cash - purCash)}</th></tr></tbody></table>
        <div className="mut" style={{ fontSize: 13 }}>{n(inv.length)} {t('बिल आज', 'bills today')}</div>
      </>)}
      {tab === 'sales' && (<>
        <table><thead><tr><th>{t('बिल', 'Bill')}</th><th>{t('समय', 'Time')}</th><th className="n">{t('जम्मा', 'Total')}</th></tr></thead>
          <tbody>{inv.sort((a, b) => b.at - a.at).map((i) => <tr key={i.id}><td>{n(i.no)}<br /><small className="mut">{i.kind === 'tax' ? t('कर', 'Tax') : i.kind === 'cash' ? t('नगद', 'Cash') : t('फिर्ता', 'Return')}</small></td><td>{date(i.at)}<br /><small className="mut">{time(i.at)}</small></td><td className={'n' + (i.kind === 'credit_note' ? ' w' : '')}>{i.kind === 'credit_note' ? '− ' : ''}{m(i.total)}</td></tr>)}</tbody></table>
        {inv.length === 0 && <div className="mut">{t('यो अवधिमा बिल छैन।', 'No bills in this period.')}</div>}
        <div className="tot b"><span>{t('जम्मा', 'Total')}</span><span>{m(inv.reduce((a, i) => a + sign(i) * i.total, 0))}</span></div>
      </>)}
      {tab === 'purch' && (<>
        <table><thead><tr><th>{t('बिल', 'Bill')}</th><th>{t('मिति', 'Date')}</th><th className="n">{t('जम्मा', 'Total')}</th></tr></thead>
          <tbody>{pur.map((p) => <tr key={p.id}><td>{p.billNo}<br /><small className="mut">{p.paid ? t('तिरिसक्यो', 'Paid') : t('उधारो', 'Credit')}</small></td><td>{date(p.at)}</td><td className="n">{m(p.total)}</td></tr>)}</tbody></table>
        {pur.length === 0 && <div className="mut">{t('यो अवधिमा खरिद छैन।', 'No purchases in this period.')}</div>}</>)}
      {tab === 'led' && (
        <table><thead><tr><th>{t('पार्टी', 'Party')}</th><th className="n">{t('डेबिट', 'Dr')}</th><th className="n">{t('क्रेडिट', 'Cr')}</th></tr></thead>
          <tbody>{parties.filter((p) => p.balance !== 0).map((p) => <tr key={p.id} onClick={() => go('ledger', { id: p.id })} style={{ cursor: 'pointer' }}><td>{p.name}</td><td className="n">{p.type === 'customer' ? m(p.balance) : ''}</td><td className="n">{p.type === 'supplier' ? m(p.balance) : ''}</td></tr>)}</tbody></table>)}
      {tab === 'vat' && (<>
        <table><tbody><tr><td>{t('बिक्रीमा भ्याट (आउटपुट)', 'Output VAT (sales)')}</td><td className="n">{m(outVat)}</td></tr>
          <tr><td>{t('खरिदमा भ्याट (इनपुट)', 'Input VAT (purchases)')}</td><td className="n">− {m(inVat)}</td></tr>
          <tr><th>{t('तिर्नुपर्ने भ्याट', 'VAT payable')}</th><th className="n">{m(outVat - inVat)}</th></tr></tbody></table>
        <div className="note">{t('यो सारांश मात्र हो। खरिदको भ्याट (इनपुट) अहिले जोडिएको छैन। IRD को नियम अनुसार लेखापालसँग जाँच गर्नुस्।', 'Summary only. Input VAT from purchases is not tracked yet. Check against IRD rules with an accountant.')}</div></>)}
      <ExportBar />
    </div>
  )
}

export function Bills() {
  const { t, m, n, user, time, date } = useApp()
  const from = startOfDay()
  const inv = useLiveQuery(() => db.invoices.where('at').aboveOrEqual(from).toArray(), [from], [] as Invoice[])
  const { go } = useApp()
  const mine = inv.filter((i) => i.by === user?.name).sort((a, b) => b.at - a.at)
  return (
    <div className="body">
      {mine.map((i) => <button key={i.id} className="item tap" onClick={() => go('done', { id: i.id })}><div style={{ flex: 1 }}><b>{n(i.no)}</b><small>{date(i.at)} {time(i.at)}</small></div><b>{m(i.total)}</b></button>)}
      {mine.length === 0 && <div className="note">{t('आज तपाईंले बिल बनाउनुभएको छैन।', 'You have made no bills today.')}</div>}
      <div className="note">{t('आफ्नै बिल मात्र देखिन्छ। फेरि प्रिन्ट गर्न थिच्नुस्।', 'You see your own bills only. Tap one to reprint.')}</div>
    </div>
  )
}

export function Returns() {
  const { t, m, n, user, perms, toast, back, date } = useApp()
  const needOwner = perms.returns === 'approval'
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<Invoice | null>(null)
  const [done, setDone] = useState<Record<string, number>>({})
  const [sel, setSel] = useState<Record<string, number>>({})
  const [pin, setPin] = useState('')
  const recent = useLiveQuery(() => db.invoices.orderBy('at').reverse().limit(60).toArray(), [], [] as Invoice[])
  const list = recent.filter((i) => i.kind !== 'credit_note' && (!q || i.no.toLowerCase().includes(q.toLowerCase())))
  async function open(i: Invoice) { setPick(i); setSel({}); setDone(await returnedQty(i.id)) }
  const left = (itemId: string) => (pick?.lines.find((l) => l.itemId === itemId)?.qty ?? 0) - (done[itemId] || 0)
  async function go() {
    if (!pick) return
    if (needOwner) {
      const owner = (await db.users.toArray()).find((u) => u.role === 'owner')!
      if (!(await checkSecret(owner, pin))) return toast(t('मालिकको पासवर्ड मिलेन', 'Owner password is wrong'))
    }
    const rows = Object.entries(sel).filter(([, q2]) => q2 > 0).map(([itemId, qty]) => ({ itemId, qty }))
    await createReturn(pick, rows, user!.name)
    toast(t('फिर्ता भयो। स्टक र खाता मिल्यो।', 'Returned. Stock and books updated.'))
    back()
  }
  if (!pick) return (
    <div className="body">
      <input className="in" placeholder={t('बिल नम्बर खोज्नुस्', 'Search bill number')} value={q} onChange={(e) => setQ(e.target.value)} />
      {list.map((i) => <button key={i.id} className="item tap" onClick={() => open(i)}><div style={{ flex: 1 }}><b>{n(i.no)}</b><small>{date(i.at)}</small></div><b>{m(i.total)}</b></button>)}
      {list.length === 0 && <div className="note">{t('बिल भेटिएन।', 'No bills found.')}</div>}
    </div>
  )
  return (
    <div className="body">
      <div className="note">{t('बिल', 'Bill')} {n(pick.no)}</div>
      {pick.lines.map((l) => (
        <div key={l.itemId} className="item"><div style={{ flex: 1 }}><b>{t(l.name, l.nameEn)}</b><small>{t('बाँकी फिर्ता हुन सक्ने', 'Can return')}: {n(left(l.itemId))} · {m(l.rate)}</small></div>
          <div className="qty"><button disabled={!(sel[l.itemId] > 0)} onClick={() => setSel({ ...sel, [l.itemId]: sel[l.itemId] - 1 })}>−</button><b>{n(sel[l.itemId] || 0)}</b>
            <button disabled={(sel[l.itemId] || 0) >= left(l.itemId)} onClick={() => setSel({ ...sel, [l.itemId]: (sel[l.itemId] || 0) + 1 })}>+</button></div></div>))}
      {needOwner && <><div className="note">{t('मालिकको स्वीकृति चाहिन्छ। मालिकको पासवर्ड राख्नुस्।', 'Owner approval needed. Enter the owner password.')}</div>
        <PwInput className="in" value={pin} onChange={(e) => setPin(e.target.value)} /></>}
      <div className="note">{t('यसले स्टक फर्काउँछ, क्रेडिट नोट बनाउँछ, र खाता मिलाउँछ।', 'This puts stock back, creates a credit note and updates the accounts.')}</div>
      <button className="btn stick" disabled={!Object.values(sel).some((x) => x > 0) || (needOwner && !pin)} onClick={go}>{t('फिर्ता गर्नुस्', 'Process return')}</button>
    </div>
  )
}

export function Buy() {
  const { t, n, back, toast } = useApp()
  const items = useLiveQuery(() => db.items.filter((i) => i.active).toArray(), [], [] as Item[])
  const sup = useLiveQuery(() => db.parties.where('type').equals('supplier').toArray(), [], [] as Party[])
  const [supplier, setSupplier] = useState('')
  const [billNo, setBillNo] = useState('')
  const [paid, setPaid] = useState(true)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [cost, setCost] = useState<Record<string, number>>({})
  const [q, setQ] = useState('')
  const rows = items.filter((i) => !q || (i.nameNe + i.nameEn).toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.sold - a.sold)
  const lines = Object.entries(qty).filter(([, v]) => v > 0).map(([itemId, q2]) => ({ itemId, qty: q2, cost: cost[itemId] ?? items.find((i) => i.id === itemId)!.cost }))
  async function save() {
    await createPurchase({ supplierId: supplier || undefined, billNo: billNo || 'P-' + Date.now().toString().slice(-6), lines, paid })
    toast(t('स्टक थपियो', 'Stock added'))
    back()
  }
  return (
    <div className="body">
      <label className="f">{t('आपूर्तिकर्ता', 'Supplier')}<select className="in" value={supplier} onChange={(e) => setSupplier(e.target.value)}><option value="">—</option>{sup.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <input className="in" placeholder={t('आपूर्तिकर्ताको बिल नं.', 'Supplier bill no.')} value={billNo} onChange={(e) => setBillNo(e.target.value)} />
      <input className="in" placeholder={t('🔍 सामान खोज्नुस्', '🔍 Search item')} value={q} onChange={(e) => setQ(e.target.value)} />
      {rows.slice(0, 30).map((i) => (
        <div key={i.id} className="item"><div style={{ flex: 1, minWidth: 0 }}><b>{t(i.nameNe, i.nameEn)}</b><small>{t('स्टक', 'Stock')} {n(i.stock)}</small></div>
          <input className="in" style={{ width: 74 }} inputMode="decimal" placeholder={t('लागत', 'cost')} value={cost[i.id] ?? ''} onChange={(e) => setCost({ ...cost, [i.id]: +e.target.value })} />
          <div className="qty"><button onClick={() => setQty({ ...qty, [i.id]: Math.max(0, (qty[i.id] || 0) - 1) })}>−</button><b>{n(qty[i.id] || 0)}</b><button onClick={() => setQty({ ...qty, [i.id]: (qty[i.id] || 0) + 1 })}>+</button></div></div>))}
      <div className="row"><button className={'pill' + (paid ? ' on' : '')} onClick={() => setPaid(true)}>{t('तिरिसक्यो', 'Paid')}</button>
        <button className={'pill' + (!paid ? ' on' : '')} disabled={!supplier} onClick={() => setPaid(false)}>{t('उधारो', 'On credit')}</button></div>
      <button className="btn stick" disabled={!lines.length} onClick={save}>{t('स्टकमा थप्नुस्', 'Add to stock')}</button>
    </div>
  )
}

export function Orders() {
  const { t, n, toast } = useApp()
  const items = useLiveQuery(() => db.items.filter((i) => i.active && i.stock < i.minStock).toArray(), [], [] as Item[])
  const sup = useLiveQuery(() => db.parties.where('type').equals('supplier').toArray(), [], [] as Party[])
  if (!items.length) return <div className="body"><div className="note">{t('सबै सामान पुग्छ।', 'All stock is fine.')}</div></div>
  const groups = new Map<string, Item[]>()
  for (const i of items) groups.set(i.supplierId ?? '', [...(groups.get(i.supplierId ?? '') ?? []), i])
  return (
    <div className="body">
      {[...groups.entries()].map(([sid, li]) => {
        const p = sup.find((x) => x.id === sid)
        const text = t('अर्डर:\n', 'Order:\n') + li.map((i) => `- ${t(i.nameNe, i.nameEn)}: ${i.minStock * 2} ${i.unit}`).join('\n')
        return (
          <div key={sid} className="st" style={{ flex: 'none' }}>
            <b>{p?.name ?? t('आपूर्तिकर्ता तोकिएको छैन', 'No supplier set')}</b><small>{p?.phone ?? ''}</small>
            {li.map((i) => <div key={i.id} className="row" style={{ marginTop: 6 }}><div className="g">{t(i.nameNe, i.nameEn)} <span className="w">({n(i.stock)})</span></div><b>{n(i.minStock * 2)}</b></div>)}
            <div style={{ marginTop: 8 }}>{p ? <Contact phone={p.phone} name={p.name} text={text} /> : <button className="btn o s" onClick={async () => { await navigator.clipboard?.writeText(text); toast(t('कपी भयो', 'Copied')) }}>{t('सूची कपी गर्नुस्', 'Copy list')}</button>}</div>
          </div>)
      })}
    </div>
  )
}
