import copy
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import collect_flow as flow


class FlowTests(unittest.TestCase):
    NOW = 1792135200000
    DAY_START = NOW // flow.DAY * flow.DAY
    INSTRUMENT = {"key": "binance:BTCUSDT", "sourceId": "binance", "instrument": "BTCUSDT",
                  "base": "BTC", "quote": "USDT"}

    def candles(self, count=31):
        result = []
        for i in range(count):
            start = self.DAY_START - (count - i) * flow.DAY
            price = str(100 + i)
            # Unequal quote amounts ensure the weighted calculation is tested.
            quote = str(10 * (i + 1))
            buy = str(2 * (i + 1)) if i < count - 1 else quote
            result.append([start, price, price, price, price, "1000", start + flow.DAY - 1,
                           quote, 100, "10", buy, "0"])
        return result

    def proof(self):
        return {"url": flow.BASE_URL + "klines?symbol=BTCUSDT&interval=1d&limit=32",
                "sha256": "a" * 64, "fetchedAt": self.NOW + 1000}

    def parse(self, raw=None):
        return flow.parse_daily(self.candles() if raw is None else raw, self.NOW,
                                self.INSTRUMENT, self.proof())

    def test_correct_price_endpoints_and_weighted_volume(self):
        record = self.parse()
        self.assertEqual(record["close"], 130)
        self.assertEqual(record["close7"], 123)
        self.assertAlmostEqual(record["return7"], 130 / 123 - 1)
        self.assertAlmostEqual(record["return30"], 0.3)
        self.assertEqual(record["quote7"], sum(10 * i for i in range(25, 32)))
        self.assertEqual(record["buyQuote7"], sum(2 * i for i in range(25, 31)) + 310)
        self.assertAlmostEqual(record["buyShare7"], record["buyQuote7"] / record["quote7"])
        self.assertEqual(record["firstTime"], self.DAY_START - 31 * flow.DAY)
        self.assertEqual(record["end"], self.DAY_START - 1)
        self.assertEqual(record["turnover20"], sum(10 * i for i in range(12, 32)) / 20)

    def test_current_candle_excluded_future_rejected(self):
        raw = self.candles()
        current = [self.DAY_START, "9999", "9999", "9999", "9999", "1000",
                   self.DAY_START + flow.DAY - 1, "1000", 10, "1", "10", "0"]
        self.assertEqual(self.parse(raw + [current])["close"], 130)
        current[0] += flow.DAY
        current[6] += flow.DAY
        with self.assertRaisesRegex(flow.InvalidData, "future UTC"):
            self.parse(raw + [current])

    def test_short_gap_duplicate_stale_histories_rejected(self):
        with self.assertRaisesRegex(flow.InvalidData, "at least 31"):
            self.parse(self.candles(30))
        raw = self.candles(32)
        del raw[-8]
        with self.assertRaisesRegex(flow.InvalidData, "gap"):
            self.parse(raw)
        raw = self.candles()
        with self.assertRaisesRegex(flow.InvalidData, "duplicate"):
            self.parse(raw + [raw[-1]])
        raw = self.candles(32)[:-1]
        with self.assertRaisesRegex(flow.InvalidData, "latest completed"):
            self.parse(raw)

    def test_missing_nonfinite_and_unphysical_values_rejected(self):
        for field, value in ((7, ""), (10, None), (4, "NaN"), (10, "999999"), (5, "-1")):
            with self.subTest(field=field, value=value):
                raw = self.candles()
                raw[-1][field] = value
                with self.assertRaises(flow.InvalidData):
                    self.parse(raw)
        with self.assertRaises(flow.InvalidData):
            flow.json_number(Decimal("1e1000"), "value")
        with self.assertRaises(flow.InvalidData):
            flow.json_number(Decimal("1e-1000"), "value")

    def test_zero_turnover_not_replaced_with_fake_share(self):
        raw = self.candles()
        for candle in raw[-7:]:
            candle[7] = candle[10] = "0"
        with self.assertRaisesRegex(flow.InvalidData, "no positive quote"):
            self.parse(raw)

    def test_429_stops_globally_without_another_fetch(self):
        pacer = flow.GlobalPacer(gap_seconds=0)
        fail = flow.PublicFetchError("HTTP 429", status=429, retry_after_ms=120000)
        with patch("collect_flow.public_json", side_effect=fail) as request:
            record, error = flow.collect_one(self.INSTRUMENT, self.NOW, pacer)
            skipped = flow.collect_one(self.INSTRUMENT, self.NOW, pacer)
        self.assertIsNone(record)
        self.assertEqual(error["httpStatus"], 429)
        self.assertEqual(error["retryAfterMs"], 120000)
        self.assertEqual(request.call_count, 1)
        self.assertEqual(skipped, (None, None))
        self.assertEqual(pacer.attempted, 1)

    def test_snapshot_integrity_and_preserves_previous_if_all_fail(self):
        snapshot = {"schemaVersion": 1, "sourceId": "binance", "generatedAt": self.NOW + 2000,
                    "asOf": self.NOW, "eligibleInstrumentCount": 511, "attemptedCount": 510,
                    "records": [self.parse()], "errors": []}
        flow.validate_snapshot(snapshot, self.NOW + 2000)
        flow.validate_snapshot(snapshot, self.NOW + 60 * 60 * 1000)
        broken = copy.deepcopy(snapshot)
        broken["records"][0]["return7"] = 0.5
        with self.assertRaisesRegex(flow.InvalidData, "price endpoints"):
            flow.validate_snapshot(broken, self.NOW + 2000)
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "flow-snapshot.json"
            output.write_text("previous-data")
            snapshot["records"] = []
            with patch("collect_flow.now_ms", return_value=self.NOW + 2000):
                with self.assertRaisesRegex(flow.InvalidData, "all instruments failed"):
                    flow.save_snapshot(snapshot, output)
            self.assertEqual(output.read_text(), "previous-data")

    def test_registry_declared_count_and_missing_iq_explicit(self):
        source = {"sourceId": "binance", "instrumentCount": 511, "eligibleInstrumentCount": 511,
                  "rows": [self.INSTRUMENT], "errors": [{"instrument": "IQUSDT", "message": "stale ticker"}]}
        with tempfile.TemporaryDirectory() as folder:
            p = Path(folder) / "market-snapshot.json"
            p.write_text(json.dumps({"schemaVersion": 1, "sources": [source], "generatedAt": self.NOW}))
            rows, eligible, errors, proof = flow.load_universe(p)
        self.assertEqual(eligible, 511)
        self.assertEqual(len(rows), 1)
        self.assertEqual(errors[0]["instrument"], "IQUSDT")
        self.assertEqual(errors[-1]["unavailableCount"], 510)
        self.assertRegex(proof["sha256"], r"^[0-9a-f]{64}$")

    def test_source_provided_unicode_instrument_retains_identity(self):
        row = {**self.INSTRUMENT, "key": "binance:币安人生USDT", "instrument": "币安人生USDT", "base": "币安人生"}
        source = {"sourceId": "binance", "eligibleInstrumentCount": 1, "rows": [row], "errors": []}
        with tempfile.TemporaryDirectory() as folder:
            p = Path(folder) / "market-snapshot.json"
            p.write_text(json.dumps({"schemaVersion": 1, "sources": [source], "generatedAt": self.NOW}))
            rows, _, errors, _ = flow.load_universe(p)
        self.assertEqual(rows[0]["instrument"], "币安人生USDT")
        self.assertEqual(errors, [])

    def test_raw_cache_resumes_same_day_with_original_provenance(self):
        raw = self.candles()
        body = json.dumps(raw).encode("utf-8")
        proof = {**self.proof(), "sha256": hashlib.sha256(body).hexdigest()}
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder)
            first_pacer = flow.GlobalPacer(gap_seconds=0)
            with patch("collect_flow.public_json", return_value=(raw, proof, body)) as request:
                first, error = flow.collect_one(self.INSTRUMENT, self.NOW, first_pacer, cache)
            self.assertIsNone(error)
            self.assertEqual(request.call_count, 1)
            next_pacer = flow.GlobalPacer(gap_seconds=0)
            with patch("collect_flow.now_ms", return_value=self.NOW + 20000), patch("collect_flow.public_json") as request:
                resumed, error = flow.collect_one(self.INSTRUMENT, self.NOW + 10000, next_pacer, cache)
            self.assertIsNone(error)
            request.assert_not_called()
            self.assertEqual(next_pacer.attempted, 0)
            self.assertEqual(next_pacer.cached, 1)
            self.assertEqual(resumed["provenance"], first["provenance"])
            self.assertEqual(resumed["fetchedAt"], proof["fetchedAt"])
            self.assertEqual(resumed["asOf"], self.NOW + 10000)
            # A different UTC target day must not accept yesterday's cache.
            self.assertIsNone(flow.read_cached(cache, self.INSTRUMENT, self.NOW + flow.DAY, proof["url"]))
            path = flow.cache_path(cache, self.INSTRUMENT["instrument"], self.NOW)
            corrupted = json.loads(path.read_text())
            corrupted["rawBody"] += " "
            path.write_text(json.dumps(corrupted))
            self.assertIsNone(flow.read_cached(cache, self.INSTRUMENT, self.NOW + 10000, proof["url"]))

    def test_recovery_survives_final_validation_failure(self):
        raw = self.candles()
        body = json.dumps(raw).encode("utf-8")
        proof = {**self.proof(), "sha256": hashlib.sha256(body).hexdigest()}
        clock = ({"serverTime": self.NOW}, {"fetchedAt": self.NOW + 1000}, b"{}")
        with tempfile.TemporaryDirectory() as folder:
            parent = Path(folder)
            recovery, output, cache = parent / "recovery.json", parent / "output.json", parent / "cache"
            argv = ["collect_flow.py", "--output", str(output), "--cache-dir", str(cache), "--recovery", str(recovery)]
            with patch("sys.argv", argv), patch("collect_flow.load_universe", return_value=([self.INSTRUMENT], 511, [], {})), \
                    patch("collect_flow.public_json", side_effect=[clock, (raw, proof, body)]), \
                    patch("collect_flow.now_ms", return_value=self.NOW + 2000), \
                    patch("collect_flow.save_snapshot", side_effect=flow.InvalidData("test validation rejection")):
                self.assertEqual(flow.main(), 1)
            saved = json.loads(recovery.read_text())
            self.assertTrue(saved["collectionComplete"])
            self.assertEqual(len(saved["records"]), 1)
            self.assertEqual(saved["records"][0]["provenance"]["sha256"], proof["sha256"])
            self.assertFalse(output.exists())
            self.assertTrue(flow.cache_path(cache, self.INSTRUMENT["instrument"], self.NOW).exists())

    def test_keepalive_reuses_thread_session_without_cookies_or_auth(self):
        try:
            first = flow.http_session()
            first.cookies.set("not_for_public_requests", "value")
            second = flow.http_session()
            self.assertIs(first, second)
            self.assertFalse(second.cookies)
            self.assertIsInstance(second.auth, flow.NoAuthentication)
            self.assertEqual(second.get_adapter("https://").max_retries.total, 0)
        finally:
            flow.close_sessions()


if __name__ == "__main__":
    unittest.main()
