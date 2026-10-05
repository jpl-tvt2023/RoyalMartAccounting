// What an accountant does to the mock Tally's books, for the sync tests. Each
// change moves the company's counters the way Tally's do: every voucher
// change (create, alter, delete) takes the next AltVchId, every master change
// the next AltMstId.
//
//   const books = editBooks(buildDataset());
//   books.alter('MH', guid, { narration: 'edited' })
//   books.add('MH', invoiceLikeVoucher)       books.remove('MH', guid)
//   books.renameLedger('MH', 'Old', 'New')    books.restoreOlderBackup('MH')
function editBooks(dataset) {
  const company = (code) => {
    const c = dataset.companies.find((x) => x.code === code);
    if (!c) throw new Error(`No mock company ${code}`);
    return c;
  };
  const voucher = (c, guid) => {
    const v = c.vouchers.find((x) => x.guid === guid);
    if (!v) throw new Error(`No voucher ${guid} in ${c.code}`);
    return v;
  };
  let seq = 900;

  return {
    dataset,
    company,
    alter(code, guid, changes = {}) {
      const c = company(code);
      const v = voucher(c, guid);
      Object.assign(v, changes);
      c.altVchId += 1;
      v.alterId = c.altVchId;
      return v;
    },
    add(code, v) {
      const c = company(code);
      seq += 1;
      c.altVchId += 1;
      const added = { ...v, guid: v.guid || `${code.toLowerCase()}-added-${seq}`, masterId: seq, alterId: c.altVchId };
      c.vouchers.push(added);
      return added;
    },
    remove(code, guid) {
      const c = company(code);
      voucher(c, guid);
      c.vouchers = c.vouchers.filter((x) => x.guid !== guid);
      c.altVchId += 1;
    },
    renameLedger(code, from, to) {
      const c = company(code);
      const ledger = c.ledgers.find((l) => l.name === from);
      if (!ledger) throw new Error(`No ledger ${from} in ${code}`);
      c.altMstId += 1;
      // A company's own ledger object, so the rename stays in this company.
      c.ledgers = c.ledgers.map((l) => (l === ledger ? { ...l, name: to, alterId: c.altMstId } : l));
      // Tally exports vouchers with the ledger's current name -- without
      // changing their AlterIDs, which is why RAMS must re-pull them.
      for (const v of c.vouchers) {
        if (v.party === from) v.party = to;
        for (const l of v.ledgerLines) if (l.ledger === from) l.ledger = to;
      }
    },
    // A backup restored over the books: the counters go back, and the newest
    // voucher is gone.
    restoreOlderBackup(code) {
      const c = company(code);
      const newest = [...c.vouchers].sort((a, b) => b.alterId - a.alterId)[0];
      c.vouchers = c.vouchers.filter((x) => x !== newest);
      c.altVchId -= 5;
      c.altMstId -= 1;
    },
  };
}

module.exports = { editBooks };
