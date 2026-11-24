// D1 schema, created automatically on first use.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, address TEXT, expires INTEGER)`,
  `CREATE TABLE IF NOT EXISTS agents (
     id TEXT PRIMARY KEY, owner TEXT, name TEXT, strategy TEXT, market TEXT, mode TEXT, hl_network TEXT,
     params TEXT, book TEXT, status TEXT, created_at INTEGER, last_run_at INTEGER, next_run_at INTEGER,
     backtest TEXT, start_cash REAL, equity REAL, return_pct REAL, hold_pct REAL, hold_price REAL,
     trades INTEGER DEFAULT 0, last_price REAL, vault TEXT, source_id TEXT, err TEXT)`,
  `CREATE INDEX IF NOT EXISTS agents_owner ON agents(owner)`,
  `CREATE INDEX IF NOT EXISTS agents_next ON agents(status, next_run_at)`,
  `CREATE TABLE IF NOT EXISTS decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT, at INTEGER, action TEXT, price REAL, reason TEXT, equity REAL, tx TEXT)`,
  `CREATE INDEX IF NOT EXISTS decisions_agent ON decisions(agent_id, at)`,
  `CREATE INDEX IF NOT EXISTS decisions_at ON decisions(at)`,
  `CREATE TABLE IF NOT EXISTS equity (agent_id TEXT, t INTEGER, eq REAL, hold REAL, PRIMARY KEY (agent_id, t))`,
  `CREATE TABLE IF NOT EXISTS newsletter (email TEXT PRIMARY KEY, at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS swaps (tx TEXT, idx INTEGER, block INTEGER, at INTEGER, buy INTEGER, usd REAL, fee INTEGER, PRIMARY KEY (tx, idx))`,
  `CREATE INDEX IF NOT EXISTS swaps_at ON swaps(at)`,
  `CREATE TABLE IF NOT EXISTS lp_log (id INTEGER PRIMARY KEY AUTOINCREMENT, vault TEXT, at INTEGER, action TEXT, reason TEXT, tx TEXT)`,
  `CREATE INDEX IF NOT EXISTS lp_log_vault ON lp_log(vault, at)`,
  `CREATE TABLE IF NOT EXISTS payroll_log (id INTEGER PRIMARY KEY AUTOINCREMENT, payroll TEXT, at INTEGER, tx TEXT, note TEXT)`,
  `CREATE TABLE IF NOT EXISTS hl_keys (owner TEXT, network TEXT, agent_address TEXT, enc TEXT, created INTEGER, PRIMARY KEY (owner, network))`,
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, at INTEGER)`,
];

let ready = false;
export async function ensureSchema(env) {
  if (ready || !env.DB) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  ready = true;
}

export const all = async (env, sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results || [];
export const one = async (env, sql, ...a) => (await env.DB.prepare(sql).bind(...a).first()) || null;
export const run = (env, sql, ...a) => env.DB.prepare(sql).bind(...a).run();

export async function kvGet(env, k) {
  const r = await one(env, 'SELECT v FROM kv WHERE k = ?', k);
  return r ? JSON.parse(r.v) : null;
}
export const kvSet = (env, k, v) => run(env, 'INSERT INTO kv (k, v, at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, at = excluded.at', k, JSON.stringify(v), Date.now());
