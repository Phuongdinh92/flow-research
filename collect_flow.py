#!/usr/bin/env python3
"""Collect public Binance daily statistics across the current venue universe.

Only GET /api/v3/time and GET /api/v3/klines are used. No key, account,
strategy, score, wallet claim, order, scheduler, or exchange identity merge.

Official specification:
https://developers.binance.com/en/docs/products/spot/faqs/market_data_only
https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market

Maintainer setup: python -m pip install -r requirements-flow.txt
Run: python collect_flow.py
Website visitors use the website; they do not need Python.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from decimal import Decimal, InvalidOperation, localcontext
from email.utils import parsedate_to_datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
import time
from typing import Any
from urllib.parse import urlencode

import requests

DAY = 86_400_000
BASE_URL = "https://data-api.binance.vision/api/v3/"
SOURCE_ID = "binance"
WORKERS = 4
REQUEST_GAP_SECONDS = 0.15  # Globally <= 6.67 requests/s, not per worker.
TIMEOUT_SECONDS = 20
ROOT = Path(__file__).resolve().parent
HTTP_LOCAL = threading.local()
HTTP_SESSIONS = []
HTTP_SESSIONS_LOCK = threading.Lock()


class NoAuthentication(requests.auth.AuthBase):
    """Prevent automatic netrc/account authentication on these public GETs."""
    def __call__(self, request):
        return request


def http_session() -> requests.Session:
    session = getattr(HTTP_LOCAL, "session", None)
    if session is None:
        session = requests.Session()
        session.auth = NoAuthentication()
        session.headers.update({"Accept": "application/json", "Cache-Control": "no-cache",
                                "User-Agent": "FlowResearchPublicDaily/1.0", "Accept-Encoding": "identity"})
        session.mount("https://", requests.adapters.HTTPAdapter(pool_connections=1, pool_maxsize=1, max_retries=0))
        HTTP_LOCAL.session = session
        with HTTP_SESSIONS_LOCK:
            HTTP_SESSIONS.append(session)
    session.cookies.clear()
    return session


def close_sessions() -> None:
    with HTTP_SESSIONS_LOCK:
        for session in HTTP_SESSIONS:
            session.close()
        HTTP_SESSIONS.clear()
    if hasattr(HTTP_LOCAL, "session"):
        del HTTP_LOCAL.session


class InvalidData(ValueError):
    pass


class PublicFetchError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None,
                 retry_after_ms: int | None = None, provenance: dict | None = None):
        super().__init__(message)
        self.status = status
        self.retry_after_ms = retry_after_ms
        self.provenance = provenance


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def milliseconds(value: Any, field: str) -> int:
    if isinstance(value, bool) or not re.fullmatch(r"\d{13}", str(value)):
        raise InvalidData(f"{field}: expected a millisecond UTC timestamp")
    return int(value)


def decimal_value(value: Any, field: str) -> Decimal:
    if value is None or isinstance(value, bool) or not str(value).strip():
        raise InvalidData(f"{field}: missing numeric value")
    try:
        result = Decimal(str(value))
    except InvalidOperation as exc:
        raise InvalidData(f"{field}: invalid numeric value") from exc
    if not result.is_finite():
        raise InvalidData(f"{field}: non-finite number")
    return result


def json_number(value: Decimal, field: str) -> float:
    try:
        result = float(value)
    except (ValueError, OverflowError) as exc:
        raise InvalidData(f"{field}: outside JSON numeric range") from exc
    if not math.isfinite(result):
        raise InvalidData(f"{field}: outside JSON numeric range")
    # An extreme input must not silently turn a positive quantity into zero.
    if value != 0 and result == 0:
        raise InvalidData(f"{field}: underflows JSON numeric range")
    return result


def error_record(stage: str, message: str, instrument: str | None = None,
                 code: str = "validation", **extra: Any) -> dict:
    result = {"sourceId": SOURCE_ID, "stage": stage, "code": code, "message": message}
    if instrument:
        result["instrument"] = instrument
    result.update(extra)
    return result


def retry_after_delay(value: str | None, fetched_at: int) -> int | None:
    if value is None:
        return None
    try:
        seconds = Decimal(value)
        if seconds.is_finite() and seconds >= 0:
            return int(seconds * 1000)
    except InvalidOperation:
        pass
    try:
        return max(0, int(parsedate_to_datetime(value).timestamp() * 1000) - fetched_at)
    except (ValueError, TypeError, OverflowError):
        return None


def public_json(url: str) -> tuple[Any, dict, bytes]:
    started = now_ms()
    try:
        with http_session().get(url, timeout=(TIMEOUT_SECONDS, TIMEOUT_SECONDS),
                                stream=True, allow_redirects=False) as response:
            chunks = []
            size = 0
            for chunk in response.iter_content(chunk_size=65536):
                size += len(chunk)
                if size > 1_048_576:
                    raise InvalidData("public response exceeds size limit")
                chunks.append(chunk)
            raw = b"".join(chunks)
            fetched = now_ms()
            proof = {"url": url, "sha256": hashlib.sha256(raw).hexdigest(),
                     "startedAt": started, "fetchedAt": fetched, "httpStatus": response.status_code,
                     "bytes": len(raw)}
            if response.status_code != 200:
                delay = retry_after_delay(response.headers.get("Retry-After"), fetched)
                raise PublicFetchError(f"Public endpoint returned HTTP {response.status_code}",
                                       status=response.status_code, retry_after_ms=delay, provenance=proof)
            if "json" not in response.headers.get("Content-Type", "").lower():
                raise InvalidData("public endpoint returned a non-JSON response")
    except requests.RequestException as exc:
        raise PublicFetchError(f"Public GET failed ({type(exc).__name__})",
                               provenance={"url": url, "startedAt": started, "fetchedAt": now_ms()}) from exc
    try:
        return json.loads(raw), proof, raw
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InvalidData("public endpoint returned invalid JSON") from exc


class GlobalPacer:
    """A single clock shared by all workers, with a global stop on source blocks."""
    def __init__(self, gap_seconds: float = REQUEST_GAP_SECONDS):
        self.gap_seconds = gap_seconds
        self.lock = threading.Lock()
        self.stopped = threading.Event()
        self.next_request = 0.0
        self.attempted = 0
        self.cached = 0
        self.retry_after_ms = None
        self.blocked_status = None

    def acquire(self) -> bool:
        with self.lock:
            if self.stopped.is_set():
                return False
            delay = self.next_request - time.monotonic()
            if delay > 0 and self.stopped.wait(delay):
                return False
            if self.stopped.is_set():
                return False
            self.next_request = time.monotonic() + self.gap_seconds
            self.attempted += 1
            return True

    def stop(self, status: int | None, retry_after_ms: int | None) -> None:
        self.blocked_status = status
        self.retry_after_ms = retry_after_ms
        # Wake every waiting worker and never retry this run, including after Retry-After.
        self.stopped.set()

    def count_cached(self) -> None:
        with self.lock:
            self.cached += 1


def write_json_atomic(value: dict, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent,
                                         prefix=".flow-write-", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(value, handle, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def cache_path(directory: Path, instrument: str, server_time: int) -> Path:
    key = hashlib.sha256(instrument.encode("utf-8")).hexdigest()
    return directory / str(server_time // DAY) / (key + ".json")


def read_cached(directory: Path, instrument: dict, server_time: int, url: str) -> dict | None:
    path = cache_path(directory, instrument["instrument"], server_time)
    try:
        cached = json.loads(path.read_bytes())
        if (cached.get("sourceId") != SOURCE_ID or cached.get("instrument") != instrument["instrument"] or
                not isinstance(cached.get("rawBody"), str)):
            return None
        proof = cached.get("provenance", {})
        raw_bytes = cached["rawBody"].encode("utf-8")
        if (proof.get("url") != url or proof.get("sha256") != hashlib.sha256(raw_bytes).hexdigest() or
                not isinstance(proof.get("fetchedAt"), int) or proof["fetchedAt"] > now_ms()):
            return None
        # parse_daily rechecks exact latest UTC end, continuity and every input.
        # Original fetch clocks and source response hashes remain unchanged.
        return parse_daily(json.loads(raw_bytes), server_time, instrument, proof)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, InvalidData, AttributeError, TypeError):
        return None


def load_universe(path: Path) -> tuple[list[dict], int, list[dict], dict]:
    raw = path.read_bytes()
    try:
        snapshot = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InvalidData("market-snapshot.json is not valid JSON") from exc
    if not isinstance(snapshot, dict) or snapshot.get("schemaVersion") != 1:
        raise InvalidData("unsupported input market snapshot schema")
    sources = [s for s in snapshot.get("sources", []) if isinstance(s, dict) and s.get("sourceId") == SOURCE_ID]
    if len(sources) != 1:
        raise InvalidData("input must identify exactly one Binance source")
    source = sources[0]
    rows = source.get("rows")
    if not isinstance(rows, list) or not rows:
        raise InvalidData("no Binance spot/USDT rows available in the current registry")
    eligible = source.get("eligibleInstrumentCount", source.get("instrumentCount"))
    if isinstance(eligible, bool) or not isinstance(eligible, int) or eligible < len(rows):
        raise InvalidData("invalid eligible Binance instrument count")
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            raise InvalidData("input instrument row is not an object")
        instrument, base = row.get("instrument"), row.get("base")
        if (row.get("sourceId") != SOURCE_ID or row.get("quote") != "USDT" or
                not isinstance(instrument, str) or not 5 <= len(instrument) <= 80 or not instrument.endswith("USDT") or
                any(ord(char) < 32 for char in instrument) or
                row.get("key") != f"{SOURCE_ID}:{instrument}" or not isinstance(base, str) or not base):
            raise InvalidData("input contains an invalid Binance spot/USDT identity")
        if instrument in seen:
            raise InvalidData("input contains duplicate Binance instruments")
        seen.add(instrument)
    errors = []
    for issue in source.get("errors", []):
        if isinstance(issue, dict) and issue.get("instrument") not in seen:
            errors.append(error_record("registry", "Instrument unavailable in input venue rows: " + str(issue.get("message", "unavailable")),
                                       issue.get("instrument"), code="input_unavailable"))
    if eligible > len(rows):
        errors.append(error_record("registry", f"Input metadata declares {eligible} eligible instruments but provides {len(rows)} usable venue rows; no missing identity was invented",
                                   code="coverage_gap", unavailableCount=eligible - len(rows)))
    proof = {"file": path.name, "sha256": hashlib.sha256(raw).hexdigest(),
             "generatedAt": snapshot.get("generatedAt"), "availableVenueRows": len(rows)}
    return sorted(rows, key=lambda r: r["instrument"]), eligible, errors, proof


def parse_daily(raw: Any, server_time: int, instrument: dict, proof: dict) -> dict:
    if not isinstance(raw, list):
        raise InvalidData("klines response is not an array")
    current_day = server_time // DAY * DAY
    expected_end = current_day - 1
    bars = {}
    for row in raw:
        if not isinstance(row, list) or len(row) < 11:
            raise InvalidData("daily candle is missing required raw columns")
        start = milliseconds(row[0], "openTime")
        end = milliseconds(row[6], "closeTime")
        if start % DAY or end != start + DAY - 1:
            raise InvalidData("candle is not one complete UTC calendar day")
        if start > current_day:
            raise InvalidData("source returned a future UTC candle")
        if start == current_day:
            continue  # The current UTC day is deliberately excluded.
        if end >= server_time:
            raise InvalidData("future or unclosed candle in closed history")
        values = {name: decimal_value(row[index], name) for name, index in (
            ("open", 1), ("high", 2), ("low", 3), ("close", 4), ("volume", 5),
            ("quote", 7), ("buyBase", 9), ("buyQuote", 10))}
        if (min(values[n] for n in ("open", "high", "low", "close")) <= 0 or
                values["high"] < max(values[n] for n in ("open", "low", "close")) or
                values["low"] > min(values[n] for n in ("open", "high", "close")) or
                any(values[n] < 0 for n in ("volume", "quote", "buyBase", "buyQuote")) or
                values["buyBase"] > values["volume"] or values["buyQuote"] > values["quote"]):
            raise InvalidData("invalid daily OHLC or taker/total volume relationship")
        bar = {"time": start, "end": end, **values}
        if start in bars:
            raise InvalidData("duplicate UTC day in source candles")
        bars[start] = bar
    if len(bars) < 31:
        raise InvalidData(f"needs at least 31 closed UTC candles; received {len(bars)}")
    selected = sorted(bars.values(), key=lambda b: b["time"])[-31:]
    if selected[-1]["end"] != expected_end:
        raise InvalidData("latest completed UTC day is missing")
    if any(selected[i]["time"] - selected[i - 1]["time"] != DAY for i in range(1, 31)):
        raise InvalidData("gap in the latest 31 closed UTC days")
    with localcontext() as ctx:
        ctx.prec = 50
        quote7 = sum((bar["quote"] for bar in selected[-7:]), Decimal(0))
        buy7 = sum((bar["buyQuote"] for bar in selected[-7:]), Decimal(0))
        if quote7 <= 0:
            raise InvalidData("no positive quote turnover in the latest seven closed UTC days")
        close = selected[-1]["close"]
        close7 = selected[-8]["close"]
        close30 = selected[0]["close"]
        metrics = {
            "return7": close / close7 - 1, "return30": close / close30 - 1,
            "buyShare7": buy7 / quote7, "quote7": quote7, "buyQuote7": buy7,
            "close": close, "lastClose": close, "close7": close7, "close30": close30,
            "turnover20": sum((bar["quote"] for bar in selected[-20:]), Decimal(0)) / 20,
        }
        numeric = {name: json_number(value, name) for name, value in metrics.items()}
    return {"key": instrument["key"], "sourceId": SOURCE_ID, "instrument": instrument["instrument"],
            "base": instrument["base"], "quote": "USDT", **numeric, "end": expected_end,
            "firstTime": selected[0]["time"], "close7End": selected[-8]["end"],
            "close30End": selected[0]["end"], "quote7FirstTime": selected[-7]["time"],
            "days": 31, "asOf": server_time, "fetchedAt": proof["fetchedAt"],
            "provenance": proof}


def collect_one(instrument: dict, server_time: int, pacer: GlobalPacer,
                cache_dir: Path | None = None) -> tuple[dict | None, dict | None]:
    url = BASE_URL + "klines?" + urlencode({"symbol": instrument["instrument"], "interval": "1d", "limit": 32})
    if cache_dir is not None:
        cached = read_cached(cache_dir, instrument, server_time, url)
        if cached:
            pacer.count_cached()
            return cached, None
    if not pacer.acquire():
        return None, None
    try:
        raw, proof, body = public_json(url)
        record = parse_daily(raw, server_time, instrument, proof)
        if cache_dir is not None:
            write_json_atomic({"sourceId": SOURCE_ID, "instrument": instrument["instrument"],
                               "rawBody": body.decode("utf-8"), "provenance": proof},
                              cache_path(cache_dir, instrument["instrument"], server_time))
        return record, None
    except PublicFetchError as exc:
        if exc.status in {418, 429, 403, 451}:
            pacer.stop(exc.status, exc.retry_after_ms)
        extra = {"provenance": exc.provenance} if exc.provenance else {}
        if exc.status is not None:
            extra["httpStatus"] = exc.status
        if exc.retry_after_ms is not None:
            extra["retryAfterMs"] = exc.retry_after_ms
        return None, error_record("klines", str(exc), instrument["instrument"], code="source_error", **extra)
    except InvalidData as exc:
        return None, error_record("klines", str(exc), instrument["instrument"])
    except OSError as exc:
        return None, error_record("cache", f"Could not preserve raw public response ({type(exc).__name__})",
                                  instrument["instrument"], code="cache_error")


def validate_snapshot(snapshot: dict, observed_at: int) -> None:
    if snapshot.get("schemaVersion") != 1 or snapshot.get("sourceId") != SOURCE_ID:
        raise InvalidData("unsupported flow snapshot schema or venue")
    generated = milliseconds(snapshot.get("generatedAt"), "generatedAt")
    as_of = milliseconds(snapshot.get("asOf"), "asOf")
    if not (as_of <= generated <= observed_at):
        raise InvalidData("snapshot clock is in the future or out of order")
    # These are closed UTC-day statistics, not a real-time ticker feed. A slow
    # broad collection remains valid within the same UTC day; a run crossing
    # midnight must be recollected against the newly completed day instead.
    if observed_at // DAY != as_of // DAY:
        raise InvalidData("collection crossed a UTC day boundary; latest closed day changed")
    records = snapshot.get("records")
    if not isinstance(records, list) or not records:
        raise InvalidData("all instruments failed; previous snapshot must be preserved")
    if not (len(records) <= snapshot["attemptedCount"] <= snapshot["eligibleInstrumentCount"]):
        raise InvalidData("flow coverage counts are inconsistent")
    expected_end = as_of // DAY * DAY - 1
    seen = set()
    for row in records:
        if row["key"] in seen or row["key"] != f"{SOURCE_ID}:{row['instrument']}":
            raise InvalidData("duplicate or invalid venue instrument key")
        seen.add(row["key"])
        if row["sourceId"] != SOURCE_ID or row["quote"] != "USDT" or row["asOf"] != as_of:
            raise InvalidData("inconsistent flow venue or clock")
        if row["days"] != 31 or row["end"] != expected_end or row["firstTime"] != expected_end + 1 - 31 * DAY:
            raise InvalidData("flow record does not cover the latest 31 closed UTC days")
        if not (0 < row["fetchedAt"] <= generated):
            raise InvalidData("flow record fetch clock is out of order")
        for field in ("return7", "return30", "buyShare7", "quote7", "buyQuote7", "close", "close7", "turnover20"):
            if isinstance(row[field], bool) or not isinstance(row[field], (int, float)) or not math.isfinite(row[field]):
                raise InvalidData("missing or non-finite flow metric")
        if min(row["close"], row["close7"], row["quote7"]) <= 0 or row["turnover20"] < 0:
            raise InvalidData("invalid positive flow input")
        if not (0 <= row["buyQuote7"] <= row["quote7"] and 0 <= row["buyShare7"] <= 1):
            raise InvalidData("invalid taker buy share")
        if not math.isclose(row["return7"], row["close"] / row["close7"] - 1, rel_tol=1e-10, abs_tol=1e-12):
            raise InvalidData("seven-day return does not match price endpoints")
        if not math.isclose(row["buyShare7"], row["buyQuote7"] / row["quote7"], rel_tol=1e-10, abs_tol=1e-12):
            raise InvalidData("weighted share does not match retained volume sums")
        proof = row.get("provenance", {})
        expected_url = BASE_URL + "klines?" + urlencode({"symbol": row["instrument"], "interval": "1d", "limit": 32})
        if proof.get("url") != expected_url or not re.fullmatch(r"[0-9a-f]{64}", proof.get("sha256", "")):
            raise InvalidData("missing exact public endpoint or response hash")


def save_snapshot(snapshot: dict, output: Path) -> None:
    validate_snapshot(snapshot, now_ms())
    write_json_atomic(snapshot, output)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "data" / "market-snapshot.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "flow-snapshot.json")
    parser.add_argument("--cache-dir", type=Path, default=ROOT.parent / "flow-cache",
                        help="Scratch raw-response cache, outside the website source by default")
    parser.add_argument("--recovery", type=Path, default=ROOT.parent / "flow-snapshot-recovery.json",
                        help="Scratch checkpoint written before final validation; never a website fallback")
    args = parser.parse_args()
    try:
        universe, eligible, errors, registry_proof = load_universe(args.input)
        clock, clock_proof, _ = public_json(BASE_URL + "time")
        as_of = milliseconds(clock.get("serverTime") if isinstance(clock, dict) else None, "serverTime")
        if not (clock_proof["fetchedAt"] - 60_000 <= as_of <= clock_proof["fetchedAt"]):
            raise InvalidData("Binance clock differs from receipt clock or is in the future")
        pacer = GlobalPacer()
        records = []
        completed = 0
        def build_snapshot() -> dict:
            return {"schemaVersion": 1, "sourceId": SOURCE_ID, "generatedAt": now_ms(), "asOf": as_of,
                    "eligibleInstrumentCount": eligible, "availableInstrumentCount": len(universe),
                    "attemptedCount": pacer.attempted + pacer.cached,
                    "networkAttemptedCount": pacer.attempted, "cachedRecordCount": pacer.cached,
                    "records": sorted(records, key=lambda r: r["instrument"]), "errors": errors,
                    "registryProvenance": registry_proof, "clockProvenance": clock_proof,
                    "scope": "Binance active spot/USDT venue rows from market-snapshot; descriptive closed-day statistics only",
                    "method": {"days": 31, "interval": "1d", "timezone": "UTC", "takerBuyWindowDays": 7,
                               "return7EndpointDays": 7, "return30EndpointDays": 30,
                               "turnoverAverageDays": 20, "workers": WORKERS,
                               "minimumRequestGapMs": int(REQUEST_GAP_SECONDS * 1000),
                               "cachePolicy": "Revalidate same-UTC-day raw responses by hash; retain original fetchedAt"}}
        def checkpoint(complete: bool) -> None:
            # A local recovery checkpoint is deliberately not loaded by the UI.
            # Even a final validation failure must leave expensive observations recoverable.
            write_json_atomic({**build_snapshot(), "collectionComplete": complete,
                               "completedCount": completed}, args.recovery)
        print(f"Starting {len(universe)} available Binance instruments / {eligible} eligible; "
              f"latest closed day ends {as_of // DAY * DAY - 1}", flush=True)
        with ThreadPoolExecutor(max_workers=WORKERS) as executor:
            futures = [executor.submit(collect_one, row, as_of, pacer, args.cache_dir) for row in universe]
            for future in as_completed(futures):
                record, issue = future.result()
                completed += 1
                if record:
                    records.append(record)
                if issue:
                    errors.append(issue)
                if completed % 50 == 0 or completed == len(universe):
                    print(f"Progress {completed}/{len(universe)}; requests {pacer.attempted}; "
                          f"cached {pacer.cached}; valid {len(records)}; errors {len(errors)}", flush=True)
                checkpoint(False)
        if pacer.stopped.is_set():
            errors.append(error_record("collection", "Source blocked requests; stopped all subsequent requests without retry or fallback",
                                       code="source_stopped", httpStatus=pacer.blocked_status,
                                       retryAfterMs=pacer.retry_after_ms,
                                       unattemptedCount=len(universe) - pacer.attempted - pacer.cached))
        checkpoint(True)
        snapshot = build_snapshot()
        save_snapshot(snapshot, args.output)
        print(f"Saved {len(records)} records; {pacer.attempted + pacer.cached} checked / {eligible} eligible "
              f"({pacer.attempted} network requests, {pacer.cached} revalidated cached records); "
              f"{len(errors)} errors: {args.output}", flush=True)
        for issue in errors:
            print(json.dumps(issue, ensure_ascii=False), flush=True)
        return 0
    except (InvalidData, PublicFetchError, OSError) as exc:
        print(f"Flow snapshot not replaced: {exc}", file=sys.stderr, flush=True)
        return 1
    finally:
        close_sessions()


if __name__ == "__main__":
    raise SystemExit(main())
