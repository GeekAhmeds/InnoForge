# Inno Data API — v1 contract

The read-only data API that Inno Source ERP (innovationsrc.com) exposes to
outside apps through API keys. **Azim Command's "Inno Source ERP" connector
speaks exactly this contract**, so any system that implements it can be
connected to Azim without code changes. Other tools (Power BI, Excel, Zapier,
n8n, a mobile app...) can use the same keys.

Everything is `GET`, JSON, UTF-8. Nothing in this API changes data.

## Base URL & auth

```
https://<erp-host>/api/data/v1
Authorization: Bearer inno_live_8f2k...        (X-Api-Key: <key> also accepted)
```

- A key is shown once at creation. The ERP stores only its SHA-256 hash and a
  short prefix (`inno_live_8f2k`) for display.
- Every request is checked against the key's settings, in this order:
  exists → enabled → not expired → caller IP allowed → rate limit / quota →
  dataset allowed → company allowed → requested date range within the key's
  history limit. The first failure returns its error (see Errors).

## Endpoints

### `GET /me` — who am I, what can I read

```json
{
  "data": {
    "key": { "id": "k_12", "name": "Azim Command — Ahmed", "prefix": "inno_live_8f2k", "expires_at": "2027-10-01" },
    "companies": [ { "id": "1", "name": "شركة النور", "currency": "EGP" } ],
    "datasets": ["monthly_pl", "sales_invoices", "receivables_aging"],
    "limits": { "per_minute": 60, "per_day": 5000, "used_today": 132, "max_history_days": 730 }
  }
}
```

### `GET /datasets` — catalog (only what this key is allowed to read)

```json
{
  "data": [
    {
      "key": "monthly_pl",
      "name": "Monthly profit & loss",
      "name_ar": "الأرباح والخسائر الشهرية",
      "description": "Revenue, cost of sales, expenses and net profit per month",
      "kind": "metrics",
      "params": [
        { "name": "from", "type": "date", "required": false },
        { "name": "to", "type": "date", "required": false }
      ],
      "columns": [
        { "key": "period", "label": "Period", "type": "period" },
        { "key": "revenue", "label": "Revenue", "type": "money" }
      ]
    }
  ]
}
```

`kind`: `"table"` (rows of records) or `"metrics"` (one row per month, see below).
Column `type`: `string | number | money | date | period | boolean`.
Hidden columns (see "Field rules") are not listed and never returned.

### `GET /datasets/{key}` — the rows

Query parameters:

| param | meaning |
|---|---|
| `company_id` | one of the key's companies; optional when the key has exactly one |
| `from`, `to` | `YYYY-MM-DD`, inclusive; datasets without dates ignore them |
| `page`, `page_size` | 1-based; `page_size` default 1000, max 5000 |
| anything else | dataset-specific params from the catalog (e.g. `branch_id`, `status`) |

```json
{
  "data": [
    { "number": "INV-2026-0091", "date": "2026-09-14", "customer": "Delta Trading", "total": 125000.5, "paid": 100000, "due": 25000.5, "status": "partial", "currency": "EGP" }
  ],
  "meta": { "page": 1, "page_size": 1000, "total": 1840, "has_more": true, "currency": "EGP" }
}
```

Row rules:
- Flat objects only (no nesting). Same keys in every row.
- Numbers are JSON numbers in **major units** (125000.5, not "125,000.50" and not piasters).
- Dates `YYYY-MM-DD`; months `YYYY-MM`.
- **Metrics datasets** return one row per month: `period` (`YYYY-MM`) plus one
  numeric column per metric, using these names where they apply:
  `revenue, cost_of_sales, gross_margin, expenses, net_profit, cash, receivables, payables, payroll`.

### `GET /openapi.json`

An OpenAPI 3.1 description of the endpoints and datasets this key can see.

## Errors

```json
{ "error": { "code": "scope_denied", "message": "This key cannot read payroll" } }
```

| HTTP | code |
|---|---|
| 400 | `bad_request` (bad param / date range) |
| 401 | `invalid_key`, `key_expired`, `key_disabled` |
| 403 | `ip_denied`, `scope_denied`, `company_denied`, `history_limit` |
| 404 | `not_found` (unknown dataset) |
| 429 | `rate_limited`, `quota_exceeded` — with a `Retry-After` header (seconds) |

## Standard datasets

Implement the ones the ERP has data for; keep these keys so Azim recognizes them.

| key | kind | columns |
|---|---|---|
| `companies` | table | id, name, currency |
| `monthly_pl` | metrics | period, revenue, cost_of_sales, gross_margin, expenses, net_profit |
| `cash_position` | metrics | period, cash, receivables, payables |
| `trial_balance` | table | account_code, account_name, account_type, debit, credit, balance |
| `general_ledger` | table | date, entry_no, account_code, account_name, description, debit, credit, cost_center |
| `sales_invoices` | table | number, date, customer, branch, total, tax, paid, due, status, currency |
| `purchase_invoices` | table | number, date, supplier, branch, total, tax, paid, due, status, currency |
| `receivables_aging` | table | customer, current, d1_30, d31_60, d61_90, over_90, total |
| `payables_aging` | table | supplier, current, d1_30, d31_60, d61_90, over_90, total |
| `cash_accounts` | table | account, type (bank/cash), opening, inflow, outflow, closing |
| `expenses_by_category` | table | category, amount, count |
| `inventory` | table | item_code, item_name, warehouse, qty, unit_cost, value |
| `payroll` | table | period, department, employees, gross, deductions, net |
| `installments_due` | table | customer, contract, due_date, amount, paid, status |

Admins can also publish **custom datasets** (a saved, parameterized read-only
query or report) under their own key; they appear in `/datasets` like the
standard ones.

## Key settings (managed in the ERP)

- **Name & owner**: e.g. "Azim Command — Ahmed".
- **Datasets**: which ones the key can read.
- **Field rules**: columns to hide for each dataset (e.g. hide `net` in `payroll`,
  or customer phone numbers).
- **Companies / branches**: the data scope.
- **History limit**: how far back the key can read, in days.
- **IP allowlist**: optional CIDR list.
- **Limits**: requests per minute, requests per day, and max rows per request.
- **Expiry date**, enable/disable, rotate (new secret, same settings), revoke.
- **Usage log**: time, key, endpoint, dataset, params, rows, status, duration, IP.
  Shown as charts per key, with last-used time and error counts.

## How Azim Command uses it

Connector type **Inno Source ERP**:

- **URL**: the base URL above.
- **API key**: the key.
- **Company ID**: optional.

**Test** calls `/me`. On the first successful test, Azim creates one dataset per
catalog entry: metrics datasets feed the live dashboard, and table datasets
become searchable documents the AI can analyze.

A dataset query in Azim is JSON:

```json
{"dataset": "sales_invoices", "range": "last_90_days", "params": {"status": "unpaid"}}
{"dataset": "monthly_pl", "range": "last_12_months"}
{"call": "catalog"}   {"call": "me"}
```

`range`: `today | this_month | last_month | last_30_days | last_90_days | ytd | last_12_months`,
or explicit `"from"` / `"to"` instead.
