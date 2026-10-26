import * as NDM from 'nepali-date-converter'

// The package ships a CommonJS default export; Vite may wrap it once or twice.
const ND: any = (NDM as any).default?.default ?? (NDM as any).default ?? (NDM as any).NepaliDate

const DIG = '०१२३४५६७८९'
export const neDigits = (s: string) => s.replace(/\d/g, (d) => DIG[+d])

export function bsParts(ts: number) {
  const d = new ND(new Date(ts))
  return { y: d.getYear() as number, m: d.getMonth() as number, d: d.getDate() as number }
}
export const bsYear = (ts: number) => bsParts(ts).y

export function fmtDate(ts: number, cal: 'BS' | 'AD', lang: 'ne' | 'en') {
  if (cal === 'BS') {
    const d = new ND(new Date(ts))
    return d.format('YYYY MMMM DD', lang === 'ne' ? 'np' : 'en') as string
  }
  const s = new Date(ts).toISOString().slice(0, 10)
  return lang === 'ne' ? neDigits(s) : s
}
export const fmtTime = (ts: number, lang: 'ne' | 'en') => {
  const s = new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return lang === 'ne' ? neDigits(s) : s
}

export const startOfDay = (ts = Date.now()) => {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
export const round2 = (x: number) => Math.round(x * 100) / 100
