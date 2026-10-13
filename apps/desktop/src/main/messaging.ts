// Outbound delivery: email over SMTP and WhatsApp via the Meta WhatsApp
// Cloud API. Recipients only ever come from the user's own configuration.
import nodemailer from 'nodemailer'
import { readFile } from 'fs/promises'
import { basename } from 'path'
import { getSecret, getSettings } from './settings'

export interface Attachment {
  path: string
  name?: string
}

export function emailConfigured(): boolean {
  const s = getSettings().smtp
  return !!(s.host && s.from)
}

export function whatsappConfigured(): boolean {
  return !!(getSettings().whatsapp.phoneNumberId && getSecret('whatsapp'))
}

export async function sendEmail(to: string[], subject: string, text: string, attachments: Attachment[] = []): Promise<void> {
  if (!to.length) return
  const s = getSettings().smtp
  if (!emailConfigured()) throw new Error('SMTP is not configured')
  const transport = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: s.user ? { user: s.user, pass: getSecret('smtp') } : undefined
  })
  await transport.sendMail({
    from: s.from,
    to: to.join(', '),
    subject,
    text,
    attachments: attachments.map((a) => ({ filename: a.name ?? basename(a.path), path: a.path }))
  })
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

const normalizePhone = (p: string): string => p.replace(/[^\d]/g, '').replace(/^00/, '')

async function graph(path: string, init: RequestInit): Promise<any> {
  const w = getSettings().whatsapp
  const res = await fetch(`https://graph.facebook.com/${w.apiVersion}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${getSecret('whatsapp')}`, ...(init.headers ?? {}) }
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`WhatsApp: ${body?.error?.message ?? res.status}`)
  return body
}

/**
 * Send a message (and optionally one document) to each number.
 * WhatsApp only allows free-form messages within 24h of the recipient's last
 * message; for scheduled reports configure an approved template whose header
 * is a DOCUMENT and whose body has one {{1}} parameter.
 */
export async function sendWhatsApp(numbers: string[], text: string, attachment?: Attachment): Promise<void> {
  if (!numbers.length) return
  if (!whatsappConfigured()) throw new Error('WhatsApp is not configured')
  const w = getSettings().whatsapp
  let mediaId: string | null = null
  const filename = attachment ? (attachment.name ?? basename(attachment.path)) : ''
  if (attachment) {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('file', new Blob([await readFile(attachment.path)], { type: MIME[ext] ?? 'application/octet-stream' }), filename)
    mediaId = (await graph(`${w.phoneNumberId}/media`, { method: 'POST', body: form })).id
  }
  for (const raw of numbers) {
    const to = normalizePhone(raw)
    if (!to) continue
    let message: Record<string, unknown>
    if (w.templateName) {
      message = {
        type: 'template',
        template: {
          name: w.templateName,
          language: { code: w.templateLanguage || 'ar' },
          components: [
            ...(mediaId ? [{ type: 'header', parameters: [{ type: 'document', document: { id: mediaId, filename } }] }] : []),
            { type: 'body', parameters: [{ type: 'text', text: text.slice(0, 1000) }] }
          ]
        }
      }
    } else if (mediaId) {
      message = { type: 'document', document: { id: mediaId, filename, caption: text.slice(0, 1000) } }
    } else {
      message = { type: 'text', text: { body: text.slice(0, 4000) } }
    }
    await graph(`${w.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, ...message })
    })
  }
}

/** Deliver to every configured channel; returns per-channel errors. */
export async function deliver(
  recipients: { emails: string[]; whatsapp: string[] },
  subject: string,
  text: string,
  attachment?: Attachment
): Promise<string[]> {
  const errors: string[] = []
  if (recipients.emails.length) {
    try {
      await sendEmail(recipients.emails, subject, text, attachment ? [attachment] : [])
    } catch (e) {
      errors.push(`email: ${(e as Error).message}`)
    }
  }
  if (recipients.whatsapp.length) {
    try {
      await sendWhatsApp(recipients.whatsapp, `${subject}\n\n${text}`, attachment)
    } catch (e) {
      errors.push(`whatsapp: ${(e as Error).message}`)
    }
  }
  return errors
}
