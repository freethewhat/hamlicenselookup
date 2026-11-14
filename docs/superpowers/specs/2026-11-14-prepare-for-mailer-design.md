# Prepare for mailer

**Goal:** send one postcard per household, not one per license.

## What the user sees

- Step 2 ("Who should be on the list?") has a **Prepare for mailer** checkbox with a hint. It is off by default.
- When it is on, step 3 says "212 hams found at 198 addresses". The preview table still shows one row per ham.
- The download is named `hams-mailer-YYYY-MM-DD.csv`.

## The mailer CSV

One row per mailing address:

`Addressee, Street Address, PO Box, City, State, ZIP, County, Call Signs, Count`

- Address fields come from the first license at that address (by last name, then first name). When a line with no street type joins one that has it, the one with the type is printed.
- **Call Signs** lists every call at the address, comma separated. **Count** is the number of licenses.

## Cleanup before printing

Output only. The database keeps the FCC text as is.

- A PO Box that is just the ZIP code is dropped.
- A PO Box typed at the start of the street line ("PO Box 486", "P.O. Box # 486", "BOX 486") moves to the PO Box column. If the PO Box column already holds the same box, it is printed once. A different box is left alone.
- City, state, and ZIP typed at the end of the street line are dropped.
- Spaces are collapsed, stray commas, semicolons, and dashes at the ends are trimmed, and the "Â" left by a UTF-8 non-breaking space is removed. (The loader reads FCC files as Latin-1; fixing that there needs a schema bump and full reload.)

## Which rows share an address

Same street (or PO Box when there is no street), same city, same 5-digit ZIP, after cleanup and standardizing:

- Case, punctuation, and apostrophes are ignored ("St Mary's" = "ST MARYS").
- USPS Publication 28 abbreviations: street types (Lane = Ln, Creek = CK = Crk, Loop = LP), directions (West = W), Saint = St, Mount = Mt, Highway = Hwy.
- Ordinals: "5TH" = "5".
- Unit words are dropped, the unit number is kept: "Apt 209" = "#209" = "209". A different unit, or a unit on one line only, keeps people apart.
- **Missing street type:** "1880 NUTHATCH" joins "1880 NUTHATCH DR" when that is the only line in the same ZIP and city that adds a street type. With two candidates (DR and CT) it stays on its own.

Not handled here: typos ("Nut Hatch", "Caitlin"), the same house under two ZIPs, a city that does not match its ZIP, repeated street text. An address-checking (CASS) tool on the mailing side fixes these.

A row with no street and no PO Box is never grouped.

## Addressee

- Same last name and suffix: "John and Jane Doe", "John, Jane, and Tim Doe".
- Different last names: "John Doe and Jane Smith". Mixed: "John and Jane Doe and Tim Smith".
- A suffix keeps a person separate: "Charles Bloom Jr and Peggy Bloom". Only Jr, Sr, and II to VI count as suffixes. The FCC suffix field also holds numbers and titles ("899", "Mr."); those are dropped.
- Middle initials are dropped.
- Clubs (no personal name) use the entity name.
- The same person twice (same FRN, or same name when there is no FRN) is named once. This happens with "Include expired" on.
- Names keep the FCC's casing. The FCC data is mostly upper case.

## Request

`mailer: true` sits beside `filters` in the `/api/search` and `/api/export` body, not inside it. It changes the output layout, not who matches. Any non-boolean value is a 400. With it on, `/api/search` adds `addressCount`.

## Code

- `src/search/mailer.js`: `addressKey`, `addressee`, `groupByAddress`, `countAddresses`, `MAILER_COLUMNS`.
- The export stays streaming. Rows come ordered by ZIP, so only one ZIP's rows are held in memory.
