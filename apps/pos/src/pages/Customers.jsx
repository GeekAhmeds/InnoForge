import React, { useState } from 'react';
import { api, savePdf } from '../lib/api.js';
import { openWhatsApp, quoteText, reminderText, statementText } from '../lib/share.js';
import { formatMoney, formatQty, fromMinor, toMinor } from '../lib/money.js';
import { a4Html, statementHtml } from '../lib/receipt.js';
import { Cheques, CollectModal, ReceiptModal, Receipts } from '../components/Collect.jsx';
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
          <button className={tab === 'receipts' ? 'on' : ''} onClick={() => setTab('receipts')}>{t('collect.receipts')}</button>
          <button className={tab === 'cheques' ? 'on' : ''} onClick={() => setTab('cheques')}>{t('cheques.title')}</button>
          <button className={tab === 'quotes' ? 'on' : ''} onClick={() => setTab('quotes')}>{t('quotes.title')}</button>
        </div>
      </div>
      {tab === 'customers' && <CustomerList />}
      {tab === 'aging' && <Aging />}
      {tab === 'receipts' && <Receipts />}
      {tab === 'cheques' && <Cheques />}
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
  const [list, reload] = useLoad(() => api.customers.aging({}), []);
  const [statementId, setStatementId] = useState(null);
  const [collectId, setCollectId] = useState(null);
  const m = (v) => formatMoney(v, settings);
  const sum = (k) => (list || []).reduce((s, r) => s + r[k], 0);
  const remind = async (r) => {
    const [c, inv] = await Promise.all([api.customers.get(r.id), api.customers.openInvoices(r.id)]);
    openWhatsApp(c.phone, reminderText(c, inv.open, settings, t));
  };
  return (
    <div className="card flush">
      <p className="muted small pad">{t('aging.hint', { d: settings.overdue_days || 30 })}</p>
      <table className="grid">
        <thead><tr><th>{t('common.name')}</th><th className="num">0–30</th><th className="num">31–60</th><th className="num">61–90</th><th className="num">+90</th><th className="num">{t('common.total')}</th><th className="num">{t('aging.overdue')}</th><th>{t('collect.nextDue')}</th><th /></tr></thead>
        <tbody>{(list || []).map((r) => (
          <tr key={r.id} className={`clickable ${r.overdue > 0 ? 'audit-hot' : ''}`} onClick={() => setStatementId(r.id)}>
            <td><b>{r.name}</b><div className="muted small" dir="ltr">{r.phone}</div></td>
            <td className="num">{r.b30 ? m(r.b30) : ''}</td><td className="num">{r.b60 ? m(r.b60) : ''}</td>
            <td className="num warn">{r.b90 ? m(r.b90) : ''}</td><td className="num warn"><b>{r.b90p ? m(r.b90p) : ''}</b></td>
            <td className="num"><b>{m(r.total)}</b></td>
            <td className="num warn">{r.overdue ? <b>{m(r.overdue)}</b> : ''}</td>
            <td>{r.next_due || ''}</td>
            <td className="num nowrap" onClick={(e) => e.stopPropagation()}>
              {r.phone && <button className="ghost sm" title={t('collect.remind')} onClick={() => remind(r)}>💬</button>}
              <button className="ghost sm" onClick={() => setCollectId(r.id)}>💵 {t('customers.collect')}</button>
            </td>
          </tr>
        ))}</tbody>
        {!!list?.length && <tfoot><tr><td>{list.length}</td><td className="num">{m(sum('b30'))}</td><td className="num">{m(sum('b60'))}</td><td className="num">{m(sum('b90'))}</td><td className="num">{m(sum('b90p'))}</td><td className="num">{m(sum('total'))}</td><td className="num">{m(sum('overdue'))}</td><td colSpan={2} /></tr></tfoot>}
      </table>
      {list && !list.length && <Empty>{t('aging.none')}</Empty>}
      {statementId && <Statement id={statementId} onClose={() => { setStatementId(null); reload(); }} />}
      {collectId && <CollectModal customerId={collectId} onClose={() => setCollectId(null)} onDone={() => { setCollectId(null); reload(); }} />}
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
        <Field label={t('collect.terms')} hint={t('collect.termsHint', { d: settings.overdue_days || 30 })}>
          <input type="number" min="0" value={f.payment_terms || ''} onChange={set('payment_terms')} placeholder={String(settings.overdue_days || 30)} disabled={!isAdmin} />
        </Field>
        <Field label={t('customers.discountPercent')} hint={t('customers.discountHint')}>
          <input type="number" min="0" max="100" step="0.5" value={f.discount_percent || ''} onChange={set('discount_percent')} placeholder="0" disabled={!isAdmin} />
        </Field>
        <div className="span2"><Field label={t('pos.note')}><input value={f.notes} onChange={set('notes')} /></Field></div>
        {f.id && isAdmin && <Toggle checked={f.active} onChange={set('active')} label={t('common.active')} />}
        <button hidden />
      </form>
    </Modal>
  );
}

function Statement({ id, onClose }) {
  const { t, tErr, notify, settings, printDoc, lang, can, ask } = useApp();
  const [data, reload] = useLoad(() => api.customers.statement({ id }), [id]);
  const [collecting, setCollecting] = useState(false);
  const [receiptNo, setReceiptNo] = useState(null);
  const m = (v) => formatMoney(v, settings);
  if (!data) return null;
  const { customer } = data;
  const today = new Date().toLocaleDateString('en-CA');
  const overdue = data.open.filter((x) => x.due_date < today).reduce((s, x) => s + x.open, 0);

  const kindLabel = (r) => ({
    sale: `${t('customers.invoice')} #${r.ref}`,
    return: t('customers.returnCredit'),
    discount: `${t('collect.discount')} — ${t('customers.receipt')} #${r.receipt_no}`,
    bounced: `↩ ${t('cheques.bounced')} ${r.cheque_no}`,
    payment: `${t('customers.receipt')} #${r.receipt_no ?? ''} — ${t(`pay.${r.ref}`)}${r.cheque_no ? ` ${r.cheque_no}` : ''}`,
  }[r.kind]);

  return (
    <Modal title={`${t('purchases.statement')} — ${customer.name}`} onClose={onClose} width={860}
      footer={<>
        <span>{t('customers.balance')}: <b className={customer.balance > 0 ? 'warn' : 'good'}>{m(customer.balance)}</b></span>
        <span className="spacer" />
        {customer.phone && data.open.length > 0 && <button onClick={() => openWhatsApp(customer.phone, reminderText(customer, data.open, settings, t))}>🔔 {t('collect.remind')}</button>}
        <button onClick={() => openWhatsApp(customer.phone, statementText(data, settings, t))}>💬 {t('share.whatsapp')}</button>
        <button onClick={() => savePdf({ html: statementHtml(data, settings, t, lang), name: `${t('purchases.statement')} ${customer.name}` }).catch((err) => notify(tErr(err), 'error'))}>📑 PDF</button>
        <button onClick={() => printDoc(statementHtml(data, settings, t, lang), settings.a4_printer_name)}>🖨 {t('customers.printStatement')}</button>
        <button className="primary" onClick={() => setCollecting(true)}>💵 {t('customers.collect')}</button>
      </>}>
      <div className="meta">
        {customer.phone && <span dir="ltr">📞 {customer.phone}</span>}
        {customer.address && <span>📍 {customer.address}</span>}
        {customer.credit_limit > 0 && <span>{t('customers.limit')}: {m(customer.credit_limit)}</span>}
        <span>{t('collect.terms')}: {t('aging.days', { d: customer.terms_days })}</span>
        {customer.discount_percent > 0 && <span>{t('customers.discountPercent')}: {customer.discount_percent}%</span>}
        {settings.loyalty_enabled && <span>⭐ {t('loyalty.points')}: <b>{formatQty(customer.points || 0)}</b>
          {can('customers_edit') && <button className="ghost sm" onClick={async () => {
            const v = await ask(t('loyalty.adjustPrompt'), { type: 'number' });
            if (v && Number(v)) { try { await api.customers.adjustPoints({ customerId: id, points: Number(v) }); reload(); } catch (err) { notify(tErr(err), 'error'); } }
          }}>±</button>}</span>}
      </div>
      <div className="stats">
        <div className="stat strong"><small>{t('customers.balance')}</small><b>{m(customer.balance)}</b></div>
        <div className="stat"><small>{t('collect.openInvoices')}</small><b>{data.open.length}</b></div>
        {overdue > 0 && <div className="stat"><small>{t('aging.overdue')}</small><b className="warn">{m(overdue)}</b></div>}
        {customer.pending_cheques > 0 && <div className="stat"><small>{t('collect.pendingCheques')}</small><b>{m(customer.pending_cheques)}</b></div>}
        {data.advance > 0 && <div className="stat"><small>{t('collect.advance')}</small><b className="good">{m(data.advance)}</b></div>}
      </div>
      <table className="grid">
        <thead><tr><th>{t('orders.date')}</th><th>{t('orders.type')}</th><th className="num">{t('customers.debit')}</th><th className="num">{t('customers.credit')}</th><th className="num">{t('customers.balance')}</th></tr></thead>
        <tbody>
          {!!customer.opening_balance && (
            <tr><td>—</td><td>{t('customers.opening')}</td><td className="num">{customer.opening_balance > 0 ? m(customer.opening_balance) : ''}</td><td className="num">{customer.opening_balance < 0 ? m(-customer.opening_balance) : ''}</td><td className="num"><b>{m(customer.opening_balance)}</b></td></tr>
          )}
          {data.rows.map((r) => (
            <tr key={`${r.kind}${r.id}`} className={r.receipt_no ? 'clickable' : r.kind === 'bounced' ? 'audit-hot' : ''} onClick={() => r.receipt_no && setReceiptNo(r.receipt_no)}>
              <td>{r.created_at}</td>
              <td>{kindLabel(r)}{r.kind === 'sale' && r.total !== r.debit && <small className="muted"> ({t('common.total')} {m(r.total)})</small>}{r.kind === 'sale' && r.debit > 0 && r.due_date && <small className="muted"> · {t('collect.due')} {r.due_date}</small>}{r.notes && <small className="muted"> — {r.notes}</small>}</td>
              <td className="num">{r.debit ? m(r.debit) : ''}</td>
              <td className="num">{r.credit ? m(r.credit) : ''}</td>
              <td className="num"><b>{m(r.balance)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!data.rows.length && <Empty>{t('common.none')}</Empty>}
      {collecting && <CollectModal customerId={id} onClose={() => setCollecting(false)} onDone={() => { setCollecting(false); reload(); }} />}
      {receiptNo && <ReceiptModal receiptNo={receiptNo} onClose={() => setReceiptNo(null)} onChanged={reload} />}
    </Modal>
  );
}
