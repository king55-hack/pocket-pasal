import { useEffect, useState } from 'react'
import { useApp } from '../ctx'
import { authed, type ApiError } from '../api'
import { PwInput, Toggle } from '../components'
import { kvSet } from '../db'
import { wipeThisPhone } from '../backup'

const REASONS: [string, string, string][] = [
  ['not_using', 'अब प्रयोग गर्दिनँ', "I'm not using it any more"],
  ['closing_business', 'व्यवसाय बन्द गर्दैछु', 'I am closing my business'],
  ['too_expensive', 'महँगो लाग्यो', 'It costs too much'],
  ['missing_features', 'चाहिएको सुविधा छैन', 'It is missing features I need'],
  ['hard_to_use', 'प्रयोग गर्न गाह्रो छ', 'It is hard to use'],
  ['problems', 'समस्या/बग धेरै आयो', 'Too many problems or bugs'],
  ['other_app', 'अर्को एप प्रयोग गर्दैछु', 'I am using another app'],
  ['privacy', 'डाटा सुरक्षाको चिन्ता', 'I am worried about my data'],
  ['other', 'अन्य (तल लेख्नुस्)', 'Other (write below)'],
]
interface Req { id: string; type: 'delete_account' | 'cancel_plan'; reason: string; status: string; requestedAt: number; decidedAt?: number; note?: string; scheduledAt?: number }

const msg = (e: ApiError, t: (a: string, b: string) => string) =>
  e.code === 'bad_password' ? t('पासवर्ड मिलेन।', 'Wrong password.')
    : e.code === 'locked' ? t('धेरै गलत प्रयास। केही बेरपछि फेरि गर्नुस्।', 'Too many wrong tries. Try again later.')
    : e.code === 'already_open' ? t('अनुरोध पहिले नै खुला छ।', 'A request is already open.')
    : e.code === 'reason_needed' ? t('कारण लेख्नुस्।', 'Please write the reason.')
    : e.code === 'network' ? t('इन्टरनेट चाहिन्छ।', 'Internet is needed.')
    : t('केही गडबड भयो। फेरि प्रयास गर्नुस्।', 'Something went wrong. Please try again.')

export function CloseAccount() {
  const { t, cloud, s, toast, date, go, online } = useApp()
  const [req, setReq] = useState<Req | null | undefined>(undefined)
  const [type, setType] = useState<'delete_account' | 'cancel_plan'>('delete_account')
  const [reason, setReason] = useState('')
  const [text, setText] = useState('')
  const [pw, setPw] = useState('')
  const [agree, setAgree] = useState(false)
  const [backup, setBackup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [confirmWipe, setConfirmWipe] = useState('')

  const load = () => authed('/account/closure').then((r) => { setReq(r.request); kvSet('closure', r.request) }).catch(() => setReq(null))
  useEffect(() => { if (cloud && online) load(); else setReq(null) }, [cloud, online]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setBusy(true); setErr('')
    try {
      const r = await authed('/account/closure', 'POST', { type, reasonCode: reason, reasonText: text.trim(), password: pw })
      setReq(r.request); kvSet('closure', r.request); setPw('')
      toast(t('अनुरोध पठाइयो', 'Request sent'))
    } catch (e: any) { setErr(msg(e, t)) }
    setBusy(false)
  }
  async function cancel() {
    setBusy(true)
    try { await authed('/account/closure/cancel', 'POST'); setReq(null); kvSet('closure', null); toast(t('अनुरोध रद्द भयो। खाता चलिरहन्छ।', 'Request cancelled. Your account stays.')) } catch (e: any) { toast(msg(e, t)) }
    setBusy(false)
  }
  const open = req && (req.status === 'pending' || req.status === 'approved')
  const ready = !!reason && (reason !== 'other' || text.trim().length >= 3) && pw.length > 0 && agree && (type === 'cancel_plan' || backup)

  return (
    <div className="body">
      <div className="hero">🚪 {t('खाता बन्द / सेवा छोड्नुस्', 'Close account / leave')}</div>

      {!cloud && <div className="note">{t('यो व्यवसाय क्लाउडसँग जोडिएको छैन, त्यसैले सर्भरमा तपाईंको डाटा छैन। तल यो फोनको डाटा मात्र मेटाउन सकिन्छ।', 'This business is not connected to the cloud, so the server holds none of your data. Below you can erase the data on this phone only.')}</div>}

      {cloud && req === undefined && <div className="mut">…</div>}
      {cloud && req === null && !online && <div className="note w">{t('अनुरोध पठाउन इन्टरनेट चाहिन्छ।', 'Sending a request needs internet.')}</div>}

      {cloud && open && req && (
        <div className="st" style={{ flex: 'none', borderColor: 'var(--warn)', borderWidth: 2 }}>
          <b style={{ fontSize: 18 }}>{req.type === 'delete_account' ? t('खाता मेटाउने अनुरोध', 'Account deletion request') : t('प्लान रद्द गर्ने अनुरोध', 'Plan cancellation request')}</b>
          <small>{t('पठाइएको: ', 'Sent: ')}{date(req.requestedAt)}</small>
          {req.status === 'pending' && <div style={{ marginTop: 8 }}>⏳ {t('हामी ७ दिनभित्र जाँच गर्छौं। स्वीकृत भएपछि इमेल आउँछ।', 'We review it within 7 days. You will get an email when it is approved.')}</div>}
          {req.status === 'approved' && req.scheduledAt && <div style={{ marginTop: 8 }}>✅ {t('स्वीकृत भयो। सर्भरको डाटा ' + date(req.scheduledAt) + ' मा मेटिन्छ। त्यसअघि रद्द गर्न सकिन्छ।', 'Approved. Server data will be erased on ' + date(req.scheduledAt) + '. You can cancel before that.')}</div>}
          <button className="btn o" style={{ marginTop: 10 }} disabled={busy} onClick={cancel}>{t('अनुरोध रद्द गर्नुस् (खाता चलिरहोस्)', 'Cancel the request (keep my account)')}</button>
        </div>
      )}

      {cloud && req && req.status === 'rejected' && <div className="note">{t('पछिल्लो अनुरोध स्वीकृत भएन।', 'Your last request was not approved.')}{req.note ? ' “' + req.note + '”' : ''}</div>}

      {cloud && req !== undefined && !open && online && (<>
        <div className="h">{t('के गर्ने?', 'What do you want to do?')}</div>
        <div className="row wrap">
          <button className={'pill' + (type === 'delete_account' ? ' on' : '')} onClick={() => setType('delete_account')}>{t('खाता मेटाउने', 'Delete my account')}</button>
          <button className={'pill' + (type === 'cancel_plan' ? ' on' : '')} onClick={() => setType('cancel_plan')}>{t('सशुल्क प्लान मात्र रोक्ने', 'Only stop my paid plan')}</button>
        </div>
        <div className="note">
          {type === 'delete_account'
            ? t('१. अनुरोध पठाउनुस्।  २. हामी ७ दिनभित्र जाँच गरेर स्वीकृत गर्छौं।  ३. स्वीकृत भएको १४ दिनपछि सर्भरको सबै डाटा र लगइन मेटिन्छ।  ४. त्यसअघि जुनसुकै बेला रद्द गर्न सकिन्छ।  तपाईंको फोनमा रहेको डाटा मेटिँदैन।', '1. Send the request.  2. We review and approve it within 7 days.  3. 14 days after approval, all your server data and login are erased.  4. You can cancel any time before then.  Data on your phone is not touched.')
            : t('प्लान रद्द गर्ने अनुरोध स्वीकृत भएपछि तपाईं फ्री प्लानमा जानुहुन्छ। डाटा मेटिँदैन।', 'Once approved you move to the Free plan. Nothing is erased.')}
        </div>
        <label className="f">{t('किन छोड्दै हुनुहुन्छ? (आवश्यक)', 'Why are you leaving? (required)')}
          <select className="in" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">{t('— छान्नुस् —', '— choose —')}</option>{REASONS.map(([k, ne, en]) => <option key={k} value={k}>{t(ne, en)}</option>)}</select></label>
        <label className="f">{t('थप कुरा (ऐच्छिक): के सुधार्न सक्थ्यौं?', 'Anything more? (optional): what could we do better?')}
          <textarea className="in" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} /></label>
        {type === 'delete_account' && (<>
          <Toggle label={t('मैले ब्याकअप / Excel फाइल निकालिसकेँ', 'I have saved a backup / Excel file')} on={backup} onChange={() => setBackup(!backup)} />
          <div className="row wrap"><button className="btn o s" onClick={() => go('books')}>📊 Excel</button><button className="btn o s" onClick={() => go('settings')}>💾 {t('ब्याकअप (सेटिङ)', 'Backup (Settings)')}</button></div>
        </>)}
        <Toggle label={type === 'delete_account' ? t('म बुझ्छु: स्वीकृत भएको १४ दिनपछि सर्भरको डाटा सधैँका लागि मेटिन्छ।', 'I understand: 14 days after approval my server data is erased for good.') : t('म बुझ्छु: प्लान रद्द भएपछि फ्री प्लानमा जान्छु।', 'I understand: I will move to the Free plan.')} on={agree} onChange={() => setAgree(!agree)} />
        <label className="f">{t('पक्का गर्न मालिकको पासवर्ड राख्नुस्', 'Enter the owner password to confirm')}<PwInput className="in" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {err && <div className="note w">{err}</div>}
        <button className="btn w" disabled={!ready || busy} onClick={submit}>{busy ? '…' : type === 'delete_account' ? t('खाता मेटाउने अनुरोध पठाउनुस्', 'Send account deletion request') : t('प्लान रद्द गर्ने अनुरोध पठाउनुस्', 'Send plan cancellation request')}</button>
      </>)}

      <div className="h" style={{ marginTop: 18 }}>{t('यो फोनको डाटा', 'Data on this phone')}</div>
      <div className="note w">{t('यसले ' + s.shopName + ' को यो फोनमा रहेको सबै सामान, बिल र खाता मेटाउँछ। क्लाउडमा ब्याकअप छैन भने फर्किँदैन।', 'This erases all items, bills and khata of ' + s.shopName + ' on this phone. It cannot come back unless the cloud or a backup file has it.')}</div>
      <input className="in" placeholder={t('पक्का गर्न पसलको नाम लेख्नुस्: ', 'To confirm, type the shop name: ') + s.shopName} value={confirmWipe} onChange={(e) => setConfirmWipe(e.target.value)} />
      <button className="btn w" disabled={confirmWipe.trim() !== s.shopName.trim()} onClick={() => wipeThisPhone()}>🗑 {t('यो फोनको डाटा मेटाउनुस्', 'Erase the data on this phone')}</button>
    </div>
  )
}
