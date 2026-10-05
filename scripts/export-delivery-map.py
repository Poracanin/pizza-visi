#!/usr/bin/env python3
"""Build the delivery map offline from archived official ČÚZK boundaries.

The address database remains authoritative for delivery eligibility. Municipality
parts have only definition points in RÚIAN, so explicitly verified cadastral
territories are used for an approximate overview map.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST = ROOT / "RUIAN-delivery-data" / "map" / "source-manifest.json"
DEFAULT_COVERAGE = ROOT / "scripts" / "ruian-delivery-coverage.json"
DEFAULT_OUTPUT = ROOT / "public" / "data" / "delivery-areas.geojson"
BRANCHES = ("rudna", "hostivice", "beroun")


def read_source(source, root):
    path = root / source["local_path"]
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != source["sha256"]:
        raise ValueError(f"Source checksum mismatch: {path}")
    return json.loads(content)


def source_features(source, root):
    payload = read_source(source, root)
    features = payload.get("features", [])
    if (payload.get("type") != "FeatureCollection" or not features
            or payload.get("exceededTransferLimit")
            or len(features) != source.get("feature_count", len(features))):
        raise ValueError("Incomplete boundary source")
    result = {}
    for feature in features:
        code = str(feature["properties"]["kod"])
        if not code.isdecimal() or code in result:
            raise ValueError("Invalid or duplicate source code")
        result[code] = feature
    return result


def validate_geometry(geometry):
    """Catch wrong CRS, truncated rings and unrelated geographies before export."""
    if not isinstance(geometry, dict) or geometry.get("type") not in ("Polygon", "MultiPolygon"):
        raise ValueError("Expected Polygon or MultiPolygon boundary")
    coordinates = geometry.get("coordinates", [])
    polygons = [coordinates] if geometry["type"] == "Polygon" else coordinates
    if not polygons:
        raise ValueError("Empty boundary geometry")
    for polygon in polygons:
        if not polygon:
            raise ValueError("Empty boundary polygon")
        for ring in polygon:
            if len(ring) < 4 or ring[0] != ring[-1]:
                raise ValueError("Unclosed or truncated boundary ring")
            for point in ring:
                if len(point) != 2 or any(isinstance(x, bool) or not isinstance(x, (int, float))
                                           or not math.isfinite(x) for x in point):
                    raise ValueError("Invalid boundary coordinate")
                if not (13.8 <= point[0] <= 14.5 and 49.8 <= point[1] <= 50.3):
                    raise ValueError("Boundary outside expected delivery region or wrong CRS")
            area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:]))
            if abs(area) < 1e-12:
                raise ValueError("Degenerate boundary ring")


def contains_point(geometry, point):
    """Match a part's official definition point to its proposed cadastral area."""
    def in_ring(ring):
        x, y = point
        inside = False
        for (ax, ay), (bx, by) in zip(ring, ring[1:]):
            if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
                inside = not inside
        return inside

    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    return any(in_ring(polygon[0]) and not any(in_ring(hole) for hole in polygon[1:])
               for polygon in polygons)


def build_payload(manifest, coverage, root=ROOT):
    if manifest.get("manifest_version") != 1 or coverage.get("version") != 1:
        raise ValueError("Unsupported map manifest or coverage version")
    if manifest.get("coordinate_system") != "EPSG:4326":
        raise ValueError("Map must use EPSG:4326")
    branches = coverage.get("branches", [])
    if len(branches) != len(BRANCHES) or {b["id"] for b in branches} != set(BRANCHES):
        raise ValueError("Map requires exactly the three configured branches")
    layers = {entry["layer"]: entry for entry in manifest["sources"]}
    if len(layers) != len(manifest["sources"]) or set(layers) != {7, 12}:
        raise ValueError("Expected exactly municipality and cadastral boundary sources")
    municipalities = source_features(layers[12], root)
    cadastres = source_features(layers[7], root)
    references = {Path(s["local_path"]).name: s for s in manifest["reference_sources"]}
    parts = source_features(references["municipality-parts.geojson"], root)
    parents = source_features(references["part-parents.geojson"], root)
    if read_source(references["part-layer.json"], root).get("geometryType") != "esriGeometryPoint":
        raise ValueError("Municipality part geography changed; review cadastral approximation")
    mappings = manifest["part_cadastre_mapping"]
    mapping_by_part = {mapping["part_code"]: mapping for mapping in mappings}
    if (len(mapping_by_part) != len(mappings) or set(mapping_by_part) != set(parts)
            or {m["cadastral_code"] for m in mappings} != set(cadastres)
            or {m["municipality_code"] for m in mappings} != set(parents)):
        raise ValueError("Part/cadastre mappings must match archived source identities exactly")
    for mapping in mappings:
        part = parts[mapping["part_code"]]["properties"]
        cadastre_feature = cadastres[mapping["cadastral_code"]]
        cadastre = cadastre_feature["properties"]
        parent = parents[mapping["municipality_code"]]["properties"]
        if (str(part["obec"]) != mapping["municipality_code"]
                or str(cadastre["obec"]) != mapping["municipality_code"]
                or part["nazev"] != mapping["name"]
                or cadastre["nazev"] != mapping["cadastral_name"]
                or parent["nazev"] != mapping["municipality_name"]):
            raise ValueError("Part/cadastre name or parent mismatch")
        validate_geometry(cadastre_feature["geometry"])
        point = parts[mapping["part_code"]]["geometry"]
        if (point["type"] != "Point"
                or not contains_point(cadastre_feature["geometry"], point["coordinates"])):
            raise ValueError("Part definition point lies outside mapped cadastre")

    selected = {}
    used_municipalities, used_parts = set(), set()
    for branch in branches:
        branch_id = branch["id"]
        branch_municipalities = {p["code"]: p for p in branch["municipalities"]}
        if len(branch_municipalities) != len(branch["municipalities"]):
            raise ValueError("Duplicate municipality in coverage")
        for place in branch["municipalities"]:
            code = place["code"]
            source = municipalities.get(code)
            if (not source or source["properties"]["nazev"] != place["name"]
                    or str(source["properties"]["okres"]) != place["districtCode"]):
                raise ValueError(f"Municipality identity/district mismatch: {code}")
            used_municipalities.add(code)
            add_feature(selected, f"municipality-{code}", place["name"], code,
                        branch_id, "municipality", source["geometry"])
        for place in branch["parts"]:
            # Popovice are already represented by all of Králův Dvůr.
            if place["municipalityCode"] in branch_municipalities:
                if branch_municipalities[place["municipalityCode"]]["name"] != place["municipalityName"]:
                    raise ValueError("Part parent name mismatch")
                continue
            code = place["code"]
            mapping = mapping_by_part.get(code)
            if (not mapping or mapping["name"] != place["name"]
                    or mapping["municipality_code"] != place["municipalityCode"]
                    or mapping["municipality_name"] != place["municipalityName"]):
                raise ValueError(f"Unsupported or mismatched part in coverage: {code}")
            used_parts.add(code)
            cadastre_code = mapping["cadastral_code"]
            name = f"Praha – {place['name']}" if place["municipalityCode"] == "554782" else place["name"]
            add_feature(selected, f"part-{code}", name, code,
                        branch_id, "cadastral", cadastres[cadastre_code]["geometry"], cadastre_code)
    if used_municipalities != set(municipalities) or used_parts != set(parts):
        raise ValueError("Boundary sources must match configured delivery localities exactly")
    dates = sorted({source["downloaded_at"].split("T")[0] for source in manifest["sources"]})
    if len(dates) != 1:
        raise ValueError("Mixed boundary download dates require a reviewed snapshot")
    return {
        "type": "FeatureCollection",
        "version": 1,
        "source": {
            "name": "ČÚZK, RÚIAN",
            "url": manifest["source_url"],
            "retrievedDate": dates[0],
            "license": "CC BY 4.0",
            "licenseUrl": manifest["license"]["url"],
            "attribution": "Hranice: ČÚZK, RÚIAN (CC BY 4.0); výběr a zjednodušení pro mapu Pizza Visi.",
            "note": manifest["geography_note"],
        },
        "features": sorted(selected.values(), key=lambda f: f["properties"]["id"]),
    }


def add_feature(selected, feature_id, name, code, branch_id, territory_type, geometry, cadastral_code=None):
    if feature_id not in selected:
        validate_geometry(geometry)
        properties = {"id": feature_id, "name": name, "code": code,
                      "branchIds": [], "territoryType": territory_type}
        if cadastral_code:
            properties["cadastralCode"] = cadastral_code
        selected[feature_id] = {"type": "Feature", "properties": properties, "geometry": geometry}
    memberships = selected[feature_id]["properties"]["branchIds"]
    if branch_id in memberships:
        raise ValueError("Duplicate locality in branch coverage")
    memberships.append(branch_id)
    memberships.sort(key=BRANCHES.index)


def export_map(manifest_path=DEFAULT_MANIFEST, coverage_path=DEFAULT_COVERAGE, output=DEFAULT_OUTPUT):
    payload = build_payload(json.loads(manifest_path.read_text(encoding="utf-8")),
                            json.loads(coverage_path.read_text(encoding="utf-8")))
    # Validate all shapes and memberships before replacing the usable map.
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(output)
    print(f"Exported {len(payload['features'])} delivery areas to {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--coverage", type=Path, default=DEFAULT_COVERAGE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    export_map(args.manifest, args.coverage, args.output)
