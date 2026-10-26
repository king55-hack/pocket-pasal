import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from './ctx'
import { billRows, drawRows, widthPx } from './escpos'
import { PROVINCES, SHOP_TYPES } from './data'
import type { Invoice } from './types'

export function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <div className="toggle">
      <span>{label}</span>
      <button className={'sw' + (on ? ' on' : '')} aria-label={label} aria-pressed={on} onClick={onChange} />
    </div>
  )
}

export function Photo({ src, size }: { src?: string; size?: number }) {
  const { t } = useApp()
  return (
    <div className="photo" style={size ? { width: size, height: size } : undefined}>
      {src ? <img src={src} alt="" /> : <span aria-label={t('फोटो', 'photo')}>📦</span>}
    </div>
  )
}

/** Draws the bill exactly the way the printer will print it, then shows it as an image. */
export function useReceipt(inv: Invoice) {
  const { s, t, n, m, date } = useApp()
  return useMemo(() => {
    const rows = billRows(inv, s, s.lang, { m, n, date })
    const canvas = drawRows(rows, widthPx(s.paper))
    return { canvas, url: canvas.toDataURL('image/png') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv, s, t, n, m, date])
}
export function Receipt({ inv }: { inv: Invoice }) {
  const { url } = useReceipt(inv)
  const { s } = useApp()
  return (
    <div className="receipt">
      <img src={url} alt="bill" style={{ width: widthPx(s.paper) > 600 ? '100%' : undefined }} />
    </div>
  )
}

/** Camera barcode scanner. Uses the browser's BarcodeDetector where it exists, otherwise asks for the code to be typed. */
export function Scanner({ onCode, onClose }: { onCode: (c: string) => void; onClose: () => void }) {
  const { t } = useApp()
  const vid = useRef<HTMLVideoElement>(null)
  const [msg, setMsg] = useState('')
  const [typed, setTyped] = useState('')
  useEffect(() => {
    let stop = false
    let stream: MediaStream | null = null
    ;(async () => {
      const BD = (window as any).BarcodeDetector
      if (!BD || !navigator.mediaDevices?.getUserMedia) {
        setMsg(t('यो फोनको ब्राउजरमा क्यामेरा स्क्यान चल्दैन। कोड टाइप गर्नुस्।', 'Camera scan is not supported in this browser. Type the code instead.'))
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (vid.current) { vid.current.srcObject = stream; await vid.current.play() }
        const det = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] })
        const tick = async () => {
          if (stop || !vid.current) return
          try {
            const r = await det.detect(vid.current)
            if (r[0]?.rawValue) { navigator.vibrate?.(60); onCode(r[0].rawValue); return }
          } catch { /* keep trying */ }
          setTimeout(tick, 250)
        }
        tick()
      } catch {
        setMsg(t('क्यामेरा खोल्न अनुमति चाहिन्छ।', 'Camera permission is needed.'))
      }
    })()
    return () => { stop = true; stream?.getTracks().forEach((x) => x.stop()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="note" style={{ borderStyle: 'solid' }}>
      <video ref={vid} className="scan" muted playsInline />
      {msg && <div className="mut" style={{ margin: '8px 0' }}>{msg}</div>}
      <div className="row" style={{ marginTop: 8 }}>
        <input className="in g" inputMode="numeric" placeholder={t('बारकोड नम्बर', 'Barcode number')} value={typed} onChange={(e) => setTyped(e.target.value)} />
        <button className="btn s" disabled={!typed} onClick={() => onCode(typed.trim())}>OK</button>
      </div>
      <button className="btn o" style={{ marginTop: 8 }} onClick={onClose}>{t('बन्द गर्नुस्', 'Close')}</button>
    </div>
  )
}

export interface ShopFieldValues { shopType: string; shopTypeOther?: string; province: string; district: string; muni: string; ward: string }
/** Shop type, province, district (only the districts of that province), municipality and ward. Pick lists instead of free typing. */
export function ShopFields({ v, set }: { v: ShopFieldValues; set: (k: keyof ShopFieldValues, val: string) => void }) {
  const { t } = useApp()
  const prov = PROVINCES.find((p) => p.id === v.province)
  return (
    <>
      <label className="f">{t('पसलको प्रकार', 'Shop type')}
        <select className="in" value={v.shopType} onChange={(e) => set('shopType', e.target.value)}>{SHOP_TYPES.map((x) => <option key={x.id} value={x.id}>{t(x.ne, x.en)}</option>)}</select></label>
      {v.shopType === 'other' && <input className="in" placeholder={t('कस्तो पसल हो? (जस्तै: खेलकुद सामान)', 'What kind of shop? (for example: sports goods)')} value={v.shopTypeOther ?? ''} onChange={(e) => set('shopTypeOther', e.target.value)} />}
      <div className="row">
        <label className="f g">{t('प्रदेश', 'Province')}
          <select className="in" value={v.province} onChange={(e) => set('province', e.target.value)}>
            <option value="">{t('— छान्नुस् —', '— choose —')}</option>{PROVINCES.map((p) => <option key={p.id} value={p.id}>{t(p.ne, p.en)}</option>)}</select></label>
        <label className="f g">{t('जिल्ला', 'District')}
          <select className="in" value={v.district} disabled={!prov} onChange={(e) => set('district', e.target.value)}>
            <option value="">{prov ? t('— छान्नुस् —', '— choose —') : t('पहिले प्रदेश छान्नुस्', 'Choose province first')}</option>
            {prov?.districts.map(([ne, en]) => <option key={ne} value={ne}>{t(ne, en)}</option>)}</select></label>
      </div>
      <div className="row">
        <label className="f g">{t('नगरपालिका / गाउँपालिका', 'Municipality')}<input className="in" value={v.muni} onChange={(e) => set('muni', e.target.value)} /></label>
        <label className="f" style={{ width: 96 }}>{t('वडा', 'Ward')}
          <select className="in" value={v.ward} onChange={(e) => set('ward', e.target.value)}><option value="">—</option>{Array.from({ length: 35 }, (_, i) => <option key={i} value={String(i + 1)}>{String(i + 1)}</option>)}</select></label>
      </div>
    </>
  )
}
