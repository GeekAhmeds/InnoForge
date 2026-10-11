import React, { useEffect, useState } from 'react';
import { api, copyText, kdsInfo, openKds, printers as listPrinters } from '../lib/api.js';
import { kitchenHtml } from '../lib/receipt.js';
import { Empty, Field, Modal, Toggle, useApp, useLoad } from './ui.jsx';
import { has } from '../lib/features.js';

/**
 * Prints an order's new kitchen tickets: one per station on that station's printer
 * (falling back to the kitchen printer, then the receipt printer), as many copies as set.
 */
export async function printKitchenTickets(order, tickets, { settings, t, lang, printDoc }) {
  let printed = 0;
  for (const tk of tickets) {
    const st = tk.station;
    if (st && !st.print) continue;
    const printer = st?.printer_name || settings.kitchen_printer_name || settings.printer_name;
    for (let i = 0; i < (st?.copies || 1); i++) {
      if (await printDoc(kitchenHtml(order, tk.items, settings, t, lang, st?.name), printer)) printed++;
    }
  }
  return printed;
}

/** Settings → Kitchen: stations and their printers, category routing, the kitchen screen. */
export default function KitchenSettings() {
  const { t, tErr, notify, settings, reloadSettings } = useApp();
  const [stations, reloadStations] = useLoad(() => api.kitchenStations.list(), []);
  const [cats, reloadCats] = useLoad(() => api.categories.list(), []);
  const [printers, setPrinters] = useState([]);
  const [editing, setEditing] = useState(null);
  const [info, setInfo] = useState(null);
  const [lan, setLan] = useState({ kds_lan: settings.kds_lan, kds_port: settings.kds_port, kitchen_auto_send: settings.kitchen_auto_send });
  const run = async (fn) => { try { await fn(); } catch (err) { notify(tErr(err), 'error'); } };
  const loadInfo = () => kdsInfo().then(setInfo).catch(() => {});
  useEffect(() => { listPrinters().then(setPrinters).catch(() => {}); loadInfo(); }, []);

  const saveScreen = () => run(async () => {
    await api.settings.save({ kds_lan: lan.kds_lan, kds_port: Number(lan.kds_port) || 7799, kitchen_auto_send: lan.kitchen_auto_send });
    await reloadSettings();
    await loadInfo();
    notify(t('common.saved'));
  });

  return (
    <>
      <div className="card">
        <div className="row between">
          <h3>🍳 {t('kitchen.stations')}</h3>
          <button className="primary" onClick={() => setEditing({ name: '', printer_name: '', copies: 1, print: true, display: true, active: true })}>+ {t('kitchen.newStation')}</button>
        </div>
        <p className="muted small">{t('kitchen.stationsHint')}</p>
        <div className="cat-list">
          {(stations || []).map((st) => (
            <div key={st.id} className={`cat-row ${st.active ? '' : 'dim'}`}>
              <div className="spacer">
                <b>{st.name}</b>
                <div className="muted small">
                  {st.print ? `🖨 ${st.printer_name || t('kitchen.defaultKitchenPrinter')}${st.copies > 1 ? ` × ${st.copies}` : ''}` : `🚫 ${t('kitchen.noPrint')}`}
                  {' · '}{st.display ? `🖥 ${t('kitchen.onScreen')}` : t('kitchen.notOnScreen')}
                </div>
              </div>
              <button className="ghost sm" onClick={() => run(() => openKds({ station: String(st.id) }))}>🖥</button>
              <button className="ghost sm" onClick={() => setEditing({ ...st, print: !!st.print, display: !!st.display, active: !!st.active })}>{t('common.edit')}</button>
            </div>
          ))}
          {stations && !stations.length && <Empty>{t('kitchen.noStations')}</Empty>}
        </div>
        {!!stations?.length && !!cats?.length && (
          <>
            <h4 className="top-gap">{t('kitchen.routing')}</h4>
            <table className="grid compact">
              <tbody>{cats.map((c) => (
                <tr key={c.id}>
                  <td><span className="dot" style={{ background: c.color }} /> {c.name}</td>
                  <td>
                    <select value={c.station_id || ''} onChange={(e) => run(async () => { await api.kitchenStations.setCategory({ categoryId: c.id, stationId: Number(e.target.value) || null }); reloadCats(); })}>
                      <option value="">{t('kitchen.firstStation', { name: stations[0]?.name || '' })}</option>
                      {stations.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}</tbody>
            </table>
            <p className="muted small">{t('kitchen.routingHint')}</p>
          </>
        )}
      </div>

      <div className="card">
        <h3>🖥 {t('kitchen.screen')}</h3>
        <p className="muted small">{t('kitchen.screenHint')}</p>
        <div className="row wrap">
          <button className="primary" onClick={() => run(() => openKds({}))}>🖥 {t('kitchen.openHere')}</button>
          {info && !info.running && <span className="warn">{t('kitchen.notRunning')} {info.error}</span>}
        </div>
        <div className="grid3 top-gap">
          <div className="span3"><Toggle checked={lan.kitchen_auto_send} onChange={(v) => setLan({ ...lan, kitchen_auto_send: v })} label={t('kitchen.autoSend')} /></div>
          {has('lan') && <div className="span3"><Toggle checked={lan.kds_lan} onChange={(v) => setLan({ ...lan, kds_lan: v })} label={t('kitchen.lan')} /></div>}
          <Field label={t('kitchen.port')}><input type="number" value={lan.kds_port} onChange={(e) => setLan({ ...lan, kds_port: e.target.value })} /></Field>
          <span /><div className="row end"><button className="primary" onClick={saveScreen}>{t('common.save')}</button></div>
        </div>
        {info?.running && info.lan && (
          <div className="kds-links">
            <p>{t('kitchen.lanHint')}</p>
            {info.lanUrls.map((u) => (
              <div key={u} className="row"><code dir="ltr" className="mono">{u}</code><button className="ghost sm" onClick={() => copyText(u).then(() => notify(t('common.copied')))}>📋</button></div>
            ))}
            {!info.lanUrls.length && <p className="warn">{t('kitchen.noNetwork')}</p>}
            <p className="muted small">{t('kitchen.firewall')}</p>
          </div>
        )}
        {info && (
          <div className="row top-gap">
            <span className="muted">{t('kitchen.key')}: <code className="mono">{info.key}</code></span>
            <button className="ghost sm" onClick={() => run(async () => { if (window.confirm(t('kitchen.newKeyConfirm'))) { await api.settings.newKdsKey(); await loadInfo(); } })}>↻ {t('kitchen.newKey')}</button>
          </div>
        )}
      </div>
      {editing && <StationModal station={editing} printers={printers} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reloadStations(); }} />}
    </>
  );
}

function StationModal({ station, printers, onClose, onSaved }) {
  const { t, tErr, notify } = useApp();
  const [f, setF] = useState(station);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const save = async () => { try { await api.kitchenStations.save({ ...f, copies: Number(f.copies) || 1 }); onSaved(); } catch (err) { notify(tErr(err), 'error'); } };
  const remove = async () => { if (!window.confirm(t('common.areYouSure'))) return; try { await api.kitchenStations.remove(f.id); onSaved(); } catch (err) { notify(tErr(err), 'error'); } };
  return (
    <Modal title={f.id ? f.name : t('kitchen.newStation')} onClose={onClose} width={520}
      footer={<>{f.id && <button className="danger-ghost" onClick={remove}>{t('common.delete')}</button>}<span className="spacer" /><button onClick={onClose}>{t('common.cancel')}</button><button className="primary" onClick={save}>{t('common.save')}</button></>}>
      <div className="grid2">
        <div className="span2"><Field label={t('common.name')}><input autoFocus value={f.name} placeholder={t('kitchen.namePh')} onChange={set('name')} /></Field></div>
        <Field label={t('kitchen.printer')}>
          <select value={f.printer_name} onChange={set('printer_name')}>
            <option value="">{t('kitchen.defaultKitchenPrinter')}</option>
            {printers.map((p) => <option key={p.name} value={p.name}>{p.displayName}</option>)}
          </select>
        </Field>
        <Field label={t('kitchen.copies')}><input type="number" min="1" max="5" value={f.copies} onChange={set('copies')} /></Field>
        <div className="span2"><Toggle checked={f.print} onChange={set('print')} label={t('kitchen.printTickets')} /></div>
        <div className="span2"><Toggle checked={f.display} onChange={set('display')} label={t('kitchen.showOnScreen')} /></div>
        {f.id && <div className="span2"><Toggle checked={f.active} onChange={set('active')} label={t('common.active')} /></div>}
      </div>
    </Modal>
  );
}
