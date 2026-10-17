# Flow Research — Market Observatory v0.9.5

Public site: https://phuongdinh92.github.io/flow-research/

A public, read-only crypto research terminal that places market context, aggressor order flow, actual account balances, receipt-checked DEX acquisitions and an exploratory event study in one application. Each layer keeps its own identity, units, timestamps and coverage. The application does not identify beneficial owners, execute trades or claim a proven predictive edge.

The default token terminal covers the 511-pair Binance spot/USDT research archive; the default explicit asset-class filter leaves 438 instruments. Aggregated USD markets, other venues, native HBAR account history, TON observations and Hyperliquid contracts remain separate datasets. A matching ticker never establishes a common token contract.


## Two primary workspaces in v0.9.5

The default price view now puts candles and price levels on a right USD/USDT axis, with source-specific latest labels, separate volume, focus/hover crosshair, zoom and pan. EMA50 is lime and EMA200 pink. The native-network reference view keeps Coin Metrics daily USD Price, derived Realized, EMA50 and EMA200 on one source/unit/time scale; it never converts daily reference price samples into invented OHLC candles. `RealizedPriceUSD = PriceUSD / CapMVRVCur` follows the provider's capitalization identities. Exact decimal source inputs and a 24-decimal half-even quotient are retained. This is a network valuation proxy, not a confirmed investor purchase cost or A1 reproduction. The four remaining A1 Balance/Delta/Undervalue/Diamond bands stay explicitly unavailable; no multipliers are guessed. Coin Metrics community data is attributed and limited to noncommercial research under CC BY-NC 4.0. Account/private-supply valuation follows the provider's own methodology.

The main Altcoin map uses a separately identified CoinLore full-catalog capture, with source-response and capture times rather than invented per-asset last-trade times. A public API capture is not certification of every token on every blockchain. Unknown price, supply or volume stays missing; unquoted catalog assets remain searchable. Ranked pagination reaches all eligible priced assets; 150/200 is a page size, never the universe count. CoinLore logos are accepted only from exact-ID metadata responses and retained provenance. Glowing circle area follows `1 + min(abs(returnPercent), 50)` by default; the floor is explicit and position has no economic meaning.

CoinLore browser collection performs the documented full-catalog paginated scan at no more than one outstanding request and at least 1.1 seconds between requests. It only publishes an atomically complete unchanged-membership catalog, records per-ID outcomes and source SHA-256, and retains the prior snapshot on errors. It pauses when the map/source is hidden, repeats after ten active minutes, and stops after the first HTTP/CORS/schema failure without route switching. The browser path still depends on the provider allowing browser requests.

Venue views stay separate. Binance's changed-symbol miniTicker stream covers its qualified Spot/USDT registry. Gate subscribes to explicit registered pairs in serial batches of 50 with acknowledged subscriptions and at least a one-second interval. Bitget keeps one socket and at most 49 currently selected pairs, explicitly below its documented stability recommendation; the rest retain their original saved timestamps. Bitget's reported `price24hPcnt` is preserved as a fraction and discrepancies with its own returned open price are flagged rather than silently recomputed. WhiteBIT remains a saved source. All streaming rows have a five-second source-event freshness window; source-generation time is not last-trade time.

References: [CoinLore API](https://www.coinlore.com/cryptocurrency-data-api), [Coin Metrics capitalization methods](https://gitbook-docs.coinmetrics.io/network-data/network-data-overview/market/market-capitalization), [Gate Spot WebSocket](https://www.gate.com/docs/developers/apiv4/ws/en/), [Bitget UTA quick start](https://www.bitget.com/docs/uta/quick-start).

## Live observations introduced in v0.9.4

When the page is open, the official Binance market-data-only `!miniTicker@arr` stream delivers changed-market rolling-24-hour observations nominally every second. Only validated active Spot/USDT instruments from the latest successful exchangeInfo read are accepted. The fallback registry remains source-dated. Each symbol keeps its event and receive time; five-second stale/disconnected rows leave live charts. Event time is ticker-generation time, not last-trade time. Other venues, the global USD catalog, closed candles and wallet history keep independent timestamps. This browser stream does not repair the blocked background collector or establish full-market wallet coverage.

The selected Binance token also has an `aggTrade` observation window with exact decimal quote sums and net aggressor volume by price range. It begins when observed, retains at most 30 minutes / 10,000 trades, records connection gaps and never claims complete 1D/7D/30D history. Market buyer/seller initiation does not identify a beneficial owner.

Sector rankings now require each provider observation to have been within 15 minutes of its own receipt in captured mode, or within 15 minutes of now in current mode. Three already-old category observations are excluded and remain inspectable. Circulating market-cap change remains different from A1's documented FDV and from net new money.

The added inventory reconciliation independently replays retained receipts and balance states, then publishes exact observed inflow/outflow and unexplained net changes per address/token. Every one of the seven positions has unexplained change; no complete transfer ledger, whale identity, confirmed retention or holder cost basis is claimed. Browser transport binds the report to the chain snapshot's decoded SHA and recomputes the report before display. Raw-source replay is an offline audit.

## Implemented views

- **Token terminal:** search the Binance archive; inspect price, volume, calendar candles, SMA20/EMA50/EMA200, weighted taker buy share, delta, CVD, RSI, price position, observed drawdown and public descriptive conditions. Source-specific HBAR, Ethereum acquisition and derivatives evidence appears only where the corresponding data exists.
- **Market overview:** CoinGecko USD bubbles, columns, gainers/losers, same-source BTC countertrend and category aggregates; four distinct spot/USDT venue maps. Available return frames are 1H, 24H, 7D, 30D and 1Y when returned by CoinGecko. Venue ticker maps remain 24H. A missing 15-minute field is not approximated from another timeframe.
- **Buying-pressure screen:** adjustable 7D/30D buy-share, non-overlapping relative-volume and 30D return conditions across the dated Binance universe. Matches describe trades; they do not identify accumulating whales.
- **Holder history:** real HBAR historical custody balances, fixed account-rank cohorts, comparison intervals and optional exclusions based on officially documented Council/network accounts. TON retains exact top-account observations and comparisons between actual captures.
- **Ethereum acquisition ledger:** selected UNI, LINK and AAVE purchases in three named Uniswap v3 pools, verified against transaction receipts and transfer routes, with fixed-block balances and 30 historical state checkpoints per selected address/token position.
- **Derivatives context:** original Hyperliquid perpetual DEX metadata, mark/oracle prices, open interest, current funding and captured funding histories. This is not a liquidation heatmap or cross-venue positioning model.
- **Historical event study:** all eligible selected condition onsets, including losing and pending outcomes, with 7D/30D results, BTC comparisons, matched same-date baselines and an explicit illustrative fee/slippage scenario.

## Source scopes

The following describes the v0.9.4 release observations. Published JSON manifests and source timestamps determine the current generation after refreshes; counts from different rows must not be added together.

| Dataset | Release coverage | Interpretation and limits |
| --- | --- | --- |
| Binance daily archive | 511/511 current source instruments; completed UTC daily candles, requesting up to 401 days each | Current-listed universe, not historical membership or all exchanges. The default class filter removes 73 explicitly documented securities/stablecoin/fiat instruments; remaining instruments are not all independently classified. |
| Venue spot/USDT prices | Binance, Bitget, Gate and WhiteBIT; valid/expected instrument counts shown separately | Each row is a venue/instrument identity, not a unique coin. Missing or stale tickers remain explicit. |
| Aggregated USD markets | Published prices retain 1,000 distinct CoinGecko IDs across four earlier market-cap pages. New full-catalog attempt froze 22,318 IDs: 1,245 attempted = 891 priced + 105 without positive quote + 249 HTTP-error IDs; 21,073 unattempted | The new scan stopped at its first HTTP 429 on batch 5. Old displayed prices and the new incomplete attempt are separate generations. Catalog membership does not establish current price, chain coverage or wallet evidence. |
| Provider categories | 382 complete category observations from 774 returned records | 392 records lacked required change/timestamp data and were excluded. Categories overlap; representative coin IDs are not complete membership lists. Category market-cap change is not net buying. |
| Native HBAR history | 30 requested daily observations plus 30D/90D anchors: 32 actual source snapshots | Fully paginated accounts at or above 1 million HBAR, then locally balance-ranked. Mirror Node states have 15-minute source granularity; exact state timestamps are retained. This is not the full holder population. |
| TON holders | Top 1,000 accounts each for STON, NOT and DOGS across actual captures | Latest indexed custody balances, not one shared atomic block, beneficial owners or inferred daily history. |
| Ethereum acquisition sample | 30 receipt-checked selected acquisitions across UNI/LINK/AAVE; four recipient contracts and seven address/token positions with 30 historical balance checkpoints | Largest estimated-USD acquisitions in each provider latest-trades sample. Size-biased and incomplete; no complete intervening Transfer ledger or verified whale identity. Checkpoints are spaced by 7,200 blocks and use actual timestamps, not exact daily trade totals. |
| Hyperliquid perpetuals | 234 native metadata entries, 178 active; 32 contracts requested over 90 days: 31 have 2,160 hours each, PONS has 1,124; 68,084 observed hours total | Original DEX only, including delisted metadata entries. Excludes HIP-3 DEXs, other venues and trader identities. Open interest is not net new money or a directional position count. |
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
| `inventory-reconciliation` | `collect_inventory_ledger.cjs` — offline retained-source replay |
| `derivatives` | `collect_derivatives.cjs` |

The pipeline validates each job's outputs and restores that job's previous published files byte-for-byte on failure. The event study must match the source archive hash and cutoff. `data/collection-status.json` records the attempted jobs, outcomes and file hashes. Retaining old data does not reset its original observation time. Provider restrictions halt the affected collector without access-control workarounds.

`.github/workflows/refresh.yml` configures a six-hour GitHub Actions schedule: `23 */6 * * *` UTC, or 01:23, 07:23, 13:23 and 19:23 Asia/Ho_Chi_Minh. A manual dispatch can also trigger it; publishing workflow edits does not itself retry a blocked collector. Scheduled execution may be delayed by GitHub. The first collector run (38986650596, 2026-10-17) did not start; automated collection is currently blocked. The separate Pages deployment succeeded. The UI reports the blocked collection state, and `data/automation-status.json` is replaced only after a subsequent Actions collection can actually execute. Do not describe this schedule as operational until a successful end-to-end run is verified. The workflow collects, runs the Node checks, commits coherent public snapshots and requests a Pages rebuild.

UTC daily history only advances when another day has closed; refreshing every six hours does not manufacture four new daily observations. Source-specific timestamps can differ. Venue browser price refreshes do not trigger all server collectors. The global reload reads only verified published gzip packages; it does not launch a catalog crawl. Research reload rereads the published archive. TON browser refresh observations remain in that page's memory until the public collector publishes another snapshot. Catalog/TVL/stablecoin observations retain their source dates when their sections were not recollected.

The full-catalog collector freezes `/coins/list`, requests at most 249 owned IDs plus an exact Bitcoin anchor in each market batch, and reads the catalog again after completion. Requests start at least eight seconds apart and stop at the first HTTP/network/JSON failure. Checkpoints preserve original receipt times. The snapshot/coverage pair is published only after integrity validation; interrupted attempts remain separately labelled in `data/market-collection-attempt.json`. Complete means the named source catalog at the recorded collection interval, never every token on every chain. A rate-limited run is not retried through another route.

## A1 comparison status

No live numeric observation is verified equal to A1Radar. The MEFI page currently redirects to sign-in. Valid comparisons require the same canonical asset, venue, quote currency, start/end time, timezone, units, aggregation, rounding and model version. A1 documentation describes Daily Net Order Flow as aggressor buy minus sell, but does not fully specify those matching keys. Its sector treemap describes FDV; this application displays provider circulating market capitalization. ASI depends on a separately classified wallet population and undisclosed full weights. August 7 documentation predates September algorithm changes.

The DUSK screenshot is not a valid numeric pair: A1 screenshot $0.1210 / +12.86% / $18.51M lacks exact time and aggregation. Binance DUSKUSDT closed UTC October 16 at 0.1237 USDT / +12.25045% / 3,643,299.8722 USDT turnover. The difference does not establish which provider is wrong.

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

The decoded `data/coinlore-market.json` is a local collector output; the public repository distributes its exact bytes as `coinlore-market.json.gz` plus the SHA-256 manifest. The browser validates and decompresses that package, without a raw-JSON fallback. The decoded dataset can be reproduced with Node `zlib.gunzipSync` or `gunzip`.


### v0.9.6: visible updates and source-bound market layouts

The price terminal paints an exact BTC-only 401-day preview (21,387-byte gzip) before the full universe and optional analysis feeds; actual byte progress, finite timeouts and cancellation keep a slow optional source from holding the chart blank. The original 511-pair archive and timestamps remain unchanged. Rebuild the preview after daily research. Hidden research UI no longer starts a second full download at page startup.

The selected daily price chart also receives Binance's native UTC`@kline_1d` stream (source cadence about2seconds). Provisional OHLCV replaces the same forming candle; it is never summed from rolling24Htickers. DisplayEMA50/200 starts from the immutable last closed EMA on each update. Zoom, hover and focus survive price ticks. Up to31native closed session candles permit adjacent UTC-day continuity while the tab remains open; they never enter stored research, diagnosis or backtests. Reload after missing historical days reports the gap explicitly. The scheduled historical collector currently fails before runner steps begin; its status remains blocked, separately from working browser streams.

The market map opens on the source-provided Top100 rank filter and an explicit 50,000 quote-unit minimum24Hvolume filter; the full catalog/search and all positive volumes remain selectable. Columns show six separate period slots; unavailable 15M/1M/1Y CoinLore returns stay explicitly unavailable. Top Movers uses provider rank buckets and independent gain/loss panels. Different providers and time windows are never assumed equal to A1Radar.

CoinLore publishes each parsed page to an explicitly partial UI overlay immediately, preserving native IDs, raw source hash and individual response/receipt times; no-quote observations remove the previous quote. A validated complete catalog remains the only persistable snapshot. IndexedDB stores its exact JSON plus SHA256, validates on reload, and cannot renew original source clocks. Full scans run serially at >=1.1s/request with a30second pause between complete passes while visible and selected. A roughly15,000asset catalog takes several minutes per pass; receipt activity does not mean every quote or underlying trade updates each second. This pacing applies per tab; keep one active market tab. The radar animation is tied to actual scan receipts/stream activity; waiting, paused, stale and blocked states are distinct.
