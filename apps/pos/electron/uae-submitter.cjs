'use strict';
// UAE e-invoicing: hands the PINT AE documents to the business's Accredited Service Provider.
// ASPs differ, so the connection is generic: the XML is POSTed to the ASP's URL with the
// business's API key in a header of its choice. In "export" mode nothing is sent: the files
// are saved from the UAE e-invoice page and uploaded to the ASP's portal.

function createUaeSubmitter({ queue, fetchImpl = (...a) => fetch(...a), log = () => {} }) {
  let running = null;
  let timer = null;
  let last = { at: null, ok: true, message: '' };

  async function run() {
    if (running) return running;
    running = (async () => {
      const out = { sent: 0, rejected: 0 };
      try {
        const s = queue.settings();
        if (!s.uae_enabled || s.uae_mode !== 'asp' || !s.uae_asp_url) return out;
        for (const d of queue.toSend(200)) {
          const headers = { 'Content-Type': 'application/xml', Accept: 'application/json, application/xml, */*' };
          if (s.uae_asp_key) headers[s.uae_asp_header || 'Authorization'] = s.uae_asp_key;
          let res;
          try {
            res = await fetchImpl(s.uae_asp_url, { method: 'POST', headers, body: d.xml, signal: AbortSignal.timeout(60000) });
          } catch (err) {
            throw Object.assign(new Error(err.message), { code: 'UAE_OFFLINE' });
          }
          const body = await res.text().catch(() => '');
          if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`ASP HTTP ${res.status}`), { code: 'UAE_OFFLINE' });
          if (res.ok) { queue.result(d.id, { status: 'sent', response: body }); out.sent++; } else { queue.result(d.id, { status: 'rejected', error: `HTTP ${res.status} ${body.slice(0, 500)}`, response: body }); out.rejected++; }
        }
        last = { at: new Date().toISOString(), ok: true, message: '' };
      } catch (err) {
        last = { at: new Date().toISOString(), ok: false, message: err.message, code: err.code };
        if (err.code !== 'UAE_OFFLINE') log('UAE e-invoice', err);
      } finally {
        running = null;
      }
      return out;
    })();
    return running;
  }

  return {
    run,
    state: () => last,
    start(everyMs = 5 * 60000) {
      clearInterval(timer);
      timer = setInterval(() => { try { if (queue.settings().uae_auto) run(); } catch { /* not ready */ } }, everyMs);
      timer.unref?.();
    },
    stop() { clearInterval(timer); },
  };
}

module.exports = { createUaeSubmitter };
