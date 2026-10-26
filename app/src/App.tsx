import { useApp } from './ctx'
import { Login, Setup } from './screens/Auth'
import { Home } from './screens/Home'
import { Done, Pay, Sale } from './screens/Sale'
import { ItemEdit, Items } from './screens/Items'
import { Ledger, Parties } from './screens/Khata'
import { Books, Bills, Buy, Orders, Returns } from './screens/Books'
import { CloudScreen } from './screens/Cloud'
import { Categories } from './screens/Items'
import { PayConf } from './screens/PayConf'
import { Cctv, Delivery, More, Plans, Settings, Staff, Support, Sync, Upgrade } from './screens/More'
import { useState } from 'react'
import type { Perms } from './types'

const TITLES: Record<string, [string, string]> = {
  home: ['मुख्य पृष्ठ', 'Home'], sale: ['नयाँ बिक्री', 'New sale'], pay: ['भुक्तानी', 'Payment'], done: ['बिल तयार', 'Bill ready'],
  items: ['सामान', 'Items'], itemedit: ['सामान', 'Item'], buy: ['खरिद', 'Purchase'], parties: ['पार्टी', 'Parties'], ledger: ['लेजर', 'Ledger'],
  books: ['खाता', 'Books'], bills: ['मेरा बिल', 'My bills'], returns: ['फिर्ता', 'Returns'], orders: ['अर्डर', 'Orders'], more: ['थप', 'More'],
  settings: ['सेटिङ', 'Settings'], plans: ['प्लान र सदस्यता', 'Plans'], upgrade: ['प्लान चाहिन्छ', 'Upgrade'], staff: ['कर्मचारी', 'Staff'],
  sync: ['सिंक', 'Sync'], cloud: ['क्लाउड खाता', 'Cloud account'], categories: ['सामानका वर्ग', 'Item categories'], payconf: ['QR भुक्तानी', 'QR payments'], support: ['समस्या जानकारी', 'Report an issue'], cctv: ['क्यामेरा', 'CCTV'], delivery: ['डेलिभरी', 'Delivery'],
}
const HELP: Record<string, [string, string]> = {
  home: ['"बेच्नुस्" थिचेर बिक्री सुरु गर्नुस्।', 'Tap "Sell" to start a sale.'],
  sale: ['सामान थिच्नुस् वा स्क्यान गर्नुस्। धेरै बिक्री हुने सामान माथि हुन्छ। एक-दुई अक्षर लेख्दा सुरु मिल्ने पहिले आउँछ।', 'Tap an item or scan it. Best sellers come first. Type a letter or two and names starting with it come first.'],
  pay: ['ग्राहकले कसरी तिर्‍यो छान्नुस्, अनि "बिल बनाउनुस्" थिच्नुस्।', 'Pick how the customer paid, then tap "Create bill".'],
  items: ['धेरै बिक्री हुने सामान माथि हुन्छ। खोज्न एक-दुई अक्षर लेख्नुस्।', 'Best sellers are on top. Type a letter or two to search.'],
  parties: ['ग्राहक थिचेर उसको उधारो हिसाब हेर्नुस्।', 'Tap a customer to see their credit account.'],
  books: ['आजको हिसाब "दैनिक" मा छ।', "Today's numbers are under \"Day\"."],
  returns: ['फिर्ता हुने बिल छान्नुस्, अनि सामान छान्नुस्।', 'Pick the bill, then pick the items coming back.'],
  done: ['प्रिन्टर जोडिएको छैन भने "शेयर" वा PDF प्रयोग गर्नुस्।', 'No printer? Use Share or PDF.'],
}
const OWNER_ONLY = ['cloud', 'payconf', 'settings', 'plans', 'staff', 'delivery']
/** Screens a staff member needs a permission for. The owner has every permission. */
const NEEDS: Record<string, (p: Perms) => boolean> = {
  sale: (p) => p.sell, pay: (p) => p.sell, books: (p) => p.books, buy: (p) => p.purchase, orders: (p) => p.orders,
  parties: (p) => p.credit, ledger: (p) => p.credit, itemedit: (p) => p.editItems, categories: (p) => p.editItems,
  cctv: (p) => p.cctv, returns: (p) => p.returns !== 'off',
}
const LOCK: Record<string, string> = { buy: 'purch', returns: 'returns', orders: 'orders', cctv: 'cctv', delivery: 'delivery', staff: 'staff' }

export default function App() {
  const { ready, hasShop, user, route, back, go, s, own, perms, t, toast, toastMsg, online, pending, can, cloud, syncing } = useApp()
  const [showHelp, setShowHelp] = useState(false)
  if (!ready) return <div className="app" />
  if (!hasShop) return <div className="app"><Setup /></div>
  if (!user) return <div className="app"><Login /></div>

  let name = route.name
  let p = route.params
  if ((OWNER_ONLY.includes(name) && !own) || (NEEDS[name] && !NEEDS[name](perms))) { name = 'home'; p = undefined }
  if (LOCK[name] && !can(LOCK[name])) { p = { f: LOCK[name] }; name = 'upgrade' }

  const title = t(...(TITLES[name] ?? ['', '']))
  const isTab = ['home', 'sale', 'items', 'books', 'bills', 'more'].includes(name)
  const tabs: [string, string, string][] = [
    ['home', '🏠', t('होम', 'Home')],
    ...(perms.sell ? [['sale', '🧾', t('बिक्री', 'Sale')] as [string, string, string]] : []),
    ['items', '📦', t('सामान', 'Items')],
    own || perms.books ? ['books', '📒', t('खाता', 'Books')] : ['bills', '📄', t('बिल', 'Bills')],
    ['more', '☰', t('थप', 'More')],
  ]
  const cur = ['pay', 'done'].includes(name) ? 'sale' : isTab ? name : 'more'
  const help = HELP[name]

  const screen = (() => {
    switch (name) {
      case 'home': return <Home />
      case 'sale': return <Sale />
      case 'pay': return <Pay />
      case 'done': return <Done id={p?.id} />
      case 'items': return <Items />
      case 'itemedit': return <ItemEdit id={p?.id} />
      case 'buy': return <Buy />
      case 'parties': return <Parties />
      case 'ledger': return <Ledger id={p?.id} />
      case 'books': return <Books />
      case 'bills': return <Bills />
      case 'returns': return <Returns />
      case 'orders': return <Orders />
      case 'more': return <More />
      case 'settings': return <Settings />
      case 'plans': return <Plans />
      case 'upgrade': return <Upgrade f={p?.f} />
      case 'staff': return <Staff />
      case 'sync': return <Sync />
      case 'cloud': return <CloudScreen />
      case 'categories': return <Categories />
      case 'payconf': return <PayConf />
      case 'support': return <Support />
      case 'cctv': return <Cctv />
      case 'delivery': return <Delivery />
      default: return <Home />
    }
  })()

  return (
    <div className={'app' + (s.big ? ' big' : '')}>
      <div className="bar">
        {!isTab && <button className="back" aria-label="back" onClick={() => (name === 'done' ? go('home') : back())}>←</button>}
        <b>{name === 'home' ? s.shopName : title}</b>
        {name === 'home' && <button className="chip" onClick={() => go('more')} aria-label="user">👤 {user.name.split(' ')[0]}</button>}
        {help && <button className={'chip' + (showHelp ? ' on' : '')} onClick={() => setShowHelp(!showHelp)}>? {t('मद्दत', 'Help')}</button>}
        <span className={'chip ' + (online ? 'ok' : 'off')} onClick={() => toast(online ? t('इन्टरनेट छ', 'Internet is on') : t('इन्टरनेट छैन। सबै चल्छ, पछि सिंक हुन्छ।', 'No internet. Everything works and syncs later.'))}>
          {online ? t('अनलाइन', 'Online') : t('अफलाइन', 'Offline')}{cloud && pending ? ' · ' + pending : ''}{cloud && syncing ? ' ⟳' : ''}</span>
      </div>
      {showHelp && help && <div className="note" style={{ margin: '10px 14px 0' }}><b>?</b> {t(...help)}</div>}
      {screen}
      <nav className="nav">{tabs.map(([k, ic, lb]) => <button key={k} className={cur === k ? 'on' : ''} onClick={() => go(k)}><span>{ic}</span>{lb}</button>)}</nav>
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  )
}
