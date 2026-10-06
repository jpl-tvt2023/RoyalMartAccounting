// Help: the Reports screens -- Invoices, Credit & debit notes, Stock
// transfers, Receivables, Exceptions and Sync health.
const SEE = 'Seeing it: "See the reports". Admin and Owner always can.';

export const invoicesHelp = {
  id: 'invoices',
  path: '/reports/invoices',
  area: 'Reports',
  title: 'Invoices',
  who: SEE,
  summary: 'Every Tally sales invoice since RAMS started (8 June 2026), with its marketplace and PO, what settled it and what is still owed. RAMS works the figures out from Tally each time the page opens, so they are as fresh as the last sync.',
  flows: [
    {
      title: 'Find what is owed',
      steps: [
        'Reports → Invoices. Choose a company, or All companies for the consolidated view.',
        'Click Overdue to see invoices past their credit days, or Open for everything still owed.',
        'Sort by Most outstanding or Most overdue to see the biggest first.',
        'Each row shows the total, what was received, credit notes plus TDS and adjustments, and what is still outstanding.',
      ],
    },
    {
      title: 'Find invoices with no PO',
      steps: [
        'Click the No PO tab. These invoices aren’t linked to a ROMS PO.',
        'Usually the Buyer’s Order No is missing on the invoice in Tally. Once it is added and Tally syncs, the next match links it.',
      ],
    },
    {
      title: 'Download it',
      steps: ['Click Download CSV. It downloads every invoice the filters show, not just this page, for Excel.'],
    },
  ],
  faq: [
    { q: 'How does RAMS know an invoice is paid?', a: 'From Tally’s bill-wise details. A receipt, credit note or journal entered "Agst Ref" against the invoice’s bill settles it. Money entered On Account isn’t set against any invoice, so the invoice stays open; Receivables shows that money apart.' },
    { q: 'What decides the marketplace?', a: 'The PO RAMS linked the invoice to. Without one, the party ledger’s mapping on Party ledgers, or RAMS’s suggestion for it.' },
    { q: 'When is an invoice overdue?', a: 'When it is still owed after its marketplace’s credit days, counted from the invoice date. Credit days are set on Receivables.' },
    { q: 'Why does an invoice say "Not bill-wise"?', a: 'Its party ledger isn’t kept bill-wise in Tally, so Tally has no bill to settle and RAMS can’t tell what is owed on it.' },
    { q: 'An invoice shows "over"?', a: 'More was set against it in Tally than its total, usually a rounding difference or a receipt allocated to the wrong bill.' },
  ],
};

export const notesHelp = {
  id: 'credit-debit-notes',
  path: '/reports/notes',
  area: 'Reports',
  title: 'Credit & debit notes',
  who: SEE,
  summary: 'Each Tally credit note and debit note, the invoice it settles (its Agst Ref in Tally), that invoice’s PO, and the RTV row RAMS linked it to, with whether its number is in ROMS yet.',
  flows: [
    {
      title: 'Check a return’s credit note',
      steps: [
        'Reports → Credit & debit notes, Credit notes tab.',
        'Search by the RTV No, the PO or the CN number.',
        'The row shows the invoice it settles and the RTV row; under it, whether auto-fill has put the CN No into ROMS.',
      ],
    },
  ],
  faq: [
    { q: 'A note says "(before RAMS)".', a: 'It settles an invoice dated before RAMS started, so that invoice isn’t in RAMS.' },
    { q: 'Why does a debit note have no PO?', a: 'Tally’s debit notes are almost all for suppliers. Marketplace shortfalls are recorded on ROMS’s GRN page, not as debit notes in Tally.' },
  ],
};

export const transfersHelp = {
  id: 'stock-transfers',
  path: '/reports/transfers',
  area: 'Reports',
  title: 'Stock transfers',
  who: SEE,
  summary: 'Sales from one Roymax registration to another, for example MH to HR. They move our own stock, so they stay out of receivables.',
  flows: [
    {
      title: 'Mark a ledger as our own registration',
      steps: [
        'Most are found by themselves: the ledger’s GSTIN carries Roymax’s PAN.',
        'For any other, Matching → Party ledgers, and choose Our own registration for that ledger.',
      ],
    },
  ],
  faq: [
    { q: 'Are Flipkart and Amazon here?', a: 'Their stock goes out as transfers, but how to link those to ROMS’s Flipkart and Amazon rows is still to be decided.' },
  ],
};

export const receivablesHelp = {
  id: 'receivables',
  path: '/reports/receivables',
  area: 'Reports',
  title: 'Receivables',
  who: `${SEE} Changing credit terms: "Change credit terms".`,
  summary: 'What each marketplace owes, per company: invoiced, received, credit notes, TDS and adjustments, outstanding, overdue, and how old it is (0–30, 31–60, 61–90, 90+ days since the invoice). Stock transfers are left out.',
  flows: [
    {
      title: 'Read it',
      steps: [
        'Reports → Receivables. Choose a company, or All companies for the consolidated figures.',
        'Outstanding is what invoices still owe. Received on account is money a marketplace paid that Tally holds without setting it against an invoice.',
        'Net outstanding = Outstanding − Received on account: what the marketplace really still owes.',
        'Download CSV gives the same table for Excel.',
      ],
    },
    {
      title: 'Set credit terms',
      steps: [
        'Under Credit terms, type a marketplace’s credit days and click away to save. Leave it empty to use the default.',
        'Change the default, and how many days before an invoice with no PO or an RTV row with no credit note becomes an exception.',
        'Every change is recorded; the History button shows them.',
      ],
    },
  ],
  faq: [
    { q: 'Why is so much under "Not known"?', a: 'Marketplaces often pay into a head-office ledger (for example "Blinkit Commerce Pvt Ltd") rather than the warehouse ledger the invoices use. Map that ledger to its marketplace on Matching → Party ledgers and its money moves to the right row.' },
    { q: 'Why does a marketplace show nothing received?', a: 'Its receipts are entered On Account in Tally, not against invoices. They show as Received on account, and Net outstanding takes them off. Setting them against invoices in Tally makes the invoice-level figures right too.' },
    { q: 'What about bills from before RAMS started?', a: 'RAMS holds Tally from 8 June 2026. Older invoices, and payments against them, aren’t counted here.' },
  ],
};

export const exceptionsHelp = {
  id: 'exceptions',
  path: '/reports/exceptions',
  area: 'Reports',
  title: 'Exceptions',
  who: SEE,
  summary: 'Everything that needs a person, by kind, each saying where it is fixed. Fixed items drop off by themselves after the next match.',
  flows: [
    {
      title: 'Work through them',
      steps: [
        'Reports → Exceptions. Each kind shows how many there are; click one to see them.',
        'Follow the link to where it is fixed: Match review, Auto-fill or Invoices.',
        'The kinds: a Bill No or CN No in ROMS that Tally doesn’t have; a Tally invoice with no PO; ROMS and Tally disagreeing; more than one possible invoice or credit note; an RTV row with no credit note yet; and an auto-fill ROMS refused.',
      ],
    },
  ],
  faq: [
    { q: 'How long before an invoice with no PO counts?', a: 'The exception days set on Receivables (15 to begin with), counted from the invoice date. For an RTV row, from the GRN date.' },
  ],
};

export const syncHealthHelp = {
  id: 'sync-health',
  path: '/sync',
  area: 'Reports',
  title: 'Sync health',
  who: 'Everyone sees it. Sync now: "Sync now". Admin and Owner always can.',
  summary: 'Whether the RAMS Connector on the office PC is checking in, whether Tally answers, where each company stands, and every sync run with its errors.',
  flows: [
    {
      title: 'Bring a company up to date now',
      steps: [
        'Reports → Sync health.',
        'Click Sync now on the company, or Sync all now.',
        'The Connector picks it up at its next check-in (within a minute or two) and syncs the changes from Tally, even outside office hours. The run appears under Sync runs.',
      ],
    },
    {
      title: 'Find out why data looks old',
      steps: [
        'Connector offline: the office PC is off or asleep, or the Connector isn’t running there.',
        'Tally not answering: TallyPrime isn’t open on that PC.',
        'Not open in Tally: that company isn’t loaded in Tally. Open it.',
        'A failed run shows its error. The Connector tries again at its next check-in.',
      ],
    },
  ],
  faq: [
    { q: 'Does Sync now change anything in Tally?', a: 'No. The Connector only ever reads Tally.' },
  ],
};
