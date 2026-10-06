# How RAMS works

*Royal Mart Accounts (RAMS), explained without the technical words. Last updated 6 October 2026.*

---

## 1. RAMS in one paragraph

Royal Mart keeps its **accounts in Tally** and its **marketplace orders in ROMS** (the Royal Mart portal). Until now, the two never spoke to each other. Someone had to read an invoice number in Tally and type it into ROMS, and nobody could easily see which order had been invoiced, paid or credited.

**RAMS is the bridge between them.** It reads the books from Tally, matches each ROMS order to the Tally invoice that billed it, and each return to the credit note that settled it. With your permission, it then writes Tally's invoice and credit-note numbers into ROMS. It also shows what every marketplace owes.

```
   TALLY                      RAMS                         ROMS
 (the accounts)          (the bridge)                (the orders portal)
                                                         
 Sales invoices   ──►  copy of Tally's books   ◄──  POs, RTV rows
 Credit notes          matches orders to             (read only)
 Receipts              invoices and returns            
 Journals              to credit notes        ──►  Bill No + Bill Date,
                       reports & exceptions        CN No + CN Date
   (only read)                                     (only these, only if
                                                    you switch it on)
```

## 2. The three systems

| | What it is | Who uses it | What RAMS does with it |
|---|---|---|---|
| **Tally** | The accounts: invoices, credit notes, receipts, journals | The accountant | **Only reads it.** RAMS can never change anything in Tally. |
| **ROMS** | The orders portal: marketplace POs, dispatch (Builty), GRN, returns (RTV) | Operations staff | Reads the orders and returns. Writes only two pairs of fields, and only when switched on. |
| **RAMS** | The bridge, plus the accounts screens | Accounts team, owners | Its own website: `royalmartaccounting.vercel.app` |

## 3. What RAMS will never do

- **It never changes Tally.** Every request it makes to Tally is "export" (read). There is no way for it to write.
- **It never deletes anything in ROMS.**
- **It writes only four fields in ROMS:**
  - the **Bill No** and **Bill Date** of an order
  - the **Credit Note No** and **CN Date** of a return

  It writes them only after someone switches auto-fill on.
- **It never overwrites what a person typed**, unless it is the same number written differently (for example `607` for `607/RM/26-27`).
- **It never writes over a field someone changed at the same moment.** ROMS checks that the field still holds what RAMS last saw, and refuses otherwise.
- **Every change it makes is recorded in ROMS's own history as "Tally Sync",** and in RAMS's Auto-fill log with the name of whoever approved it.

## 4. How the data travels

**The Connector** is a small program on the office PC where Tally runs.
- It reads Tally over Tally's own connection, the same one Tally uses for its reports.
- It sends the books to RAMS over a secure (HTTPS) connection, using a private key that only RAMS accepts.

**When it reads Tally:**
- **Every minute:** it tells RAMS it's alive, and whether Tally is open.
- **Every hour, in office hours** (Mon–Sat, 09:00–19:00; changeable in RAMS): it fetches only what changed in Tally since the last time. That takes seconds.
- **Once after office hours:** a full check, which also catches anything deleted in Tally.
- **On demand:** anyone allowed can press **Sync now** in RAMS.

**If the office PC or Tally is off,** nothing is lost. RAMS keeps showing the last data it had, and **Sync health** says so. When the PC comes back, the Connector catches up with everything that changed.

**After each sync, RAMS matches again,** and then auto-fill writes what's due (if it is switched on).

## 5. What RAMS reads from Tally

RAMS keeps a copy of the books of **MH, HR and WB** from **8 June 2026** (when ROMS went live) onwards. Other companies in Tally are ignored, and an Admin chooses which companies are synced.

### Company

| In Tally | Why RAMS needs it |
|---|---|
| Company name and state | To tell MH, HR and WB apart |
| Books beginning from | To know where the books start |
| Tally's internal change counters | To fetch only what changed since last time |
| Company GSTIN (from its vouchers) | To recognise sales to our own other registrations (stock transfers) |

### Ledgers and groups

| In Tally | Why RAMS needs it |
|---|---|
| Ledger name, alias and group (for example *Sundry Debtors*, *Sales Accounts*, *Duties & Taxes*) | To know which ledgers are customers, which are sales and which are GST |
| Ledger GSTIN and state | To tell which marketplace a party ledger belongs to, and which ledgers are Roymax's own registrations |
| Bill-wise on/off | To know whether Tally tracks a party's invoices one by one |

### Stock items and voucher types

| In Tally | Why RAMS needs it |
|---|---|
| Stock item name, alias, unit, HSN | The marketplace's item code inside the item name is how RAMS checks that an invoice is for the products the PO ordered |
| Voucher type name and its parent | To know that "Sales - Zepto" is a kind of Sales, and so on |

### Vouchers (every voucher type)

| In Tally | Why RAMS needs it |
|---|---|
| Date, voucher type, **voucher number** | The invoice or credit note number that goes into ROMS (for example `607/RM/26-27`) |
| **Order details → Buyer's Order No** | **The main link to ROMS:** the marketplace PO number typed on the invoice finds the ROMS order |
| Party ledger, party GSTIN | Which customer and marketplace the invoice is for |
| Reference no and date | The supplier's invoice number, on purchases |
| Narration (first 300 characters) | Shown when explaining a voucher |
| Cancelled / optional flags | Cancelled and optional vouchers are ignored |
| Total amount | Invoiced value |
| Ledger lines (ledger, amount, debit or credit) | Taxable value, GST, and TDS on journals |
| **Bill-wise details** (New Ref / Agst Ref / On Account, bill name, amount) | **What settled each invoice:** a receipt, credit note or TDS journal entered "Agst Ref" against it. A credit note's Agst Ref also tells RAMS which invoice, and so which order, a return belongs to. |
| Item lines: stock item, quantity, rate, amount, godown, order no | The product and quantity checks |
| Change counter and unique ID | So an edited voucher replaces the old copy, and a deleted one is noticed |

**What RAMS does not keep:** Tally sends addresses, e-way bill details and the GST breakdown along with each voucher. RAMS discards them.

## 6. What RAMS reads from ROMS

ROMS gives RAMS a read-only view. Nothing here is changed by reading it.

| In ROMS | Why RAMS needs it |
|---|---|
| **Order (PO):** PO number, vendor, marketplace PO no, PO date, status, party, city, dispatch date | To find the Tally invoice for each order |
| **Bill No and Bill Date** (Builty page) | A second way to find the invoice, and what auto-fill may update |
| GRN status, date, quantity, discrepancy | To know which orders came back or were short (the RTV page) |
| **PO lines:** item code, quantity, SKU | The product and quantity checks |
| **RTV rows:** RTV no, status, DN no, **CN No and CN Date** | To find the Tally credit note for each return |
| Products and marketplace item codes | To turn a marketplace item code into a Royal Mart SKU |

## 7. How matching works

For every ROMS order, RAMS looks for the Tally invoice:

1. **By the Buyer's Order No.** The marketplace PO number typed on the Tally invoice, for example `P4588464`, finds the order with that marketplace PO number. RAMS also understands:
   - Zepto's habit of adding a label: `P4588464- Dry` is read as `P4588464`
   - two PO numbers in one field
2. **Else by the Bill No typed in ROMS.** Staff often type just the serial, so `607` or `0607` finds invoice `607/RM/26-27`. If the same serial exists in two companies, the Bill Date and the financial year decide.
3. **For returns,** the credit note that settles the order's invoice (its *Agst Ref* in Tally), or the CN No typed on the RTV row.

**Then it checks each link.** Each check can be switched off, shown as a note, or made to stop the link for a person:
- Is the invoice billed to the right marketplace's ledger?
- Does it share a product with the PO?
- Is the quantity no more than the PO?
- Is it dated after the PO?
- Is the same invoice linked to another PO?

**Every order and return gets one status, with the reason in plain words:**

| Status | Meaning |
|---|---|
| **Linked** | Found, and every check passed |
| **Needs review** | A person should decide, for example when the Bill No typed in ROMS isn't the invoice the Buyer's Order No found |
| **Waiting for Tally** | Not in Tally yet. This is normal until the accountant enters the invoice. |
| **Not matched** | Left out on purpose (Flipkart and Amazon stock transfers, for now) |

**A person's decision always wins.** On *Match review*, anyone allowed can confirm a link, pick a different invoice, or reject one. RAMS remembers that, whatever the rules say later.

## 8. Results on Royal Mart's real data

Checked on the real books (MH, HR, WB) and the ROMS test copy, October 2026:

| | Linked | Needs review | Waiting for Tally | Not matched |
|---|---|---|---|---|
| **Orders (850, not counting deleted ones)** | **687** | 3 | 118 | 42 (Flipkart, Amazon) |
| **Returns (228)** | **96** | 18 | 100 | 14 |

- Of the 687 linked orders, 681 have a Bill No in ROMS that is a short form of Tally's number (like `607`). 6 have none. Auto-fill would write the full number into all 687.
- A trial run (ROMS was asked "what would happen", and nothing was written) said ROMS would accept all **783** writes: 687 Bill Nos and 96 CN Nos.
- 23 orders have a Bill Date in ROMS that differs from Tally's invoice date, usually by a day. By default auto-fill uses Tally's date, and this can be changed.

## 9. Auto-fill: writing Tally's numbers into ROMS

**Each field (Bill No, CN No) has its own switch**, on *Matching → Auto-fill*:

| Mode | What happens |
|---|---|
| **Off** | Nothing is sent to ROMS. This is the starting point. |
| **Preview** | RAMS asks ROMS what *would* happen and lists it. Nothing is written. |
| **Ask first** | Like Preview, then a person approves (all at once, or row by row) and RAMS writes |
| **Automatic** | RAMS writes after every match |

**The recommended path:** a week on Preview, then Ask first, then Automatic. Bill No first, then CN No.

**What is written:**
- a blank field gets Tally's number
- a short form (`607`) becomes the full number (`607/RM/26-27`)

**What is never written automatically:** a number that is *not* a form of Tally's. Those are listed under *Needs a person*; staff fix them in ROMS, or an Admin writes Tally's number deliberately.

**To stop it:** set the field to Off. It stops at once.

## 10. The accounts screens

| Screen | What it shows |
|---|---|
| **Invoices** | Every sales invoice since 8 June: marketplace, PO, taxable value, GST, received, credit notes, TDS, outstanding, and days overdue |
| **Credit & debit notes** | Each note, the invoice it settles, the order and the return |
| **Stock transfers** | Sales between Roymax's own registrations, kept out of what customers owe |
| **Receivables** | What each marketplace owes, per company or all together; how old it is (0–30, 31–60, 61–90, 90+ days); credit terms |
| **Exceptions** | Everything that needs a person, and where to fix it |
| **Sync health** | Whether the Connector and Tally are working, and every sync |

Every list can be filtered by company or shown for all companies together, and downloaded for Excel.

**One thing the receivables already show:** several marketplaces pay into a *head-office* ledger "On Account", not against the warehouse-ledger invoices. Their invoices therefore look unpaid in Tally's bill-wise view. RAMS shows that money separately, and a *net outstanding* that takes it off. Setting those receipts against invoices in Tally will make the invoice-level picture exact.

## 11. Who can do what

There are four roles. **Admin and Owner can always do everything**, and they decide what the other two may do, on *Admin → Roles & permissions*.

| | Accountant (starting setup) | Viewer (starting setup) |
|---|---|---|
| See matching, auto-fill and reports | ✓ | ✓ |
| Run matching, confirm or reject links, map ledgers, change matching rules | ✓ | – |
| Approve auto-fill writes | ✓ | – |
| Change credit terms, press Sync now | ✓ | – |
| Switch auto-fill modes, write over a different value in ROMS | – (Admin/Owner) | – |
| Users, Audit Log, Roles & permissions | Never: Admin/Owner only | Never |

Every change anyone makes in RAMS is recorded in the **Audit Log**, with who made it and when.

## 12. What you can change yourselves (no programmer needed)

- **Which Tally companies sync, and the office hours**
- **Every matching rule and check**, with a preview of the effect before saving
- **Each vendor's handling:** match it, treat it as a stock transfer, or ignore it
- **Which party ledger belongs to which marketplace**
- **Auto-fill:** each field's mode, whether to rewrite short forms, and which Bill Date to keep
- **Credit days** per marketplace, and when something counts as an exception
- **What Accountants and Viewers may do**

## 13. Safety and privacy

- **Tally:** read only.
- **ROMS:** read, plus four fields that can only be written when switched on. Each write is checked by ROMS's own rules and recorded in its history.
- **Passwords** are stored scrambled (hashed), never as text.
- **Sessions** expire, and a password reset or role change signs that person out.
- **The Connector and ROMS** each use a private key. The key can be withdrawn at any time, which stops the connection.
- **The data** is held in a database in **Mumbai**. The website is set to run in Mumbai too, which also makes it faster.
- **Every change** in RAMS is in the Audit Log; every change in ROMS is in ROMS's history.

## 14. Progress and next steps

| Step | What | State |
|---|---|---|
| Discovery | Read the real books; proved the Buyer's Order No links orders to invoices | Done |
| 1 | ROMS: accepts Tally's number format, and the safe connection for RAMS | Done (switched off in production until go-live) |
| 2 | The RAMS website: sign-in, users, audit log | Done |
| 3–4 | The Connector and the copy of Tally's books | Done, live on the test setup |
| 5 | Matching, with review screens and rules | Done, live on the test setup |
| 6 | Auto-fill into ROMS | Done, being tried on the test setup |
| 7 | The accounts screens (invoices, receivables, exceptions, sync health) | Built; to be reviewed |
| 8 | Go-live: production database, Connector installed on the office PC, the trial weeks | Prepared (see *go-live.md*); needs the office PC and your go-ahead |

**Still to be decided:** how to link Flipkart and Amazon stock transfers to their ROMS rows.

## 15. Words used

| Word | Meaning |
|---|---|
| **PO** | A marketplace purchase order, as recorded in ROMS (for example B002) |
| **Marketplace PO no** | The marketplace's own number for the order (for example P4588464) |
| **Buyer's Order No** | The field on a Tally invoice (Order details) where the marketplace PO number is typed |
| **Bill No** | The invoice number, as recorded in ROMS on the Builty page |
| **RTV** | Return to vendor: goods a marketplace sent back, or was short |
| **CN / DN** | Credit note / debit note |
| **Agst Ref** | Tally's "against reference": which invoice a payment or credit note settles |
| **On Account** | Money entered in Tally without saying which invoice it is for |
| **Connector** | The small RAMS program on the office PC that reads Tally |
| **Sync** | The Connector bringing RAMS's copy of Tally up to date |
| **Auto-fill** | RAMS writing Tally's numbers into ROMS |
| **Test setup** | A copy of RAMS and ROMS used for trying things, separate from the real ones |
