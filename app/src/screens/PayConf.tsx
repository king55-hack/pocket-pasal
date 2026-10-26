import { useEffect, useRef, useState } from 'react'
import { PwInput } from '../components'
import { useApp } from '../ctx'
import { authed } from '../api'
import { kvSet } from '../db'
import { compressImage, QR_PHOTO } from '../images'

export function PayConf() {
  const { t, s, save, cloud, can, go, online, toast } = useApp()
  const file = useRef<HTMLInputElement>(null)
  const [cfg, setCfg] = useState<any>(null)
  const [open, setOpen] = useState('')
  const [mode, setMode] = useState<'sandbox' | 'live'>('sandbox')
  const [f, setF] = useState({ secret: '', code: '' })
  const [busy, setBusy] = useState(false)
  const dyn = !!cloud && can('dynqr')

  const load = () => authed('/pay/config').then((r) => { setCfg(r.providers); kvSet('payCfg', r.providers) }).catch(() => {})
  useEffect(() => { if (dyn && online) load() }, [dyn, online])

  async function saveKeys(provider: 'khalti' | 'esewa') {
    setBusy(true)
    try {
      await authed('/pay/config', 'POST', { provider, mode, fields: provider === 'khalti' ? { secret: f.secret } : { code: f.code, secret: f.secret } })
      setF({ secret: '', code: '' }); setOpen(''); await load()
      toast(t('कुञ्जी सेभ भयो', 'Keys saved'))
    } catch { toast(t('सेभ भएन। कुञ्जी र इन्टरनेट जाँच्नुस्।', 'Could not save. Check the keys and the internet.')) }
    setBusy(false)
  }
  async function removeKeys(provider: string) {
    try { await authed('/pay/config', 'POST', { provider, remove: true }); await load(); toast(t('हटाइयो', 'Removed')) } catch { toast(t('इन्टरनेट चाहिन्छ', 'Needs internet')) }
  }

  const card = (id: 'khalti' | 'esewa', name: string, help: string) => {
    const c = cfg?.[id]
    return (
      <div className="st" style={{ flex: 'none' }}>
        <div className="row"><b className="g" style={{ fontSize: 17 }}>{name}</b>
          {c?.set ? <span className={'chip ' + (c.mode === 'live' ? 'ok' : '')}>{c.mode === 'live' ? t('चालु (असली)', 'Live') : t('परीक्षण', 'Test mode')}</span> : <span className="chip">{t('सेटअप भएको छैन', 'Not set up')}</span>}</div>
        {open === id ? (<>
          <div className="row wrap" style={{ margin: '8px 0' }}>
            <button className={'pill' + (mode === 'sandbox' ? ' on' : '')} onClick={() => setMode('sandbox')}>{t('परीक्षण (पैसा सर्दैन)', 'Test (no real money)')}</button>
            <button className={'pill' + (mode === 'live' ? ' on' : '')} onClick={() => setMode('live')}>{t('असली', 'Live')}</button></div>
          {id === 'esewa' && <label className="f">{t('मर्चेन्ट / प्रोडक्ट कोड', 'Merchant / product code')}<input className="in" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="EPAYTEST" /></label>}
          <label className="f">{t('गोप्य कुञ्जी (Secret key)', 'Secret key')}<PwInput className="in" autoComplete="off" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} /></label>
          <div className="mut" style={{ fontSize: 13, margin: '6px 0' }}>{help}</div>
          <div className="row"><button className="btn g" disabled={busy || !f.secret || (id === 'esewa' && !f.code)} onClick={() => saveKeys(id)}>{busy ? '…' : t('सेभ गर्नुस्', 'Save')}</button>
            <button className="btn o g" onClick={() => setOpen('')}>{t('रद्द', 'Cancel')}</button></div>
        </>) : (
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button className="btn o s" disabled={!online} onClick={() => { setOpen(id); setMode(c?.mode ?? 'sandbox') }}>{c?.set ? t('कुञ्जी बदल्नुस्', 'Change keys') : t('कुञ्जी राख्नुस्', 'Add keys')}</button>
            {c?.set && <button className="btn o s" onClick={() => removeKeys(id)}>{t('हटाउनुस्', 'Remove')}</button>}
          </div>)}
      </div>
    )
  }

  return (
    <div className="body">
      <div className="hero">{t('QR भुक्तानी', 'QR payments')}</div>

      <div className="h">{t('१. मेरो आफ्नै QR (सबै प्लानमा, इन्टरनेट नचाहिने)', '1. My own QR (all plans, works offline)')}</div>
      <div className="note">{t('Fonepay, eSewa वा Khalti बाट पाएको आफ्नो पसलको QR को फोटो राख्नुस्। भुक्तानीको बेला यही देखिन्छ। ग्राहकले रकम आफैँ हाल्छ, त्यसैले बिल "अप्रमाणित" रहन्छ।', 'Upload the QR picture you got from Fonepay, eSewa or Khalti. It is shown at payment time. The customer types the amount, so the bill stays "unverified".')}</div>
      {s.staticQr && <div className="receipt" style={{ padding: 10 }}><img src={s.staticQr} alt="QR" style={{ width: 200, maxWidth: '100%' }} /></div>}
      <input ref={file} type="file" accept="image/*" hidden onChange={async (e) => { const fl = e.target.files?.[0]; if (fl) { await save({ staticQr: await compressImage(fl, QR_PHOTO) }); toast(t('QR सेभ भयो', 'QR saved')) } }} />
      <div className="row"><button className="btn g" onClick={() => file.current?.click()}>{s.staticQr ? t('QR बदल्नुस्', 'Change QR') : t('QR फोटो राख्नुस्', 'Upload QR picture')}</button>
        {s.staticQr && <button className="btn o g" onClick={() => save({ staticQr: undefined })}>{t('हटाउनुस्', 'Remove')}</button>}</div>

      <div className="h">{t('२. ठ्याक्कै रकमको QR (प्रो प्लान)', '2. Exact-amount QR (Pro plan)')}</div>
      {!cloud && <div className="note w">{t('यसका लागि क्लाउड खाता चाहिन्छ।', 'This needs a cloud account.')} <button className="btn o s" style={{ marginTop: 6 }} onClick={() => go('cloud')}>☁ {t('क्लाउड जोड्नुस्', 'Connect cloud')}</button></div>}
      {cloud && !can('dynqr') && <div className="note w">{t('यो प्रो प्लानमा मात्र छ।', 'This is on the Pro plan.')} <button className="btn o s" style={{ marginTop: 6 }} onClick={() => go('upgrade', { f: 'dynqr' })}>{t('प्लान हेर्नुस्', 'See plans')}</button></div>}
      {dyn && (<>
        <div className="note">{t('पैसा सिधै तपाईंको आफ्नै Khalti / eSewa खातामा जान्छ। हामीले कुञ्जी गोप्य राख्छौं र फोनमा कहिल्यै फर्काउँदैनौं। पहिले "परीक्षण" मा जाँच्नुस्।', 'Money goes straight to your own Khalti / eSewa account. Keys are kept encrypted and never sent back to the phone. Try "Test" mode first.')}</div>
        {!online && <div className="note w">{t('कुञ्जी राख्न इन्टरनेट चाहिन्छ।', 'Adding keys needs internet.')}</div>}
        {card('khalti', 'Khalti', t('Khalti मर्चेन्ट ड्यासबोर्ड → Keys बाट Secret key लिनुस्। परीक्षणको लागि test-admin.khalti.com।', 'Get the Secret key from your Khalti merchant dashboard (Keys). For test mode use test-admin.khalti.com.'))}
        {card('esewa', 'eSewa', t('eSewa ले दिएको Merchant code र Secret key राख्नुस्। परीक्षणको लागि eSewa developer docs मा प्रकाशित परीक्षण कुञ्जी चल्छ।', 'Enter the merchant code and secret key eSewa gave you. For test mode, use the test keys published in the eSewa developer docs.'))}
        <div className="st" style={{ flex: 'none' }}><b style={{ fontSize: 17 }}>Fonepay</b><small>{t('ठ्याक्कै रकमको Fonepay QR बैंकसँग मर्चेन्ट सम्झौता भएपछि मात्र मिल्छ। तबसम्म माथिको "मेरो आफ्नै QR" प्रयोग गर्नुस्।', 'Exact-amount Fonepay QR is only available after your bank signs you up as a Fonepay merchant. Until then use "My own QR" above.')}</small></div>
        <div className="note">{t('Khalti र eSewa मा QR ले भुक्तानीको पेज खोल्छ: ग्राहकले फोनको क्यामेराले स्क्यान गरेर त्यही पेजमा तिर्छ।', 'With Khalti and eSewa the QR opens a payment page: the customer scans it with the phone camera and pays there.')}</div>
      </>)}
    </div>
  )
}
