const operationId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export class OperationStatusError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, {status, code}); }
}
const fail = (status, code, message) => { throw new OperationStatusError(status, code, message); };

/**
 * Only operation identity and outcome are retained here, never form payloads.
 * Call assertOpen/record inside the financial transaction. resolve runs under
 * the same API writer lock and fences a request that has not committed yet.
 */
export function createOperationStatus(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS operation_outcomes (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope TEXT NOT NULL, target TEXT NOT NULL, operation_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('saved','cancelled')),
      budget_id TEXT, revision INTEGER, created_at INTEGER NOT NULL,
      PRIMARY KEY(user_id,scope,target,operation_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS operation_status_limits (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      count INTEGER NOT NULL, resets_at INTEGER NOT NULL
    ) STRICT;
  `);
  const find = (user, scope, target, id) => db.prepare(
    'SELECT state,budget_id,revision FROM operation_outcomes WHERE user_id=? AND scope=? AND target=? AND operation_id=?'
  ).get(user, scope, target, id);
  function assertOpen(user, scope, target, id) {
    if (id && find(user, scope, target, id)?.state === 'cancelled')
      fail(409, 'OPERATION_CLOSED', 'This save was confirmed as not recorded. Review the current records before making a new change.');
  }
  function record(user, scope, target, id, snapshot) {
    if (!id) return;
    assertOpen(user, scope, target, id);
    db.prepare(`INSERT OR IGNORE INTO operation_outcomes
      (user_id,scope,target,operation_id,state,budget_id,revision,created_at)
      VALUES(?,?,?,?,'saved',?,?,?)`).run(user, scope, target, id, snapshot?.id ?? null, snapshot?.revision ?? null, Date.now());
  }
  function legacyResult(user, scope, target, id) {
    if (scope === 'budget-create') {
      const row = db.prepare(`SELECT b.id,b.revision FROM budget_creations c JOIN budgets b ON b.id=c.budget_id
        WHERE c.user_id=? AND c.mutation_id=? AND b.owner_id=?`).get(user, id, user);
      if (row) return row;
    } else if (scope === 'budget-update') {
      const row = db.prepare(`SELECT b.id,m.revision FROM budget_mutations m JOIN budgets b ON b.id=m.budget_id
        WHERE b.owner_id=? AND m.budget_id=? AND m.mutation_id=?`).get(user, target, id);
      if (row) return row;
    } else {
      const row = db.prepare('SELECT response FROM shared_operations WHERE user_id=? AND operation_id=?').get(user, id);
      if (row) return JSON.parse(row.response).snapshot ?? {};
      if (db.prepare('SELECT 1 FROM shared_operation_tombstones WHERE user_id=? AND operation_id=?').get(user, id)) return {};
    }
    return null;
  }
  function project(user, row) {
    const budget = row.budget_id && db.prepare('SELECT id FROM budgets WHERE id=? AND owner_id=?').get(row.budget_id, user);
    return {state: row.state === 'saved' ? 'saved' : 'not_saved',
      ...(budget ? {budgetId: budget.id, revision: row.revision} : {})};
  }
  function resolve(user, body) {
    const {scope, operationId: id} = body;
    const target = body.budgetId ?? '';
    if (!['budget-create', 'budget-update', 'shared'].includes(scope) || !operationId(id) ||
        (scope === 'shared' && !uuid(id)) ||
        (scope === 'budget-update' ? !uuid(target) : target !== '') ||
        ![0, 1].includes(body.protocolVersion))
      fail(400, 'INVALID_OPERATION', 'Choose a valid save to check.');
    // A caller never gains access by supplying somebody else's budget ID.
    if (scope === 'budget-update' && !db.prepare('SELECT 1 FROM budgets WHERE id=? AND owner_id=?').get(target, user) && !find(user, scope, target, id))
      fail(404, 'NOT_FOUND', 'Budget not found.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const now = Date.now();
      db.prepare('DELETE FROM operation_status_limits WHERE resets_at<=?').run(now);
      if ((db.prepare('SELECT count FROM operation_status_limits WHERE user_id=?').get(user)?.count ?? 0) >= 120)
        fail(429, 'RATE_LIMITED', 'Save status was checked too often. Try again shortly.');
      db.prepare(`INSERT INTO operation_status_limits VALUES(?,1,?)
        ON CONFLICT(user_id) DO UPDATE SET count=count+1`).run(user, now + 60000);
      let row = find(user, scope, target, id);
      if (!row) {
        const previous = legacyResult(user, scope, target, id);
        if (previous) { record(user, scope, target, id, previous); row = find(user, scope, target, id); }
      }
      let result;
      if (row) {
        result = project(user, row);
        // An old client may have a receipt outside the old retention window.
        if (row.state === 'cancelled' && body.protocolVersion === 0) result = {state: 'unknown'};
      } else {
        const count = db.prepare("SELECT count(*) AS n FROM operation_outcomes WHERE user_id=? AND state='cancelled'").get(user).n;
        if (count >= 10000) fail(429, 'RATE_LIMITED', 'Too many unresolved save checks. Review the saved records before continuing.');
        db.prepare(`INSERT INTO operation_outcomes VALUES(?,?,?,?,'cancelled',NULL,NULL,?)`).run(user, scope, target, id, now);
        result = {state: body.protocolVersion === 1 ? 'not_saved' : 'unknown'};
      }
      db.exec('COMMIT');
      return {version: 1, ...result};
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return {assertOpen, record, resolve};
}
