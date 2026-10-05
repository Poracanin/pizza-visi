#!/usr/bin/env python3
"""Export exact named delivery localities from complete, verified official RÚIAN CSVs."""

import argparse
import csv
from datetime import date
import hashlib
import io
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST = ROOT / "RUIAN-delivery-data" / "source-manifest.json"
DEFAULT_COVERAGE = ROOT / "scripts" / "ruian-delivery-coverage.json"
DEFAULT_OUTPUT = ROOT / "public" / "data" / "ruian-addresses.json"
BRANCH_BITS = {"rudna": 1, "hostivice": 2, "beroun": 4}
REQUIRED_COLUMNS = {
    "Kód ADM", "Kód obce", "Název obce", "Kód části obce", "Název části obce",
    "Název ulice", "Typ SO", "Číslo domovní", "Číslo orientační",
    "Znak čísla orientačního", "PSČ",
}


def read_source(source, root):
    """Never silently accept changed/truncated source files or guessed snapshots."""
    path = root / source["local_path"]
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != source["sha256"]:
        raise ValueError(f"Source checksum mismatch: {path}")
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        if archive.namelist() != [source["csv_member"]]:
            raise ValueError(f"Unexpected CSV members: {path}")
        csv_content = archive.read(source["csv_member"])
    if hashlib.sha256(csv_content).hexdigest() != source["csv_sha256"]:
        raise ValueError(f"CSV checksum mismatch: {path}")
    return csv.DictReader(io.StringIO(csv_content.decode(source["csv_encoding"])), delimiter=";")


def validate_coverage(coverage, manifest, root):
    if coverage.get("version") != 1 or manifest.get("manifest_version") != 1:
        raise ValueError("Unsupported coverage or source manifest version")
    references = {entry["csv_member"]: entry for entry in manifest["reference_code_lists"]}
    municipalities = {row["KOD"]: row for row in read_source(references["UI_OBEC.csv"], root)}
    parts = {row["KOD"]: row for row in read_source(references["UI_CAST_OBCE.csv"], root)}
    municipality_masks, part_masks, required_sources, selected_parts = {}, {}, {}, {}
    branches = coverage["branches"]
    if len(branches) != len(BRANCH_BITS) or {b["id"]: b["bit"] for b in branches} != BRANCH_BITS:
        raise ValueError("Coverage must explicitly define all three branch bits")
    for branch in branches:
        bit = branch["bit"]
        for place in branch["municipalities"]:
            code = place["code"]
            official = municipalities.get(code, {})
            if official.get("NAZEV") != place["name"] or official.get("OKRES_KOD") != place["districtCode"]:
                raise ValueError(f"Municipality name/district mismatch: {place}")
            required_sources[code] = place["name"]
            municipality_masks[code] = municipality_masks.get(code, 0) | bit
        for part in branch["parts"]:
            code, municipality = part["code"], part["municipalityCode"]
            official = parts.get(code, {})
            if official.get("NAZEV") != part["name"] or official.get("OBEC_KOD") != municipality:
                raise ValueError(f"Municipality part name/parent mismatch: {part}")
            if municipalities.get(municipality, {}).get("NAZEV") != part["municipalityName"]:
                raise ValueError(f"Part municipality name mismatch: {part}")
            required_sources[municipality] = part["municipalityName"]
            key = (municipality, code)
            part_masks[key] = part_masks.get(key, 0) | bit
            selected_parts[key] = part["name"]
    sources = manifest["source_files"]
    source_codes = [source["municipality_code"] for source in sources]
    if len(set(source_codes)) != len(source_codes) or set(source_codes) != set(required_sources):
        raise ValueError("Source manifest must contain exactly one complete CSV per required municipality")
    return municipality_masks, part_masks, required_sources, selected_parts


def address_label(row):
    municipality, part = row["Název obce"], row["Název části obce"]
    street, house, orientation = row["Název ulice"], row["Číslo domovní"], row["Číslo orientační"]
    house_type, letter = row["Typ SO"], row["Znak čísla orientačního"]
    postal_code = row["PSČ"]
    if not house.isdecimal() or house_type not in ("č.p.", "č.ev."):
        raise ValueError(f"Invalid house number/type for address {row['Kód ADM']}")
    if (orientation and not orientation.isdecimal()) or (letter and not orientation):
        raise ValueError(f"Invalid orientation number for address {row['Kód ADM']}")
    if postal_code and (not postal_code.isdecimal() or len(postal_code) != 5):
        raise ValueError(f"Invalid postal code for address {row['Kód ADM']}")
    number = house + (f"/{orientation}{letter}" if orientation else "")
    if street:
        first = f"{street} {'č. ev. ' if house_type == 'č.ev.' else ''}{number}"
    else:
        first = f"{part or municipality} {'č. ev.' if house_type == 'č.ev.' else 'č. p.'} {number}"
    segments = [first]
    if street and part and part != municipality:
        segments.append(part)
    postal_label = f"{postal_code[:3]} {postal_code[3:]} " if postal_code else ""
    segments.append(f"{postal_label}{municipality}")
    return ", ".join(segments)


def build_payload(manifest, coverage, root=ROOT):
    municipality_masks, part_masks, required_sources, selected_parts = validate_coverage(coverage, manifest, root)
    records, seen_ids, dates = [], set(), set()
    municipality_counts = {code: 0 for code in municipality_masks}
    part_counts = {key: 0 for key in part_masks}
    for source in sorted(manifest["source_files"], key=lambda item: item["municipality_code"]):
        code = source["municipality_code"]
        name = required_sources[code]
        snapshot = date.fromisoformat(source["data_date"])
        member = f"{snapshot:%Y%m%d}_OB_{code}_ADR.csv"
        if source["municipality_name"] != name or source["csv_member"] != member:
            raise ValueError(f"Source identity/date mismatch: {code}")
        if Path(source["local_path"]).name != member + ".zip":
            raise ValueError(f"Source filename/date mismatch: {code}")
        dates.add(snapshot.isoformat())
        reader = read_source(source, root)
        if not REQUIRED_COLUMNS.issubset(reader.fieldnames or []):
            raise ValueError(f"Incomplete CSV columns: {code}")
        source_count = 0
        for row in reader:
            source_count += 1
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"Malformed CSV row: {code}, row {source_count + 1}")
            if row["Kód obce"] != code or row["Název obce"] != name:
                raise ValueError(f"CSV municipality mismatch: {code}, row {source_count + 1}")
            address_id = row["Kód ADM"]
            if not address_id.isdecimal() or address_id in seen_ids:
                raise ValueError(f"Invalid or duplicate address ID: {address_id}")
            seen_ids.add(address_id)
            part_key = (code, row["Kód části obce"])
            mask = municipality_masks.get(code, 0) | part_masks.get(part_key, 0)
            if part_key in selected_parts:
                if row["Název části obce"] != selected_parts[part_key]:
                    raise ValueError(f"CSV municipality part mismatch: {part_key}")
                part_counts[part_key] += 1
            if code in municipality_counts:
                municipality_counts[code] += 1
            if mask:
                records.append([address_id, address_label(row), mask, row["PSČ"]])
        if source_count != source["source_row_count"] or not source_count:
            raise ValueError(f"Incomplete source row count: {code}")
    if not all(municipality_counts.values()) or not all(part_counts.values()):
        raise ValueError("At least one requested delivery locality has no addresses")
    records.sort(key=lambda row: int(row[0]))
    data_dates = sorted(dates)
    if len(data_dates) != 1:
        raise ValueError("Mixed source dates require a new public export schema")
    return {
        "version": 1,
        "source": {
            "name": "ČÚZK, RÚIAN",
            "url": "https://vdp.cuzk.gov.cz/",
            "dataDate": data_dates[0],
            "dataDates": data_dates,
            "license": "CC-BY-4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
            "attribution": "ČÚZK, RÚIAN (CC BY 4.0); výběr adres podle rozvozových lokalit a formátování adres Pizza Visi.",
            "package": "RUIAN-delivery-data",
        },
        "coverage": {
            "scope": "named-municipalities-and-parts",
            "branchBits": BRANCH_BITS,
            "note": "Celé uvedené obce a přesně uvedené části Prahy. Popovice jsou součástí Králova Dvora. Zličín obsluhuje Rudná i Hostivice.",
            "branches": coverage["branches"],
            "branchCounts": {key: sum(bool(row[2] & bit) for row in records) for key, bit in BRANCH_BITS.items()},
        },
        "fields": ["id", "label", "branchMask", "postalCode"],
        "count": len(records),
        "records": records,
    }


def export_addresses(manifest_path=DEFAULT_MANIFEST, coverage_path=DEFAULT_COVERAGE, output=DEFAULT_OUTPUT):
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    coverage = json.loads(coverage_path.read_text(encoding="utf-8"))
    payload = build_payload(manifest, coverage)
    # Validate everything before replacing the last usable public dataset.
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(output)
    print(f"Exported {payload['count']} public address records to {output}")
    print(json.dumps(payload["coverage"]["branchCounts"], ensure_ascii=False))
    return payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--coverage", type=Path, default=DEFAULT_COVERAGE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    options = parser.parse_args()
    export_addresses(options.manifest, options.coverage, options.output)
