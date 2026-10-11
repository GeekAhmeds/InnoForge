// Thin wrapper over the preload bridge. Calls resolve with data or throw an
// Error whose `code` matches the PosError codes from the main process.
const bridge = window.posBridge;

async function unwrap(promise) {
  const res = await promise;
  if (res.ok) return res.data;
  // The license expired while the app was open: go back to the activation screen.
  if (res.code === 'LICENSE_REQUIRED') window.location.reload();
  const err = new Error(res.message || res.code);
  err.code = res.code;
  throw err;
}

export const call = (ns, method, arg) => unwrap(bridge.call(ns, method, arg));
export const printers = () => unwrap(bridge.printers());
export const print = (job) => unwrap(bridge.print(job));
export const backup = () => unwrap(bridge.backup());
export const restore = () => unwrap(bridge.restore());
export const dataPath = () => unwrap(bridge.dataPath());
export const licenseStatus = () => unwrap(bridge.license());
export const activate = (key) => unwrap(bridge.activate(key));
export const copyText = (text) => unwrap(bridge.copy(text));
export const appVersion = () => unwrap(bridge.version());
export const excelTemplate = (kind) => unwrap(bridge.excelTemplate(kind));
export const excelPick = (kind) => unwrap(bridge.excelPick(kind));
export const excelExport = (job) => unwrap(bridge.excelExport(job));
export const savePdf = (job) => unwrap(bridge.savePdf(job));
export const reportExcel = (job) => unwrap(bridge.reportExcel(job));
export const kdsInfo = () => unwrap(bridge.kdsInfo());
export const openKds = (opts) => unwrap(bridge.openKds(opts));
export const serialListOnly = () => unwrap(bridge.serialListOnly());
export const openDrawer = (opts) => unwrap(bridge.openDrawer(opts));
export const sendDisplay = (state) => bridge.display(state).catch(() => {});
export const openCustomerDisplay = () => unwrap(bridge.openCustomerDisplay());
export const onSerialPorts = (fn) => bridge.onSerialPorts(fn);
export const updateState = () => unwrap(bridge.updateState());
export const updateCheck = () => unwrap(bridge.updateCheck());
export const updateInstall = () => unwrap(bridge.updateInstall());
export const onUpdateState = (fn) => bridge.onUpdateState(fn);

export const api = new Proxy({}, {
  get: (_t, ns) => new Proxy({}, { get: (_u, method) => (arg) => call(ns, method, arg) }),
});
