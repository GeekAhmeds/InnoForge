import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Modal } from './ui.jsx';

/**
 * Asks a supervisor to approve an action the current user may not do alone.
 * Resolves with { username, pin } or null when cancelled.
 */
export default function ApprovalModal({ request, t, onDone }) {
  const [approvers, setApprovers] = useState([]);
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  useEffect(() => {
    api.auth.approvers().then((list) => {
      setApprovers(list);
      if (list.length === 1) setUsername(list[0].username);
    }).catch(() => {});
  }, []);
  const submit = (e) => { e?.preventDefault(); if (username && pin) onDone({ username, pin }); };
  return (
    <Modal title={`🔐 ${t('approval.title')}`} onClose={() => onDone(null)} width={440}
      footer={<><span className="spacer" /><button onClick={() => onDone(null)}>{t('common.cancel')}</button><button className="primary" disabled={!username || !pin} onClick={submit}>{t('approval.approve')}</button></>}>
      <p>{t('approval.needed')}: <b>{t(`perm.${request.perm}`)}</b></p>
      {request.retry && <p className="warn small">{t(`err.${request.retry}`)}</p>}
      <form onSubmit={submit}>
        <div className="user-grid">
          {approvers.map((a) => (
            <button type="button" key={a.id} className={`user-tile ${username === a.username ? 'on' : ''}`} onClick={() => setUsername(a.username)}>
              <span className="avatar">{a.name.slice(0, 1)}</span><span>{a.name}</span><small>{t(`settings.${a.role}`)}</small>
            </button>
          ))}
        </div>
        {!approvers.length && <p className="muted">{t('approval.none')}</p>}
        <input className="xl" type="password" inputMode="numeric" autoFocus placeholder={t('login.pin')} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
        <button hidden />
      </form>
    </Modal>
  );
}
