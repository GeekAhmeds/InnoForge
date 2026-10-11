import React, { useMemo, useState } from 'react';
import { savePdf } from '../lib/api.js';
import { VENDOR } from '../lib/vendor.js';
import { has } from '../lib/features.js';
import { HELP_GROUPS, TOPICS } from '../help/topics.js';
import { Empty, useApp } from '../components/ui.jsx';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The user guide inside the app: search, topics by group, steps and tips, a link to the
// tutorial video, and the whole guide as one printable manual / PDF.
export default function Help() {
  const { t, lang, settings, printDoc, notify, tErr } = useApp();
  const topics = useMemo(() => TOPICS.filter((x) => has(x.feature)), []);
  const [q, setQ] = useState('');
  const [current, setCurrent] = useState(topics[0]?.id);
  const L = (x) => x[lang] || x.ar;
  const found = q.trim()
    ? topics.filter((x) => JSON.stringify(L(x)).toLowerCase().includes(q.trim().toLowerCase()))
    : topics;
  const topic = topics.find((x) => x.id === current) || found[0];
  const manual = () => manualHtml(topics.map(L), lang, settings, t);
  const run = async (fn) => { try { await fn(); } catch (err) { notify(tErr(err), 'error'); } };
  return (
    <div className="page help-page">
      <div className="page-head">
        <h2>❓ {t('help.title')}</h2>
        <div className="row">
          <input className="w-auto" autoFocus placeholder={t('help.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <button onClick={() => run(() => savePdf({ html: manual(), name: t('help.manualName') }))}>📕 PDF</button>
          <button className="primary" onClick={() => run(() => printDoc(manual(), settings.a4_printer_name))}>🖨 {t('help.printAll')}</button>
        </div>
      </div>
      <div className="reports-layout">
        <nav className="report-nav card">
          {HELP_GROUPS.map((g) => {
            const list = found.filter((x) => x.group === g);
            if (!list.length) return null;
            return (
              <div key={g}>
                <h4>{t(`help.group.${g}`)}</h4>
                {list.map((x) => <button key={x.id} className={topic?.id === x.id ? 'on' : ''} onClick={() => setCurrent(x.id)}>{x.icon} {L(x).title}</button>)}
              </div>
            );
          })}
          {!found.length && <Empty>{t('common.none')}</Empty>}
        </nav>
        {topic && (
          <article className="card help-topic">
            <h2>{topic.icon} {L(topic).title}</h2>
            <p className="lead">{L(topic).intro}</p>
            <ol className="help-steps">{L(topic).steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            {L(topic).tips.length > 0 && (
              <div className="help-tips">{L(topic).tips.map((s, i) => <p key={i}>💡 {s}</p>)}</div>
            )}
            {topic.video && (
              <a className="button-link" href={`${VENDOR.videos}${topic.video}.mp4`} target="_blank" rel="noreferrer">▶ {t('help.video')}</a>
            )}
            <p className="muted small top-gap">{t('help.support', { phones: VENDOR.phones.join(' / ') })}</p>
          </article>
        )}
      </div>
    </div>
  );
}

/** The whole guide as an A4 manual: cover, contents, then every topic. */
function manualHtml(topics, lang, settings, t) {
  const date = new Date().toLocaleDateString('en-GB');
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 16mm 14mm; }
    body { font: 13px/1.7 Tahoma, "Segoe UI", Arial, sans-serif; color: #0f172a; margin: 0; }
    .cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; page-break-after: always; }
    .cover h1 { font-size: 34px; color: #0a43c9; margin: 0 0 8px; } .cover h2 { font-size: 20px; margin: 0 0 30px; color: #334155; }
    .cover .band { width: 120px; height: 6px; background: linear-gradient(90deg, #0a43c9, #0890c4, #f7a531); border-radius: 3px; margin: 18px auto; }
    .toc { page-break-after: always; } .toc li { margin: 4px 0; }
    section { page-break-inside: avoid; margin-bottom: 18px; border-top: 2px solid #e2e8f0; padding-top: 10px; }
    h3 { color: #0a43c9; font-size: 18px; margin: 0 0 6px; } .intro { color: #334155; }
    ol { padding-inline-start: 22px; } li { margin: 4px 0; }
    .tip { background: #fff7e8; border-inline-start: 4px solid #f7a531; padding: 6px 10px; margin: 6px 0; border-radius: 4px; }
    .muted { color: #64748b; }
  </style></head><body>
  <div class="cover">
    <h1>InnoForge POS</h1>
    <h2>${esc(t('help.manualName'))}</h2>
    <div class="band"></div>
    <div>${esc(settings.business_name || '')}</div>
    <div class="muted">${esc(VENDOR.name)} — ${esc(VENDOR.websiteLabel)} — ${esc(VENDOR.phones.join(' / '))}</div>
    <div class="muted">${date}</div>
  </div>
  <div class="toc"><h3>${esc(t('help.contents'))}</h3><ol>${topics.map((x) => `<li>${esc(x.title)}</li>`).join('')}</ol></div>
  ${topics.map((x, i) => `<section><h3>${i + 1}. ${esc(x.title)}</h3><p class="intro">${esc(x.intro)}</p>
    <ol>${x.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>${x.tips.map((s) => `<div class="tip">💡 ${esc(s)}</div>`).join('')}</section>`).join('')}
  </body></html>`;
}
