// Unfinished work kept in the browser storage of this computer (survives a power cut or a
// restart). Only for carts that are not in the database yet.
export function saveDraft(key, value) {
  try { localStorage.setItem(`draft:${key}`, JSON.stringify({ at: Date.now(), value })); } catch { /* storage full or blocked */ }
}

export function loadDraft(key, maxAgeHours = 72) {
  try {
    const raw = JSON.parse(localStorage.getItem(`draft:${key}`) || 'null');
    if (!raw || Date.now() - raw.at > maxAgeHours * 3600 * 1000) return null;
    return raw.value;
  } catch {
    return null;
  }
}

export function clearDraft(key) {
  try { localStorage.removeItem(`draft:${key}`); } catch { /* ignore */ }
}
