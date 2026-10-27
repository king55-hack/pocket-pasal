// Builds src/places.json: all 753 local levels (municipalities and rural municipalities) of Nepal with their number of wards,
// grouped by district. Data: https://github.com/sagautam5/local-states-nepal (MIT, Sagar Gautam). Run: node scripts/build-places.mjs
import { writeFileSync } from 'node:fs'
import { PROVINCES } from '../src/data.ts'

const BASE = 'https://raw.githubusercontent.com/sagautam5/local-states-nepal/master/dataset'
const get = async (p) => (await fetch(`${BASE}/${p}`)).json()
const [mEn, mNe, dEn] = await Promise.all([get('municipalities/en.json'), get('municipalities/np.json'), get('districts/en.json')])
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '')
// the source spells a few districts differently from ours
const ALIAS = { rukumeast: 'easternrukum', rukumwest: 'westernrukum', nawalparasibardghatsusta: 'parasi', nawalparasieast: 'nawalpur', nawalparasiwestofbardghatsusta: 'parasi', nawalparasiwest: 'parasi', kavre: 'kavrepalanchok', pachthar: 'panchthar', ramechap: 'ramechhap', parwat: 'parbat', acham: 'achham' }
const ours = new Map(PROVINCES.flatMap((p) => p.districts.map(([ne, en]) => [norm(en), ne])))
const distName = new Map()
const missing = []
for (const d of dEn) {
  const k = ALIAS[norm(d.name)] ?? norm(d.name)
  const ne = ours.get(k)
  if (!ne) missing.push(d.name); else distName.set(d.id, ne)
}
if (missing.length) { console.error('District names that did not match:', missing); process.exit(1) }

const KIND = { 1: 'MC', 2: 'SMC', 3: 'M', 4: 'RM' }
const out = {}
mEn.forEach((e, i) => {
  const ne = mNe[i]
  if (ne.id !== e.id) throw new Error('lists out of step at ' + i)
  const d = distName.get(e.district_id)
  ;(out[d] ??= []).push([ne.name, e.name, KIND[e.category_id], Number(e.wards)])
})
const total = Object.values(out).flat().length
const wards = Object.values(out).flat().reduce((a, x) => a + x[3], 0)
if (total !== 753 || Object.keys(out).length !== 77) throw new Error(`expected 753 local levels in 77 districts, got ${total} in ${Object.keys(out).length}`)
writeFileSync(new URL('../src/places.json', import.meta.url), JSON.stringify(out))
console.log(`places.json: ${total} local levels, ${wards} wards, ${Object.keys(out).length} districts`)
