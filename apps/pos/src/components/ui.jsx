import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function Modal({ title, onClose, children, footer, width = 520 }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          {onClose && <button className="icon-btn" onClick={onClose} aria-label="close">✕</button>}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const notify = useCallback((text, kind = 'ok') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 4500 : 2500);
  }, []);
  const view = (
    <div className="toasts">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  );
  return { notify, view };
}

/** Runs an async loader on mount / when deps change; returns [data, reload, setData]. */
export function useLoad(loader, deps = []) {
  const [data, setData] = useState(null);
  const { notify, tErr } = useApp();
  const reload = useCallback(async () => {
    try {
      setData(await loader());
    } catch (err) {
      notify(tErr(err), 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return [data, reload, setData];
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}
