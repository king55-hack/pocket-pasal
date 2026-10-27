import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../ctx'
import { db, kvGet, kvSet, queue } from '../db'
import { authed } from '../api'
import { makeBackup, restoreBackup } from '../backup'
import { saveFile } from '../share'
import { createUser, PLANREQ, setPerms, setSecret, STAFF_LIMIT } from '../logic'
import { PwInput, ShopFields, Toggle } from '../components'
import { btSupported, connectPrinter } from '../escpos'
import { DEFAULT_PERMS, type Perms, type Plan, type User } from '../types'

const PN = (t: (a: string, b: string) => string): Record<Plan, string> => ({ free: t('फ्री', 'Free'), pro: t('प्रो', 'Pro'), max: t('म्याक्स', 'Max') })
const FEAT = (t: (a: string, b: string) => string): Record<string, string> => ({
  vat: t('कर बीजक (VAT)', 'VAT tax invoice'), purch: t('खरिद र आपूर्तिकर्ता', 'Purchases and suppliers'), returns: t('फिर्ता', 'Returns'),
  orders: t('अर्डर सूची', 'Order list'), staff: t('कर्मचारी खाता', 'Staff accounts'), dynqr: t('डाइनामिक QR', 'Dynamic QR'),
  books: t('पूरा सुविधा (असीमित सामान, पूरा खाता)', 'Full books and unlimited items'), export: t('PDF / Excel निकाल्ने', 'PDF / Excel export'),
  cctv: t('क्यामेरा (CCTV)', 'CCTV'), delivery: t('डेलिभरी', 'Delivery'),
})

export function More() {
  const { t, go, own, on, can, plan, perms, user, login } = useApp()
  const pn = PN(t)
  const E: [string, string, string, string | null, boolean][] = [
    ['books', '📒', t('खाता र रिपोर्ट', 'Books and reports'), null, !own && perms.books], ['orders', '📋', t('अर्डर', 'Orders'), 'orders', perms.orders], ['buy', '📥', t('खरिद', 'Purchase'), 'purch', perms.purchase], ['parties', '👥', t('पार्टी', 'Parties'), null, perms.credit], ['categories', '🗂', t('सामानका वर्ग', 'Item categories'), null, perms.editItems],
    ['returns', '↩', t('फिर्ता', 'Returns'), 'returns', perms.returns !== 'off'], ['cctv', '📹', 'CCTV', 'cctv', perms.cctv], ['delivery', '🛵', t('डेलिभरी', 'Delivery'), 'delivery', own],
    ['staff', '🧑‍💼', t('कर्मचारी', 'Staff'), 'staff', own], ['shops', '🏪', t('व्यवसाय बदल्नुस् / थप्नुस्', 'Switch or add business'), null, true], ['cloud', '☁', t('क्लाउड खाता', 'Cloud account'), null, own], ['payconf', '💳', t('QR भुक्तानी सेटअप', 'QR payment setup'), null, own], ['sync', '🔄', t('सिंक', 'Sync'), null, true], ['closeacct', '🚪', t('खाता बन्द / सेवा छोड्नुस्', 'Close account / leave'), null, own], ['settings', '⚙', t('सेटिङ', 'Settings'), null, own], ['support', '💬', t('समस्या जानकारी', 'Report an issue'), null, true],
  ]
  return (
    <div className="body">
      <div className="item" style={{ background: 'var(--fill)' }}><span style={{ fontSize: 22 }}>👤</span><div style={{ flex: 1 }}><b>{user?.name}</b><small>{own ? t('मालिक', 'Owner') : t('कर्मचारी', 'Staff')}</small></div>
        <button className="btn s" onClick={() => login(null)}>{t('खाता बदल्नुस्', 'Switch user')}</button></div>
      {own && <button className="item tap" style={{ border: '2px solid var(--acc)' }} onClick={() => go('plans')}><span style={{ fontSize: 20 }}>💎</span><div style={{ flex: 1 }}><b>{t('प्लान र सदस्यता', 'Plan and subscription')}</b><small>{t('अहिले: ', 'Now: ')}{pn[plan]}</small></div>›</button>}
      {E.map(([s, ic, lb, k, ok]) => {
        if (!ok) return null
        const lock = k && PLANREQ[k] && !can(k)
        if (!lock && k && !on(k)) return null
        return lock
          ? <button key={s} className="item tap" onClick={() => go('upgrade', { f: k })}><span style={{ fontSize: 20 }}>{ic}</span><div style={{ flex: 1 }}><b>{lb}</b></div><span className="lockt">🔒 {pn[PLANREQ[k!]]}</span></button>
          : <button key={s} className="item tap" onClick={() => go(s)}><span style={{ fontSize: 20 }}>{ic}</span><div style={{ flex: 1 }}><b>{lb}</b></div>›</button>
      })}
    </div>
  )
}

export function Settings() {
  const { t, s, save, can, plan, go, toast, refresh } = useApp()
  const pn = PN(t)
  const file = useRef<HTMLInputElement>(null)
  const MODS: [string, string][] = [
    ['credit', t('उधारो / बाँकी खाता', 'Credit / Baki')], ['vat', t('भ्याट र कर बीजक', 'VAT and tax invoice')], ['barcode', t('बारकोड स्क्यानर', 'Barcode scanner')],
    ['qr', t('QR भुक्तानी', 'QR payments')], ['returns', t('फिर्ता', 'Returns')], ['purch', t('खरिद र आपूर्तिकर्ता', 'Purchases and suppliers')],
    ['staff', t('कर्मचारी खाता', 'Staff accounts')], ['cctv', t('क्यामेरा (CCTV)', 'CCTV')], ['delivery', t('डेलिभरी', 'Delivery')],
    ['orders', t('अर्डर सूची', 'Order list')], ['alerts', t('स्टक कम सूचना', 'Low-stock alerts')],
    ['share', t('बिल PDF / इमेल / शेयर पठाउने बटन', 'Bill PDF / email / share buttons')],
  ]
  const flip = (k: string) => {
    if (!s.mod[k] && !can(k)) { go('upgrade', { f: k }); return }
    save({ mod: { ...s.mod, [k]: !s.mod[k] } })
  }
  async function backup() {
    const x = await makeBackup()
    saveFile(x.blob, x.filename)
    toast(t('ब्याकअप फाइल बन्यो', 'Backup file created'))
  }
  async function restore(f: File) {
    try { await restoreBackup(f); await refresh(); toast(t('ब्याकअप फर्कियो', 'Backup restored')) } catch { toast(t('फाइल मिलेन', 'That file did not work')) }
  }
  return (
    <div className="body">
      <div className="h">{t('सजिलो प्रयोग', 'Easy to use')}</div>
      <Toggle label={t('सरल मोड (ठूला बटन)', 'Simple mode (big buttons)')} on={s.simple} onChange={() => save({ simple: !s.simple })} />
      <Toggle label={t('ठूलो अक्षर', 'Large text')} on={s.big} onChange={() => save({ big: !s.big })} />
      <button className="item tap" onClick={() => go('plans')}><span>💎</span><div style={{ flex: 1 }}><b>{t('प्लान', 'Plan')}: {pn[plan]}</b><small>{t('हेर्नुस् वा बदल्नुस्', 'View or change')}</small></div>›</button>
      <div className="h">{t('मोड्युल खोल्ने / बन्द गर्ने', 'Turn modules on / off')}</div>
      {MODS.map(([k, l]) => <Toggle key={k} label={l + (PLANREQ[k] && !can(k) ? ' 🔒 ' + pn[PLANREQ[k]] : '')} on={!!s.mod[k] && can(k)} onChange={() => flip(k)} />)}
      <div className="note">{t('बन्द गर्दा स्क्रिन लुक्छ। पुरानो डाटा मेटिँदैन।', 'Turning off hides screens. Old data is kept.')}</div>
      <div className="h">{t('भाषा र मिति', 'Language and date')}</div>
      <div className="row wrap">
        <button className={'pill' + (s.lang === 'ne' ? ' on' : '')} onClick={() => save({ lang: 'ne' })}>नेपाली</button>
        <button className={'pill' + (s.lang === 'en' ? ' on' : '')} onClick={() => save({ lang: 'en' })}>English</button>
        <button className={'pill' + (s.cal === 'BS' ? ' on' : '')} onClick={() => save({ cal: 'BS' })}>{t('वि.सं. (BS)', 'BS')}</button>
        <button className={'pill' + (s.cal === 'AD' ? ' on' : '')} onClick={() => save({ cal: 'AD' })}>{t('ई.सं. (AD)', 'AD')}</button>
      </div>
      <div className="h">{t('प्रिन्टर र बिल', 'Printer and bill')}</div>
      <div className="row wrap">{(['58', '80', 'a4'] as const).map((p) => <button key={p} className={'pill' + (s.paper === p ? ' on' : '')} onClick={() => save({ paper: p })}>{p === 'a4' ? 'A4/A5' : p + 'mm'}</button>)}</div>
      <button className="btn o" disabled={!btSupported()} onClick={async () => { try { toast(t('जोडियो: ', 'Connected: ') + (await connectPrinter())) } catch { toast(t('प्रिन्टर जोडिएन', 'Printer not connected')) } }}>{t('ब्लुटुथ प्रिन्टर जोड्नुस्', 'Connect Bluetooth printer')}</button>
      {!btSupported() && <div className="note">{t('यो ब्राउजरमा ब्लुटुथ प्रिन्ट चल्दैन। Android Chrome प्रयोग गर्नुस्, वा PDF / शेयर।', 'Bluetooth printing is not available in this browser. Use Android Chrome, or PDF / Share.')}</div>}
      <label className="f">{t('बिलको अन्तिम लाइन', 'Bill footer line')}<input className="in" value={s.billFooter} placeholder={t('धन्यवाद! फेरि आउनुहोला।', 'Thank you! Visit again.')} onChange={(e) => save({ billFooter: e.target.value })} /></label>
      <label className="f">{t('सुरु नगद (दैनिक खाताको लागि)', 'Opening cash (for Day Book)')}<input className="in" inputMode="decimal" value={s.openingCash || ''} onChange={(e) => save({ openingCash: +e.target.value || 0 })} /></label>
      <div className="h">{t('पसलको विवरण', 'Shop details')}</div>
      <label className="f">{t('पसलको नाम', 'Shop name')}<input className="in" value={s.shopName} onChange={(e) => save({ shopName: e.target.value })} /></label>
      <ShopFields v={s} set={(k, v) => save(k === 'province' ? { province: v, district: '', muni: '', ward: '' } : k === 'district' ? { district: v, muni: '', ward: '' } : { [k]: v } as any)} />
      <label className="f">PAN / VAT<input className="in" inputMode="numeric" value={s.pan} onChange={(e) => save({ pan: e.target.value })} /></label>
      <Toggle label={t('भ्याटमा दर्ता भएको पसल', 'VAT-registered shop')} on={s.vatRegistered} onChange={() => save({ vatRegistered: !s.vatRegistered })} />
      <div className="h">{t('डाटा सुरक्षा', 'Data safety')}</div>
      <div className="note">{t('अहिले डाटा यही फोनमा मात्र छ। फोन हरायो भने डाटा जान्छ, त्यसैले नियमित ब्याकअप लिनुस्।', 'Right now your data lives on this phone only. If the phone is lost the data is lost, so back up often.')}</div>
      <button className="btn o" onClick={backup}>{t('ब्याकअप डाउनलोड', 'Download backup')}</button>
      <button className="btn o" onClick={() => file.current?.click()}>{t('ब्याकअपबाट फर्काउनुस्', 'Restore from backup')}</button>
      <input ref={file} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
      <button className="btn o" onClick={() => go('payconf')}>💳 {t('QR भुक्तानी सेटअप', 'QR payment setup')}</button>
      <button className="btn o" onClick={() => go('sync')}>{t('सिंक स्थिति', 'Sync status')}</button>
      <div className="note" style={{ fontSize: 12 }}>{t('श्रेय: सामानका फोटो र बारकोड Open Food Facts (openfoodfacts.org) का स्वयंसेवकहरूबाट, CC BY-SA र ODbL अन्तर्गत। नेपाल/भारतका ठाउँको सूची: sagautam5/local-states-nepal (MIT)।', 'Credits: product photos and barcodes from the Open Food Facts volunteers (openfoodfacts.org), under CC BY-SA and ODbL. Nepal places list: sagautam5/local-states-nepal (MIT).')}</div>
    </div>
  )
}

export function Upgrade({ f }: { f?: string }) {
  const { t, go, back } = useApp()
  const pn = PN(t)
  const p = (f && PLANREQ[f]) || 'pro'
  return (
    <div className="body">
      <div style={{ textAlign: 'center', fontSize: 48, marginTop: 10 }}>🔒</div>
      <div className="hero" style={{ textAlign: 'center' }}>{(f && FEAT(t)[f]) || ''}</div>
      <div className="mut" style={{ textAlign: 'center' }}>{t(pn[p] + ' प्लान वा माथिमा उपलब्ध', 'Available on the ' + pn[p] + ' plan and above')}</div>
      <button className="btn" onClick={() => go('plans')}>{t('प्लान हेर्नुस्', 'See plans')}</button>
      <button className="btn o" onClick={back}>{t('अहिले होइन', 'Not now')}</button>
    </div>
  )
}

export function Plans() {
  const { t, m, plan, s, save, trialDays, toast } = useApp()
  const pn = PN(t)
  const [yearly, setYearly] = useState(false)
  const P: [Plan, number, number, string[]][] = [
    ['free', 0, 0, [t('१०० सामानसम्म', 'Up to 100 items'), t('नगद, स्थिर QR, उधारो (१० ग्राहक)', 'Cash, static QR, credit (10 customers)'), t('नगद भरपाई प्रिन्ट (ESC/POS)', 'Cash receipt print (ESC/POS)'), t('दैनिक खाता', 'Day Book'), t('अफलाइन चल्छ', 'Works offline'), t('नेपाली / English, वि.सं.', 'Nepali / English, BS'), t('१ प्रयोगकर्ता (मालिक)', '1 user (owner)')]],
    ['pro', 499, 4999, [t('फ्रीका सबै +', 'Everything in Free +'), t('असीमित सामान र बिल', 'Unlimited items and bills'), t('कर बीजक (VAT)', 'VAT tax invoice'), t('डाइनामिक QR', 'Dynamic QR'), t('खरिद, आपूर्तिकर्ता, अर्डर', 'Purchases, suppliers, orders'), t('फिर्ता', 'Returns'), t('पूरा खाता + Excel', 'Full books + Excel'), t('कर्मचारी ३ जनासम्म', 'Up to 3 staff')]],
    ['max', 999, 9999, [t('प्रोका सबै +', 'Everything in Pro +'), t('क्यामेरा (CCTV)', 'CCTV'), t('डेलिभरी साझेदार', 'Delivery partners'), t('असीमित कर्मचारी', 'Unlimited staff'), t('३ पसलसम्म', 'Up to 3 shops'), t('प्राथमिकता सपोर्ट', 'Priority support')]],
  ]
  return (
    <div className="body">
      {trialDays > 0 && <div className="note">💎 {t('म्याक्स परीक्षण: ' + trialDays + ' दिन बाँकी', 'Max trial: ' + trialDays + ' days left')}</div>}
      <div className="row wrap" style={{ justifyContent: 'center' }}>
        <button className={'pill' + (!yearly ? ' on' : '')} onClick={() => setYearly(false)}>{t('मासिक', 'Monthly')}</button>
        <button className={'pill' + (yearly ? ' on' : '')} onClick={() => setYearly(true)}>{t('वार्षिक (२ महिना फ्री)', 'Yearly (2 months free)')}</button></div>
      {P.map(([id, pm, py, fs]) => {
        const cur = plan === id, price = yearly ? py : pm
        return (
          <div key={id} className="st" style={{ flex: 'none', ...(cur ? { border: '2px solid var(--acc)' } : {}) }}>
            <div className="row"><b className="g" style={{ fontSize: 20 }}>{pn[id]}</b>{cur && <span className="chip on">{t('अहिलेको', 'Current')}</span>}{id === 'max' && <span className="chip">{t('सबै सुविधा', 'All features')}</span>}</div>
            <div style={{ fontSize: 26, fontWeight: 700, margin: '6px 0' }}>{price ? m(price) : t('निःशुल्क', 'Free')}<small style={{ fontSize: 13, fontWeight: 400, display: 'inline' }}> {price ? (yearly ? t('/ वर्ष', '/ year') : t('/ महिना', '/ month')) : ''}</small></div>
            <div style={{ display: 'grid', gap: 3, marginBottom: 10 }}>{fs.map((x) => <div key={x}>✔ {x}</div>)}</div>
            {import.meta.env.DEV
              ? <button className={'btn' + (cur ? ' o' : '')} disabled={cur} onClick={() => { save({ plan: id, planUntil: Date.now() + 365 * 86400000, trialEnds: 0 }); toast('DEV: ' + pn[id]) }}>{cur ? t('यही प्लान चलिरहेको छ', 'Your current plan') : 'DEV: ' + pn[id]}</button>
              : <button className={'btn' + (cur ? ' o' : '')} disabled>{cur ? t('यही प्लान चलिरहेको छ', 'Your current plan') : t('तिर्ने सुविधा चाँडै आउँदैछ', 'Payment coming soon')}</button>}
          </div>)
      })}
      <div className="note">{t('मूल्य सुझाव मात्र हो, पछि तय हुन्छ। eSewa, Khalti, Fonepay बाट तिरिने छ। नयाँ पसललाई १४ दिन म्याक्स निःशुल्क।', 'Prices are suggestions, to be decided. Payment will be by eSewa, Khalti or Fonepay. New shops get 14 days of Max free.')}</div>
      <div className="mut" style={{ fontSize: 12 }}>{s.shopName}</div>
    </div>
  )
}

const PERM_ROWS: [Exclude<keyof Perms, 'returns'>, string, string, string][] = [
  ['sell', 'बिक्री गर्न मिल्ने', 'Can make sales', 'बिल बनाउने र प्रिन्ट गर्ने'],
  ['credit', 'उधारो बिक्री र उधारो खाता', 'Credit sales and credit accounts', 'ग्राहकको उधारो हेर्ने र लेख्ने'],
  ['viewCost', 'लागत मूल्य र नाफा देख्न मिल्ने', 'Can see cost price and profit', 'खरिद मूल्य र नाफा देखिन्छ'],
  ['editItems', 'सामान थप्न / बदल्न मिल्ने', 'Can add and edit items', 'सामान, वर्ग, स्टक मिलाउने'],
  ['purchase', 'खरिद चढाउन मिल्ने', 'Can enter purchases', 'आपूर्तिकर्ताबाट आएको सामान चढाउने'],
  ['orders', 'अर्डर सूची हेर्न मिल्ने', 'Can see the order list', 'स्टक कम भएको सामानको अर्डर'],
  ['books', 'खाता र रिपोर्ट हेर्न मिल्ने', 'Can see books and reports', 'सबै बिक्री र दैनिक खाता'],
  ['cctv', 'क्यामेरा हेर्न मिल्ने', 'Can view cameras', 'CCTV'],
]

export function Staff() {
  const { t, plan, toast } = useApp()
  const users = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [open, setOpen] = useState('')
  const [newPin, setNewPin] = useState('')
  const staff = users.filter((u) => u.role === 'staff' && u.active)
  async function add() {
    if (staff.length >= STAFF_LIMIT[plan]) return toast(t('यो प्लानमा थप कर्मचारी मिल्दैन', 'Your plan has no room for more staff'))
    if (pin.length < 4) return toast(t('PIN कम्तीमा ४ अङ्कको', 'PIN needs at least 4 digits'))
    const u = await createUser(name.trim(), 'staff', pin)
    setName(''); setPin(''); setOpen(u.id)
    toast(t('कर्मचारी थपियो। तल अनुमति छान्नुस्।', 'Staff added. Choose what they may do below.'))
  }
  const returnsLabel = { off: t('फिर्ता गर्न मिल्दैन', 'No returns'), approval: t('मालिकको पासवर्डसहित', 'With owner password'), direct: t('आफैँ गर्न मिल्ने', 'Can do alone') }
  return (
    <div className="body">
      <div className="note">{t('कर्मचारी: ' + staff.length + ' / ' + STAFF_LIMIT[plan], 'Staff: ' + staff.length + ' of ' + STAFF_LIMIT[plan])}</div>
      <div className="note">{t('कर्मचारीले एपमा आफ्नो नाम र PIN ले लगइन गर्छ। एउटै फोनमा मालिक र कर्मचारी दुवै चलाउन सकिन्छ: थप → "खाता बदल्नुस्"।', 'Staff log in with their name and PIN. Owner and staff can share one phone: More → "Switch user".')}</div>
      {staff.map((u) => {
        const p = { ...DEFAULT_PERMS, ...(u.perms ?? {}) }
        const isOpen = open === u.id
        return (
          <div key={u.id} className="st" style={{ flex: 'none' }}>
            <button className="row" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => { setOpen(isOpen ? '' : u.id); setNewPin('') }}>
              <b className="g" style={{ fontSize: 17 }}>{u.name}</b><span className="mut">{isOpen ? '▲' : t('अनुमति ▼', 'Permissions ▼')}</span></button>
            {isOpen && (<>
              <div className="h">{t('यसले के गर्न सक्छ', 'What this person can do')}</div>
              {PERM_ROWS.map(([k, ne, en, hint]) => (
                <div key={k} className="toggle"><span>{t(ne, en)}<small className="mut" style={{ display: 'block' }}>{hint}</small></span>
                  <button className={'sw' + (p[k] ? ' on' : '')} aria-label={en} aria-pressed={p[k]} onClick={() => setPerms(u.id, { ...p, [k]: !p[k] })} /></div>))}
              <div className="h">{t('फिर्ता (return)', 'Returns')}</div>
              <div className="row wrap">{(['off', 'approval', 'direct'] as const).map((k) => <button key={k} className={'pill' + (p.returns === k ? ' on' : '')} onClick={() => setPerms(u.id, { ...p, returns: k })}>{returnsLabel[k]}</button>)}</div>
              <div className="h">PIN</div>
              <div className="row"><PwInput className="in g" inputMode="numeric" placeholder={t('नयाँ PIN', 'New PIN')} value={newPin} onChange={(e) => setNewPin(e.target.value)} />
                <button className="btn s" disabled={newPin.length < 4} onClick={async () => { await setSecret(u.id, newPin); setNewPin(''); toast(t('PIN बदलियो', 'PIN changed')) }}>{t('बदल्नुस्', 'Change')}</button></div>
              <button className="btn o" style={{ marginTop: 10 }} onClick={async () => { await db.users.update(u.id, { active: false, updatedAt: Date.now() }); await queue('users', u.id); setOpen('') }}>{t('यो कर्मचारी हटाउनुस्', 'Remove this staff member')}</button>
            </>)}
          </div>)
      })}
      <div className="h">{t('नयाँ कर्मचारी', 'New staff')}</div>
      <input className="in" placeholder={t('नाम', 'Name')} value={name} onChange={(e) => setName(e.target.value)} />
      <PwInput className="in" inputMode="numeric" placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
      <button className="btn" disabled={!name.trim() || !pin} onClick={add}>+ {t('थप्नुस्', 'Add')}</button>
      <div className="note">{t('यी अनुमति एपले यही फोनमा लागू गर्छ। फोन आफैँ कर्मचारीको हातमा हुँदा डाटा-फाइल खोल्न जान्ने मान्छेले जोगिन सक्छ, त्यसैले पैसाको सबै अधिकार मालिकले आफैँसँग राख्नुस्।', 'These permissions are enforced by the app on the phone. Someone who knows how to open the phone data files could get around them, so keep money decisions with the owner.')}</div>
    </div>
  )
}

export function Sync() {
  const { t, n, online, pending, cloud, go, syncAll, syncing, toast, date, time } = useApp()
  const conflicts = (useLiveQuery(() => db.kv.get('conflicts'), []) as { v: { id: string; kind: string; tbl: string; created_at: number }[] } | undefined)?.v ?? []
  const label = (k: string) => (k === 'duplicate_bill_no' ? t('एउटै बिल नम्बर दुई बिलमा', 'Same bill number on two bills') : t('एउटै बारकोड दुई सामानमा', 'Same barcode on two items'))
  const dismiss = async (id: string) => {
    try { await authed('/sync/conflicts/' + encodeURIComponent(id) + '/resolve', 'POST'); await db.kv.put({ k: 'conflicts', v: conflicts.filter((c) => c.id !== id) }) } catch { toast(t('इन्टरनेट चाहिन्छ', 'Needs internet')) }
  }
  return (
    <div className="body">
      <div className="st" style={{ flex: 'none' }}><small>{t('स्थिति', 'Status')}</small><b>{online ? t('अनलाइन', 'Online') : t('अफलाइन', 'Offline')}</b>
        <small>{cloud ? t('क्लाउड जोडिएको: ', 'Cloud: ') + cloud.email : t('क्लाउड जोडिएको छैन', 'Cloud not connected')}</small>
        {cloud && <small>{t('पठाउन बाँकी: ', 'Waiting to upload: ') + n(pending)}{cloud.lastSync ? ' · ' + t('अन्तिम सिंक ', 'last sync ') + date(cloud.lastSync) + ' ' + time(cloud.lastSync) : ''}</small>}</div>
      {!cloud && <div className="note w">{t('अहिले डाटा यही फोनमा मात्र छ। क्लाउड जोडेर सुरक्षित गर्नुस्।', 'Your data is on this phone only. Connect the cloud to keep it safe.')}</div>}
      {cloud ? <button className="btn" disabled={syncing || !online} onClick={async () => { const r = await syncAll(); toast(r.error ? t('सिंक भएन', 'Sync failed') : t('सिंक भयो', 'Synced')) }}>{syncing ? '…' : t('अहिले सिंक गर्नुस्', 'Sync now')}</button>
        : <button className="btn" onClick={() => go('cloud')}>☁ {t('क्लाउड जोड्नुस्', 'Connect cloud')}</button>}
      <div className="h">{t('समीक्षा सूची', 'Review list')}</div>
      {conflicts.length === 0 && <div className="mut">{t('जाँच्नुपर्ने केही छैन।', 'Nothing to check.')}</div>}
      {conflicts.map((c) => (
        <div key={c.id} className="note w"><b>{label(c.kind)}</b><div className="mut" style={{ margin: '4px 0' }}>{t('दुवै राखिएका छन्। हेरेर ठीक भए "जाँचियो" थिच्नुस्।', 'Both are kept. Check them, then tap "Checked".')}</div>
          <button className="btn o s" onClick={() => dismiss(c.id)}>{t('जाँचियो', 'Checked')}</button></div>))}
      <div className="note">{t('स्टक जोडेर हिसाब हुन्छ, त्यसैले दुई फोनले अफलाइन बेच्दा पनि स्टक ठीक मिल्छ। सामान र ग्राहकको विवरण दुई फोनमा फरक भए पछि सेभ गरेको लिइन्छ।', 'Stock is added up from moves, so two phones selling offline still add up. If an item or customer was edited on two phones, the later save wins.')}</div>
    </div>
  )
}

export function Support() {
  const { t, back, toast, online, cloud } = useApp()
  const [cat, setCat] = useState('bug')
  const [msg, setMsg] = useState('')
  async function send() {
    const list = await kvGet<any[]>('tickets', [])
    const no = 1000 + list.length + 1
    let sent = false
    if (cloud && online) { try { await authed('/support', 'POST', { category: cat, message: msg, meta: { ua: navigator.userAgent, ts: Date.now() } }); sent = true } catch { /* keep it and send later */ } }
    await kvSet('tickets', [...list, { no, cat, msg, at: Date.now(), ua: navigator.userAgent, sent }])
    toast(t('टिकट #' + no + (sent ? ' पठाइयो' : ' सेभ भयो'), 'Ticket #' + no + (sent ? ' sent' : ' saved')) + (sent ? '' : t(' · पछि पठाइन्छ', ' · will send later')))
    back()
  }
  return (
    <div className="body">
      <div className="row wrap">{([['bug', t('बग', 'Bug')], ['printer', t('प्रिन्टर', 'Printer')], ['pay', t('भुक्तानी', 'Payment')], ['other', t('अन्य', 'Other')]] as const).map(([k, l]) => <button key={k} className={'pill' + (cat === k ? ' on' : '')} onClick={() => setCat(k)}>{l}</button>)}</div>
      <textarea className="in" placeholder={t('के समस्या भयो?', 'What went wrong?')} value={msg} onChange={(e) => setMsg(e.target.value)} />
      <div className="note">{t('फोन मोडेल र एप संस्करण आफैँ जोडिन्छ। ग्राहकको डाटा जोडिँदैन। अहिले सन्देश यही फोनमा सेभ हुन्छ, क्लाउड जोडिएपछि पठाइन्छ।', 'Phone model and app version are attached. No customer data. For now the message is saved on this phone and sent once the cloud is connected.')}</div>
      <button className="btn" disabled={!msg.trim()} onClick={send}>{t('पठाउनुस्', 'Send')}</button>
    </div>
  )
}

export function Cctv() {
  const { t } = useApp()
  const [cams, setCams] = useState<{ name: string; url: string }[] | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  if (cams === null) { kvGet('cams', [] as { name: string; url: string }[]).then(setCams); return <div className="body" /> }
  const put = (c: { name: string; url: string }[]) => { setCams(c); kvSet('cams', c) }
  return (
    <div className="body">
      {cams.length === 0 && <div className="note">{t('क्यामेरा थपिएको छैन।', 'No cameras added yet.')}</div>}
      <div className="grid2">{cams.map((c, i) => <div key={i} className="card" style={{ cursor: 'default' }}><img src={c.url} alt={c.name} style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', background: 'var(--fill)', borderRadius: 8 }} /><b>{c.name}</b>
        <button className="btn o s" onClick={() => put(cams.filter((_, j) => j !== i))}>{t('हटाउनुस्', 'Remove')}</button></div>)}</div>
      <div className="h">{t('क्यामेरा थप्नुस्', 'Add camera')}</div>
      <input className="in" placeholder={t('नाम (जस्तै: काउन्टर)', 'Name (e.g. Counter)')} value={name} onChange={(e) => setName(e.target.value)} />
      <input className="in" placeholder="http://192.168.1.20/mjpeg" value={url} onChange={(e) => setUrl(e.target.value)} />
      <button className="btn" disabled={!name || !url} onClick={() => { put([...cams, { name, url }]); setName(''); setUrl('') }}>+ {t('थप्नुस्', 'Add')}</button>
      <div className="note">{t('ब्राउजरले RTSP सिधै चलाउँदैन। क्यामेरा वा सानो गेटवे (जस्तै go2rtc) बाट MJPEG/स्न्यापशट लिङ्क चाहिन्छ, र फोन पसलकै वाइफाइमा हुनुपर्छ।', 'Browsers cannot play RTSP directly. You need an MJPEG / snapshot link from the camera or a small gateway (such as go2rtc), and the phone must be on the shop Wi-Fi.')}</div>
    </div>
  )
}

export function Delivery() {
  const { t } = useApp()
  return (
    <div className="body">
      <div className="note">{t('भविष्यको मोड्युल। Pathao, Upaya जस्ता साझेदारसँग जोड्न ठाउँ तयार छ।', 'Future module. A slot is ready to connect partners like Pathao and Upaya.')}</div>
      {['Pathao', 'Upaya'].map((x) => <div key={x} className="item"><div style={{ flex: 1 }}><b>{x}</b><small>{t('जोडिएको छैन', 'Not connected')}</small></div></div>)}
    </div>
  )
}
