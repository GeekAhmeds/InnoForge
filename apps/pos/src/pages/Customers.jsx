import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, fromMinor, toMinor } from '../lib/money.js';
import { collectionHtml, statementHtml } from '../lib/receipt.js';
import { Empty, Field, Modal, Toggle, useApp, useLoad } from '../components/ui.jsx';
import { ExcelButtons } from '../components/ExcelImport.jsx';

export default function Customers() {
  const { t, settings } = useApp();
  const [search, setSearch] = useState('');
  const [owingOnly, setOwingOnly] = useState(false);
  const [editing, setEditing] = useState(null);
  const [statementId, setStatementId] = useState(null);
  const [list, reload] = useLoad(() => api.customers.list({ search, owingOnly, includeInactive: true }), [search, owingOnly]);
  const m = (v) => formatMoney(v, settings);
  const receivables = (list || []).reduce((s, c) => s + Math.max(0, c.balance), 0);

  return (
    <div className="page">
      <div className="page-head">
        <h2>👥 {t('nav.customers')}</h2>
        <div className="filters">
          <input placeholder={t('customers.searchHint')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <Toggle checked={owingOnly} onChange={setOwingOnly} label={t('customers.owingOnly')} />
          <ExcelButtons kind="customers" onImported={reload} />
          <button className="primary" onClick={() => setEditing({ name: '', phone: '', address: '', tax_number: '', notes: '', credit_limit: 0, active: true })}>+ {t('customers.new')}</button>
        </div>
      </div>
      <div className="stats">
        <div className="stat"><small>{t('customers.count')}</small><b>{list?.length ?? 0}</b></div>
        <div className="stat strong"><small>{t('customers.receivables')}</small><b>{m(receivables)}</b></div>
      </div>
      <div className="card flush">
        <table className="grid">
          <thead><tr>
            <th>{t('common.name')}</th><th>{t('settings.phone')}</th><th>{t('customers.lastPurchase')}</th>
            <th className="num">{t('customers.totalSales')}</th><th className="num">{t('customers.limit')}</th><th className="num">{t('customers.balance')}</th><th />
          </tr></thead>
          <tbody>
            {(list || []).map((c) => (
              <tr key={c.id} className={`clickable ${c.active ? '' : 'dim'}`} onClick={() => setStatementId(c.id)}>
                <td><b>{c.name}</b>{c.tax_number && <small className="muted"> · {c.tax_number}</small>}</td>
                <td className="mono" dir="ltr">{c.phone}</td>
                <td className="muted">{c.last_purchase?.slice(0, 10) || '—'}</td>
                <td className="num">{m(c.total_sales)}</td>
                <td className="num muted">{c.credit_limit ? m(c.credit_limit) : '∞'}</td>
                <td className={`num ${c.balance > 0 ? 'warn' : c.balance < 0 ? 'good' : ''}`}><b>{m(c.balance)}</b></td>
                <td className="num"><button className="ghost sm" onClick={(e) => { e.stopPropagation(); setEditing(c); }}>{t('common.edit')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list && !list.length && <Empty>{t('common.none')}</Empty>}
      </div>
      {editing && <CustomerModal customer={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {statementId && <Statement id={statementId} onClose={() => { setStatementId(null); reload(); }} />}
    </div>
  );
}

function CustomerModal({ customer, onClose, onSaved }) {
  const { t, tErr, notify, settings, can } = useApp();
  const isAdmin = can('customers_edit');
  const d = settings.decimals;
  const [f, setF] = useState({ ...customer, credit_limit: customer.credit_limit ? fromMinor(customer.credit_limit, d) : '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  async function save(e) {
    e?.preventDefault();
    try {
      await api.customers.save({ ...f, credit_limit: toMinor(f.credit_limit, d) });
      notify(t('common.saved'));
      onSaved();
    } catch (err) {
      notify(tErr(err), 'error');
    }
  }
  return (
    <Modal title={f.id ? f.name : t('customers.new')} onClose={onClose} width={600}
      footer={<><span className="spacer" /><button onClick={onClose}>{t('common.cancel')}</button><button className="primary" onClick={save}>{t('common.save')}</button></>}>
      <form className="grid2" onSubmit={save}>
        <Field label={t('common.name')}><input autoFocus value={f.name} onChange={set('name')} /></Field>
        <Field label={t('settings.phone')}><input dir="ltr" value={f.phone} onChange={set('phone')} /></Field>
        <div className="span2"><Field label={t('settings.address')}><input value={f.address} onChange={set('address')} /></Field></div>
        <Field label={t('customers.taxNumber')}><input value={f.tax_number} onChange={set('tax_number')} /></Field>
        <Field label={t('customers.limit')} hint={isAdmin ? t('customers.limitHint') : t('err.FORBIDDEN')}>
          <input inputMode="decimal" value={f.credit_limit} onChange={set('credit_limit')} placeholder="0" disabled={!isAdmin} />
        </Field>
        <div className="span2"><Field label={t('pos.note')}><input value={f.notes} onChange={set('notes')} /></Field></div>
        {f.id && isAdmin && <Toggle checked={f.active} onChange={set('active')} label={t('common.active')} />}
        <button hidden />
      </form>
    </Modal>
  );
}

function Statement({ id, onClose }) {
  const { t, tErr, notify, settings, printDoc, lang, shift } = useApp();
  const [data, reload] = useLoad(() => api.customers.statement({ id }), [id]);
  const [pay, setPay] = useState(null);
  const m = (v) => formatMoney(v, settings);
  if (!data) return null;
  const { customer } = data;

  async function collect(e) {
    e?.preventDefault();
    try {
      const res = await api.customers.collect({ customerId: id, amount: toMinor(pay.amount, settings.decimals), method: pay.method, notes: pay.notes });
      setPay(null);
      notify(t('customers.collected'));
      if (pay.print) await printDoc(collectionHtml(res.payment, res.customer, settings, t, lang));
      reload();
    } catch (err) {
      notify(tErr(err), 'error');
    }
  }

  const kindLabel = (r) => (r.kind === 'sale' ? `${t('customers.invoice')} #${r.ref}` : r.kind === 'return' ? t('customers.returnCredit') : `${t('customers.payment')} — ${t(`pay.${r.ref}`)}`);

  return (
    <Modal title={`${t('purchases.statement')} — ${customer.name}`} onClose={onClose} width={820}
      footer={pay ? (
        <form className="row grow" onSubmit={collect}>
          <input className="w-amount" autoFocus inputMode="decimal" placeholder={t('reports.amount')} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
          <select className="w-auto" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
            {['cash', 'card', 'wallet', 'other'].map((x) => <option key={x} value={x}>{t(`pay.${x}`)}</option>)}
          </select>
          <input placeholder={t('pos.note')} value={pay.notes} onChange={(e) => setPay({ ...pay, notes: e.target.value })} />
          <Toggle checked={pay.print} onChange={(v) => setPay({ ...pay, print: v })} label={t('common.print')} />
          <span className="spacer" />
          <button type="button" onClick={() => setPay(null)}>{t('common.cancel')}</button>
          <button className="primary">{t('common.save')}</button>
        </form>
      ) : (
        <>
          <span>{t('customers.balance')}: <b className={customer.balance > 0 ? 'warn' : 'good'}>{m(customer.balance)}</b></span>
          <span className="spacer" />
          <button onClick={() => printDoc(statementHtml(data, settings, t, lang))}>🖨 {t('customers.printStatement')}</button>
          <button className="primary" onClick={() => setPay({ amount: customer.balance > 0 ? fromMinor(customer.balance, settings.decimals) : '', method: 'cash', notes: '', print: true })}>💵 {t('customers.collect')}</button>
        </>
      )}>
      <div className="meta">
        {customer.phone && <span dir="ltr">📞 {customer.phone}</span>}
        {customer.address && <span>📍 {customer.address}</span>}
        {customer.credit_limit > 0 && <span>{t('customers.limit')}: {m(customer.credit_limit)}</span>}
      </div>
      <table className="grid">
        <thead><tr><th>{t('orders.date')}</th><th>{t('orders.type')}</th><th className="num">{t('customers.debit')}</th><th className="num">{t('customers.credit')}</th><th className="num">{t('customers.balance')}</th></tr></thead>
        <tbody>
          {!!customer.opening_balance && (
            <tr><td>—</td><td>{t('customers.opening')}</td><td className="num">{m(customer.opening_balance)}</td><td /><td className="num"><b>{m(customer.opening_balance)}</b></td></tr>
          )}
          {data.rows.map((r) => (
            <tr key={`${r.kind}${r.id}`}>
              <td>{r.created_at}</td>
              <td>{kindLabel(r)}{r.kind === 'sale' && r.total !== r.debit && <small className="muted"> ({t('common.total')} {m(r.total)})</small>}{r.notes && <small className="muted"> — {r.notes}</small>}</td>
              <td className="num">{r.debit ? m(r.debit) : ''}</td>
              <td className="num">{r.credit ? m(r.credit) : ''}</td>
              <td className="num"><b>{m(r.balance)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!data.rows.length && <Empty>{t('common.none')}</Empty>}
    </Modal>
  );
}
