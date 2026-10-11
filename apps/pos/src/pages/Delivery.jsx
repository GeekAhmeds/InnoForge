import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, fromMinor, toMinor } from '../lib/money.js';
import { openWhatsApp } from '../lib/share.js';
import { Empty, Field, Modal, Toggle, useApp, useLoad } from '../components/ui.jsx';
import { cartFromOrderLite } from './Floor.jsx';
import { today } from './Orders.jsx';

// Delivery board: orders waiting, out with a driver, delivered today; plus zones,
// drivers and the end-of-day settlement with each driver.
export default function Delivery() {
  const { t, can } = useApp();
  const [tab, setTab] = useState('board');
  return (
    <div className="page">
      <div className="page-head">
        <h2>🛵 {t('nav.delivery')}</h2>
        <div className="seg">
          {['board', 'settle', ...(can('settings') ? ['zones', 'drivers'] : [])].map((x) => <button key={x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`delivery.tab.${x}`)}</button>)}
        </div>
      </div>
      {tab === 'board' && <Board />}
      {tab === 'settle' && <Settle />}
      {tab === 'zones' && <Zones />}
      {tab === 'drivers' && <Drivers />}
    </div>
  );
}

function Board() {
  const { t, tErr, notify, settings, openInPos } = useApp();
  const [board, reload] = useLoad(() => api.delivery.board(), []);
  const [drivers] = useLoad(() => api.delivery.drivers(), []);
  const [dispatching, setDispatching] = useState(null);
  const m = (v) => formatMoney(v, settings);
  useEffect(() => { const h = setInterval(reload, 15000); return () => clearInterval(h); }, [reload]);
  const run = async (fn) => { try { await fn(); reload(); } catch (err) { notify(tErr(err), 'error'); } };
  const open = (o) => run(async () => openInPos(cartFromOrderLite(await api.orders.get(o.id))));
  if (!board) return null;
  const card = (o, actions) => (
    <div key={o.id} className="dl-card">
      <div className="row between"><b>#{o.invoice_no || o.id} · {o.customer_name || '—'}</b><span className="muted small">⏱ {o.minutes}′</span></div>
      {o.customer_address && <div className="small">📍 {o.customer_address}{o.zone_name ? ` — ${o.zone_name}` : ''}</div>}
      {o.customer_phone && <div className="small" dir="ltr">📞 {o.customer_phone}</div>}
      <div className="row between top-gap"><b>{m(o.total)}</b>{o.driver_name && <span className="badge">🛵 {o.driver_name}</span>}{o.cooking > 0 && <span className="badge credit">🍳 {t('delivery.cooking')}</span>}</div>
      <div className="row wrap top-gap">{actions}</div>
    </div>
  );
  return (
    <>
      <div className="dl-board">
        <section>
          <h3>🕒 {t('delivery.waiting')} <small className="muted">({board.waiting.length})</small></h3>
          {board.waiting.map((o) => card(o, <>
            <button className="sm" onClick={() => open(o)}>{t('floor.openOrder')}</button>
            <button className="primary sm" onClick={() => setDispatching(o)}>🛵 {t('delivery.dispatch')}</button>
          </>))}
          {!board.waiting.length && <Empty>{t('common.none')}</Empty>}
        </section>
        <section>
          <h3>🛵 {t('delivery.out')} <small className="muted">({board.out.length})</small></h3>
          {board.out.map((o) => card(o, <>
            {o.customer_phone && <button className="sm" onClick={() => openWhatsApp(o.customer_phone, t('delivery.onTheWay', { name: settings.business_name }))}>💬</button>}
            <button className="primary sm" onClick={() => open(o)}>💵 {t('delivery.deliveredPay')}</button>
          </>))}
          {!board.out.length && <Empty>{t('common.none')}</Empty>}
        </section>
        <section>
          <h3>✅ {t('delivery.delivered')} <small className="muted">({board.delivered.length})</small></h3>
          {board.delivered.map((o) => card(o, null))}
          {!board.delivered.length && <Empty>{t('common.none')}</Empty>}
        </section>
      </div>
      {dispatching && (
        <Modal title={`🛵 ${t('delivery.dispatch')} — #${dispatching.id}`} onClose={() => setDispatching(null)} width={460}>
          <div className="driver-grid">
            {(drivers || []).filter((d) => d.active).map((d) => (
              <button key={d.id} onClick={() => run(async () => { await api.delivery.dispatch({ orderId: dispatching.id, driverId: d.id }); setDispatching(null); })}>
                <b>{d.name}</b><small className="muted" dir="ltr">{d.phone}</small>
              </button>
            ))}
          </div>
          {!(drivers || []).some((d) => d.active) && <Empty>{t('delivery.noDrivers')}</Empty>}
        </Modal>
      )}
    </>
  );
}

function Settle() {
  const { t, settings } = useApp();
  const [range, setRange] = useState({ from: today(), to: today() });
  const [rows] = useLoad(() => api.delivery.drivers_report(range), [range.from, range.to]);
  const m = (v) => formatMoney(v, settings);
  return (
    <>
      <div className="filters toolbar">
        <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        <span className="muted small">{t('delivery.settleHint')}</span>
      </div>
      <div className="card flush">
        <table className="grid">
          <thead><tr><th>{t('delivery.driver')}</th><th className="num">{t('delivery.orders')}</th><th className="num">{t('common.total')}</th><th className="num">{t('delivery.cash')}</th><th className="num">{t('pay.onAccount')}</th><th className="num">{t('delivery.fees')}</th></tr></thead>
          <tbody>{(rows || []).map((r) => <tr key={r.id}><td><b>{r.name}</b></td><td className="num">{r.orders}</td><td className="num">{m(r.total)}</td><td className="num"><b>{m(r.cash)}</b></td><td className="num">{m(r.on_account)}</td><td className="num">{m(r.fees)}</td></tr>)}</tbody>
        </table>
        {rows && !rows.length && <Empty>{t('common.none')}</Empty>}
      </div>
    </>
  );
}

function Zones() {
  const { t, tErr, notify, settings } = useApp();
  const [list, reload] = useLoad(() => api.delivery.zones(), []);
  const [f, setF] = useState(null);
  const m = (v) => formatMoney(v, settings);
  const save = async () => { try { await api.delivery.saveZone({ ...f, fee: toMinor(f.fee, settings.decimals) }); setF(null); reload(); } catch (err) { notify(tErr(err), 'error'); } };
  return (
    <div className="card narrow-wide">
      <div className="row between"><h3>📍 {t('delivery.zones')}</h3><button className="primary" onClick={() => setF({ name: '', fee: '', active: true })}>+ {t('delivery.newZone')}</button></div>
      <div className="cat-list">{(list || []).map((z) => (
        <div key={z.id} className={`cat-row ${z.active ? '' : 'dim'}`}><span className="spacer"><b>{z.name}</b></span><span>{m(z.fee)}</span>
          <button className="ghost sm" onClick={() => setF({ ...z, fee: fromMinor(z.fee, settings.decimals), active: !!z.active })}>{t('common.edit')}</button></div>
      ))}</div>
      {list && !list.length && <Empty>{t('common.none')}</Empty>}
      {f && (
        <Modal title={f.id ? f.name : t('delivery.newZone')} onClose={() => setF(null)} width={420}
          footer={<><span className="spacer" /><button className="primary" onClick={save}>{t('common.save')}</button></>}>
          <Field label={t('common.name')}><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('delivery.fee')}><input inputMode="decimal" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} /></Field>
          {f.id && <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label={t('common.active')} />}
        </Modal>
      )}
    </div>
  );
}

function Drivers() {
  const { t, tErr, notify } = useApp();
  const [list, reload] = useLoad(() => api.delivery.drivers(), []);
  const [f, setF] = useState(null);
  const save = async () => { try { await api.delivery.saveDriver(f); setF(null); reload(); } catch (err) { notify(tErr(err), 'error'); } };
  return (
    <div className="card narrow-wide">
      <div className="row between"><h3>🛵 {t('delivery.drivers')}</h3><button className="primary" onClick={() => setF({ name: '', phone: '', active: true })}>+ {t('delivery.newDriver')}</button></div>
      <div className="cat-list">{(list || []).map((d) => (
        <div key={d.id} className={`cat-row ${d.active ? '' : 'dim'}`}><span className="spacer"><b>{d.name}</b> <small className="muted" dir="ltr">{d.phone}</small></span>
          <button className="ghost sm" onClick={() => setF({ ...d, active: !!d.active })}>{t('common.edit')}</button></div>
      ))}</div>
      {list && !list.length && <Empty>{t('common.none')}</Empty>}
      {f && (
        <Modal title={f.id ? f.name : t('delivery.newDriver')} onClose={() => setF(null)} width={420}
          footer={<><span className="spacer" /><button className="primary" onClick={save}>{t('common.save')}</button></>}>
          <Field label={t('common.name')}><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('settings.phone')}><input dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          {f.id && <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label={t('common.active')} />}
        </Modal>
      )}
    </div>
  );
}
