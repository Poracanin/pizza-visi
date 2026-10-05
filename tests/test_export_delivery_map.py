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
        self.assertEqual(len(self.features), 33)
        self.assertEqual(sum(f["properties"]["territoryType"] == "municipality"
                             for f in self.features.values()), 26)
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
        self.assertEqual(counts, {"rudna": 15, "hostivice": 13, "beroun": 6})

    def test_added_municipalities_belong_to_rudna(self):
        for code, name in [("539180", "Dobříč"), ("531537", "Mezouň"), ("531464", "Loděnice")]:
            props = self.features[f"municipality-{code}"]["properties"]
            self.assertEqual(props["name"], name)
            self.assertEqual(props["branchIds"], ["rudna"])

    def test_vysoky_ujezd_and_kuchar_remain_covered_but_kozolupy_do_not(self):
        self.assertNotIn("municipality-531961", self.features)
        self.assertNotIn("part-71960", self.features)
        for code, name, cadastre in [("188441", "Vysoký Újezd", "788449"), ("76945", "Kuchař", "676942")]:
            props = self.features[f"part-{code}"]["properties"]
            self.assertEqual(props["name"], name)
            self.assertEqual(props["cadastralCode"], cadastre)
            self.assertEqual(props["branchIds"], ["rudna"])
        excluded_source = next(source for source in self.manifest["reference_sources"]
                               if source["local_path"].endswith("/excluded-parts.geojson"))
        kozolupy = exporter.source_features(excluded_source, ROOT)["71960"]
        self.assertEqual(kozolupy["properties"], {"kod": 71960, "nazev": "Kozolupy", "obec": 531961})
        point = kozolupy["geometry"]["coordinates"]
        self.assertFalse(any(exporter.contains_point(f["geometry"], point) for f in self.features.values()))
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
        manifest["part_cadastre_mapping"][0]["cadastral_code"] = "729701"
        cases.append((manifest, self.coverage, "match archived"))
        manifest = copy.deepcopy(self.manifest)
        manifest["part_cadastre_mapping"][-2]["cadastral_name"] = "Vysoký Újezd"
        cases.append((manifest, self.coverage, "name or parent mismatch"))
        manifest = copy.deepcopy(self.manifest)
        manifest["part_cadastre_mapping"][-1]["municipality_name"] = "Praha"
        cases.append((manifest, self.coverage, "name or parent mismatch"))
        for manifest, coverage, expected in cases:
            with self.subTest(expected=expected), self.assertRaisesRegex(ValueError, expected):
                exporter.build_payload(manifest, coverage)

    def test_definition_point_outside_cadastre_is_rejected(self):
        original = exporter.source_features

        def moved_part(source, root):
            features = original(source, root)
            if source["local_path"].endswith("/municipality-parts.geojson"):
                features["188441"]["geometry"]["coordinates"] = [14.194305931701765, 49.97355435936786]
            return features

        with patch.object(exporter, "source_features", side_effect=moved_part):
            with self.assertRaisesRegex(ValueError, "definition point lies outside"):
                exporter.build_payload(self.manifest, self.coverage)

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
