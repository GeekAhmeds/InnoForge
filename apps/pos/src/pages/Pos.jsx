import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, formatQty, fromMinor, toMinor } from '../lib/money.js';
import { a4Html, checkHtml, kitchenHtml, receiptHtml } from '../lib/receipt.js';
import { sellScreens } from '../lib/screens.js';
import { Empty, Field, Modal, Toggle, useApp } from '../components/ui.jsx';

const emptyCart = (orderType) => ({
  id: null, order_type: orderType, table_id: null, table_name: '', items: [], discount: 0,
  customer_id: null, customer_name: '', customer_phone: '', customer_address: '', note: '',
});

// Converts a stored open order back into an editable cart.
const cartFromOrder = (o) => ({
  id: o.id, order_type: o.order_type, table_id: o.table_id, table_name: o.table_name || '', guests: o.guests || 0,
  discount: o.discount, customer_id: o.customer_id, customer_name: o.customer_name, customer_phone: o.customer_phone,
  customer_address: o.customer_address, note: o.note,
  salesperson_id: o.salesperson_id,
  items: o.items.map((i) => ({
    id: i.id, product_id: i.product_id, unit_id: i.unit_id, name: i.name, unit_price: i.unit_price, list_price: i.unit_price, qty: i.qty,
    // Stored discounts include automatic promotions, which are re-applied on their own.
    discount: Math.max(0, i.discount - (i.promo_discount || 0) - (i.customer_discount || 0)), note: i.note, serials: i.serials || '', kitchen_sent: i.kitchen_sent,
  })),
});

export default function Pos() {
  const app = useApp();
  const { settings, shift, t, tErr, notify, printDoc, lang, withApproval, pendingCart, setPendingCart, setPage, ask } = app;
  const floorOn = sellScreens(settings).includes('restaurant');
  const [lastSale, setLastSale] = useState(null);
  const [salespeople, setSalespeople] = useState([]);
  useEffect(() => { api.auth.salespeople().then(setSalespeople).catch(() => {}); }, []);
  // Only offer the salesperson picker when someone besides the cashier earns commission.
  const reps = salespeople.filter((p) => p.commission_rate > 0);
  const [priceLists, setPriceLists] = useState([]);
  useEffect(() => { api.priceLists.list().then((l) => setPriceLists(l.filter((x) => x.active))).catch(() => {}); }, []);
  const restaurant = settings.business_type === 'restaurant' || floorOn;
  const defaultType = restaurant ? 'takeaway' : 'sale';

  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [categoryId, setCategoryId] = useState(null);
  const [search, setSearch] = useState('');
  // A quotation opened from the Customers page arrives as a pending cart.
  const [cart, setCart] = useState(() => (pendingCart ? { ...emptyCart(defaultType), ...pendingCart } : emptyCart(defaultType)));
  useEffect(() => { if (pendingCart) setPendingCart(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [quote, setQuote] = useState(null);
  const [modal, setModal] = useState(null); // {kind, ...}
  const searchRef = useRef(null);
  const m = (v) => formatMoney(v, settings);

  const focusSearch = useCallback(() => setTimeout(() => searchRef.current?.focus(), 0), []);

  useEffect(() => { api.categories.list().then(setCategories); }, []);
  useEffect(() => {
    const h = setTimeout(() => api.products.list(categoryId === 'top' && !search ? { top: true } : { search, categoryId: categoryId === 'top' ? null : categoryId }).then(setProducts).catch((e) => notify(tErr(e), 'error')), 120);
    return () => clearTimeout(h);
  }, [search, categoryId, notify, tErr]);

  // Totals always come from the main process so tax/service rules live in one place.
  useEffect(() => {
    if (!cart.items.length) { setQuote(null); return; }
    let live = true;
    api.orders.quote(cart).then((q) => live && setQuote(q)).catch((e) => notify(tErr(e), 'error'));
    return () => { live = false; };
  }, [cart, notify, tErr]);

  // A scanned unit barcode (e.g. a carton) adds that unit; the server prices it.
  const addProduct = useCallback((p, qty = 1, unit = null) => {
    setCart((c) => {
      const unitId = unit?.id ?? null;
      const idx = c.items.findIndex((i) => i.product_id === p.id && (i.unit_id ?? null) === unitId && !i.note && !i.discount && !i.price_override);
      const items = [...c.items];
      const price = unit ? unit.price ?? Math.round(p.price * unit.factor) : p.price;
      if (idx >= 0) items[idx] = { ...items[idx], qty: items[idx].qty + qty };
      else items.push({ product_id: p.id, unit_id: unitId, name: unit ? `${p.name} (${unit.name})` : p.name, unit_price: price, list_price: price, qty, discount: 0, note: '', serials: '', kitchen_sent: 0, track_serial: !!p.track_serial });
      return { ...c, items };
    });
    setLastSale(null);
  }, []);

  async function onSearchEnter() {
    const q = search.trim();
    if (!q) return;
    // Barcode scanners type the code and press Enter; support "3*code" for quantity.
    const [, qtyStr, code] = q.match(/^(\d+(?:\.\d+)?)\*(.+)$/) || [null, null, q];
    const byCode = await api.products.byBarcode(code);
    if (byCode) {
      addProduct(byCode, qtyStr ? Number(qtyStr) : 1, byCode.unit || null);
      setSearch('');
    } else if (products.length === 1) {
      addProduct(products[0]);
      setSearch('');
    } else {
      notify(t('pos.notFound'), 'error');
    }
  }

  const reset = useCallback(() => { setCart(emptyCart(defaultType)); focusSearch(); }, [defaultType, focusSearch]);
  // A new dine-in order needs a table; an existing one (e.g. a split bill) can be paid without.
  const needsTable = () => cart.order_type === 'dine_in' && !cart.table_id && !cart.id;
  // Table orders go back to the floor plan once saved, sent or paid.
  const done = useCallback((c) => { if (floorOn && c.order_type === 'dine_in') setPage('floor'); else reset(); }, [floorOn, setPage, reset]);

  async function saveOpen() {
    const saved = await api.orders.saveOpen(cart);
    setCart(cartFromOrder(saved));
    return saved;
  }

  async function run(fn) {
    try { return await fn(); } catch (err) { if (err.code !== 'CANCELLED') notify(tErr(err), 'error'); return undefined; }
  }

  const holdOrSave = () => run(async () => {
    if (needsTable()) return setModal({ kind: 'tables' });
    await saveOpen();
    notify(t('pos.orderSaved'));
    done(cart);
  });

  const sendKitchen = () => run(async () => {
    if (needsTable()) return setModal({ kind: 'tables' });
    const saved = await saveOpen();
    const { order, items } = await api.orders.sendToKitchen(saved.id);
    setCart(cartFromOrder(order));
    if (!items.length) return notify(t('pos.nothingNew'));
    if (await printDoc(kitchenHtml(order, items, settings, t, lang), settings.kitchen_printer_name || settings.printer_name)) {
      notify(t('pos.kitchenSent'));
    }
    if (floorOn && order.order_type === 'dine_in') setPage('floor');
  });

  const printCheck = () => run(async () => {
    const saved = await saveOpen();
    const o = await api.floor.printCheck(saved.id);
    await printDoc(checkHtml(o, settings, t, lang));
    done(cart);
  });

  const setGuests = async () => {
    const g = await ask(t('floor.guestsShort'), { type: 'number', initial: String(cart.guests || '') });
    if (g !== null) setCart((c) => ({ ...c, guests: Number(g) || 0 }));
  };

  const openPay = () => run(async () => {
    if (!cart.items.length || !quote) return;
    if (needsTable()) return setModal({ kind: 'tables' });
    const customer = cart.customer_id ? await api.customers.get(cart.customer_id) : null;
    setModal({ kind: 'pay', customer });
  });

  useEffect(() => {
    const onKey = (e) => {
      if (modal) return;
      if (e.key === 'F2') { e.preventDefault(); focusSearch(); }
      if (e.key === 'F9') { e.preventDefault(); openPay(); }
      if (e.key === 'F4') { e.preventDefault(); setModal({ kind: 'customer' }); }
      if (e.key === 'F8' && cart.items.length) { e.preventDefault(); holdOrSave(); }
      if (e.key === 'Escape' && search) { e.preventDefault(); setSearch(''); }
      // With an empty search box: +/- change the last line's quantity, Delete removes it.
      const otherField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) && e.target !== searchRef.current;
      if (!otherField && !search && cart.items.length && ['+', '-', 'Delete'].includes(e.key)) {
        e.preventDefault();
        const last = cart.items.length - 1;
        setCart((c) => ({
          ...c,
          items: e.key === 'Delete' ? c.items.slice(0, -1)
            : c.items.map((x, i) => (i === last ? { ...x, qty: Math.max(1, x.qty + (e.key === '+' ? 1 : -1)) } : x)),
        }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!shift) return <NoShift />;

  const setType = (order_type) => {
    setCart((c) => ({ ...c, order_type, table_id: order_type === 'dine_in' ? c.table_id : null, table_name: order_type === 'dine_in' ? c.table_name : '' }));
    if (order_type === 'dine_in' && !cart.table_id) setModal({ kind: 'tables' });
  };

  return (
    <div className="pos">
      <section className="catalog">
        <div className="pos-search">
          <input
            ref={searchRef}
            autoFocus
            placeholder={t('pos.scan')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()}
          />
          {!restaurant && <button onClick={() => setModal({ kind: 'held' })}>⏸ {t('pos.held')}</button>}
          {restaurant && (floorOn
            ? <button onClick={() => setPage('floor')}>🍽 {t('nav.floor')}</button>
            : <button onClick={() => setModal({ kind: 'tables' })}>🍽 {t('nav.tables')}</button>)}
          {restaurant && <button onClick={() => setModal({ kind: 'held' })}>📋 {t('orders.open')}</button>}
        </div>
        <div className="chips">
          <button className={!categoryId ? 'on' : ''} onClick={() => setCategoryId(null)}>{t('pos.allCategories')}</button>
          <button className={categoryId === 'top' ? 'on' : ''} style={{ '--chip': '#f7a531' }} onClick={() => setCategoryId('top')}>⭐ {t('pos.topSellers')}</button>
          {categories.map((c) => (
            <button key={c.id} className={categoryId === c.id ? 'on' : ''} style={{ '--chip': c.color }} onClick={() => setCategoryId(c.id)}>{c.name}</button>
          ))}
        </div>
        <div className="product-grid">
          {products.map((p) => (
            <button key={p.id} className="product" style={{ '--chip': p.category_color || '#94a3b8' }} onClick={() => { addProduct(p); focusSearch(); }}>
              <span className="p-name">{p.name}</span>
              {p.author && <span className="p-sub">{p.author}</span>}
              <span className="p-price">{m(p.price)}</span>
              {p.track_stock ? <span className={`p-stock ${p.stock <= p.min_stock ? 'low' : ''}`}>{p.stock > 0 ? formatQty(p.stock) : t('pos.outOfStock')}</span> : null}
            </button>
          ))}
          {!products.length && <Empty>{categoryId === 'top' ? t('pos.noTopSellers') : t('common.none')}</Empty>}
        </div>
        <div className="shortcuts muted small">
          {[['F2', t('pos.kSearch')], ['F4', t('pos.customer')], ['F8', t('pos.hold')], ['F9', t('pos.pay')], ['+ − Del', t('pos.kLast')]].map(([k, v]) => <span key={k}><kbd dir="ltr">{k}</kbd> {v}</span>)}
        </div>
      </section>

      <section className="cart">
        {restaurant && (
          <div className="seg full">
            {['dine_in', 'takeaway', 'delivery'].map((ty) => (
              <button key={ty} className={cart.order_type === ty ? 'on' : ''} onClick={() => setType(ty)}>{t(`order.${ty}`)}</button>
            ))}
          </div>
        )}
        <div className="cart-head">
          <b>{t('pos.cart')}{cart.id ? ` #${cart.id}` : ''}</b>
          {cart.order_type === 'dine_in' && (
            <button className="ghost" onClick={() => (floorOn && !cart.table_id ? setPage('floor') : setModal({ kind: 'tables' }))}>
              {cart.table_id ? `${t('pos.table')} ${cart.table_name}` : cart.id && cart.note ? `✂ ${cart.note}` : t('pos.chooseTable')}
            </button>
          )}
          {cart.order_type === 'dine_in' && <button className="ghost" onClick={setGuests}>👥 {cart.guests || '—'}</button>}
          <button className={cart.customer_id ? 'customer-chip' : 'ghost'} onClick={() => setModal({ kind: 'customer' })}>👤 {cart.customer_name || t('pos.customer')}</button>
          {priceLists.length > 0 && (
            <select className="rep-select" title={t('priceLists.title')} value={cart.price_list_id || ''} onChange={(e) => setCart((c) => ({ ...c, price_list_id: Number(e.target.value) || null }))}>
              <option value="">💲 {t('priceLists.retail')}</option>
              {priceLists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {cart.quote_no && <span className="badge credit">{t('quotes.quote')} #{cart.quote_no}</span>}
          {reps.length > 0 && (
            <select className="rep-select" title={t('pos.salesperson')} value={cart.salesperson_id || ''} onChange={(e) => setCart((c) => ({ ...c, salesperson_id: Number(e.target.value) || null }))}>
              <option value="">🧑‍💼 {t('pos.salesperson')}</option>
              {reps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>

        <div className="cart-lines">
          {!cart.items.length && lastSale && (
            <div className="last-sale">
              <div>✓ {t('pos.lastSale', { n: lastSale.invoice_no })}</div>
              {lastSale.change_due > 0 && <div className="change">{t('pay.change')}: <b>{m(lastSale.change_due)}</b></div>}
              <button onClick={() => printDoc(receiptHtml(lastSale, settings, t, lang))}>🖨 {t('orders.reprint')}</button>
            </div>
          )}
          {!cart.items.length && !lastSale && <Empty>{t('pos.empty')}</Empty>}
          {cart.items.map((it, idx) => {
            const ql = quote?.lines?.[idx];
            return (
              <div key={idx} className="line" onClick={() => setModal({ kind: 'line', idx })}>
                <div className="line-main">
                  <span className="line-name">{it.name}</span>
                  {it.note && <small className="muted">{it.note}</small>}
                  {it.kitchen_sent > 0 && <small className="sent">✓ {formatQty(it.kitchen_sent)}</small>}
                  {ql?.customer_discount > 0 && <small className="promo">👤 {t('pos.customerDiscount', { p: quote.customerPct })} −{m(ql.customer_discount)}</small>}
                  {ql?.promo_name && <small className="promo">🏷 {ql.promo_name} −{m(ql.promo_discount)}</small>}
                </div>
                <div className="qty" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => setCart((c) => ({ ...c, items: c.items.map((x, i) => (i === idx ? { ...x, qty: Math.max(1, x.qty - 1) } : x)) }))}>−</button>
                  <span>{formatQty(it.qty)}</span>
                  <button onClick={() => setCart((c) => ({ ...c, items: c.items.map((x, i) => (i === idx ? { ...x, qty: x.qty + 1 } : x)) }))}>+</button>
                </div>
                <span className="line-total">{m(ql ? ql.line_total : it.unit_price * it.qty)}</span>
              </div>
            );
          })}
        </div>

        <div className="totals">
          <Row label={t('pos.subtotal')} value={m(quote?.subtotal)} />
          <Row label={t('pos.discount')} value={quote?.discount ? '− ' + m(quote.discount) : m(0)} onClick={() => cart.items.length && setModal({ kind: 'discount' })} link />
          {quote?.service ? <Row label={`${t('pos.service')} (${settings.service_rate}%)`} value={m(quote.service)} /> : null}
          {settings.tax_rate ? <Row label={`${t('pos.tax')} (${settings.tax_rate}%)`} value={m(quote?.tax)} /> : null}
          <Row label={t('pos.total')} value={m(quote?.total)} big />
        </div>

        <div className="cart-actions three">
          {restaurant && <button onClick={sendKitchen} disabled={!cart.items.length}>🔔 {t('pos.kitchen')}</button>}
          {cart.order_type === 'dine_in' && <button onClick={printCheck} disabled={!cart.items.length || !cart.table_id}>🧾 {t('floor.check')}</button>}
          <button onClick={holdOrSave} disabled={!cart.items.length}>{restaurant ? t('pos.saveOrder') : `⏸ ${t('pos.hold')}`}</button>
          {!restaurant && <button onClick={() => setModal({ kind: 'quote' })} disabled={!cart.items.length || !!cart.id}>📝 {t('quotes.save')}</button>}
          <button
            className="danger-ghost"
            onClick={() => run(async () => {
              if (cart.id) {
                if (!window.confirm(t('common.areYouSure'))) return;
                await withApproval((approval) => api.orders.voidOpen({ id: cart.id, approval }));
              }
              reset();
            })}
          >
            {cart.id ? t('pos.voidOrder') : t('pos.clear')}
          </button>
          <button className="primary pay" onClick={openPay} disabled={!cart.items.length}>{t('pos.pay')}</button>
        </div>
      </section>

      {modal?.kind === 'line' && (
        <LineModal
          item={cart.items[modal.idx]}
          onClose={() => { setModal(null); focusSearch(); }}
          onSave={(patch) => { setCart((c) => ({ ...c, items: c.items.map((x, i) => (i === modal.idx ? { ...x, ...patch } : x)) })); setModal(null); focusSearch(); }}
          onRemove={() => { setCart((c) => ({ ...c, items: c.items.filter((_, i) => i !== modal.idx) })); setModal(null); focusSearch(); }}
        />
      )}
      {modal?.kind === 'discount' && (
        <DiscountModal
          subtotal={quote?.subtotal || 0}
          current={cart.discount}
          onClose={() => setModal(null)}
          onSave={(discount) => { setCart((c) => ({ ...c, discount })); setModal(null); }}
        />
      )}
      {modal?.kind === 'customer' && (
        <CustomerModal cart={cart} onClose={() => setModal(null)} onSave={(patch) => { setCart((c) => ({ ...c, ...patch })); setModal(null); }} />
      )}
      {modal?.kind === 'tables' && (
        <TablesModal
          onClose={() => setModal(null)}
          onPick={(table) => run(async () => {
            if (table.order_id && table.order_id !== cart.id) {
              setCart(cartFromOrder(await api.orders.get(table.order_id)));
            } else {
              setCart((c) => ({ ...c, order_type: 'dine_in', table_id: table.id, table_name: table.name }));
            }
            setModal(null);
          })}
        />
      )}
      {modal?.kind === 'quote' && (
        <QuoteModal
          onClose={() => setModal(null)}
          onSave={(extra, printIt) => run(async () => {
            const q = await api.quotes.create({ ...cart, ...extra });
            notify(t('quotes.saved', { n: q.quote_no }));
            if (printIt) await printDoc(a4Html(q, 'quote', settings, t, lang), settings.a4_printer_name);
            setModal(null);
            reset();
          })}
        />
      )}
      {modal?.kind === 'held' && (
        <HeldModal
          onClose={() => setModal(null)}
          onPick={(id) => run(async () => { setCart(cartFromOrder(await api.orders.get(id))); setModal(null); })}
        />
      )}
      {modal?.kind === 'pay' && quote && (
        <PayModal
          total={quote.total}
          customer={modal.customer}
          onClose={() => { setModal(null); focusSearch(); }}
          onPay={(payments, printReceipt, redeemPoints) => run(async () => {
            const order = await withApproval((approval) => api.orders.checkout({ ...cart, payments, approval, redeem_points: redeemPoints || 0 }));
            setModal(null);
            notify(t('pay.done', { n: order.invoice_no }));
            if (printReceipt) {
              if (settings.invoice_format === 'a4') await printDoc(a4Html(order, 'invoice', settings, t, lang), settings.a4_printer_name);
              else await printDoc(receiptHtml(order, settings, t, lang));
            }
            setLastSale(order);
            done(cart);
          })}
        />
      )}
    </div>
  );
}

function QuoteModal({ onClose, onSave }) {
  const { t } = useApp();
  const d = new Date();
  d.setDate(d.getDate() + 14);
  const [validUntil, setValidUntil] = useState(d.toLocaleDateString('en-CA'));
  const [printIt, setPrintIt] = useState(true);
  return (
    <Modal title={`📝 ${t('quotes.save')}`} onClose={onClose} width={420}
      footer={<><Toggle checked={printIt} onChange={setPrintIt} label={t('a4.printA4')} /><span className="spacer" /><button className="primary" onClick={() => onSave({ valid_until: validUntil }, printIt)}>{t('common.save')}</button></>}>
      <p className="muted">{t('quotes.hint')}</p>
      <Field label={t('a4.validUntil')}><input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
    </Modal>
  );
}

function Row({ label, value, big, link, onClick }) {
  return (
    <div className={`trow ${big ? 'big' : ''} ${link ? 'link' : ''}`} onClick={onClick}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}

export function NoShift() {
  const { t, tErr, notify, reloadShift, settings } = useApp();
  const [cash, setCash] = useState('');
  return (
    <div className="center-screen inner">
      <form
        className="card narrow"
        onSubmit={async (e) => {
          e.preventDefault();
          try { await api.shifts.open({ openingCash: toMinor(cash, settings.decimals) }); await reloadShift(); } catch (err) { notify(tErr(err), 'error'); }
        }}
      >
        <h2>⏱ {t('shift.none')}</h2>
        <p className="muted">{t('shift.openPrompt')}</p>
        <Field label={t('shift.openingCash')}><input autoFocus inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" /></Field>
        <button className="primary lg">{t('shift.open')}</button>
      </form>
    </div>
  );
}

function LineModal({ item, onClose, onSave, onRemove }) {
  const { t, settings } = useApp();
  const [product, setProduct] = useState(null);
  useEffect(() => { api.products.get(item.product_id).then(setProduct).catch(() => {}); }, [item.product_id]);
  const [unitId, setUnitId] = useState(item.unit_id ?? '');
  const [serials, setSerials] = useState(item.serials || '');
  const [qty, setQty] = useState(String(item.qty));
  const [discount, setDiscount] = useState(item.discount ? fromMinor(item.discount, settings.decimals) : '');
  const [note, setNote] = useState(item.note);
  const [price, setPrice] = useState(fromMinor(item.unit_price, settings.decimals));
  // A changed price is flagged so checkout can ask for the price_override permission.
  const save = () => {
    const newPrice = toMinor(price, settings.decimals);
    const changed = newPrice !== item.unit_price || item.price_override;
    const unit = product?.units.find((u) => u.id === Number(unitId)) || null;
    const unitChanged = (unit?.id ?? null) !== (item.unit_id ?? null);
    // Switching unit resets the price to that unit's standard price (the server re-prices it).
    const std = unit ? unit.price ?? Math.round(product.price * unit.factor) : product?.price ?? item.list_price;
    onSave({
      qty: Math.max(0.001, Number(qty) || 1), discount: toMinor(discount, settings.decimals), note, serials,
      unit_id: unit?.id ?? null, name: product ? (unit ? `${product.name} (${unit.name})` : product.name) : item.name,
      unit_price: unitChanged ? std : newPrice, list_price: unitChanged ? std : item.list_price,
      price_override: !unitChanged && changed && newPrice !== item.list_price,
    });
  };
  return (
    <Modal
      title={item.name}
      onClose={onClose}
      footer={<>
        <button className="danger-ghost" onClick={onRemove}>{t('common.delete')}</button>
        <span className="spacer" />
        <button onClick={onClose}>{t('common.cancel')}</button>
        <button className="primary" onClick={save}>{t('common.save')}</button>
      </>}
    >
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid2">
        <Field label={t('pos.qty')}><input autoFocus inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} onFocus={(e) => e.target.select()} /></Field>
        <Field label={t('pos.lineDiscount')}><input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" /></Field>
        <Field label={t('pos.price')} hint={item.list_price != null && toMinor(price, settings.decimals) !== item.list_price ? t('pos.priceChanged') : ''}>
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        {product?.units?.length ? (
          <Field label={t('units.unit')}>
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">{product.unit || t('units.base')}</option>
              {product.units.map((u) => <option key={u.id} value={u.id}>{u.name} × {formatQty(u.factor)}</option>)}
            </select>
          </Field>
        ) : <span />}
        {(product?.track_serial || item.serials) && (
          <div className="span2"><Field label={t('pos.serials')} hint={t('pos.serialsHint', { n: Math.round(Number(qty || 1) * (product?.units.find((u) => u.id === Number(unitId))?.factor || 1)) })}>
            <textarea dir="ltr" className="mono" rows={2} value={serials} onChange={(e) => setSerials(e.target.value)} />
          </Field></div>
        )}
        <div className="span2"><Field label={t('pos.note')}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
        <button hidden />
      </form>
    </Modal>
  );
}

function DiscountModal({ subtotal, current, onClose, onSave }) {
  const { t, settings } = useApp();
  const [mode, setMode] = useState('amount');
  const [value, setValue] = useState(current ? fromMinor(current, settings.decimals) : '');
  const compute = () => (mode === 'percent' ? Math.round((subtotal * (Number(value) || 0)) / 100) : toMinor(value, settings.decimals));
  return (
    <Modal
      title={t('pos.orderDiscount')}
      onClose={onClose}
      width={420}
      footer={<>
        <button onClick={() => onSave(0)}>{t('pos.clear')}</button>
        <span className="spacer" />
        <button className="primary" onClick={() => onSave(compute())}>{t('common.save')}</button>
      </>}
    >
      <form onSubmit={(e) => { e.preventDefault(); onSave(compute()); }}>
        <div className="seg full">
          <button type="button" className={mode === 'amount' ? 'on' : ''} onClick={() => setMode('amount')}>{t('pos.discountAmount')}</button>
          <button type="button" className={mode === 'percent' ? 'on' : ''} onClick={() => setMode('percent')}>{t('pos.discountPercent')}</button>
        </div>
        <input className="xl" autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        <p className="muted">= {formatMoney(compute(), settings)}</p>
      </form>
    </Modal>
  );
}

function CustomerModal({ cart, onClose, onSave }) {
  const { t, tErr, notify, settings } = useApp();
  const [f, setF] = useState({
    customer_id: cart.customer_id, customer_name: cart.customer_name, customer_phone: cart.customer_phone,
    customer_address: cart.customer_address, note: cart.note,
  });
  const [search, setSearch] = useState('');
  const [list, setList] = useState([]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const m = (v) => formatMoney(v, settings);

  useEffect(() => {
    const h = setTimeout(() => api.customers.list({ search }).then((r) => setList(r.slice(0, 8))).catch(() => {}), 120);
    return () => clearTimeout(h);
  }, [search]);

  const pick = (c) => setF((x) => ({ ...x, customer_id: c.id, customer_name: c.name, customer_phone: c.phone, customer_address: c.address, price_list_id: c.price_list_id || null }));

  // Saves the typed details as a new customer account so the sale can go on credit.
  async function createAccount() {
    try {
      const id = await api.customers.save({ name: f.customer_name, phone: f.customer_phone, address: f.customer_address });
      setF((x) => ({ ...x, customer_id: id }));
      notify(t('customers.created'));
    } catch (err) {
      notify(tErr(err), 'error');
    }
  }

  return (
    <Modal title={t('pos.customer')} onClose={onClose} width={640}
      footer={<>
        {f.customer_id && <button className="danger-ghost" onClick={() => setF((x) => ({ ...x, customer_id: null }))}>{t('customers.unlink')}</button>}
        <span className="spacer" />
        <button className="primary" onClick={() => onSave(f)}>{t('common.save')}</button>
      </>}>
      {f.customer_id ? (
        <div className="linked-customer">✓ {t('customers.linked')}: <b>{f.customer_name}</b> {f.customer_phone && <span className="mono" dir="ltr">{f.customer_phone}</span>}</div>
      ) : (
        <>
          <input autoFocus placeholder={t('customers.searchHint')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="customer-results">
            {list.map((c) => (
              <button key={c.id} type="button" onClick={() => pick(c)}>
                <span><b>{c.name}</b> <small className="muted" dir="ltr">{c.phone}</small></span>
                {c.balance > 0 && <small className="warn">{t('customers.owes')} {m(c.balance)}</small>}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="grid2 top-gap">
        <Field label={t('pos.customerName')}><input value={f.customer_name} onChange={set('customer_name')} /></Field>
        <Field label={t('pos.customerPhone')}><input value={f.customer_phone} onChange={set('customer_phone')} /></Field>
        <div className="span2"><Field label={t('pos.customerAddress')}><input value={f.customer_address} onChange={set('customer_address')} /></Field></div>
        <div className="span2"><Field label={t('pos.note')}><input value={f.note} onChange={set('note')} /></Field></div>
      </div>
      {!f.customer_id && f.customer_name.trim() && (
        <button type="button" onClick={createAccount}>+ {t('customers.saveAsAccount')}</button>
      )}
    </Modal>
  );
}

function TablesModal({ onClose, onPick }) {
  const { t, settings } = useApp();
  const [tables, setTables] = useState(null);
  useEffect(() => { api.tables.list().then(setTables); }, []);
  const areas = useMemo(() => [...new Set((tables || []).map((x) => x.area))], [tables]);
  return (
    <Modal title={t('pos.chooseTable')} onClose={onClose} width={760}>
      {!tables ? t('common.loading') : !tables.length ? <Empty>{t('common.none')}</Empty> : areas.map((area) => (
        <div key={area}>
          {area && <h4>{area}</h4>}
          <div className="table-grid">
            {tables.filter((x) => x.area === area).map((x) => (
              <button key={x.id} className={`table-tile ${x.order_id ? 'busy' : ''}`} onClick={() => onPick(x)}>
                <b>{x.name}</b>
                <small>{x.order_id ? formatMoney(x.order_total, settings) : t('pos.free')}</small>
              </button>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}

function HeldModal({ onClose, onPick }) {
  const { t, settings } = useApp();
  const [list, setList] = useState(null);
  useEffect(() => { api.orders.listOpen().then(setList); }, []);
  return (
    <Modal title={settings.business_type === 'restaurant' ? t('orders.open') : t('pos.held')} onClose={onClose} width={640}>
      {!list ? t('common.loading') : !list.length ? <Empty>{t('common.none')}</Empty> : (
        <table className="grid">
          <tbody>
            {list.map((o) => (
              <tr key={o.id} className="clickable" onClick={() => onPick(o.id)}>
                <td>#{o.id}</td>
                <td>{t(`order.${o.order_type}`)}{o.table_name ? ` — ${t('pos.table')} ${o.table_name}` : ''}</td>
                <td>{o.customer_name}</td>
                <td>{o.item_count}</td>
                <td className="muted">{o.created_at.slice(11, 16)}</td>
                <td className="num">{formatMoney(o.total, settings)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

const METHODS = ['cash', 'card', 'wallet'];

function PayModal({ total, customer, onClose, onPay }) {
  const { t, settings } = useApp();
  const d = settings.decimals;
  const [amounts, setAmounts] = useState({ cash: fromMinor(total, d), card: '', wallet: '' });
  const [active, setActive] = useState('cash');
  const [printReceipt, setPrintReceipt] = useState(true);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const loyaltyOn = settings.loyalty_enabled && customer;
  const [redeem, setRedeem] = useState(0);
  const pointsValue = Math.round(redeem * (settings.loyalty_point_value || 0));
  const paid = METHODS.reduce((s, k) => s + toMinor(amounts[k], d), 0) + pointsValue;
  const remaining = Math.max(0, total - paid);
  const change = Math.max(0, paid - total);
  const m = (v) => formatMoney(v, settings);
  // With a customer account, whatever is not paid now goes on their balance.
  const onAccount = customer ? remaining : 0;
  const newBalance = customer ? customer.balance + onAccount : 0;
  const overLimit = customer && customer.credit_limit > 0 && onAccount > 0 && newBalance > customer.credit_limit;
  const canComplete = (paid >= total || (customer && !overLimit)) && !busy;

  // Quick cash buttons: exact, then the next round banknotes above the total.
  const unit = 10 ** d;
  const quick = [...new Set([total, ...[5, 10, 20, 50, 100, 200, 500, 1000].map((n) => Math.ceil(total / (n * unit)) * n * unit)])]
    .filter((v) => v >= total).sort((a, b) => a - b).slice(0, 5);

  const select = (k) => {
    setActive(k);
    // Switching to card/wallet takes over the unpaid part; cash can then be typed for a split.
    if (k !== 'cash' && !amounts[k]) {
      const otherNonCash = METHODS.filter((x) => x !== k && x !== 'cash').reduce((s, x) => s + toMinor(amounts[x], d), 0);
      setAmounts((a) => ({ ...a, cash: '', [k]: fromMinor(Math.max(0, total - otherNonCash), d) }));
    }
    setTimeout(() => inputRef.current?.select(), 0);
  };

  async function submit() {
    if (!canComplete) return;
    setBusy(true);
    await onPay(METHODS.map((method) => ({ method, amount: toMinor(amounts[method], d) })).filter((p) => p.amount > 0), printReceipt, redeem);
    setBusy(false);
  }

  return (
    <Modal
      title={t('pay.title')}
      onClose={onClose}
      width={620}
      footer={<>
        <Toggle checked={printReceipt} onChange={setPrintReceipt} label={t('pay.printReceipt')} />
        <span className="spacer" />
        <button onClick={onClose}>{t('common.cancel')}</button>
        <button className="primary lg" disabled={!canComplete} onClick={submit}>{onAccount ? t('pay.completeCredit') : t('pay.complete')}</button>
      </>}
    >
      <div className="pay-due"><span>{t('pay.due')}</span><b>{m(total)}</b></div>
      {loyaltyOn && customer.points >= (settings.loyalty_min_redeem || 0) && customer.points > 0 && (
        <div className="pay-customer points">
          <span>⭐ {t('loyalty.available', { n: formatQty(customer.points), v: m(Math.round(customer.points * settings.loyalty_point_value)) })}</span>
          {redeem
            ? <button type="button" onClick={() => setRedeem(0)}>{t('loyalty.cancelRedeem', { n: redeem })}</button>
            : <button type="button" onClick={() => {
              const max = Math.min(Math.floor(customer.points), Math.floor(total / (settings.loyalty_point_value || 1)));
              setRedeem(max);
              setAmounts((a) => ({ ...a, cash: fromMinor(Math.max(0, total - Math.round(max * settings.loyalty_point_value)), d) }));
            }}>{t('loyalty.redeem')}</button>}
        </div>
      )}
      {customer && (
        <div className="pay-customer">
          <span>👤 <b>{customer.name}</b> · {t('customers.balance')}: {m(customer.balance)}{customer.credit_limit > 0 ? ` / ${t('customers.limit')} ${m(customer.credit_limit)}` : ''}</span>
          <button type="button" onClick={() => setAmounts({ cash: '', card: '', wallet: '' })}>{t('pay.allCredit')}</button>
        </div>
      )}
      <div className="seg full">
        {METHODS.map((k) => (
          <button key={k} className={active === k ? 'on' : ''} onClick={() => select(k)}>
            {t(`pay.${k}`)}{toMinor(amounts[k], d) ? ` · ${fromMinor(toMinor(amounts[k], d), d)}` : ''}
          </button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input
          ref={inputRef}
          className="xl"
          autoFocus
          onFocus={(e) => e.target.select()}
          inputMode="decimal"
          value={amounts[active]}
          onChange={(e) => setAmounts((a) => ({ ...a, [active]: e.target.value }))}
        />
      </form>
      {active === 'cash' && (
        <div className="quick-cash">
          {quick.map((v) => (
            <button key={v} onClick={() => { setAmounts((a) => ({ ...a, cash: fromMinor(v, d) })); inputRef.current?.focus(); }}>
              {v === total ? t('pay.exact') : fromMinor(v, d)}
            </button>
          ))}
        </div>
      )}
      <div className="pay-summary">
        <div><span>{t('pay.paid')}</span><b>{m(paid)}</b></div>
        {customer && onAccount > 0
          ? <div className={overLimit ? 'warn' : 'credit'}><span>{t('pay.onAccount')}</span><b>{m(onAccount)}</b></div>
          : <div className={remaining ? 'warn' : ''}><span>{t('pay.remaining')}</span><b>{m(remaining)}</b></div>}
        <div className={change ? 'good' : ''}><span>{t('pay.change')}</span><b>{m(change)}</b></div>
      </div>
      {overLimit && <p className="warn">{t('err.CREDIT_LIMIT_EXCEEDED')} ({t('customers.newBalance')}: {m(newBalance)})</p>}
      {customer && onAccount > 0 && !overLimit && <p className="muted">{t('customers.newBalance')}: <b>{m(newBalance)}</b></p>}
    </Modal>
  );
}
