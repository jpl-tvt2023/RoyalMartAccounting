import api from './axios';

// Reports (backend controllers/reports.controller.js), worked out from the
// Tally copy at read time. Seeing them is reports.view; credit terms and
// exception days are reports.settings.

const getter = (path) => async (params) => {
  const { data } = await api.get(`/reports/${path}`, { params });
  return data;
};

// { rows, total, page, page_size, totals, vendors, companies, as_of }
export const getInvoices = getter('invoices');
// { rows, total, page, page_size, totals, companies }
export const getNotes = getter('notes');
export const getTransfers = getter('transfers');
// { rows, totals, buckets, as_of, companies, settings }
export const getReceivables = getter('receivables');
// { categories: [{ code, count, rows }], exception_days, as_of, companies }
export const getExceptions = getter('exceptions');
// { settings, terms: [{ vendor, credit_days }] }
export const getReportSettings = getter('settings');

export async function updateReportSettings(body) {
  const { data } = await api.put('/reports/settings', body);
  return data;
}

// credit_days null = the default
export async function updateTerms(vendor, creditDays) {
  const { data } = await api.put(`/reports/terms/${encodeURIComponent(vendor)}`, { credit_days: creditDays });
  return data;
}
