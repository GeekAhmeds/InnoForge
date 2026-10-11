---
name: pos-i18n
description: Adding or changing user-facing text in InnoForge POS (Arabic + English dictionaries in apps/pos/src/i18n), placeholders, error codes, audit labels, and the test that enforces it. Use whenever a POS screen, message, error or printed document gets new text.
---

# Arabic / English text in the POS

- Dictionaries: `apps/pos/src/i18n/ar.js` and `en.js` — flat objects `'area.key': 'text'`, same keys in both.
- Use in React: `t('area.key')`, with placeholders `t('pay.done', { n: 12 })` ↔ `'تم البيع — فاتورة رقم {n}'`.
- Errors: a service throws `PosError('SOME_CODE')`; the UI shows `t('err.SOME_CODE')` via `tErr(err)`.
- Activity log: `audit.<action>` for actions, `auditKey.<detailKey>` for detail field names.
- Dynamic keys (`t(\`pay.${method}\`)`, `t(\`perm.${p}\`)`, `t(\`order.${type}\`)`) are not caught by the test — add every possible value by hand.

## Style
- Arabic is Egyptian, friendly and short, the way a shop owner talks ("الفاتورة كلها آجل", "اتحفظ"). English is plain and short.
- Numbers, phone numbers, codes and dates inside Arabic text: wrap in `<span dir="ltr">` in JSX/HTML.

## Adding many keys
Append before the closing `};` of each file (keep both files in the same order). Quick check while working:
```bash
npm test   # test/i18n.test.mjs lists missing keys and keys present in only one language
```
