import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, fromMinor, toMinor } from '../lib/money.js';
import { Empty, Field, Modal, Toggle, useApp, useLoad } from '../components/ui.jsx';

/** A cash box / bank account dropdown (kind: 'cash' | 'bank' | '' for all). */
export function AccountSelect({ value, onChange, kind = '', none = null }) {
  const { t, settings } = useApp();
  const [list] = useLoad(() => api.treasury.accounts(), []);
  const items = (list || []).filter((a) => !kind || a.kind === kind);
  return (
    <select value={value || ''} onChange={(e) => onChange(Number(e.target.value) || null)}>
      <option value="">{none || t('treasury.noAccount')}</option>
      {items.map((a) => <option key={a.id} value={a.id}>{a.kind === 'bank' ? '🏦' : '💵'} {a.name}{a.balance != null ? ` (${formatMoney(a.balance, settings)})` : ''}</option>)}
    </select>
  );
}

// Treasury: every cash box and bank account with its balance, statements, transfers,
// hand-made deposits/withdrawals, and the cheques we gave suppliers.
export default function Treasury() {
  const { t } = useApp();
  const [tab, setTab] = useState('accounts');
  return (
    <div className="page">
      <div className="page-head">
        <h2>🏦 {t('nav.treasury')}</h2>
        <div className="seg">
          {['accounts', 'chequesOut'].map((x) => <button key={x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`treasury.tab.${x}`)}</button>)}
        </div>
      </div>
      {tab === 'accounts' && <Accounts />}
      {tab === 'chequesOut' && <IssuedCheques />}
    </div>
  );
}

function Accounts() {
  const { t, settings } = useApp();
  const [ov, reload] = useLoad(() => api.treasury.overview(), []);
  const [editing, setEditing] = useState(null);
  const [statement, setStatement] = useState(null);
  const [moving, setMoving] = useState(null); // { kind: 'transfer' | 'adjust', account }
  const m = (v) => formatMoney(v, settings);
  if (!ov) return null;
  return (
    <>
      <div className="dash-tiles">
        <div className="dash-tile strong"><small>{t('treasury.total')}</small><b>{m(ov.cash + ov.bank)}</b></div>
        <div className="dash-tile"><small>💵 {t('treasury.cash')}</small><b>{m(ov.cash)}</b></div>
        <div className="dash-tile"><small>🏦 {t('treasury.bank')}</small><b>{m(ov.bank)}</b></div>
        <div className="dash-tile"><small>{t('treasury.chequesIn')}</small><b>{m(ov.chequesIn.t)}</b><span className="note">{ov.chequesIn.n} {t('cheques.title')}</span></div>
        <div className="dash-tile"><small>{t('treasury.chequesOut')}</small><b className="warn">{m(ov.chequesOut.t)}</b><span className="note">{ov.chequesOut.n} {t('cheques.title')}</span></div>
      </div>
      <div className="row between">
        <span className="muted small">{t('treasury.hint')}</span>
        <span className="row">
          <button onClick={() => setMoving({ kind: 'transfer' })}>⇄ {t('treasury.transfer')}</button>
          <button className="primary" onClick={() => setEditing({ name: '', kind: 'cash', bank_name: '', account_no: '', opening_balance: '', active: true })}>+ {t('treasury.newAccount')}</button>
        </span>
      </div>
      <div className="acct-grid top-gap">
        {ov.accounts.map((a) => (
          <div key={a.id} className={`card acct ${a.kind}`}>
            <div className="row between"><b>{a.kind === 'bank' ? '🏦' : '💵'} {a.name}</b><button className="ghost sm" onClick={() => setEditing({ ...a, opening_balance: fromMinor(a.opening_balance, settings.decimals) })}>{t('common.edit')}</button></div>
            {a.kind === 'bank' && <div className="muted small">{a.bank_name} {a.account_no && <span dir="ltr">· {a.account_no}</span>}</div>}
            <div className={`acct-balance ${a.balance < 0 ? 'warn' : ''}`}>{m(a.balance)}</div>
            <div className="row wrap">
              <button className="sm" onClick={() => setStatement(a.id)}>📄 {t('treasury.statement')}</button>
              <button className="sm" onClick={() => setMoving({ kind: 'adjust', account: a })}>± {t('treasury.adjust')}</button>
            </div>
          </div>
        ))}
      </div>
      {!ov.accounts.length && <Empty>{t('treasury.none')}</Empty>}
      {editing && <AccountModal account={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {statement && <Statement id={statement} onClose={() => { setStatement(null); reload(); }} />}
      {moving && <MoveModal mode={moving} accounts={ov.accounts} onClose={() => setMoving(null)} onDone={() => { setMoving(null); reload(); }} />}
    </>
  );
}

function AccountModal({ account, onClose, onSaved }) {
  const { t, tErr, notify, settings } = useApp();
  const [f, setF] = useState(account);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const save = async () => { try { await api.treasury.saveAccount({ ...f, opening_balance: toMinor(f.opening_balance, settings.decimals) }); onSaved(); } catch (err) { notify(tErr(err), 'error'); } };
  return (
    <Modal title={f.id ? f.name : t('treasury.newAccount')} onClose={onClose} width={520}
      footer={<><span className="spacer" /><button onClick={onClose}>{t('common.cancel')}</button><button className="primary" onClick={save}>{t('common.save')}</button></>}>
      <div className="seg full">
        <button type="button" className={f.kind === 'cash' ? 'on' : ''} onClick={() => setF({ ...f, kind: 'cash' })}>💵 {t('treasury.kind.cash')}</button>
        <button type="button" className={f.kind === 'bank' ? 'on' : ''} onClick={() => setF({ ...f, kind: 'bank' })}>🏦 {t('treasury.kind.bank')}</button>
      </div>
      <div className="grid2 top-gap">
        <div className="span2"><Field label={t('common.name')}><input autoFocus value={f.name} placeholder={f.kind === 'bank' ? t('treasury.bankPh') : t('treasury.cashPh')} onChange={set('name')} /></Field></div>
        {f.kind === 'bank' && <>
          <Field label={t('collect.bank')}><input value={f.bank_name} onChange={set('bank_name')} /></Field>
          <Field label={t('treasury.accountNo')}><input dir="ltr" value={f.account_no} onChange={set('account_no')} /></Field>
        </>}
        <Field label={t('treasury.opening')} hint={t('treasury.openingHint')}><input inputMode="decimal" value={f.opening_balance} onChange={set('opening_balance')} placeholder="0" /></Field>
        {f.id && <Toggle checked={f.active} onChange={set('active')} label={t('common.active')} />}
      </div>
    </Modal>
  );
}

function MoveModal({ mode, accounts, onClose, onDone }) {
  const { t, tErr, notify, settings } = useApp();
  const [f, setF] = useState({ fromId: mode.account?.id || '', toId: '', amount: '', notes: '', sign: 1 });
  async function save() {
    try {
      const amount = toMinor(f.amount, settings.decimals);
      if (mode.kind === 'transfer') await api.treasury.transfer({ fromId: Number(f.fromId), toId: Number(f.toId), amount, notes: f.notes });
      else await api.treasury.adjust({ accountId: mode.account.id, amount: amount * f.sign, notes: f.notes });
      notify(t('common.saved'));
      onDone();
    } catch (err) { notify(tErr(err), 'error'); }
  }
  const pick = (k) => (
    <select value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
      <option value="">—</option>
      {accounts.map((a) => <option key={a.id} value={a.id}>{a.kind === 'bank' ? '🏦' : '💵'} {a.name} ({formatMoney(a.balance, settings)})</option>)}
    </select>
  );
  return (
    <Modal title={mode.kind === 'transfer' ? `⇄ ${t('treasury.transfer')}` : `± ${mode.account.name}`} onClose={onClose} width={480}
      footer={<><span className="spacer" /><button onClick={onClose}>{t('common.cancel')}</button><button className="primary" onClick={save}>{t('common.save')}</button></>}>
      {mode.kind === 'transfer' ? (
        <div className="grid2">
          <Field label={t('treasury.from')}>{pick('fromId')}</Field>
          <Field label={t('treasury.to')}>{pick('toId')}</Field>
        </div>
      ) : (
        <div className="seg full">
          <button type="button" className={f.sign > 0 ? 'on' : ''} onClick={() => setF({ ...f, sign: 1 })}>⬇ {t('treasury.deposit')}</button>
          <button type="button" className={f.sign < 0 ? 'on' : ''} onClick={() => setF({ ...f, sign: -1 })}>⬆ {t('treasury.withdraw')}</button>
        </div>
      )}
      <Field label={t('reports.amount')}><input className="strong-input" autoFocus inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label={t('treasury.reason')}><input value={f.notes} placeholder={t('treasury.reasonPh')} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </Modal>
  );
}

function Statement({ id, onClose }) {
  const { t, settings } = useApp();
  const [d] = useLoad(() => api.treasury.statement({ id }), [id]);
  const m = (v) => formatMoney(v, settings);
  if (!d) return null;
  return (
    <Modal title={`📄 ${d.account.name}`} onClose={onClose} width={820}
      footer={<><span>{t('customers.balance')}: <b>{m(d.account.balance)}</b></span><span className="spacer" /></>}>
      <table className="grid">
        <thead><tr><th>{t('orders.date')}</th><th>{t('orders.type')}</th><th>{t('pos.note')}</th><th className="num">{t('treasury.in')}</th><th className="num">{t('treasury.out')}</th><th className="num">{t('customers.balance')}</th></tr></thead>
        <tbody>
          <tr><td>—</td><td>{t('treasury.opening')}</td><td /><td /><td /><td className="num"><b>{m(d.account.opening_balance)}</b></td></tr>
          {d.rows.map((r) => (
            <tr key={r.id}>
              <td>{r.created_at}</td>
              <td>{t(`treasury.move.${r.kind}`)}</td>
              <td className="muted small">{r.notes}{r.user_name ? ` · ${r.user_name}` : ''}</td>
              <td className="num good">{r.amount > 0 ? m(r.amount) : ''}</td>
              <td className="num warn">{r.amount < 0 ? m(-r.amount) : ''}</td>
              <td className="num"><b>{m(r.balance)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!d.rows.length && <Empty>{t('common.none')}</Empty>}
    </Modal>
  );
}

function IssuedCheques() {
  const { t, tErr, notify, settings, ask } = useApp();
  const [status, setStatus] = useState('pending');
  const [list, reload] = useLoad(() => api.treasury.issuedCheques({ status }), [status]);
  const [clearing, setClearing] = useState(null);
  const m = (v) => formatMoney(v, settings);
  const run = async (fn) => { try { await fn(); reload(); } catch (err) { notify(tErr(err), 'error'); } };
  const total = (list || []).reduce((s, c) => s + c.amount, 0);
  return (
    <>
      <div className="filters toolbar">
        <div className="seg">{['pending', 'cleared', ''].map((x) => <button key={x} className={status === x ? 'on' : ''} onClick={() => setStatus(x)}>{x ? t(`cheques.status.${x}`) : t('common.all')}</button>)}</div>
        <span className="muted small">{t('treasury.chequesOutHint')}</span>
        <span className="spacer" />
        <span>{t('common.total')}: <b>{m(total)}</b></span>
      </div>
      <div className="card flush">
        <table className="grid">
          <thead><tr><th>{t('collect.chequeNo')}</th><th>{t('purchases.supplier')}</th><th>{t('collect.bank')}</th><th>{t('collect.chequeDue')}</th><th className="num">{t('reports.amount')}</th><th /></tr></thead>
          <tbody>{(list || []).map((c) => (
            <tr key={c.id} className={c.cheque_status === 'pending' && c.days_left != null && c.days_left <= 3 ? 'audit-hot' : ''}>
              <td className="mono" dir="ltr">{c.cheque_no}</td><td>{c.supplier_name}</td><td>{c.bank}{c.account_name ? ` · ${c.account_name}` : ''}</td>
              <td>{c.cheque_due || '—'}{c.cheque_status === 'pending' && c.days_left != null && <small className="muted"> ({c.days_left >= 0 ? t('cheques.inDays', { d: c.days_left }) : t('cheques.late', { d: -c.days_left })})</small>}</td>
              <td className="num"><b>{m(c.amount)}</b></td>
              <td className="num">{c.cheque_status === 'pending' ? <>
                <button className="ghost sm" onClick={() => setClearing(c)}>✅ {t('cheques.clear')}</button>
                <button className="danger-ghost sm" onClick={async () => { const reason = await ask(t('treasury.voidChequeReason'), { required: true }); if (reason) run(() => api.treasury.voidIssued({ id: c.id, reason })); }}>✕ {t('common.cancel')}</button>
              </> : <span className="badge">{t(`cheques.status.${c.cheque_status}`)}</span>}</td>
            </tr>
          ))}</tbody>
        </table>
        {list && !list.length && <Empty>{t('cheques.none')}</Empty>}
      </div>
      {clearing && <PickAccount title={`✅ ${clearing.cheque_no}`} kind="bank" initial={clearing.account_id} onClose={() => setClearing(null)}
        onPick={(accountId) => run(async () => { await api.treasury.clearIssued({ id: clearing.id, accountId }); setClearing(null); })} />}
    </>
  );
}

/** Small dialog: which account? */
export function PickAccount({ title, kind = '', initial = null, onClose, onPick, optional = false }) {
  const { t } = useApp();
  const [id, setId] = useState(initial);
  return (
    <Modal title={title} onClose={onClose} width={440}
      footer={<><span className="spacer" /><button onClick={onClose}>{t('common.cancel')}</button><button className="primary" disabled={!optional && !id} onClick={() => onPick(id)}>{t('common.confirm')}</button></>}>
      <Field label={t('treasury.account')}><AccountSelect kind={kind} value={id} onChange={setId} /></Field>
    </Modal>
  );
}
