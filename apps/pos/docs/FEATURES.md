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
| Receipt designer: switch receipt parts on/off, logo on thermal, multi-line header/footer, font size, link QR, invoice-number barcode, live preview (legal parts and the vendor line with the support number always print) | ✅ | `lib/receipt-layout.js` (`receipt_layout` setting), `components/ReceiptDesigner.jsx`, `lib/receipt.js` |
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
| 17 | Egyptian e-invoice (ETA) + e-receipt | ✅ built, ⏳ not yet tried on the live ETA system | `electron/eta.cjs` (documents, serialization, UUID chain), `eta-submitter.cjs` (token, sign, submit, poll), `eta.*` / `etaQueue` services, Settings → E-invoice + E-invoice page (`components/Eta.jsx`) |
| 18 | Several branches / devices on the same data | ✅ (live: one main computer; branches over a VPN) | `lan-server.cjs`, `remote.cjs`, `device.cjs`, `devices.*`, Settings → Network (`components/Network.jsx`) |
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

## Batches A–E (the 14 additions)

| Feature | Status | Code |
|---|---|---|
| Unfinished cart is kept (power cut, crash, restart) for 72 h | ✅ | `lib/drafts.js` (cashier + trading invoice) |
| Cash drawer kick through the receipt printer (on cash sales, manual with `open_drawer`) | 🟡 | `electron/rawprint.cjs`, `pos:openDrawer`, Settings → Devices — check with the real printer/drawer |
| Owner dashboard (today vs yesterday, month, drawer, receivables, alerts) | ✅ | `reports.dashboard`, `pages/Dashboard.jsx` |
| Low stock → purchase orders → receive into a purchase | ✅ | `purchaseOrders.*`, Purchases → Purchase orders |
| Customer-facing display (second screen or LAN tablet) | ✅ | `electron/customer.html`, `pos:display`, `kds-server.cjs` `/customer` |
| Sizes / extras (modifier groups with min/max, price, ingredient) | ✅ | `modifiers.*`, `components/Modifiers.jsx`, `priceCart` |
| Recipes: a dish consumes its ingredients' stock | ✅ | `recipe_items`, `consumeStock()` |
| Delivery: zones with fees, drivers, board (waiting / out / delivered), driver settlement | ✅ | `delivery.*`, `pages/Delivery.jsx` |
| Treasury: cash boxes and bank accounts, transfers, deposits, statements | ✅ | `treasury.*`, `moneyMove()`, `pages/Treasury.jsx` |
| Cheques we give suppliers (pending → cleared / void) | ✅ | `treasury.issuedCheques/clearIssued/voidIssued` |
| Several warehouses, stock per warehouse, transfers, counts per warehouse | ✅ | `warehouses.*`, `warehouse_stock`, `moveStock(…, warehouseId)`, Products → Warehouses |
| Installment sales: schedule, per-installment due/overdue, reminders, collect, print | ✅ | `installments.*`, `openItems()` / `installmentSplit()`, `components/Installments.jsx` |
| Employees: check-in board, monthly attendance, advances / bonuses / deductions, payroll | ✅ | `employees.*`, `pages/Employees.jsx` |
| Coupon codes (percent / amount, minimum, uses, dates) | ✅ | `coupons.*`, `findCoupon()` in `priceCart` |
| Gift cards (sell, top up, pay with, balance history) | ✅ | `giftCards.*`, checkout `gift_card`, Customers → Gift cards |

## Licensing, reports, help (after the 14)

| Feature | Status | Code |
|---|---|---|
| Editions (basic / supermarket / restaurant / trading / full), paid add-ons and limits inside the signed key | ✅ | `electron/editions.json`, `editions.cjs`, `LOCKED` + `requireFeature` + `checkLimit` in services, `src/lib/features.js`, Settings → License |
| Reseller permits (vendor-signed; resellers issue keys within limits) | ✅ | `license.cjs` (4-part keys), `tools/license.cjs reseller-*`, generator «أنا موزّع» |
| Pricing and partner programme proposal | 📄 | `docs/PRICING-AR.md` |
| 33 reports with sortable viewer, formatted Excel, PDF and A4 print | ✅ | `services/report-catalog.cjs`, `reports.catalog/run`, `pos:reportExcel` + `excel.writeReport`, `reportHtml`, `pages/Reports.jsx` |
| In-app user guide (search, F1, printable manual / PDF) | ✅ | `src/help/topics.js`, `pages/Help.jsx` |
| Tutorial videos recorded from the real app + promo video | ✅ | `tools/videos/record.cjs`, `tools/videos/promo.cjs` + `promo.html` |

Known limits (by design, for now):
- **Warehouses:** expiry batches stay per product, not per warehouse. Returns go back to the selling warehouse of the computer that takes them.
- **Installments:** no interest/markup field — price the goods for installment sale (or use a price list).
- **Gift cards:** refunding an invoice paid by gift card pays back in cash, not onto the card.
- **Payroll:** absence deduction is salary ÷ 30 per day marked *absent*; leave is paid; no overtime rules.

## Countries and Gulf e-invoicing

| Feature | Status | Code |
|---|---|---|
| Country (Egypt / Saudi Arabia / UAE): currency, VAT, VAT-number check, bilingual tax-invoice title, VAT per A4 line; a key may lock the copy to a country; reseller permits may list countries | ✅ | `editions.json` (`countries`), `editions.cjs` (`country`, `RESELLER_COUNTRY`), `checkCountry` in services, `src/lib/countries.js`, Setup / Settings |
| QR code generator (byte mode, versions 1–40) | ✅ (checked with a real reader) | `src/lib/qr.js` |
| Saudi FATOORA (ZATCA) phase 1 QR | ✅ | `src/lib/zatca-qr.js`, `lib/receipt.js` |
| Saudi FATOORA phase 2: stamp every sale/return at once, ICV + PIH chain, simplified (reported) and standard (cleared) invoices, credit notes, device onboarding (CSR → compliance → production CSID), status page | ✅ passes ZATCA's own validator (SDK 238-R3.4.8) offline; ⏳ not yet run on the simulation portal | `electron/zatca.cjs`, `zatca-submitter.cjs`, `zatca.*` / `zatcaQueue`, `components/Zatca.jsx`, `tools/zatca-validate.cjs`, `test/zatca.test.cjs` |
| UAE PINT AE (B2B) invoices and credit notes, hand-over to the ASP (generic POST) or XML export | ✅ invoice passes UBL XSD + EN16931; ⏳ PINT AE rules are checked by the ASP | `electron/uae.cjs`, `uae-submitter.cjs`, `uae.*` / `uaeQueue`, `components/Uae.jsx`, `test/uae.test.cjs` |

## Platform

| Feature | Status | Code |
|---|---|---|
| One-computer licensing, durations, generator (CLI + browser) | ✅ | `license.cjs`, `tools/` |
| Code protection (obfuscation + fuses) | ✅ | `scripts/package.cjs`, `package.json` build |
| Signed automatic updates from the vendor server | ✅ | `updater.cjs`, `tools/sign-update.cjs`, CI workflow |
| Daily + pre-update backups, manual backup/restore | ✅ | `autoBackup`, Settings → Data |
| Windows installer, Linux AppImage/deb | ✅ (Windows installer not yet run on real Windows) | CI |
| Automatic upload of updates to the server | ⏳ | CI `publish` job ready (incl. SSH jump host); server choice and `POS_DEPLOY_*` secrets pending — see `docs/SERVER-SETUP-AR.md` → «وقفنا فين؟» |

## Pending — suggested plans

**ETA e-invoice (17) — built; needs a real taxpayer to finish.** Done: settings the customer fills in (taxpayer data, ERP + POS credentials, signer, default codes, pre-production/production), item codes per product, buyer details per customer, a queue (`eta_documents`, v18) filled at checkout/refund, document builders (invoice v1.0 / credit note, receipt v1.2 / return receipt with the per-device UUID chain), canonical serialization, background submission with token cache, validation polling, retry/skip, status page. Not done / to verify: a real run on ETA pre-production with a taxpayer's credentials; the USB-token signer itself (we call an external signer by URL or command — a PKCS#11 CAdES-BES signer still has to be chosen or written); the QR code on printed e-receipts; cancelling a valid document at ETA from the app.

**Multi-device (18) — done as “one main computer”.** One PC (the main computer) keeps the database and serves it on the network (`electron/lan-server.cjs`, port 7790, access key); other PCs switch to client mode (`device.json` → `mode: client`) and send every service call to it (`remote.cjs`). Each connected PC has its own services instance on the main computer: its own logged-in user, open shift (`shifts.device_id`) and device settings (`device_settings`: printers, drawer, scale, selling warehouse…). Orders record `device_id`. The license limit `devices` counts the main computer too (basic 1, market 3, restaurant/trading 5, full unlimited). Branches connect over a VPN (Tailscale) to the main computer. **Not done:** working offline when the main computer is unreachable (branch sync with a change log) — clients show an offline screen until it is back.