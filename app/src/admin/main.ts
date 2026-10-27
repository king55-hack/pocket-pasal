// The seller's page: closing requests, shops, plans and tickets. Everything shown is put on the page as plain text, never as HTML.
import { API } from '../api'

type Json = Record<string, any>
const app = document.getElementById('app')!
let key = ''
try { key = sessionStorage.getItem('pp-admin-key') ?? '' } catch { /* private mode */ }

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Json = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  const { class: cls, ...rest } = props
  if (cls) el.className = cls
  Object.assign(el, rest)
  for (const k of kids) el.append(k)
  return el
}
const date = (t?: number | null) => (t ? new Date(t).toISOString().slice(0, 10) : '—')

async function call(path: string, method = 'GET', body?: Json): Promise<Json> {
  const r = await fetch(API + '/admin' + path, { method, headers: { 'x-admin-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error ?? 'failed'), { status: r.status })
  return j
}

function login(msg = '') {
  app.replaceChildren()
  const input = h('input', { type: 'password', placeholder: 'Admin key', autocomplete: 'off' })
  const eye = h('button', { class: 'o', type: 'button', textContent: '👁' })
  eye.onclick = () => { input.type = input.type === 'password' ? 'text' : 'password' }
  const go = h('button', { textContent: 'Open' })
  const enter = async () => {
    key = input.value.trim(); go.disabled = true
    try { await call('/stats'); try { sessionStorage.setItem('pp-admin-key', key) } catch { /* ignore */ } home() } catch (e: any) {
      key = ''
      login(e.status === 429 ? 'Too many wrong keys. Try again in 15 minutes.' : e.status === 403 ? 'Wrong key.' : 'Cannot reach the server.')
    }
  }
  go.onclick = enter
  input.onkeydown = (e) => { if (e.key === 'Enter') enter() }
  app.append(h('div', { class: 'keybox card' }, h('h2', { textContent: 'Pocket Pasal admin' }), h('div', { class: 'row' }, input, eye), h('div', { class: 'row' }, go), h('div', { class: 'err', textContent: msg })))
  input.focus()
}

const TABS = ['Overview', 'Requests', 'Shops', 'Tickets'] as const
type Fail = (e: any) => void

function home(tab: (typeof TABS)[number] = 'Overview') {
  app.replaceChildren()
  const body = h('main')
  const out = h('button', { class: 'o', textContent: 'Log out' })
  out.style.color = '#fff'; out.style.borderColor = '#fff'
  out.onclick = () => { key = ''; try { sessionStorage.removeItem('pp-admin-key') } catch { /* ignore */ } login() }
  app.append(h('header', {}, h('h1', { textContent: 'Pocket Pasal admin' }), out), body)
  body.append(h('div', { class: 'tabs' }, ...TABS.map((t) => h('button', { class: 'o' + (t === tab ? ' on' : ''), textContent: t, onclick: () => home(t) }))))
  const fail: Fail = (e) => {
    if (e.status === 403 || e.status === 429) login(e.status === 429 ? 'Locked for now.' : 'Key no longer works.')
    else body.append(h('div', { class: 'err', textContent: 'Error: ' + e.message }))
  }
  const views = { Overview: overview, Requests: requests, Shops: shops, Tickets: tickets }
  views[tab](body, fail)
}

async function overview(body: HTMLElement, fail: Fail) {
  try {
    const s = await call('/stats')
    const label: Record<string, string> = { shops: 'Shops', newThisWeek: 'New this week', activePhones30d: 'Active phones (30d)', paid: 'Paid', onTrial: 'On trial', waitingRequests: 'Requests waiting', scheduledDeletions: 'Deletions scheduled', tickets: 'Support tickets', emailsLast24h: 'Emails sent (24h)' }
    body.append(h('div', { class: 'stats' }, ...Object.entries(label).map(([k, l]) => h('div', { class: 'card' }, h('b', { textContent: String(s[k] ?? 0) }), h('span', { textContent: l })))))
    const res = h('div', { class: 'mut' })
    const run = h('button', { class: 'o', textContent: 'Run due deletions now' })
    run.onclick = async () => {
      if (!confirm('Erase every shop whose approved date has come? This cannot be undone.')) return
      try { res.textContent = 'Erased ' + (await call('/run-deletions', 'POST')).deleted + ' shop(s).' } catch (e) { fail(e) }
    }
    body.append(h('div', { class: 'row' }, run, res))
  } catch (e) { fail(e) }
}

async function requests(body: HTMLElement, fail: Fail) {
  let status = 'pending'
  const list = h('div')
  const filt = h('div', { class: 'tabs' })
  const draw = async () => {
    filt.replaceChildren(...['pending', 'approved', 'rejected', 'cancelled', 'done'].map((s) => h('button', { class: 'o' + (s === status ? ' on' : ''), textContent: s, onclick: () => { status = s; draw() } })))
    list.replaceChildren()
    try {
      const r = (await call('/closures?status=' + status)).requests as Json[]
      if (!r.length) list.append(h('div', { class: 'mut', textContent: 'Nothing here.' }))
      for (const q of r) {
        const note = h('input', { placeholder: 'Note to the owner (optional)', maxLength: 500 })
        const days = h('input', { type: 'number', value: '14', min: '0', max: '60', title: 'Days until erased' })
        days.style.maxWidth = '90px'
        const ok = h('button', { textContent: 'Approve' })
        const no = h('button', { class: 'bad', textContent: 'Reject' })
        const decide = (what: 'approve' | 'reject') => async () => {
          if (!confirm((what === 'approve' ? 'Approve ' : 'Reject ') + (q.shop_name ?? q.owner_email) + '?')) return
          ok.disabled = no.disabled = true
          try {
            await call('/closures/' + encodeURIComponent(q.id) + '/' + what, 'POST', { note: note.value, ...(what === 'approve' && q.type === 'delete_account' ? { graceDays: Number(days.value) } : {}) })
            draw()
          } catch (e) { ok.disabled = no.disabled = false; fail(e) }
        }
        ok.onclick = decide('approve'); no.onclick = decide('reject')
        list.append(h('div', { class: 'card' },
          h('b', { textContent: (q.type === 'delete_account' ? 'Delete account' : 'Cancel plan') + ' — ' + (q.shop_name ?? '') }),
          h('div', { class: 'mut', textContent: q.owner_email + ' · asked ' + date(q.requested_at) + (q.scheduled_at ? ' · erase on ' + date(q.scheduled_at) : '') }),
          h('div', { textContent: 'Reason: ' + q.reason_code + (q.reason_text ? ' — ' + q.reason_text : '') }),
          ...(q.decision_note ? [h('div', { class: 'mut', textContent: 'Note: ' + q.decision_note })] : []),
          ...(q.status === 'pending' ? [h('div', { class: 'row' }, note, ...(q.type === 'delete_account' ? [days, h('span', { class: 'mut', textContent: 'days' })] : []), ok, no)] : [])))
      }
    } catch (e) { fail(e) }
  }
  body.append(filt, list)
  draw()
}

async function shops(body: HTMLElement, fail: Fail) {
  const q = h('input', { placeholder: 'Search shop name or email', maxLength: 60 })
  const list = h('div')
  const draw = async () => {
    list.replaceChildren()
    try {
      for (const s of (await call('/shops?q=' + encodeURIComponent(q.value))).shops as Json[]) {
        const plan = h('select', {}, ...['free', 'pro', 'max'].map((p) => h('option', { value: p, textContent: p })))
        const days = h('input', { type: 'number', value: '30', min: '0', max: '3650' })
        days.style.maxWidth = '90px'
        const set = h('button', { textContent: 'Set plan' })
        set.onclick = async () => {
          if (!confirm('Set ' + s.email + ' to ' + plan.value + ' for ' + days.value + ' days?')) return
          try { await call('/plan', 'POST', { email: s.email, plan: plan.value, days: Number(days.value), endTrial: true }); draw() } catch (e) { fail(e) }
        }
        list.append(h('div', { class: 'card' },
          h('b', { textContent: s.name }),
          h('div', { class: 'mut', textContent: s.email + ' · plan ' + s.effectivePlan + ' · ' + s.devices + ' phone(s) · ' + s.records + ' records · last seen ' + date(s.last_seen) + ' · joined ' + date(s.created_at) }),
          h('div', { class: 'row' }, plan, days, h('span', { class: 'mut', textContent: 'days' }), set)))
      }
    } catch (e) { fail(e) }
  }
  q.onkeydown = (e) => { if (e.key === 'Enter') draw() }
  body.append(h('div', { class: 'row' }, q, h('button', { textContent: 'Search', onclick: draw })), list)
  draw()
}

async function tickets(body: HTMLElement, fail: Fail) {
  try {
    const r = (await call('/tickets')).tickets as Json[]
    if (!r.length) body.append(h('div', { class: 'mut', textContent: 'No tickets.' }))
    for (const t of r) body.append(h('div', { class: 'card' }, h('b', { textContent: t.category + ' — ' + (t.shop ?? '') }), h('div', { class: 'mut', textContent: date(t.created_at) }), h('div', { textContent: t.message })))
  } catch (e) { fail(e) }
}

if (key) call('/stats').then(() => home()).catch(() => login())
else login()
