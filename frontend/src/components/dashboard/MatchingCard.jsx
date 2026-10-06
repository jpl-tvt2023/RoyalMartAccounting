import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2 } from 'lucide-react';
import { getMatchingSummary } from '../../api/matching.api';
import { getAutofillSummary } from '../../api/autofill.api';
import { useAuth } from '../../context/AuthContext';
import { PERM } from '../../utils/roles';
import { OUTCOMES } from '../../utils/matchReasons';
import { MODES } from '../../utils/autofillText';
import { formatDateTime } from '../../utils/formatters';

// The Dashboard's matching card (for anyone with "See matching"): how many POs
// are linked, need review or wait for Tally. Each count opens Match review on
// it. With "See auto-fill", a line on what RAMS wrote into ROMS today.
const TONE = { linked: 'text-green-700', review: 'text-amber-700', waiting: 'text-gray-700', not_matched: 'text-blue-700' };

// "Auto-fill: Bill No Automatic · CN No Off — 25 written today, 3 waiting for approval"
function autofillLine(a) {
  const both = (k) => a.fields.po[k] + a.fields.rtv[k];
  const waiting = ['po', 'rtv'].reduce((n, k) => n + (a.fields[k].mode === 'approve' ? a.fields[k].states.checked + a.fields[k].states.to_check : 0), 0);
  const parts = [`${both('written_today')} written today`];
  if (waiting) parts.push(`${waiting} waiting for approval`);
  if (a.fields.po.states.refused + a.fields.rtv.states.refused) parts.push(`${a.fields.po.states.refused + a.fields.rtv.states.refused} refused by ROMS`);
  if (a.fields.po.states.differs + a.fields.rtv.states.differs) parts.push(`${a.fields.po.states.differs + a.fields.rtv.states.differs} need a person`);
  return `Auto-fill: Bill No ${MODES[a.fields.po.mode].label} · CN No ${MODES[a.fields.rtv.mode].label} — ${parts.join(', ')}`;
}

export default function MatchingCard() {
  const { can } = useAuth();
  const canSeeFill = can(PERM.AUTOFILL_VIEW);
  const [summary, setSummary] = useState(null);
  const [autofill, setAutofill] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMatchingSummary()
      .then((s) => { if (!cancelled) setSummary(s); })
      .catch(() => { if (!cancelled) setFailed(true); });
    if (canSeeFill) getAutofillSummary().then((a) => { if (!cancelled) setAutofill(a); }).catch(() => {});
    return () => { cancelled = true; };
  }, [canSeeFill]);

  const open = (outcome) => {
    try {
      sessionStorage.setItem('rams:matchReview.filters:v1', JSON.stringify({ kind: 'po', outcome, reason: '', vendor: '', company_id: '', q: '' }));
    } catch { /* ignore */ }
  };

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4 mt-6" aria-labelledby="matching-card-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="matching-card-heading" className="font-semibold text-brand flex items-center gap-2"><Link2 size={16} /> Matching</h2>
        <Link to="/matching" className="text-sm text-brand hover:underline">Match review</Link>
      </div>
      {failed && <p className="text-sm text-gray-500 mt-2">Matching couldn&apos;t be loaded.</p>}
      {!failed && !summary && <div className="h-10 bg-gray-100 rounded animate-pulse mt-3" />}
      {summary && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            {Object.entries(OUTCOMES).map(([k, o]) => (
              <Link key={k} to="/matching" onClick={() => open(k)} className="rounded-lg border border-gray-100 p-2 hover:bg-gray-50">
                <p className={`text-xl font-bold tabular-nums ${TONE[k]}`}>{summary.counts.po[k].toLocaleString('en-IN')}</p>
                <p className="text-xs text-gray-500">{o.label}</p>
              </Link>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            POs. {summary.last_run ? `Last matched ${formatDateTime(summary.last_run.finished_at || summary.last_run.started_at)}.` : 'Matching hasn’t run yet.'}
            {' '}RTV rows: {summary.counts.rtv.linked} linked, {summary.counts.rtv.review} need review.
          </p>
          {autofill && (
            <p className="text-xs text-gray-600 mt-1">
              <Link to="/matching/autofill" className="hover:underline">{autofillLine(autofill)}</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
