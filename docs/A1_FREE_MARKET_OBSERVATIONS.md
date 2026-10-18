# A1Radar: four live market views observed in a FREE session

Observed on 2026-10-18 through the rendered A1Radar website after the user completed login. These are UI observations, not a reconstruction of A1's backend or proprietary formulas. No paid feature was unlocked or bypassed. Values below are captured examples, not current-price claims or an audited source dataset.

## Access and scope

| Verified route | Access observed | Representative interactions checked |
| --- | --- | --- |
| `https://a1radar.com/charts/trading-volume-overview` | Populated FREE view | 1D → 7D → 30D; ETH bubble drilldown |
| `https://a1radar.com/exchanges-volume-radar` | Populated FREE view | Comparison mode, 7D, all-venue category |
| `https://a1radar.com/charts/trending-sectors` | Populated FREE view | Ecosystem control, 7D, search Privacy, select Privacy Coins |
| `https://a1radar.com/charts/volume-momentum-divergence?s=ethereum` | Populated FREE view | Search and switch to NEAR; inspect full chart |

Opening the ETH bubble from Trading Volume Overview produced a separate page at `https://a1radar.com/charts/net-buy-sell?s=ETH`. It showed **Net by Price Range**, an explanation of net buy/sell volume by price range for ETH, and **Upgrade to PRO / Go Back**. The overview is free; this drilldown was paywalled in the same session.

## Trading Volume Overview

The view selects **1D, 7D, 30D** and changes the heading accordingly. Its description says net buy/sell volume for the whole market, green for net buying and red for net selling. The main visualization is a pack of token bubbles with token logos/tickers and signed monetary flow. Bubble area varies with magnitude; ring color carries direction. It also has an expand control.

This is a **net-flow bubble chart**, separate from A1's price-performance Market Bubbles. It must not be recreated by labeling percentage price change as money flow.

| Window | Net displayed | Buy | Sell | Active count |
| --- | ---: | ---: | ---: | ---: |
| 1D | 26.85M USDT, red/down | 7.12M | 33.97M | 40 |
| 7D | 171.79M USDT, red/down | 193.97M | 365.76M | 183 |
| 30D | 1.83B USDT, red/down | 632.15M | 2.46B | 431 |

The net KPI rendered an absolute magnitude with red color and a down icon rather than a minus sign in accessible text. A new implementation should expose the signed value explicitly for accessibility.

Examples from the 1D bubbles: ETH −17.03M, SUI −2.64M, ENA −2.54M, ASTER +2.13M, STRK −2.12M, ADA −2.08M, LTC +1.90M, SOL −1.81M, NEAR −1.65M, UNI +1.38M. On 7D, ETH changed to −90.51M, BTC −71.62M, XRP +58.72M, DOGE −59.13M, SOL +39.98M, ZEC +31.79M and NEAR +21.65M. This confirms the controls changed data, rather than just a label.

The inspected view did not establish the full exchange universe, exact window boundaries, timezone, source timestamp, inclusion rules or net-flow formula. These numbers therefore cannot validate numerical equality with Flow's Binance daily taker flow.

## Exchange Volume Radar

The page describes **daily synchronized/updated exchange data**. The visible snapshot was dated **2026-10-17**. The chart's BTC reference was **81,523.66**. This is exchange-level aggregate volume, not a table of individual USDT pairs.

The visible all-market KPI was **$158.2B / 24h**, with changes **−30.8% / 24h**, **+26.3% / 7D**, **−7.4% / 30D**. Breakdown: Spot **$17.73B**, Futures **$122.59B**, DEX **$2.82B**, Perps **$15.06B**. Binance Futures was the leader at **39.9%**.

Controls and chart:

- Category buttons: **Spot (7), Futures (6), DEX (3), Perps (8), All (24)**; Spot was initially selected.
- Time windows: **7D, 30D, 90D, 180D, ALL**; initial chart window was 90D.
- Aggregate display: stacked daily exchange-volume bars, exchange-colored legend, white BTC line on a second axis.
- Individual venue checkboxes toggle series. The Spot list contained Binance, OKX, Bitget, Bybit, KuCoin, Gate and Lighter Spot.
- Table: rank, exchange, type, 24h volume, share, 7-day average and 7-day change.
- Comparison mode adds `?view=compare` to the route and allows up to **8 exchanges**. The tested 7D comparison rendered categorical bars of total period volume for the selected exchanges. Although the explanatory copy mentioned separate lines, the visible result was bars. Do not treat the help text as proof of a line-chart implementation.

Spot table examples: Binance $10.17B / 57.4%, Bybit $1.92B / 10.8%, OKX $1.88B / 10.6%, Gate $1.63B / 9.2%, KuCoin $1.26B / 7.1%, Bitget $856.53M / 4.8%, Lighter Spot $4.92M / approximately 0%. These are one UI snapshot and are not independent verification of the reported exchanges' volume quality.

## Trending Sectors

The current route says **updated hourly**. Its **Top 20 Sector Performance** chart ranks **market-capitalization percentage change**, with red negative and gold positive vertical bars. Controls include **ECOSYSTEM / OTHERS** and **1D, 7D, 30D, 90D, 180D**. The default view was OTHERS / 1D. This actual route is not the FDV-sized sector treemap described by the older documentation.

The lower **Sectors Dashboard** says it tracks **150 active sectors** and shows the **top 10 tokens** for the selected sector. A separate Sector Momentum link advertises 500+ sectors and deeper flow/setup/all-token exploration; that claim was visible but the destination was outside this assignment.

The layout is a searchable, ranked sector list on the left and selected-sector details/token table on the right. The sector list shows token count, market cap and change. The token table shows logo, ticker/name, cap band, price, **24H** change and market cap.

The search `Privacy` returned Privacy (60 tokens, $55.02B), Privacy Coins (17, $31.06B) and Privacy Infrastructure (38, $18.66B). Selecting Privacy Coins populated its 17-token summary and top-10 table. Changing to 7D altered the sector-list changes to −3.97%, −0.20% and −8.66% respectively. The token table still explicitly showed **24H change**. An implementation must keep the two periods labeled rather than imply that the lower table silently inherits the sector-ranking period.

No exact source timestamp or methodology for reconstructing sector membership over historical windows was established from the visible view. Market-cap change is not proof of net cash inflow. Category overlap and changing membership remain data-model questions.

## Volume Momentum Divergence

The route defaulted to Ethereum via `?s=ethereum`. The token selector supports search; searching NEAR and selecting it changed the URL to `https://a1radar.com/charts/volume-momentum-divergence?s=near` and populated a new chart and KPIs.

| Observed token | “Xu hướng tăng tỷ lệ (3N+)” | “Đột biến volume” | Latest-price card |
| --- | ---: | ---: | ---: |
| ETH | 132 days | 25 occurrences | $2,400.74 |
| NEAR | 113 days | 25 occurrences | $4.86 |

Both charts displayed approximately March–October 2026. Legend: token price on the right axis, USD volume on the left, volume spike, Upward. Price is a gold line; volume columns use dark teal for ordinary observations, purple for spikes and green for the upward condition. The visual combines a price panel and lower volume area with aligned dates. A **Xem toàn bộ** control is present. No period buttons were visible in the inspected chart.

The final NEAR chart label was **4.8565**; ETH's chart label was **2400.3079** while its card showed $2400.74. These are distinct rendered values; the session did not establish that card and chart had identical observation timestamps. The exact ratio behind “3N+”, spike threshold, normalization, price source, volume universe and count-window rules remain unverified. Flow should publish its own formulas and units rather than assume numerical equivalence from similar colors or labels.

## Consequences for the current Flow implementation

The repository already has pair-level spot research, price-performance bubbles, public signal calculations and provider-sourced sector summaries. These observations identify separate requirements:

1. Keep price-performance bubbles and signed USDT net-flow bubbles as distinct views. For net flow, display exchange coverage, eligible pair count, window boundaries and missing history alongside aggregates.
2. Exchange Radar parity needs a separate **daily exchange aggregate history** for spot, futures, DEX and perpetuals. Existing per-pair spot rows alone do not supply the observed 24-venue chart. Venue classification and duplicate exposure require explicit rules.
3. Sector functionality should distinguish current market-cap rankings/top-token drilldown from the older FDV treemap. The blanket A1=FDV wording in `index.html` and `README.md` is too broad for the route observed here.
4. Price/volume divergence can be built from sourced price and volume histories, but spike/upward definitions must be documented, versioned and tested on actual data. A public formula is not evidence of matching A1's proprietary signal.
5. Authentication status in the existing comparison text is stale: the user has now logged in and these four free views were observed. This does not establish matching formulas or grant access to the paid price-range/holder features.

## Reference provenance and limits

Earlier supplied-media review used `/workspace/scratch/2b949121e5fc/references/` and extracted frames under `/workspace/scratch/2b949121e5fc/video-inspection/`. The full extracted conversation was read from `/workspace/scratch/2b949121e5fc/conversation-reference/2026-10-15 23-2-22-Gi_i_th_ch_giao_d_ch___nh_l__ng.md`.

The actual A1 source video `20260929-0801-13.0458009(1).mp4` (13.2s) shows sector-momentum event annotations at approximately 1–4s; the rest contains an unrelated ad. The 126.493s Sep30 livestream recording with filename beginning `🔴 Livestream Bitcoin giữ 83k` shows Smart Bands/NEAR at 1–10s, Holder Flow at 20–30s, Clustering Wallets at 40s, Token Health at 50s and Token Momentum from approximately 60s onward. These are historical media observations, separate from the current FREE-session review above. Three earlier Oct15 video files inspected were Upwork recordings, not A1 evidence.

No A1 payload, hidden application state or private endpoint was queried. UI values, source claims and visual similarity do not by themselves prove data accuracy, proprietary formula parity, wallet accumulation or strategy profitability.
