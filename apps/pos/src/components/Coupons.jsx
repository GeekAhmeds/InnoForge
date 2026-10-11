import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, fromMinor, toMinor } from '../lib/money.js';
import { giftCardHtml } from '../lib/receipt.js';
import { Empty, Field, Modal, Toggle, useApp, useLoad } from './ui.jsx';

/** Settings → Offers: coupon codes typed at the till (percent or amount off the invoice). */
export function Coupons() {
  const { t, tErr, notify, settings } = useApp();
  const d = settings.decimals;
  const [list, reload] = useLoad(() => api.coupons.list(), []);
  const [f, setF] = useState(null);
  const m = (v) => formatMoney(v, settings);
  const today = new Date().toLocaleDateString('en-CA');
  const live = (c) => c.active && (!c.valid_from || c.valid_from <= today) && (!c.valid_to || c.valid_to >= today) && (!c.max_uses || c.used < c.max_uses);
  const save = async () => {
    try {
      await api.coupons.save({ ...f, value: f.kind === 'amount' ? toMinor(f.value, d) : Number(f.value), min_total: toMinor(f.min_total, d), max_uses: Number(f.max_uses) || 0 });
      setF(null); reload();
    } catch (err) { notify(tErr(err), 'error'); }
  };
  return (
    <div className="card wide-ish top-gap">
      <div className="row between"><h3>🎟 {t('coupon.title')}</h3><button className="primary" onClick={() => setF({ code: '', kind: 'percent', value: '10', min_total: '', max_uses: '', valid_from: '', valid_to: '', notes: '', active: true })}>+ {t('coupon.new')}</button></div>
      <p className="muted small">{t('coupon.hint')}</p>
      <div className="cat-list">
        {(list || []).map((c) => (
          <div key={c.id} className={`cat-row ${c.active ? '' : 'dim'}`}>
            <span className="dot lg" style={{ background: live(c) ? 'var(--good)' : '#cbd5e1' }} />
            <div className="spacer">
              <b className="mono" dir="ltr">{c.code}</b> — {c.kind === 'percent' ? `${c.value}%` : m(c.value)}
              <div className="muted small">
                {t('coupon.usedN', { n: c.used })}{c.max_uses ? ` / ${c.max_uses}` : ''} · {t('coupon.given')} {m(c.given)}
                {c.min_total ? ` · ${t('coupon.minTotal')} ${m(c.min_total)}` : ''}{c.valid_to ? ` · ${t('common.to')} ${c.valid_to}` : ''}
              </div>
            </div>
            <button className="ghost sm" onClick={() => setF({ ...c, value: c.kind === 'amount' ? fromMinor(c.value, d) : String(c.value), min_total: c.min_total ? fromMinor(c.min_total, d) : '', max_uses: c.max_uses || '', valid_from: c.valid_from || '', valid_to: c.valid_to || '', active: !!c.active })}>{t('common.edit')}</button>
          </div>
        ))}
        {list && !list.length && <p className="muted">{t('coupon.none')}</p>}
      </div>
      {f && (
        <Modal title={f.id ? f.code : t('coupon.new')} onClose={() => setF(null)} width={520}
          footer={<><Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label={t('common.active')} /><span className="spacer" /><button className="primary" onClick={save}>{t('common.save')}</button></>}>
          <div className="grid2">
            <Field label={t('coupon.code')}><input autoFocus dir="ltr" className="mono" value={f.code} placeholder="EID2026" onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
            <Field label={t('promos.kind')}>
              <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                <option value="percent">{t('promos.kind.percent')}</option><option value="amount">{t('promos.kind.amount')}</option>
              </select>
            </Field>
            <Field label={f.kind === 'percent' ? '%' : t('inst.amount')}><input inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
            <Field label={t('coupon.minTotal')}><input inputMode="decimal" value={f.min_total} placeholder="0" onChange={(e) => setF({ ...f, min_total: e.target.value })} /></Field>
            <Field label={t('coupon.maxUses')} hint={t('coupon.maxUsesHint')}><input inputMode="numeric" value={f.max_uses} placeholder="∞" onChange={(e) => setF({ ...f, max_uses: e.target.value })} /></Field>
            <Field label={t('common.notes')}><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
            <Field label={t('coupon.from')}><input type="date" value={f.valid_from} onChange={(e) => setF({ ...f, valid_from: e.target.value })} /></Field>
            <Field label={t('coupon.to')}><input type="date" value={f.valid_to} onChange={(e) => setF({ ...f, valid_to: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

const SELL_METHODS = ['cash', 'card', 'wallet'];

/** Customers → Gift cards: sell, top up, check a balance and see where a card was used. */
export function GiftCards() {
  const { t, tErr, notify, settings, shift, printDoc, lang, can } = useApp();
  const d = settings.decimals;
  const [search, setSearch] = useState('');
  const [list, reload] = useLoad(() => api.giftCards.list({ search }), [search]);
  const [sum, reloadSum] = useLoad(() => api.giftCards.summary(), []);
  const [selling, setSelling] = useState(null);
  const [card, setCard] = useState(null);
  const [topup, setTopup] = useState(null);
  const m = (v) => formatMoney(v, settings);
  const refresh = () => { reload(); reloadSum(); };
  const run = async (fn) => { try { await fn(); } catch (err) { notify(tErr(err), 'error'); } };
  const sell = () => run(async () => {
    const c = await api.giftCards.issue({ amount: toMinor(selling.amount, d), method: selling.method, code: selling.code, expires: selling.expires });
    setSelling(null); refresh(); setCard(c);
    notify(t('gift.sold'));
    if (selling.print) await printDoc(giftCardHtml(c, settings, t, lang));
  });
  return (
    <>
      <div className="card">
        <div className="row between">
          <div><h3>🎁 {t('gift.title')}</h3><p className="muted small">{t('gift.hint')}</p></div>
          <div className="row">
            {sum && <span className="badge">{t('gift.outstanding')}: {m(sum.outstanding)}</span>}
            <button className="primary" disabled={!shift} title={shift ? '' : t('shift.none')} onClick={() => setSelling({ amount: '', method: 'cash', code: '', expires: '', print: true })}>+ {t('gift.sell')}</button>
          </div>
        </div>
        <input className="top-gap" placeholder={t('gift.searchPh')} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="card flush top-gap">
        <table className="grid">
          <thead><tr><th>{t('gift.code')}</th><th>{t('pos.customer')}</th><th className="num">{t('gift.initial')}</th><th className="num">{t('gift.balance')}</th><th>{t('common.date')}</th><th>{t('gift.expires')}</th></tr></thead>
          <tbody>{(list || []).map((c) => (
            <tr key={c.id} className={`clickable ${c.active ? '' : 'dim'}`} onClick={() => run(async () => setCard(await api.giftCards.get(c.id)))}>
              <td className="mono" dir="ltr">{c.code}</td><td>{c.customer_name || '—'}</td><td className="num">{m(c.initial)}</td>
              <td className="num"><b>{m(c.balance)}</b></td><td>{c.created_at.slice(0, 10)}</td><td>{c.expires || '—'}</td>
            </tr>
          ))}</tbody>
        </table>
        {list && !list.length && <Empty>{t('gift.none')}</Empty>}
      </div>
      {selling && (
        <Modal title={`🎁 ${t('gift.sell')}`} onClose={() => setSelling(null)} width={460}
          footer={<><Toggle checked={selling.print} onChange={(v) => setSelling({ ...selling, print: v })} label={t('pay.printReceipt')} /><span className="spacer" /><button className="primary" disabled={!(Number(selling.amount) > 0)} onClick={sell}>{t('gift.sell')}</button></>}>
          <Field label={t('gift.value')}><input autoFocus className="xl" inputMode="decimal" value={selling.amount} onChange={(e) => setSelling({ ...selling, amount: e.target.value })} /></Field>
          <div className="seg full">{SELL_METHODS.map((k) => <button key={k} className={selling.method === k ? 'on' : ''} onClick={() => setSelling({ ...selling, method: k })}>{t(`pay.${k}`)}</button>)}</div>
          <div className="grid2 top-gap">
            <Field label={t('gift.code')} hint={t('gift.codeHint')}><input dir="ltr" className="mono" value={selling.code} onChange={(e) => setSelling({ ...selling, code: e.target.value })} /></Field>
            <Field label={t('gift.expires')}><input type="date" value={selling.expires} onChange={(e) => setSelling({ ...selling, expires: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
      {card && (
        <Modal title={`🎁 ${t('gift.card')}`} onClose={() => setCard(null)} width={540}
          footer={<>
            {can('customers_edit') && <button className="danger-ghost" onClick={() => run(async () => { setCard(await api.giftCards.setActive({ id: card.id, active: !card.active })); refresh(); })}>{card.active ? t('gift.stop') : t('gift.reactivate')}</button>}
            <span className="spacer" />
            <button onClick={() => printDoc(giftCardHtml(card, settings, t, lang))}>🖨 {t('orders.reprint')}</button>
            {card.active && shift && <button className="primary" onClick={() => setTopup({ amount: '', method: 'cash' })}>+ {t('gift.topup')}</button>}
          </>}>
          <div className="gift-card-face">
            <small>{settings.business_name}</small>
            <span className="code">{card.code.replace(/(\d{4})(?=\d)/g, '$1 ')}</span>
            <span>{t('gift.balance')}: <b>{m(card.balance)}</b> / {m(card.initial)}</span>
            {!card.active && <b>⛔ {t('gift.stopped')}</b>}
          </div>
          <table className="grid compact top-gap">
            <tbody>{card.moves.map((x) => (
              <tr key={x.id}><td>{x.created_at.slice(0, 16)}</td><td>{t(`gift.kind.${x.kind}`)}{x.invoice_no ? ` #${x.invoice_no}` : ''}{x.method ? ` · ${t(`pay.${x.method}`)}` : ''}</td>
                <td className={`num ${x.amount < 0 ? 'warn' : 'good'}`}>{x.amount > 0 ? '+' : '−'} {m(Math.abs(x.amount))}</td><td className="muted">{x.user_name}</td></tr>
            ))}</tbody>
          </table>
          {topup && (
            <Modal title={`+ ${t('gift.topup')}`} onClose={() => setTopup(null)} width={420}
              footer={<><span className="spacer" /><button className="primary" disabled={!(Number(topup.amount) > 0)} onClick={() => run(async () => { setCard(await api.giftCards.topup({ id: card.id, amount: toMinor(topup.amount, d), method: topup.method })); setTopup(null); refresh(); })}>{t('common.confirm')}</button></>}>
              <input autoFocus className="xl" inputMode="decimal" value={topup.amount} onChange={(e) => setTopup({ ...topup, amount: e.target.value })} />
              <div className="seg full top-gap">{SELL_METHODS.map((k) => <button key={k} className={topup.method === k ? 'on' : ''} onClick={() => setTopup({ ...topup, method: k })}>{t(`pay.${k}`)}</button>)}</div>
            </Modal>
          )}
        </Modal>
      )}
    </>
  );
}
