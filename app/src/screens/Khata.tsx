import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../ctx'
import { db } from '../db'
import { addParty, FREE_CREDIT_LIMIT, receivePayment } from '../logic'
import type { LedgerRow, Party } from '../types'

export function Contact({ phone, name, text, email }: { phone?: string; name: string; text?: string; email?: string }) {
  const { t, toast, online } = useApp()
  const p = (phone || '').replace(/\D/g, '')
  const body = encodeURIComponent(text || '')
  const open = (url: string) => { if (!p && !url.startsWith('mailto')) { toast(t('फोन नम्बर थप्नुहोस्', 'Add a phone number first')); return } window.open(url, '_blank', 'noopener,noreferrer') }
  return (
    <div className="row wrap">
      <button className="btn o s" onClick={() => open('tel:' + p)}>📞 {t('फोन', 'Call')}</button>
      <button className="btn o s" onClick={() => open('https://wa.me/' + (p.length === 10 ? '977' + p : p) + '?text=' + body)}>WhatsApp</button>
      <button className="btn o s" onClick={() => open('https://m.me/?text=' + body)}>Messenger</button>
      <button className="btn o s" onClick={() => open('mailto:' + encodeURIComponent(email ?? '') + '?subject=' + encodeURIComponent(name) + '&body=' + body)}>Email</button>
      {!online && <span className="mut" style={{ fontSize: 12 }}>{t('इन्टरनेट चाहिन्छ', 'needs internet')}</span>}
    </div>
  )
}

export function Parties() {
  const { t, m, go, on, plan, toast } = useApp()
  const [tab, setTab] = useState<'customer' | 'supplier'>('customer')
  const list = useLiveQuery(() => db.parties.where('type').equals(tab).toArray(), [tab], [] as Party[])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const add = async () => {
    if (!name.trim()) return
    if (tab === 'customer' && plan === 'free' && list.length >= FREE_CREDIT_LIMIT) { toast(t('फ्री प्लानमा १० ग्राहकसम्म', 'Free plan allows 10 customers')); go('upgrade', { f: 'books' }); return }
    await addParty(tab, name.trim(), phone, email.trim())
    setName(''); setPhone(''); setEmail('')
  }
  return (
    <div className="body">
      <div className="tabs"><button className={'pill' + (tab === 'customer' ? ' on' : '')} onClick={() => setTab('customer')}>{t('ग्राहक', 'Customers')}</button>
        {on('purch') && <button className={'pill' + (tab === 'supplier' ? ' on' : '')} onClick={() => setTab('supplier')}>{t('आपूर्तिकर्ता', 'Suppliers')}</button>}</div>
      {tab === 'customer' && !on('credit') && <div className="note">{t('उधारो मोड्युल बन्द छ। ग्राहक खाता लुकेको छ।', 'Credit module is off. Customer accounts are hidden.')}</div>}
      <div className="st" style={{ flex: 'none' }}><small>{tab === 'customer' ? t('जम्मा तिर्न बाँकी (ग्राहक)', 'Total owed to you') : t('जम्मा तिर्नुपर्ने (आपूर्तिकर्ता)', 'Total you owe')}</small><b>{m(list.reduce((a, p) => a + p.balance, 0))}</b></div>
      {list.length === 0 && <div className="note">{t('कोही छैन। तल थप्नुस्।', 'No one yet. Add below.')}</div>}
      {list.map((p) => <button key={p.id} className="item tap" onClick={() => go('ledger', { id: p.id })}><div style={{ flex: 1 }}><b>{p.name}</b><small>{p.phone || ''}</small></div><b className={p.balance > 0 ? 'w' : ''}>{m(p.balance)}</b></button>)}
      <div className="h">{t('नयाँ थप्नुस्', 'Add new')}</div>
      <input className="in" placeholder={t('नाम', 'Name')} value={name} onChange={(e) => setName(e.target.value)} />
      <input className="in" inputMode="tel" placeholder={t('फोन नम्बर', 'Phone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
      <input className="in" type="email" placeholder={t('इमेल (ऐच्छिक)', 'Email (optional)')} value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="btn" disabled={!name.trim()} onClick={add}>+ {t('थप्नुस्', 'Add')}</button>
    </div>
  )
}

export function Ledger({ id }: { id: string }) {
  const { t, m, date, toast } = useApp()
  const p = useLiveQuery(() => db.parties.get(id), [id])
  const rows = useLiveQuery(() => db.ledger.where('partyId').equals(id).sortBy('at'), [id], [] as LedgerRow[])
  const [amt, setAmt] = useState('')
  if (!p) return <div className="body" />
  const isCust = p.type === 'customer'
  async function pay() {
    const a = +amt
    if (!a || a <= 0) return
    await receivePayment(id, a, isCust ? t('नगद प्राप्त', 'Cash received') : t('भुक्तानी दिइयो', 'Paid'))
    setAmt('')
    toast(t('हिसाब मिलाइयो', 'Account updated'))
  }
  return (
    <div className="body">
      <div className="st" style={{ textAlign: 'center', flex: 'none' }}><small>{p.name} · {isCust ? t('तिर्न बाँकी', 'Balance due') : t('तिर्नुपर्ने', 'We owe')}</small><b className="w" style={{ fontSize: 28 }}>{m(p.balance)}</b></div>
      <table><thead><tr><th>{t('मिति', 'Date')}</th><th>{t('विवरण', 'Detail')}</th><th className="n">{t('डेबिट', 'Dr')}</th><th className="n">{t('क्रेडिट', 'Cr')}</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{date(r.at)}</td><td>{r.desc}</td><td className="n">{r.dr ? m(r.dr) : ''}</td><td className="n">{r.cr ? m(r.cr) : ''}</td></tr>)}</tbody></table>
      {rows.length === 0 && <div className="mut">{t('अहिलेसम्म कारोबार छैन।', 'No entries yet.')}</div>}
      <div className="row"><input className="in g" inputMode="decimal" placeholder={t('रकम', 'Amount')} value={amt} onChange={(e) => setAmt(e.target.value)} />
        <button className="btn s" disabled={!+amt} onClick={pay}>{isCust ? t('पैसा लियो', 'Received') : t('पैसा दियो', 'Paid')}</button></div>
      {isCust && <Contact phone={p.phone} email={p.email} name={p.name} text={t(p.name + ' जी, तपाईंको ' + m(p.balance) + ' बाँकी छ। धन्यवाद।', 'Dear ' + p.name + ', ' + m(p.balance) + ' is due. Thank you.')} />}
    </div>
  )
}
