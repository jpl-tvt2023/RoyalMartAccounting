// Help: signing in and the Dashboard.
export const signingIn = {
  id: 'signing-in',
  area: 'Getting started',
  title: 'Signing in',
  who: 'Everyone with a RAMS account. Accounts are made by an Admin or Owner (see Users).',
  summary: 'RAMS has its own accounts, separate from ROMS. Your User ID and first password come from an Admin.',
  flows: [
    {
      title: 'Sign in for the first time',
      steps: [
        'Open RAMS and enter the User ID and the temporary password the Admin gave you.',
        'RAMS asks you to set your own password straight away. Type it twice and save.',
        'The password needs at least 8 characters, with a small letter, a capital letter, a number and a symbol.',
        'You land on the Dashboard. RAMS lets you do nothing else until your own password is set.',
      ],
    },
    {
      title: 'Sign out',
      steps: ['Click the sign-out icon at the top right.'],
    },
  ],
  faq: [
    { q: 'I forgot my password.', a: 'Ask an Admin or Owner to reset it (Users → the key icon). They give you a temporary password, and RAMS asks you to set your own at the next sign-in.' },
    { q: 'Can I change my password myself?', a: 'Not from a menu yet: ask an Admin to reset it, then set your own at the next sign-in.' },
    { q: 'I was signed out on my own.', a: 'That happens when your password or role was changed, or your account was deactivated. Sign in again; if it fails, ask an Admin.' },
  ],
};

export const dashboard = {
  id: 'dashboard',
  path: '/dashboard',
  area: 'Getting started',
  title: 'Dashboard',
  who: 'Everyone. The Matching card shows to anyone allowed to see matching.',
  summary: 'The Dashboard shows whether Tally is syncing into RAMS, and how far matching has got.',
  flows: [
    {
      title: 'Read the Tally sync card',
      steps: [
        '"Connector online" means the RAMS Connector on the office PC checked in within the last 3 minutes.',
        '"Tally answering" means TallyPrime is open on that PC and replying.',
        'Each company shows where it stands: Up to date, Changes waiting (the next check picks them up), or Backfilling.',
        'A yellow Educational-mode warning means Tally is running without its licence: tell the person who looks after Tally.',
      ],
    },
    {
      title: 'Read the Matching card',
      steps: [
        'Linked: POs whose Tally invoice RAMS found.',
        'Needs review: POs a person has to decide. Click it to open them in Match review.',
        'Waiting for Tally: nothing in Tally yet, which is normal until the accountant enters the invoice.',
        'The Auto-fill line (if you may see auto-fill) says each field’s mode and what RAMS wrote into ROMS today. Click it to open Matching → Auto-fill.',
      ],
    },
  ],
  faq: [
    { q: 'Why does the Connector show offline?', a: 'The office PC is off or asleep, or the Connector is not running on it. Nothing is lost: when it comes back it catches up with everything that changed in Tally.' },
    { q: 'How fresh is the data?', a: 'In office hours RAMS checks Tally every hour (the timing is on Admin → Tally companies). Changes made in Tally show after the next check; deletions show after the end-of-day check.' },
  ],
};
