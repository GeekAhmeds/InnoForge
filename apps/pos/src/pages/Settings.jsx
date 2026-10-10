import React, { useEffect, useState } from 'react';
import { api, backup, dataPath, printers as listPrinters, restore } from '../lib/api.js';
import { receiptHtml } from '../lib/receipt.js';
import { Field, Modal, Toggle, useApp, useLoad } from '../components/ui.jsx';

const TABS = ['general', 'taxes', 'receipt', 'users', 'tables', 'data'];

export default function Settings() {
  const { t, settings } = useApp();
  const [tab, setTab] = useState('general');
  const tabs = TABS.filter((x) => x !== 'tables' || settings.business_type === 'restaurant');
  const label = { general: 'settings.business', taxes: 'settings.taxes', receipt: 'settings.receipt', users: 'settings.users', tables: 'settings.tables', data: 'settings.data' };
  return (
    <div className="page">
      <div className="page-head">
        <h2>⚙ {t('settings.title')}</h2>
        <div className="seg">{tabs.map((x) => <button key={x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(label[x])}</button>)}</div>
      </div>
      {['general', 'taxes', 'receipt'].includes(tab) && <SettingsForm tab={tab} key={tab} />}
      {tab === 'users' && <Users />}
      {tab === 'tables' && <Tables />}
      {tab === 'data' && <Data />}
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
  const { t, tErr, notify } = useApp();
  const [list, reload] = useLoad(() => api.users.list(), []);
  const [editing, setEditing] = useState(null);
  async function save(e) {
    e?.preventDefault();
    try { await api.users.save(editing); setEditing(null); reload(); notify(t('common.saved')); } catch (err) { notify(tErr(err), 'error'); }
  }
  const set = (k) => (e) => setEditing((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  return (
    <div className="card flush">
      <div className="row between pad"><h3>{t('settings.users')}</h3><button className="primary" onClick={() => setEditing({ name: '', username: '', pin: '', role: 'cashier', active: true })}>+ {t('settings.newUser')}</button></div>
      <table className="grid">
        <thead><tr><th>{t('common.name')}</th><th>{t('setup.username')}</th><th>{t('settings.role')}</th><th>{t('common.active')}</th></tr></thead>
        <tbody>
          {(list || []).map((u) => (
            <tr key={u.id} className={`clickable ${u.active ? '' : 'dim'}`} onClick={() => setEditing({ ...u, pin: '' })}>
              <td>{u.name}</td><td className="mono">{u.username}</td><td>{t(`settings.${u.role}`)}</td><td>{u.active ? '✓' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <Modal title={editing.id ? editing.name : t('settings.newUser')} onClose={() => setEditing(null)}
          footer={<><span className="spacer" /><button onClick={() => setEditing(null)}>{t('common.cancel')}</button><button className="primary" onClick={save}>{t('common.save')}</button></>}>
          <form className="grid2" onSubmit={save}>
            <Field label={t('common.name')}><input autoFocus value={editing.name} onChange={set('name')} /></Field>
            <Field label={t('setup.username')}><input value={editing.username} onChange={set('username')} /></Field>
            <Field label={editing.id ? t('settings.newPin') : t('setup.pin')}><input type="password" inputMode="numeric" value={editing.pin} onChange={set('pin')} /></Field>
            <Field label={t('settings.role')}>
              <select value={editing.role} onChange={set('role')}><option value="cashier">{t('settings.cashier')}</option><option value="admin">{t('settings.admin')}</option></select>
            </Field>
            <Toggle checked={editing.active} onChange={set('active')} label={t('common.active')} />
            <button hidden />
          </form>
        </Modal>
      )}
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
  const { t, tErr, notify, license } = useApp();
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
