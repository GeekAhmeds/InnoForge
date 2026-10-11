import React, { useEffect, useState } from 'react';
import { activate, api, backup, copyText, dataPath, printers as listPrinters, restore } from '../lib/api.js';
import { receiptHtml } from '../lib/receipt.js';
import { Field, Modal, Toggle, useApp, useLoad } from '../components/ui.jsx';
import { formatMoney } from '../lib/money.js';
import Support from '../components/Support.jsx';
import { UpdatePanel } from '../components/Updates.jsx';

const TABS = ['general', 'taxes', 'receipt', 'users', 'audit', 'tables', 'data', 'support'];
// Which permission opens each tab.
const TAB_PERM = { general: 'settings', taxes: 'settings', receipt: 'settings', users: 'users', audit: 'audit', tables: 'settings', data: 'backup', support: null };

export default function Settings() {
  const { t, settings, can } = useApp();
  const tabs = TABS.filter((x) => (x !== 'tables' || settings.business_type === 'restaurant') && (!TAB_PERM[x] || can(TAB_PERM[x])));
  const [tab, setTab] = useState(tabs[0]);
  const label = { general: 'settings.business', taxes: 'settings.taxes', receipt: 'settings.receipt', users: 'settings.users', audit: 'audit.title', tables: 'settings.tables', data: 'settings.data', support: 'support.title' };
  return (
    <div className="page">
      <div className="page-head">
        <h2>⚙ {t('settings.title')}</h2>
        <div className="seg">{tabs.map((x) => <button key={x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(label[x])}</button>)}</div>
      </div>
      {['general', 'taxes', 'receipt'].includes(tab) && <SettingsForm tab={tab} key={tab} />}
      {tab === 'users' && <Users />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'tables' && <Tables />}
      {tab === 'data' && <Data />}
      {tab === 'support' && (
        <>
          <div className="card narrow"><Support t={t} /></div>
          <div className="card narrow"><UpdatePanel t={t} /></div>
        </>
      )}
    </div>
  );
}

function SettingsForm({ tab }) {
  const { t, tErr, notify, settings, reloadSettings, printDoc, lang } = useApp();
  const [f, setF] = useState(settings);
  const [printers, setPrinters] = useState([]);
  useEffect(() => { if (tab === 'receipt') listPrinters().then(setPrinters).catch(() => {}); }, [tab]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  async function save(e) {
    e?.preventDefault();
    try { await api.settings.save(f); await reloadSettings(); notify(t('common.saved')); } catch (err) { notify(tErr(err), 'error'); }
  }

  function testPrint() {
    const sample = {
      invoice_no: 0, completed_at: new Date().toLocaleString('en-GB'), user_name: 'Test', order_type: 'sale',
      items: [{ name: 'Test item', qty: 2, unit_price: 1000, discount: 0, line_total: 2000, note: '' }],
      payments: [{ method: 'cash', amount: 2000 }], subtotal: 2000, discount: 0, service: 0, tax: 0, total: 2000, change_due: 0, refunded: 0,
    };
    printDoc(receiptHtml(sample, f, t, lang), f.printer_name);
  }

  const printerSelect = (key) => (
    <select value={f[key]} onChange={set(key)}>
      <option value="">{t('settings.defaultPrinter')}</option>
      {printers.map((p) => <option key={p.name} value={p.name}>{p.displayName}{p.isDefault ? ' ★' : ''}</option>)}
    </select>
  );

  return (
    <form className="card settings-form" onSubmit={save}>
      {tab === 'general' && (
        <div className="grid2">
          <Field label={t('setup.businessName')}><input value={f.business_name} onChange={set('business_name')} /></Field>
          <Field label={t('setup.businessType')}>
            <select value={f.business_type} onChange={set('business_type')}>
              {['retail', 'bookstore', 'restaurant'].map((x) => <option key={x} value={x}>{t(`type.${x}`)}</option>)}
            </select>
          </Field>
          <Field label={t('settings.address')}><input value={f.address} onChange={set('address')} /></Field>
          <Field label={t('settings.phone')}><input value={f.phone} onChange={set('phone')} /></Field>
          <Field label={t('settings.language')}>
            <select value={f.language} onChange={set('language')}><option value="ar">العربية</option><option value="en">English</option></select>
          </Field>
          <Field label={t('setup.currency')}><input value={f.currency_symbol} onChange={set('currency_symbol')} /></Field>
          <Field label={t('settings.currencyCode')}><input value={f.currency} onChange={set('currency')} /></Field>
          <Field label={t('settings.decimals')}>
            <select value={f.decimals} onChange={set('decimals')}>{[0, 2, 3].map((x) => <option key={x} value={x}>{x}</option>)}</select>
          </Field>
          <div className="span2"><Toggle checked={f.allow_negative_stock} onChange={set('allow_negative_stock')} label={t('settings.negativeStock')} /></div>
        </div>
      )}
      {tab === 'taxes' && (
        <div className="grid2">
          <Field label={t('settings.taxRate')}><input inputMode="decimal" value={f.tax_rate} onChange={set('tax_rate')} /></Field>
          <Field label={t('settings.taxNumber')}><input value={f.tax_number} onChange={set('tax_number')} /></Field>
          <div className="span2"><Toggle checked={f.prices_include_tax} onChange={set('prices_include_tax')} label={t('settings.pricesIncludeTax')} /></div>
          {f.business_type === 'restaurant' && <Field label={t('settings.serviceRate')}><input inputMode="decimal" value={f.service_rate} onChange={set('service_rate')} /></Field>}
        </div>
      )}
      {tab === 'receipt' && (
        <div className="grid2">
          <Field label={t('settings.printer')}>{printerSelect('printer_name')}</Field>
          {f.business_type === 'restaurant' ? <Field label={t('settings.kitchenPrinter')}>{printerSelect('kitchen_printer_name')}</Field> : <span />}
          <Field label={t('settings.paperWidth')}>
            <select value={f.paper_width} onChange={set('paper_width')}>{[58, 80].map((x) => <option key={x} value={x}>{x}</option>)}</select>
          </Field>
          <div className="row"><Toggle checked={f.silent_print} onChange={set('silent_print')} label={t('settings.silentPrint')} /></div>
          <div className="span2"><Field label={t('settings.receiptHeader')}><input value={f.receipt_header} onChange={set('receipt_header')} /></Field></div>
          <div className="span2"><Field label={t('settings.receiptFooter')}><input value={f.receipt_footer} onChange={set('receipt_footer')} /></Field></div>
          <div><button type="button" onClick={testPrint}>🖨 {t('settings.testPrint')}</button></div>
        </div>
      )}
      <div className="form-foot"><button className="primary">{t('common.save')}</button></div>
    </form>
  );
}

function Users() {
  const { t, tErr, notify, user: me } = useApp();
  const [list, reload] = useLoad(() => api.users.list(), []);
  const [catalog] = useLoad(() => api.auth.permissionCatalog(), []);
  const [editing, setEditing] = useState(null);
  async function save(e) {
    e?.preventDefault();
    try { await api.users.save(editing); setEditing(null); reload(); notify(t('common.saved')); } catch (err) { notify(tErr(err), 'error'); }
  }
  const set = (k) => (e) => setEditing((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const defaults = catalog && editing ? catalog.roles[editing.role] || {} : {};
  const effective = (p) => (editing?.overrides?.[p] ?? defaults[p]);
  // Toggling back to the role default removes the override instead of pinning it.
  const togglePerm = (p, value) => setEditing((x) => {
    const overrides = { ...(x.overrides || {}) };
    if (value === defaults[p]) delete overrides[p]; else overrides[p] = value;
    return { ...x, overrides };
  });
  const roles = me?.role === 'admin' ? ['cashier', 'supervisor', 'admin'] : ['cashier', 'supervisor'];
  return (
    <div className="card flush">
      <div className="row between pad"><h3>{t('settings.users')}</h3><button className="primary" onClick={() => setEditing({ name: '', username: '', pin: '', role: 'cashier', active: true, overrides: {}, commission_rate: 0 })}>+ {t('settings.newUser')}</button></div>
      <table className="grid">
        <thead><tr><th>{t('common.name')}</th><th>{t('setup.username')}</th><th>{t('settings.role')}</th><th className="num">{t('users.maxDiscount')}</th><th className="num">{t('users.commission')}</th><th>{t('common.active')}</th></tr></thead>
        <tbody>
          {(list || []).map((u) => (
            <tr key={u.id} className={`clickable ${u.active ? '' : 'dim'}`} onClick={() => setEditing({ ...u, pin: '' })}>
              <td>{u.name}{Object.keys(u.overrides || {}).length > 0 && <small className="badge">{t('users.custom')}</small>}</td>
              <td className="mono">{u.username}</td><td>{t(`settings.${u.role}`)}</td>
              <td className="num">{u.perms.max_discount}%</td><td className="num">{u.commission_rate ? `${u.commission_rate}%` : ''}</td>
              <td>{u.active ? '✓' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && catalog && (
        <Modal title={editing.id ? editing.name : t('settings.newUser')} onClose={() => setEditing(null)} width={760}
          footer={<><span className="spacer" /><button onClick={() => setEditing(null)}>{t('common.cancel')}</button><button className="primary" onClick={save}>{t('common.save')}</button></>}>
          <form className="grid3" onSubmit={save}>
            <Field label={t('common.name')}><input autoFocus value={editing.name} onChange={set('name')} /></Field>
            <Field label={t('setup.username')}><input value={editing.username} onChange={set('username')} /></Field>
            <Field label={editing.id ? t('settings.newPin') : t('setup.pin')}><input type="password" inputMode="numeric" value={editing.pin} onChange={set('pin')} /></Field>
            <Field label={t('settings.role')} hint={t(`users.roleHint.${editing.role}`)}>
              <select value={editing.role} onChange={(e) => setEditing((x) => ({ ...x, role: e.target.value, overrides: {} }))}>
                {roles.map((r) => <option key={r} value={r}>{t(`settings.${r}`)}</option>)}
              </select>
            </Field>
            <Field label={`${t('users.maxDiscount')} %`}>
              <input type="number" min="0" max="100" disabled={editing.role === 'admin'} value={editing.overrides?.max_discount ?? defaults.max_discount ?? 0}
                onChange={(e) => setEditing((x) => ({ ...x, overrides: { ...(x.overrides || {}), max_discount: Number(e.target.value) } }))} />
            </Field>
            <Field label={`${t('users.commission')} %`} hint={t('users.commissionHint')}>
              <input type="number" min="0" max="100" step="0.1" value={editing.commission_rate || ''} onChange={set('commission_rate')} placeholder="0" />
            </Field>
            <div className="span3">
              <h4>{t('users.permissions')}</h4>
              {editing.role === 'admin' ? <p className="muted">{t('users.adminAll')}</p> : (
                <div className="perm-grid">
                  {catalog.permissions.map((p) => (
                    <label key={p} className={`perm ${editing.overrides?.[p] !== undefined ? 'custom' : ''}`}>
                      <input type="checkbox" checked={!!effective(p)} onChange={(e) => togglePerm(p, e.target.checked)} />
                      <span>{t(`perm.${p}`)}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="muted small">{t('users.permHint')}</p>
            </div>
            <Toggle checked={editing.active} onChange={set('active')} label={t('common.active')} />
            <button hidden />
          </form>
        </Modal>
      )}
    </div>
  );
}

// Detail fields holding money (stored in minor units) and how to label every field.
const AUDIT_MONEY = new Set(['amount', 'price', 'cost', 'opening_cash', 'expected', 'counted', 'difference', 'total', 'paid', 'cash', 'from', 'to']);

function AuditLog() {
  const { t, settings } = useApp();
  const money = (v) => (typeof v === 'number' ? formatMoney(v, settings) : v);
  const today = new Date().toLocaleDateString('en-CA');
  const [range, setRange] = useState({ from: today, to: today });
  const [action, setAction] = useState('');
  const [list] = useLoad(() => api.auditLog.list({ ...range, action }), [range.from, range.to, action]);
  const [actions] = useLoad(() => api.auditLog.actions(), []);
  const fmt = (d) => {
    if (!d) return '';
    try {
      const o = JSON.parse(d);
      const val = (k, v) => {
        if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x ? Object.entries(x).map(([kk, vv]) => `${t(`auditKey.${kk}`)} ${AUDIT_MONEY.has(kk) ? money(vv) : vv}`).join(' ') : AUDIT_MONEY.has(k) ? money(x) : x)).join(' ← ');
        if (v && typeof v === 'object') return JSON.stringify(v);
        if (typeof v === 'boolean') return v ? '✓' : '✗';
        return AUDIT_MONEY.has(k) ? money(v) : k === 'pct' ? `${v}%` : v;
      };
      return Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${t(`auditKey.${k}`)}: ${val(k, v)}`).join(' · ');
    } catch {
      return d;
    }
  };
  return (
    <div className="card flush">
      <div className="filters pad toolbar">
        <h3 className="spacer">{t('audit.title')}</h3>
        <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">{t('common.all')}</option>
          {(actions || []).map((a) => <option key={a} value={a}>{t(`audit.${a}`)}</option>)}
        </select>
      </div>
      <table className="grid">
        <thead><tr><th>{t('orders.date')}</th><th>{t('shift.by')}</th><th>{t('audit.action')}</th><th>{t('audit.details')}</th><th>{t('audit.approvedBy')}</th></tr></thead>
        <tbody>
          {(list || []).map((a) => (
            <tr key={a.id} className={/failed|delete|void|refund|price/.test(a.action) ? 'audit-hot' : ''}>
              <td className="nowrap">{a.created_at}</td>
              <td>{a.user_name || '—'}</td>
              <td><b>{t(`audit.${a.action}`)}</b>{a.entity_id ? <small className="muted"> #{a.entity_id}</small> : null}</td>
              <td className="small audit-details">{fmt(a.details)}</td>
              <td>{a.approver_name || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tables() {
  const { t, tErr, notify } = useApp();
  const [list, reload] = useLoad(() => api.tables.list(), []);
  const [editing, setEditing] = useState(null);
  async function save(e) {
    e?.preventDefault();
    try { await api.tables.save(editing); setEditing(null); reload(); } catch (err) { notify(tErr(err), 'error'); }
  }
  async function remove(id) {
    if (!window.confirm(t('common.areYouSure'))) return;
    try { await api.tables.remove(id); setEditing(null); reload(); } catch (err) { notify(tErr(err), 'error'); }
  }
  const set = (k) => (e) => setEditing((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className="card">
      <div className="row between"><h3>{t('settings.tables')}</h3><button className="primary" onClick={() => setEditing({ name: String((list?.length || 0) + 1), area: '', seats: 4 })}>+ {t('settings.newTable')}</button></div>
      <div className="table-grid">
        {(list || []).map((x) => (
          <button key={x.id} className={`table-tile ${x.order_id ? 'busy' : ''}`} onClick={() => setEditing(x)}>
            <b>{x.name}</b><small>{x.area} · {x.seats}</small>
          </button>
        ))}
      </div>
      {editing && (
        <Modal title={editing.id ? `${t('pos.table')} ${editing.name}` : t('settings.newTable')} onClose={() => setEditing(null)} width={460}
          footer={<>{editing.id && <button className="danger-ghost" onClick={() => remove(editing.id)}>{t('common.delete')}</button>}<span className="spacer" /><button className="primary" onClick={save}>{t('common.save')}</button></>}>
          <form className="grid3" onSubmit={save}>
            <Field label={t('common.name')}><input autoFocus value={editing.name} onChange={set('name')} /></Field>
            <Field label={t('settings.area')}><input value={editing.area} onChange={set('area')} /></Field>
            <Field label={t('settings.seats')}><input type="number" min="1" value={editing.seats} onChange={set('seats')} /></Field>
            <button hidden />
          </form>
        </Modal>
      )}
    </div>
  );
}

function Data() {
  const { t, tErr, notify, license, setLicense } = useApp();
  const [renewing, setRenewing] = useState(false);
  const [newKey, setNewKey] = useState('');
  async function renew() {
    try {
      setLicense(await activate(newKey));
      setRenewing(false);
      setNewKey('');
      notify(t('license.updated'));
    } catch (err) {
      notify(tErr(err), 'error');
    }
  }
  const [path, setPath] = useState('');
  useEffect(() => { dataPath().then(setPath).catch(() => {}); }, []);
  return (
    <div className="card narrow">
      <h3>{t('license.info')}</h3>
      {license?.required ? (
        <dl className="kv">
          <dt>{t('license.customer')}</dt><dd>{license.customer || '—'}</dd>
          <dt>{t('license.machineId')}</dt><dd className="mono" dir="ltr">{license.machine}</dd>
          <dt>{t('license.expires')}</dt><dd>{license.expires ? new Date(license.expires).toLocaleDateString('en-GB') : t('license.lifetime')}</dd>
        </dl>
      ) : <p className="muted">{t('license.devMode')}</p>}
      {license?.required && (
        <div className="row bottom-gap">
          <button onClick={() => copyText(license.machine).then(() => notify(t('license.copied')))}>{t('license.copy')} {t('license.machineId')}</button>
          <button className="primary" onClick={() => setRenewing(true)}>🔑 {t('license.update')}</button>
        </div>
      )}
      {renewing && (
        <Modal title={t('license.update')} onClose={() => setRenewing(false)}
          footer={<><span className="spacer" /><button onClick={() => setRenewing(false)}>{t('common.cancel')}</button><button className="primary" disabled={!newKey.trim()} onClick={renew}>{t('license.activate')}</button></>}>
          <p className="muted">{t('license.updateHint')}</p>
          <textarea dir="ltr" className="mono" rows={5} autoFocus value={newKey} onChange={(e) => setNewKey(e.target.value)} />
        </Modal>
      )}
      <h3>{t('settings.data')}</h3>
      <Field label={t('settings.dataPath')}><input readOnly className="mono" value={path} /></Field>
      <div className="row">
        <button className="primary" onClick={async () => {
          try { const p = await backup(); if (p) notify(t('settings.backupDone', { path: p })); } catch (err) { notify(tErr(err), 'error'); }
        }}>💾 {t('settings.backup')}</button>
        <button className="danger-ghost" onClick={async () => {
          if (!window.confirm(t('settings.restoreWarn'))) return;
          try { await restore(); } catch (err) { notify(tErr(err), 'error'); }
        }}>↺ {t('settings.restore')}</button>
      </div>
    </div>
  );
}
