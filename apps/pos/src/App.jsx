import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { I18nProvider, useI18n } from './i18n/index.jsx';
import { api, licenseStatus, print } from './lib/api.js';
import { AppContext, useToasts } from './components/ui.jsx';
import Setup from './pages/Setup.jsx';
import Login from './pages/Login.jsx';
import Pos from './pages/Pos.jsx';
import Orders from './pages/Orders.jsx';
import Products from './pages/Products.jsx';
import Reports from './pages/Reports.jsx';
import Shift from './pages/Shift.jsx';
import Settings from './pages/Settings.jsx';
import Activation from './pages/Activation.jsx';
import Purchases from './pages/Purchases.jsx';

export default function App() {
  const [settings, setSettings] = useState(null);
  const [license, setLicense] = useState(null);
  const reloadSettings = useCallback(async () => setSettings(await api.settings.get()), []);
  useEffect(() => { reloadSettings(); licenseStatus().then(setLicense); }, [reloadSettings]);

  if (!settings || !license) return null;
  return (
    <I18nProvider lang={settings.language}>
      {license.required && !license.valid
        ? <Activation license={license} onActivated={setLicense} settings={settings} reloadSettings={reloadSettings} />
        : <Shell settings={settings} reloadSettings={reloadSettings} license={license} />}
    </I18nProvider>
  );
}

const NAV = [
  { id: 'pos', icon: '🛒' },
  { id: 'orders', icon: '🧾' },
  { id: 'products', icon: '📦', admin: true },
  { id: 'purchases', icon: '🚚', admin: true },
  { id: 'reports', icon: '📊', admin: true },
  { id: 'shift', icon: '⏱' },
  { id: 'settings', icon: '⚙', admin: true },
];

function Shell({ settings, reloadSettings, license }) {
  const { t, tErr, lang } = useI18n();
  const { notify, view: toasts } = useToasts();
  const [user, setUser] = useState(null);
  const [shift, setShift] = useState(undefined);
  const [page, setPage] = useState('pos');

  const reloadShift = useCallback(async () => setShift(await api.shifts.current()), []);
  useEffect(() => { if (user) reloadShift(); }, [user, reloadShift]);

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
    settings, reloadSettings, user, shift, reloadShift, notify, t, tErr, lang, printDoc, setPage, license,
    isAdmin: user?.role === 'admin',
  }), [settings, reloadSettings, user, shift, reloadShift, notify, t, tErr, lang, printDoc, license]);

  let content;
  if (!settings.setup_done) {
    content = <Setup onDone={async (u) => { await reloadSettings(); setUser(u); setPage('pos'); }} />;
  } else if (!user) {
    content = <Login onLogin={(u) => { setUser(u); setPage('pos'); }} />;
  } else {
    const nav = NAV.filter((n) => !n.admin || user.role === 'admin');
    const Page = { pos: Pos, orders: Orders, products: Products, purchases: Purchases, reports: Reports, shift: Shift, settings: Settings }[page] || Pos;
    content = (
      <div className="shell">
        <aside className="sidebar">
          <div className="brand" title={settings.business_name}>🔨<span>{settings.business_name}</span></div>
          <nav>
            {nav.map((n) => (
              <button key={n.id} className={page === n.id ? 'active' : ''} onClick={() => setPage(n.id)}>
                <span className="ico">{n.icon}</span>
                <span>{n.id === 'pos' && settings.business_type === 'restaurant' ? t('nav.pos') : t(`nav.${n.id}`)}</span>
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
        <main className="main">{shift === undefined ? null : <Page key={page} />}</main>
      </div>
    );
  }

  return (
    <AppContext.Provider value={ctx}>
      {content}
      {toasts}
    </AppContext.Provider>
  );
}
