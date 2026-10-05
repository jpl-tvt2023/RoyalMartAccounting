// Help: Match review, Matching rules and Party ledgers.
export const matchReview = {
  id: 'match-review',
  path: '/matching',
  area: 'Matching',
  title: 'Match review',
  who: 'Seeing it: "See matching". Confirming, rejecting and picking: "Review links". Match now: "Run matching". Admin and Owner can always do all of these.',
  summary: 'RAMS links every ROMS PO to the Tally sales invoice that billed it, and every RTV row to the Tally credit note that settled it. Each one gets a status, and the reason in plain words.',
  flows: [
    {
      title: 'Understand the four statuses',
      steps: [
        'Linked: RAMS found the Tally voucher, and every check passed. "Auto-fill would write" shows what RAMS will put into ROMS once auto-fill is switched on.',
        'Needs review: RAMS needs a person to decide. The reason says why: for example the Bill No typed in ROMS isn’t the invoice the Buyer’s Order No found.',
        'Waiting for Tally: nothing in Tally yet. Normal for a PO not invoiced yet, or for an invoice the accountant hasn’t entered.',
        'Not matched: left out on purpose. The vendor is set as a stock transfer, or the RTV row is one ROMS takes no CN No for.',
      ],
    },
    {
      title: 'Clear the review queue',
      steps: [
        'Matching → Match review. It opens on Needs review, oldest PO first.',
        'Click a row. The panel explains how RAMS matched it, which checks passed, and every candidate invoice.',
        'If RAMS’s answer is right, click Confirm. RAMS keeps it, whatever the rules say later.',
        'If another invoice is right, click "Use this invoice" on it. If it isn’t listed, search Tally by its number.',
        'If the link is wrong and there is no right invoice yet, click Reject. RAMS never suggests that invoice for this PO again.',
        'Undo takes back your decisions on that row, and RAMS matches it automatically again.',
      ],
    },
    {
      title: 'Find a PO',
      steps: [
        'Type in the search box: the PO, the marketplace PO number, the Bill No, the invoice number, the RTV No or the CN No.',
        'Filter by company, vendor or reason, or click a status tile at the top.',
        'Switch between POs and RTV credit notes with the tabs.',
      ],
    },
    {
      title: 'Match now',
      steps: [
        'Matching runs on its own: every hour in office hours (set in the rules), and soon after Tally changes.',
        'Click Match now to read ROMS again at once, for example after staff typed Bill Nos in ROMS.',
      ],
    },
  ],
  faq: [
    { q: 'Will RAMS change anything in ROMS?', a: 'Not yet. "Auto-fill would write" only shows what it would do. Writing into ROMS is switched on later, one field at a time, after a trial week.' },
    { q: 'Why is a PO "Waiting for Tally" when it was dispatched?', a: 'The accountant hasn’t entered its invoice in Tally yet, or the invoice’s Buyer’s Order No is missing or different. Once the invoice is in Tally, the next match links it.' },
    { q: 'What does "Bill No differs" mean?', a: 'The Buyer’s Order No points at one invoice, but the Bill No typed in ROMS is a different number. Usually a typing mistake in ROMS, or an invoice that was cancelled and re-issued. Pick the right invoice.' },
    { q: 'What is the invoice’s serial?', a: 'The digits in its number: 607 for 607/RM/26-27. Staff often type just that into ROMS; RAMS understands it, and auto-fill writes the whole number.' },
    { q: 'Why "Several credit notes" on an RTV row?', a: 'More than one Tally credit note settles that invoice, so RAMS can’t tell which belongs to this return. Pick the right one.' },
  ],
};

export const matchingRules = {
  id: 'matching-rules',
  path: '/matching/rules',
  area: 'Matching',
  title: 'Matching rules',
  who: 'Seeing them: "See matching". Changing them: "Change matching rules". Admin and Owner always can.',
  summary: 'How RAMS finds the invoice for a PO, which checks it runs on each link, and which vendors and voucher types it matches. Each rule shows how many POs it decides now.',
  flows: [
    {
      title: 'Change a rule safely',
      steps: [
        'Matching → Matching rules → Edit.',
        'Change what you need. Each rule explains itself with an example.',
        'Click Preview the effect. RAMS shows how many POs would change status, with examples, and changes nothing yet.',
        'If that is what you want, click Save and re-match. Otherwise Cancel.',
        'Reset to recommended puts back the rules RAMS started with.',
      ],
    },
    {
      title: 'Choose what a check does',
      steps: [
        'Each check (party ledger, SKUs, quantity, date, one invoice, invoice used once) can be Off, Show a note, or Needs review.',
        'Show a note keeps the PO Linked and shows a warning on it. Needs review holds the PO until a person confirms it.',
      ],
    },
    {
      title: 'Set how each vendor is matched',
      steps: [
        'In Vendors, choose for each marketplace: Match POs to invoices, Stock transfer (not matched yet), or Don’t match.',
        'Flipkart and Amazon start as stock transfers: their ROMS rows carry no Bill No, and the way to link them is still being decided.',
      ],
    },
    {
      title: 'Leave out a voucher type',
      steps: ['In Which vouchers count, untick a Tally voucher type that should never count as an invoice or credit note (for example a type used only for internal transfers).'],
    },
  ],
  faq: [
    { q: 'I changed a rule and a PO I confirmed didn’t move.', a: 'A person’s decision always wins over the rules. Use Undo on that PO to let the rules decide it again.' },
    { q: 'Who can see what I changed?', a: 'Every change is in the Audit Log, and the History button on this page lists them.' },
  ],
};

export const partyLedgers = {
  id: 'party-ledgers',
  path: '/matching/parties',
  area: 'Matching',
  title: 'Party ledgers',
  who: 'Seeing them: "See matching". Mapping them: "Map party ledgers". Admin and Owner always can.',
  summary: 'Tally has a party ledger per marketplace warehouse (BLINK COMMERCE … PUNE, … NAGPUR). Telling RAMS which marketplace each one belongs to lets it catch an invoice billed to the wrong party.',
  flows: [
    {
      title: 'Accept RAMS’s suggestions',
      steps: [
        'Matching → Party ledgers. Ledgers not mapped yet come first.',
        'Suggested: RAMS saw POs of one marketplace linked to invoices billed to that ledger, and shows how many.',
        'Click Accept all suggestions and confirm. Every unmapped ledger with a suggestion takes it.',
      ],
    },
    {
      title: 'Map one ledger by hand',
      steps: [
        'Choose its marketplace in the Maps to list, or Our own registration (another Roymax company), or Not a marketplace.',
        'It saves at once and re-matches. Choose Not set to clear it.',
      ],
    },
  ],
  faq: [
    { q: 'What does "From GSTIN" mean?', a: 'The ledger’s GSTIN carries Roymax’s own PAN, so RAMS knows it is one of our registrations. If that is wrong (a supplier saved with our GSTIN by mistake), fix the GSTIN in Tally, or map the ledger by hand.' },
    { q: 'What happens when a ledger is mapped to another marketplace?', a: 'An invoice billed to it can’t be linked to this marketplace’s PO without a person: the PO goes to Needs review.' },
  ],
};

export const generalFaq = {
  id: 'faq',
  area: 'FAQ',
  title: 'Common questions',
  who: 'Everyone.',
  summary: 'Questions that come up across RAMS.',
  flows: [],
  faq: [
    { q: 'Where does RAMS get its data?', a: 'From Tally, through the RAMS Connector on the office PC, which only reads Tally and never changes it. And from ROMS, which RAMS reads to find the POs and RTV rows.' },
    { q: 'Why can’t I see a page or a button?', a: 'Your role isn’t allowed to use it. An Admin or Owner decides what each role may do on Admin → Roles & permissions.' },
    { q: 'Something looks wrong in RAMS.', a: 'Check the Dashboard first: if the Connector is offline or Tally isn’t answering, RAMS shows the last data it had. Otherwise tell an Admin, with the PO or invoice number.' },
  ],
};
