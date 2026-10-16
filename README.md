# Flow Research — Crypto Market Observatory v0.5

Public crypto market research interface at https://phuongdinh92.github.io/flow-research/ . Version 0.5.1 adds broad Binance + Bitget spot/USDT discovery, an auditable saved market snapshot, and source-specific daily history. It does not implement a private Quant research engine or whale accumulation detection.

## Implemented

- `market.js`: read-only Binance Spot + Bitget Spot public adapters. Discovers eligible active USDT instruments from source metadata instead of a fixed 25/30-symbol list.
- Bitget V3 explicitly classifies crypto/stock products; only `category=SPOT`, `status=online`, `symbolType=crypto`, `instrumentType=crypto`, `quoteCoin=USDT` qualify. Regional `areaSymbol` is not used to infer asset type.
- Binance exchangeInfo establishes active spot/USDT eligibility but supplies no underlying asset-class label in the observed registry. This universe is not certified crypto-only; ticker suffixes are not a reliable stock/ETF classifier. Bitget uses its explicit crypto classification.
- Each venue/instrument has a separate key. Shared tickers do not establish common chain/contract identity. No cross-venue asset or taker-percentage aggregation.
- Search, venue filters, sorting, pagination, per-source coverage and errors. Every row retains the source timestamp; ticker age over 15 minutes is labelled stale.
- On-demand daily UTC history, completed candles only. Current 30D statistics require 31 consecutive daily bars ending on the latest closed UTC day; a 7D chart can use eight continuous closes while longer unavailable statistics remain null. Binance taker buy is descriptive; the Bitget candle field is unavailable and remains null.
- `collect_market.py`: standard-library public snapshot collector, row validation, source failures, normalized records, endpoint/time/SHA256 provenance, atomic replacement. If all sources fail it preserves the prior snapshot. If one succeeds a partial new snapshot contains only that run's valid rows; the failed source is recorded, not relabelled as fresh.
- Existing snapshots are optional for the UI. A failed/absent snapshot does not prevent a user-requested direct API scan. A delayed saved response cannot overwrite a newer scan.

## Charts restored and added

- 24H market bubbles, with area proportional to venue quote turnover. Shows up to 80 highest-turnover pairs on desktop or 24 on narrow screens; filtering applies before selection. The alternate scatter plots all usable pairs with price change and log10 USDT turnover.
- Restored seven-day Binance taker-buy/price-change scatter, using broad closed-day summaries plus any newer on-demand histories. Coverage, history failures, and the latest closed UTC day are explicit. Bitget is excluded from this specific metric because its candle endpoint does not supply taker-buy quote volume.
- Per-pair OHLC candles with quote-volume pane, daily aggressor buy-minus-sell bars over a separately scaled closing-price line, and cumulative aggressor delta (CVD). Windows 30/90/120 reset CVD to zero before the first displayed day.
- `charts-core.js` validates units, source identity, UTC continuity, rollover freshness and retained summary arithmetic; `charts-view.js` renders accessible SVG with exact-value tooltips and keyboard/click navigation.
- `collect_flow.py` reads every available Binance venue pair from the market snapshot (not a fixed token shortlist), validates 31 completed daily candles and retains independently checkable endpoint prices, quote totals and response hashes in `data/flow-snapshot.json`. Insufficient listing history and upstream errors remain explicit exclusions. It does not rank investment opportunities.
- Six independently reconciled BTC/W/STRK histories across the two venues are included in `data/history-snapshot.json`; current pair detail can refresh directly from the source. A saved chart is explicitly labelled historical if it no longer meets the latest closed-day or ticker freshness rules.

## Public and private boundaries

This repository contains public descriptive market data and implementation only. It has no private strategy model, secret scoring parameters, classified wallet list, credentials, personal portfolio, authenticated backend, or trading operations. Any files delivered to a browser can be inspected and copied.

This version is not A1Radar's ASI and does not confirm whale accumulation. No blockchain collectors, wallet holding histories, wallet clusters, strategy backtests, validated forecasts, or investment rankings have been implemented here. Multiple exchanges alone do not establish who bought or retained tokens.

## Evidence and limits

The collector records raw response **hashes and safe response metadata**, not complete raw response bodies. Normalized exports are useful for inspection but do not by themselves provide a fully replayable market research dataset. Coverage denominators count eligible venue instruments, not unique crypto assets or a percentage of the whole market.

Direct access may fail because of geography, CORS, provider restrictions, rate limits, or network errors. HTTP/HTML errors do not become successful market data. Missing values remain missing; numeric zero is preserved. The source's ticker timestamp represents a generated ticker update, not necessarily the time of the last trade.

No scheduled collection or trading has been enabled. Nothing runs when the page is closed. No GitHub Actions workflow is included in this change.

## Offline validation

Run without network access:

```text
node test-market.cjs
node test-ui.cjs
node test-charts.cjs
node test-view.cjs
python collect_market.py --self-test
python -m unittest test_flow
```

The 13 adapter, 14 UI, 17 chart arithmetic, 11 SVG rendering, 9 market-collector and 12 history-collector checks pass. Tests use isolated fixtures, never production fallback rows. Passing software tests does not establish market prediction performance. Live market collection on 2026-10-16 returned 511/511 eligible Binance pairs and 504/504 Bitget pairs. Broad Binance daily collection checked all 511 available pairs: 489 had 31 continuous completed UTC days and 22 lacked sufficient history. Every retained record was reconciled against its raw response. The saved snapshots load through the production validators. The chart summaries are independently reconciled against source response values; browser verification is also performed on the published version.

Maintainers running the broad history collector need its pinned HTTP dependency. Website users do not need Python:

```text
python -m pip install -r requirements-flow.txt
python collect_market.py
python collect_flow.py
```

History collection uses four persistent connections with globally paced requests. Rate-limit or access-block responses stop collection; completed records are checkpointed so an interrupted run can resume on the same UTC day while retaining original fetch times.

## Source specifications

- [Binance market-data-only service](https://developers.binance.com/en/docs/products/spot/faqs/market_data_only)
- [Binance REST market data](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints)
- [Bitget V3 instruments and product types](https://www.bitget.com/docs/catalog/market/market-data)
- [Bitget spot tickers](https://www.bitget.com/api-doc/spot/market/Get-Tickers)
- [Bitget spot candles](https://www.bitget.com/api-doc/spot/market/Get-Candle-Data)

Open the website directly; no Python installation or file download is required to use it. The source collector is included for maintaining auditable public snapshots.
