# InnoForge POS — Architecture

## 1. Big picture

```
┌──────────────────────── Electron main process (Node) ────────────────────────┐
│ main.cjs ── IPC router ──► services/index.cjs ──► node:sqlite (one .db file)  │
│    │  pos:call(ns, method, arg) → { ok, data } | { ok:false, code, message } │
│    ├─ license.cjs   (Ed25519 key, bound to the machine ID)                    │
│    ├─ updater.cjs   (electron-updater + our own signature check)              │
│    ├─ excel.cjs     (exceljs)                                                 │
│    ├─ kds-server.cjs ─ HTTP :7799 ─► kds.html (kitchen screen, any browser)   │
│    └─ printing / PDF / backups / serial-port picking for scales               │
└──────────────▲─────────────────────────────────────────────────────────────────┘
               │ contextBridge (preload.cjs → window.posBridge)
┌──────────────┴──────────── Renderer (React, sandboxed) ───────────────────────┐
│ App.jsx (context) → pages/* → components/* ; lib/api.js proxies every call    │
└────────────────────────────────────────────────────────────────────────────────┘
```

- **Offline by design.** Everything lives in `userData/innoforge-pos.db` (WAL mode). The only network use is the update check and, optionally, the kitchen screen on the LAN.
- **One logged-in user per app instance.** `createServices(db)` keeps `session.user`; every method checks it.
- **The renderer has no Node access** (`sandbox`, `contextIsolation`, no `nodeIntegration`). All privileged work goes through `posBridge`.

## 2. The service layer (`electron/services/index.cjs`)

A single factory returns namespaces. Those listed in `EXPOSED` (main.cjs) are callable from the UI:

| Namespace | Responsibility |
|---|---|
| `settings` | key/value settings with typed defaults (`DEFAULT_SETTINGS`); `newKdsKey` |
| `auth`, `users` | setup, PIN login (scrypt), roles + per-user permission overrides, approvers, salespeople |
| `categories`, `products` | catalog, units, price-list prices, barcodes (incl. scale labels), expiry batches, best sellers |
| `tables`, `floor` | restaurant tables; transfer / merge / split bill / printed check |
| `shifts` | open/close drawer, Z-report (`shiftSummary`) |
| `orders` | `quote` (price a cart), `saveOpen`, `sendToKitchen`, `checkout`, `refund`, `voidOpen`, serial search |
| `customers` | accounts, statement, open invoices, receipts (`collect`, `voidReceipt`), cheques, aging, loyalty points |
| `suppliers`, `purchases`, `rebates` | purchasing (line discount %, bonus units), supplier payments, returns, volume rebates |
| `expenses`, `reports`, `commissions`, `auditLog` | money out, reporting, sales-rep commission, activity log |
| `priceLists`, `promotions`, `quotes`, `stockCounts`, `importer` | trading tools, automatic promotions, quotations, stock taking, Excel import |
| `kitchenStations` | kitchen stations, printers, category routing |
| `kds` *(not exposed)* | kitchen display state / bump / recall — only the local HTTP server calls it |
| `purchaseOrders` | purchase orders, low-stock suggestions, receive into a purchase |
| `modifiers`, `delivery` | sizes/extras groups; delivery zones, drivers, board, dispatch, driver settlement |
| `treasury` | cash boxes / bank accounts, `moneyMove()` ledger, transfers, adjustments, cheques issued |
| `warehouses` | warehouses, stock per warehouse, transfers; `saleWarehouse()` = setting `sale_warehouse_id` |
| `installments` | plans on credit invoices (`create`, `get`, `plans`, `due`, `cancel`) |
| `employees` | staff, `punch` (any user), attendance grid, advances/bonuses/deductions, payroll `pay`/`unpay` |
| `coupons`, `giftCards` | coupon codes (applied in `priceCart`), prepaid cards (paid with at checkout) |
| `drawer` *(not exposed)* | permission check before main kicks the cash drawer |

Conventions inside the file: `requireUser()`, `requirePerm(perm, approval, extra)`, `audit(...)`, `PosError(code)`, `transaction(db, fn)`, helpers `int / num / str / plain / plainAll`, `dateRange(from, to)`.

## 3. Data model (by migration)

| Ver | Adds |
|---|---|
| v1 | `settings`, `users`, `categories`, `products`, `dining_tables`, `shifts`, `orders`, `order_items`, `payments`, `returns`, `return_items`, `stock_moves` |
| v2 | `suppliers`, `purchases`, `purchase_items`, `supplier_payments`, `expenses` |
| v3 | `customers`, `customer_payments`, `orders.customer_id/credit` |
| v4 | supervisor role, `users.permissions` (JSON overrides), `commission_rate`, `orders.salesperson_id`, `audit_log` |
| v5 | opening balances for customers/suppliers |
| v6 | `price_lists`, `product_prices`, `product_units`, `batches`, `quotes`, `quote_items`, `purchase_returns(+_items)`, `stock_counts(+_items)`, expiry/serial flags |
| v7 | `promotions`, loyalty (`customers.points`, `loyalty_moves`) |
| v8 | receipt vouchers on `customer_payments` (number, status, cheque fields, collector), `payment_allocations`, `customers.payment_terms/discount_percent`, `orders.due_date`, `order_items.customer_discount`, `products.supplier_id`, purchase bonus / line discount, `supplier_rebates` |
| v9 | `quote_items.manual_discount` |
| v10 | `orders.guests/check_printed_at`, `kitchen_stations`, `categories/products.station_id`, `kitchen_tickets` |
| v11 | `products.by_weight`, `products.plu` |
| v12 | `purchase_orders(+_items)`, `purchases.po_id` |
| v13 | `modifier_groups`, `modifier_options`, `product_modifier_groups`, `order_items.modifiers/modifiers_price`, `recipe_items`, `products.is_ingredient`, `delivery_zones`, `drivers`, delivery columns on `orders` |
| v14 | `money_accounts`, `money_moves` (treasury ledger), `account_id` on receipts/expenses/supplier payments, supplier cheque fields, `shifts.deposited` |
| v15 | `warehouses`, `warehouse_stock`, `stock_transfers(+_items)`, `warehouse_id` on `stock_moves/purchases/stock_counts`; `installment_plans`, `installments` |
| v16 | `employees`, `attendance`, `employee_moves`, `payrolls`; `coupons`, `orders.coupon_id/coupon_discount`; `gift_cards`, `gift_card_moves` |
| v17 | `devices` (main + connected computers, active flag), `device_settings` (per-computer printers/drawer/scale/warehouse…), `shifts.device_id`, `orders.device_id` |
| v18 | `eta_documents` (e-invoice/e-receipt queue), `products.eta_item_type/eta_item_code/eta_unit`, `customers.eta` (buyer type/ID/address JSON) |
| v19 | `zatca_documents` (stamped Saudi invoices/credit notes in chain order: icv, uuid, hash, signed xml, qr, status), `orders.zatca_qr`, `returns.zatca_qr`, `customers.zatca` (buyer address JSON) |
| v20 | `uae_documents` (PINT AE documents for the ASP), `customers.uae` (buyer address/emirate/license JSON) |
| v21 | Product variants: `products.parent_id`, `attributes` (parent), `variant` / `variant_label` / `own_price` (variant) |

Key relationships: an **order** is a cart that is `open` (held cart / table) then `completed` (gets `invoice_no`) or `void`. `orders.credit` is the part left on the customer's account. Stock is always in **base units** (`unit_factor` converts cartons). `stock_moves` is the stock ledger; `batches` hold expiry-tracked stock (FEFO).

## 4. Main flows

### Selling (`orders.checkout`)
1. `priceCart(cart)` — re-prices every line from the DB: unit price (unit / price list / base), customer standing discount, manual discount, best automatic promotion; then `computeTotals` (tax inclusive/exclusive, service for dine-in).
2. Stock check (if negative stock is off), serial numbers for serial-tracked items.
3. Payments: methods `cash / card / wallet / bank / other` + loyalty `points` + `gift_card`. Unpaid remainder → **credit sale** (needs a customer, `credit_sale` permission, credit limit); due date = explicit, customer terms, or `overdue_days`.
4. `authorizeCart` — manual discounts within `max_discount`, price overrides, credit; otherwise `APPROVAL_REQUIRED`.
5. Persist order + lines, invoice number, payments (change comes out of cash), stock moves, loyalty, quote → invoiced, audit, auto kitchen tickets.

### Customer accounts and collections
- Balance = opening + Σ credit sales − Σ posted `customer_payments` (receipts, settlement discounts, return credits).
- `openItems(customerId)`: payments **allocated** to invoices settle those first; everything else (unallocated money, credit opening balance, over-allocations) settles the oldest debts; what is left is an **advance**.
- Receipt voucher = rows sharing a `receipt_no` (money row + optional `discount` row). Cheques reduce the balance when received; *bounced* reverses them (and their discount). Voiding needs `void` + reason; cash from a closed shift cannot be voided.
- Aging buckets by invoice age; *overdue* = past its due date.
- **Installments:** an invoice with a plan owes one debt per installment (its own due date); payments to the invoice settle the earliest installments first. Collection screens see one line per invoice (`openByInvoice`), aging/overdue/dashboard see each installment.

### Warehouses
`products.stock` is the total; `warehouse_stock` splits it. Every `moveStock` names a warehouse (default: this computer's `sale_warehouse_id`). Purchases choose a warehouse; counts are per warehouse; transfers move between warehouses without changing the total. With one warehouse everything behaves as before. Adding a warehouse first syncs warehouse 1 with the totals.

### Staff money
Advances and salaries go out through `expenses.create` (category "سلف موظفين" / "مرتبات"), so the drawer, treasury and profit reports stay right. Paying a month (`payrolls` row) locks its advances/bonuses/deductions; `unpay` removes the salary expense.

### Licensing editions
`electron/editions.json` lists features, editions (feature bundles + default limits) and revoked resellers. The license payload carries `edition`, `addons`, `limits` (and `reseller` for reseller keys); `editions.cjs#entitlements()` turns it into `{ features:Set, limits }` (no edition = full). `createServices(db, { entitlements })` enforces it: whole namespaces in `LOCKED`, inline `requireFeature()` (coupons, gift cards, delivery, dine-in/modifiers, settings toggles), `checkLimit()` for users and warehouses. The renderer hides what is not licensed with `has()` (`src/lib/features.js`, set from `pos:license`).
Reseller keys: `body.sig.permitBody.permitSig`; the permit is signed by the vendor and holds the reseller's public key and what they may sell (`resellerAllows`).

### Reports
`services/report-catalog.cjs` defines every report as `{ group, feature?, perm?, noRange?, run({f,t}) → { columns:[{key,label,type,total}], rows, summary? } }`. `reports.catalog()` lists what the user may run; `reports.run({id,from,to})` adds totals. One viewer (`pages/Reports.jsx`), one Excel writer (`excel.writeReport`, numbers re-read in main, only labels come from the window) and one A4 layout (`reportHtml`).

### Coupons and gift cards
A coupon is an extra invoice discount computed in `priceCart` (`coupon_discount`) — it does not count as the cashier's discount. A gift card is a payment (`payments.method = 'gift_card'`) taken from the card balance; selling/topping up a card is money in during the shift (`shiftSummary.giftCash`), not a sale.

### Several computers (main computer + clients)
`device.json` gives each install an id and a role. **Server** (main computer): `lan-server.cjs` listens on `0.0.0.0:<port>`; every request carries `X-Pos-Key` (timing-safe compare, 10 bad keys → 1 min lock-out per IP) and `X-Pos-Device`; `admitDevice` registers new computers within the license's `devices` limit or refuses blocked ones. Each device id gets its own `createServices(db, { deviceId })`, so login, open shift and `DEVICE_KEYS` settings are per computer while all data is shared (one SQLite connection, synchronous calls — no interleaving). Only `remoteAllowed()` paths (EXPOSED namespaces + a few helpers) can be called. **Client**: no local database; `svc`/`callService` in `main.cjs` forward to `remote.cjs`; the license comes from the main computer (`/api/info`); backup/restore are refused (`CLIENT_MODE`); the local kitchen/customer-display server proxies `kds.*` to the main computer. If the main computer is unreachable the renderer shows `pages/Offline.jsx`.

### Egyptian e-invoice / e-receipt (ETA)
`orders.checkout` / `refund` call `etaEnqueue` (never throws): a row in `eta_documents` with kind `invoice` (customer has a tax number, or receipts are off) or `receipt`, doc type I/C/S/R and the selling device. In the main process `eta-submitter.cjs` runs every 3 min (when `eta_auto`) or on “Send now”: `etaQueue.prepare()` builds the JSON in id order (`eta.cjs`; receipts chain `previousUUID` per device and get `uuid = sha256(serialize(receipt with uuid ""))`; credit notes/return receipts wait until the original has a UUID), invoices are signed through the configured signer (URL `{serialized}` → `{signature}`, or a command reading stdin), then submitted (`/api/v1/documentsubmissions`, `/api/v1/receiptsubmissions` with the POS headers on the token call) and polled until Valid/Invalid. Secrets (`SECRET_KEYS`) are stripped from `settings.get`; `getSettings(true)` is only used inside the services. Amounts: the sale's net (total − tax) is spread over the lines (cart discount, coupons, tax inside prices), service and delivery fee become lines; each line keeps `salesTotal − discount = netTotal`.

### Restaurant
Floor → table (guests) → cashier screen with the table's open order → `sendToKitchen` splits unsent kitchen items into **tickets per station** (product station → category station → first station) → printed per station and shown on the KDS → chef bumps new → preparing → ready (✅ on the floor) → served. Check (pre-bill), transfer, merge, split are in `floor`.

### Purchasing and suppliers
Purchase lines: unit cost, trade discount %, bonus units (free) → weighted average cost per base unit, stock and batches. Supplier balance = opening + purchases − payments − return credits − rebates. Rebate agreements compute progress on purchases or on sales of the supplier's products and are settled as a credit on the supplier account.

### Scales
- **Label scales:** `products.byBarcode` recognises EAN-13 labels `prefix + PLU + value + check` (settings `scale_*`), matches `products.plu`, returns `scale.qty`.
- **Cable scales:** renderer `lib/scale.js` uses Web Serial; main's `select-serial-port` handler picks the port saved in settings. `lib/scale-parse.js` understands common formats (`ST,GS,+1.250kg`, `001250` grams…).

## 5. Security model

- **Licensing** (`license.cjs`): key = `base64url(payload).base64url(Ed25519 sig)`; payload `{product, machine, customer, issued, expires}`. Machine ID = SHA-256 of the OS machine GUID. Clock rollback is detected. Required only when packaged.
- **Code protection**: main process obfuscated heavily, renderer lightly; asar + integrity fuse, `onlyLoadAppFromAsar`, `runAsNode` off, no inspector. This raises the bar; it is not unbreakable.
- **Updates**: the app installs an update only if `<installer>.sig` verifies `innoforge-pos-update:<version>:<sha512>` with the vendor public key. Unsigned or wrongly signed updates are rejected.
- **Permissions**: role defaults + per-user overrides; admins always have everything; approvals need another user with the permission *and* `approve`; failed approvals are audited (written after rollback).
- **Kitchen screen server**: binds to 127.0.0.1 unless LAN is enabled; every API call needs the access key (timing-safe compare); the page has a strict CSP; it can only read tickets and move their status.
- **Backups**: daily copy (14 kept) and one before each update, in `userData/backups`.

## 6. Renderer conventions

- `useApp()` gives `settings, user, shift, t, tErr, notify, printDoc, withApproval, ask, can, setPage, openInPos…`.
- `useLoad(loader, deps)` → `[data, reload, setData]`.
- Modals: `Modal`, fields: `Field`, toggles: `Toggle` from `components/ui.jsx`.
- Selling screens are configurable (`lib/screens.js`): cashier (`pos`), restaurant floor (`floor`), trading invoice (`invoice`).
- Printable documents are plain HTML strings built in `lib/receipt.js`.
