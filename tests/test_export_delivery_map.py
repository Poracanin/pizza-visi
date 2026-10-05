"""Offline checks for complete, reproducible branch boundaries and safe failures."""

import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("export_delivery_map", ROOT / "scripts" / "export-delivery-map.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class ExportDeliveryMapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads(exporter.DEFAULT_MANIFEST.read_text())
        cls.coverage = json.loads(exporter.DEFAULT_COVERAGE.read_text())
        cls.payload = exporter.build_payload(cls.manifest, cls.coverage)
        cls.features = {f["properties"]["id"]: f for f in cls.payload["features"]}

    def test_export_is_reproducible_and_small(self):
        with tempfile.TemporaryDirectory() as temporary, patch("sys.stdout", new=io.StringIO()):
            output = Path(temporary) / "areas.geojson"
            exporter.export_map(output=output)
            self.assertEqual(output.read_bytes(), exporter.DEFAULT_OUTPUT.read_bytes())
            self.assertLess(output.stat().st_size, 400_000)

    def test_all_localities_and_shared_zlicin_without_all_of_prague(self):
        self.assertEqual(len(self.features), 29)
        self.assertEqual(sum(f["properties"]["territoryType"] == "municipality"
                             for f in self.features.values()), 24)
        self.assertNotIn("municipality-554782", self.features)
        self.assertNotIn("part-72966", self.features)  # Popovice within Králův Dvůr.
        expected_parts = {
            "400351": ("Zličín", "793264", ["rudna", "hostivice"]),
            "490211": ("Třebonice", "770353", ["rudna"]),
            "400483": ("Řepy", "729701", ["hostivice"]),
            "400394": ("Ruzyně", "729710", ["hostivice"]),
            "193259": ("Sobín", "793256", ["hostivice"]),
        }
        for code, (name, cadastre, branches) in expected_parts.items():
            props = self.features[f"part-{code}"]["properties"]
            self.assertEqual(props["name"], f"Praha – {name}")
            self.assertEqual(props["cadastralCode"], cadastre)
            self.assertEqual(props["branchIds"], branches)
            self.assertEqual(props["territoryType"], "cadastral")
        counts = {branch: sum(branch in f["properties"]["branchIds"]
                              for f in self.features.values()) for branch in exporter.BRANCHES}
        self.assertEqual(counts, {"rudna": 11, "hostivice": 13, "beroun": 6})

    def test_multipart_municipality_is_preserved(self):
        shape = self.features["municipality-531961"]["geometry"]
        self.assertEqual(shape["type"], "MultiPolygon")
        self.assertGreater(len(shape["coordinates"]), 1)
        for feature in self.features.values():
            exporter.validate_geometry(feature["geometry"])

    def test_wrong_identity_missing_source_and_changed_archive_fail_closed(self):
        cases = []
        manifest = copy.deepcopy(self.manifest)
        manifest["sources"][0]["sha256"] = "0" * 64
        cases.append((manifest, self.coverage, "checksum mismatch"))
        manifest = copy.deepcopy(self.manifest)
        manifest["sources"][0]["feature_count"] -= 1
        cases.append((manifest, self.coverage, "Incomplete boundary"))
        coverage = copy.deepcopy(self.coverage)
        coverage["branches"][0]["municipalities"][0]["districtCode"] = "3609"
        cases.append((self.manifest, coverage, "identity/district mismatch"))
        coverage = copy.deepcopy(self.coverage)
        coverage["branches"][0]["municipalities"].pop()
        cases.append((self.manifest, coverage, "match configured"))
        manifest = copy.deepcopy(self.manifest)
        manifest["prague_part_cadastre_mapping"][0]["cadastral_code"] = "729701"
        cases.append((manifest, self.coverage, "match archived"))
        for manifest, coverage, expected in cases:
            with self.subTest(expected=expected), self.assertRaisesRegex(ValueError, expected):
                exporter.build_payload(manifest, coverage)

    def test_bad_geometry_is_rejected(self):
        for geometry in [
            {"type": "Point", "coordinates": [14.1, 50.0]},
            {"type": "Polygon", "coordinates": []},
            {"type": "Polygon", "coordinates": [[[14, 50], [14.1, 50], [14, 50.1]]]},
            {"type": "Polygon", "coordinates": [[[50, 14], [50.1, 14], [50, 14.1], [50, 14]]]},
            {"type": "Polygon", "coordinates": [[[14, 50], [14.1, 50], [14.2, 50], [14, 50]]]},
        ]:
            with self.subTest(geometry=geometry), self.assertRaises(ValueError):
                exporter.validate_geometry(geometry)

    def test_validation_failure_preserves_usable_public_export(self):
        manifest = copy.deepcopy(self.manifest)
        manifest["sources"][0]["sha256"] = "0" * 64
        with tempfile.TemporaryDirectory() as temporary:
            temporary = Path(temporary)
            source, output = temporary / "manifest.json", temporary / "map.geojson"
            source.write_text(json.dumps(manifest))
            output.write_bytes(b"previous usable map")
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                exporter.export_map(manifest_path=source, output=output)
            self.assertEqual(output.read_bytes(), b"previous usable map")


if __name__ == "__main__":
    unittest.main()
