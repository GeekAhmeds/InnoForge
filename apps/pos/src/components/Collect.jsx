import React, { useEffect, useMemo, useState } from 'react';
import { api, savePdf } from '../lib/api.js';
import { formatMoney, fromMinor, toMinor } from '../lib/money.js';
import { collectionHtml } from '../lib/receipt.js';
import { openWhatsApp, receiptText } from '../lib/share.js';
import { Empty, Field, Modal, Toggle, useApp, useLoad } from './ui.jsx';
import { AccountSelect, PickAccount } from '../pages/Treasury.jsx';

const METHODS = ['cash', 'card', 'wallet', 'bank', 'cheque'];

/**
 * Receipt voucher: money (any method, cheque details), an optional settlement discount,
 * and which invoices it pays — automatically the oldest, or picked by hand.
 * `orderId` opens it on one invoice (from the invoices page).
 */
export function CollectModal({ customerId, orderId = null, presetAmount = null, onClose, onDone }) {
  const { t, tErr, notify, settings, printDoc, lang, withApproval, user, can } = useApp();
  const d = settings.decimals;
  const m = (v) => formatMoney(v, settings);
  const [data] = useLoad(() => Promise.all([api.customers.get(customerId), api.customers.openInvoices(customerId), api.auth.salespeople()]), [customerId]);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data || f) return;
    const [customer, inv] = data;
    const target = orderId ? inv.open.find((x) => x.order_id === orderId) : null;
    // presetAmount: one installment of the invoice rather than all it still owes.
    const amount = target ? Math.min(target.open, presetAmount ?? target.open) : Math.max(0, customer.balance);
    setF({
      amount: amount ? fromMinor(amount, d) : '', method: 'cash', discount: '', notes: '',
      chequeNo: '', bank: '', due: '', collectorId: user?.id || '', accountId: null,
      manual: !!target, picks: target ? { [target.order_id]: fromMinor(amount, d) } : {},
      print: true, whatsapp: false,
    });
  }, [data, f, orderId, presetAmount, d, user]);

  const [customer, inv, people] = data || [];
  const value = f ? toMinor(f.amount, d) : 0;
  const disc = f ? toMinor(f.discount, d) : 0;
  const credit = value + disc;

  // Automatic mode shows how the money will be spread over the oldest invoices.
  const plan = useMemo(() => {
    if (!inv || !f) return {};
    if (f.manual) return Object.fromEntries(Object.entries(f.picks).map(([k, v]) => [k, toMinor(v, d)]).filter(([, v]) => v > 0));
    let left = credit;
    const out = {};
    for (const x of inv.open) {
      if (left <= 0) break;
      const take = Math.min(left, x.open);
      if (x.order_id) out[x.order_id] = take; else out.opening = take;
      left -= take;
    }
    return out;
  }, [inv, f, credit, d]);
  const planned = Object.values(plan).reduce((s, v) => s + v, 0);

  if (!data || !f) return null;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const newBalance = customer.balance - credit;
  const overAlloc = f.manual && planned > credit;

  async function save() {
    if (busy || credit <= 0 || overAlloc) return;
    setBusy(true);
    try {
      const allocations = f.manual ? Object.entries(plan).filter(([k]) => k !== 'opening').map(([order_id, amount]) => ({ order_id: Number(order_id), amount })) : null;
      const res = await withApproval((approval) => api.customers.collect({
        customerId, amount: value, method: f.method, discount: disc, notes: f.notes, allocations, approval,
        collectorId: Number(f.collectorId) || null,
        accountId: ['bank', 'card', 'wallet'].includes(f.method) ? f.accountId : null,
        cheque: f.method === 'cheque' ? { no: f.chequeNo, bank: f.bank, due: f.due } : null,
      }));
      notify(t('collect.saved', { n: res.receipt.receipt_no }));
      if (f.print) await printDoc(collectionHtml(res.receipt, res.customer, settings, t, lang));
      if (f.whatsapp && res.customer.phone) openWhatsApp(res.customer.phone, receiptText(res.receipt, res.customer, settings, t));
      onDone?.(res);
    } catch (err) {
      if (err.code !== 'CANCELLED') notify(tErr(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`💵 ${t('collect.title')} — ${customer.name}`} onClose={onClose} width={760}
      footer={<>
        <Toggle checked={f.print} onChange={set('print')} label={t('common.print')} />
        {customer.phone && <Toggle checked={f.whatsapp} onChange={set('whatsapp')} label={t('share.whatsapp')} />}
        <span className="spacer" />
        <button onClick={onClose}>{t('common.cancel')}</button>
        <button className="primary" disabled={busy || credit <= 0 || overAlloc} onClick={save}>{t('collect.save')}</button>
      </>}>
      <div className="collect-head">
        <div><small>{t('customers.balance')}</small><b className={customer.balance > 0 ? 'warn' : 'good'}>{m(customer.balance)}</b></div>
        {inv.open.some((x) => x.due_date < today()) && <div><small>{t('aging.overdue')}</small><b className="warn">{m(inv.open.filter((x) => x.due_date < today()).reduce((s, x) => s + x.open, 0))}</b></div>}
        {customer.pending_cheques > 0 && <div><small>{t('collect.pendingCheques')}</small><b>{m(customer.pending_cheques)}</b></div>}
        <div><small>{t('customers.balanceAfter')}</small><b className={newBalance > 0 ? '' : 'good'}>{m(newBalance)}</b></div>
      </div>
      {newBalance < 0 && <p className="muted small">💡 {t('collect.advanceHint', { v: m(-newBalance) })}</p>}

      <div className="seg full">
        {METHODS.map((k) => <button key={k} type="button" className={f.method === k ? 'on' : ''} onClick={() => setF({ ...f, method: k })}>{t(`pay.${k}`)}</button>)}
      </div>
      <div className="grid3 top-gap">
        <Field label={t('reports.amount')}><input className="strong-input" autoFocus inputMode="decimal" value={f.amount} onChange={set('amount')} onFocus={(e) => e.target.select()} /></Field>
        <Field label={t('collect.discount')} hint={t('collect.discountHint')}><input inputMode="decimal" value={f.discount} onChange={set('discount')} placeholder="0" /></Field>
        <Field label={t('collect.collector')}>
          <select value={f.collectorId} onChange={set('collectorId')}>
            {(people || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        {f.method === 'cheque' && <>
          <Field label={t('collect.chequeNo')}><input dir="ltr" value={f.chequeNo} onChange={set('chequeNo')} /></Field>
          <Field label={t('collect.bank')}><input value={f.bank} onChange={set('bank')} /></Field>
          <Field label={t('collect.chequeDue')}><input type="date" value={f.due} onChange={set('due')} /></Field>
        </>}
        {f.method === 'bank' && <div className="span2"><Field label={t('collect.transferRef')}><input value={f.notes} onChange={set('notes')} /></Field></div>}
        {['bank', 'card', 'wallet'].includes(f.method) && can('treasury') && <Field label={t('collect.intoAccount')}><AccountSelect kind="bank" value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} /></Field>}
      </div>
      {f.method !== 'bank' && <Field label={t('pos.note')}><input value={f.notes} onChange={set('notes')} /></Field>}

      <div className="row between top-gap">
        <h4>{t('collect.invoices')}</h4>
        <div className="seg">
          <button type="button" className={!f.manual ? 'on' : ''} onClick={() => setF({ ...f, manual: false })}>{t('collect.auto')}</button>
          <button type="button" className={f.manual ? 'on' : ''} onClick={() => setF({ ...f, manual: true, picks: Object.fromEntries(Object.entries(plan).filter(([k]) => k !== 'opening').map(([k, v]) => [k, fromMinor(v, d)])) })}>{t('collect.manual')}</button>
        </div>
      </div>
      {!inv.open.length ? <Empty>{t('collect.noOpen')}</Empty> : (
        <table className="grid compact">
          <thead><tr><th>{t('customers.invoice')}</th><th>{t('orders.date')}</th><th>{t('collect.due')}</th><th className="num">{t('common.total')}</th><th className="num">{t('collect.remaining')}</th><th className="num">{t('collect.pay')}</th></tr></thead>
          <tbody>{inv.open.map((x) => {
            const key = x.order_id || 'opening';
            const late = x.due_date < today();
            return (
              <tr key={key} className={late ? 'audit-hot' : ''}>
                <td>{x.order_id ? `#${x.invoice_no}` : t('customers.opening')}</td>
                <td>{String(x.date).slice(0, 10)}</td>
                <td className={late ? 'warn' : ''}>{x.due_date}{late && ` · ${t('aging.overdue')}`}</td>
                <td className="num">{m(x.amount)}</td>
                <td className="num"><b>{m(x.open)}</b></td>
                <td className="num">
                  {f.manual && x.order_id ? (
                    <span className="row end">
                      <input className="qty-input" inputMode="decimal" value={f.picks[key] ?? ''} onChange={(e) => setF({ ...f, picks: { ...f.picks, [key]: e.target.value } })} />
                      <button type="button" className="ghost sm" onClick={() => setF({ ...f, picks: { ...f.picks, [key]: fromMinor(x.open, d) } })}>{t('collect.full')}</button>
                    </span>
                  ) : plan[key] ? m(plan[key]) : ''}
                </td>
              </tr>
            );
          })}</tbody>
          <tfoot><tr><td colSpan={4}>{f.manual ? t('collect.manualHint') : t('collect.autoHint')}</td><td className="num">{m(inv.open.reduce((s, x) => s + x.open, 0))}</td><td className={`num ${overAlloc ? 'warn' : ''}`}><b>{m(planned)}</b></td></tr></tfoot>
        </table>
      )}
      {overAlloc && <p className="warn">{t('err.ALLOCATION_EXCEEDS_PAYMENT')}</p>}
    </Modal>
  );
}

const today = () => new Date().toLocaleDateString('en-CA');

/** One receipt voucher: details, reprint, WhatsApp, PDF and void. */
export function ReceiptModal({ receiptNo, onClose, onChanged }) {
  const { t, tErr, notify, settings, printDoc, lang, withApproval, ask } = useApp();
  const [r, reload] = useLoad(() => api.customers.receipt(receiptNo), [receiptNo]);
  const m = (v) => formatMoney(v, settings);
  if (!r) return null;
  const html = () => collectionHtml(r, r.customer, settings, t, lang);
  async function voidIt() {
    const reason = await ask(t('collect.voidReason'), { required: true });
    if (!reason) return;
    try {
      await withApproval((approval) => api.customers.voidReceipt({ receiptNo, reason, approval }));
      notify(t('collect.voided'));
      reload();
      onChanged?.();
    } catch (err) {
      if (err.code !== 'CANCELLED') notify(tErr(err), 'error');
    }
  }
  return (
    <Modal title={`${t('customers.receipt')} #${r.receipt_no}`} onClose={onClose} width={560}
      footer={<>
        {r.status === 'posted' && <button className="danger-ghost" onClick={voidIt}>⛔ {t('collect.void')}</button>}
        <span className="spacer" />
        {r.customer.phone && <button onClick={() => openWhatsApp(r.customer.phone, receiptText(r, r.customer, settings, t))}>💬 {t('share.whatsapp')}</button>}
        <button onClick={() => savePdf({ html: html(), name: `${t('customers.receipt')} ${r.receipt_no}` }).catch((err) => notify(tErr(err), 'error'))}>📑 PDF</button>
        <button className="primary" onClick={() => printDoc(html())}>🖨 {t('common.print')}</button>
      </>}>
      {r.status !== 'posted' && <div className="banner danger">{t(`collect.status.${r.status}`)} — {r.voided_at} {r.voided_by_name ? `(${r.voided_by_name})` : ''}{r.void_reason ? `: ${r.void_reason}` : ''}</div>}
      <div className="kv">
        <span>{t('pos.customer')}</span><b>{r.customer.name}</b>
        <span>{t('orders.date')}</span><span>{r.created_at}</span>
        <span>{t('collect.method')}</span><span>{t(`pay.${r.method}`)}{r.cheque_no ? ` — ${r.cheque_no}${r.bank ? ` / ${r.bank}` : ''}${r.cheque_due ? ` (${r.cheque_due})` : ''}` : ''}{r.cheque_status ? ` · ${t(`cheques.status.${r.cheque_status}`)}` : ''}</span>
        <span>{t('reports.amount')}</span><b>{m(r.amount)}</b>
        {!!r.discount && <><span>{t('collect.discount')}</span><span>{m(r.discount)}</span></>}
        <span>{t('collect.collector')}</span><span>{r.collector_name}</span>
        {r.notes && <><span>{t('pos.note')}</span><span>{r.notes}</span></>}
      </div>
      {!!r.allocations.length && (
        <table className="grid compact top-gap">
          <thead><tr><th>{t('customers.invoice')}</th><th>{t('orders.date')}</th><th className="num">{t('collect.pay')}</th></tr></thead>
          <tbody>{r.allocations.map((a) => <tr key={a.order_id}><td>#{a.invoice_no}</td><td>{String(a.completed_at).slice(0, 10)}</td><td className="num">{m(a.amount)}</td></tr>)}</tbody>
        </table>
      )}
    </Modal>
  );
}

/** Receipt vouchers list with totals per method. */
export function Receipts() {
  const { t, settings } = useApp();
  const first = new Date(); first.setDate(1);
  const [from, setFrom] = useState(first.toLocaleDateString('en-CA'));
  const [to, setTo] = useState(today());
  const [search, setSearch] = useState('');
  const [data, reload] = useLoad(() => api.customers.receipts({ from, to, search }), [from, to, search]);
  const [view, setView] = useState(null);
  const m = (v) => formatMoney(v, settings);
  return (
    <>
      <div className="filters toolbar">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <input placeholder={t('collect.searchHint')} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="stats">
        <div className="stat strong"><small>{t('collect.total')}</small><b>{m(data?.totals.amount || 0)}</b></div>
        {Object.entries(data?.totals.byMethod || {}).map(([k, v]) => <div className="stat" key={k}><small>{t(`pay.${k}`)}</small><b>{m(v)}</b></div>)}
        {!!data?.totals.discount && <div className="stat"><small>{t('collect.discounts')}</small><b>{m(data.totals.discount)}</b></div>}
      </div>
      <div className="card flush">
        <table className="grid">
          <thead><tr><th>#</th><th>{t('orders.date')}</th><th>{t('pos.customer')}</th><th>{t('collect.method')}</th><th>{t('collect.collector')}</th><th className="num">{t('collect.discount')}</th><th className="num">{t('reports.amount')}</th></tr></thead>
          <tbody>{(data?.rows || []).map((r) => (
            <tr key={r.receipt_no} className={`clickable ${r.status !== 'posted' ? 'dim' : ''}`} onClick={() => setView(r.receipt_no)}>
              <td><b>{r.receipt_no}</b></td><td>{r.created_at.slice(0, 16)}</td><td>{r.customer_name}</td>
              <td>{r.method ? t(`pay.${r.method}`) : '—'}{r.cheque_no ? ` · ${r.cheque_no}` : ''}{r.status !== 'posted' && <small className="badge credit">{t(`collect.status.${r.status}`)}</small>}</td>
              <td className="muted">{r.collector_name}</td>
              <td className="num">{r.discount ? m(r.discount) : ''}</td>
              <td className="num"><b>{m(r.amount)}</b></td>
            </tr>
          ))}</tbody>
        </table>
        {data && !data.rows.length && <Empty>{t('common.none')}</Empty>}
      </div>
      {view && <ReceiptModal receiptNo={view} onClose={() => setView(null)} onChanged={reload} />}
    </>
  );
}

/** Cheques received: due soon, cleared, bounced. */
export function Cheques() {
  const { t, tErr, notify, settings, can, ask } = useApp();
  const [status, setStatus] = useState('pending');
  const [list, reload] = useLoad(() => api.customers.cheques({ status }), [status]);
  const [clearing, setClearing] = useState(null);
  const m = (v) => formatMoney(v, settings);
  const run = async (fn) => { try { await fn(); reload(); } catch (err) { notify(tErr(err), 'error'); } };
  const total = (list || []).reduce((s, c) => s + c.amount, 0);
  return (
    <>
      <div className="filters toolbar">
        <div className="seg">
          {['pending', 'cleared', 'bounced', ''].map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s ? t(`cheques.status.${s}`) : t('common.all')}</button>)}
        </div>
        <span className="spacer" />
        <span>{t('common.total')}: <b>{m(total)}</b></span>
      </div>
      <div className="card flush">
        <table className="grid">
          <thead><tr><th>{t('collect.chequeNo')}</th><th>{t('collect.bank')}</th><th>{t('pos.customer')}</th><th>{t('collect.chequeDue')}</th><th>{t('customers.receipt')}</th><th className="num">{t('reports.amount')}</th><th /></tr></thead>
          <tbody>{(list || []).map((c) => (
            <tr key={c.id} className={c.cheque_status === 'pending' && c.days_left != null && c.days_left <= 3 ? 'audit-hot' : ''}>
              <td className="mono" dir="ltr">{c.cheque_no}</td><td>{c.bank}</td><td>{c.customer_name}</td>
              <td>{c.cheque_due || '—'}{c.cheque_status === 'pending' && c.days_left != null && <small className="muted"> ({c.days_left >= 0 ? t('cheques.inDays', { d: c.days_left }) : t('cheques.late', { d: -c.days_left })})</small>}</td>
              <td>#{c.receipt_no}</td>
              <td className="num"><b>{m(c.amount)}</b></td>
              <td className="num">
                {c.cheque_status === 'pending' && can('customers_edit') && <>
                  <button className="ghost sm" onClick={() => (can('treasury') ? setClearing(c) : run(() => api.customers.clearCheque(c.id)))}>✅ {t('cheques.clear')}</button>
                  <button className="danger-ghost sm" onClick={async () => { const reason = await ask(t('cheques.bounceReason')); if (reason != null) run(() => api.customers.bounceCheque({ id: c.id, reason })); }}>↩ {t('cheques.bounce')}</button>
                </>}
                {c.cheque_status !== 'pending' && <span className={`badge ${c.cheque_status === 'bounced' ? 'credit' : ''}`}>{t(`cheques.status.${c.cheque_status}`)}</span>}
              </td>
            </tr>
          ))}</tbody>
        </table>
        {list && !list.length && <Empty>{t('cheques.none')}</Empty>}
      </div>
      {clearing && <PickAccount title={`✅ ${clearing.cheque_no}`} kind="bank" optional onClose={() => setClearing(null)}
        onPick={(accountId) => { run(() => api.customers.clearCheque({ id: clearing.id, accountId })); setClearing(null); }} />}
    </>
  );
}
