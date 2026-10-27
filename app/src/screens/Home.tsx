import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../ctx'
import { db } from '../db'
import { startOfDay } from '../format'
import { PLANREQ } from '../logic'
import type { Invoice, Item } from '../types'

export function Home() {
  const { t, m, n, go, own, on, s, user, trialDays, plan, pending, cloud, perms, date } = useApp()
  const today = startOfDay()
  const inv = useLiveQuery(() => db.invoices.where('at').aboveOrEqual(today).toArray(), [today], [] as Invoice[])
  const items = useLiveQuery(() => db.items.toArray(), [], [] as Item[])
  const parties = useLiveQuery(() => db.parties.where('type').equals('customer').toArray(), [], [])
  const mine = own || perms.books ? inv : inv.filter((i) => i.by === user?.name)
  const sales = mine.filter((i) => i.kind !== 'credit_note').reduce((a, i) => a + i.total, 0) - mine.filter((i) => i.kind === 'credit_note').reduce((a, i) => a + i.total, 0)
  const cash = mine.flatMap((i) => i.payments.map((p) => ({ ...p, sign: i.kind === 'credit_note' ? -1 : 1 }))).filter((p) => p.method === 'cash').reduce((a, p) => a + p.sign * p.amount, 0)
  const profit = inv.filter((i) => i.kind !== 'credit_note').reduce((a, i) => a + i.lines.reduce((s2, l) => s2 + l.qty * (l.rate - (items.find((x) => x.id === l.itemId)?.cost ?? l.rate)), 0), 0)
  const due = parties.reduce((a, p) => a + p.balance, 0)
  const low = items.filter((i) => i.active && i.stock < i.minStock)
  const lockedTile = (k: string) => PLANREQ[k] && plan === 'free'

  const closure = useLiveQuery(() => db.kv.get('closure'), [])?.v as { status: string; type: string; scheduledAt?: number } | null | undefined
  const closing = own && closure && (closure.status === 'pending' || closure.status === 'approved') && (
    <div className="note w" onClick={() => go('closeacct')} style={{ cursor: 'pointer' }}>🚪 {closure.status === 'approved' && closure.type === 'delete_account' && closure.scheduledAt ? t('खाता ' + date(closure.scheduledAt) + ' मा मेटिन्छ। रद्द गर्न थिच्नुस्।', 'Your account will be erased on ' + date(closure.scheduledAt) + '. Tap to cancel.') : t('खाता बन्द गर्ने अनुरोध जाँचिँदैछ। हेर्न थिच्नुस्।', 'Your closing request is being reviewed. Tap to see.')}</div>
  )
  const noCloud = own && !cloud && (
    <div className="note w" onClick={() => go('cloud')} style={{ cursor: 'pointer' }}>☁ {t('डाटा यही फोनमा मात्र छ। फोन हरायो भने जान्छ। क्लाउड जोड्न थिच्नुस्।', 'Your data is on this phone only and is lost if the phone is lost. Tap to connect the cloud.')}</div>
  )
  const trial = trialDays > 0 && own && (
    <div className="note" onClick={() => go('plans')} style={{ cursor: 'pointer' }}>💎 {t('म्याक्स प्लान निःशुल्क परीक्षण: ' + n(trialDays) + ' दिन बाँकी', 'Free Max trial: ' + trialDays + ' days left')}</div>
  )
  const lowNote = low.length > 0 && on('alerts') && (
    <div className="note w" onClick={() => perms.orders && on('orders') && go('orders')} style={{ cursor: perms.orders ? 'pointer' : undefined }}>⚠ {t(n(low.length) + ' सामान सकिँदै छ: ', 'Running low: ')}{low.slice(0, 3).map((i) => t(i.nameNe, i.nameEn)).join(', ')}</div>
  )

  if (s.simple) return (
    <div className="body">
      <div className="hero">{t('नमस्ते, ' + (user?.name ?? '') + ' 🙏', 'Namaste, ' + (user?.name ?? '') + ' 🙏')}</div>
      <div className="st" style={{ flex: 'none' }}><small>{t('आजको बिक्री', 'Today sales')}</small><b style={{ fontSize: 28 }}>{m(sales)}</b></div>
      {perms.sell && <button className="bigb" onClick={() => go('sale')}><span>🛒</span>{t('बेच्नुस्', 'Sell')}<small>{t('नयाँ बिल बनाउनुस्', 'Make a new bill')}</small></button>}
      <div className="tiles" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button className="tile l" onClick={() => go('items')}><span>📦</span>{t('सामान', 'Items')}</button>
        {perms.credit && on('credit') && <button className="tile l" onClick={() => go('parties')}><span>📒</span>{t('उधारो', 'Credit')}</button>}
        <button className="tile l" onClick={() => go(own || perms.books ? 'books' : 'bills')}><span>📊</span>{t('आजको हिसाब', 'Today')}</button>
        <button className="tile l" onClick={() => go('more')}><span>➕</span>{t('अरू', 'More')}</button>
      </div>
      {lowNote}{closing}{noCloud}{trial}
    </div>
  )
  return (
    <div className="body">
      <div className="row"><div className="st"><small>{t('आजको बिक्री', 'Today sales')}</small><b>{m(sales)}</b></div>
        {perms.viewCost ? <div className="st"><small>{t('नाफा', 'Profit')}</small><b>{m(profit)}</b></div> : <div className="st"><small>{t('मेरो नगद', 'My cash')}</small><b>{m(cash)}</b></div>}</div>
      {own && <div className="row">{on('credit') && <div className="st"><small>{t('उधारो बाँकी', 'Credit due')}</small><b>{m(due)}</b></div>}
        <div className="st"><small>{t('सिंक', 'Sync')}</small><b>{pending ? n(pending) + t(' बाँकी', ' pending') : t('पूरा', 'Done')}</b></div></div>}
      {perms.sell && <button className="btn" onClick={() => go('sale')}>+ {t('नयाँ बिक्री', 'New sale')}</button>}
      <div className="tiles">
        {perms.purchase && on('purch') && <button className="tile" onClick={() => go('buy')}><span>📥</span>{t('खरिद', 'Purchase')}</button>}
        {on('returns') && perms.returns !== 'off' && <button className="tile" onClick={() => go('returns')}><span>↩</span>{t('फिर्ता', 'Return')}</button>}
        {perms.orders && on('orders') && <button className="tile" onClick={() => go('orders')}><span>📋</span>{t('अर्डर', 'Order')}</button>}
        {perms.credit && on('credit') && <button className="tile" onClick={() => go('parties')}><span>👥</span>{t('उधारो', 'Credit')}</button>}
        {perms.cctv && on('cctv') && <button className="tile" onClick={() => go('cctv')}><span>📹</span>CCTV</button>}
        {own && lockedTile('purch') && <button className="tile" onClick={() => go('plans')}><span>🔒</span>{t('प्लान', 'Plan')}</button>}
      </div>
      {lowNote}{noCloud}{trial}
    </div>
  )
}
