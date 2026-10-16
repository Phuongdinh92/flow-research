# Flow Research — Market Observatory v0.7

Public site: https://phuongdinh92.github.io/flow-research/

This version adds verified public on-chain observations to the existing market interface. It shows current TON holder distributions, changes between actual short-interval observations and a sampled Ethereum DEX ledger with balances at one finalized block. Beneficial-owner attribution, proprietary A1Radar models, strategy backtests and investment rankings are not implemented.

## Separate data scopes

| Layer | Verified saved coverage on 2026-10-16 | Meaning |
| --- | --- | --- |
| Venue spot/USDT | Binance 511, Bitget 504, Gate 2,051, WhiteBIT 328 | 3,394 venue/instrument rows, not 3,394 unique coins |
| Aggregated USD markets | 1,000 unique CoinGecko asset IDs, four market-cap ordered pages | Provider-aggregated prices and 24H/7D/30D changes; not independent wallet evidence |
| Catalog | 22,307 CoinGecko identities | A catalog count, not a claim that every identity has current price or flow data |
| Binance daily taker summary | 489 valid / 511 checked; 22 short-history exclusions | 31 continuous completed UTC days; weighted buy quote share and close-to-close changes |
| TON holder observations | Top 1,000 owner accounts each for STON, NOT and DOGS, two actual full captures about five minutes apart | Exact raw quantities, source-ranked cohorts; includes exchange/protocol custody accounts, not whale ownership |
| Ethereum DEX evidence | 300 returned swaps, 177 senders, one WETH/USDC Uniswap v3 pool; 10 selected sender balances at finalized block 26,204,700 | A sample covering 10:01–11:22 UTC, with 197 swaps before the balance cutoff at 11:09:11 UTC |
| Ecosystem context | 425 chain TVL rows, 209 chain stablecoin valuation rows; 3,244 global historical dates | DefiLlama TVL and USD stablecoin valuations, not net token purchases |

The provider global endpoint's active-asset/exchange counts and catalog count are distinct observations with different definitions and timestamps. Exact-name chain joins produce 452 records; this is not a certified count of distinct blockchains. Missing values remain null.

No layer is presented as complete coverage of all exchanges, DEXs, chains, assets or wallets. Aggregated USD volume is kept separate from each venue's USDT quote turnover and is never added to it. Shared ticker names do not establish common contract identity.

## Data quality and access

- `market.js` shares the same public parsers between browser and collector. Source metadata determines eligible active spot/USDT instruments; there is no 30-symbol shortlist.
- Bitget explicitly classifies crypto products. The observed Binance/Gate/WhiteBIT registries do not establish underlying asset class; spot eligibility is not a crypto-only classifier. No speculative ticker suffix blacklist is used.
- Gate supplies a response clock rather than an update timestamp for every instrument. WhiteBIT supplies receipt time and has no browser CORS permission. These limitations are labeled; a current response does not establish when an illiquid instrument last traded.
- Browser scans read the three CORS-enabled venues. WhiteBIT remains a source-dated server snapshot; it is not counted as a successful browser API call.
- Ticker/price observations older than 15 minutes are excluded from current maps. If every usable saved observation has aged out, a saved-time view is explicitly labeled historical. CoinGecko freshness uses each asset's own provider update time; ancient rows with apparently nonzero volume are not treated as current.
- Failed source requests preserve prior data with its original dates and error. HTTP/HTML block responses never become market records. Zero, missing data, unsupported fields and source failures remain distinct.
- Snapshot outputs include source URLs, receipt times and SHA-256 hashes of decoded response bodies. Raw audit receipts are retained outside the website source during collection; normalized outputs alone are not a fully replayable research archive.

## Charts

- Readable equal-size bubbles by default. Size has no volume/market-cap meaning in this mode. The venue map also offers exact area-proportional quote-turnover sizing. Selection, number shown and denominator are explicit.
- CoinGecko maps switch between provider 24H, 7D and 30D returns. These rolling changes are distinct from calendar candle intervals.
- Venue detail supports real daily, Monday-start weekly and calendar-month UTC candles, plus a separate quote-volume pane. Full daily history is aggregated first; partial boundary periods and missing-day periods are excluded. Complete periods overlapping the chosen 30/90/120-day window are shown intact.
- Binance taker delta and CVD require actual buy quote volume. Bitget/Gate histories do not supply it; WhiteBIT daily history is unsupported. Missing taker values never become zero.
- CVD resets at the beginning of the displayed series and becomes unknown after a gap. Aggressor imbalance is not cash deposited, wallet inventory or whale accumulation.
- Optional SMA20 and SMA-seeded EMA50 use all available daily history before display slicing. Week/month overlays sample the last daily value of the completed period. Gaps restart warmup. There is no EMA200 with only 121 daily observations and these averages are not holder-cost SmartBands.
- Global stablecoin history is USD valuation of circulating quantities across peg types. Changes may reflect issuance/redemption, valuation, FX or depeg effects. They are not labeled cash inflows into altcoins. TVL changes are not deposits minus withdrawals.
- The evidence panel lists every A1 reference category, its actual implementation state, and missing inputs. TON cohorts now use actual source-ranked account balances; no simulated balances, owner clusters, whale signals or score axes are supplied.

## On-chain observations

`holders.js` supports exactly three verified TON mainnet master contracts. The API metadata, symbol, decimals and whitelist status are cross-checked against those identities. Whitelist status identifies the supported token; it does not establish investment safety. All amounts stay integer strings and use BigInt for arithmetic. Owner accounts and their jetton-wallet contracts are distinct fields. Provider labels and wallet-interface flags are descriptive, not verified beneficial-owner identities.

Distribution charts use the provider's reported total supply as denominator, not circulating supply. Top accounts include exchanges, DEX/protocol contracts, project custody and unclassified addresses; no whale classification or exclusion-adjusted circulating supply is asserted. TonAPI endpoints return latest indexed state during a per-token collection window, not one common block. Supply/holder metadata and the ranked page may be observed at slightly different instants.

The snapshot retains both full top-1,000 observations for each token and an earlier STON top-100 observation. Comparison selects the oldest prior observation with the largest available coverage. Cohorts are fixed by the earlier ranks and joined by exact owner address; missing owners are not assigned zero. A complete cohort delta is null unless every expected anchor member is observed at both ends. The actual public capture interval is about five minutes. This is an account balance change, not a purchase or a 24H/7D/30D history. For example, the DOGS observations include substantial changes in a provider-labelled Binance Hot Wallet; this cannot be called whale accumulation.

Browser refresh reads only the selected TON token, with a module-wide lock and at least five seconds between unauthenticated requests. CORS was verified from the deployed origin. An error preserves the earlier observation and original time. New browser observations live only in that open page's memory; no persistent scheduled collection is enabled.

`dex-evidence.js` verifies the exact Ethereum chain, pool, WETH and USDC contracts, side direction, source proof, raw token quantities and one fixed finalized block. Ten senders are selected by their largest USD-valued swap in the finalized portion of the returned sample, not by holdings. Sender summary statistics are recomputed from trades. `balanceOf` and `eth_getCode` are queried at that fixed block, and its hash is checked before/after collection. A checked sender is not necessarily a swap recipient or beneficial owner. The included real receipt demonstrates a 28.493604173305397647 WETH transfer to a different contract; its before/finalized balances do not prove retained purchases.

GeckoTerminal returns at most the latest 300 pool swaps in a trailing 24-hour window; this particular sample covers only 81 minutes. The five-minute chart describes only returned swaps, including 103 after the balance cutoff. Sender-table net values include only the 197 swaps at or before the finalized block. USD figures are provider estimates, not settled-dollar amounts. This is neither all Ethereum activity nor a complete 24-hour ledger.

Public receipt metadata includes URLs, capture times, request payloads where needed and response SHA-256. Raw collection receipts and independent replay reports are retained outside the website checkout during this work. The public normalized snapshots preserve exact token quantities, not an independently replayable full RPC archive.

## Maintenance

Website users need no Python, installation, API account or downloaded file.

The current four-venue collector reuses the exact browser adapters:

```text
node collect_public.cjs
```

`collect_market.py` remains the earlier two-venue collector and its isolated validation fixtures; use `collect_public.cjs` for this release's full enabled venue set.

The Binance history collector can resume verified same-UTC-day cached responses without changing their original receipt time:

```text
python -m pip install -r requirements-flow.txt
python collect_flow.py
```

`FlowEcosystem.refresh(previousSnapshot)` refreshes four CoinGecko price pages and global statistics at an eight-second request gap. It stops on HTTP/CORS/rate-limit failures without retrying or replacing previous data. Catalog, TVL and stablecoin observations retain their original source times; assembly time does not make them newly fetched.

The on-chain collectors use Node 20+ built-ins and keyless public endpoints:

```text
node collect_holders.cjs
node collect_dex_evidence.cjs
```

They stop on source failures without evading provider restrictions. The DEX collector limits free RPC batches to three calls.

No scheduled collector or trading operation is enabled. Nothing collects data while the browser is closed. No private strategy, credentials, portfolio, wallet labels or authenticated research backend is included. Browser-delivered files can be inspected.

## Verification

```text
node --test test-market.cjs test-ui.cjs test-charts.cjs test-view.cjs test-ecosystem.cjs test-global-ui.cjs test-holders.cjs test-dex-evidence.cjs test-onchain-ui.cjs
python collect_market.py --self-test
python -m unittest test_flow
```

Checks cover source identity, units, partial failures, freshness, true calendar boundaries (including leap-year February), missing-day behavior, CVD reset, indicator warmup, USD-vs-USDT separation, exact area scaling and accessible rendering. All 489 Binance summaries and all 1,000 normalized USD market records were independently reconciled against retained responses. Gate weekly/monthly aggregation was independently replayed with Python Decimal and calendar boundaries. All 3,000 latest TON account-token rows and six source hashes were replayed against retained raw responses. An independent Decimal replay reconciled all 300 DEX trades, 10 sender balance batches and 18 source hashes. Tests cover exact raw balance precision, missing-as-null cohort changes, fixed-block integrity, sender/recipient separation and observed-sample scope. Software checks do not establish prediction performance.

## Primary specifications

- https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints
- https://www.bitget.com/docs/catalog/market/market-data
- https://www.bitget.com/api-doc/spot/market/Get-Candle-Data
- https://www.gate.com/docs/developers/apiv4/en/
- https://docs.whitebit.com/public/http-v4/
- https://docs.coingecko.com/demo/reference/coins-markets
- https://docs.coingecko.com/demo/reference/crypto-global
- https://api-docs.defillama.com/llms-free.txt
- https://docs.a1radar.com/vi/features/holder-flow-index

- https://docs.tonconsole.com/tonapi/
- https://docs.tonconsole.com/tonapi/rest-api/jettons/
- https://github.com/tonkeeper/ton-assets/blob/main/jettons.json
- https://eips.ethereum.org/EIPS/eip-20
- https://docs.coingecko.com/reference/pool-trades-contract-address
- https://drpc.org/docs/ethereum-api/executingtransactions/eth_call
