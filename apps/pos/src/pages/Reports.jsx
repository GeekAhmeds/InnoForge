import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, formatQty } from '../lib/money.js';
import { Empty, useApp, useLoad } from '../components/ui.jsx';
import { ExcelButtons } from '../components/ExcelImport.jsx';
import { today } from './Orders.jsx';

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
};
const monthStart = () => today().slice(0, 8) + '01';

export default function Reports() {
  const { t, settings } = useApp();
  const [range, setRange] = useState({ from: today(), to: today() });
  const [r] = useLoad(() => api.reports.summary(range), [range.from, range.to]);
  const [com] = useLoad(() => api.commissions.report(range), [range.from, range.to]);
  const m = (v) => formatMoney(v, settings);
  const presets = [
    ['reports.today', today(), today()],
    ['reports.week', daysAgo(6), today()],
    ['reports.month', monthStart(), today()],
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h2>📊 {t('reports.title')}</h2>
        <div className="filters">
          <div className="seg">
            {presets.map(([k, from, to]) => (
              <button key={k} className={range.from === from && range.to === to ? 'on' : ''} onClick={() => setRange({ from, to })}>{t(k)}</button>
            ))}
          </div>
          <input type="date" value={range.from} onChange={(e) => setRange((x) => ({ ...x, from: e.target.value }))} />
          <input type="date" value={range.to} onChange={(e) => setRange((x) => ({ ...x, to: e.target.value }))} />
          <ExcelButtons kind="report" exportKind="report" params={range} importable={false} />
        </div>
      </div>

      {r && (
        <>
          <div className="stats">
            <Stat label={t('reports.gross')} value={m(r.totals.gross)} />
            <Stat label={t('reports.net')} value={m(r.totals.net)} />
            <Stat label={t('reports.orders')} value={r.totals.orders} />
            <Stat label={t('reports.average')} value={m(r.totals.average)} />
            {r.totals.profit != null && <Stat label={t('reports.profit')} value={m(r.totals.profit)} />}
            <Stat label={t('shift.refunds')} value={m(r.totals.refunds)} />
            <Stat label={t('reports.purchases')} value={m(r.totals.purchases)} />
            <Stat label={t('reports.expenses')} value={m(r.totals.expenses)} />
            <Stat label={t('reports.creditSales')} value={m(r.totals.creditSales)} />
            <Stat label={t('reports.collections')} value={m(r.totals.collections)} />
            <Stat label={t('customers.receivables')} value={m(r.totals.receivables)} />
            {!!r.totals.settlementDiscounts && <Stat label={t('collect.discounts')} value={`− ${m(r.totals.settlementDiscounts)}`} />}
            {!!r.totals.rebates && <Stat label={t('rebates.title')} value={`+ ${m(r.totals.rebates)}`} />}
            {r.totals.netProfit != null && <Stat label={t('reports.netProfit')} value={m(r.totals.netProfit)} strong />}
          </div>
          <div className="report-grid">
            <BarList title={t('reports.byDay')} rows={r.byDay.map((x) => [x.day, x.total, x.orders])} m={m} />
            <BarList title={t('reports.byMethod')} rows={r.byMethod.map((x) => [t(`pay.${x.method}`), x.amount, x.orders])} m={m} />
            <BarList title={t('reports.topProducts')} rows={r.topProducts.map((x) => [x.name, x.total, formatQty(x.qty)])} m={m} />
            <BarList title={t('reports.byCategory')} rows={r.byCategory.map((x) => [x.name || t('products.noCategory'), x.total])} m={m} />
            {settings.business_type === 'restaurant' && <BarList title={t('reports.byType')} rows={r.byType.map((x) => [t(`order.${x.order_type}`), x.total, x.orders])} m={m} />}
            <BarList title={t('reports.byHour')} rows={r.byHour.map((x) => [`${String(x.hour).padStart(2, '0')}:00`, x.total, x.orders])} m={m} />
            <BarList title={t('reports.expensesByCategory')} rows={r.expensesByCategory.map((x) => [x.category || '—', x.total])} m={m} />
            <BarList title={t('reports.topCustomers')} rows={r.topCustomers.map((x) => [x.name, x.total, x.orders])} m={m} />
            <BarList title={t('reports.byCashier')} rows={r.byCashier.map((x) => [x.name, x.total, x.orders])} m={m} />
          </div>
          {!!com?.length && (
            <div className="card flush top-gap">
              <h3 className="pad">💼 {t('reports.commissions')}</h3>
              <table className="grid">
                <thead><tr><th>{t('pos.salesperson')}</th><th className="num">{t('reports.orders')}</th><th className="num">{t('reports.netSales')}</th><th className="num">{t('users.commission')}</th><th className="num">{t('reports.commissionDue')}</th></tr></thead>
                <tbody>{com.map((c) => <tr key={c.id}><td>{c.name}</td><td className="num">{c.orders}</td><td className="num">{m(c.net)}</td><td className="num">{c.rate}%</td><td className="num"><b>{m(c.commission)}</b></td></tr>)}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, strong }) {
  return <div className={`stat ${strong ? 'strong' : ''}`}><small>{label}</small><b>{value}</b></div>;
}

// A compact table with inline bars — readable without a chart library.
function BarList({ title, rows, m }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="card">
      <h3>{title}</h3>
      {!rows.length ? <Empty>—</Empty> : (
        <div className="barlist">
          {rows.map(([label, value, extra]) => (
            <div key={label} className="bar-row">
              <span className="bar-label" title={label}>{label}</span>
              <span className="bar-track"><span className="bar" style={{ width: `${(value / max) * 100}%` }} /></span>
              <span className="bar-value">{m(value)}{extra != null && <small className="muted"> · {extra}</small>}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
