# How Tally works for Roymax / Royal Mart: a plain-English guide

This guide explains Tally in plain English. It also records what Phase 0 found when RAMS read the office's Tally data and the ROMS test database on 4 Oct 2026. Both reads cover **8 Jun 2026 (ROMS go-live) to 4 Oct 2026**, and nothing was written to either system.

> The rupee amounts in the Dr/Cr examples are made up. Every count is real.

## 1. The big picture: two systems, two jobs

|                      | ROMS (your app)                     | Tally (the accountant's software)       |
| -------------------- | ----------------------------------- | --------------------------------------- |
| **Tracks**           | Orders: POs, dispatch, GRN, returns | Money and tax: invoices, payments, GST  |
| **Who uses it**      | Ops staff                           | The accountant                          |
| **Holds money?**     | No                                  | Yes                                     |
| **Since 8 Jun 2026** | 850 live POs, 228 RTV rows          | 3,826 vouchers across 3 companies       |

Think of ROMS as the **warehouse register** and Tally as the **cash book plus tax file**. The same real-world event, such as shipping a Blinkit order, shows up in both. RAMS exists to connect the two automatically.

The link between them is the **marketplace PO number**, which the accountant types into each sales invoice (section 8).

## 2. A "company" in Tally = one GST registration

Tally keeps a separate set of books for each "company". Roymax Products LLP is one business legally, but it has a GST registration (GSTIN) in each state where it keeps or sells stock. Each GSTIN gets its own Tally company:

| Tally company        | GSTIN             | Books start | Vouchers since 8 Jun 2026 | What's in it                                                   |
| -------------------- | ----------------- | ----------- | ------------------------- | -------------------------------------------------------------- |
| Roymax (Maharashtra) | `27ABGFR0562B1ZI` | Apr 2022    | 3,774                     | Nearly everything: all quick-commerce sales, purchases, payments, credit notes |
| Roymax (Haryana)     | `06ABGFR0562B1ZM` | Apr 2025    | 26                        | Stock received from MH, B2C sales to Flipkart, journals        |
| Roymax (West Bengal) | `19ABGFR0562B1ZF` | Apr 2025    | 26                        | Same pattern as Haryana                                        |

The office has more companies (Karnataka, Telangana, UP, Delhi, two for Maruti Enterprises and a few unnamed ones), but they need logins we don't have. Only these three can be read.

> **Tip:** the middle part of every GSTIN, `ABGFR0562B`, is Roymax's PAN. Same PAN means the same legal business. RAMS uses this to spot "we're sending goods to ourselves". Two supplier ledgers break this rule (section 10).

The financial year runs 1 April to 31 March, so "FY 2026-27" means Apr 2026 to Mar 2027.

## 3. The building blocks

### Ledger = one account page

Picture a notebook where every person, bank or type of income/expense has its own page. Maharashtra has 820 ledgers. Some real ones:

- **BLINK COMMERCE PVT LTD (NAGPUR N1)**: what one Blinkit warehouse owes you. Every marketplace warehouse has its own ledger, so one marketplace is many ledgers.
- **ZEPTO PRIVATE LIMITED ( CHENNAI ) - Super Store**: the same idea for a Zepto warehouse
- **HDFC Bank**: money in the bank
- **Sales** ledgers: your income
- **Output IGST**: GST you've collected and owe the government

### Group = a folder of ledgers

- **Sundry Debtors**: customers who owe you. MH sorts them into sub-folders by platform, such as **Instamart**, **Flipkart Minutes**, **BLINK COMMERCE PVT LTD -HARYANA**, **Marketplace** and **WHOLESALER**.
- **Sundry Creditors**: suppliers you owe
- **Branch / Divisions**: Roymax's own registrations in other states (used in HR and WB)
- **Bank Accounts**, **Sales Accounts**, **Purchase Accounts**, **Duties & Taxes** (GST)

### Stock Item = a product (or anything else kept in stock)

Stock item names are **not** ROMS SKU codes. None of MH's 353 stock items is named after a SKU. A sales item's name usually contains the marketplace's own product code, for example:

```
RMWB003001 ITEM CODE-10192283 PID-611318
```

RAMS turns that code into a SKU through ROMS's vendor mapping (section 13). The list also holds things Roymax buys rather than sells, such as `1TB SEAGATE SATA HARD DISK`. Of the 353 items, 149 were used on vouchers since 8 Jun 2026, and 127 appear on MH sales.

### Voucher = one transaction

Every entry the accountant makes is a voucher, like one bill or one receipt slip.

## 4. Double entry, explained like UPI

Every transaction moves value from somewhere to somewhere, so it always touches at least two ledgers.

- **Debit (Dr):** where value goes **to**
- **Credit (Cr):** where value comes **from**

The two sides always add up to the same amount.

**Example: Blinkit pays you ₹50,000**

| Side | Ledger    | Amount  | Effect                |
| ---- | --------- | ------- | --------------------- |
| Dr   | HDFC Bank | ₹50,000 | Bank balance goes up  |
| Cr   | Blinkit   | ₹50,000 | Blinkit owes you less |

**Example: you sell to Blinkit for ₹1,00,000 + 18% GST**

| Side | Ledger     | Amount    | Effect                               |
| ---- | ---------- | --------- | ------------------------------------ |
| Dr   | Blinkit    | ₹1,18,000 | They now owe you this                |
| Cr   | Sales      | ₹1,00,000 | Your income                          |
| Cr   | Output GST | ₹18,000   | Tax you collected for the government |

## 5. The voucher types you'll see

| Voucher type    | Plain meaning                     | Royal Mart example                                   | In MH since 8 Jun 2026 |
| --------------- | --------------------------------- | ---------------------------------------------------- | ---------------------- |
| **Sales**       | A tax invoice you raise           | Invoice to Zepto for a dispatched PO                 | 868, plus 8 "B2c Sales" |
| **Purchase**    | A bill from your supplier         | Bill from the manufacturer for stock                 | 263                    |
| **Receipt**     | Money coming in                   | Blinkit's payment hits the bank                      | 357                    |
| **Payment**     | Money going out                   | Paying a transporter                                 | 801                    |
| **Journal**     | Adjustments with no cash          | TDS, a marketplace commission or deduction           | 1,024                  |
| **Credit Note** | Reducing what a customer owes     | Goods returned (RTV), or a short-supply adjustment   | 404                    |
| **Debit Note**  | Reducing what you owe a supplier  | Sending faulty stock back to a fabric supplier       | 7, all to suppliers    |
| **Contra**      | Bank ↔ cash transfers             | Withdrawing cash                                     | 42                     |

**B2c Sales** is a custom type built on Sales, used for sales to consumers. HR and WB use it for their Flipkart sales.

When Blinkit or Instamart raises a "DN" for a GRN shortfall, that is **their** document. It does not appear in Tally as a Debit Note (section 8, step 4).

The **Day Book** is Tally's list of every voucher on a given day.

## 6. How Tally numbers vouchers

Each voucher type keeps its own number series, separately in each company.

- **MH sales invoices** look like `607/RM/26-27`: serial / RM / financial year. 868 of 876 MH sales use this format. The other 8 are B2c Sales with plain numbers.
- **Everything else is a plain number**: Payment `553`, Credit Note `569`, Journal `1423`, Receipt `226`.
- **HR and WB** use plain numbers for everything, sales included (`3`, `4`).

Because the series are separate, the same number turns up many times. `607` is a sales invoice (`607/RM/26-27`) and also Payment 607. `783` exists as a Journal, a Payment and a Credit Note. Sales 4 to 8 exist in HR, MH and WB.

**A number only identifies a voucher together with its company and voucher type.** That's why RAMS matches on the PO number and compares Bill No only with MH **sales** invoices.

## 7. GST in one minute

- **Same state** (MH registration → a Blinkit warehouse in Maharashtra): CGST + SGST, e.g. 9% + 9%
- **Different state** (MH → a warehouse in Karnataka): IGST, e.g. 18%

That's why Tally has separate GST ledgers.

## 8. Following one Blinkit order through both systems

1. **Blinkit sends a PO** → ROMS records it (PO no. like `43886110046397`).
2. **You dispatch the goods** → the accountant makes a **Sales** voucher in MH:
   - The invoice number looks like `607/RM/26-27`. ROMS's **Bill No** is the serial before the first `/`, so staff type `607` (sometimes zero-padded, as in `0601`). For example, ROMS PO B002 has Bill No `607`, and Tally has Sales `607/RM/26-27` dated 1 Jul 2026. This holds for 610 of 611 linked POs. The one miss (S292: `1819` typed for invoice 1219) is a typo.
   - The marketplace PO number goes in the invoice's **Buyer's Order No** (Order Details). 827 of 876 MH sales carry one. **This is the link between the two systems.**
   - The lines use stock items whose names carry the marketplace's product code (section 3).
3. **Blinkit's warehouse receives the goods (GRN)** → ROMS records the GRN quantity.
4. **Short or damaged?** → Blinkit raises a discrepancy / debit note (e.g. `D67697DN26037145`) → ROMS stores that number. **Tally doesn't record it.** Of the 194 discrepancy numbers in ROMS, 186 appear nowhere in Tally. The other 8 match PO numbers on sales invoices, so they look like PO numbers typed into the wrong field.
5. **Blinkit pays** → a **Receipt** voucher, plus journals for TDS and marketplace deductions, matched "bill-wise" to the invoice (section 11).
6. **Return to vendor (RTV)** → a **Credit Note** in MH. The CN gets its own plain number (e.g. `835`) and points back bill-wise to the original invoice ("Agst Ref `607/RM/26-27`"). 390 of 404 MH credit notes do this. In ROMS, the CN number is empty on all 228 RTV rows. 87 of those rows have exactly one CN against their invoice, so RAMS could fill them in.

## 9. ROMS vendors in Tally

This shows which MH ledgers each ROMS vendor's POs land on, and how many POs link to a sales invoice by Buyer's Order No.

| ROMS vendor  | MH ledgers (examples)                                                                                  | Live POs | Linked to a sales invoice            |
| ------------ | ------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------ |
| **Blinkit**  | BLINK COMMERCE PVT LTD (NAGPUR N1), (LUCKNOW L4), (BENGALURU B5)                                       | 108      | 101 (93.5%)                          |
| **Minutes**  | Flipkart India Private Limited - Gurgaon / - Bengaluru (group *Flipkart Minutes*)                      | 102      | 102 (100%)                           |
| **Now**      | COCOBLU RETAIL LIMITED- AMAZON - CHENNAI / -HYD                                                        | 54       | 50 (92.6%)                           |
| **Scootsy**  | *Instamart* group: Cloud Kart Ventures, Moksh Enterprises, PJTJ Technologies, Jupiter Kart, Cloudstore Retail (each name ends in a warehouse code such as `CHCPO`) | 414      | 315 (76.1%)                          |
| **Zepto**    | ZEPTO PRIVATE LIMITED ( CHENNAI ) - Super Store                                                        | 130      | 41 (31.5%); 106 (81.5%) with the suffix removed |
| **Amazon**   | none: these are stock transfers (section 10)                                                           | 16       | 0                                    |
| **Flipkart** | none: these are stock transfers (section 10)                                                           | 26       | 0                                    |

Things to know when matching:

- **Zepto suffixes:** ROMS stores Zepto POs as `P4588464- Dry` or `P4851183- SS`, while Tally has just `P4588464`. Removing the suffix raises Zepto links from 41 to 106.
- **Two POs in one field:** a few ROMS POs hold two numbers, e.g. `48287510036332/48287510052160`.
- **Split dispatch:** 8 POs are spread across two sales invoices.
- **September isn't fully entered in Tally yet.** It has 648 vouchers against about 1,150 in a normal month, and the copy's last voucher is dated 1 Oct 2026. Most of what is still unlinked is September POs, so this is expected and not a matching problem.

## 10. Stock transfers (Amazon / Flipkart)

To sell through Amazon or Flipkart warehouses in another state, Roymax first moves its own stock from one registration to another, e.g. MH → HR. It's the same business (same PAN), so it isn't real income. GST law still treats it as a supply between two registrations, so a tax invoice is raised. **RAMS must not count these as sales to customers.**

What the data shows:

- **ROMS:** 16 Amazon (`FBA…`) and 26 Flipkart POs since 8 Jun 2026. None has a Bill No, and none of their PO numbers appears anywhere in Tally. Today they can't be linked to an invoice.
- **MH → branches:** MH invoices its own branches as Sales, 3 each to *ROYMAX PRODUCTS LLP ( HARYANA )* and *( KOLKATA )* (e.g. `598/RM/26-27` and `599/RM/26-27`).
- **HR and WB:** each books the other side as a Purchase from *ROYMAX PRODUCTS LLP ( MUMBAI )*, in the Branch / Divisions group. Each then sells to Flipkart as **B2c Sales** (6 each) with no PO number on the invoice.
- **Not to be confused with Minutes and Now:** those are real sales to the marketplace's buying company, and they link normally (section 9).

> **PAN rule exception:** two MH supplier ledgers, **U.N. INTERNATIONAL** (69 purchases) and **RONAK FIRE INDUSTRIES**, carry Roymax's own GSTIN. A same-PAN check wrongly marks them as internal. Either the GSTIN gets fixed in Tally, or RAMS keeps an exceptions list.

## 11. Bill-wise details = your "who still owes me" list

When an invoice is booked with bill-wise tracking, Tally remembers it as an **open bill** (a "New Ref"). Each payment, journal or credit note is applied against specific bills (an "Agst Ref"). Whatever isn't settled is **outstanding**, i.e. your receivables.

- **MH:** 864 of 876 sales open a bill, so outstanding per invoice can be worked out. Bills get settled by receipts (127 of 357 apply against specific bills), journals (603 of 1,024 touch bills, mostly TDS and deductions) and credit notes (390 of 404).
- **HR and WB:** only 1 of 6 (HR) and 0 of 6 (WB) sales open a bill, so outstanding per invoice can't be worked out there.

## 12. "Edit Log" edition, and the copy on your PC

The office runs **TallyPrime Edit Log**, which records every change to every voucher, so entries can't be quietly altered. When we opened the copy on your PC, Tally "migrated" each company to regular TallyPrime. That only affected the copy.

The copy runs TallyPrime 7.1 in **Educational mode**, where the only dates you can use are the 1st, 2nd and 31st of a month. Any other date is quietly changed, in exports too. RAMS works around this by widening each period it asks for and then dropping vouchers that fall outside it.

## 13. Phase 0: the answers

| Question | Answer |
| --- | --- |
| Does ROMS Bill No = Tally's invoice number? | **Yes**, it's the part before the first `/` (`607` ← `607/RM/26-27`). This holds for 610 of 611 linked POs; the one miss is a typo. |
| Do Tally numbers contain `/`, which ROMS rejects? | **Yes**, on 868 of 876 MH sales. Staff drop everything after the `/` today. ROMS will now accept `/` (section 14). |
| Is the PO number always in Buyer's Order No? | **Almost**: 827 of 876 MH sales have it. It finds 609 of 850 live POs, and more once Zepto suffixes are removed. Most of the rest are September POs (not entered yet) or Amazon/Flipkart transfers. |
| Where do credit note numbers live, and whose number is it? | On the Tally CN's own voucher number (plain, e.g. `835`), which points bill-wise to the invoice. That is Roymax's number. We found no field holding the marketplace's own return number. |
| Where do debit note / discrepancy numbers live? | **Nowhere in Tally.** All 7 Tally debit notes are to suppliers, so marketplace discrepancy numbers are only kept in ROMS. |
| Do SKU codes match stock item names? | **No** (0 of 353). Item names carry the marketplace's product code (Blinkit item code, ASIN, FSN), and ROMS's vendor mapping turns that into the SKU. 122 of 127 MH sales items map, and 98% of linked invoice lines match their PO on SKU and quantity. |
| Can Amazon/Flipkart POs be linked? | **Not today.** ROMS has no Bill No for them, and their PO numbers aren't in Tally. |

## 14. Decisions taken (4 Oct 2026)

- **RAMS copies Tally's format exactly.** When RAMS fills Bill No, it will write `607/RM/26-27`, replacing the typed `607`. ROMS's rule for Bill No, CN and DN numbers (letters, digits and `-` only) must be widened to allow `/`. That change goes in the ROMS repo and **hasn't been made yet**.
- **Unlinked September POs are expected.** September 2026 sales and purchases haven't been fully entered in Tally yet.
- **SKUs are matched through ROMS vendor mapping**: the marketplace product code in the item name → ROMS's Internal Product ID (the SKU). RAMS doesn't read a SKU out of the item name, because the naming isn't consistent.

## 15. Still open

- **Which CN number should ROMS store:** Roymax's number from Tally, or the marketplace's?
- **A possible duplicate SKU:** ROMS has both `RMBLBLUBND002` and `RMBLUBLBND002`.
- **Unmapped items:** 5 of the 127 MH sales items don't map to a SKU yet.
- **Wrong GSTINs:** U.N. INTERNATIONAL and RONAK FIRE INDUSTRIES carry Roymax's GSTIN. Fix them in Tally, or keep an exceptions list?
- **No bill-wise tracking in HR/WB:** outstanding per invoice can't be worked out there.
- **Other companies:** only 3 of the office's companies can be read. The rest need logins.

## Glossary

| Term                      | Meaning                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| **GSTIN**                 | 15-character GST registration number (state code + PAN + check digits)        |
| **PAN**                   | Business tax ID; the same across all of Roymax's GSTINs                       |
| **Ledger**                | One account page                                                              |
| **Group**                 | A folder of ledgers                                                           |
| **Stock item**            | A product or other item Tally keeps stock of; not the same as a ROMS SKU      |
| **SKU**                   | ROMS's product code (`products.sku_code`), e.g. `LM006`                       |
| **Vendor Product ID**     | The marketplace's code for a product (Blinkit item code, ASIN, FSN)           |
| **Voucher**               | One transaction entry                                                         |
| **B2c Sales**             | Custom Sales voucher type for sales to consumers                              |
| **Bill No (ROMS)**        | The invoice serial staff type into ROMS, e.g. `607` for `607/RM/26-27`        |
| **Buyer's Order No**      | The field on a Tally invoice that holds the marketplace PO number             |
| **Dr / Cr**               | Debit (value goes to) / Credit (value comes from)                             |
| **Debtor / Creditor**     | Owes you / you owe them                                                       |
| **New Ref / Agst Ref**    | Bill-wise tags: opening a new bill / settling an existing one                 |
| **GRN**                   | Goods Receipt Note: the buyer confirming what arrived                         |
| **RTV**                   | Return to Vendor: the buyer sending goods back                                |
| **CN / DN**               | Credit Note / Debit Note                                                      |
| **Outstanding**           | Unpaid bills                                                                  |
| **FY**                    | Financial year, April to March                                                |
