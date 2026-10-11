import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, fromMinor, toMinor } from '../lib/money.js';
import { payslipHtml } from '../lib/receipt.js';
import { Empty, Field, Modal, Toggle, useApp, useLoad } from '../components/ui.jsx';
import { AccountSelect } from './Treasury.jsx';

const thisMonth = () => new Date().toLocaleDateString('en-CA').slice(0, 7);

// Employees: today's check-in board (every user, so staff punch at the till), and for
// managers the staff list, the month's attendance, advances/bonuses/deductions and payroll.
export default function Employees() {
  const { t, can } = useApp();
  const [tab, setTab] = useState('today');
  const tabs = ['today', ...(can('employees') ? ['staff', 'attendance', 'moves', 'payroll'] : [])];
  return (
    <div className="page">
      <div className="page-head">
        <h2>🧑‍💼 {t('nav.employees')}</h2>
        {tabs.length > 1 && <div className="seg">{tabs.map((x) => <button key={x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`emp.tab.${x}`)}</button>)}</div>}
      </div>
      {tab === 'today' && <Today />}
      {tab === 'staff' && <Staff />}
      {tab === 'attendance' && <Attendance />}
      {tab === 'moves' && <Moves />}
      {tab === 'payroll' && <Payroll />}
    </div>
  );
}

function Today() {
  const { t, tErr, notify } = useApp();
  const [list, reload] = useLoad(() => api.employees.list(), []);
  const punch = async (e) => {
    try {
      const r = await api.employees.punch({ employeeId: e.id });
      notify(t(r.action === 'in' ? 'emp.checkedIn' : 'emp.checkedOut', { name: r.name, time: r.time }));
      reload();
    } catch (err) { notify(tErr(err), 'error'); }
  };
  return (
    <div className="card">
      <p className="muted">{t('emp.todayHint')}</p>
      <div className="punch-grid">
        {(list || []).map((e) => {
          const state = e.check_out ? 'out' : e.check_in && e.today_status === 'present' ? 'in' : e.today_status || 'none';
          return (
            <button key={e.id} className={`punch-card ${state}`} disabled={state === 'out'} onClick={() => punch(e)}>
              <b>{e.name}</b>
              <small className="muted">{e.job}</small>
              <span className="small">{state === 'in' ? `🟢 ${t('emp.inSince', { time: e.check_in })}` : state === 'out' ? `⚪ ${e.check_in} – ${e.check_out}` : state === 'absent' ? `🔴 ${t('emp.st.absent')}` : state === 'leave' ? `🟡 ${t('emp.st.leave')}` : t('emp.notYet')}</span>
              {state !== 'out' && <span className="badge">{state === 'in' ? t('emp.checkOut') : t('emp.checkIn')}</span>}
            </button>
          );
        })}
      </div>
      {list && !list.length && <Empty>{t('emp.none')}</Empty>}
    </div>
  );
}

function Staff() {
  const { t, tErr, notify, settings } = useApp();
  const d = settings.decimals;
  const [list, reload] = useLoad(() => api.employees.list({ includeInactive: true }), []);
  const [users] = useLoad(() => api.auth.salespeople(), []);
  const [f, setF] = useState(null);
  const m = (v) => formatMoney(v, settings);
  const save = async () => {
    try { await api.employees.save({ ...f, salary: toMinor(f.salary, d) }); setF(null); reload(); } catch (err) { notify(tErr(err), 'error'); }
  };
  return (
    <div className="card flush">
      <div className="row between pad nowrap-head">
        <h3>{t('emp.staff')}</h3>
        <button className="primary" onClick={() => setF({ name: '', phone: '', job: '', user_id: '', pay_type: 'monthly', salary: '', hired_at: '', notes: '', active: true })}>+ {t('emp.new')}</button>
      </div>
      <table className="grid">
        <thead><tr><th>{t('common.name')}</th><th>{t('emp.job')}</th><th>{t('settings.phone')}</th><th>{t('emp.payType')}</th><th className="num">{t('emp.salary')}</th><th>{t('emp.hiredAt')}</th></tr></thead>
        <tbody>{(list || []).map((e) => (
          <tr key={e.id} className={`clickable ${e.active ? '' : 'dim'}`} onClick={() => setF({ ...e, salary: fromMinor(e.salary, d), user_id: e.user_id || '', hired_at: e.hired_at || '', active: !!e.active })}>
            <td><b>{e.name}</b></td><td>{e.job}</td><td dir="ltr">{e.phone}</td><td>{t(`emp.pay.${e.pay_type}`)}</td><td className="num">{m(e.salary)}</td><td>{e.hired_at || '—'}</td>
          </tr>
        ))}</tbody>
      </table>
      {list && !list.length && <Empty>{t('emp.none')}</Empty>}
      {f && (
        <Modal title={f.id ? f.name : t('emp.new')} onClose={() => setF(null)} width={520}
          footer={<><span className="spacer" /><button onClick={() => setF(null)}>{t('common.cancel')}</button><button className="primary" onClick={save}>{t('common.save')}</button></>}>
          <div className="grid2">
            <Field label={t('common.name')}><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label={t('emp.job')}><input value={f.job} placeholder={t('emp.jobPh')} onChange={(e) => setF({ ...f, job: e.target.value })} /></Field>
            <Field label={t('settings.phone')}><input dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label={t('emp.hiredAt')}><input type="date" value={f.hired_at} onChange={(e) => setF({ ...f, hired_at: e.target.value })} /></Field>
            <Field label={t('emp.payType')}>
              <select value={f.pay_type} onChange={(e) => setF({ ...f, pay_type: e.target.value })}>
                <option value="monthly">{t('emp.pay.monthly')}</option><option value="daily">{t('emp.pay.daily')}</option>
              </select>
            </Field>
            <Field label={f.pay_type === 'daily' ? t('emp.dayRate') : t('emp.salary')}><input inputMode="decimal" value={f.salary} onChange={(e) => setF({ ...f, salary: e.target.value })} /></Field>
            <Field label={t('emp.user')} hint={t('emp.userHint')}>
              <select value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })}>
                <option value="">—</option>{(users || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label={t('common.notes')}><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          {f.id && <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label={t('common.active')} />}
        </Modal>
      )}
    </div>
  );
}

const ST_ICON = { present: '✓', absent: '✕', leave: '◐' };

function Attendance() {
  const { t, tErr, notify, lang } = useApp();
  const [month, setMonth] = useState(thisMonth());
  const [data, reload] = useLoad(() => api.employees.attendance({ month }), [month]);
  const [cell, setCell] = useState(null);
  if (!data) return null;
  const days = Array.from({ length: data.days }, (_, i) => i + 1);
  const weekday = (n) => new Date(`${month}-${String(n).padStart(2, '0')}T12:00:00`).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'narrow' });
  const save = async () => {
    try { await api.employees.setDay(cell); setCell(null); reload(); } catch (err) { notify(tErr(err), 'error'); }
  };
  return (
    <div className="card flush">
      <div className="row between pad nowrap-head">
        <h3>{t('emp.tab.attendance')}</h3>
        <input type="month" className="w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <div className="att-wrap">
        <table className="grid compact att-grid">
          <thead><tr><th>{t('common.name')}</th>{days.map((n) => <th key={n} className="c">{n}<br /><small className="muted">{weekday(n)}</small></th>)}<th className="c">✓</th><th className="c">✕</th><th className="c">{ST_ICON.leave}</th></tr></thead>
          <tbody>{data.rows.map((r) => (
            <tr key={r.id}>
              <td><b>{r.name}</b></td>
              {days.map((n) => {
                const a = r.by[n];
                const day = `${month}-${String(n).padStart(2, '0')}`;
                return (
                  <td key={n} className={`c att ${a?.status || ''}`} title={a ? `${t(`emp.st.${a.status}`)} ${a.check_in || ''}${a.check_out ? ` – ${a.check_out}` : ''}` : ''}
                    onClick={() => setCell({ employeeId: r.id, name: r.name, day, status: a?.status || 'present', checkIn: a?.check_in || '', checkOut: a?.check_out || '', notes: a?.notes || '' })}>
                    {a ? ST_ICON[a.status] : ''}
                  </td>
                );
              })}
              <td className="c"><b>{r.present}</b></td><td className="c warn">{r.absent || ''}</td><td className="c">{r.leave || ''}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {!data.rows.length && <Empty>{t('emp.none')}</Empty>}
      <p className="muted small pad">{t('emp.attHint')}</p>
      {cell && (
        <Modal title={`${cell.name} — ${cell.day}`} onClose={() => setCell(null)} width={440}
          footer={<><button className="danger-ghost" onClick={() => { cell.status = ''; save(); }}>{t('emp.clearDay')}</button><span className="spacer" /><button className="primary" onClick={save}>{t('common.save')}</button></>}>
          <div className="seg">{['present', 'absent', 'leave'].map((st) => <button key={st} className={cell.status === st ? 'on' : ''} onClick={() => setCell({ ...cell, status: st })}>{t(`emp.st.${st}`)}</button>)}</div>
          {cell.status === 'present' && (
            <div className="grid2 top-gap">
              <Field label={t('emp.checkIn')}><input type="time" value={cell.checkIn} onChange={(e) => setCell({ ...cell, checkIn: e.target.value })} /></Field>
              <Field label={t('emp.checkOut')}><input type="time" value={cell.checkOut} onChange={(e) => setCell({ ...cell, checkOut: e.target.value })} /></Field>
            </div>
          )}
          <Field label={t('common.notes')}><input value={cell.notes} onChange={(e) => setCell({ ...cell, notes: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}

/** Where money paid to staff comes from: the till drawer or a cash box / bank account. */
function PaySource({ value, onChange }) {
  const { t, shift, can } = useApp();
  return (
    <div className="row wrap">
      <Toggle checked={value.fromDrawer} onChange={(v) => onChange({ ...value, fromDrawer: v && !!shift })} label={t('emp.fromDrawer')} />
      {!value.fromDrawer && can('treasury') && <span className="w-auto"><AccountSelect value={value.accountId} onChange={(v) => onChange({ ...value, accountId: v })} /></span>}
    </div>
  );
}

function Moves() {
  const { t, tErr, notify, settings, shift, withApproval } = useApp();
  const d = settings.decimals;
  const [month, setMonth] = useState(thisMonth());
  const [list, reload] = useLoad(() => api.employees.moves({ month }), [month]);
  const [staff] = useLoad(() => api.employees.list(), []);
  const [f, setF] = useState(null);
  const m = (v) => formatMoney(v, settings);
  const save = async () => {
    try {
      await withApproval((approval) => api.employees.addMove({ ...f, employeeId: Number(f.employeeId), amount: toMinor(f.amount, d), month, approval }));
      setF(null); reload(); notify(t('common.saved'));
    } catch (err) { if (err.code !== 'CANCELLED') notify(tErr(err), 'error'); }
  };
  const remove = async (x) => {
    if (!window.confirm(t('common.areYouSure'))) return;
    try { await api.employees.removeMove(x.id); reload(); } catch (err) { notify(tErr(err), 'error'); }
  };
  return (
    <div className="card flush">
      <div className="row between pad nowrap-head">
        <h3>{t('emp.tab.moves')}</h3>
        <div className="row">
          <input type="month" className="w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
          {['advance', 'bonus', 'deduction'].map((k) => <button key={k} className={k === 'advance' ? 'primary' : ''} onClick={() => setF({ kind: k, employeeId: staff?.[0]?.id || '', amount: '', notes: '', fromDrawer: k === 'advance' && !!shift, accountId: null })}>+ {t(`emp.kind.${k}`)}</button>)}
        </div>
      </div>
      <table className="grid">
        <thead><tr><th>{t('common.date')}</th><th>{t('common.name')}</th><th>{t('emp.kindCol')}</th><th className="num">{t('inst.amount')}</th><th>{t('common.notes')}</th><th>{t('common.user')}</th><th /></tr></thead>
        <tbody>{(list || []).map((x) => (
          <tr key={x.id}>
            <td>{x.created_at.slice(0, 10)}</td><td><b>{x.name}</b></td><td><span className={`badge mv-${x.kind}`}>{t(`emp.kind.${x.kind}`)}</span></td>
            <td className="num">{m(x.amount)}</td><td>{x.notes}</td><td>{x.user_name}</td>
            <td><button className="danger-ghost sm" onClick={() => remove(x)}>✕</button></td>
          </tr>
        ))}</tbody>
      </table>
      {list && !list.length && <Empty>{t('common.none')}</Empty>}
      {f && (
        <Modal title={`${t(`emp.kind.${f.kind}`)} — ${month}`} onClose={() => setF(null)} width={460}
          footer={<><span className="spacer" /><button onClick={() => setF(null)}>{t('common.cancel')}</button><button className="primary" disabled={!f.employeeId || !(Number(f.amount) > 0)} onClick={save}>{t('common.save')}</button></>}>
          <Field label={t('emp.employee')}>
            <select value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>{(staff || []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
          </Field>
          <Field label={t('inst.amount')}><input autoFocus inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label={t('common.notes')}><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          {f.kind === 'advance' && <PaySource value={f} onChange={setF} />}
          <p className="muted small">{t(`emp.kindHint.${f.kind}`)}</p>
        </Modal>
      )}
    </div>
  );
}

function Payroll() {
  const { t, tErr, notify, settings, shift, withApproval, printDoc, lang } = useApp();
  const [month, setMonth] = useState(thisMonth());
  const [data, reload] = useLoad(() => api.employees.payroll({ month }), [month]);
  const [paying, setPaying] = useState(null);
  const m = (v) => formatMoney(v, settings);
  if (!data) return null;
  const pay = async () => {
    try {
      await withApproval((approval) => api.employees.pay({ month, employeeId: paying.row.employee_id, fromDrawer: paying.fromDrawer, accountId: paying.accountId, approval }));
      setPaying(null); reload(); notify(t('emp.paid'));
    } catch (err) { if (err.code !== 'CANCELLED') notify(tErr(err), 'error'); }
  };
  const unpay = async (r) => {
    if (!window.confirm(t('emp.unpayConfirm'))) return;
    try { await api.employees.unpay({ month, employeeId: r.employee_id }); reload(); } catch (err) { notify(tErr(err), 'error'); }
  };
  const unpaid = data.rows.filter((r) => !r.paid);
  return (
    <div className="card flush">
      <div className="row between pad nowrap-head">
        <h3>{t('emp.tab.payroll')}</h3>
        <div className="row">
          <input type="month" className="w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
          <button onClick={() => printDoc(payslipHtml(data, settings, t, lang), settings.a4_printer_name)}>📄 {t('a4.printA4')}</button>
        </div>
      </div>
      <table className="grid">
        <thead><tr>
          <th>{t('common.name')}</th><th className="num">{t('emp.days')}</th><th className="num">{t('emp.base')}</th><th className="num">{t('emp.absence')}</th>
          <th className="num">{t('emp.kind.bonus')}</th><th className="num">{t('emp.kind.deduction')}</th><th className="num">{t('emp.kind.advance')}</th><th className="num">{t('emp.net')}</th><th />
        </tr></thead>
        <tbody>{data.rows.map((r) => (
          <tr key={r.employee_id}>
            <td><b>{r.name}</b> <small className="muted">{r.job}</small></td>
            <td className="num">{r.days}{r.absent ? <small className="warn"> / ✕{r.absent}</small> : ''}</td>
            <td className="num">{m(r.base)}</td><td className="num warn">{r.absence ? `− ${m(r.absence)}` : ''}</td>
            <td className="num good">{r.bonuses ? `+ ${m(r.bonuses)}` : ''}</td><td className="num warn">{r.deductions ? `− ${m(r.deductions)}` : ''}</td>
            <td className="num warn">{r.advances ? `− ${m(r.advances)}` : ''}</td>
            <td className="num"><b>{m(r.net)}</b></td>
            <td>{r.paid ? <span className="row"><span className="badge inst-paid">✓ {t('emp.paidBadge')}</span><button className="ghost sm" onClick={() => unpay(r)}>↩</button></span>
              : <button className="primary sm" onClick={() => setPaying({ row: r, fromDrawer: false, accountId: null })}>💵 {t('emp.pay')}</button>}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={7}>{t('common.total')} {unpaid.length ? <small className="muted">({t('emp.unpaidLeft', { n: unpaid.length, v: m(unpaid.reduce((s, r) => s + r.net, 0)) })})</small> : ''}</td><td className="num"><b>{m(data.total)}</b></td><td /></tr></tfoot>
      </table>
      {!data.rows.length && <Empty>{t('emp.none')}</Empty>}
      <p className="muted small pad">{t('emp.payrollHint')}</p>
      {paying && (
        <Modal title={`💵 ${t('emp.pay')} — ${paying.row.name} · ${month}`} onClose={() => setPaying(null)} width={460}
          footer={<><span className="spacer" /><button onClick={() => setPaying(null)}>{t('common.cancel')}</button><button className="primary" onClick={pay}>{t('common.confirm')}</button></>}>
          <p className="big-total">{m(paying.row.net)}</p>
          <PaySource value={paying} onChange={setPaying} />
          {!shift && <p className="muted small">{t('emp.noShiftHint')}</p>}
        </Modal>
      )}
    </div>
  );
}
