// Help: Auto-fill into ROMS.
export const autoFill = {
  id: 'auto-fill',
  path: '/matching/autofill',
  area: 'Matching',
  title: 'Auto-fill into ROMS',
  who: 'Seeing it: "See auto-fill". Approving, Write now and Try again: "Approve auto-fill". Writing over a different value: "Replace a different value". Switching it on or off: "Switch auto-fill on or off". Admin and Owner can always do all of these.',
  summary: 'Once RAMS has linked a PO to its Tally invoice, it can write the invoice’s number and date into the PO’s Bill No and Bill Date in ROMS, exactly as Tally prints it (607/RM/26-27). For an RTV row linked to its credit note, it writes the Credit Note No and CN Date. Nothing else in ROMS is ever touched. ROMS checks every write with its own rules, refuses one if a person changed the field since RAMS read it, and shows each change in its history as "Tally Sync".',
  flows: [
    {
      title: 'Switch it on safely, one field at a time',
      steps: [
        'Matching → Auto-fill. Each field (Bill No, CN No) has its own mode, and starts Off.',
        'Choose Preview. After the next match, RAMS asks ROMS what would happen and lists it under To write, with ROMS’s answer. Nothing is written.',
        'When the list looks right, choose Ask first. Now nothing is written until someone approves it.',
        'When you trust it, choose Automatic. RAMS writes after every match, without asking. You are asked to confirm.',
        'Do the Bill No first, then the CN No.',
      ],
    },
    {
      title: 'Approve what is waiting (Ask first)',
      steps: [
        'Matching → Auto-fill, field tab, To write.',
        'Check the Change in ROMS column: what ROMS has now → what RAMS will write.',
        'Click Approve all and confirm. RAMS writes them straight away and shows its progress. Or approve rows one by one with Approve; they are written on the next round, or when you click Write now.',
      ],
    },
    {
      title: 'Write now',
      steps: [
        'Write now sends everything that is due at once, instead of waiting for the next match. It shows how far it has got.',
        'You can leave the page: the RAMS Connector carries on with whatever is left.',
      ],
    },
    {
      title: 'A write ROMS refused',
      steps: [
        'Open the Refused by ROMS tab. ROMS’s own words say why, for example the Bill No is already on another PO, or a person changed the field.',
        'Fix the cause in ROMS or in Tally. When the field or the link changes, RAMS tries again by itself.',
        'Or click Try again to send it once more as it is.',
      ],
    },
    {
      title: 'A value that needs a person',
      steps: [
        'Open the Needs a person tab. These are rows where ROMS holds a number that isn’t a way of writing Tally’s, and a person linked the row to the Tally invoice anyway (for example a typo in ROMS).',
        'RAMS never writes over these by itself.',
        'Fix it in ROMS, or, if you may, click Write Tally’s number and confirm. ROMS’s history shows the change with your name. The same button is in the row’s panel on Match review.',
      ],
    },
    {
      title: 'Stop it',
      steps: [
        'Set the field’s mode to Off. Nothing more is sent from the next round on. What was already written stays as it is in ROMS.',
      ],
    },
  ],
  faq: [
    { q: 'Will RAMS overwrite what staff typed?', a: 'Only a number staff typed in another form of the same invoice number, like 607 or 0607 for 607/RM/26-27 (you can turn even that off). Anything else is left for a person. And if staff change a field after RAMS read it, ROMS refuses RAMS’s write.' },
    { q: 'Which Bill Date is written?', a: 'The invoice date in Tally, unless the setting on the Bill No card says to keep a Bill Date staff typed.' },
    { q: 'Why did ROMS refuse a write?', a: 'ROMS checks every write the way it checks a person’s: the PO may be deleted, the RTV row closed, the Bill No already on another PO, or someone changed the field meanwhile. The Refused by ROMS tab gives ROMS’s reason.' },
    { q: 'Where do I see what RAMS changed in ROMS?', a: 'Matching → Auto-fill → Written lists every change, with when and who approved it. In ROMS, each change shows in the PO’s or RTV row’s history as "Tally Sync".' },
    { q: 'How do I stop it straight away?', a: 'Set the field to Off on Matching → Auto-fill. If you need everything stopped, an Admin can also remove ROMS’s integration token.' },
    { q: 'Does auto-fill change Tally?', a: 'No. RAMS only reads Tally.' },
  ],
};
