'use strict';
// Sends raw bytes (ESC/POS commands) to a printer, without a print dialog or a
// native module: Windows through a small PowerShell + winspool helper, Linux/macOS
// through CUPS `lp -o raw`. Used to open the cash drawer wired to the receipt printer.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** ESC p m t1 t2 — pulse the drawer kick connector (m = 0: pin 2, 1: pin 5). */
const drawerKick = (pin = 0) => Buffer.from([0x1b, 0x70, pin ? 1 : 0, 0x19, 0xfa]);

const WIN_SCRIPT = `
param([string]$Printer, [string]$File)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern int StartDocPrinter(IntPtr h, int level, DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("OpenPrinter failed: " + Marshal.GetLastWin32Error());
    try {
      var di = new DOCINFO { pDocName = "InnoForge drawer", pDataType = "RAW" };
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("StartDocPrinter failed: " + Marshal.GetLastWin32Error());
      StartPagePrinter(h);
      int w; WritePrinter(h, data, data.Length, out w);
      EndPagePrinter(h); EndDocPrinter(h);
    } finally { ClosePrinter(h); }
  }
}
"@
[RawPrint]::Send($Printer, [System.IO.File]::ReadAllBytes($File))
`;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15000, windowsHide: true }, (err, _out, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve()));
  });
}

/** Writes `data` to `printer` (empty = system default printer, resolved by the caller). */
async function sendRaw(printer, data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'innoforge-raw-'));
  const bin = path.join(dir, 'job.bin');
  fs.writeFileSync(bin, data);
  try {
    if (process.platform === 'win32') {
      if (!printer) throw new Error('No printer');
      const script = path.join(dir, 'raw.ps1');
      fs.writeFileSync(script, WIN_SCRIPT);
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Printer', printer, '-File', bin]);
    } else {
      await run('lp', [...(printer ? ['-d', printer] : []), '-o', 'raw', bin]);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { sendRaw, drawerKick };
