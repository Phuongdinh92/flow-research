# Advanced analysis: source coverage and release evidence

This release adds 120 daily intervals of **native HBAR custody balances**. The
measurement is the balance change of a fixed set of accounts, not verified buys,
beneficial ownership, or the undisclosed A1Radar accumulation model.

## HBAR historical source

| Property | Verified value |
| --- | --- |
| Provider | Hedera public Mirror Node, `/api/v1/balances` |
| Requested latest cutoff | `1792195200.000000000` — 2026-10-17 00:00:00 UTC |
| Daily observations | 121, offsets 0 through 120; no interpolation |
| Daily intervals | 120 |
| Actual oldest source time | 2026-06-18 23:49:27.968770000 UTC |
| Actual latest source time | 2026-10-16 23:45:13.307912891 UTC |
| Source granularity | At or before each UTC cutoff, no more than 900 seconds old |
| Collection completed | 2026-10-18 06:35:12.603 UTC |
| Source filter | Native balance at least 100,000,000,000,000 tinybars = 1,000,000 HBAR |
| Returned rows per observation | 1,582–1,722, all filtered pages exhausted |
| Published normalized pages | 2,060 |
| Displayed rank cohorts | 1–100, 101–200, 201–300, 301–500, 501–1000 |

The collector preserves source integer digits before JSON parsing; calculations
remain exact `BigInt` tinybars until chart projection. It sorts the complete
filtered account universe by balance with deterministic account-ID tie breaking.
Known Council and network-purpose accounts can be excluded using the documented
official list. Those classifications are current and retrospective; this is not
a historical point-in-time trading classification.

A window anchors ranks to its oldest selected observation, then follows those
same accounts. An account disappearing below the source threshold has an unknown
balance bounded by zero and the threshold minus one tinybar. Its balance is never
silently replaced by zero. A complete top-1000 snapshot does not imply every
account in an older fixed cohort remains covered at the latest snapshot.

| Window | Fixed-cohort accounts missing at latest observation, after known-infrastructure exclusion | Exact overall net |
| --- | ---: | --- |
| 1 day | 0 | +8,524,471.70835709 HBAR |
| 7 days | 0 | +19,751,468.23528224 HBAR |
| 30 days | 38 | Unavailable; conservative cohort bounds displayed |
| 90 days | 110 | Unavailable; conservative cohort bounds displayed |
| 120 days | 134 | Unavailable; conservative cohort bounds displayed |

Coverage of intermediate daily changes can differ from endpoint coverage. Each
chart column and cohort is evaluated independently. Missing data are rendered as
missing, rather than flat zero bars or interpolated flows. Price uses separately
identified HBAR/USDT exchange candles with a source close at or before the balance
snapshot; this is not an on-chain USD valuation.

## Original-response audit

The immutable source archive is
`data/source-receipts/hedera-history-20261017-120d.json` in verified compressed
transport. Its custom `.manifest.json` records the original compressed and
decoded hashes and receipt counts. A separate transport manifest may describe
content-addressed parts without changing the original gzip bytes.

- 89 newly collected historical observations retain 1,516 original HTTP 200
  response bodies and their exact SHA-256 hashes.
- 32 reused observations retain their normalized balances, original source URLs,
  source timestamps, collection timestamps and page hashes. Their original raw
  response bodies were not available in this workspace and were not reconstructed.
- One HTTP 502 response from the 89-day cutoff, page 15, is retained separately.
  Exactly one subsequent successful request used that same URL. The failed
  response was received at 06:29:53.761 UTC and the successful request began at
  06:30:51.514 UTC on October 18. No source switch occurred.
- Every retained successful response replays to the published observation and
  its normalized SHA-256. The 121 requested cutoffs are exactly one UTC day apart.

`test-holder-receipts.cjs` verifies every retained body hash, both archive hashes,
all 89 normalization results, the failed response and same-URL recovery, the
32 explicitly unavailable originals, and the 120-interval coverage. Tests support
both local materialized JSON and verified compressed-only publication.

## Rolling collector behavior

`collect_holder_history.cjs` now defaults to **121 daily snapshots**, preserving
120 intervals on subsequent runs. `--days` is a snapshot count, not an interval
count. Reuse matches an observation's absolute requested UTC cutoff and exact
threshold. Only its relative offset label changes when the latest cutoff rolls;
its source timestamp, request/fetch clocks, proof URLs, hashes and balances are
preserved. Future observations are excluded when requesting an earlier cutoff.
An incomplete or failed collection does not replace the last published snapshot.
The collector still stops on source errors; it does not automatically retry the
historical one-off 502 recovery described above.

## Other advanced panels

The exchange overview uses independently documented taker-buy share and signed
taker delta; it is not named or presented as A1Radar's proprietary ASI. Market-cap
and logo joins use explicit provider asset identities, not ambiguous ticker
matches. Native USD cost references and exchange USDT prices remain separate.

The TON overview is limited to available account captures; its shorter elapsed
window is shown explicitly. Ethereum wallet components describe observed transfer
connections in the retained sample, not common ownership or complete market-wide
clusters. Historical BTW/S holder flows, A1Radar's wallet classification, the
undisclosed Smart Bands, and Whale/Shark/LNC formulas are not established by the
available evidence. Their absence must not be filled with synthetic signals.

See `A1_SEVEN_IMAGE_REVIEW.md` and the source-specific methodology documents for
the UI reference inventory and the exact distinction between public measurements
and unknown proprietary models.
