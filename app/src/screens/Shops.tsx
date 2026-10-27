import { useApp } from '../ctx'
import { activeDb, addShop, listShops, switchShop } from '../shops'

/** The businesses on this phone, with a button to open another one or start a new one. */
export function ShopSwitcher() {
  const { t } = useApp()
  const shops = listShops()
  const here = activeDb()
  if (shops.length === 0 || (shops.length === 1 && shops[0].db === here)) {
    // Only one business so far: still offer to add another, but quietly.
    return (
      <div style={{ textAlign: 'center' }}>
        {shops.length === 1 && <button className="btn o s" onClick={addShop}>+ {t('अर्को व्यवसाय थप्नुस्', 'Add another business')}</button>}
      </div>
    )
  }
  return (
    <div className="st" style={{ flex: 'none' }}>
      <small>{t('यो फोनमा भएका व्यवसाय', 'Businesses on this phone')}</small>
      {shops.map((x) => (
        <button key={x.db} className="item tap" style={{ marginTop: 8, ...(x.db === here ? { borderColor: 'var(--acc)', borderWidth: 2 } : {}) }} onClick={() => x.db !== here && switchShop(x.db)}>
          <span style={{ fontSize: 20 }}>🏪</span><div style={{ flex: 1 }}><b>{x.name}</b></div>{x.db === here ? '✔' : '›'}
        </button>
      ))}
      <button className="btn o s" style={{ marginTop: 10 }} onClick={addShop}>+ {t('नयाँ व्यवसाय थप्नुस्', 'Add a new business')}</button>
    </div>
  )
}

/** More → "Switch or add business". */
export function ShopsScreen() {
  const { t, s } = useApp()
  return (
    <div className="body">
      <div className="note">{t('हरेक व्यवसायको सामान, बिल र खाता छुट्टाछुट्टै रहन्छ। अर्कोमा जाँदा त्यसको पासवर्ड चाहिन्छ। क्लाउडको लागि हरेक व्यवसायलाई आफ्नै इमेल प्रयोग गर्नुस्।', 'Each business keeps its own items, bills and khata. Opening another one asks for its own password. For the cloud, use a different email for each business.')}</div>
      <div className="st" style={{ flex: 'none' }}><small>{t('अहिले खुलेको', 'Open now')}</small><b>{s.shopName}</b></div>
      <ShopSwitcher />
    </div>
  )
}
