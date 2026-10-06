// The user guide and FAQ on the Help page, as data: one entry per screen or
// topic. Each entry is { id, path?, area, title, who, summary, flows: [{ title,
// steps }], faq: [{ q, a }] }. `path` ties it to a page, which links here
// with <HelpLink section={id} />. Every page in the top bar must have one
// (utils/__tests__/help.test.js), so a new screen can't ship without its guide.
import { signingIn, dashboard } from './gettingStarted';
import { users, auditLog, tallyCompanies, rolesPermissions } from './admin';
import { matchReview, matchingRules, partyLedgers, generalFaq } from './matching';
import { autoFill } from './autofill';

export const HELP_SECTIONS = [
  signingIn,
  dashboard,
  matchReview,
  matchingRules,
  partyLedgers,
  autoFill,
  tallyCompanies,
  rolesPermissions,
  users,
  auditLog,
  generalFaq,
];

// Lower-case text of a section, for the search box.
export function sectionText(s) {
  return [
    s.title, s.who, s.summary,
    ...s.flows.flatMap((f) => [f.title, ...f.steps]),
    ...s.faq.flatMap((f) => [f.q, f.a]),
  ].join(' ').toLowerCase();
}
