import React, { useEffect, useState } from 'react';
import { SCREENS, sellScreens } from '../lib/screens.js';
import { api, backup, dataPath, printers as listPrinters, restore } from '../lib/api.js';
import { receiptHtml } from '../lib/receipt.js';
import ReceiptDesigner, { sampleOrder } from '../components/ReceiptDesigner.jsx';
import { LABEL_SIZES, sizeName } from '../lib/labels.js';
import { Field, Modal, Toggle, useApp, useLoad } from '../components/ui.jsx';
import { formatMoney } from '../lib/money.js';
import Support from '../components/Support.jsx';
import { UpdatePanel } from '../components/Updates.jsx';
import KitchenSettings from '../components/Kitchen.jsx';
import Devices from '../components/Devices.jsx';
import { Coupons } from '../components/Coupons.jsx';
import LicenseTab from '../components/License.jsx';
import Network from '../components/Network.jsx';
import EtaSettings from '../components/Eta.jsx';
import ZatcaSettings from '../components/Zatca.jsx';
import UaeSettings from '../components/Uae.jsx';
import { has } from '../lib/features.js';
import { COUNTRIES, COUNTRY_FLAGS, countryName, countryPreset, einvoiceOf } from '../lib/countries.js';

const TABS = ['general', 'taxes', 'receipt', 'priceLists', 'promos', 'users', 'audit', 'tables', 'kitchen', 'devices', 'network', 'eta', 'zatca', 'uae', 'data', 'license', 'support'];
// Which permission opens each tab.
// Which licensed feature a tab needs.
const EINVOICE_TABS = { eta: 'eta', zatca: 'zatca', uae: 'uae_einvoice' };
const TAB_FEATURE = { eta: 'eta', zatca: 'zatca', uae: 'uae_einvoice', priceLists: 'trading', tables: 'restaurant', kitchen: 'restaurant' };
const TAB_PERM = { promos: 'settings', priceLists: 'settings', general: 'settings', taxes: 'settings', receipt: 'settings', users: 'users', audit: 'audit', tables: 'settings', kitchen: 'settings', devices: 'settings', network: 'settings', eta: 'settings', zatca: 'settings', uae: 'settings', data: 'backup', license: null, support: null };

export default function Settings() {
  const { t, settings, can } = useApp();
  // Only this country's e-invoice system has a tab.
  const einvoice = einvoiceOf(settings);
  const tabs = TABS.filter((x) => (!EINVOICE_TABS[x] || EINVOICE_TABS[x] === einvoice) && (!['tables', 'kitchen'].includes(x) || sellScreens(settings).includes('restaurant')) && has(TAB_FEATURE[x]) && (x !== 'promos' || has('promotions') || has('coupons')) && (!TAB_PERM[x] || can(TAB_PERM[x])));
  const [tab, setTab] = useState(tabs[0]);
  const label = { general: 'settings.business', taxes: 'settings.taxes', receipt: 'settings.receipt', priceLists: 'priceLists.title', promos: 'promos.tab', users: 'settings.users', audit: 'audit.title', tables: 'settings.tables', kitchen: 'kitchen.tab', devices: 'devices.tab', network: 'net.tab', eta: 'eta.tab', zatca: 'zatca.tab', uae: 'uae.tab', data: 'settings.data', license: 'license.tab', support: 'support.title' };
  return (
    <div className="page">
      <div className="page-head">
        <h2>⚙ {t('settings.title')}</h2>
        <div className="seg">{tabs.map((x) => <button key={x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(label[x])}</button>)}</div>
      </div>
      {['general', 'taxes', 'receipt'].includes(tab) && <SettingsForm tab={tab} key={tab} />}
      {tab === 'users' && <Users />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'priceLists' && <PriceLists />}
      {tab === 'promos' && <>{has('promotions') && <Promotions />}{has('coupons') && <Coupons />}{has('promotions') && <Loyalty />}</>}
      {tab === 'tables' && <Tables />}
      {tab === 'kitchen' && <KitchenSettings />}
      {tab === 'devices' && <Devices />}
      {tab === 'network' && <Network />}
      {tab === 'eta' && <EtaSettings />}
      {tab === 'zatca' && <ZatcaSettings />}
      {tab === 'uae' && <UaeSettings />}
      {tab === 'data' && <Data />}
      {tab === 'license' && <LicenseTab />}
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
  const { t, tErr, notify, settings, reloadSettings, printDoc, lang, license } = useApp();
  const [f, setF] = useState(settings);
  const [printers, setPrinters] = useState([]);
  useEffect(() => { if (tab === 'receipt') listPrinters().then(setPrinters).catch(() => {}); }, [tab]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  async function save(e) {
    e?.preventDefault();
    try { await api.settings.save(f); await reloadSettings(); notify(t('common.saved')); } catch (err) { notify(tErr(err), 'error'); }
  }

  // Prints the designer's sample sale with the settings as they are on screen (saved or not).
  const testPrint = () => printDoc(receiptHtml(sampleOrder(f, t), f, t, lang), f.printer_name);

  const printerSelect = (key) => (
    <select value={f[key]} onChange={set(key)}>
      <option value="">{t('settings.defaultPrinter')}</option>
      {printers.map((p) => <option key={p.name} value={p.name}>{p.displayName}{p.isDefault ? ' ★' : ''}</option>)}
    </select>
  );

  return (
    <form className={`card settings-form ${tab === 'receipt' ? 'wide' : ''}`} onSubmit={save}>
      {tab === 'general' && (
        <div className="grid2">
          <Field label={t('setup.businessName')}><input value={f.business_name} onChange={set('business_name')} /></Field>
          <Field label={t('setup.businessType')}>
            <select value={f.business_type} onChange={set('business_type')}>
              {['retail', 'bookstore', 'restaurant', 'trading'].map((x) => <option key={x} value={x}>{t(`type.${x}`)}</option>)}
            </select>
          </Field>
          <Field label={t('settings.address')}><input value={f.address} onChange={set('address')} /></Field>
          <Field label={t('settings.phone')}><input value={f.phone} onChange={set('phone')} /></Field>
          <Field label={t('settings.language')}>
            <select value={f.language} onChange={set('language')}><option value="ar">العربية</option><option value="en">English</option></select>
          </Field>
          <Field label={t('country.title')} hint={license?.country ? t('country.locked') : t('country.changeHint')}>
            <select value={f.country} disabled={!!license?.country} onChange={(e) => setF((x) => ({ ...x, ...countryPreset(e.target.value) }))}>
              {Object.keys(COUNTRIES).map((c) => <option key={c} value={c}>{COUNTRY_FLAGS[c]} {countryName(c, lang)}</option>)}
            </select>
          </Field>
          <Field label={t('setup.currency')}><input value={f.currency_symbol} onChange={set('currency_symbol')} /></Field>
          <Field label={t('settings.currencyCode')}><input value={f.currency} onChange={set('currency')} /></Field>
          <Field label={t('settings.decimals')}>
            <select value={f.decimals} onChange={set('decimals')}>{[0, 2, 3].map((x) => <option key={x} value={x}>{x}</option>)}</select>
          </Field>
          <div className="span2"><Toggle checked={f.allow_negative_stock} onChange={set('allow_negative_stock')} label={t('settings.negativeStock')} /></div>
          <div className="span2">
            <Field label={t('screens.title')} hint={t('screens.hint')}>
              <div className="screen-picks">
                {SCREENS.filter((sc) => has(sc.feature)).map((sc) => {
                  const on = sellScreens(f);
                  const checked = on.includes(sc.id);
                  return (
                    <label key={sc.id} className={`screen-pick ${checked ? 'on' : ''}`}>
                      <input type="checkbox" checked={checked} onChange={(e) => {
                        const next = e.target.checked ? [...on, sc.id] : on.filter((x) => x !== sc.id);
                        if (next.length) setF((x) => ({ ...x, sell_screens: next.join(',') }));
                      }} />
                      <span className="ico">{sc.icon}</span>
                      <b>{t(`nav.${sc.page === 'pos' ? 'cashier' : sc.page}`)}</b>
                      <small className="muted">{t(`screens.${sc.id}`)}</small>
                    </label>
                  );
                })}
              </div>
            </Field>
          </div>
        </div>
      )}
      {tab === 'taxes' && (
        <div className="grid2">
          <Field label={t('settings.taxRate')}><input inputMode="decimal" value={f.tax_rate} onChange={set('tax_rate')} /></Field>
          <Field label={t('settings.taxNumber')} hint={f.country === 'SA' ? t('country.vatHintSA') : f.country === 'AE' ? t('country.vatHintAE') : ''}>
            <input value={f.tax_number} onChange={set('tax_number')} dir="ltr" /></Field>
          <div className="span2"><Toggle checked={f.prices_include_tax} onChange={set('prices_include_tax')} label={t('settings.pricesIncludeTax')} /></div>
          {sellScreens(f).includes('restaurant') && <Field label={t('settings.serviceRate')}><input inputMode="decimal" value={f.service_rate} onChange={set('service_rate')} /></Field>}
        </div>
      )}
      {tab === 'receipt' && (
        <div className="grid2">
          <Field label={t('settings.printer')}>{printerSelect('printer_name')}</Field>
          {sellScreens(f).includes('restaurant') ? <Field label={t('settings.kitchenPrinter')}>{printerSelect('kitchen_printer_name')}</Field> : <span />}
          <Field label={t('settings.paperWidth')}>
            <select value={f.paper_width} onChange={set('paper_width')}>{[58, 80].map((x) => <option key={x} value={x}>{x}</option>)}</select>
          </Field>
          <div className="row"><Toggle checked={f.silent_print} onChange={set('silent_print')} label={t('settings.silentPrint')} /></div>
          <ReceiptDesigner f={f} setF={setF} onTestPrint={testPrint} />
          <h4 className="span2">{t('a4.settingsTitle')}</h4>
          <Field label={t('a4.format')}>
            <select value={f.invoice_format} onChange={set('invoice_format')}>
              <option value="thermal">{t('a4.formatThermal')}</option>
              <option value="a4">{t('a4.formatA4')}</option>
            </select>
          </Field>
          <Field label={t('a4.printer')}>{printerSelect('a4_printer_name')}</Field>
          <Field label={t('labels.printer')}>{printerSelect('label_printer_name')}</Field>
          <Field label={t('labels.size')}>
            <select value={f.label_size} onChange={set('label_size')}>{Object.keys(LABEL_SIZES).map((k) => <option key={k} value={k}>{sizeName(k, t)}</option>)}</select>
          </Field>
          <Field label={t('a4.logo')} hint={t('a4.logoHint')}>
            <div className="row">
              {f.business_logo && <img src={f.business_logo} alt="" className="logo-preview" />}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 400 * 1024) { notify(t('a4.logoTooBig'), 'error'); return; }
                const r = new FileReader();
                r.onload = () => setF((x) => ({ ...x, business_logo: r.result }));
                r.readAsDataURL(file);
              }} />
              {f.business_logo && <button type="button" className="danger-ghost sm" onClick={() => setF((x) => ({ ...x, business_logo: '' }))}>{t('common.delete')}</button>}
            </div>
          </Field>
          <Field label={t('a4.overdueDays')}><input type="number" min="1" value={f.overdue_days} onChange={set('overdue_days')} /></Field>
          <div className="span2"><Field label={t('a4.terms')}><textarea rows={3} value={f.a4_terms} onChange={set('a4_terms')} /></Field></div>
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
const AUDIT_MONEY = new Set(['amount', 'discount', 'price', 'cost', 'opening_cash', 'expected', 'counted', 'difference', 'total', 'paid', 'cash', 'from', 'to', 'financed', 'net']);

const DAYS = [0, 1, 2, 3, 4, 5, 6];

function Promotions() {
  const { t, tErr, notify, settings } = useApp();
  const [list, reload] = useLoad(() => api.promotions.list(), []);
  const [cats] = useLoad(() => api.categories.list(), []);
  const [prods] = useLoad(() => api.products.list({}), []);
  const [editing, setEditing] = useState(null);
  const d = settings.decimals;
  const run = async (fn) => { try { await fn(); } catch (err) { notify(tErr(err), 'error'); } };
  const today = new Date().toLocaleDateString('en-CA');
  const live = (p) => p.active && (!p.start_date || p.start_date <= today) && (!p.end_date || p.end_date >= today);
  const describe = (p) => {
    const target = p.scope === 'all' ? t('promos.scope.all') : p.scope === 'category' ? cats?.find((c) => c.id === p.target_id)?.name : prods?.find((x) => x.id === p.target_id)?.name;
    const what = p.kind === 'percent' ? `${p.value}%` : p.kind === 'amount' ? formatMoney(p.value, settings) : t('promos.buyGet', { b: p.buy_qty, g: p.get_qty });
    return `${what} — ${target || '?'}`;
  };
  const save = () => run(async () => {
    await api.promotions.save({ ...editing, value: editing.kind === 'amount' ? toMinorLocal(editing.value, d) : Number(editing.value) });
    setEditing(null);
    reload();
  });
  const blank = { name: '', kind: 'percent', scope: 'all', target_id: '', value: 10, buy_qty: 2, get_qty: 1, min_qty: '', start_date: '', end_date: '', days: [], time_from: '', time_to: '', active: true };
  return (
    <div className="card wide-ish">
      <div className="row between"><h3>🏷 {t('promos.title')}</h3><button className="primary" onClick={() => setEditing(blank)}>+ {t('promos.new')}</button></div>
      <p className="muted small">{t('promos.hint')}</p>
      <div className="cat-list">
        {(list || []).map((p) => (
          <div key={p.id} className={`cat-row ${p.active ? '' : 'dim'}`}>
            <span className={`dot lg ${live(p) ? 'live' : ''}`} style={{ background: live(p) ? 'var(--good)' : '#cbd5e1' }} />
            <div className="spacer"><b>{p.name}</b><div className="muted small">{describe(p)}{p.end_date ? ` · ${t('common.to')} ${p.end_date}` : ''}{p.time_from ? ` · ${p.time_from}–${p.time_to}` : ''}</div></div>
            <button className="ghost sm" onClick={() => setEditing({ ...p, days: p.days ? p.days.split(',').map(Number) : [], value: p.kind === 'amount' ? (p.value / 10 ** d).toFixed(d) : p.value, target_id: p.target_id || '' })}>{t('common.edit')}</button>
            <button className="danger-ghost sm" onClick={() => run(async () => { if (window.confirm(t('common.areYouSure'))) { await api.promotions.remove(p.id); reload(); } })}>{t('common.delete')}</button>
          </div>
        ))}
        {list && !list.length && <p className="muted">{t('promos.none')}</p>}
      </div>
      {editing && (
        <Modal title={editing.id ? editing.name : t('promos.new')} onClose={() => setEditing(null)} width={640}
          footer={<><Toggle checked={editing.active} onChange={(v) => setEditing({ ...editing, active: v })} label={t('common.active')} /><span className="spacer" /><button className="primary" onClick={save}>{t('common.save')}</button></>}>
          <div className="grid2">
            <div className="span2"><Field label={t('common.name')}><input autoFocus value={editing.name} placeholder={t('promos.namePh')} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field></div>
            <Field label={t('promos.kind')}>
              <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value })}>
                {['percent', 'amount', 'buy_x_get_y'].map((k) => <option key={k} value={k}>{t(`promos.kind.${k}`)}</option>)}
              </select>
            </Field>
            {editing.kind === 'buy_x_get_y' ? (
              <div className="row">
                <Field label={t('promos.buy')}><input type="number" min="1" value={editing.buy_qty} onChange={(e) => setEditing({ ...editing, buy_qty: e.target.value })} /></Field>
                <Field label={t('promos.get')}><input type="number" min="1" value={editing.get_qty} onChange={(e) => setEditing({ ...editing, get_qty: e.target.value })} /></Field>
              </div>
            ) : (
              <Field label={editing.kind === 'percent' ? t('pos.discountPercent') : t('promos.amountPerUnit')}><input inputMode="decimal" value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} /></Field>
            )}
            <Field label={t('promos.appliesTo')}>
              <select value={editing.scope} onChange={(e) => setEditing({ ...editing, scope: e.target.value, target_id: '' })}>
                {['all', 'category', 'product'].map((k) => <option key={k} value={k}>{t(`promos.scope.${k}`)}</option>)}
              </select>
            </Field>
            {editing.scope !== 'all' ? (
              <Field label={editing.scope === 'category' ? t('products.category') : t('receipt.item')}>
                <select value={editing.target_id} onChange={(e) => setEditing({ ...editing, target_id: Number(e.target.value) || '' })}>
                  <option value="">—</option>
                  {(editing.scope === 'category' ? cats : prods || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
            ) : <span />}
            {editing.kind !== 'buy_x_get_y' && <Field label={t('promos.minQty')} hint={t('promos.minQtyHint')}><input type="number" min="0" value={editing.min_qty} onChange={(e) => setEditing({ ...editing, min_qty: e.target.value })} /></Field>}
            {editing.kind !== 'buy_x_get_y' && <span />}
            <Field label={t('common.from')}><input type="date" value={editing.start_date || ''} onChange={(e) => setEditing({ ...editing, start_date: e.target.value })} /></Field>
            <Field label={t('common.to')}><input type="date" value={editing.end_date || ''} onChange={(e) => setEditing({ ...editing, end_date: e.target.value })} /></Field>
            <Field label={t('promos.timeFrom')}><input type="time" value={editing.time_from} onChange={(e) => setEditing({ ...editing, time_from: e.target.value })} /></Field>
            <Field label={t('promos.timeTo')}><input type="time" value={editing.time_to} onChange={(e) => setEditing({ ...editing, time_to: e.target.value })} /></Field>
            <div className="span2">
              <span className="muted small">{t('promos.days')}</span>
              <div className="row wrap days-row">
                {DAYS.map((day) => (
                  <label key={day} className={`day-chip ${editing.days.includes(day) ? 'on' : ''}`}>
                    <input type="checkbox" checked={editing.days.includes(day)} onChange={(e) => setEditing({ ...editing, days: e.target.checked ? [...editing.days, day] : editing.days.filter((x) => x !== day) })} />
                    {t(`day.${day}`)}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

const toMinorLocal = (v, d) => Math.round((Number(v) || 0) * 10 ** d);

function Loyalty() {
  const { t, tErr, notify, settings, reloadSettings } = useApp();
  const [f, setF] = useState({
    loyalty_enabled: settings.loyalty_enabled, loyalty_earn_per: settings.loyalty_earn_per,
    loyalty_point_value: (settings.loyalty_point_value / 10 ** settings.decimals).toFixed(settings.decimals), loyalty_min_redeem: settings.loyalty_min_redeem,
  });
  const save = async () => {
    try {
      await api.settings.save({ ...f, loyalty_point_value: toMinorLocal(f.loyalty_point_value, settings.decimals) });
      await reloadSettings();
      notify(t('common.saved'));
    } catch (err) {
      notify(tErr(err), 'error');
    }
  };
  return (
    <div className="card wide-ish">
      <h3>⭐ {t('loyalty.title')}</h3>
      <Toggle checked={f.loyalty_enabled} onChange={(v) => setF({ ...f, loyalty_enabled: v })} label={t('loyalty.enable')} />
      <div className="grid3 top-gap">
        <Field label={t('loyalty.earnPer')}><input type="number" min="1" value={f.loyalty_earn_per} onChange={(e) => setF({ ...f, loyalty_earn_per: e.target.value })} /></Field>
        <Field label={t('loyalty.pointValue')}><input inputMode="decimal" value={f.loyalty_point_value} onChange={(e) => setF({ ...f, loyalty_point_value: e.target.value })} /></Field>
        <Field label={t('loyalty.minRedeem')}><input type="number" min="0" value={f.loyalty_min_redeem} onChange={(e) => setF({ ...f, loyalty_min_redeem: e.target.value })} /></Field>
      </div>
      <p className="muted small">{t('loyalty.example', { per: f.loyalty_earn_per, value: f.loyalty_point_value, back: ((Number(f.loyalty_point_value) / Number(f.loyalty_earn_per || 1)) * 100).toFixed(1) })}</p>
      <div className="form-foot"><button className="primary" onClick={save}>{t('common.save')}</button></div>
    </div>
  );
}

function PriceLists() {
  const { t, tErr, notify } = useApp();
  const [list, reload] = useLoad(() => api.priceLists.list(), []);
  const [editing, setEditing] = useState(null);
  const [fill, setFill] = useState(null);
  const run = async (fn) => { try { await fn(); } catch (err) { notify(tErr(err), 'error'); } };
  return (
    <div className="card narrow wide-ish">
      <div className="row between"><h3>{t('priceLists.title')}</h3><button className="primary" onClick={() => setEditing({ name: '', active: true })}>+ {t('priceLists.new')}</button></div>
      <p className="muted small">{t('priceLists.hint')}</p>
      <div className="cat-list">
        {(list || []).map((pl) => (
          <div key={pl.id} className={`cat-row ${pl.active ? '' : 'dim'}`}>
            <b>{pl.name}</b>
            <span className="spacer" />
            <button className="ghost sm" onClick={() => setFill({ id: pl.id, name: pl.name, percent: -10, overwrite: false })}>％ {t('priceLists.fill')}</button>
            <button className="ghost sm" onClick={() => setEditing(pl)}>{t('common.edit')}</button>
          </div>
        ))}
      </div>
      {editing && (
        <Modal title={editing.id ? editing.name : t('priceLists.new')} onClose={() => setEditing(null)} width={420}
          footer={<><span className="spacer" /><button className="primary" onClick={() => run(async () => { await api.priceLists.save(editing); setEditing(null); reload(); })}>{t('common.save')}</button></>}>
          <Field label={t('common.name')}><input autoFocus value={editing.name} placeholder={t('priceLists.example')} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
          {editing.id && <Toggle checked={editing.active} onChange={(v) => setEditing({ ...editing, active: v })} label={t('common.active')} />}
        </Modal>
      )}
      {fill && (
        <Modal title={`${t('priceLists.fill')} — ${fill.name}`} onClose={() => setFill(null)} width={460}
          footer={<><span className="spacer" /><button className="primary" onClick={() => run(async () => { const n = await api.priceLists.fillFromBase(fill); notify(t('priceLists.filled', { n })); setFill(null); })}>{t('common.confirm')}</button></>}>
          <Field label={t('priceLists.percent')} hint={t('priceLists.percentHint')}><input type="number" value={fill.percent} onChange={(e) => setFill({ ...fill, percent: e.target.value })} /></Field>
          <Toggle checked={fill.overwrite} onChange={(v) => setFill({ ...fill, overwrite: v })} label={t('priceLists.overwrite')} />
        </Modal>
      )}
    </div>
  );
}

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
  const { t, tErr, notify, license } = useApp();
  const [path, setPath] = useState('');
  useEffect(() => { dataPath().then(setPath).catch(() => {}); }, []);
  return (
    <div className="card narrow">
      <h3>{t('settings.data')}</h3>
      <Field label={t('settings.dataPath')}><input readOnly className="mono" value={path} /></Field>
      {license?.client && <p className="muted">{t('net.backupOnMain')}</p>}
      {!license?.client && <div className="row">
        <button className="primary" onClick={async () => {
          try { const p = await backup(); if (p) notify(t('settings.backupDone', { path: p })); } catch (err) { notify(tErr(err), 'error'); }
        }}>💾 {t('settings.backup')}</button>
        <button className="danger-ghost" onClick={async () => {
          if (!window.confirm(t('settings.restoreWarn'))) return;
          try { await restore(); } catch (err) { notify(tErr(err), 'error'); }
        }}>↺ {t('settings.restore')}</button>
      </div>}
    </div>
  );
}
