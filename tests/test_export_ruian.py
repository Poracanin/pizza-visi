"""Offline regression checks against the archived official CSV sources."""
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("export_ruian", ROOT / "scripts" / "export-ruian.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class ExportRuianTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads(exporter.DEFAULT_MANIFEST.read_text())
        cls.coverage = json.loads(exporter.DEFAULT_COVERAGE.read_text())
        cls.payload = exporter.build_payload(cls.manifest, cls.coverage)
        cls.records = {row[0]: row for row in cls.payload["records"]}

    def test_export_is_reproducible(self):
        with tempfile.TemporaryDirectory() as temporary, patch("sys.stdout", new=io.StringIO()):
            output = Path(temporary) / "addresses.json"
            exporter.export_addresses(output=output)
            self.assertEqual(output.read_bytes(), exporter.DEFAULT_OUTPUT.read_bytes())

    def test_prague_is_exact_parts_and_zlicin_overlaps(self):
        source = next(s for s in self.manifest["source_files"] if s["municipality_code"] == "554782")
        masks = {"400351": 3, "490211": 1, "400483": 2, "400394": 2, "193259": 2}
        selected = 0
        for row in exporter.read_source(source, ROOT):
            record = self.records.get(row["Kód ADM"])
            expected = masks.get(row["Kód části obce"])
            if expected is None:
                self.assertIsNone(record, f"Unlisted Prague part: {row['Název části obce']}")
            else:
                self.assertIsNotNone(record)
                self.assertEqual(record[2], expected)
                selected += 1
        self.assertEqual(selected, 3718)
        self.assertEqual(sum(row[2] == 3 for row in self.records.values()), 548)

    def test_complete_beroun_municipalities_and_popovice(self):
        codes = {"531057", "533203", "531944", "531243", "531839", "533106"}
        addresses, popovice = set(), set()
        for source in self.manifest["source_files"]:
            if source["municipality_code"] not in codes:
                continue
            for row in exporter.read_source(source, ROOT):
                addresses.add(row["Kód ADM"])
                self.assertEqual(self.records[row["Kód ADM"]][2], 4)
                if row["Kód části obce"] == "72966":
                    popovice.add(row["Kód ADM"])
        self.assertEqual(len(addresses), 9013)
        self.assertTrue(popovice)
        self.assertFalse(any("532649" == s["municipality_code"] for s in self.manifest["source_files"]))

    def test_missing_source_and_changed_archive_fail_closed(self):
        manifest = copy.deepcopy(self.manifest)
        manifest["source_files"].pop()
        with self.assertRaisesRegex(ValueError, "exactly one complete CSV"):
            exporter.build_payload(manifest, self.coverage)
        manifest = copy.deepcopy(self.manifest)
        manifest["source_files"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            exporter.build_payload(manifest, self.coverage)

    def test_incomplete_source_and_wrong_district_fail_closed(self):
        manifest = copy.deepcopy(self.manifest)
        manifest["source_files"][0]["source_row_count"] -= 1
        with self.assertRaisesRegex(ValueError, "Incomplete source row count"):
            exporter.build_payload(manifest, self.coverage)
        coverage = copy.deepcopy(self.coverage)
        coverage["branches"][0]["municipalities"][0]["districtCode"] = "3609"
        with self.assertRaisesRegex(ValueError, "Municipality name/district mismatch"):
            exporter.build_payload(self.manifest, coverage)

    def test_mixed_snapshots_do_not_replace_public_export(self):
        manifest = copy.deepcopy(self.manifest)
        source = manifest["source_files"][0]
        original = copy.deepcopy(source)
        source["data_date"] = "2026-09-30"
        source["csv_member"] = source["csv_member"].replace("20260831", "20260930")
        source["local_path"] = source["local_path"].replace("20260831", "20260930")
        read_source = exporter.read_source

        def read_fixture(entry, root):
            # Model a second valid snapshot without downloading or altering archived data.
            return read_source(original if entry["local_path"] == source["local_path"] else entry, root)

        with tempfile.TemporaryDirectory() as temporary, patch.object(exporter, "read_source", side_effect=read_fixture):
            temporary = Path(temporary)
            manifest_file, output = temporary / "manifest.json", temporary / "addresses.json"
            manifest_file.write_text(json.dumps(manifest))
            output.write_bytes(b"previous usable export")
            with self.assertRaisesRegex(ValueError, "Mixed source dates"):
                exporter.export_addresses(manifest_path=manifest_file, output=output)
            self.assertEqual(output.read_bytes(), b"previous usable export")


if __name__ == "__main__":
    unittest.main()
