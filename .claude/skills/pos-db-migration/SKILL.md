---
name: pos-db-migration
description: How to change the InnoForge POS SQLite schema — append-only migrations in apps/pos/electron/db.cjs, table rebuilds with foreign keys off, backfills, and verifying an upgrade from an old database. Use for any new table/column/index.
---

# Changing the POS database schema

Schema lives in `apps/pos/electron/db.cjs` → `MIGRATIONS` (index i = version i+1, tracked by `PRAGMA user_version`). Installed customers upgrade automatically on start, so:

1. **Never edit a migration that has shipped** (anything already pushed to `main`/released). Append a new entry at the end. Unreleased work on the current branch may be folded into the newest entry.
2. Simple changes — a string entry:
   ```js
   // vN: what and why
   `
   ALTER TABLE products ADD COLUMN thing INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX idx_products_thing ON products(thing);
   UPDATE products SET thing = ... ; -- backfill
   `,
   ```
   SQLite `ADD COLUMN` needs a constant default when `NOT NULL`.
3. Changing a CHECK constraint / column type requires a rebuild — use the object form so foreign keys are off and verified:
   ```js
   { fkOff: true, sql: `
     CREATE TABLE t_new (...);
     INSERT INTO t_new (...) SELECT ... FROM t;
     DROP TABLE t;
     ALTER TABLE t_new RENAME TO t;
     CREATE INDEX ...;   -- recreate indexes
   ` },
   ```
   The runner fails the migration if `PRAGMA foreign_key_check` finds problems.
4. Update the version table in `apps/pos/docs/ARCHITECTURE.md` (§3) and the "Current version" line in `apps/pos/CLAUDE.md`.
5. New settings do **not** need a migration: add a typed default to `DEFAULT_SETTINGS` in `services/index.cjs` (boolean/number/string decide how it is stored).

## Verify
- `npm test` (every suite builds a fresh DB through all migrations).
- Upgrade check from an older database: copy a real/old `innoforge-pos.db` into a temp folder and run
  ```bash
  node -e "const {openDatabase}=require('./electron/db.cjs');const db=openDatabase(process.argv[1]);console.log(db.prepare('PRAGMA user_version').get(), db.prepare('PRAGMA foreign_key_check').all())" /tmp/old/innoforge-pos.db
  ```
  Then open the app with `INNOFORGE_POS_DATA_DIR=/tmp/old npm start` and check the affected screens.
