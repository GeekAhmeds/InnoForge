// Isolated compute for the agent. Code written by the model runs in a hidden
// Chromium renderer with the OS sandbox on, no Node.js, no preload and every
// network request blocked, so it can only crunch the data it is handed.
// The same isolated renderer turns chart SVGs into PNGs for Word/Excel.
import { BrowserWindow, session } from 'electron'

const PARTITION = 'azim-sandbox'
let configured = false

function sandboxSession(): Electron.Session {
  const ses = session.fromPartition(PARTITION)
  if (!configured) {
    ses.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !/^(data|about|blob):/.test(details.url) }))
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    configured = true
  }
  return ses
}

function hiddenWindow(width = 800, height = 600): BrowserWindow {
  return new BrowserWindow({
    show: false,
    width,
    height,
    webPreferences: {
      session: sandboxSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      offscreen: true,
      webSecurity: true
    }
  })
}

// Small statistics toolkit available to analysis code as `h`.
const HELPERS = `
const num = (v) => typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v.replace(/[,\\s]/g, ''))) ? Number(v.replace(/[,\\s]/g, '')) : null);
const h = {
  num,
  sum: (a) => a.reduce((s, v) => s + (num(v) ?? 0), 0),
  mean: (a) => { const v = a.map(num).filter((x) => x !== null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null },
  median: (a) => { const v = a.map(num).filter((x) => x !== null).sort((x, y) => x - y); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2 },
  min: (a) => Math.min(...a.map(num).filter((x) => x !== null)),
  max: (a) => Math.max(...a.map(num).filter((x) => x !== null)),
  std: (a) => { const v = a.map(num).filter((x) => x !== null); if (v.length < 2) return null; const m = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) },
  percentile: (a, p) => { const v = a.map(num).filter((x) => x !== null).sort((x, y) => x - y); if (!v.length) return null; const i = (v.length - 1) * p / 100; const lo = Math.floor(i); return v[lo] + (v[Math.ceil(i)] - v[lo]) * (i - lo) },
  groupBy: (rows, key) => rows.reduce((g, r) => { const k = typeof key === 'function' ? key(r) : r[key]; (g[k] ??= []).push(r); return g }, {}),
  sumBy: (rows, key, val) => Object.fromEntries(Object.entries(h.groupBy(rows, key)).map(([k, rs]) => [k, h.sum(rs.map((r) => typeof val === 'function' ? val(r) : r[val]))])),
  pivot: (rows, rowKey, colKey, val) => { const out = {}; for (const r of rows) { const a = r[rowKey], b = r[colKey]; (out[a] ??= {}); out[a][b] = (out[a][b] ?? 0) + (num(r[val]) ?? 0) } return out },
  pctChange: (a, b) => (num(a) && num(b) !== null ? ((num(b) - num(a)) / Math.abs(num(a))) * 100 : null),
  corr: (x, y) => { const p = x.map((v, i) => [num(v), num(y[i])]).filter(([a, b]) => a !== null && b !== null); const n = p.length; if (n < 3) return null; const mx = p.reduce((s, [a]) => s + a, 0) / n, my = p.reduce((s, [, b]) => s + b, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (const [a, b] of p) { sxy += (a - mx) * (b - my); sxx += (a - mx) ** 2; syy += (b - my) ** 2 } return sxy / Math.sqrt(sxx * syy) },
  linreg: (x, y) => { const p = x.map((v, i) => [num(v), num(y[i])]).filter(([a, b]) => a !== null && b !== null); const n = p.length; if (n < 2) return null; const mx = p.reduce((s, [a]) => s + a, 0) / n, my = p.reduce((s, [, b]) => s + b, 0) / n; let sxy = 0, sxx = 0; for (const [a, b] of p) { sxy += (a - mx) * (b - my); sxx += (a - mx) ** 2 } const slope = sxy / sxx; return { slope, intercept: my - slope * mx, predict: (v) => my + slope * (v - mx) } },
  movingAvg: (a, n) => a.map((_, i) => i + 1 < n ? null : h.mean(a.slice(i + 1 - n, i + 1))),
  top: (obj, n = 10) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n),
  round: (v, d = 2) => (num(v) === null ? null : Math.round(num(v) * 10 ** d) / 10 ** d),
};
`

/**
 * Run model-written JavaScript over the given datasets. `code` is a function
 * body that receives `data` (name → array of row objects) and `h` (helpers)
 * and returns any JSON-serializable result.
 */
export async function runAnalysis(code: string, data: Record<string, unknown[]>, timeoutMs = 20_000): Promise<{ result: unknown; logs: string[] }> {
  const win = hiddenWindow()
  try {
    await win.loadURL('about:blank')
    const script = buildAnalysisScript(code, data)
    const out = await Promise.race([
      win.webContents.executeJavaScript(script, true) as Promise<string>,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`analysis timed out after ${timeoutMs / 1000}s`)), timeoutMs))
    ])
    const parsed = JSON.parse(out) as { ok: boolean; result?: unknown; error?: string; logs: string[] }
    if (!parsed.ok) throw new Error(parsed.error)
    return { result: parsed.result, logs: parsed.logs }
  } finally {
    win.destroy()
  }
}

/** The script evaluated in the sandbox; resolves to a JSON string. */
export function buildAnalysisScript(code: string, data: Record<string, unknown[]>): string {
  return `(async () => {
      const logs = [];
      const console = { log: (...a) => logs.push(a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')) };
      ${HELPERS}
      const data = ${JSON.stringify(data)};
      try {
        const result = await (async (data, h, console) => { ${code}\n })(data, h, console);
        return JSON.stringify({ ok: true, result: result === undefined ? null : result, logs: logs.slice(0, 50) });
      } catch (e) {
        return JSON.stringify({ ok: false, error: String(e && e.stack || e), logs: logs.slice(0, 50) });
      }
    })()`
}

/** Rasterize an SVG (charts for Word/Excel) at 2x for sharp printing. */
export async function svgToPng(svg: string, width: number, height: number): Promise<Buffer> {
  const win = hiddenWindow(width, height)
  try {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}svg{display:block}</style></head><body>${svg}</body></html>`
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    win.webContents.setZoomFactor(1)
    const image = await win.webContents.capturePage({ x: 0, y: 0, width, height })
    return image.toPNG()
  } finally {
    win.destroy()
  }
}
