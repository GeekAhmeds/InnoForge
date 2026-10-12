import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { I18nProvider, useI18n } from './i18n/index.jsx';
import { api, licenseStatus, print } from './lib/api.js';
import { AppContext, AskModal, useToasts } from './components/ui.jsx';
import Setup from './pages/Setup.jsx';
import Login from './pages/Login.jsx';
import Pos from './pages/Pos.jsx';
import Orders from './pages/Orders.jsx';
import Products from './pages/Products.jsx';
import Reports from './pages/Reports.jsx';
import Shift from './pages/Shift.jsx';
import Settings from './pages/Settings.jsx';
import Activation from './pages/Activation.jsx';
import Offline from './pages/Offline.jsx';
import Purchases from './pages/Purchases.jsx';
import Customers from './pages/Customers.jsx';
import Floor from './pages/Floor.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Delivery from './pages/Delivery.jsx';
import Treasury from './pages/Treasury.jsx';
import Employees from './pages/Employees.jsx';
import Help from './pages/Help.jsx';
import { EtaPage } from './components/Eta.jsx';
import { ZatcaPage } from './components/Zatca.jsx';
import { UaePage } from './components/Uae.jsx';
import SalesInvoice from './pages/SalesInvoice.jsx';
import { SCREENS, homePage, sellScreens } from './lib/screens.js';
import { has, setFeatures } from './lib/features.js';
import { UpdateBanner } from './components/Updates.jsx';
import ApprovalModal from './components/Approval.jsx';
import logoMark from './assets/logo-mark.png';

export default function App() {
  const [settings, setSettings] = useState(null);
  const [license, setLicense] = useState(null);
  const reloadSettings = useCallback(async () => setSettings(await api.settings.get()), []);
  useEffect(() => {
    licenseStatus().then((l) => {
      setLicense(l);
      // A computer connected to a main computer that cannot be reached has no settings to load.
      if (!l.client || l.connected) reloadSettings();
    });
  }, [reloadSettings]);
  // Features must be known before the first render that builds the menu.
  if (license) setFeatures(license.features);

  if (license?.client && !license.connected) return <I18nProvider lang="ar"><Offline license={license} /></I18nProvider>;
  if (!settings || !license) return null;
  return (
    <I18nProvider lang={settings.language}>
      {license.required && !license.valid
        ? <Activation license={license} onActivated={setLicense} settings={settings} reloadSettings={reloadSettings} />
        : <Shell settings={settings} reloadSettings={reloadSettings} license={license} setLicense={setLicense} />}
    </I18nProvider>
  );
}

const NAV = [
  { id: 'dashboard', icon: '📈', perm: 'reports' },
  { id: 'orders', icon: '🧾' },
  { id: 'customers', icon: '👥' },
  { id: 'treasury', icon: '🏦', perm: 'treasury', feature: 'treasury' },
  { id: 'products', icon: '📦', perm: 'products' },
  { id: 'purchases', icon: '🚚', perm: 'purchases' },
  { id: 'reports', icon: '📊', perm: 'reports' },
  { id: 'employees', icon: '🧑‍💼', feature: 'employees' },
  { id: 'eta', icon: '🏛', perm: 'reports', feature: 'eta', when: (s) => s.eta_enabled && (s.country || 'EG') === 'EG' },
  { id: 'zatca', icon: '🇸🇦', perm: 'reports', feature: 'zatca', when: (s) => s.zatca_enabled && s.country === 'SA' },
  { id: 'uae', icon: '🇦🇪', perm: 'reports', feature: 'uae_einvoice', when: (s) => s.uae_enabled && s.country === 'AE' },
  { id: 'shift', icon: '⏱' },
  { id: 'settings', icon: '⚙', perm: ['settings', 'users', 'audit', 'backup'] },
  { id: 'help', icon: '❓' },
];

function Shell({ settings, reloadSettings, license, setLicense }) {
  const { t, tErr, lang } = useI18n();
  const { notify, view: toasts } = useToasts();
  const [user, setUser] = useState(null);
  const [shift, setShift] = useState(undefined);
  const [page, setPage] = useState('pos');
  const [pendingCart, setPendingCart] = useState(null);

  const reloadShift = useCallback(async () => setShift(await api.shifts.current()), []);
  const [approvalReq, setApprovalReq] = useState(null);
  const approvalResolve = useRef(null);

  // Runs fn(approval); when the main process answers APPROVAL_REQUIRED, asks a supervisor
  // for their PIN and retries with it. Cancelling rejects with code 'CANCELLED'.
  const withApproval = useCallback(async (fn) => {
    let approval = null;
    let retry = null;
    for (;;) {
      try {
        return await fn(approval);
      } catch (err) {
        const needs = err.code === 'APPROVAL_REQUIRED' || (approval && ['BAD_CREDENTIALS', 'APPROVER_NOT_ALLOWED'].includes(err.code));
        if (!needs) throw err;
        if (err.code !== 'APPROVAL_REQUIRED') retry = err.code;
        const perm = err.code === 'APPROVAL_REQUIRED' ? err.message : approvalReq?.perm || 'discount';
        approval = await new Promise((resolve) => {
          approvalResolve.current = resolve;
          setApprovalReq({ perm, retry });
        });
        setApprovalReq(null);
        if (!approval) {
          const cancelled = new Error('cancelled');
          cancelled.code = 'CANCELLED';
          throw cancelled;
        }
      }
    }
  }, [approvalReq]);
  const can = useCallback((perm) => !!user?.perms?.[perm], [user]);
  const [askReq, setAskReq] = useState(null);
  // ask(label, { type, initial, required }) → Promise<string | null>
  const ask = useCallback((label, opts = {}) => new Promise((resolve) => setAskReq({ label, ...opts, resolve })), []);
  useEffect(() => { if (user) reloadShift(); }, [user, reloadShift]);
  // F1 opens the user guide from anywhere.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'F1' && user) { e.preventDefault(); setPage('help'); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user]);

  const printDoc = useCallback(async (html, printer = settings.printer_name) => {
    try {
      await print({ html, printer, silent: settings.silent_print });
      return true;
    } catch (err) {
      notify(tErr(err), 'error');
      return false;
    }
  }, [settings, notify, tErr]);

  const ctx = useMemo(() => ({
    settings, reloadSettings, user, shift, reloadShift, notify, t, tErr, lang, printDoc, setPage, license, setLicense,
    isAdmin: user?.role === 'admin', can, has, withApproval, ask, pendingCart, setPendingCart,
    // Quotations open in the trading invoice when that screen is on; everything else in the cashier.
    openInPos: (cart) => { setPendingCart(cart); setPage(cart.quote_id && sellScreens(settings).includes('trading') ? 'invoice' : 'pos'); },
  }), [settings, reloadSettings, user, shift, reloadShift, notify, t, tErr, lang, printDoc, license, can, withApproval, ask, pendingCart]);

  let content;
  if (!settings.setup_done) {
    content = <Setup onDone={async (u) => { const s = await api.settings.get(); await reloadSettings(); setUser(u); setPage(homePage(s)); }} />;
  } else if (!user) {
    content = <Login onLogin={(u) => { setUser(u); setPage(homePage(settings)); }} />;
  } else {
    const screens = sellScreens(settings);
    const sellNav = screens.map((id) => SCREENS.find((x) => x.id === id)).map((x) => ({ id: x.page, icon: x.icon, label: screens.length > 1 ? `nav.${x.page === 'pos' ? 'cashier' : x.page}` : 'nav.pos' }));
    // Restaurants also get the delivery board right after the floor.
    if (screens.includes('restaurant') && has('delivery')) sellNav.splice(sellNav.findIndex((n) => n.id === 'floor') + 1, 0, { id: 'delivery', icon: '🛵', label: 'nav.delivery' });
    const nav = [...sellNav, ...NAV.filter((n) => has(n.feature) && (!n.when || n.when(settings)) && (!n.perm || [].concat(n.perm).some((p) => user.perms?.[p])))];
    const Page = { dashboard: Dashboard, delivery: Delivery, treasury: Treasury, employees: Employees, eta: EtaPage, zatca: ZatcaPage, uae: UaePage, help: Help, pos: Pos, floor: Floor, invoice: SalesInvoice, orders: Orders, customers: Customers, products: Products, purchases: Purchases, reports: Reports, shift: Shift, settings: Settings }[page] || Pos;
    content = (
      <div className="shell">
        <aside className="sidebar">
          <div className="brand" title={settings.business_name}><img src={logoMark} alt="" /><span>{settings.business_name}</span></div>
          <nav>
            {nav.map((n) => (
              <button key={n.id} className={page === n.id ? 'active' : ''} onClick={() => setPage(n.id)}>
                <span className="ico">{n.icon}</span>
                <span>{t(n.label || `nav.${n.id}`)}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div className="user-chip">
              <b>{user.name}</b>
              <small>{t(`settings.${user.role}`)}</small>
            </div>
            <span className={`shift-dot ${shift ? 'on' : ''}`} title={shift ? t('shift.current') : t('shift.none')} />
            <button className="ghost" onClick={async () => { await api.auth.logout(); setUser(null); }}>{t('nav.logout')}</button>
          </div>
        </aside>
        <main className="main">
          <UpdateBanner t={t} />
          {shift === undefined ? null : <Page key={page} />}
        </main>
      </div>
    );
  }

  return (
    <AppContext.Provider value={ctx}>
      {content}
      {askReq && <AskModal req={askReq} t={t} onDone={(v) => { askReq.resolve(v); setAskReq(null); }} />}
      {approvalReq && <ApprovalModal request={approvalReq} t={t} onDone={(a) => approvalResolve.current?.(a)} />}
      {toasts}
    </AppContext.Provider>
  );
}
