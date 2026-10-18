# A1Radar: current supply and trader-flow observations

Observed by the root agent through the authenticated browser on 2026-10-18. This supplement records visible UI behavior; it does not establish access to underlying raw data, formulas, wallet classifications or paid features. It leaves `A1RADAR_FEATURE_MATRIX.md` unchanged.

## Strategic Trader Netflow — free access

Page: <https://a1radar.com/strategic-trader-netflow>

| Visible field | Observed value or behavior |
| --- | --- |
| Data period | 17/10/2026 |
| Token count | 222 |
| Inflow | 39.83K |
| Outflow | 519.39K |
| Net flow | −479.55K |
| Views | Six tabs, including Top In/Out 24h, trader-count and flow/market-cap views |
| Search | Symbol or address |
| Table fields | Asset, contract, chain, market cap, net flow, trader count, Flow/MC |
| Trader-count tab switch | Caption changed; visible table retained its apparent market-cap ordering. The underlying sorting rule was not established. |

The displayed totals are rounded. Do not reject them solely because subtracting already-rounded totals differs by the last displayed digit. Any exact reconciliation requires unrounded records and their units. The UI's flow/trader labels describe A1's selected population; they do not establish that the repo's exchange aggressor data measures the same wallets.

Implementation acceptance for an independent equivalent: searchable chain+contract identities; explicit cohort and trade window; transaction-linked inflow/outflow/net totals; deduplicated participating-address counts; same-time market cap for Flow/MC; a declared sorting key for each tab. The six observed tabs should not be assigned invented names or thresholds until their labels and behavior are captured individually.

## Unlock Risk Index — current page error

Page: <https://a1radar.com/unlock-risk-index>

The current free page failed with the visible messages `Something went wrong` and `Cannot read properties of undefined (reading 'safe')`.

This is an observed page error, not a subscription block or proof that source data is absent. No current risk chart, values, thresholds or working filter behavior were verified through this page. The documented FDV/market-cap bands in the main matrix remain documentation evidence only.

## Token Unlock — free access

Page: <https://a1radar.com/token-unlock>

The page displayed **171 tokens**, search, and **linear / nonlinear / all** filters. The table exposes rank, token, price, market cap, circulating supply, unlock progress, next amount, countdown and unlock type. Clicking BTW opened a token-detail modal.

| BTW modal field | Displayed value |
| --- | --- |
| Price | 2.461 |
| Market cap | 7.16B |
| Circulating supply | 2.91B (29.11%) |
| Total supply | 10B |
| Unlocked | 18.3% |
| Locked | 70.9% |
| Other | 10.8% |
| Next unlock | 101.70M BTW ($253.31M) |
| Next unlock / market cap | 3.493% |
| Next date | November 2, 2026 |
| Type | Linear |
| Grounded detail link | <https://a1radar.com/gem-radar?token=bitway> |

These are separate rounded UI fields. Their update times and valuation rules were not independently established. In particular, circulating supply and the “unlocked” segment are not automatically interchangeable, and a next-unlock USD estimate need not use the same price observation as the displayed spot quote.

## BTW source disagreement and required resolution

Root's current CoinGecko observation reports **1.50579B circulating / 15.0579%**, while A1's modal reports **2.91B / 29.11%**. The CoinGecko observation's exact endpoint, asset/contract mapping and timestamp are not reproduced in this browser-note supplement; bind them to the retained market-data provenance before a formal numerical comparison.

Do not change the independent source value to make the two displays agree. First establish:

1. Exact token identity: provider ID, chain and contract/native asset; the observed `bitway` route is one identity clue, not contract proof by itself.
2. Snapshot times and supply definitions: circulating, unlocked, total and maximum supply may describe different populations.
3. Primary project evidence: dated tokenomics/vesting documentation and, where applicable, on-chain vesting contract state.
4. Event meaning: scheduled availability, actual release and immediately transferable/circulating supply must remain separate.
5. Reconciliation: preserve both source values and dates; compute ratios from one internally consistent source snapshot. Explain any unresolved discrepancy beside the metric.

For the repo, the next measurable deliverable is a source-dated supply table and verified unlock-event record with token amount, timestamp/timezone, release type, beneficiary class where documented, valuation timestamp and provenance. A ratio-only unlock-risk view cannot substitute for this schedule. No code, data correction, purchase or subscription change was performed for these observations.

## Market visualization — current authenticated observations

Page: <https://a1radar.com/bubbles-visualization>

Root observed four modes: **Bong bóng / Dạng cột / Top Movers / Counter Trend**. The controls below are current UI observations, not inferred from the older feature documentation.

| Mode | Observed controls and output |
| --- | --- |
| Bong bóng | 15M / 1H / 1D / 1W / 1M / 1Y, a Top-100 rank menu, search, token logos and percentage-return labels. |
| Dạng cột | Six timeframe columns, each showing its top 20 gainers and losers. |
| Top Movers | 1D / 1W / 1M / 1Y; ten rank buckets from 1–100 through 901–1000; top ten gainers and losers within the selected bucket. |
| Counter Trend | Embedded list of 2,130 tokens; BTC previous-day return +0.58%; sorting controls for rank, market cap, countertrend-day count, price and 24h return; yesterday flag; links to Volume Momentum Divergence using the native token ID. |

Counter Trend examples included **AUTO: 34 days** and **BTW: 29 days**. The label alone does not establish the lookback, counting rule, candle cutoff, benchmark source or treatment of unchanged/missing days. This historical day-count display is **not equivalent to Flow Research's current opposite-sign return screen**. Keep those two features named and documented separately until the historical rule is established.

## Same-session BTW inconsistency inside A1

In the same browser session, A1's unlock modal showed **7.16B market cap / 2.91B circulating**, while its Counter Trend table showed **3.55B market cap / price 2.36**. Dividing the latter displayed values suggests approximately **1.5B units**, but that is an inference from rounded fields, not a directly observed circulating-supply value. The two A1 views' source clocks and supply definitions were not clear.

This is evidence against treating a single A1 page as an automatically authoritative numeric target. Preserve page-specific timestamps, identities and definitions; investigate source disagreement before attempting any correction to independent market data.

## Near-time bubble comparison — illustrative only

Root observed the A1 bubble labels at approximately **12:21 Vietnam time on 2026-10-18**. The independent Flow source observation was timestamped **12:21:54 Vietnam time**, using CoinGecko. The values below are recorded for inspection, not as a parity test.

| Token label | A1 bubble return | Flow / CoinGecko return |
| --- | ---: | ---: |
| Q | +103.0% | +102.64% |
| BTW | +20.1% | +20.23% |
| TIA | −15.9% | −16.09% |
| STRK | −11.6% | −11.62% |

These near-time figures are numerically close, but the reference labels alone do not prove matching asset contracts, exact return windows, constituent exchanges, source update times or rounding rules. Do not describe them as verified exact parity, a general accuracy percentage, or proof that wallet-accumulation metrics match. A repeatable comparison requires those fields and preserved source records.


## Current premium gates

On 2026-10-18 in the same signed-in FREE session, root opened Gem Radar (`/gem-radar?token=bitway`) and MEFI (`/momentum-engine-flow-index`): both showed **Upgrade to ULTRA**. Holder Flow Index (`/charts/holder-flow-index`) showed **Upgrade to PRO**, even though the dashboard groups it under a T3 badge. These are the actual page gate labels; do not assume dashboard T-numbers map one-to-one onto package names. No upgrade was purchased and no gated content was retrieved. The Exclusive Radars menu also lists Token Health Scan, Smart Positioning Radar, Elite Whale Radar, Sector Momentum and Narrative Heat Radar; their presence alone does not reveal their underlying formulas or controls.
