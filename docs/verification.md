# Real-data verification (2026-11-13)

Run against the full FCC data set (weekly file dated 2026-11-08). No personal data appears here: call signs and aggregates only.

## 1. Full load

`DATA_DIR=./data node scripts/update.js weekly` (all states, download included)

| Item | Result |
| --- | --- |
| Exit code | 0 |
| Licenses loaded | 1,700,423 (822,153 active) |
| Wall time | 72 s, including the ~198 MB download |
| Peak RSS | 549 MB (limit 1.5 GB) |
| licenses.db size | about 650 MB (after the daily patch) |

`/usr/bin/time` is not installed on the dev box, so peak RSS was read from `ru_maxrss` of the child process.

## 2. HS.dat present

`unzip -l l_amat.zip` lists `counts, AM.dat, CO.dat, EN.dat, HD.dat, HS.dat, LA.dat, SC.dat, SF.dat`. HS.dat is 189 MB, so the application-history file the first-license rule needs is available.

## 3. First-license spot-check

Method: the FCC ULS site (`wireless2.fcc.gov`) answers automated requests with HTTP 403 (Akamai), so the sample was verified from our own data instead. For each sampled row: full HS event history in date order, AM `prev_call`/`prev_class`, and whether any other license shares its FRN or its last name + street + ZIP with an earlier grant.

Sample: `node scripts/sample-first-licenses.js --state MT --n 20` (20 first-license rows from the last 12 months, plus 10 upgrade rows).

First-license rows (20):

| Result | Count |
| --- | --- |
| History is exactly one SYSGRT and one LIISS on the same day, no prev call, no prev class, no earlier license on the same FRN | 20 |
| Also had a later LICAN (cancelled within weeks) | 2 |
| Also shares name/address with another license (all later grants, i.e. household members) | 3 |
| Clearly a renewal, upgrade or vanity change | 0 |

One row (an Extra-class license on a short call sign) has no earlier history under any FRN or address. It could be a returning ham under a different name, which the spec accepts as a false positive. It is not a rule error.

Verdict: 0 of 20 clearly wrong. The threshold (more than 2 of 20) is not reached, so `classifyLicense` is unchanged.

Upgrade rows (10 sampled): all have an AM `prev_class` lower than the current class, so none is a first license (none has a `first_license_date`). Four also carry a `prev_call` (vanity or call change together with a class change), and one is a record from a previously cancelled call that was upgraded and re-issued under a new call. These are correctly labelled upgrades.

Note: call signs are not unique in licenses.db (about 85,000 are held by more than one record, because FCC reissues calls). Any manual lookup must go by `usid`, not call sign.

Nationwide aggregates over `first_license_date` in the last 12 months:

| Measure | Value |
| --- | --- |
| Rows with a first-license date | 23,179 (20,830 active) |
| Class T / G / E / blank | 20,851 / 1,756 / 323 / 249 |
| Rows where `grant_date` differs from `first_license_date` | 0 |
| Rows with a VANGRT event | 0 |
| Rows with an earlier license on the same FRN | 0 |
| Rows with an earlier license on the same last name + street + ZIP | 568 (2.5%), mostly households, some returning hams |
| Rows with an upgrade date in the last 12 months | 23,351 (21,149 active) |

## 4. Daily update

Bug found and fixed first: FCC's Sunday daily zip contains only `counts` (no changes that day), and `applyDaily` failed with "Daily zip is missing EN.dat", which aborted the whole run. A counts-only zip is now treated as nothing to apply (test added in `tests/db/apply-daily.test.js`).

After the fix, `node scripts/update.js daily` exited 0 in 3.6 s with 138 MB peak RSS: `applied 4 file(s): 2026-11-10, 2026-11-11, 2026-11-12, 2026-11-13`. The Fri/Sat/Sun files from the prior week were older than the weekly and skipped. `/api/meta` moved `dataAsOf` from 2026-11-08 to 2026-11-13, and `licenseCount` from 1,700,423 to 1,700,495.

## 5. Performance

Server on port 3198, requests timed from a Node client (loopback), one cold and one repeat run each. All 254 Texas counties and all 58 California counties.

Default filters = active, individuals only, first license in the last 12 months. Worst case = no date filter, expired and clubs included, upgrades on.

| Area | Filters | Matches | /api/search | /api/export (size) |
| --- | --- | --- | --- | --- |
| Texas | default | 1,738 | 0.43 s | 0.42 s (0.3 MB) |
| Texas | worst case | 119,211 | 0.32 s | 1.22 s (19.4 MB) |
| California | default | 2,536 | 0.30 s | 0.31 s (0.5 MB) |
| California | worst case | 231,127 | 0.14 s | 1.90 s (38.2 MB) |

Every request is under the 5 s target, so no new index or `json_each` batching was needed.
