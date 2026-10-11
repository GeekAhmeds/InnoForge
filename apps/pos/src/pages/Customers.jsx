import React, { useState } from 'react';
import { api, savePdf } from '../lib/api.js';
import { openWhatsApp, quoteText, statementText } from '../lib/share.js';
import { formatMoney, formatQty, fromMinor, toMinor } from '../lib/money.js';
import { a4Html, collectionHtml, statementHtml } from '../lib/receipt.js';
import { Empty, Field, Modal, Toggle, useApp, useLoad } from '../components/ui.jsx';
import { ExcelButtons } from '../components/ExcelImport.jsx';

export default function Customers() {
  const { t } = useApp();
  const [tab, setTab] = useState('customers');
  const [aging] = useLoad(() => api.customers.aging({}), []);
  const overdue = (aging || []).filter((a) => a.overdue > 0).length;
  return (
    <div className="page">
      <div className="page-head">
        <h2>👥 {t('nav.customers')}</h2>
        <div className="seg">
          <button className={tab === 'customers' ? 'on' : ''} onClick={() => setTab('customers')}>{t('nav.customers')}</button>
          <button className={tab === 'aging' ? 'on' : ''} onClick={() => setTab('aging')}>{t('aging.title')}{overdue > 0 && <span className="count-badge">{overdue}</span>}</button>
          <button className={tab === 'quotes' ? 'on' : ''} onClick={() => setTab('quotes')}>{t('quotes.title')}</button>
        </div>
      </div>
      {tab === 'customers' && <CustomerList />}
      {tab === 'aging' && <Aging />}
      {tab === 'quotes' && <Quotes />}
    </div>
  );
}

function CustomerList() {
  const { t, settings } = useApp();
  const [search, setSearch] = useState('');
  const [owingOnly, setOwingOnly] = useState(false);
  const [editing, setEditing] = useState(null);
  const [statementId, setStatementId] = useState(null);
  const [list, reload] = useLoad(() => api.customers.list({ search, owingOnly, includeInactive: true }), [search, owingOnly]);
  const m = (v) => formatMoney(v, settings);
  const receivables = (list || []).reduce((s, c) => s + Math.max(0, c.balance), 0);

  return (
    <>
      <div className="page-head">
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
                <td><b>{c.name}</b>{c.tax_number && <small className="muted"> · {c.tax_number}</small>}{settings.loyalty_enabled && c.points > 0 && <small className="badge">⭐ {formatQty(c.points)}</small>}</td>
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
    </>
  );
}

function Aging() {
  const { t, settings } = useApp();
  const [list] = useLoad(() => api.customers.aging({ overdueDays: settings.overdue_days || 30 }), []);
  const [statementId, setStatementId] = useState(null);
  const m = (v) => formatMoney(v, settings);
  const sum = (k) => (list || []).reduce((s, r) => s + r[k], 0);
  return (
    <div className="card flush">
      <p className="muted small pad">{t('aging.hint', { d: settings.overdue_days || 30 })}</p>
      <table className="grid">
        <thead><tr><th>{t('common.name')}</th><th>{t('settings.phone')}</th><th className="num">0–30</th><th className="num">31–60</th><th className="num">61–90</th><th className="num">+90</th><th className="num">{t('common.total')}</th><th className="num">{t('aging.oldest')}</th></tr></thead>
        <tbody>{(list || []).map((r) => (
          <tr key={r.id} className={`clickable ${r.overdue > 0 ? 'audit-hot' : ''}`} onClick={() => setStatementId(r.id)}>
            <td><b>{r.name}</b>{r.overdue > 0 && <small className="badge credit">{t('aging.overdue')} {m(r.overdue)}</small>}</td>
            <td className="mono" dir="ltr">{r.phone}</td>
            <td className="num">{r.b30 ? m(r.b30) : ''}</td><td className="num">{r.b60 ? m(r.b60) : ''}</td>
            <td className="num warn">{r.b90 ? m(r.b90) : ''}</td><td className="num warn"><b>{r.b90p ? m(r.b90p) : ''}</b></td>
            <td className="num"><b>{m(r.total)}</b></td><td className="num">{t('aging.days', { d: r.oldest_days })}</td>
          </tr>
        ))}</tbody>
        {!!list?.length && <tfoot><tr><td colSpan={2}>{list.length}</td><td className="num">{m(sum('b30'))}</td><td className="num">{m(sum('b60'))}</td><td className="num">{m(sum('b90'))}</td><td className="num">{m(sum('b90p'))}</td><td className="num">{m(sum('total'))}</td><td /></tr></tfoot>}
      </table>
      {list && !list.length && <Empty>{t('aging.none')}</Empty>}
      {statementId && <Statement id={statementId} onClose={() => setStatementId(null)} />}
    </div>
  );
}

function Quotes() {
  const { t, tErr, notify, settings, printDoc, lang, openInPos } = useApp();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [list, reload] = useLoad(() => api.quotes.list({ status, search }), [status, search]);
  const [view, setView] = useState(null);
  const m = (v) => formatMoney(v, settings);
  const run = async (fn) => { try { await fn(); } catch (err) { notify(tErr(err), 'error'); } };
  return (
    <>
      <div className="filters toolbar">
        <div className="seg">
          {['', 'quote', 'order', 'invoiced', 'cancelled'].map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s ? t(`quotes.status.${s}`) : t('common.all')}</button>)}
        </div>
        <input placeholder={t('orders.searchHint')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="spacer" />
        <span className="muted small">{t('quotes.howTo')}</span>
      </div>
      <div className="card flush">
        <table className="grid">
          <thead><tr><th>#</th><th>{t('orders.date')}</th><th>{t('pos.customer')}</th><th>{t('a4.validUntil')}</th><th>{t('orders.type')}</th><th className="num">{t('common.total')}</th></tr></thead>
          <tbody>{(list || []).map((q) => (
            <tr key={q.id} className="clickable" onClick={() => run(async () => setView(await api.quotes.get(q.id)))}>
              <td><b>{q.quote_no}</b></td><td>{q.created_at.slice(0, 10)}</td><td>{q.customer_name || '—'}</td>
              <td className={q.valid_until && q.valid_until < new Date().toLocaleDateString('en-CA') && ['quote', 'order'].includes(q.status) ? 'warn' : ''}>{q.valid_until || ''}</td>
              <td><span className={`badge status-${q.status}`}>{t(`quotes.status.${q.status}`)}</span></td><td className="num">{m(q.total)}</td>
            </tr>
          ))}</tbody>
        </table>
        {list && !list.length && <Empty>{t('quotes.none')}</Empty>}
      </div>
      {view && (
        <Modal title={`${t('quotes.quote')} #${view.quote_no} — ${t(`quotes.status.${view.status}`)}`} onClose={() => setView(null)} width={720}
          footer={<>
            {['quote', 'order'].includes(view.status) && <button className="danger-ghost" onClick={() => run(async () => { await api.quotes.setStatus({ id: view.id, status: 'cancelled' }); setView(null); reload(); })}>{t('quotes.cancel')}</button>}
            <span className="spacer" />
            <button onClick={() => openWhatsApp(view.customer_phone, quoteText(view, settings, t))}>💬 {t('share.whatsapp')}</button>
            <button onClick={() => savePdf({ html: a4Html(view, 'quote', settings, t, lang), name: `${t('a4.quote')} ${view.quote_no}` }).catch((err) => notify(tErr(err), 'error'))}>📑 PDF</button>
            <button onClick={() => printDoc(a4Html(view, 'quote', settings, t, lang), settings.a4_printer_name)}>📄 {t('a4.printA4')}</button>
            {view.status === 'quote' && <button onClick={() => run(async () => { setView(await api.quotes.setStatus({ id: view.id, status: 'order' })); reload(); })}>✅ {t('quotes.accept')}</button>}
            {['quote', 'order'].includes(view.status) && <button className="primary" onClick={() => run(async () => openInPos(await api.quotes.toCart(view.id)))}>🧾 {t('quotes.toInvoice')}</button>}
          </>}>
          <div className="meta"><span>{view.created_at}</span><span>👤 {view.customer_name || '—'}</span><span>{view.user_name}</span>{view.valid_until && <span>{t('a4.validUntil')}: {view.valid_until}</span>}</div>
          <table className="grid">
            <thead><tr><th>{t('receipt.item')}</th><th className="num">{t('pos.qty')}</th><th className="num">{t('pos.price')}</th><th className="num">{t('common.total')}</th></tr></thead>
            <tbody>{view.items.map((i) => <tr key={i.id}><td>{i.name}</td><td className="num">{formatQty(i.qty)}</td><td className="num">{m(i.unit_price)}</td><td className="num">{m(i.line_total)}</td></tr>)}</tbody>
          </table>
          <div className="totals compact">
            {!!view.discount && <div className="trow"><span>{t('pos.discount')}</span><span>− {m(view.discount)}</span></div>}
            {!!view.tax && <div className="trow"><span>{t('pos.tax')}</span><span>{m(view.tax)}</span></div>}
            <div className="trow big"><span>{t('pos.total')}</span><span>{m(view.total)}</span></div>
          </div>
        </Modal>
      )}
    </>
  );
}

function CustomerModal({ customer, onClose, onSaved }) {
  const { t, tErr, notify, settings, can } = useApp();
  const isAdmin = can('customers_edit');
  const d = settings.decimals;
  const [f, setF] = useState({ ...customer, credit_limit: customer.credit_limit ? fromMinor(customer.credit_limit, d) : '' });
  const [priceLists] = useLoad(() => api.priceLists.list(), []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  async function save(e) {
    e?.preventDefault();
    try {
      await api.customers.save({ ...f, credit_limit: toMinor(f.credit_limit, d), price_list_id: Number(f.price_list_id) || null });
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
        <Field label={t('priceLists.title')}>
          <select value={f.price_list_id || ''} onChange={set('price_list_id')} disabled={!isAdmin}>
            <option value="">{t('priceLists.retail')}</option>
            {(priceLists || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <div className="span2"><Field label={t('pos.note')}><input value={f.notes} onChange={set('notes')} /></Field></div>
        {f.id && isAdmin && <Toggle checked={f.active} onChange={set('active')} label={t('common.active')} />}
        <button hidden />
      </form>
    </Modal>
  );
}

function Statement({ id, onClose }) {
  const { t, tErr, notify, settings, printDoc, lang, shift, can } = useApp();
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
          <button onClick={() => openWhatsApp(customer.phone, statementText(data, settings, t))}>💬 {t('share.whatsapp')}</button>
          <button onClick={() => savePdf({ html: statementHtml(data, settings, t, lang), name: `${t('purchases.statement')} ${customer.name}` }).catch((err) => notify(tErr(err), 'error'))}>📑 PDF</button>
          <button onClick={() => printDoc(statementHtml(data, settings, t, lang), settings.a4_printer_name)}>🖨 {t('customers.printStatement')}</button>
          <button className="primary" onClick={() => setPay({ amount: customer.balance > 0 ? fromMinor(customer.balance, settings.decimals) : '', method: 'cash', notes: '', print: true })}>💵 {t('customers.collect')}</button>
        </>
      )}>
      <div className="meta">
        {customer.phone && <span dir="ltr">📞 {customer.phone}</span>}
        {customer.address && <span>📍 {customer.address}</span>}
        {customer.credit_limit > 0 && <span>{t('customers.limit')}: {m(customer.credit_limit)}</span>}
        {settings.loyalty_enabled && <span>⭐ {t('loyalty.points')}: <b>{formatQty(customer.points || 0)}</b>
          {can('customers_edit') && <button className="ghost sm" onClick={async () => {
            const v = window.prompt(t('loyalty.adjustPrompt'));
            if (v && Number(v)) { try { await api.customers.adjustPoints({ customerId: id, points: Number(v) }); reload(); } catch (err) { notify(tErr(err), 'error'); } }
          }}>±</button>}</span>}
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
