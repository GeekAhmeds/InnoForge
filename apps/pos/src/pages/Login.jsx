import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../components/ui.jsx';
import BrandHead from '../components/Brand.jsx';

export default function Login({ onLogin }) {
  const { t, tErr, notify, settings, reloadSettings } = useApp();
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [pin, setPin] = useState('');

  useEffect(() => {
    api.auth.loginUsers().then((list) => {
      setUsers(list);
      if (list.length === 1) setSelected(list[0]);
    });
  }, []);

  async function submit(value = pin) {
    if (!selected || !value) return;
    try {
      onLogin(await api.auth.login({ username: selected.username, pin: value }));
    } catch (err) {
      setPin('');
      notify(tErr(err), 'error');
    }
  }

  useEffect(() => {
    if (!selected) return undefined;
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p + e.key).slice(0, 8));
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const press = (k) => {
    if (k === '⌫') setPin((p) => p.slice(0, -1));
    else if (k === '✓') submit();
    else setPin((p) => (p + k).slice(0, 8));
  };

  async function toggleLang() {
    await api.settings.setLanguage(settings.language === 'ar' ? 'en' : 'ar');
    reloadSettings();
  }

  return (
    <div className="center-screen">
      <div className="card login">
        <div className="row between">
          <BrandHead title={settings.business_name} as="h2" />
          <button className="ghost" onClick={toggleLang}>{settings.language === 'ar' ? 'English' : 'العربية'}</button>
        </div>
        <p className="muted">{t('login.title')}</p>
        <div className="user-grid">
          {users.map((u) => (
            <button key={u.id} className={`user-tile ${selected?.id === u.id ? 'on' : ''}`} onClick={() => { setSelected(u); setPin(''); }}>
              <span className="avatar">{u.name.slice(0, 1)}</span>
              <span>{u.name}</span>
              <small>{t(`settings.${u.role}`)}</small>
            </button>
          ))}
        </div>
        {selected && (
          <>
            <div className="pin-dots">{Array.from({ length: Math.max(4, pin.length) }, (_, i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}</div>
            <div className="numpad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((k) => (
                <button key={k} className={k === '✓' ? 'primary' : ''} onClick={() => press(k)}>{k}</button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
