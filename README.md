# Flow Research — Market Observatory v0.9

Public site: https://phuongdinh92.github.io/flow-research/

A public, read-only crypto research terminal that places market context, aggressor order flow, actual account balances, receipt-checked DEX acquisitions and an exploratory event study in one application. Each layer keeps its own identity, units, timestamps and coverage. The application does not identify beneficial owners, execute trades or claim a proven predictive edge.

The default token terminal covers the 511-pair Binance spot/USDT research archive; the default explicit asset-class filter leaves 438 instruments. Aggregated USD markets, other venues, native HBAR account history, TON observations and Hyperliquid contracts remain separate datasets. A matching ticker never establishes a common token contract.

## Implemented views

- **Token terminal:** search the Binance archive; inspect price, volume, calendar candles, SMA20/EMA50/EMA200, weighted taker buy share, delta, CVD, RSI, price position, observed drawdown and public descriptive conditions. Source-specific HBAR, Ethereum acquisition and derivatives evidence appears only where the corresponding data exists.
- **Market overview:** CoinGecko USD bubbles, columns, gainers/losers, same-source BTC countertrend and category aggregates; four distinct spot/USDT venue maps. Available return frames are 1H, 24H, 7D, 30D and 1Y when returned by CoinGecko. Venue ticker maps remain 24H. A missing 15-minute field is not approximated from another timeframe.
- **Buying-pressure screen:** adjustable 7D/30D buy-share, non-overlapping relative-volume and 30D return conditions across the dated Binance universe. Matches describe trades; they do not identify accumulating whales.
- **Holder history:** real HBAR historical custody balances, fixed account-rank cohorts, comparison intervals and optional exclusions based on officially documented Council/network accounts. TON retains exact top-account observations and comparisons between actual captures.
- **Ethereum acquisition ledger:** selected UNI, LINK and AAVE purchases in three named Uniswap v3 pools, verified against transaction receipts and transfer routes, with fixed-block balances and 30 historical state checkpoints per selected address/token position.
- **Derivatives context:** original Hyperliquid perpetual DEX metadata, mark/oracle prices, open interest, current funding and captured funding histories. This is not a liquidation heatmap or cross-venue positioning model.
- **Historical event study:** all eligible selected condition onsets, including losing and pending outcomes, with 7D/30D results, BTC comparisons, matched same-date baselines and an explicit illustrative fee/slippage scenario.

## Source scopes

The following describes the v0.9 release observations. Published JSON manifests and source timestamps determine the current generation after refreshes; counts from different rows must not be added together.

| Dataset | Release coverage | Interpretation and limits |
| --- | --- | --- |
| Binance daily archive | 511/511 current source instruments; completed UTC daily candles, requesting up to 401 days each | Current-listed universe, not historical membership or all exchanges. The default class filter removes 73 explicitly documented securities/stablecoin/fiat instruments; remaining instruments are not all independently classified. |
| Venue spot/USDT prices | Binance, Bitget, Gate and WhiteBIT; valid/expected instrument counts shown separately | Each row is a venue/instrument identity, not a unique coin. Missing or stale tickers remain explicit. |
| Aggregated USD markets | 1,000 distinct CoinGecko IDs across four market-cap pages; catalog observation contains 22,307 IDs | Prices and available provider return fields. Catalog membership does not establish current price, chain coverage or wallet evidence. |
| Provider categories | 382 complete category observations from 774 returned records | 392 records lacked required change/timestamp data and were excluded. Categories overlap; representative coin IDs are not complete membership lists. Category market-cap change is not net buying. |
| Native HBAR history | 30 requested daily observations plus 30D/90D anchors: 32 actual source snapshots | Fully paginated accounts at or above 1 million HBAR, then locally balance-ranked. Mirror Node states have 15-minute source granularity; exact state timestamps are retained. This is not the full holder population. |
| TON holders | Top 1,000 accounts each for STON, NOT and DOGS across actual captures | Latest indexed custody balances, not one shared atomic block, beneficial owners or inferred daily history. |
| Ethereum acquisition sample | 30 receipt-checked selected acquisitions across UNI/LINK/AAVE; four recipient contracts and seven address/token positions with 30 historical balance checkpoints | Largest estimated-USD acquisitions in each provider latest-trades sample. Size-biased and incomplete; no complete intervening Transfer ledger or verified whale identity. Checkpoints are spaced by 7,200 blocks and use actual timestamps, not exact daily trade totals. |
| Hyperliquid perpetuals | 234 native metadata entries, 178 active; 32 contracts with 30-day funding histories | Original DEX only, including delisted metadata entries. Excludes HIP-3 DEXs, other venues and trader identities. Open interest is not net new money or a directional position count. |
| Legacy WETH/USDC evidence | One pool, 300 returned swaps and selected sender balances at one finalized cutoff | Preserved as its own earlier sample in the wallet/DEX pane; not merged with the newer UNI/LINK/AAVE acquisition ledger. |
| DeFi context | Source-dated chain TVL, circulating stablecoin USD valuations and historical valuations | Valuation changes may include issuance, redemption, prices, FX or depegs; they are not token purchases or verified capital inflows. |

No dataset claims complete coverage of all tokens, wallets, exchanges or chains. Aggregated USD volume is never added to venue USDT turnover. All modules distinguish missing values from numeric zero and source failures.

## Reading accumulation evidence

Taker buying shows which side initiated a match. Binance public market data does not disclose the buyer's account inventory or identity. A large address balance can belong to an exchange, protocol, bridge, treasury, router or multiple beneficial owners. Receiving tokens does not establish buying them.

The Ethereum ledger checks the swap and the transaction's token-transfer route before associating an acquisition with its observed recipient. A recipient can still be a contract, intermediary or custodian. Before/after/finalized balances and historical checkpoints do not reveal every transfer between them. Retained purchased units therefore remain bounded rather than confirmed; a large ending balance alone never changes the label to “whale accumulation.”

HBAR cohort comparisons keep the older rank-set membership fixed. Current official Council/network exclusions can be inspected and toggled; applying those labels to older observations is retrospective. Unclassified accounts may still be infrastructure or exchange custody. Accounts absent from a completely paginated minimum-balance universe receive justified balance bounds, not invented exact zero balances. TON accounts missing from a later top-1,000 page remain unknown.

## Calculations and historical study

Daily measurements use completed UTC candles. Weighted taker buy share is total buy quote divided by total quote over the same window; delta is `2 × buy quote − total quote`. CVD resets at the displayed window's start and after missing history. Weekly candles start Monday UTC; monthly candles follow the actual calendar. Partial or gapped periods are excluded. SMA/EMA warmup uses the available daily history before display slicing and restarts after gaps.

The default descriptive pressure condition is `buyShare7 > 52%`, `buyShare30 > 50%`, `−30% ≤ return30 ≤ 15%` and `mean quote7 / mean quote of the immediately preceding 30 days ≥ 1.10`. These require 37 continuous completed days. EMA200 requires its own 200-day warmup and is not a prerequisite for measuring newer instruments.

The event study uses condition **onsets**, excludes first-observable left-censored onsets, and imposes a 30-day per-instrument embargo. Signals use only the completed signal candle and earlier inputs. Entry is the following daily OPEN proxy; exit is the 7th/30th subsequent candle CLOSE. These are hypothetical execution prices, not observed fills. The illustrative cost scenario charges 10 basis points of fees plus 10 basis points of slippage on each side. Funding and borrowing are zero because this is a spot study.

BTC uses the same dates and cost scenario. The matched baseline uses other source instruments in the same signal-date trailing-volume quartile and the same 30D return range, with sufficient prior inputs. Results retain failures, pending horizons, unavailable controls, means, medians, drawdown and adverse daily lows. They do not establish causality, out-of-sample performance, statistical significance or a profitable strategy. The archive omits historical delistings and historical universe membership; the classifications were assembled at collection time. This is an exploratory retrospective study, not a fully point-in-time backtest.

## Local startup and tests

Viewing the deployed site requires no installation, account or API key. For development, use Node.js 22+ and serve the checkout over HTTP; opening `index.html` as a `file:` URL will not provide normal fetch behavior. No npm dependencies are required for the Node collectors or checks. Python is optional for the simple server and the older independent verification tools.

```sh
cd flow-research
python -m http.server 8080
```

Open `http://localhost:8080/` in a modern browser with Compression Streams support. The research archive is delivered as gzip plus a manifest; the browser checks compressed/decoded lengths and SHA-256 hashes before accepting its contents.

```sh
node --test test-*.cjs
python collect_market.py --self-test
python -m unittest test_flow
```

The checks cover source identities, percent/quote units, completeness, freshness, failures, exact integer balances, receipt routing, fixed-block integrity, funding alignment, missing-as-null behavior, calendar boundaries, indicator warmup, chart scaling and historical-study selection/cost/baseline rules. Tests of software and source reconciliation do not establish prediction accuracy.

## Refresh and automation

The complete public refresh pipeline is:

```sh
node refresh_data.cjs
```

Run selected jobs by their explicit IDs when needed:

```sh
node refresh_data.cjs venue-prices global-markets daily-research event-study
node refresh_data.cjs hedera-holders ton-holders dex-acquisition derivatives
```

| Job | Collector |
| --- | --- |
| `venue-prices` | `collect_public.cjs` |
| `global-markets` | `collect_market_overview.cjs` |
| `daily-research` | `collect_signals.cjs` |
| `event-study` | `collect_intelligence.cjs` — derives from the validated archive |
| `hedera-holders` | `collect_holder_history.cjs` |
| `ton-holders` | `collect_holders.cjs` |
| `dex-acquisition` | `collect_chain_ledger.cjs` |
| `derivatives` | `collect_derivatives.cjs` |

The pipeline validates each job's outputs and restores that job's previous published files byte-for-byte on failure. The event study must match the source archive hash and cutoff. `data/collection-status.json` records the attempted jobs, outcomes and file hashes. Retaining old data does not reset its original observation time. Provider restrictions halt the affected collector without access-control workarounds.

`.github/workflows/refresh.yml` configures a six-hour GitHub Actions schedule: `23 */6 * * *` UTC, or 01:23, 07:23, 13:23 and 19:23 Asia/Ho_Chi_Minh. A manual dispatch and changes to the workflow on `main` can also trigger it. Scheduled execution may be delayed by GitHub. The first collector run (38986650596, 2026-10-17) did not start; automated collection is currently blocked. The separate Pages deployment succeeded. The UI reports the blocked collection state, and `data/automation-status.json` is replaced only after a subsequent Actions collection can actually execute. Do not describe this schedule as operational until a successful end-to-end run is verified. The workflow collects, runs the Node checks, commits coherent public snapshots and requests a Pages rebuild.

UTC daily history only advances when another day has closed; refreshing every six hours does not manufacture four new daily observations. Source-specific timestamps can differ. Browser price refreshes do not trigger all server collectors. Research reload rereads the published archive. TON browser refresh observations remain in that page's memory until the public collector publishes another snapshot. Catalog/TVL/stablecoin observations retain their source dates when their sections were not recollected.

## Provenance and remaining gaps

Public outputs preserve source URLs, request/capture times, contract/account identities, raw integer quantities where appropriate and response SHA-256 metadata. The research manifest covers the compressed and decoded archive. The event-study output also records hashes of its calculation, collection and classification code. Raw receipts are retained outside the website checkout during collection; consult the particular collector/report for their location. A normalized snapshot and a hash alone are not an independently replayable full-chain archive or proof that a provider's economic interpretation is correct.

Full wallet lot accounting, holder-age cost basis, entity attribution and complete intervening token-transfer histories remain unavailable. The application does not implement or claim equivalence with A1Radar's proprietary ASI, MEFI, Strategic Capital, Shark/Whale Action, DSSI or Gem Radar models. It does not replace Realized/Balance/Delta/Undervalue/Diamond cost bands with price averages. There is no complete unlock model, predicted liquidation heatmap or verified whale-buy signal.

No authenticated private research backend, credentials, portfolio or trading operation is included. Browser-delivered files and formulas are public and inspectable.

## Primary specifications

- https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints
- https://www.bitget.com/docs/catalog/market/market-data
- https://www.bitget.com/api-doc/spot/market/Get-Candle-Data
- https://www.gate.com/docs/developers/apiv4/en/
- https://docs.whitebit.com/public/http-v4/
- https://docs.coingecko.com/reference/coins-markets
- https://docs.coingecko.com/reference/coins-categories
- https://api-docs.defillama.com/llms-free.txt
- https://mainnet.mirrornode.hedera.com/api/v1/docs/
- https://hederacouncil.org/treasury
- https://docs.tonconsole.com/tonapi/
- https://docs.tonconsole.com/tonapi/rest-api/jettons/
- https://eips.ethereum.org/EIPS/eip-20
- https://docs.coingecko.com/reference/pool-trades-contract-address
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
- https://docs.a1radar.com/vi/features/accumulation-strength-index
