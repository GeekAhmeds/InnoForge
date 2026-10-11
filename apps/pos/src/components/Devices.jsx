import React, { useEffect, useState } from 'react';
import { api, onSerialPorts, openCustomerDisplay, openDrawer, serialListOnly } from '../lib/api.js';
import { connectScale, disconnectScale, onScale, scaleSupported } from '../lib/scale.js';
import { formatQty } from '../lib/money.js';
import { Field, Toggle, useApp } from './ui.jsx';

/** Settings → Devices: electronic scales (barcode labels and scales on a cable). */
export default function Devices() {
  const { t, tErr, notify, settings, reloadSettings } = useApp();
  const [f, setF] = useState(settings);
  const [ports, setPorts] = useState([]);
  const [reading, setReading] = useState({ r: null, connected: false });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  useEffect(() => onSerialPorts(setPorts), []);
  useEffect(() => onScale((r, connected) => setReading({ r, connected })), []);

  const save = async () => {
    try {
      const keys = ['cash_drawer', 'drawer_pin', 'customer_display', 'display_message', 'scale_barcodes', 'scale_prefixes', 'scale_code_digits', 'scale_value', 'scale_value_decimals', 'scale_serial', 'scale_port', 'scale_baud', 'scale_request'];
      await api.settings.save(Object.fromEntries(keys.map((k) => [k, f[k]])));
      await reloadSettings();
      notify(t('common.saved'));
    } catch (err) { notify(tErr(err), 'error'); }
  };
  const findPorts = async () => {
    try { await serialListOnly(); await navigator.serial.requestPort().catch(() => {}); } catch (err) { notify(tErr(err), 'error'); }
  };
  const connect = async () => {
    try {
      await api.settings.save({ scale_port: f.scale_port, scale_baud: f.scale_baud, scale_request: f.scale_request, scale_serial: true });
      await reloadSettings();
      await connectScale({ baud: f.scale_baud, request: f.scale_request });
    } catch (err) { notify(String(err.code).startsWith('SCALE_') ? t(`devices.err.${err.code}`) : tErr(err), 'error'); }
  };

  const codeDigits = Number(f.scale_code_digits) || 5;
  const prefix = String(f.scale_prefixes).split(/[,\s]+/).filter(Boolean)[0] || '21';
  const valueDigits = 12 - prefix.length - codeDigits;
  const example = `${prefix}${'00123'.padStart(codeDigits, '0').slice(-codeDigits)}${'01250'.padStart(valueDigits, '0').slice(-valueDigits)}C`;

  return (
    <>
      <div className="card">
        <h3>💰 {t('drawer.title')}</h3>
        <p className="muted small">{t('drawer.hint')}</p>
        <Toggle checked={f.cash_drawer} onChange={set('cash_drawer')} label={t('drawer.enable')} />
        {f.cash_drawer && (
          <div className="row top-gap">
            <Field label={t('drawer.pin')}><select value={f.drawer_pin} onChange={set('drawer_pin')}><option value={0}>{t('drawer.pin2')}</option><option value={1}>{t('drawer.pin5')}</option></select></Field>
            <button type="button" onClick={async () => { try { await save(); await openDrawer({}); notify(t('drawer.sent')); } catch (err) { notify(tErr(err), 'error'); } }}>🔓 {t('drawer.test')}</button>
          </div>
        )}
      </div>

      <div className="card">
        <h3>🖥 {t('display.title')}</h3>
        <p className="muted small">{t('display.hint')}</p>
        <Toggle checked={f.customer_display} onChange={set('customer_display')} label={t('display.enable')} />
        <Field label={t('display.message')}><input value={f.display_message} placeholder={t('display.messagePh')} onChange={set('display_message')} /></Field>
        <button type="button" onClick={() => openCustomerDisplay().catch((err) => notify(tErr(err), 'error'))}>🖥 {t('display.open')}</button>
      </div>

      <div className="card">
        <h3>⚖ {t('devices.labelScale')}</h3>
        <p className="muted small">{t('devices.labelScaleHint')}</p>
        <Toggle checked={f.scale_barcodes} onChange={set('scale_barcodes')} label={t('devices.readScaleBarcodes')} />
        {f.scale_barcodes && (
          <div className="grid2 top-gap">
            <Field label={t('devices.prefixes')} hint={t('devices.prefixesHint')}><input dir="ltr" value={f.scale_prefixes} onChange={set('scale_prefixes')} /></Field>
            <Field label={t('devices.codeDigits')}><select value={f.scale_code_digits} onChange={set('scale_code_digits')}>{[4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
            <Field label={t('devices.valueKind')}>
              <select value={f.scale_value} onChange={(e) => setF({ ...f, scale_value: e.target.value, scale_value_decimals: e.target.value === 'price' ? settings.decimals : 3 })}>
                <option value="weight">{t('devices.weight')}</option><option value="price">{t('devices.price')}</option>
              </select>
            </Field>
            <Field label={t('devices.valueDecimals')} hint={f.scale_value === 'weight' ? t('devices.weightDecimalsHint') : t('devices.priceDecimalsHint')}>
              <input type="number" min="0" max="4" value={f.scale_value_decimals} onChange={set('scale_value_decimals')} />
            </Field>
            <div className="span2 scale-example">
              <code dir="ltr">{example}</code>
              <span className="muted small">{t('devices.example', { p: prefix, plu: '00123'.slice(-codeDigits), v: f.scale_value === 'weight' ? '1.250 kg' : `12.50` })}</span>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>🔌 {t('devices.serialScale')}</h3>
        <p className="muted small">{t('devices.serialScaleHint')}</p>
        {!scaleSupported() ? <p className="warn">{t('devices.err.SCALE_UNSUPPORTED')}</p> : (
          <>
            <Toggle checked={f.scale_serial} onChange={set('scale_serial')} label={t('devices.useSerial')} />
            <div className="grid3 top-gap">
              <Field label={t('devices.port')}>
                <div className="row">
                  <select value={f.scale_port} onChange={set('scale_port')}>
                    <option value="">{t('devices.autoPort')}</option>
                    {f.scale_port && !ports.some((p) => p.portName === f.scale_port) && <option value={f.scale_port}>{f.scale_port}</option>}
                    {ports.map((p) => <option key={p.portId} value={p.portName}>{p.displayName} ({p.portName})</option>)}
                  </select>
                  <button type="button" onClick={findPorts}>🔍</button>
                </div>
              </Field>
              <Field label={t('devices.baud')}><select value={f.scale_baud} onChange={set('scale_baud')}>{[2400, 4800, 9600, 19200, 38400, 115200].map((b) => <option key={b} value={b}>{b}</option>)}</select></Field>
              <Field label={t('devices.request')} hint={t('devices.requestHint')}>
                <select value={f.scale_request} onChange={set('scale_request')}>
                  <option value="">{t('devices.streams')}</option><option value="W">W</option><option value="P">P</option><option value="ENQ">ENQ (0x05)</option>
                </select>
              </Field>
            </div>
            <div className="row top-gap scale-live">
              <button className="primary" onClick={connect}>🔌 {t('devices.connect')}</button>
              {reading.connected && <button onClick={() => disconnectScale()}>{t('devices.disconnect')}</button>}
              <span className={`scale-readout ${reading.r?.stable ? 'stable' : ''}`}>
                {reading.connected ? (reading.r ? `${formatQty(reading.r.weight)} kg ${reading.r.stable ? '✓' : '…'}` : t('devices.waiting')) : t('devices.notConnected')}
              </span>
            </div>
          </>
        )}
      </div>
      <div className="form-foot"><button className="primary" onClick={save}>{t('common.save')}</button></div>
    </>
  );
}
