import React from 'react';
import { api } from '../lib/api.js';
import { formatMoney, formatQty } from '../lib/money.js';
import { Empty, useApp, useLoad } from '../components/ui.jsx';

// The owner's first look at the day: sales and profit against yesterday, cash in the
// drawer, and what needs attention (stock, overdue customers, cheques due).
export default function Dashboard() {
  const { t, settings, setPage } = useApp();
  const [d, reload] = useLoad(() => api.reports.dashboard(), []);
  const m = (v) => formatMoney(v, settings);
  if (!d) return null;
  const change = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
  const salesChange = change(d.today.total, d.yesterday.total);
  const max7 = Math.max(1, ...d.last7.map((x) => x.total));
  const maxHour = Math.max(1, ...d.byHour.map((x) => x.total));

  return (
    <div className="page dashboard">
      <div className="page-head">
        <h2>📈 {t('nav.dashboard')}</h2>
        <button className="ghost" onClick={reload}>↻ {t('dash.refresh')}</button>
      </div>

      <div className="dash-tiles">
        <Tile label={t('dash.salesToday')} value={m(d.today.total)} note={salesChange == null ? `${d.today.orders} ${t('dash.invoices')}` : `${salesChange >= 0 ? '▲' : '▼'} ${Math.abs(salesChange)}% ${t('dash.vsYesterday')}`} tone={salesChange == null ? '' : salesChange >= 0 ? 'up' : 'down'} strong />
        {!d.hiddenProfit && <Tile label={t('dash.profitToday')} value={m(d.today.profit)} note={`${t('dash.month')}: ${m(d.month.profit)}`} />}
        <Tile label={t('dash.month')} value={m(d.month.total)} note={`${d.month.orders} ${t('dash.invoices')}`} />
        <Tile label={t('dash.drawer')} value={d.shift ? m(d.shift.expectedCash) : '—'} note={d.shift ? `${t('dash.shiftSince')} ${d.shift.opened_at.slice(11, 16)}` : t('shift.none')} onClick={() => setPage('shift')} />
        <Tile label={t('customers.receivables')} value={m(d.receivables)} note={d.overdueCount ? `⚠ ${t('aging.overdue')} ${m(d.overdueAmount)}` : '✓'} tone={d.overdueCount ? 'down' : ''} onClick={() => setPage('customers')} />
        <Tile label={t('dash.payables')} value={m(d.payables)} onClick={() => setPage('purchases')} />
      </div>

      <div className="dash-grid">
        <div className="card">
          <h3>{t('dash.last7')}</h3>
          <div className="vbars">
            {d.last7.map((x) => (
              <div key={x.day} className="vbar" title={`${x.day}: ${m(x.total)}`}>
                <span style={{ height: `${Math.max(3, (x.total / max7) * 100)}%` }} />
                <small>{x.day.slice(5)}</small>
              </div>
            ))}
            {!d.last7.length && <Empty>{t('common.none')}</Empty>}
          </div>
        </div>
        <div className="card">
          <h3>{t('dash.todayByHour')}</h3>
          <div className="vbars">
            {d.byHour.map((x) => (
              <div key={x.hour} className="vbar" title={`${x.hour}:00 — ${m(x.total)}`}>
                <span style={{ height: `${Math.max(3, (x.total / maxHour) * 100)}%` }} />
                <small>{x.hour}</small>
              </div>
            ))}
            {!d.byHour.length && <Empty>{t('dash.noSalesYet')}</Empty>}
          </div>
        </div>
        <div className="card">
          <h3>🏆 {t('dash.topToday')}</h3>
          {d.topProducts.map((p, i) => <div key={p.name} className="dash-row"><span>{i + 1}. {p.name} <small className="muted">× {formatQty(p.qty)}</small></span><b>{m(p.total)}</b></div>)}
          {!d.topProducts.length && <Empty>{t('dash.noSalesYet')}</Empty>}
        </div>
        <div className="card">
          <h3>⚠ {t('dash.attention')}</h3>
          {d.lowStockCount > 0 && <button className="dash-alert" onClick={() => setPage('purchases')}>📦 {t('dash.lowStock', { n: d.lowStockCount })}</button>}
          {d.expiring > 0 && <button className="dash-alert" onClick={() => setPage('products')}>⏳ {t('dash.expiring', { n: d.expiring })}</button>}
          {d.overdueCount > 0 && <button className="dash-alert" onClick={() => setPage('customers')}>👥 {t('dash.overdue', { n: d.overdueCount, v: m(d.overdueAmount) })}</button>}
          {d.chequesDue.length > 0 && <button className="dash-alert" onClick={() => setPage('customers')}>🧾 {t('dash.cheques', { n: d.chequesDue.length, v: m(d.chequesDue.reduce((s, c) => s + c.amount, 0)) })}</button>}
          {d.openOrders > 0 && <button className="dash-alert" onClick={() => setPage('orders')}>🍽 {t('dash.openOrders', { n: d.openOrders })}</button>}
          {!d.lowStockCount && !d.expiring && !d.overdueCount && !d.chequesDue.length && !d.openOrders && <p className="good">✓ {t('dash.allGood')}</p>}
          {!!d.lowStock.length && (
            <table className="grid compact top-gap"><tbody>{d.lowStock.map((p) => <tr key={p.id}><td>{p.name}</td><td className="num warn">{formatQty(p.stock)}</td><td className="num muted">/ {formatQty(p.min_stock)}</td></tr>)}</tbody></table>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, note, tone = '', strong, onClick }) {
  return (
    <div className={`dash-tile ${strong ? 'strong' : ''} ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <small>{label}</small>
      <b>{value}</b>
      {note && <span className={`note ${tone}`}>{note}</span>}
    </div>
  );
}
