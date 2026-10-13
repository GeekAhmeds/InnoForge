#!/usr/bin/env node
// Upload electron-builder output to the Inno server (Inno Source For Software
// Solutions), under the app's own namespace.
// Usage: node scripts/publish-release.mjs <win|linux|mac> <distDir> [appId=azim-command]
// Env:   INNO_SERVER_URL (e.g. http://196.221.144.94:9991), INNO_PUBLISH_TOKEN
// Installers go first and the latest*.yml manifest last, so clients never
// see a manifest pointing at a file that is not uploaded yet.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const [os, dir, appId = 'azim-command'] = process.argv.slice(2)
const server = (process.env.INNO_SERVER_URL ?? '').replace(/\/+$/, '')
const token = process.env.INNO_PUBLISH_TOKEN ?? ''
if (!['win', 'linux', 'mac'].includes(os) || !dir) {
  console.error('usage: publish-release.mjs <win|linux|mac> <distDir>')
  process.exit(1)
}
if (!server || !token) {
  console.log('INNO_SERVER_URL / INNO_PUBLISH_TOKEN not set — skipping upload to the update server.')
  process.exit(0)
}

const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile() && /\.(exe|blockmap|AppImage|deb|dmg|zip|yml)$/.test(f))
const ordered = [...files.filter((f) => !f.endsWith('.yml')), ...files.filter((f) => /^latest.*\.yml$/.test(f))]
for (const file of ordered) {
  const body = readFileSync(join(dir, file))
  const res = await fetch(`${server}/api/${appId}/releases/${os}/${encodeURIComponent(file)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body
  })
  if (!res.ok) {
    console.error(`upload ${file} failed: ${res.status} ${await res.text()}`)
    process.exit(1)
  }
  console.log(`uploaded ${file} (${(body.length / 1048576).toFixed(1)} MB)`)
}
await fetch(`${server}/api/${appId}/releases/${os}/prune`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined)
