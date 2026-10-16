# Flow Research — Crypto Market Observatory v0.4

Public crypto market research interface at https://phuongdinh92.github.io/flow-research/ . Version 0.4 adds broad Binance + Bitget spot/USDT discovery, an auditable saved market snapshot, and source-specific daily history. It does not implement a private Quant research engine or whale accumulation detection.

## Implemented

- `market.js`: read-only Binance Spot + Bitget Spot public adapters. Discovers eligible active USDT instruments from source metadata instead of a fixed 25/30-symbol list.
- Bitget V3 explicitly classifies crypto/stock products; only `category=SPOT`, `status=online`, `symbolType=crypto`, `instrumentType=crypto`, `quoteCoin=USDT` qualify. Regional `areaSymbol` is not used to infer asset type.
- Each venue/instrument has a separate key. Shared tickers do not establish common chain/contract identity. No cross-venue asset or taker-percentage aggregation.
- Search, venue filters, sorting, pagination, per-source coverage and errors. Every row retains the source timestamp; ticker age over 15 minutes is labelled stale.
- On-demand daily UTC history, completed candles only. Summary statistics require 31 consecutive daily bars ending on the latest closed UTC day. Binance taker buy is descriptive; the Bitget candle field is unavailable and remains null.
- `collect_market.py`: standard-library public snapshot collector, row validation, source failures, normalized records, endpoint/time/SHA256 provenance, atomic replacement. If all sources fail it preserves the prior snapshot. If one succeeds a partial new snapshot contains only that run's valid rows; the failed source is recorded, not relabelled as fresh.
- Existing snapshots are optional for the UI. A failed/absent snapshot does not prevent a user-requested direct API scan. A delayed saved response cannot overwrite a newer scan.

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
python collect_market.py --self-test
```

The 13 adapter, 10 UI, and 9 Python validation tests pass. Tests use isolated fixtures, never production fallback rows. Passing software tests does not establish market prediction performance. Live collection on 2026-10-16 returned 510/511 eligible Binance pairs (IQUSDT excluded for stale ticker data) and 504/504 Bitget pairs. The saved snapshot loads through the production UI validator. UI behavior is tested with an offline DOM harness; full browser rendering has not been verified.

## Source specifications

- [Binance market-data-only service](https://developers.binance.com/en/docs/products/spot/faqs/market_data_only)
- [Binance REST market data](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints)
- [Bitget V3 instruments and product types](https://www.bitget.com/docs/catalog/market/market-data)
- [Bitget spot tickers](https://www.bitget.com/api-doc/spot/market/Get-Tickers)
- [Bitget spot candles](https://www.bitget.com/api-doc/spot/market/Get-Candle-Data)

Open the website directly; no Python installation or file download is required to use it. The source collector is included for maintaining auditable public snapshots.
