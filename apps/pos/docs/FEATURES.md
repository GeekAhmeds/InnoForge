# InnoForge POS — Feature map

Where each feature lives and how far it has got. ✅ done and tested · 🟡 done, needs real-hardware check · ⏳ not built yet.

## Selling

| Feature | Status | Code |
|---|---|---|
| Cashier screen (barcode, `3*code`, categories, best sellers, held carts, shortcuts F2/F4/F8/F9, last-sale change & reprint) | ✅ | `src/pages/Pos.jsx`, `orders.*` |
| Restaurant floor (areas, status, timers, guests, check, move/merge/split) | ✅ | `src/pages/Floor.jsx`, `floor.*`, `tables.*` |
| Trading invoice screen (customer-first, units, price, disc %, due date, partial payment, quote) | ✅ | `src/pages/SalesInvoice.jsx` |
| Choose enabled selling screens per business | ✅ | `src/lib/screens.js`, Settings → General |
| Payments cash / card / wallet / bank, split, change, credit sale | ✅ | `orders.checkout`, `PayModal` |
| Returns (partial/full, credit-first for credit sales, points back) | ✅ | `orders.refund`, `Orders.jsx` |
| Thermal receipt, A4 invoice with logo, PDF, WhatsApp | ✅ | `lib/receipt.js`, `lib/share.js`, `pos:savePdf` |
| Shifts and Z-report | ✅ | `shifts.*`, `Shift.jsx` |

## The 19 extra features requested

| # | Feature | Status | Code |
|---|---|---|---|
| 1 | Per-user permissions (discount and max %, returns, price change, see cost/profit, …) | ✅ | `services/permissions.cjs`, Settings → Users |
| 2 | Supervisor role | ✅ | `ROLE_DEFAULTS.supervisor` |
| 3 | Audit log | ✅ | `audit()`, `audit_log`, Settings → Activity log |
| 4 | Supervisor PIN approval | ✅ | `requirePerm(…, approval)`, `withApproval`, `components/Approval.jsx` |
| 5 | Commissions for cashiers / sales reps | ✅ | `commissions.*`, Reports |
| 6 | Price lists (retail / wholesale / semi), per customer | ✅ | `priceLists.*`, `cartPriceList` |
| 7 | Quotations → invoices, sales orders delivered later | ✅ | `quotes.*`, Customers → Quotes |
| 8 | Official A4 invoice with logo and tax data | ✅ | `a4Html` |
| 9 | Debt aging 30/60/90 and overdue alerts | ✅ | `aging()`, `openItems()`, Customers → Aging, WhatsApp reminder |
| 10 | Purchase returns, stock counts by barcode | ✅ | `returnPurchase`, `stockCounts.*` |
| 11 | Multiple units (carton = 12) with their own price/barcode | ✅ | `product_units`, `priceCart` |
| 12 | Expiry dates / batches (FEFO), serial numbers | ✅ | `batches`, `moveStock`, `findSerial` |
| 13 | Automatic promotions (buy X get Y, time windows) | ✅ | `promotions.*`, `applyPromotions` |
| 14 | Loyalty points | ✅ | `loyalty_moves`, checkout/refund |
| 15 | Barcode labels | ✅ | `components/Labels.jsx`, `lib/barcode.js` |
| 16 | Excel import (products, customers, suppliers) and export | ✅ | `electron/excel.cjs`, `importer.*`, `ExcelImport.jsx` |
| 17 | Egyptian e-invoice (ETA) | ⏳ | — needs ETA API credentials + USB e-signature token per company |
| 18 | Several branches / devices on the same data | ⏳ | — needs a local server or sync service; only the kitchen screen uses the LAN today |
| 19 | Send invoice / statement on WhatsApp | ✅ | `lib/share.js` |

## Added after the 19

| Feature | Status | Code |
|---|---|---|
| Receipt vouchers: cash/card/wallet/bank/cheque, allocate to invoices, settlement discount, advances, void with reason, collector | ✅ | `customers.collect/receipts/voidReceipt`, `components/Collect.jsx` |
| Cheque register (pending / cleared / bounced) | ✅ | `customers.cheques/clearCheque/bounceCheque` |
| Payment terms per customer → due dates | ✅ | `customers.payment_terms`, `orders.due_date` |
| Standing customer discount % | ✅ | `priceCart` (`customer_discount`) |
| Supplier trade discount % and bonus units on purchases | ✅ | `purchases.create` |
| Supplier rebate agreements (target, %, on purchases or sales) | ✅ | `rebates.*`, Purchases → Supplier rebates |
| Kitchen stations with their own printers and copies | ✅ | `kitchenStations.*`, `dispatchKitchen`, `components/Kitchen.jsx` |
| Kitchen display screen (this PC or LAN tablets) | ✅ | `kds-server.cjs`, `kds.html`, `kds.*` |
| Label-printing scale barcodes (weight or price) | ✅ | `scaleBarcode()`, Settings → Devices |
| Scale on a serial/USB cable (live weight) | 🟡 | `lib/scale.js`, `lib/scale-parse.js` — parser tested; check with the customer's scale model |

## Platform

| Feature | Status | Code |
|---|---|---|
| One-computer licensing, durations, generator (CLI + browser) | ✅ | `license.cjs`, `tools/` |
| Code protection (obfuscation + fuses) | ✅ | `scripts/package.cjs`, `package.json` build |
| Signed automatic updates from the vendor server | ✅ | `updater.cjs`, `tools/sign-update.cjs`, CI workflow |
| Daily + pre-update backups, manual backup/restore | ✅ | `autoBackup`, Settings → Data |
| Windows installer, Linux AppImage/deb | ✅ (Windows installer not yet run on real Windows) | CI |

## Pending — suggested plans

**ETA e-invoice (17).** Add per-company ETA settings (client id/secret, environment), product GS1/EGS codes and tax types, a document builder (ETA JSON v1.0), signing through the company's USB token (a small signer helper using the token's PKCS#11 driver), and a submission queue so selling stays offline: invoices queue locally and submit when online, with a status screen (submitted / valid / rejected + reasons) and retry.

**Multi-branch / multi-device (18).** Option A (one site, several tills): one PC runs the database as a small LAN server (same services over HTTP with per-device keys); other tills become clients. Option B (several branches): each branch stays offline-first and syncs to a central server (append-only change log per table, branch id on every row, conflict rules: stock is per branch, master data from head office). Option A is the quicker first step.
