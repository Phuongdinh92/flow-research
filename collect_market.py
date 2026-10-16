#!/usr/bin/env python3
"""Collect an auditable, read-only public spot/USDT market snapshot.

No API key, account, orders, signals, asset merging, or inferred owner identity.
Run: python collect_market.py
Test the validation/failure boundaries: python collect_market.py --self-test

Official endpoint specifications:
https://developers.binance.com/en/docs/products/spot/faqs/market_data_only
https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/general
https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market
https://www.bitget.com/docs/catalog/market/market-data
https://www.bitget.com/docs/catalog/classic-spot-market/classic-spot-market
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from typing import Any
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

TTL_MS = 15 * 60 * 1000
TIMEOUT_SECONDS = 20
MAX_RESPONSE_BYTES = 32 * 1024 * 1024
MIN_TIMESTAMP = 946684800000
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "data" / "market-snapshot.json"
BINANCE_BASE = "https://data-api.binance.vision"
BITGET_BASE = "https://api.bitget.com"


def now_ms() -> int:
    return time.time_ns() // 1_000_000


class ValidationError(ValueError):
    pass


def finite_number(value: Any, field: str) -> float:
    if value is None or isinstance(value, bool) or not str(value).strip():
        raise ValidationError(f"{field}: missing numeric value")
    try:
        result = float(value)
    except (ValueError, TypeError, OverflowError) as exc:
        raise ValidationError(f"{field}: invalid numeric value") from exc
    if not math.isfinite(result):
        raise ValidationError(f"{field}: non-finite value")
    return result


def timestamp(value: Any, observed_at: int, field: str) -> int:
    if isinstance(value, bool) or not re.fullmatch(r"\d{13}", str(value)):
        raise ValidationError(f"{field}: expected millisecond timestamp")
    result = int(value)
    if result < MIN_TIMESTAMP or result > observed_at:
        raise ValidationError(f"{field}: timestamp outside observed time range")
    if observed_at - result > TTL_MS:
        raise ValidationError(f"{field}: older than {TTL_MS // 60000}-minute freshness limit")
    return result


def text_field(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 80:
        raise ValidationError(f"{field}: invalid instrument identifier")
    if not all(char.isalnum() or char in '_.-' for char in value):
        raise ValidationError(f"{field}: unsupported character in identifier")
    return value


def problem(source_id: str, stage: str, message: str, instrument: str | None = None,
            code: str = "validation") -> dict:
    result = {"sourceId": source_id, "stage": stage, "code": code, "message": message}
    if instrument:
        result["instrument"] = instrument
    return result


def fetch_json(url: str, label: str) -> tuple[Any, dict]:
    """Only public GETs. Persist safe response metadata, never cookies or a body."""
    request = Request(url, headers={"Accept": "application/json", "Cache-Control": "no-cache",
                                    "User-Agent": "FlowResearchPublicSnapshot/1.0"}, method="GET")
    started = now_ms()
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            fetched = now_ms()
            if len(raw) > MAX_RESPONSE_BYTES:
                raise ValidationError("public response exceeds size limit")
            content_type = response.headers.get("Content-Type", "").lower()
            if "json" not in content_type:
                raise ValidationError("public endpoint did not return JSON")
            provenance = {
                "endpoint": label, "url": url, "method": "GET", "startedAt": started,
                "fetchedAt": fetched, "httpStatus": response.status,
                "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw),
                "serverDate": response.headers.get("Date"),
                "cacheControl": response.headers.get("Cache-Control"),
            }
    except HTTPError as exc:
        # Do not retain the body or headers: error payloads may contain edge cookies.
        raise RuntimeError(f"{label}: public GET returned HTTP {exc.code}") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise RuntimeError(f"{label}: public GET failed ({type(exc).__name__})") from exc
    try:
        return json.loads(raw), provenance
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValidationError(f"{label}: invalid JSON body") from exc


def base_source(source_id: str, name: str) -> dict:
    return {
        "sourceId": source_id, "name": name, "asOf": None, "fetchedAt": None,
        "instrumentCount": 0, "eligibleInstrumentCount": 0, "rows": [],
        "errors": [], "status": "error", "ttlMs": TTL_MS, "expiresAt": None,
        "scope": {"market": "spot", "quote": "USDT", "venueSeparated": True},
        "excludedCounts": {}, "provenance": [],
    }


def registry_binance(payload: Any) -> tuple[dict, dict]:
    if not isinstance(payload, dict) or not isinstance(payload.get("symbols"), list):
        raise ValidationError("exchangeInfo: symbols array missing")
    registry, excluded = {}, {"notActive": 0, "nonUsdt": 0, "notSpotAllowed": 0}
    for item in payload["symbols"]:
        if not isinstance(item, dict):
            raise ValidationError("exchangeInfo: invalid symbol object")
        if item.get("status") != "TRADING":
            excluded["notActive"] += 1
            continue
        if item.get("quoteAsset") != "USDT":
            excluded["nonUsdt"] += 1
            continue
        if item.get("isSpotTradingAllowed") is not True:
            excluded["notSpotAllowed"] += 1
            continue
        symbol = text_field(item.get("symbol"), "symbol")
        if symbol in registry:
            raise ValidationError("exchangeInfo: duplicate active instrument")
        registry[symbol] = {"base": text_field(item.get("baseAsset"), "baseAsset"), "quote": "USDT"}
    if not registry:
        raise ValidationError("exchangeInfo: no eligible active spot/USDT instruments")
    return registry, excluded


def bitget_envelope(payload: Any, observed_at: int) -> list:
    if not isinstance(payload, dict) or payload.get("code") != "00000":
        raise ValidationError("Bitget: expected successful public response code 00000")
    timestamp(payload.get("requestTime"), observed_at, "requestTime")
    if not isinstance(payload.get("data"), list):
        raise ValidationError("Bitget: data array missing")
    return payload["data"]


def registry_bitget(payload: Any, observed_at: int) -> tuple[dict, dict]:
    items = bitget_envelope(payload, observed_at)
    registry, excluded = {}, {"notSpot": 0, "notActive": 0, "nonUsdt": 0, "nonCrypto": 0,
                              "missingCryptoClassification": 0}
    for item in items:
        if not isinstance(item, dict):
            raise ValidationError("instruments: invalid instrument object")
        if item.get("category") != "SPOT":
            excluded["notSpot"] += 1
            continue
        if item.get("status") != "online":
            excluded["notActive"] += 1
            continue
        if item.get("quoteCoin") != "USDT":
            excluded["nonUsdt"] += 1
            continue
        # areaSymbol means regional area, not an asset type. Use explicit V3 types.
        types = (item.get("symbolType"), item.get("instrumentType"))
        if None in types or "" in types:
            excluded["missingCryptoClassification"] += 1
            continue
        if types != ("crypto", "crypto"):
            excluded["nonCrypto"] += 1
            continue
        symbol = text_field(item.get("symbol"), "symbol")
        if symbol in registry:
            raise ValidationError("instruments: duplicate active instrument")
        registry[symbol] = {"base": text_field(item.get("baseCoin"), "baseCoin"), "quote": "USDT"}
    if not registry:
        raise ValidationError("instruments: no eligible active crypto spot/USDT instruments")
    return registry, excluded


def normalize_rows(source_id: str, registry: dict, tickers: Any, observed_at: int) -> tuple[list, list]:
    if not isinstance(tickers, list):
        raise ValidationError("tickers: array missing")
    errors, index, duplicates = [], {}, set()
    for ticker in tickers:
        if not isinstance(ticker, dict):
            raise ValidationError("tickers: invalid ticker object")
        instrument = ticker.get("symbol")
        if instrument not in registry:
            continue
        if instrument in index:
            duplicates.add(instrument)
        index[instrument] = ticker
    rows = []
    for instrument, item in sorted(registry.items()):
        try:
            if instrument in duplicates:
                raise ValidationError("duplicate ticker for active instrument")
            ticker = index.get(instrument)
            if ticker is None:
                raise ValidationError("active instrument missing from ticker response")
            last = finite_number(ticker.get("lastPrice" if source_id == "binance" else "lastPr"), "last")
            change = finite_number(ticker.get("priceChangePercent" if source_id == "binance" else "change24h"), "return24")
            if source_id == "binance":
                change /= 100.0  # Binance percentage points; Bitget change24h is already a fraction.
            turnover = finite_number(ticker.get("quoteVolume"), "turnover24")
            as_of = timestamp(ticker.get("closeTime" if source_id == "binance" else "ts"), observed_at, "asOf")
            if last <= 0 or turnover < 0 or change < -1:
                raise ValidationError("invalid price, turnover, or trailing return range")
            rows.append({"key": f"{source_id}:{instrument}", "sourceId": source_id,
                         "instrument": instrument, "base": item["base"], "quote": item["quote"],
                         "last": last, "return24": change, "turnover24": turnover, "asOf": as_of})
        except ValidationError as exc:
            errors.append(problem(source_id, "ticker", str(exc), instrument))
    return rows, errors


def collect_source(source_id: str) -> dict:
    source = base_source(source_id, "Binance" if source_id == "binance" else "Bitget")
    source["endpointUrls"] = (
        {"metadata": BINANCE_BASE + "/api/v3/exchangeInfo?permissions=SPOT&showPermissionSets=false", "tickers": BINANCE_BASE + "/api/v3/ticker/24hr"}
        if source_id == "binance" else
        {"metadata": BITGET_BASE + "/api/v3/market/instruments?category=SPOT",
         "tickers": BITGET_BASE + "/api/v2/spot/market/tickers"}
    )
    source["scope"]["eligibility"] = (
        "exchangeInfo: status TRADING, isSpotTradingAllowed true, quoteAsset USDT"
        if source_id == "binance" else
        "instruments: category SPOT, status online, quoteCoin USDT, symbolType crypto, instrumentType crypto"
    )
    if source_id == "bitget":
        source["scope"]["nonCryptoExcluded"] = True
        source["scope"]["classification"] = "Explicit V3 symbolType and instrumentType; not inferred from areaSymbol"
    stage = "metadata"
    try:
        if source_id == "binance":
            meta, proof = fetch_json(source["endpointUrls"]["metadata"], "exchangeInfo")
            source["provenance"].append(proof)
            timestamp(meta.get("serverTime") if isinstance(meta, dict) else None, proof["fetchedAt"], "serverTime")
            registry, excluded = registry_binance(meta)
        else:
            meta, proof = fetch_json(source["endpointUrls"]["metadata"], "instruments")
            source["provenance"].append(proof)
            registry, excluded = registry_bitget(meta, proof["fetchedAt"])
        source["eligibleInstrumentCount"] = len(registry)
        source["instrumentCount"] = len(registry)
        source["excludedCounts"] = excluded
        stage = "tickers"
        url = source["endpointUrls"]["tickers"]
        tickers, proof = fetch_json(url, "ticker/24hr" if source_id == "binance" else "tickers")
        source["provenance"].append(proof)
        source["fetchedAt"] = proof["fetchedAt"]
        if source_id == "bitget":
            tickers = bitget_envelope(tickers, proof["fetchedAt"])
        rows, errors = normalize_rows(source_id, registry, tickers, proof["fetchedAt"])
        source["rows"], source["errors"] = rows, errors
        if rows:
            source["asOf"] = min(row["asOf"] for row in rows)
            source["expiresAt"] = source["asOf"] + TTL_MS
            source["status"] = "partial" if errors else "ok"
        else:
            source["errors"].append(problem(source_id, "tickers", "No usable fresh ticker rows", code="empty"))
    except (ValidationError, RuntimeError) as exc:
        source["errors"].append(problem(source_id, stage, str(exc), code="source_error"))
    if source["fetchedAt"] is None and source["provenance"]:
        source["fetchedAt"] = source["provenance"][-1]["fetchedAt"]
    return source


def validate_snapshot(snapshot: dict, observed_at: int) -> None:
    if snapshot.get("schemaVersion") != 1 or snapshot.get("ttlMs") != TTL_MS:
        raise ValidationError("unsupported snapshot schema or freshness limit")
    generated = timestamp(snapshot.get("generatedAt"), observed_at, "generatedAt")
    sources = snapshot.get("sources")
    if not isinstance(sources, list) or len(sources) != 2:
        raise ValidationError("snapshot must contain both venue source reports")
    if {source.get("sourceId") for source in sources} != {"binance", "bitget"}:
        raise ValidationError("invalid or duplicate source IDs")
    if not isinstance(snapshot.get("errors"), list):
        raise ValidationError("snapshot errors report missing")
    keys, successes = set(), 0
    for source in sources:
        sid, rows = source["sourceId"], source.get("rows")
        if not isinstance(rows, list) or source.get("instrumentCount") != source.get("eligibleInstrumentCount"):
            raise ValidationError("instrumentCount must equal the eligible registry count")
        if len(rows) > source["instrumentCount"]:
            raise ValidationError("row count exceeds eligible instruments")
        if source.get("status") not in {"ok", "partial", "error"}:
            raise ValidationError("invalid source status")
        if not isinstance(source.get("errors"), list):
            raise ValidationError("source errors report missing")
        if rows:
            successes += 1
            if source["status"] == "error":
                raise ValidationError("error source cannot contain usable rows")
            timestamp(source["asOf"], generated, "source.asOf")
            timestamp(source["fetchedAt"], generated, "source.fetchedAt")
            if source["expiresAt"] != source["asOf"] + TTL_MS:
                raise ValidationError("source freshness expiry mismatch")
            if source["asOf"] != min(row["asOf"] for row in rows):
                raise ValidationError("source asOf must represent its oldest included row")
            if len(source.get("provenance", [])) != 2:
                raise ValidationError("successful source requires metadata and ticker response provenance")
        elif source["status"] != "error":
            raise ValidationError("empty source must report error")
        if len(rows) > source["eligibleInstrumentCount"]:
            raise ValidationError("returned more rows than eligible instruments")
        for row in rows:
            if row["key"] in keys or row["key"] != f"{sid}:{row['instrument']}" or row["sourceId"] != sid:
                raise ValidationError("duplicate or unnamespaced venue key")
            keys.add(row["key"])
            if row["quote"] != "USDT":
                raise ValidationError("unexpected quote asset")
            timestamp(row["asOf"], generated, "row.asOf")
            for field in ("last", "return24", "turnover24"):
                finite_number(row[field], field)
            if row["last"] <= 0 or row["turnover24"] < 0 or row["return24"] < -1:
                raise ValidationError("invalid normalized market values")
        for proof in source.get("provenance", []):
            if not re.fullmatch(r"[0-9a-f]{64}", proof.get("sha256", "")):
                raise ValidationError("missing raw response SHA256 provenance")
            if proof.get("method") != "GET" or not proof.get("url", "").startswith("https://"):
                raise ValidationError("invalid public endpoint provenance")
    if not successes:
        raise ValidationError("all sources failed; previous snapshot must be preserved")


def save_snapshot(snapshot: dict, output: Path) -> None:
    validate_snapshot(snapshot, now_ms())
    output.parent.mkdir(parents=True, exist_ok=True)
    # Validation completes before replacing the last good snapshot. os.replace is atomic.
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent,
                                         prefix=".market-snapshot-", suffix=".tmp", delete=False) as handle:
            temp_path = Path(handle.name)
            json.dump(snapshot, handle, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, output)
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink()


class ValidationTests(unittest.TestCase):
    NOW = 1792132100000

    def test_missing_values_and_nonfinite_are_not_zero(self):
        for value in (None, "", " ", True, "NaN", "inf", "nonsense"):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                finite_number(value, "last")
        self.assertEqual(finite_number("0", "turnover24"), 0)

    def test_timestamp_rejects_future_stale_and_seconds(self):
        for value in (self.NOW + 1, self.NOW - TTL_MS - 1, self.NOW // 1000, None):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                timestamp(value, self.NOW, "asOf")

    def test_venue_keys_and_return_units(self):
        registry = {"BTCUSDT": {"base": "BTC", "quote": "USDT"}}
        binance, err = normalize_rows("binance", registry, [{"symbol": "BTCUSDT", "lastPrice": "100",
            "priceChangePercent": "2", "quoteVolume": "10", "closeTime": self.NOW}], self.NOW)
        bitget, other = normalize_rows("bitget", registry, [{"symbol": "BTCUSDT", "lastPr": "100",
            "change24h": "0.02", "quoteVolume": "10", "ts": str(self.NOW)}], self.NOW)
        self.assertFalse(err or other)
        self.assertEqual(binance[0]["return24"], bitget[0]["return24"])
        self.assertNotEqual(binance[0]["key"], bitget[0]["key"])

    def test_duplicates_missing_and_stale_rows_are_dropped(self):
        registry = {s: {"base": s.removesuffix("USDT"), "quote": "USDT"} for s in
                    ("BTCUSDT", "ETHUSDT", "WUSDT")}
        ticker = {"symbol": "BTCUSDT", "lastPrice": "100", "priceChangePercent": "2",
                  "quoteVolume": "10", "closeTime": self.NOW}
        stale = {**ticker, "symbol": "ETHUSDT", "closeTime": self.NOW - TTL_MS - 1}
        rows, errors = normalize_rows("binance", registry, [ticker, ticker, stale], self.NOW)
        self.assertEqual(rows, [])
        self.assertEqual(len(errors), 3)

    def test_crypto_type_does_not_infer_from_regional_area(self):
        item = {"symbol": "BTCUSDT", "baseCoin": "BTC", "quoteCoin": "USDT", "category": "SPOT",
                "status": "online", "symbolType": "crypto", "instrumentType": "crypto", "areaSymbol": "yes"}
        stock = {**item, "symbol": "STOCKUSDT", "symbolType": "stock", "instrumentType": "stock", "areaSymbol": "no"}
        registry, excluded = registry_bitget({"code": "00000", "requestTime": self.NOW,
                                             "data": [item, stock]}, self.NOW)
        self.assertEqual(list(registry), ["BTCUSDT"])
        self.assertEqual(excluded["nonCrypto"], 1)

    def test_all_failed_preserves_previous_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "market-snapshot.json"
            output.write_text("previous-good-snapshot\n")
            snapshot = {"schemaVersion": 1, "generatedAt": now_ms(), "ttlMs": TTL_MS,
                        "sources": [base_source("binance", "Binance"), base_source("bitget", "Bitget")],
                        "errors": []}
            with self.assertRaises(ValidationError):
                save_snapshot(snapshot, output)
            self.assertEqual(output.read_text(), "previous-good-snapshot\n")

    def test_source_outage_reports_endpoint_and_keeps_rows_empty(self):
        with patch(__name__ + ".fetch_json", side_effect=RuntimeError("public GET returned HTTP 429")):
            source = collect_source("bitget")
        self.assertEqual(source["status"], "error")
        self.assertEqual(source["rows"], [])
        self.assertEqual(source["errors"][0]["stage"], "metadata")
        self.assertEqual(source["endpointUrls"]["metadata"],
                         "https://api.bitget.com/api/v3/market/instruments?category=SPOT")

    def test_schema_requires_response_provenance_before_writing(self):
        source = base_source("binance", "Binance")
        source.update({"status": "ok", "asOf": self.NOW, "fetchedAt": self.NOW,
                       "expiresAt": self.NOW + TTL_MS, "eligibleInstrumentCount": 1,
                       "instrumentCount": 1,
                       "rows": [{"key": "binance:BTCUSDT", "sourceId": "binance", "instrument": "BTCUSDT",
                                 "base": "BTC", "quote": "USDT", "last": 100, "return24": 0.02,
                                 "turnover24": 10, "asOf": self.NOW}]})
        snapshot = {"schemaVersion": 1, "generatedAt": self.NOW, "ttlMs": TTL_MS,
                    "sources": [source, base_source("bitget", "Bitget")], "errors": []}
        with self.assertRaisesRegex(ValidationError, "response provenance"):
            validate_snapshot(snapshot, self.NOW)

    def test_partial_coverage_uses_registry_denominator_and_allows_other_source_outage(self):
        source = base_source("binance", "Binance")
        source.update({"status": "partial", "asOf": self.NOW, "fetchedAt": self.NOW,
                       "expiresAt": self.NOW + TTL_MS, "eligibleInstrumentCount": 2,
                       "instrumentCount": 2,
                       "rows": [{"key": "binance:币安人生USDT", "sourceId": "binance", "instrument": "币安人生USDT",
                                 "base": "币安人生", "quote": "USDT", "last": 100, "return24": 0.02,
                                 "turnover24": 10, "asOf": self.NOW}],
                       "provenance": [{"sha256": "a"*64, "method": "GET", "url": "https://example.test/meta"},
                                      {"sha256": "b"*64, "method": "GET", "url": "https://example.test/tickers"}]})
        snapshot = {"schemaVersion": 1, "generatedAt": self.NOW, "ttlMs": TTL_MS,
                    "sources": [source, base_source("bitget", "Bitget")], "errors": []}
        validate_snapshot(snapshot, self.NOW)
        self.assertEqual(len(source["rows"]), 1)
        self.assertEqual(source["instrumentCount"], 2)
        self.assertEqual(text_field("币安人生USDT", "instrument"), "币安人生USDT")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--self-test", action="store_true", help="Run offline validation unit tests only")
    args = parser.parse_args()
    if args.self_test:
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ValidationTests))
        return 0 if result.wasSuccessful() else 1
    with ThreadPoolExecutor(max_workers=2) as pool:
        sources = list(pool.map(collect_source, ("binance", "bitget")))
    snapshot = {"schemaVersion": 1, "generatedAt": now_ms(), "ttlMs": TTL_MS,
                "scope": "Public crypto spot/USDT instruments on the named venues; not whole-market coverage",
                "sources": sources, "errors": [error for source in sources for error in source["errors"]]}
    for source in sources:
        print(f"{source['sourceId']}: {source['status']}; {len(source['rows'])}/{source['eligibleInstrumentCount']} "
              f"eligible rows; {len(source['errors'])} errors; exclusions={source['excludedCounts']}")
        for error in source["errors"][:5]:
            print("  " + json.dumps(error, ensure_ascii=False))
    try:
        save_snapshot(snapshot, args.output)
    except ValidationError as exc:
        print(f"Snapshot not replaced: {exc}", file=sys.stderr)
        return 1
    print(f"Saved validated public snapshot: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
