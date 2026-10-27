import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../ctx'
import { db, kvGet, kvSet, queue } from '../db'
import { neDigits } from '../format'
import { pdfFromCanvas } from '../pdf'
import { bytesToBase64, shareOrSave, toBlob } from '../share'
import { authed } from '../api'
import { addParty, createSale, FREE_CREDIT_LIMIT, ranked, totals } from '../logic'
import { Photo, Receipt, Scanner, useReceipt } from '../components'
import { CategoryChips, inCategory, PAGE, useCategories } from './Items'
import { btSupported, connectPrinter, printerConnected, sendBytes, toEscPos } from '../escpos'
import type { Invoice, Item, Method, Party, Payment } from '../types'

export function useCart() {
  const { cart, s, on, kind, setKind } = useApp()
  const items = useLiveQuery(() => db.items.toArray(), [], [] as Item[])
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const taxOK = on('vat') && s.vatRegistered
  const effKind: 'tax' | 'cash' = taxOK ? kind : 'cash'
  const lines = cart.flatMap((c) => {
    const it = byId.get(c.itemId)
    return it ? [{ ...c, it, rate: it.price, vat: it.vat ? 13 : 0 }] : []
  })
  const tot = totals(lines.map((l) => ({ qty: l.qty, rate: l.rate, vat: l.vat })), effKind === 'tax')
  return { items, byId, lines, tot, effKind, taxOK, setKind }
}

export function Sale() {
  const { t, n, m, cart, setCart, go, toast, on } = useApp()
  const { items, byId, lines, tot, effKind, taxOK, setKind } = useCart()
  const cats = useCategories()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [scan, setScan] = useState(false)
  const list = useMemo(() => ranked(items, q).filter((i) => (q ? true : inCategory(i, cat, cats))), [items, q, cat, cats])
  const icons = useMemo(() => new Map(cats.map((c) => [c.id, c.icon])), [cats])

  const add = (id: string) => {
    const it = byId.get(id)
    if (!it) return
    const had = cart.find((c) => c.itemId === id)?.qty ?? 0
    setCart((cur) => (cur.some((c) => c.itemId === id) ? cur.map((c) => (c.itemId === id ? { ...c, qty: c.qty + 1 } : c)) : [...cur, { itemId: id, qty: 1 }]))
    if (had + 1 > it.stock) toast(t('सावधान: स्टकमा ' + n(it.stock) + ' मात्र छ', 'Careful: only ' + it.stock + ' in stock'))
  }
  const dec = (id: string) => setCart((cur) => cur.flatMap((c) => (c.itemId === id ? (c.qty > 1 ? [{ ...c, qty: c.qty - 1 }] : []) : [c])))
  const byCode = (code: string) => {
    const it = items.find((i) => i.barcode === code && i.active)
    if (it) { add(it.id); toast('▮▮ ' + (t(it.nameNe, it.nameEn))); return true }
    toast(t('यो बारकोडको सामान भेटिएन', 'No item with this barcode'))
    return false
  }

  return (
    <div className="body">
      {/* The cart sits on top so it stays in view however long the item list is. */}
      {lines.length > 0 && (
        <div className="cart">
          <div className="cart-head"><span>🛒 {t('कार्ट', 'Cart')} · {n(lines.reduce((a2, l) => a2 + l.qty, 0))} {t('सामान', 'items')}</span><span>{m(tot.total)}</span></div>
          {lines.map((l) => (
            <div key={l.itemId} className="cart-line">
              <div className="nm">{t(l.it.nameNe, l.it.nameEn)}<small>{m(l.rate)} × {n(l.qty)}</small></div>
              <div className="qty"><button aria-label="less" onClick={() => dec(l.itemId)}>−</button><b>{n(l.qty)}</b><button aria-label="more" onClick={() => add(l.itemId)}>+</button></div>
              <div className="amt">{m(l.qty * l.rate)}</div>
            </div>
          ))}
          {taxOK && <div className="row" style={{ marginTop: 8 }}><span className="mut">{t('बिलको प्रकार', 'Bill type')}</span>
            <button className={'pill' + (effKind === 'tax' ? ' on' : '')} onClick={() => setKind('tax')}>{t('कर बीजक', 'Tax invoice')}</button>
            <button className={'pill' + (effKind === 'cash' ? ' on' : '')} onClick={() => setKind('cash')}>{t('नगद भरपाई', 'Cash receipt')}</button></div>}
          {effKind === 'tax' && <div className="tot" style={{ marginTop: 8, fontSize: 15 }}><span>{t('उप-जम्मा', 'Subtotal')} {m(tot.subtotal)}</span><span>{t('भ्याट (१३%)', 'VAT (13%)')} {m(tot.vat)}</span></div>}
          <div className="cart-total"><span>{t('कुल', 'Total')}</span><span>{m(tot.total)}</span></div>
        </div>
      )}
      <div className="row">
        <input className="in g" value={q} placeholder={t('🔍 सामान खोज्नुस् (नेपाली वा English)', '🔍 Search item (Nepali or English)')}
          onChange={(e) => { setQ(e.target.value); setLimit(PAGE) }}
          onKeyDown={(e) => { if (e.key === 'Enter' && q && byCode(q.trim())) setQ('') }} />
        {on('barcode') && <button className="btn s" onClick={() => setScan(!scan)}>▮▮ {t('स्क्यान', 'Scan')}</button>}
      </div>
      {scan && <Scanner onClose={() => setScan(false)} onCode={(c) => { byCode(c); setScan(false) }} />}
      <CategoryChips cats={cats} items={items} value={q ? '' : cat} onChange={(v) => { setCat(v); setQ(''); setLimit(PAGE) }} />
      <div className="mut" style={{ fontSize: 13 }}>{q ? t('मिल्ने सामान, धेरै बिक्री भएको पहिले', 'Matches, best sellers first') : t('🔥 धेरै बिक्री हुने सामान माथि', '🔥 Best sellers on top')}</div>
      <div className="grid2">
        {list.length === 0 && <div className="note" style={{ gridColumn: '1/-1' }}>{t('यो नामको सामान भेटिएन।', 'No item found.')}</div>}
        {list.slice(0, limit).map((i) => (
          <button key={i.id} className="card" onClick={() => add(i.id)}>
            <Photo src={i.photo} icon={i.categoryId ? icons.get(i.categoryId) : undefined} />
            <b>{t(i.nameNe, i.nameEn)}</b>
            <small>{m(i.price)} · {t('स्टक', 'stock')} {n(i.stock)}</small>
            <small>{i.sold >= 100 ? '🔥 ' : ''}{t('बिक्री', 'sold')} {n(i.sold)}</small>
          </button>
        ))}
      </div>
      {list.length > limit && <button className="btn o" onClick={() => setLimit(limit + PAGE)}>{t('थप देखाउनुस् (' + n(list.length - limit) + ' बाँकी)', 'Show more (' + (list.length - limit) + ' left)')}</button>}
      {lines.length > 0 && <button className="btn stick" onClick={() => go('pay')}>{t('भुक्तानी →', 'Pay →')} {m(tot.total)}</button>}
    </div>
  )
}

export function Pay() {
  const { t, m, setCart, cart, go, toast, on, user, can, online, plan, cloud, s, perms } = useApp()
  const { lines, tot, effKind } = useCart()
  const parties = useLiveQuery(() => db.parties.where('type').equals('customer').toArray(), [], [] as Party[])
  const [method, setMethod] = useState<Method>('cash')
  const [recvStr, setRecvStr] = useState('')
  const [restOnCredit, setRestOnCredit] = useState(false)
  const [party, setParty] = useState('')
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [staticOk, setStaticOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cfg, setCfg] = useState<any>(null)
  const [pick, setPick] = useState('')
  const [qr, setQr] = useState<{ id: string; img: string; exp: number; status: string; ref?: string } | null>(null)
  const [qrBusy, setQrBusy] = useState(false)
  const canCredit = on('credit') && perms.credit
  const methods: [Method, string][] = [['cash', t('नगद', 'Cash')], ...(on('qr') ? [['qr', 'QR'] as [Method, string]] : []), ['card', t('कार्ड', 'Card')], ...(canCredit ? [['credit', t('उधारो', 'Credit')] as [Method, string]] : [])]

  // What the customer handed over is typed in, so the change is worked out for any amount (bill 430, customer gives 450, change 20).
  const recv = Math.max(0, parseFloat(recvStr) || 0)
  const change = Math.max(0, Math.round((recv - tot.total) * 100) / 100)
  const short = Math.max(0, Math.round((tot.total - recv) * 100) / 100)
  const quick = useMemo(() => {
    const set = new Set<number>([tot.total])
    for (const step of [10, 50, 100, 500, 1000]) set.add(Math.ceil(tot.total / step) * step)
    return [...set].filter((v) => v >= tot.total).sort((a, b) => a - b).slice(0, 5)
  }, [tot.total])

  /* Exact-amount QR needs the internet, a cloud account, the Pro plan and the shop's own merchant keys. Otherwise the shop's own QR picture is used. */
  const dynOk = !!cloud && online && can('dynqr')
  useEffect(() => {
    if (method !== 'qr') return
    if (!dynOk) { kvGet('payCfg', null).then(setCfg); return }
    authed('/pay/config').then((r) => { setCfg(r.providers); kvSet('payCfg', r.providers) }).catch(() => kvGet('payCfg', null).then(setCfg))
  }, [method, dynOk])
  const provs: string[] = [
    ...(dynOk && cfg?.khalti?.set ? ['khalti'] : []), ...(dynOk && cfg?.esewa?.set ? ['esewa'] : []), ...(dynOk && cfg?.mock?.set ? ['mock'] : []),
    ...(s.staticQr ? ['static'] : []),
  ]
  const chosen = pick && provs.includes(pick) ? pick : provs[0] ?? ''
  const provName = (p: string) => ({ khalti: 'Khalti', esewa: 'eSewa', mock: t('परीक्षण', 'Test'), static: t('मेरो QR', 'My QR') } as Record<string, string>)[p]

  useEffect(() => {
    if (!qr || qr.status !== 'pending') return
    const iv = setInterval(async () => {
      try {
        const r = await authed('/pay/status/' + qr.id)
        if (r.status !== 'pending') { setQr((q) => (q ? { ...q, status: r.status, ref: r.providerRef ?? undefined } : q)); if (r.status === 'paid') navigator.vibrate?.(120) }
      } catch { /* offline for a moment: keep waiting */ }
    }, 3000)
    return () => clearInterval(iv)
  }, [qr])

  async function makeQr() {
    setQrBusy(true)
    try {
      const r = await authed('/pay/create', 'POST', { provider: chosen, amount: tot.total, ref: 'POS' })
      const img = await QRCode.toDataURL(r.qrText, { margin: 1, width: 300, errorCorrectionLevel: 'M' })
      setQr({ id: r.id, img, exp: r.expiresAt, status: 'pending' })
    } catch (e: any) {
      toast(e.code === 'min_amount' ? t('Khalti मा रु १० भन्दा कम चल्दैन', 'Khalti needs at least Rs 10')
        : e.code === 'provider' ? t('भुक्तानी सेवाले अस्वीकार गर्‍यो। सेटअपमा कुञ्जी जाँच गर्नुस्।', 'The payment service refused. Check the keys in QR setup.')
        : e.code === 'not_configured' ? t('QR सेटअप गरिएको छैन', 'QR is not set up')
        : t('QR बन्न सकेन। इन्टरनेट जाँच्नुस्।', 'Could not make the QR. Check the internet.'))
    }
    setQrBusy(false)
  }

  async function addCustomer() {
    if (!newName.trim()) return
    if (plan === 'free' && parties.length >= FREE_CREDIT_LIMIT) { toast(t('फ्री प्लानमा १० ग्राहकसम्म', 'Free plan allows 10 customers')); go('upgrade', { f: 'books' }); return }
    const p = await addParty('customer', newName.trim(), undefined, newEmail.trim() || undefined)
    setParty(p.id); setNewName(''); setNewEmail('')
  }
  const dynamic = method === 'qr' && !!chosen && chosen !== 'static'
  const partCredit = method === 'cash' && short > 0 && restOnCredit
  const ready = method === 'cash' ? (recv >= tot.total || (partCredit && !!party)) : method === 'credit' ? !!party : method === 'qr' ? (dynamic ? qr?.status === 'paid' : chosen === 'static' ? staticOk : false) : true
  async function finish() {
    setBusy(true)
    const verified = method === 'cash' || method === 'credit' || dynamic
    let payments: Payment[]
    let received: number | undefined
    let chg: number | undefined
    if (method === 'cash') {
      received = recv > 0 ? recv : undefined
      if (partCredit) {
        // The customer pays part now; the rest becomes baki on their khata.
        payments = [...(recv > 0 ? [{ method: 'cash' as const, amount: recv, verified: true }] : []), { method: 'credit' as const, amount: short, verified: true }]
        chg = 0
      } else { payments = [{ method: 'cash', amount: tot.total, verified: true }]; chg = change }
    } else payments = [{ method, amount: tot.total, verified, ...(dynamic ? { provider: chosen, providerRef: qr?.ref } : method === 'qr' ? { provider: 'static' } : {}) }]
    const inv = await createSale({
      cart, kind: effKind, partyId: method === 'credit' || partCredit ? party : undefined, by: user!.name, payments, received, change: chg,
    })
    setCart([])
    setBusy(false)
    go('done', { id: inv.id })
  }
  if (!lines.length) return <div className="body"><div className="note">{t('कार्ट खाली छ।', 'Cart is empty.')}</div><button className="btn" onClick={() => go('sale')}>{t('बिक्रीमा जानुस्', 'Back to sale')}</button></div>
  const minsLeft = qr ? Math.max(0, Math.ceil((qr.exp - Date.now()) / 60000)) : 0
  const picker = (
    <>
      <div className="h">{t('ग्राहक छान्नुस्', 'Pick customer')}</div>
      {parties.map((p) => <button key={p.id} className="item tap" style={party === p.id ? { borderColor: 'var(--acc)', borderWidth: 2 } : undefined} onClick={() => setParty(p.id)}>
        <div style={{ flex: 1 }}><b>{p.name}</b><small>{t('बाँकी', 'Due')} {m(p.balance)}</small></div>{party === p.id && '✔'}</button>)}
      <div className="row"><input className="in g" placeholder={t('नयाँ ग्राहकको नाम', 'New customer name')} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn s" onClick={addCustomer}>+</button></div>
      <input className="in" type="email" placeholder={t('इमेल (ऐच्छिक, बिल पठाउन)', 'Email (optional, to send bills)')} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
    </>
  )
  return (
    <div className="body">
      <div style={{ textAlign: 'center' }}><div className="mut">{t('कुल रकम', 'Amount due')}</div><div style={{ fontSize: 34, fontWeight: 700 }}>{m(tot.total)}</div></div>
      <div className="row wrap">{methods.map(([k, label]) => <button key={k} className={'pill' + (method === k ? ' on' : '')} onClick={() => { setMethod(k); setStaticOk(false); setQr(null) }}>{label}</button>)}</div>
      {method === 'cash' && (<>
        <label className="f">{t('ग्राहकले दिएको रकम (रु)', 'Amount the customer gave (Rs)')}
          <input className="in" style={{ fontSize: 22, fontWeight: 700, textAlign: 'center' }} inputMode="decimal" autoFocus value={recvStr} placeholder={String(tot.total)} onChange={(e) => setRecvStr(e.target.value.replace(/[^\d.]/g, ''))} /></label>
        <div className="row wrap">{quick.map((v) => <button key={v} className={'pill' + (recv === v ? ' on' : '')} onClick={() => setRecvStr(String(v))}>{v === tot.total ? t('ठ्याक्कै', 'Exact') + ' ' : ''}{m(v)}</button>)}</div>
        {recv > 0 && recv >= tot.total && <div className="tot b" style={{ fontSize: 22 }}><span>{t('फिर्ता दिनुपर्ने', 'Give back')}</span><span className="okc">{m(change)}</span></div>}
        {recv > 0 && recv < tot.total && <div className="tot b"><span>{t('अझै चाहिन्छ', 'Still to pay')}</span><span className="w">{m(short)}</span></div>}
        {short > 0 && canCredit && (<>
          <div className="toggle"><span>{t('बाँकी रकम उधारो (बाँकी खाता) मा राख्नुस्', 'Put the rest on credit (baki)')}<small className="mut" style={{ display: 'block' }}>{t('ग्राहकको खातामा ' + m(short) + ' बाँकी लेखिन्छ', m(short) + ' goes on the customer account')}</small></span>
            <button className={'sw' + (restOnCredit ? ' on' : '')} aria-label="credit the rest" aria-pressed={restOnCredit} onClick={() => setRestOnCredit(!restOnCredit)} /></div>
          {restOnCredit && picker}
        </>)}
      </>)}
      {method === 'qr' && (<>
        {provs.length === 0 && <div className="note w">{t('QR सेटअप गरिएको छैन। सेटिङ → QR भुक्तानी सेटअपमा आफ्नो QR राख्नुस्।', 'QR is not set up. Add your QR in Settings → QR payment setup.')}
          <div style={{ marginTop: 8 }}><button className="btn o s" onClick={() => go('payconf')}>{t('सेटअप खोल्नुस्', 'Open setup')}</button></div></div>}
        {provs.length > 1 && <div className="row wrap">{provs.map((p) => <button key={p} className={'pill' + (chosen === p ? ' on' : '')} onClick={() => { setPick(p); setQr(null) }}>{provName(p)}</button>)}</div>}
        {dynamic && !qr && <>
          <div className="note">{t('ठ्याक्कै ' + m(tot.total) + ' को QR बन्छ। ग्राहकले फोनको क्यामेराले स्क्यान गरेर खुल्ने पेजमा तिर्छ। भुक्तानी आफैँ पुष्टि हुन्छ।', 'This makes a QR for exactly ' + m(tot.total) + '. The customer scans it with the phone camera and pays on the page that opens. Payment confirms by itself.')}</div>
          <button className="btn" disabled={qrBusy} onClick={makeQr}>{qrBusy ? '…' : t('QR बनाउनुस्', 'Make QR')}</button></>}
        {dynamic && qr && (<>
          <div className="receipt" style={{ padding: 12 }}><img src={qr.img} alt="QR" style={{ width: 240, maxWidth: '100%' }} /></div>
          <div style={{ textAlign: 'center', fontWeight: 700 }} className={qr.status === 'paid' ? 'okc' : qr.status === 'pending' ? '' : 'w'}>
            {qr.status === 'pending' && t('ग्राहकको भुक्तानी कुरिँदै… (' + minsLeft + ' मिनेट बाँकी)', 'Waiting for the customer… (' + minsLeft + ' min left)')}
            {qr.status === 'paid' && '✔ ' + t('भुक्तानी प्राप्त भयो', 'Payment received')}
            {(qr.status === 'expired' || qr.status === 'failed') && t('QR सकियो वा भुक्तानी भएन', 'QR expired or payment failed')}
          </div>
          {qr.status !== 'paid' && <button className="btn o" onClick={() => { setQr(null) }}>{qr.status === 'pending' ? t('रद्द गरेर नयाँ QR', 'Cancel and make a new QR') : t('नयाँ QR बनाउनुस्', 'Make a new QR')}</button>}
        </>)}
        {chosen === 'static' && (<>
          <div className="receipt" style={{ padding: 12 }}><img src={s.staticQr} alt="QR" style={{ width: 260, maxWidth: '100%' }} /></div>
          <div className="note">{t('ग्राहकले यो QR स्क्यान गरेर ' + m(tot.total) + ' आफैँ हाल्नुपर्छ। आफ्नो फोनमा रकम आएको देखेपछि तल थिच्नुस्। बिल "अप्रमाणित" रहन्छ।', 'The customer scans this and types ' + m(tot.total) + ' themselves. Check the money on your own phone, then tap below. The bill stays "unverified".')}</div>
          <button className={'btn ' + (staticOk ? '' : 'o')} onClick={() => setStaticOk(true)}>{staticOk ? '✔ ' : ''}{t('भुक्तानी प्राप्त भयो', 'Payment received')}</button></>)}
      </>)}
      {method === 'card' && <div className="note">{t('कार्ड मेसिनमा तिरेपछि बिल बनाउनुस्। एपले कार्ड नम्बर राख्दैन।', 'Charge on the card machine, then create the bill. The app never stores card numbers.')}</div>}
      {method === 'credit' && picker}
      <button className="btn stick" disabled={!ready || busy} onClick={finish}>{method === 'qr' && chosen === 'static' ? t('बिल बनाउनुस् (अप्रमाणित QR)', 'Create bill (unverified QR)') : t('बिल बनाउनुस्', 'Create bill')}</button>
    </div>
  )
}

export function Done({ id }: { id: string }) {
  const inv = useLiveQuery(() => db.invoices.get(id), [id])
  if (!inv) return <div className="body" />
  return <DoneBody inv={inv} />
}

function DoneBody({ inv }: { inv: Invoice }) {
  const { t, s, save, go, toast, online, on, can, cloud } = useApp()
  const paper = s.paper
  const { canvas } = useReceipt(inv)
  const party = useLiveQuery(() => (inv.partyId ? db.parties.get(inv.partyId) : undefined), [inv.partyId])
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState('')
  useEffect(() => { if (party?.email && !email) setEmail(party.email) }, [party]) // eslint-disable-line react-hooks/exhaustive-deps
  const shareOn = on('share')
  const emailValid = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email.trim())
  const emailReady = !!cloud && online && can('emailbill')

  const pdf = () => toBlob(pdfFromCanvas(canvas, paper === 'a4'), 'application/pdf')
  async function print() {
    if (paper === 'a4' || !btSupported()) { window.print(); return }
    setBusy(true)
    try {
      if (!printerConnected()) { const nm = await connectPrinter(); toast(t('जोडियो: ', 'Connected: ') + nm) }
      await sendBytes(toEscPos(canvas))
      toast(t('प्रिन्टरमा पठाइयो', 'Sent to printer'))
    } catch (e: any) {
      toast(e?.name === 'NotFoundError' ? t('प्रिन्टर छानिएन', 'No printer selected') : t('प्रिन्ट भएन। PDF वा शेयर प्रयोग गर्नुस्।', 'Could not print. Use PDF or Share.'))
    }
    setBusy(false)
  }
  async function savePdf() {
    const r = await shareOrSave(pdf(), inv.no + '.pdf', inv.no)
    if (r === 'saved') toast(t('PDF सेभ भयो', 'PDF saved'))
  }
  async function shareImage() {
    canvas.toBlob(async (b) => { if (b) { const r = await shareOrSave(b, inv.no + '.png', inv.no); if (r === 'saved') toast(t('फोटो सेभ भयो', 'Picture saved')) } })
  }
  async function sendEmail() {
    setSending(true); setSent('')
    try {
      await authed('/send/email', 'POST', { to: email.trim(), kind: 'receipt', filename: inv.no + '.pdf', data: bytesToBase64(pdfFromCanvas(canvas, paper === 'a4')), billNo: inv.no })
      setSent(email.trim())
      toast(t('इमेल पठाइयो', 'Email sent'))
      if (party && !party.email) { await db.parties.update(party.id, { email: email.trim(), updatedAt: Date.now() }); await queue('parties', party.id) }
    } catch (e: any) {
      toast(e.code === 'plan' ? t('इमेल पठाउन प्रो प्लान चाहिन्छ', 'Emailing bills needs the Pro plan')
        : e.code === 'limit' ? t('आजको इमेल सीमा सकियो', 'Today\'s email limit is used up')
        : e.code === 'mail' ? t('इमेल सेवा अझै तयार छैन', 'The email service is not ready yet')
        : t('इमेल जान सकेन। इन्टरनेट जाँच्नुस्।', 'Could not send. Check the internet.'))
    }
    setSending(false)
  }
  return (
    <div className="body">
      <div className={'note' + (online ? '' : ' w')}>{online ? '✔ ' + t('सेभ भयो।', 'Saved.') : '⏳ ' + t('अफलाइन सेभ भयो। इन्टरनेट आएपछि आफैँ सिंक हुन्छ।', 'Saved offline. It will sync when internet returns.')}</div>
      {inv.change != null && inv.change > 0 && <div className="st" style={{ flex: 'none', textAlign: 'center' }}><small>{t('फिर्ता दिनुहोस्', 'Give back')}</small><b className="okc" style={{ fontSize: 28 }}>{moneyFmt(inv.change, s.lang)}</b></div>}
      {inv.partyBalance != null && inv.partyBalance > 0 && <div className="note w">{t(inv.partyName + ' को जम्मा बाँकी: ', inv.partyName + ' now owes: ')}<b>{moneyFmt(inv.partyBalance, s.lang)}</b></div>}
      <div className="row wrap"><span className="mut">{t('कागज', 'Paper')}</span>{(['58', '80', 'a4'] as const).map((p) => <button key={p} className={'pill' + (paper === p ? ' on' : '')} onClick={() => save({ paper: p })}>{p === 'a4' ? 'A4/A5' : p + 'mm'}</button>)}</div>
      <Receipt inv={inv} />
      <button className="btn" disabled={busy} onClick={print}>🖨 {t('प्रिन्ट गर्नुस्', 'Print')}</button>
      {!btSupported() && <div className="note">{t('यो ब्राउजरले ब्लुटुथ प्रिन्टर जोड्दैन (iPhone मा यस्तै हुन्छ)। PDF वा शेयर प्रयोग गर्नुस्।', 'This browser cannot connect Bluetooth printers (common on iPhone). Use PDF or Share.')}</div>}
      {shareOn && (<>
        <div className="row"><button className="btn o g" onClick={savePdf}>📄 {t('PDF', 'PDF')}</button><button className="btn o g" onClick={shareImage}>↗ {t('फोटो शेयर', 'Share picture')}</button></div>
        <div className="h">✉ {t('इमेलबाट पठाउनुस्', 'Send by email')}</div>
        <input className="in" type="email" inputMode="email" autoComplete="off" placeholder={t('ग्राहकको इमेल', "Customer's email")} value={email} onChange={(e) => { setEmail(e.target.value); setSent('') }} />
        <button className="btn" disabled={!emailValid || !emailReady || sending} onClick={sendEmail}>{sending ? '…' : sent ? '✔ ' + t('पठाइयो: ', 'Sent to ') + sent : t('इमेल पठाउनुस्', 'Send email')}</button>
        {!emailReady && <div className="note">{!cloud ? t('इमेल पठाउन क्लाउड खाता जोड्नुस् (थप → क्लाउड खाता)।', 'To email bills, connect the cloud account (More → Cloud account).')
          : !online ? t('इमेल पठाउन इन्टरनेट चाहिन्छ। PDF वा शेयर अहिले पनि चल्छ।', 'Email needs internet. PDF and Share work now.')
          : t('इमेल पठाउन प्रो प्लान चाहिन्छ। PDF र शेयर सबै प्लानमा चल्छ।', 'Emailing bills needs the Pro plan. PDF and Share work on every plan.')}</div>}
      </>)}
      <button className="btn o" onClick={() => go('sale')}>{t('नयाँ बिक्री', 'New sale')}</button>
    </div>
  )
}

const moneyFmt = (x: number, lang: 'ne' | 'en') => {
  const str = (Math.round(x * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })
  return lang === 'ne' ? 'रु ' + neDigits(str) : 'Rs ' + str
}
