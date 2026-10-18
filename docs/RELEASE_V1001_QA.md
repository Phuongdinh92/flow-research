# v0.10.1 release verification

Application commit: `f1edb0331099c295fb8ba69804ce11d9c35a70b7`.
Verified URL: https://phuongdinh92.github.io/flow-research/?v=1001#intelligence
GitHub Pages run 39122175805 completed successfully.

## Data and transport

- HBAR: 121 daily cutoff observations / 120 adjacent intervals. Each snapshot ranks the top 1,000 from the completely paginated >=1 million HBAR universe. Latest actual state remains 2026-10-16 23:45:13 UTC.
- 120-day fixed-cohort endpoint coverage has 134 missing accounts below that threshold; exact group nets remain unknown, with conservative signed bounds. A complete ranked snapshot is not complete fixed-cohort history.
- History gzip: 3,544,398 bytes across 15 fragments. Raw receipt bundle: 3,414,528 bytes across 15 fragments. Every fragment is <=240,000 bytes. Whole gzip and decoded hashes are unchanged; splitting removes no rows or precision.
- Browser validates every fragment, assembled gzip, decoded JSON, identity and source schema before display. A clean checkout can reconstruct audit copies with `node pack-data.cjs --materialize`.
- Exchange map: 126 verified CoinGecko capitalizations out of 438 eligible Binance pairs for the archived 1D scope. Remaining pairs remain available in quote-volume mode. No symbol-only identity joins.
- Wallet overview: HBAR, STON, NOT, DOGS with explicit source intervals; no fabricated A1 ASI score. Ethereum graph uses the retained UNI/LINK/AAVE transaction sample, not full-chain flow or proof of common ownership.

## Validation

`node --test test-*.cjs` with the generated canonical HBAR JSON/gzip and receipt gzip temporarily absent: 546 tests, 544 passed, 0 failed, 2 skipped. The two skipped legacy inventory raw-source tests require unavailable original files; the new HBAR receipt replay tests run and pass. No source content was reconstructed to disguise unavailable raw evidence.

Hosted Verify run 39122176073 failed before any job steps executed; it is not reported as a passing CI run. The local gate above and successful Pages deployment were independently observed.

Live browser checks:

- v0.10.1 loaded; 90D and 120D controls enabled, 120D showed 2026-06-18 through 2026-10-16 actual source dates.
- Top1-100 drilldown opened 100 accounts; 7D aggregate net displayed +19.75M HBAR, consistent with exact 19,751,468.23528224 HBAR.
- Unknown totals displayed neutrally; negative bounded changes red, positive bounded changes green.
- HBAR became the default wallet detail after asynchronous loading; explicit choices are preserved by regression tests.
- Holder positive/all filters, EMA50 toggle, taker delta mode, BTC native USD reference mode, LINK 30D selector and transfer graph all responded correctly.
- Exchange capitalization Large filter showed 15 matching pairs; 126 total valid capitalizations were reported separately from source coverage.
- No application errors observed in the sampled console output; browser-extension metadata errors were present.

The screenshot `flow-v1001-holder-verified.jpg` captures the deployed 7D Holder Flow card. No claim of proprietary A1 algorithm equivalence, confirmed whale purchases/retention, or complete BTW/S holder history is made.
