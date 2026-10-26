import { useEffect, useState } from 'react'
import { useApp } from '../ctx'
import { authed, device, post, setCloud, type ApiError } from '../api'
import { db, kvGet } from '../db'
import { checkSecret } from '../logic'
import { enqueueAll } from '../sync'

export function errText(e: ApiError, t: (a: string, b: string) => string) {
  switch (e.code) {
    case 'network': return t('इन्टरनेट वा सर्भर नपुगेर भएन। पछि फेरि प्रयास गर्नुस्।', 'Could not reach the server. Check the internet and try again.')
    case 'rate': return t('धेरै कोड मागियो। एक घण्टापछि फेरि प्रयास गर्नुस्।', 'Too many codes asked. Try again in an hour.')
    case 'bad_code': return t('कोड मिलेन वा म्याद सकियो।', 'The code is wrong or has expired.')
    case 'bad_login': return t('इमेल वा पासवर्ड मिलेन।', 'Wrong email or password.')
    case 'locked': return t('धेरै गलत प्रयास। १५ मिनेटपछि फेरि गर्नुस्।', 'Too many wrong tries. Try again in 15 minutes.')
    case 'device_revoked': return t('यो फोन मालिकले हटाइसक्नुभएको छ।', 'The owner has removed this phone.')
    case 'exists': return t('यो इमेलको खाता पहिले नै छ।', 'An account with this email already exists.')
    default: return t('केही गडबड भयो। फेरि प्रयास गर्नुस्।', 'Something went wrong. Please try again.')
  }
}

export function CloudScreen() {
  const { t, cloud, syncAll, syncing, toast, date, time, pending, s, refresh } = useApp()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'start' | 'code'>('start')
  const [how, setHow] = useState<'signup' | 'login'>('signup')
  const [hint, setHint] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [devs, setDevs] = useState<{ id: string; name: string; revoked: number; last_seen: number }[]>([])
  const [me, setMe] = useState('')

  useEffect(() => { kvGet('ownerEmail', '').then((e) => e && setEmail(e)) }, [])
  useEffect(() => {
    if (!cloud) return
    authed('/devices').then((r) => { setDevs(r.devices); setMe(r.current) }).catch(() => {})
  }, [cloud])

  async function begin() {
    setErr(''); setBusy(true)
    try {
      const owner = (await db.users.toArray()).find((u) => u.role === 'owner')
      if (!owner || !(await checkSecret(owner, pw))) { setErr(t('यो फोनको मालिकको पासवर्ड मिलेन।', 'That is not the owner password of this phone.')); setBusy(false); return }
      try {
        const r = await post('/auth/otp', { email, purpose: 'signup' })
        setHow('signup'); setHint(r.devCode ? 'DEV code: ' + r.devCode : ''); setStep('code')
      } catch (e: any) {
        if (e.code !== 'exists') throw e
        // The account is already there (for example from another phone). Log in to it and merge.
        const d = await device()
        try {
          await post('/auth/login', { email, password: pw, device: d })
        } catch (e2: any) {
          if (e2.code !== 'otp_required') throw e2
          setHint(e2.data?.devCode ? 'DEV code: ' + e2.data.devCode : '')
        }
        setHow('login'); setStep('code')
      }
    } catch (e: any) { setErr(errText(e, t)) }
    setBusy(false)
  }

  async function finish() {
    setErr(''); setBusy(true)
    try {
      const d = await device()
      const owner = (await db.users.toArray()).find((u) => u.role === 'owner')!
      const r = how === 'signup'
        ? await post('/auth/signup', { email, code, password: pw, name: owner.name, shopName: s.shopName, device: d })
        : await post('/auth/login', { email, password: pw, code, device: d })
      await setCloud({ email, access: r.access, refresh: r.refresh, cursor: 0, lastSync: 0 })
      await enqueueAll()
      const res = await syncAll()
      toast(res.error ? t('जोडियो, सिंक पछि हुन्छ', 'Connected, sync will finish later') : t('क्लाउड जोडियो र डाटा सिंक भयो', 'Cloud connected and data synced'))
      setStep('start'); setCode(''); setPw('')
    } catch (e: any) { setErr(errText(e, t)) }
    setBusy(false)
  }

  if (cloud) return (
    <div className="body">
      <div className="st" style={{ flex: 'none' }}><small>{t('क्लाउड खाता', 'Cloud account')}</small><b>{cloud.email}</b>
        <small>{cloud.lastSync ? t('अन्तिम सिंक: ', 'Last sync: ') + date(cloud.lastSync) + ' ' + time(cloud.lastSync) : t('अझै सिंक भएको छैन', 'Not synced yet')}</small>
        <small>{t('पठाउन बाँकी: ', 'Waiting to upload: ') + pending}</small></div>
      {cloud.lastError && <div className="note w">{errText({ status: 0, code: cloud.lastError }, t)}</div>}
      <button className="btn" disabled={syncing} onClick={async () => { const r = await syncAll(); toast(r.error ? errText({ status: 0, code: r.error }, t) : t('सिंक भयो', 'Synced')) }}>{syncing ? t('सिंक हुँदैछ…', 'Syncing…') : t('अहिले सिंक गर्नुस्', 'Sync now')}</button>
      <div className="h">{t('यो पसलका फोनहरू', 'Phones on this shop')}</div>
      {devs.map((d) => (
        <div key={d.id} className="item"><div style={{ flex: 1 }}><b>{d.name}{d.id === me ? t(' (यो फोन)', ' (this phone)') : ''}</b>
          <small>{d.revoked ? t('हटाइएको', 'Removed') : t('अन्तिम पटक: ', 'Last seen: ') + date(d.last_seen)}</small></div>
          {d.id !== me && !d.revoked && <button className="btn o s" onClick={async () => { await authed('/devices/' + d.id + '/revoke', 'POST'); setDevs(devs.map((x) => x.id === d.id ? { ...x, revoked: 1 } : x)); toast(t('फोन हटाइयो', 'Phone removed')) }}>{t('हटाउनुस्', 'Remove')}</button>}
        </div>))}
      <div className="note">{t('हराएको फोन यहाँबाट हटाउनुस्। त्यो फोनले अब डाटा लिन वा पठाउन सक्दैन।', 'Remove a lost phone here. It can no longer read or send shop data.')}</div>
      <button className="btn o" onClick={async () => { try { await authed('/auth/logout', 'POST') } catch { /* offline: just forget the login */ } await setCloud(null); await refresh(); toast(t('क्लाउडबाट छुट्टियो। डाटा फोनमै छ।', 'Disconnected. Your data stays on this phone.')) }}>{t('यो फोन क्लाउडबाट छुटाउनुस्', 'Disconnect this phone')}</button>
    </div>
  )

  return (
    <div className="body">
      <div className="hero">☁ {t('क्लाउड ब्याकअप र सिंक', 'Cloud backup and sync')}</div>
      <div className="note">{t('जोडेपछि डाटा सुरक्षित रहन्छ, फोन हरायो भने पनि। अर्को फोनमा पनि उही पसल चलाउन सकिन्छ। इन्टरनेट नभए पनि एप चलिरहन्छ।', 'Once connected your data is safe even if the phone is lost, and you can run the same shop on another phone. The app keeps working without internet.')}</div>
      {step === 'start' && (<>
        <label className="f">{t('इमेल', 'Email')}<input className="in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="f">{t('यो एपको मालिकको पासवर्ड', 'Owner password of this app')}<input className="in" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {err && <div className="note w">{err}</div>}
        <button className="btn" disabled={busy || !email.includes('@') || !pw} onClick={begin}>{busy ? '…' : t('इमेलमा कोड पठाउनुस्', 'Email me a code')}</button>
      </>)}
      {step === 'code' && (<>
        <div className="mut">{t(email + ' मा ६ अङ्कको कोड पठाइयो', 'A 6-digit code was sent to ' + email)}</div>
        {hint && <div className="note">{hint}</div>}
        <input className="in" inputMode="numeric" maxLength={6} placeholder="______" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ textAlign: 'center', fontSize: 24, letterSpacing: 8 }} />
        {how === 'login' && <div className="note">{t('यो इमेलको खाता पहिले नै छ। लगइन गरेर यो फोनको डाटा त्यसमा मिलाइनेछ।', 'This email already has an account. Logging in will merge this phone data into it.')}</div>}
        {err && <div className="note w">{err}</div>}
        <button className="btn" disabled={busy || code.length !== 6} onClick={finish}>{busy ? '…' : t('जोड्नुस्', 'Connect')}</button>
        <button className="btn o" onClick={() => { setStep('start'); setErr('') }}>{t('पछाडि', 'Back')}</button>
      </>)}
    </div>
  )
}

/** On a new phone: log in to an account that already exists and bring the shop down. */
export function RestoreFlow({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const { t, syncAll, refresh } = useApp()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [code, setCode] = useState('')
  const [needCode, setNeedCode] = useState(false)
  const [hint, setHint] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function go() {
    setErr(''); setBusy(true)
    try {
      const d = await device()
      const r = await post('/auth/login', { email, password: pw, device: d, ...(needCode ? { code } : {}) })
      await setCloud({ email, access: r.access, refresh: r.refresh, cursor: 0, lastSync: 0 })
      const res = await syncAll()
      await refresh()
      const users = await db.users.toArray()
      if (res.error || !users.length) { setErr(t('डाटा ल्याउन सकिएन। इन्टरनेट जाँचेर फेरि प्रयास गर्नुस्।', 'Could not bring the shop down. Check the internet and try again.')); await setCloud(null) }
      else onDone()
    } catch (e: any) {
      if (e.code === 'otp_required') { setNeedCode(true); setHint(e.data?.devCode ? 'DEV code: ' + e.data.devCode : ''); setErr('') }
      else setErr(errText(e, t))
    }
    setBusy(false)
  }
  return (
    <div className="body">
      <div className="hero">{t('पहिलेको खातामा लगइन', 'Log in to your account')}</div>
      <label className="f">{t('इमेल', 'Email')}<input className="in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="f">{t('पासवर्ड', 'Password')}<input className="in" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      {needCode && (<>
        <div className="mut">{t('नयाँ फोन भएकाले इमेलमा आएको ६ अङ्कको कोड राख्नुस्', 'This is a new phone, so enter the 6-digit code from your email')}</div>
        {hint && <div className="note">{hint}</div>}
        <input className="in" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ textAlign: 'center', fontSize: 24, letterSpacing: 8 }} />
      </>)}
      {err && <div className="note w">{err}</div>}
      <button className="btn" disabled={busy || !email.includes('@') || !pw || (needCode && code.length !== 6)} onClick={go}>{busy ? '…' : t('लगइन', 'Log in')}</button>
      <button className="btn o" onClick={onBack}>{t('पछाडि', 'Back')}</button>
    </div>
  )
}
