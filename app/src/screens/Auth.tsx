import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../ctx'
import { db, kvSet } from '../db'
import { addCategory, checkSecret, createUser, seedSample } from '../logic'
import { PwInput, ShopFields } from '../components'
import { SHOP_TYPES } from '../data'
import type { User } from '../types'
import { RestoreFlow } from './Cloud'
import { restoreBackup } from '../backup'
import { ShopSwitcher } from './Shops'

/** Two small buttons to change the language at any step. */
export function LangSwitch() {
  const { s, save } = useApp()
  return (
    <div className="row" style={{ justifyContent: 'center' }}>
      <button className={'pill' + (s.lang === 'ne' ? ' on' : '')} onClick={() => save({ lang: 'ne' })}>नेपाली</button>
      <button className={'pill' + (s.lang === 'en' ? ' on' : '')} onClick={() => save({ lang: 'en' })}>English</button>
    </div>
  )
}

export function Setup() {
  const { s, save, login, t, refresh } = useApp()
  const [step, setStep] = useState(0)
  const [f, setF] = useState({ shopName: '', company: '', shopType: 'kirana', shopTypeOther: '', pan: '', vatRegistered: false, province: '', district: '', muni: '', ward: '' })
  const [o, setO] = useState({ name: '', email: '', pw: '', pw2: '', sample: true })
  const [err, setErr] = useState('')
  const [restore, setRestore] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }))

  async function finish() {
    if (o.pw.length < 8) return setErr(t('पासवर्ड कम्तीमा ८ अक्षरको हुनुपर्छ।', 'Password must be at least 8 characters.'))
    if (o.pw !== o.pw2) return setErr(t('दुई पासवर्ड मिलेनन्।', 'The two passwords do not match.'))
    const u = await createUser(o.name || t('मालिक', 'Owner'), 'owner', o.pw)
    await kvSet('ownerEmail', o.email)
    if (o.sample && f.shopType === 'kirana') { await seedSample(); if (navigator.onLine) void import('../off').then((m) => m.enrichSampleItems()).catch(() => {}) }
    else if (o.sample) for (const [ne, en] of SHOP_TYPES.find((x) => x.id === f.shopType)?.cats ?? []) await addCategory(ne, en)
    await save({ ...f, trialEnds: Date.now() + 14 * 86400000 })
    await refresh()
    login(u)
  }

  if (restore) return <RestoreFlow onBack={() => setRestore(false)} onDone={() => { /* settings and users are now on this phone; the app shows the login screen */ }} />
  return (
    <div className="body">
      <img className="logo" src="/logo.png" alt="Pocket Pasal" />
      {step > 0 && <LangSwitch />}
      {step === 0 && (<>
        <div className="hero" style={{ textAlign: 'center' }}>{t('स्वागत छ!', 'Welcome!')}</div>
        <div className="mut" style={{ textAlign: 'center', marginTop: -8 }}>Pocket Pasal · पकेट पसल</div>
        <div className="mut" style={{ textAlign: 'center' }}>{t('भाषा छान्नुस्', 'Choose your language')}</div>
        <button className="btn" onClick={() => { save({ lang: 'ne' }); setStep(1) }}>नेपाली</button>
        <button className="btn o" onClick={() => { save({ lang: 'en' }); setStep(1) }}>English</button>
        <button className="btn o" style={{ marginTop: 8 }} onClick={() => setRestore(true)}>{t('मसँग पहिले नै खाता छ', 'I already have an account')}</button>
        <button className="btn o" onClick={() => file.current?.click()}>{t('बैकअप फाइलबाट फर्काउनुस्', 'Restore from a backup file')}</button>
        <input ref={file} type="file" accept="application/json" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = ''
          if (!f) return
          try { await restoreBackup(f); await refresh() } catch { setErr(t('यो ब्याकअप फाइल मिलेन।', 'That is not a backup file.')) }
        }} />
        {err && <div className="note w">{err}</div>}
        <ShopSwitcher />
      </>)}
      {step === 1 && (<>
        <div className="hero">{t('तपाईंको पसल', 'Your shop')}</div>
        <label className="f">{t('पसलको नाम', 'Shop name')}<input className="in" value={f.shopName} onChange={(e) => set('shopName', e.target.value)} /></label>
        <label className="f">{t('कम्पनी / फर्मको नाम', 'Company / firm name')}<input className="in" value={f.company} onChange={(e) => set('company', e.target.value)} /></label>
        <ShopFields v={f} set={(k, v) => (k === 'province' ? setF((x) => ({ ...x, province: v, district: '', muni: '', ward: '' })) : k === 'district' ? setF((x) => ({ ...x, district: v, muni: '', ward: '' })) : set(k, v))} />
        <label className="f">PAN / VAT (ichhik)<input className="in" inputMode="numeric" value={f.pan} onChange={(e) => set('pan', e.target.value)} /></label>
        <div className="toggle"><span>{t('भ्याटमा दर्ता भएको पसल', 'VAT-registered shop')}</span>
          <button className={'sw' + (f.vatRegistered ? ' on' : '')} aria-label="vat" onClick={() => set('vatRegistered', !f.vatRegistered)} /></div>
        <button className="btn" disabled={!f.shopName.trim()} onClick={() => setStep(2)}>{t('अगाडि', 'Next')}</button>
        <button className="btn o" onClick={() => setStep(0)}>← {t('पछाडि', 'Back')}</button>
      </>)}
      {step === 2 && (<>
        <div className="hero">{t('मालिकको खाता', 'Owner account')}</div>
        <label className="f">{t('तपाईंको नाम', 'Your name')}<input className="in" value={o.name} onChange={(e) => setO({ ...o, name: e.target.value })} /></label>
        <label className="f">{t('इमेल', 'Email')}<input className="in" type="email" value={o.email} onChange={(e) => setO({ ...o, email: e.target.value })} /></label>
        <label className="f">{t('पासवर्ड', 'Password')}<PwInput className="in" value={o.pw} onChange={(e) => setO({ ...o, pw: e.target.value })} /></label>
        <label className="f">{t('पासवर्ड फेरि', 'Repeat password')}<PwInput className="in" value={o.pw2} onChange={(e) => setO({ ...o, pw2: e.target.value })} /></label>
        <div className="toggle"><span>{f.shopType === 'kirana' ? t('नमुना किराना सामान राख्नुस्', 'Add sample kirana items') : t('यो पसलका सुरुवाती वर्ग बनाउनुस्', 'Create starter categories for this shop')}</span>
          <button className={'sw' + (o.sample ? ' on' : '')} aria-label="sample" onClick={() => setO({ ...o, sample: !o.sample })} /></div>
        <div className="note">{t('इमेल OTP प्रमाणीकरण क्लाउड जोडिएपछि सुरु हुन्छ। अहिले पासवर्ड यही फोनमा सुरक्षित रहन्छ।', 'Email OTP check starts once the cloud is connected. For now the password stays safely on this phone.')}</div>
        {err && <div className="note w">{err}</div>}
        <button className="btn" disabled={!o.email.includes('@')} onClick={finish}>{t('पसल सुरु गर्नुस्', 'Start my shop')}</button>
        <button className="btn o" onClick={() => { setErr(''); setStep(1) }}>← {t('पछाडि', 'Back')}</button>
        <div className="mut" style={{ textAlign: 'center' }}>{t('१४ दिन म्याक्स प्लान निःशुल्क', '14 days of Max plan free')} · {s.lang}</div>
      </>)}
    </div>
  )
}

export function Login() {
  const { s, login, t } = useApp()
  const users = useLiveQuery(() => db.users.toArray(), [], [] as User[]).filter((u) => u.active)
  const [pick, setPick] = useState<string>('')
  const [secret, setSecret] = useState('')
  const [err, setErr] = useState('')
  // Kept in the browser's storage so closing and reopening the app does not reset the count.
  const LOCK_KEY = 'pasal-login-lock'
  const readLock = (): { fails: number; until: number } => { try { return JSON.parse(localStorage.getItem(LOCK_KEY) || '') } catch { return { fails: 0, until: 0 } } }
  const writeLock = (v: { fails: number; until: number }) => { try { localStorage.setItem(LOCK_KEY, JSON.stringify(v)) } catch { /* private mode: keep going */ } }
  const u = users.find((x) => x.id === pick) || users.find((x) => x.role === 'owner') || users[0]

  async function submit() {
    if (!u) return
    const lk = readLock()
    if (Date.now() < lk.until) return setErr(t('धेरै गलत प्रयास। ' + Math.ceil((lk.until - Date.now()) / 1000) + ' सेकेन्डपछि फेरि गर्नुस्।', 'Too many wrong tries. Try again in ' + Math.ceil((lk.until - Date.now()) / 1000) + ' seconds.'))
    if (await checkSecret(u, secret)) { writeLock({ fails: 0, until: 0 }); login(u) } else {
      const f = (lk.fails || 0) + 1
      // 5 wrong tries lock the screen; each further lock lasts longer (30 s, 1 min, 2 min ... up to 15 min).
      writeLock(f % 5 === 0 ? { fails: f, until: Date.now() + Math.min(900, 30 * 2 ** (f / 5 - 1)) * 1000 } : { fails: f, until: 0 })
      setErr(t('पासवर्ड वा PIN मिलेन।', 'Wrong password or PIN.'))
    }
  }
  return (
    <div className="body">
      <img className="logo" src="/logo.png" alt="Pocket Pasal" />
      <LangSwitch />
      <div className="hero" style={{ textAlign: 'center' }}>{s.shopName}</div>
      <div className="mut" style={{ textAlign: 'center', marginTop: -6 }}>Pocket Pasal · {t('लगइन गर्नुस्', 'Log in')}</div>
      {users.length > 1 && <div className="row wrap" style={{ justifyContent: 'center' }}>{users.map((x) => <button key={x.id} className={'pill' + (u?.id === x.id ? ' on' : '')} onClick={() => { setPick(x.id); setErr('') }}>{x.name}{x.role === 'owner' ? ' ★' : ''}</button>)}</div>}
      <label className="f">{u?.role === 'staff' ? 'PIN' : t('पासवर्ड', 'Password')}
        <PwInput className="in" inputMode={u?.role === 'staff' ? 'numeric' : 'text'} value={secret} autoFocus
          onChange={(e) => setSecret(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></label>
      {err && <div className="note w">{err}</div>}
      <button className="btn" onClick={submit} disabled={!secret}>{t('लगइन', 'Login')}</button>
      <div className="note">{t('इन्टरनेट नभए पनि लगइन चल्छ। यो फोनमा बनेको खातामा मात्र।', 'Login works without internet, for accounts made on this phone.')}</div>
      <ShopSwitcher />
    </div>
  )
}
