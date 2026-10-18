# Review of the seven screenshots supplied on 2026-10-18

Evidence: the seven images embedded in the user's message, viewed directly. Local attachment paths were reported missing; no claim is made that those local files were opened. The images show five distinct chart families, with two Smart Bands assets and two ASI cap filters. Values below are observations of dated screenshots, not current market measurements.

## Visible specification and implementation boundary

| Family | Visible behavior to implement | Quantitative inputs still required |
| --- | --- | --- |
| Smart Bands — S and BTW | Candlesticks, colored volume bars, five named valuation lines (Realized, Balance, Delta, Undervalue, Diamond), EMA50/200, right-edge labels, legend controls and a shared time axis. | Token-specific valuation histories and explicit equations for the five bands. The repo has native-network Coin Metrics Realized for ten supported assets and price EMAs; that does not provide A1's four other bands or coverage for S/BTW. Do not fit constant multipliers to screenshot spacing. |
| Money Flow Index — S | Price line on the right USD axis, columns on a separate left axis (approximately 0–2.18), event colors/markers: MFI Spike, Momentum Spike, Ignition Money Flow, Money Flow Blaze, Shark Action, Whale Action, LNC; visible Whale Action Price label accompanied by the number 6 (its exact meaning is unverified). | Definition/units of the flow series; thresholds, baselines and priority of each event; evidence for shark/whale classification and the meaning of LNC. This is not established as the standard technical MFI oscillator on a 0–100 scale. The repo's descriptive volume/pressure events are a different model. |
| Holder Flow Index — BTW | Signed stacked net-change bars across Top 1–100, 101–200, 201–300, 301–500, 501–1000 with a separate yellow USD price line; All Flow/Accumulation/Distribution controls; time navigator; activity-share summary for 7D/30D/90D/120D. | Historical token balances, exact cohort membership through time, exclusion labels, same-token supply/prices and a defined activity-share denominator. Rank cohorts are not token-age cohorts. Balance changes do not by themselves prove buying or retaining the same purchased lot. |
| Clustering Wallets — BTW | Green accumulation/red distribution columns and independent yellow price axis,1D/7D/30D selector, time navigator, group counts, net balance and percentage spread. | Address/event histories, deterministic cluster rules and inspectable relationships; complete declared observation scope. The repo's repeated recipients do not establish common ownership or coordinated wallets. |
| Accumulation Strength Index — large and mid cap | Logo scatter, cap-filter tabs, Strength View/Net Flow View, top-ten strip and four KPI cards. Large-cap X axis has log-spaced labels $1B / $10B / $100B / $1T / $10T; strength Y axis is 0–1. This is different from packed price-return bubbles. | Strategic-trader selection, historical membership, qualified transactions/holdings, exact score and normalization, aggregation and cap boundaries. Older documentation's 0–100 scale cannot silently replace this screenshot's 0–1. Current Binance taker flow does not identify these traders. |

## Numeric checks that constrain an honest implementation

- **ASI**, dated 15/10/2026: 398 tracked tokens, 54 positive 24h flow, accumulated 24h $1.33M and 2,840 active traders. These are A1's reported scope, not the repo's coverage or independently verified totals. The screenshot alone does not establish whether the accumulated card sums positive flows or another quantity.
- **Holder BTW**, 7D selected: net +13.73M BTW; Top 1–100 displays +13.81M and 98.8%; 101–200 displays −81.03K and 1.2%. Absolute displayed net amounts imply approximately 99.42% / 0.58%, so Activity Share cannot safely be implemented as each group's absolute net divided by total absolute net. The discrepancy may involve gross activity or another denominator; that remains unknown.
- **Cluster BTW**, 1D selected: approximately +9.63K accumulation and −3K distribution produce +6.63K net. Shares near 76.2% / 23.8% and spread +52.5% are arithmetically consistent with the rounded amounts. This supports that illustrative ratio, not the proprietary process that decides cluster membership or which events count.
- Both **S** panels show update date 13/10/2026, but Smart Bands labels about $0.0651 and the MFI panel labels $0.05647. Exact observation time and selected/latest-price meaning are absent. A date-only label is insufficient to require those two values to match.

## Practical sequence

1. Finish and verify the separately named exchange-flow view, including identical archive cutoffs between overview totals and token charts.
2. Build a complete holder-cohort chart on an asset with proven historical balances; expose population, rank-reassignment policy, exclusions and gaps before broadening tokens.
3. Complete a bounded transfer/trade inventory and validate cluster edges. Keep inference and observed balance/trade data distinct.
4. Define a versioned independent accumulation model with inspectable contributions, then evaluate it on unseen periods before presenting early-accumulation claims.
5. Extend valuation and event overlays only when each source and equation is reproducible. User video can resolve interaction/tooltip behavior but does not supply an undisclosed equation or missing wallet history.

The visual components and interactions are implementable. Exact A1 numerical parity and whale-accumulation claims remain unverified; no screenshot values should be hard-coded as live observations.
