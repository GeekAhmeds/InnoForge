import React, { useMemo, useRef, useState } from 'react';
import { Field, Toggle, useApp } from './ui.jsx';
import { receiptHtml } from '../lib/receipt.js';
import { DEFAULT_LAYOUT, FONT_SIZES, LOGO_WIDTHS, RECEIPT_PARTS, layoutSetting, receiptLayout } from '../lib/receipt-layout.js';

const GROUPS = ['top', 'info', 'items', 'totals', 'bottom'];

/** A sale that uses every part of the receipt, so each switch visibly changes the preview. */
export function sampleOrder(f, t) {
  const rate = Number(f.tax_rate) || 0;
  const total = 26500;
  const tax = rate ? (f.prices_include_tax ? Math.round((total * rate) / (100 + rate)) : Math.round((total * rate) / 100)) : 0;
  return {
    invoice_no: 1024, completed_at: new Date().toLocaleString('en-GB').replace(',', ''), user_name: t('rdesign.sampleCashier'),
    order_type: 'delivery', zone_name: t('rdesign.sampleZone'), driver_name: t('rdesign.sampleDriver'),
    customer_name: t('rdesign.sampleCustomer'), customer_phone: '01000000000', customer: { points: 140 },
    items: [
      { name: t('rdesign.sampleItem1'), qty: 2, unit_price: 7500, discount: 0, line_total: 15000, modifiers: [{ name: t('rdesign.sampleExtra') }], note: t('rdesign.sampleNote') },
      { name: t('rdesign.sampleItem2'), qty: 1, unit_price: 12500, discount: 0, line_total: 10000, promo_name: t('rdesign.samplePromo'), promo_discount: 2500 },
    ],
    payments: [{ method: 'cash', amount: total + (rate && !f.prices_include_tax ? tax : 0) }],
    subtotal: 25000, discount: 0, service: 0, delivery_fee: 1500, tax, total: total + (rate && !f.prices_include_tax ? tax : 0),
    change_due: 3500, refunded: 0, customer_balance: 0, points_earned: 26, note: t('rdesign.sampleOrderNote'),
  };
}

/**
 * Settings → Receipt & printing: what the customer's receipt shows, with a live preview.
 * Edits the settings form `f` in place (saved with the rest of the tab).
 */
export default function ReceiptDesigner({ f, setF, onTestPrint }) {
  const { t, lang } = useApp();
  const layout = receiptLayout(f);
  const frame = useRef(null);
  const [height, setHeight] = useState(600);
  const update = (patch) => setF((x) => ({ ...x, receipt_layout: layoutSetting({ ...receiptLayout(x), ...patch }) }));
  const toggle = (key) => (on) => update({ show: { ...layout.show, [key]: on } });
  const html = useMemo(() => receiptHtml(sampleOrder(f, t), f, t, lang), [f, t, lang]);
  const width = Math.round(((Number(f.paper_width) || 80) * 96) / 25.4);

  return (
    <div className="receipt-designer span2">
      <div>
        <h4>🧾 {t('rdesign.title')}</h4>
        <p className="muted">{t('rdesign.intro')}</p>
        {GROUPS.map((g) => (
          <fieldset key={g} className="rdesign-group">
            <legend>{t(`rdesign.group.${g}`)}</legend>
            {RECEIPT_PARTS.filter((p) => p.group === g).map((p) => (
              <div key={p.key} className="rdesign-part">
                <Toggle checked={layout.show[p.key]} onChange={toggle(p.key)} label={t(`rdesign.part.${p.key}`)} />
                {p.key === 'logo' && layout.show.logo && !f.business_logo && <small className="warn-text">{t('rdesign.noLogo')}</small>}
                {p.key === 'logo' && layout.show.logo && f.business_logo && (
                  <select value={layout.logoWidth} onChange={(e) => update({ logoWidth: Number(e.target.value) })} aria-label={t('rdesign.logoWidth')}>
                    {LOGO_WIDTHS.map((w) => <option key={w} value={w}>{t('rdesign.logoWidth')} {w}%</option>)}
                  </select>
                )}
                {p.key === 'header' && layout.show.header && (
                  <textarea rows={2} value={f.receipt_header} placeholder={t('rdesign.headerHint')} onChange={(e) => setF((x) => ({ ...x, receipt_header: e.target.value }))} />
                )}
                {p.key === 'footer' && layout.show.footer && (
                  <textarea rows={2} value={f.receipt_footer} placeholder={t('rdesign.footerHint')} onChange={(e) => setF((x) => ({ ...x, receipt_footer: e.target.value }))} />
                )}
                {p.key === 'qr' && layout.show.qr && (
                  <div className="grid2">
                    <Field label={t('rdesign.qrUrl')}><input dir="ltr" value={layout.qrUrl} placeholder="https://" onChange={(e) => update({ qrUrl: e.target.value })} /></Field>
                    <Field label={t('rdesign.qrLabel')}><input value={layout.qrLabel} placeholder={t('rdesign.qrLabelHint')} onChange={(e) => update({ qrLabel: e.target.value })} /></Field>
                  </div>
                )}
              </div>
            ))}
          </fieldset>
        ))}
        <div className="row wrap">
          <Field label={t('rdesign.font')}>
            <select value={layout.font} onChange={(e) => update({ font: Number(e.target.value) })}>
              {FONT_SIZES.map((s) => <option key={s} value={s}>{s}{s === DEFAULT_LAYOUT.font ? ` (${t('rdesign.default')})` : ''}</option>)}
            </select>
          </Field>
        </div>
        <p className="muted small">🔒 {t('rdesign.always')}</p>
        <p className="muted small">ℹ {t('rdesign.vendor')}</p>
        <div className="row">
          <button type="button" onClick={onTestPrint}>🖨 {t('settings.testPrint')}</button>
          <button type="button" className="ghost" onClick={() => { if (window.confirm(t('rdesign.resetConfirm'))) setF((x) => ({ ...x, receipt_layout: '' })); }}>↺ {t('rdesign.reset')}</button>
        </div>
      </div>
      <div className="rdesign-preview">
        <small className="muted">{t('rdesign.preview')}</small>
        <iframe
          ref={frame}
          title={t('rdesign.preview')}
          srcDoc={html}
          sandbox="allow-same-origin"
          style={{ width: width + 2, height }}
          onLoad={() => { try { setHeight(frame.current.contentDocument.documentElement.scrollHeight + 4); } catch { /* keep the last height */ } }}
        />
      </div>
    </div>
  );
}
