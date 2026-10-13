// Watched folders: each company can point at a folder (e.g. the accountant's
// shared drive). New or changed files are imported automatically.
import chokidar, { type FSWatcher } from 'chokidar'
import { extname } from 'path'
import * as repo from './repo'
import { importFiles } from './ingest'
import { SUPPORTED_EXTENSIONS } from './ingest/extractors'

const watchers = new Map<string, { folder: string; watcher: FSWatcher }>()

export function refreshWatchers(): void {
  const companies = repo.listCompanies()
  const wanted = new Map(companies.filter((c) => c.watchFolder).map((c) => [c.id, c.watchFolder!]))
  for (const [id, w] of watchers) {
    if (wanted.get(id) !== w.folder) {
      void w.watcher.close()
      watchers.delete(id)
    }
  }
  for (const [id, folder] of wanted) {
    if (watchers.has(id)) continue
    const watcher = chokidar.watch(folder, {
      ignoreInitial: false,
      depth: 6,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 250 },
      ignored: (p, stats) => !!stats?.isFile() && !SUPPORTED_EXTENSIONS.includes(extname(p).toLowerCase())
    })
    const onFile = (path: string): void => {
      // importFiles skips files whose content hash is already in the archive.
      void importFiles(id, [path])
    }
    watcher.on('add', onFile).on('change', onFile)
    watchers.set(id, { folder, watcher })
  }
}

export function stopWatchers(): void {
  for (const w of watchers.values()) void w.watcher.close()
  watchers.clear()
}
