// What this copy's license allows (edition features + add-ons). Set by App.jsx from the
// license status; null = not known yet / everything allowed (running from source).
let allowed = null;

export function setFeatures(list) {
  allowed = Array.isArray(list) ? new Set(list) : null;
}

export const has = (feature) => !feature || !allowed || allowed.has(feature);
