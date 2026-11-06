/* ==========================================================================
   d1-shim.mjs — a tiny stand-in for Cloudflare D1, for automated tests.

   Cloudflare D1 *is* SQLite, so for tests we run the real migration files
   against Node's built-in SQLite engine (node:sqlite, Node 22.5+) and expose
   the same small API the Worker uses:  prepare().bind().first()/all()/run()
   and batch() (which, like D1, runs all statements in ONE transaction).

   This lets us exercise the real Worker code (src/index.js) end-to-end with
   no installs and no network. It does not replace testing on real Cloudflare
   after you deploy, but it checks all of the logic, SQL and data isolation.
   ========================================================================== */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(here, "..", "migrations");

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new Statement(this.db, this.sql, params);
  }
  _isRead() {
    return /^\s*(select|with|pragma)\b/i.test(this.sql);
  }
  _execSync() {
    const stmt = this.db.prepare(this.sql);
    if (this._isRead()) {
      const results = stmt.all(...this.params).map((r) => ({ ...r }));
      return { success: true, results, meta: {} };
    }
    const info = stmt.run(...this.params);
    return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.params);
    if (!row) return null;
    return column ? row[column] : { ...row };
  }
  async all() {
    return this._execSync();
  }
  async run() {
    return this._execSync();
  }
}

/** Creates a fresh in-memory database with every migration applied (in file-name order). */
export function createD1({ migrations = true } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  if (migrations) {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
  }
  return {
    raw: db,
    prepare: (sql) => new Statement(db, sql),
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const out = statements.map((s) => s._execSync());
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };
}
