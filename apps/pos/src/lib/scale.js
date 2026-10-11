// A scale connected to this computer through a serial / USB-serial cable (Web Serial).
// Keeps the latest reading and tells subscribers when it changes.
import { parseScaleLine, splitLines } from './scale-parse.js';

const REQUESTS = { W: 'W', P: 'P', ENQ: '\x05' };
let port = null;
let reader = null;
let poll = null;
let last = null; // { weight, stable, at }
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(last, !!port));

export const scaleSupported = () => typeof navigator !== 'undefined' && !!navigator.serial;
export const scaleState = () => ({ connected: !!port, reading: last });
export function onScale(fn) { listeners.add(fn); fn(last, !!port); return () => listeners.delete(fn); }

/** Connects using the port chosen in Settings → Devices (the main process picks it). */
export async function connectScale({ baud = 9600, request = '' } = {}, { reuse = false } = {}) {
  if (!scaleSupported()) throw Object.assign(new Error('serial'), { code: 'SCALE_UNSUPPORTED' });
  await disconnectScale();
  let p = null;
  if (reuse) [p] = await navigator.serial.getPorts();
  if (!p) p = await navigator.serial.requestPort().catch(() => null);
  if (!p) throw Object.assign(new Error('no port'), { code: 'SCALE_NO_PORT' });
  await p.open({ baudRate: Number(baud) || 9600 });
  port = p;
  emit();
  readLoop();
  const cmd = REQUESTS[request];
  if (cmd) {
    const writer = port.writable.getWriter();
    const enc = new TextEncoder();
    poll = setInterval(() => writer.write(enc.encode(cmd)).catch(() => {}), 400);
  }
}

async function readLoop() {
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (port?.readable) {
      reader = port.readable.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const [lines, rest] = splitLines(buf);
        buf = rest.slice(-200);
        for (const line of lines) {
          const r = parseScaleLine(line);
          if (r) { last = { ...r, at: Date.now() }; emit(); }
        }
      }
      reader.releaseLock();
    }
  } catch {
    // Cable unplugged or port closed.
  }
  port = null;
  emit();
}

export async function disconnectScale() {
  clearInterval(poll);
  poll = null;
  try { await reader?.cancel(); } catch { /* already closed */ }
  try { await port?.close(); } catch { /* already closed */ }
  port = null;
  reader = null;
  emit();
}

/** A fresh, stable weight (read in the last 3 seconds), or null. */
export function stableWeight() {
  return last && last.stable && last.weight > 0 && Date.now() - last.at < 3000 ? last.weight : null;
}
