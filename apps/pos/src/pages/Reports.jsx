import React, { useMemo, useState } from 'react';
import { api, reportExcel, savePdf } from '../lib/api.js';
import { formatMoney, formatQty } from '../lib/money.js';
import { reportHtml } from '../lib/receipt.js';
import { Empty, useApp, useLoad } from '../components/ui.jsx';
import { today } from './Orders.jsx';
import { has } from '../lib/features.js';

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
};
const monthStart = () => today().slice(0, 8) + '01';

const GROUPS = { overview: '📊', sales: '🧾', money: '💰', stock: '📦', purchases: '🚚', customers: '👥', staff: '🧑‍💼' };

const yesterday = () => daysAgo(1);
const lastMonth = () => { const d = new Date(); d.setDate(0); const end = d.toLocaleDateString('en-CA'); return [end.slice(0, 8) + '01', end]; };
const yearStart = () => today().slice(0, 5) + '01-01';

// Reports: an overview, then every report in the catalog with the same viewer; each one
// exports to a formatted Excel file, a PDF, or prints.
export default function Reports() {
  const { t } = useApp();
  const [catalog] = useLoad(() => api.reports.catalog(), []);
  const [current, setCurrent] = useState('overview');
  const [range, setRange] = useState({ from: today(), to: today() });
  const groups = useMemo(() => {
    const g = {};
    for (const r of catalog || []) (g[r.group] ||= []).push(r);
    return g;
  }, [catalog]);
  const meta = (catalog || []).find((r) => r.id === current);
  const presets = [
    ['reports.today', today(), today()],
    ['rep.yesterday', yesterday(), yesterday()],
    ['reports.week', daysAgo(6), today()],
    ['reports.month', monthStart(), today()],
    ['rep.lastMonth', ...lastMonth()],
    ['rep.year', yearStart(), today()],
  ];
  return (
    <div className="page reports-page">
      <div className="page-head">
        <h2>📊 {t('reports.title')}</h2>
        {!meta?.noRange && (
          <div className="filters">
            <div className="seg">
              {presets.map(([k, from, to]) => (
                <button key={k} className={range.from === from && range.to === to ? 'on' : ''} onClick={() => setRange({ from, to })}>{t(k)}</button>
              ))}
            </div>
            <input type="date" value={range.from} onChange={(e) => setRange((x) => ({ ...x, from: e.target.value }))} />
            <input type="date" value={range.to} onChange={(e) => setRange((x) => ({ ...x, to: e.target.value }))} />
          </div>
        )}
      </div>
      <div className="reports-layout">
        <nav className="report-nav card">
          <button className={current === 'overview' ? 'on' : ''} onClick={() => setCurrent('overview')}>{GROUPS.overview} {t('rep.overview')}</button>
          {Object.keys(GROUPS).filter((g) => groups[g]).map((g) => (
            <div key={g}>
              <h4>{GROUPS[g]} {t(`rep.group.${g}`)}</h4>
              {groups[g].map((r) => <button key={r.id} className={current === r.id ? 'on' : ''} onClick={() => setCurrent(r.id)}>{t(`rep.${r.id}`)}</button>)}
            </div>
          ))}
        </nav>
        <div className="report-main">
          {current === 'overview' ? <Overview range={range} /> : <ReportView id={current} range={meta?.noRange ? {} : range} />}
        </div>
      </div>
    </div>
  );
}

/** Text shown for one cell (and written to Excel/PDF). */
export function cellText(c, v, row, { t, settings }) {
  if (v == null || v === '') return '';
  switch (c.type) {
    case 'money': return formatMoney(v, settings);
    case 'qty': return formatQty(v);
    case 'int': return String(v);
    case 'pct': return `${v}%`;
    case 'date': return String(v).slice(0, 10);
    case 'datetime': return String(v).slice(0, 16);
    case 'type': return t(`order.${v}`);
    case 'method': return v === 'credit' ? t('pay.onAccount') : t(`pay.${v}`);
    case 'kind': return t(`treasury.kind.${v}`);
    case 'label': return row?.raw ? v : t(v);
    default: return v === 'drawer' && c.key === 'source' ? t('rep.drawer') : String(v);
  }
}

function ReportView({ id, range }) {
  const { t, tErr, notify, settings, printDoc, lang } = useApp();
  const [r] = useLoad(() => api.reports.run({ id, ...range }), [id, range.from, range.to]);
  const [sort, setSort] = useState(null); // { key, dir }
  const [q, setQ] = useState('');
  if (!r) return <div className="card"><Empty>…</Empty></div>;
  const title = t(`rep.${id}`);
  const colLabel = (c) => (c.raw ? c.label : t(c.label));
  const period = r.from ? (r.from === r.to ? r.from : `${r.from} → ${r.to}`) : t('rep.asOfNow');
  const ctx = { t, settings };
  let rows = r.rows;
  if (q.trim()) {
    const s = q.trim().toLowerCase();
    rows = rows.filter((row) => r.columns.some((c) => String(cellText(c, row[c.key], row, ctx)).toLowerCase().includes(s)));
  }
  if (sort) {
    const c = r.columns.find((x) => x.key === sort.key);
    const num = ['money', 'qty', 'int', 'pct'].includes(c?.type);
    rows = [...rows].sort((a, b) => {
      const x = a[sort.key] ?? ''; const y = b[sort.key] ?? '';
      const d = num ? (Number(x) || 0) - (Number(y) || 0) : String(cellText(c, x, a, ctx)).localeCompare(String(cellText(c, y, b, ctx)), lang);
      return sort.dir * d;
    });
  }
  const view = { ...r, rows };
  const totalsShown = r.columns.some((c) => c.total) && rows.length > 0;
  const totals = {};
  for (const c of r.columns) if (c.total) totals[c.key] = rows.reduce((sum, row) => sum + (Number(row[c.key]) || 0), 0);
  const labels = () => {
    const values = {};
    for (const c of r.columns) {
      if (!['type', 'method', 'kind', 'label', 'text'].includes(c.type)) continue;
      values[c.key] = {};
      for (const row of r.rows) if (row[c.key] != null) values[c.key][row[c.key]] = cellText(c, row[c.key], row, ctx);
    }
    return {
      title, period: `${t('rep.period')}: ${period}`, total: t('common.total'),
      columns: Object.fromEntries(r.columns.map((c) => [c.key, colLabel(c)])), values,
      summary: (r.summary || []).map((x) => `${t(x.label)}: ${cellText({ type: x.type }, x.value, null, ctx)}`),
      currencyNote: t('rep.currencyNote', { c: settings.currency }),
    };
  };
  const html = () => reportHtml({ ...view, totals }, labels(), settings, lang, (c, v, row) => cellText(c, v, row, ctx));
  const run = async (fn) => { try { await fn(); } catch (err) { notify(tErr(err), 'error'); } };
  return (
    <div className="card flush report-view">
      <div className="report-head pad">
        <div>
          <h3>{title}</h3>
          <small className="muted">{t('rep.period')}: <span dir="ltr">{period}</span> · {t('rep.rows', { n: rows.length })}</small>
        </div>
        <div className="row wrap">
          <input className="w-auto" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <button onClick={() => run(async () => { const p = await reportExcel({ id, ...range, labels: labels() }); if (p) notify(t('rep.saved')); })}>📗 Excel</button>
          <button onClick={() => run(() => savePdf({ html: html(), name: `${title} ${r.from || ''}`, landscape: r.columns.length > 6 }))}>📕 PDF</button>
          <button className="primary" onClick={() => run(() => printDoc(html(), settings.a4_printer_name))}>🖨 {t('rep.print')}</button>
        </div>
      </div>
      {(r.summary || []).length > 0 && <div className="stats pad">{r.summary.map((x) => <Stat key={x.label} label={t(x.label)} value={cellText({ type: x.type }, x.value, null, ctx)} strong />)}</div>}
      <div className="report-table-wrap">
        <table className="grid report-table">
          <thead><tr>{r.columns.map((c) => (
            <th key={c.key} className={['money', 'qty', 'int', 'pct'].includes(c.type) ? 'num' : ''} onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: -s.dir } : { key: c.key, dir: ['money', 'qty', 'int', 'pct'].includes(c.type) ? -1 : 1 }))}>
              {colLabel(c)}{sort?.key === c.key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
            </th>
          ))}</tr></thead>
          <tbody>{rows.map((row, i) => (
            <tr key={i} className={row.kind === 'sum' ? 'sum-row' : ''}>
              {r.columns.map((c) => {
                const numeric = ['money', 'qty', 'int', 'pct', 'date', 'datetime'].includes(c.type);
                return <td key={c.key} className={`${numeric && c.type !== 'date' && c.type !== 'datetime' ? 'num' : ''} ${(c.type === 'money' || c.type === 'pct') && row[c.key] < 0 ? 'warn' : ''}`}>{numeric ? <span dir="ltr">{cellText(c, row[c.key], row, ctx)}</span> : cellText(c, row[c.key], row, ctx)}</td>;
              })}
            </tr>
          ))}</tbody>
          {totalsShown && (
            <tfoot><tr>{r.columns.map((c, i) => <td key={c.key} className={c.total ? 'num' : ''}>{i === 0 ? t('common.total') : c.total ? <span dir="ltr">{cellText(c, totals[c.key], null, ctx)}</span> : ''}</td>)}</tr></tfoot>
          )}
        </table>
        {!rows.length && <Empty>{t('rep.empty')}</Empty>}
      </div>
    </div>
  );
}

function Overview({ range }) {
  const { t, settings } = useApp();
  const [r] = useLoad(() => api.reports.summary(range), [range.from, range.to]);
  const m = (v) => formatMoney(v, settings);
  return (
    <div>
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
            {has('restaurant') && <BarList title={t('reports.byType')} rows={r.byType.map((x) => [t(`order.${x.order_type}`), x.total, x.orders])} m={m} />}
            <BarList title={t('reports.byHour')} rows={r.byHour.map((x) => [`${String(x.hour).padStart(2, '0')}:00`, x.total, x.orders])} m={m} />
            <BarList title={t('reports.expensesByCategory')} rows={r.expensesByCategory.map((x) => [x.category || '—', x.total])} m={m} />
            <BarList title={t('reports.topCustomers')} rows={r.topCustomers.map((x) => [x.name, x.total, x.orders])} m={m} />
            <BarList title={t('reports.byCashier')} rows={r.byCashier.map((x) => [x.name, x.total, x.orders])} m={m} />
          </div>
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
