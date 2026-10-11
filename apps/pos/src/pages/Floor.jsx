import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, formatQty } from '../lib/money.js';
import { checkHtml } from '../lib/receipt.js';
import { Empty, Modal, useApp, useLoad } from '../components/ui.jsx';

// Restaurant floor: every table at a glance (free, busy, bill asked, food not sent yet),
// with the table actions waiters need: open, print the check, move, merge and split.
export default function Floor() {
  const { t, settings, openInPos, ask, notify, tErr } = useApp();
  const [tables, reloadTables] = useLoad(() => api.tables.list(), []);
  const [open, reloadOpen] = useLoad(() => api.orders.listOpen(), []);
  const [area, setArea] = useState('');
  const [selected, setSelected] = useState(null);
  const m = (v) => formatMoney(v, settings);
  const reload = () => { reloadTables(); reloadOpen(); };
  useEffect(() => {
    const h = setInterval(reload, 15000);
    return () => clearInterval(h);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const areas = useMemo(() => [...new Set((tables || []).map((x) => x.area))], [tables]);
  const shown = (tables || []).filter((x) => !area || x.area === area);
  const busy = (tables || []).filter((x) => x.order_id);
  const takeaway = (open || []).filter((o) => !o.table_id);

  async function onTable(x) {
    if (x.order_id) return setSelected(x);
    const g = await ask(t('floor.guests', { name: x.name }), { type: 'number', initial: String(x.seats || '') });
    if (g === null) return undefined;
    openInPos({ order_type: 'dine_in', table_id: x.id, table_name: x.name, guests: Number(g) || 0, items: [] });
    return undefined;
  }

  if (!tables) return null;
  return (
    <div className="page floor">
      <div className="page-head">
        <h2>🍽 {t('nav.floor')}</h2>
        <div className="floor-legend">
          <span><i className="dot free" /> {t('floor.free')} {tables.length - busy.length}</span>
          <span><i className="dot busy" /> {t('floor.busy')} {busy.length}</span>
          <span><i className="dot check" /> {t('floor.check')} {busy.filter((x) => x.check_printed_at).length}</span>
          <span><i className="dot unsent" /> {t('floor.unsent')}</span>
          <button className="ghost sm" onClick={reload}>↻</button>
        </div>
      </div>
      {areas.length > 1 && (
        <div className="chips">
          <button className={!area ? 'on' : ''} onClick={() => setArea('')}>{t('common.all')}</button>
          {areas.map((a) => <button key={a} className={area === a ? 'on' : ''} onClick={() => setArea(a)}>{a || t('floor.main')}</button>)}
        </div>
      )}
      <div className="floor-body">
        <div className="floor-grid">
          {shown.map((x) => (
            <button key={x.id} className={`floor-table ${x.order_id ? (x.check_printed_at ? 'check' : 'busy') : 'free'}`} onClick={() => onTable(x)}>
              <div className="ft-head"><b>{x.name}</b>{x.unsent > 0 && <span className="ft-unsent" title={t('floor.unsent')}>🔔 {x.unsent}</span>}</div>
              {x.order_id ? (
                <>
                  <div className="ft-total">{m(x.order_total)}</div>
                  <div className="ft-meta">
                    <span>⏱ {fmtMinutes(x.minutes, t)}</span>
                    {x.guests > 0 && <span>👥 {x.guests}</span>}
                  </div>
                  <div className="ft-waiter">{x.waiter_name}{x.check_printed_at ? ` · 🧾 ${t('floor.checkShort')}` : ''}</div>
                </>
              ) : (
                <div className="ft-free">{t('floor.free')} · {x.seats} 👤</div>
              )}
            </button>
          ))}
          {!shown.length && <Empty>{t('floor.noTables')}</Empty>}
        </div>
        <aside className="floor-side card">
          <div className="row between">
            <h4>🥡 {t('floor.takeaway')}</h4>
            <button className="primary sm" onClick={() => openInPos({ order_type: 'takeaway', items: [] })}>+ {t('order.takeaway')}</button>
          </div>
          {!takeaway.length && <p className="muted small">{t('common.none')}</p>}
          {takeaway.map((o) => (
            <button key={o.id} className="side-order" onClick={async () => { try { openInPos(cartFromOrderLite(await api.orders.get(o.id))); } catch (err) { notify(tErr(err), 'error'); } }}>
              <span><b>#{o.id}</b> {t(`order.${o.order_type}`)} {o.customer_name && `· ${o.customer_name}`}</span>
              <span>{m(o.total)} <small className="muted">{o.created_at.slice(11, 16)}</small></span>
            </button>
          ))}
          <button className="top-gap" onClick={() => openInPos({ order_type: 'delivery', items: [] })}>🛵 {t('order.delivery')}</button>
        </aside>
      </div>
      {selected && <TableActions table={selected} tables={tables} onClose={() => setSelected(null)} onChanged={() => { setSelected(null); reload(); }} />}
    </div>
  );
}

const fmtMinutes = (n, t) => (n >= 60 ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : t('floor.min', { n: n || 0 }));

// The cashier screen's cart shape for an open order (promotions and customer discounts are re-applied there).
export const cartFromOrderLite = (o) => ({
  id: o.id, order_type: o.order_type, table_id: o.table_id, table_name: o.table_name || '', guests: o.guests || 0,
  discount: o.discount, customer_id: o.customer_id, customer_name: o.customer_name, customer_phone: o.customer_phone,
  customer_address: o.customer_address, note: o.note, salesperson_id: o.salesperson_id,
  items: o.items.map((i) => ({
    id: i.id, product_id: i.product_id, unit_id: i.unit_id, name: i.name, unit_price: i.unit_price, list_price: i.unit_price, qty: i.qty,
    discount: Math.max(0, i.discount - (i.promo_discount || 0) - (i.customer_discount || 0)), note: i.note, serials: i.serials || '', kitchen_sent: i.kitchen_sent,
  })),
});

function TableActions({ table, tables, onClose, onChanged }) {
  const { t, tErr, notify, settings, printDoc, lang, openInPos } = useApp();
  const [order] = useLoad(() => api.orders.get(table.order_id), [table.order_id]);
  const [mode, setMode] = useState(null); // transfer | merge | split
  const [qtys, setQtys] = useState({});
  const m = (v) => formatMoney(v, settings);
  const run = async (fn) => { try { await fn(); } catch (err) { notify(tErr(err), 'error'); } };
  if (!order) return null;

  const others = tables.filter((x) => x.id !== table.id && (mode === 'transfer' ? !x.order_id : x.order_id));
  const pick = (x) => run(async () => {
    if (mode === 'transfer') await api.floor.transfer({ orderId: order.id, tableId: x.id });
    else await api.floor.merge({ fromId: x.order_id, toId: order.id });
    notify(mode === 'transfer' ? t('floor.moved', { to: x.name }) : t('floor.merged', { from: x.name }));
    onChanged();
  });
  const split = () => run(async () => {
    const items = Object.entries(qtys).map(([id, q]) => ({ order_item_id: Number(id), qty: Number(q) })).filter((x) => x.qty > 0);
    const part = await api.floor.split({ orderId: order.id, items });
    notify(t('floor.splitDone'));
    openInPos(cartFromOrderLite(part));
  });

  return (
    <Modal title={`${t('pos.table')} ${table.name} — #${order.id}`} onClose={onClose} width={680}
      footer={mode ? (
        <>
          <button onClick={() => setMode(null)}>{t('common.back')}</button>
          <span className="spacer" />
          {mode === 'split' && <button className="primary" onClick={split}>✂ {t('floor.splitPay')}</button>}
        </>
      ) : (
        <>
          <button onClick={() => setMode('transfer')}>↔ {t('floor.transfer')}</button>
          <button onClick={() => setMode('merge')}>⧉ {t('floor.merge')}</button>
          <button onClick={() => setMode('split')}>✂ {t('floor.split')}</button>
          <span className="spacer" />
          <button onClick={() => run(async () => { const o = await api.floor.printCheck(order.id); await printDoc(checkHtml(o, settings, t, lang)); onChanged(); })}>🧾 {t('floor.printCheck')}</button>
          <button className="primary" onClick={() => openInPos(cartFromOrderLite(order))}>{t('floor.openOrder')}</button>
        </>
      )}>
      <div className="meta">
        <span>⏱ {order.created_at.slice(11, 16)}</span>
        {order.guests > 0 && <span>👥 {order.guests}</span>}
        <span>{order.user_name}</span>
        {order.check_printed_at && <span>🧾 {order.check_printed_at.slice(11, 16)}</span>}
      </div>
      {mode === 'transfer' || mode === 'merge' ? (
        <>
          <p className="muted">{mode === 'transfer' ? t('floor.pickFree') : t('floor.pickBusy')}</p>
          <div className="table-grid">
            {others.map((x) => <button key={x.id} className={`table-tile ${x.order_id ? 'busy' : ''}`} onClick={() => pick(x)}><b>{x.name}</b><small>{x.order_id ? m(x.order_total) : t('pos.free')}</small></button>)}
          </div>
          {!others.length && <Empty>{t('common.none')}</Empty>}
        </>
      ) : (
        <table className="grid compact">
          <thead><tr><th>{t('receipt.item')}</th><th className="num">{t('pos.qty')}</th><th className="num">{t('common.total')}</th>{mode === 'split' && <th className="num">{t('floor.moveQty')}</th>}</tr></thead>
          <tbody>{order.items.map((i) => (
            <tr key={i.id}>
              <td>{i.name}{i.note && <small className="muted"> — {i.note}</small>}{i.kitchen_sent < i.qty && <small className="warn"> 🔔</small>}</td>
              <td className="num">{formatQty(i.qty)}</td>
              <td className="num">{m(i.line_total)}</td>
              {mode === 'split' && <td className="num"><input className="qty-input" type="number" min="0" max={i.qty} step="any" value={qtys[i.id] ?? ''} onChange={(e) => setQtys((q) => ({ ...q, [i.id]: e.target.value }))} /></td>}
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={2}>{t('pos.total')}</td><td className="num"><b>{m(order.total)}</b></td>{mode === 'split' && <td />}</tr></tfoot>
        </table>
      )}
      {mode === 'split' && <p className="muted small">{t('floor.splitHint')}</p>}
    </Modal>
  );
}
