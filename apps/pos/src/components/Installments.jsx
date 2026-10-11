import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney } from '../lib/money.js';
import { installmentsHtml } from '../lib/receipt.js';
import { openWhatsApp } from '../lib/share.js';
import { CollectModal } from './Collect.jsx';
import { Empty, Field, Modal, useApp, useLoad } from './ui.jsx';

const todayStr = () => new Date().toLocaleDateString('en-CA');
export function addMonthsStr(n) {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toLocaleDateString('en-CA');
}

/** Count / every N months / first due date — used on the sales invoice and for an existing invoice. */
export function InstallmentFields({ value, onChange, amount }) {
  const { t, settings } = useApp();
  const n = Math.max(1, Number(value.count) || 1);
  return (
    <div className="inst-fields">
      <div className="row">
        <Field label={t('inst.count')}><input className="w-pct" inputMode="numeric" value={value.count} onChange={(e) => onChange({ ...value, count: e.target.value })} /></Field>
        <Field label={t('inst.every')}>
          <select value={value.period} onChange={(e) => onChange({ ...value, period: e.target.value })}>
            {[1, 2, 3, 6, 12].map((x) => <option key={x} value={x}>{t('inst.months', { n: x })}</option>)}
          </select>
        </Field>
        <Field label={t('inst.firstDue')}><input type="date" min={todayStr()} value={value.firstDue} onChange={(e) => onChange({ ...value, firstDue: e.target.value })} /></Field>
      </div>
      {amount > 0 && <p className="muted small">{t('inst.preview', { n, v: formatMoney(Math.floor(amount / n), settings) })}</p>}
    </div>
  );
}

export const newInstallmentForm = () => ({ count: '6', period: '1', firstDue: addMonthsStr(1) });

/** Turns an existing credit invoice into installments. */
export function MakePlanModal({ order, onClose, onDone }) {
  const { t, tErr, notify, withApproval } = useApp();
  const [f, setF] = useState(newInstallmentForm);
  const save = async () => {
    try {
      const plan = await withApproval((approval) => api.installments.create({ orderId: order.id, count: Number(f.count), periodMonths: Number(f.period), firstDue: f.firstDue, approval }));
      onDone(plan);
    } catch (err) {
      if (err.code !== 'CANCELLED') notify(tErr(err), 'error');
    }
  };
  return (
    <Modal title={`📆 ${t('inst.make')} — #${order.invoice_no}`} onClose={onClose} width={520}
      footer={<><span className="spacer" /><button onClick={onClose}>{t('common.cancel')}</button><button className="primary" onClick={save}>{t('common.save')}</button></>}>
      <InstallmentFields value={f} onChange={setF} amount={order.open_amount} />
    </Modal>
  );
}

/** The schedule of one invoice: state of every installment, print, collect, cancel. */
export function ScheduleModal({ orderId, onClose, onChanged = () => {} }) {
  const { t, tErr, notify, settings, printDoc, lang, can } = useApp();
  const [plan, reload] = useLoad(() => api.installments.get(orderId), [orderId]);
  const [collect, setCollect] = useState(null);
  const m = (v) => formatMoney(v, settings);
  if (!plan) return null;
  const next = plan.items.find((i) => i.open > 0);
  const cancel = async () => {
    if (!window.confirm(t('inst.cancelConfirm'))) return;
    try { await api.installments.cancel(orderId); onChanged(); onClose(); } catch (err) { notify(tErr(err), 'error'); }
  };
  return (
    <Modal title={`📆 ${t('inst.schedule')} — #${plan.invoice_no} · ${plan.customer_name}`} onClose={onClose} width={680}
      footer={<>
        {can('customers_edit') && <button className="danger-ghost" onClick={cancel}>{t('inst.cancel')}</button>}
        <span className="spacer" />
        <button onClick={() => printDoc(installmentsHtml(plan, settings, t, lang), settings.a4_printer_name)}>📄 {t('a4.printA4')}</button>
        {next && <button className="primary" onClick={() => setCollect(next)}>💵 {t('inst.collectNext')}</button>}
      </>}>
      <div className="row wrap">
        <span>{t('common.total')}: <b>{m(plan.total)}</b></span>
        <span>{t('inst.downPayment')}: <b>{m(plan.down_payment)}</b></span>
        <span>{t('inst.left')}: <b className={plan.open > 0 ? 'warn' : 'good'}>{m(plan.open)}</b></span>
        <span className="muted">{t('inst.progress', { a: plan.paid_count, b: plan.items.length })}</span>
      </div>
      <table className="grid compact top-gap">
        <thead><tr><th>#</th><th>{t('inst.dueDate')}</th><th className="num">{t('inst.amount')}</th><th className="num">{t('inst.paid')}</th><th className="num">{t('inst.left')}</th><th>{t('common.status')}</th></tr></thead>
        <tbody>{plan.items.map((i) => (
          <tr key={i.seq} className={i.status === 'overdue' ? 'warn' : ''}>
            <td>{i.seq}</td><td dir="ltr">{i.due_date}</td><td className="num">{m(i.amount)}</td><td className="num">{i.paid ? m(i.paid) : ''}</td>
            <td className="num"><b>{i.open ? m(i.open) : '✓'}</b></td><td><span className={`badge inst-${i.status}`}>{t(`inst.status.${i.status}`)}</span></td>
          </tr>
        ))}</tbody>
      </table>
      {collect && <CollectModal customerId={plan.customer_id} orderId={plan.order_id} presetAmount={collect.open} onClose={() => setCollect(null)} onDone={() => { setCollect(null); reload(); onChanged(); }} />}
    </Modal>
  );
}

/** Customers → Installments: what is due (or overdue) soon, and every plan with its progress. */
export function InstallmentsTab() {
  const { t, settings } = useApp();
  const [days, setDays] = useState(7);
  const [openOnly, setOpenOnly] = useState(true);
  const [due, reloadDue] = useLoad(() => api.installments.due({ days }), [days]);
  const [plans, reloadPlans] = useLoad(() => api.installments.plans({ openOnly }), [openOnly]);
  const [view, setView] = useState(null);
  const [collect, setCollect] = useState(null);
  const m = (v) => formatMoney(v, settings);
  const reload = () => { reloadDue(); reloadPlans(); };
  const remind = (d) => openWhatsApp(d.customer_phone, t('inst.reminder', { name: d.customer_name, v: m(d.open), date: d.due_date, n: d.installment, business: settings.business_name }));
  return (
    <>
      <div className="card flush">
        <div className="row between pad nowrap-head">
          <h3>⏰ {t('inst.dueSoon')}</h3>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[0, 7, 30].map((x) => <option key={x} value={x}>{x ? t('inst.nextDays', { n: x }) : t('inst.onlyOverdue')}</option>)}
          </select>
        </div>
        <table className="grid">
          <thead><tr><th>{t('pos.customer')}</th><th>{t('receipt.invoice')}</th><th>#</th><th>{t('inst.dueDate')}</th><th className="num">{t('inst.left')}</th><th /></tr></thead>
          <tbody>{(due || []).map((d) => (
            <tr key={`${d.order_id}-${d.installment}`} className={d.overdue ? 'warn' : ''}>
              <td><b>{d.customer_name}</b> <small className="muted" dir="ltr">{d.customer_phone}</small></td>
              <td><button className="link" onClick={() => setView(d.order_id)}>#{d.invoice_no}</button></td>
              <td>{d.installment}/{d.installments}</td>
              <td dir="ltr">{d.due_date}{d.overdue ? ' ⚠' : ''}</td>
              <td className="num"><b>{m(d.open)}</b></td>
              <td className="row">
                {d.customer_phone && <button className="sm" onClick={() => remind(d)}>💬</button>}
                <button className="primary sm" onClick={() => setCollect(d)}>💵 {t('customers.collect')}</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
        {due && !due.length && <Empty>{t('inst.noneDue')}</Empty>}
      </div>

      <div className="card flush top-gap">
        <div className="row between pad nowrap-head">
          <h3>📆 {t('inst.plans')}</h3>
          <label className="row"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> {t('inst.openOnly')}</label>
        </div>
        <table className="grid">
          <thead><tr><th>{t('pos.customer')}</th><th>{t('receipt.invoice')}</th><th className="num">{t('common.total')}</th><th>{t('inst.progressCol')}</th><th>{t('inst.next')}</th><th className="num">{t('inst.left')}</th><th className="num">{t('aging.overdue')}</th></tr></thead>
          <tbody>{(plans || []).map((p) => (
            <tr key={p.id} className="clickable" onClick={() => setView(p.order_id)}>
              <td><b>{p.customer_name}</b></td><td>#{p.invoice_no}</td><td className="num">{m(p.total)}</td>
              <td>{p.count - p.count_left}/{p.count}</td>
              <td dir="ltr">{p.next ? `${p.next.due_date} · ${m(p.next.open)}` : '✓'}</td>
              <td className="num"><b>{m(p.open)}</b></td>
              <td className={`num ${p.overdue ? 'warn' : 'muted'}`}>{p.overdue ? m(p.overdue) : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
        {plans && !plans.length && <Empty>{t('common.none')}</Empty>}
      </div>
      {view && <ScheduleModal orderId={view} onClose={() => setView(null)} onChanged={reload} />}
      {collect && <CollectModal customerId={collect.customer_id} orderId={collect.order_id} presetAmount={collect.open} onClose={() => setCollect(null)} onDone={() => { setCollect(null); reload(); }} />}
    </>
  );
}
