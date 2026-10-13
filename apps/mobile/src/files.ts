import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { api, type DocumentRow, type ServerConfig } from './api'

/** Downloads a document's original file into the cache and opens the system share sheet. */
export async function openDocument(cfg: ServerConfig, doc: DocumentRow): Promise<void> {
  const safeName = doc.name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || doc.id
  const target = new File(Paths.cache, `${doc.id}-${safeName}`)
  const file = await File.downloadFileAsync(api.fileUrl(cfg, doc.id), target, {
    headers: { Authorization: `Bearer ${cfg.token}` },
    idempotent: true
  })
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { dialogTitle: doc.name })
}
