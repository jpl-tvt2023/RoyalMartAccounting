// Stores what a run found, writing only what changed since the last run:
// match_results (one row per PO / RTV row), the engine's own links in
// doc_links (people's confirmed / rejected rows are never touched), and the
// party-ledger suggestions and GSTIN-found internal ledgers.
const BATCH = 400;
const RESULT_COLS = ['po_id', 'outcome', 'reason', 'method', 'vendor', 'company_id', 'voucher_guid', 'voucher_number', 'voucher_date', 'detail', 'fill'];
const norm = (v) => (v == null || v === '' ? null : String(v));

async function writeBatches(client, stmts) {
  for (let i = 0; i < stmts.length; i += BATCH) await client.batch(stmts.slice(i, i + BATCH), 'write');
}

const asRow = (r) => ({
  ...r,
  detail: JSON.stringify(r.detail || {}),
  fill: r.fill ? JSON.stringify(r.fill) : null,
});

async function writeResults(client, out, runId) {
  const stmts = [];

  // ---- results
  const { rows: stored } = await client.execute(`SELECT target_kind, target_id, ${RESULT_COLS.join(', ')} FROM match_results`);
  const before = new Map(stored.map((r) => [`${r.target_kind}|${r.target_id}`, r]));
  const seen = new Set();
  let changed = 0;
  for (const result of out.results) {
    const r = asRow(result);
    const k = `${r.target_kind}|${r.target_id}`;
    seen.add(k);
    const old = before.get(k);
    if (old && RESULT_COLS.every((c) => norm(old[c]) === norm(r[c]))) continue;
    changed += 1;
    stmts.push({
      sql: `INSERT INTO match_results (target_kind, target_id, ${RESULT_COLS.join(', ')}, outcome_since, run_id, updated_at)
            VALUES (?, ?, ${RESULT_COLS.map(() => '?').join(', ')}, datetime('now'), ?, datetime('now'))
            ON CONFLICT(target_kind, target_id) DO UPDATE SET
              ${RESULT_COLS.map((c) => `${c} = excluded.${c}`).join(', ')},
              outcome_since = CASE WHEN match_results.outcome = excluded.outcome THEN match_results.outcome_since ELSE excluded.outcome_since END,
              run_id = excluded.run_id, updated_at = excluded.updated_at`,
      args: [r.target_kind, r.target_id, ...RESULT_COLS.map((c) => r[c] ?? null), runId],
    });
  }
  const gone = [...before.keys()].filter((k) => !seen.has(k));
  for (const k of gone) {
    const [kind, ...id] = k.split('|');
    stmts.push({ sql: 'DELETE FROM match_results WHERE target_kind = ? AND target_id = ?', args: [kind, id.join('|')] });
  }

  // ---- links: the engine owns the 'auto' rows only
  const { rows: links } = await client.execute('SELECT id, target_kind, target_id, company_id, voucher_guid, status, method FROM doc_links');
  const linkKey = (l) => `${l.target_kind}|${l.target_id}|${Number(l.company_id)}|${l.voucher_guid}`;
  const existing = new Map(links.map((l) => [linkKey(l), l]));
  const wanted = new Map(out.links.filter((l) => l.method !== 'person').map((l) => [linkKey(l), l]));
  let linksAdded = 0;
  let linksRemoved = 0;
  for (const [k, l] of wanted) {
    const old = existing.get(k);
    if (old && (old.status !== 'auto' || old.method === l.method)) continue;
    if (!old) linksAdded += 1;
    stmts.push({
      sql: `INSERT INTO doc_links (target_kind, target_id, role, company_id, voucher_guid, method, status, run_id)
            VALUES (?, ?, ?, ?, ?, ?, 'auto', ?)
            ON CONFLICT(target_kind, target_id, company_id, voucher_guid) DO UPDATE SET
              method = excluded.method, run_id = excluded.run_id, updated_at = datetime('now')
            WHERE doc_links.status = 'auto'`,
      args: [l.target_kind, l.target_id, l.role, l.company_id, l.voucher_guid, l.method, runId],
    });
  }
  for (const [k, l] of existing) {
    if (l.status === 'auto' && !wanted.has(k)) {
      linksRemoved += 1;
      stmts.push({ sql: "DELETE FROM doc_links WHERE id = ? AND status = 'auto'", args: [l.id] });
    }
  }

  // ---- party ledgers: suggestions, and our own registrations found by GSTIN
  const { rows: parties } = await client.execute('SELECT company_id, ledger_guid, kind, source, suggested_vendor, suggested_votes FROM party_ledgers');
  const partyKey = (p) => `${Number(p.company_id)}|${p.ledger_guid}`;
  const partyRows = new Map(parties.map((p) => [partyKey(p), p]));
  const suggested = new Map(out.suggestions.map((s) => [partyKey(s), s]));
  const internal = new Set(out.internal.map(partyKey));
  for (const [k, s] of suggested) {
    const old = partyRows.get(k);
    if (old && old.suggested_vendor === s.vendor && Number(old.suggested_votes) === s.votes) continue;
    stmts.push({
      sql: `INSERT INTO party_ledgers (company_id, ledger_guid, suggested_vendor, suggested_votes) VALUES (?, ?, ?, ?)
            ON CONFLICT(company_id, ledger_guid) DO UPDATE SET suggested_vendor = excluded.suggested_vendor, suggested_votes = excluded.suggested_votes`,
      args: [s.company_id, s.ledger_guid, s.vendor, s.votes],
    });
  }
  for (const [k, p] of partyRows) {
    if (!suggested.has(k) && (p.suggested_vendor || Number(p.suggested_votes))) {
      stmts.push({ sql: 'UPDATE party_ledgers SET suggested_vendor = NULL, suggested_votes = 0 WHERE company_id = ? AND ledger_guid = ?', args: [p.company_id, p.ledger_guid] });
    }
  }
  for (const k of internal) {
    const old = partyRows.get(k);
    if (old && (old.source === 'person' || old.source === 'gstin')) continue;
    const [companyId, ...guid] = k.split('|');
    stmts.push({
      sql: `INSERT INTO party_ledgers (company_id, ledger_guid, kind, source) VALUES (?, ?, 'internal', 'gstin')
            ON CONFLICT(company_id, ledger_guid) DO UPDATE SET kind = 'internal', source = 'gstin' WHERE party_ledgers.source IS NULL`,
      args: [Number(companyId), guid.join('|')],
    });
  }
  for (const [k, p] of partyRows) {
    if (p.source === 'gstin' && !internal.has(k)) {
      stmts.push({ sql: "UPDATE party_ledgers SET kind = NULL, source = NULL WHERE company_id = ? AND ledger_guid = ? AND source = 'gstin'", args: [p.company_id, p.ledger_guid] });
    }
  }

  await writeBatches(client, stmts);
  return { results_changed: changed, results_removed: gone.length, links_added: linksAdded, links_removed: linksRemoved };
}

module.exports = { writeResults };
