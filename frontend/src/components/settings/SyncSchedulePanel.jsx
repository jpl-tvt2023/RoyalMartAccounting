import { useEffect, useState } from 'react';
import { Clock, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { HistoryButton } from '../shared/HistoryDrawer';
import { getSyncSchedule, updateSyncSchedule } from '../../api/settings.api';
import { formatDateTime } from '../../utils/formatters';
import { DAYS, describeDays } from '../../utils/syncSchedule';

// When the Connector syncs, set here rather than on the office PC. It picks a
// change up at its next heartbeat, within a minute. (Admin/Owner page.)
const inputCls = 'px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand';

export default function SyncSchedulePanel() {
  const [schedule, setSchedule] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSyncSchedule()
      .then((s) => { if (!cancelled) setSchedule(s); })
      .catch(() => toast.error('Failed to load the sync schedule'));
    return () => { cancelled = true; };
  }, []);

  const toggleDay = (d) => setForm((f) => ({
    ...f, office_days: f.office_days.includes(d) ? f.office_days.filter((x) => x !== d) : [...f.office_days, d],
  }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      setSchedule(await updateSyncSchedule({ ...form, light_every_minutes: Number(form.light_every_minutes) }));
      setForm(null);
      toast.success('Sync schedule saved — the Connector picks it up within a minute');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4 mb-6" aria-labelledby="sync-schedule-heading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="sync-schedule-heading" className="font-semibold text-brand flex items-center gap-2"><Clock size={16} /> Sync schedule</h2>
          {schedule ? (
            <>
              <p className="text-sm text-gray-700 mt-1">
                Office hours <strong>{describeDays(schedule.office_days)}, {schedule.office_start}–{schedule.office_end}</strong>
                {' '}· light sync every <strong>{schedule.light_every_minutes} min</strong>
                {' '}· end-of-day check after <strong>{schedule.heavy_after}</strong>
                {' '}· backfill <strong>{schedule.backfill_in_office_hours ? 'any time' : 'outside office hours'}</strong>
              </p>
              <p className="text-xs text-gray-400 mt-1">
                On the office PC&apos;s clock.{schedule.updated_at ? ` Last changed ${formatDateTime(schedule.updated_at)} by ${schedule.updated_by_name || '—'}.` : ''}
              </p>
            </>
          ) : <div className="h-4 w-80 bg-gray-100 rounded animate-pulse mt-2" />}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <HistoryButton entityType="sync_settings" entityId={1} title="History — Sync schedule" />
          <Button size="sm" variant="outline" disabled={!schedule} onClick={() => setForm({ ...schedule })}>
            <Pencil size={14} /> Edit
          </Button>
        </div>
      </div>

      <Modal isOpen={!!form} onClose={() => setForm(null)} title="Sync schedule">
        {form && (
          <form onSubmit={save} className="space-y-4">
            <fieldset>
              <legend className="block text-sm font-medium text-gray-700 mb-1">Office days</legend>
              <div className="flex flex-wrap gap-3">
                {DAYS.map(([d, label]) => (
                  <label key={d} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={form.office_days.includes(d)} onChange={() => toggleDay(d)} className="w-4 h-4 accent-brand" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-4">
              <div>
                <label htmlFor="office-start" className="block text-sm font-medium text-gray-700 mb-1">Office hours from</label>
                <input id="office-start" type="time" required value={form.office_start} onChange={(e) => setForm((f) => ({ ...f, office_start: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label htmlFor="office-end" className="block text-sm font-medium text-gray-700 mb-1">to</label>
                <input id="office-end" type="time" required value={form.office_end} onChange={(e) => setForm((f) => ({ ...f, office_end: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div>
              <label htmlFor="light-every" className="block text-sm font-medium text-gray-700 mb-1">Light sync every (minutes)</label>
              <input id="light-every" type="number" min={15} max={720} required value={form.light_every_minutes} onChange={(e) => setForm((f) => ({ ...f, light_every_minutes: e.target.value }))} className={`${inputCls} w-32`} />
              <p className="text-xs text-gray-400 mt-1">In office hours only, and Tally is asked for vouchers only when something changed.</p>
            </div>
            <div>
              <label htmlFor="heavy-after" className="block text-sm font-medium text-gray-700 mb-1">End-of-day check after</label>
              <input id="heavy-after" type="time" required value={form.heavy_after} onChange={(e) => setForm((f) => ({ ...f, heavy_after: e.target.value }))} className={inputCls} />
              <p className="text-xs text-gray-400 mt-1">Finds vouchers deleted in Tally. If the PC is off then, it runs at the next start.</p>
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={form.backfill_in_office_hours} onChange={(e) => setForm((f) => ({ ...f, backfill_in_office_hours: e.target.checked }))} className="w-4 h-4 mt-0.5 accent-brand" />
              <span>Allow a backfill or full re-sync during office hours <span className="text-gray-400">(it can slow Tally down while the accountant works)</span></span>
            </label>
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="ghost" type="button" onClick={() => setForm(null)}>Cancel</Button>
              <Button type="submit" loading={saving}>Save</Button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}
