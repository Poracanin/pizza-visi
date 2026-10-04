#!/usr/bin/env python3
"""Export public address labels and delivery-polygon membership, never the SQLite DB."""

import argparse
import json
from pathlib import Path
import sqlite3


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATABASE = ROOT / "RUIAN-data-20260930-213506" / "addresses.sqlite"
DEFAULT_OUTPUT = ROOT / "public" / "data" / "ruian-addresses.json"
BRANCH_BITS = {"rudna": 1, "hostivice": 2}


def export_addresses(database, output):
    with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as connection:
        connection.execute("PRAGMA query_only = ON")
        metadata = dict(connection.execute("SELECT key, value FROM dataset_metadata"))
        memberships = {}
        for address_id, polygon_id in connection.execute(
            "SELECT ruian_id, polygon_id FROM address_selection ORDER BY ruian_id, polygon_id"
        ):
            if polygon_id not in BRANCH_BITS:
                raise ValueError(f"Unknown delivery polygon: {polygon_id}")
            memberships[address_id] = memberships.get(address_id, 0) | BRANCH_BITS[polygon_id]
        records = []
        for address_id, label, postal_code, source_date in connection.execute(
            "SELECT ruian_id, full_address, postal_code, source_data_date "
            "FROM addresses ORDER BY ruian_id"
        ):
            if source_date != metadata["data_date"]:
                raise ValueError("Mixed source dates require a new export schema")
            if address_id not in memberships or not label:
                raise ValueError(f"Address {address_id} has no canonical label or coverage")
            records.append([str(address_id), label, memberships[address_id], postal_code or ""])
    payload = {
        "version": 1,
        "source": {
            "name": "ČÚZK, RÚIAN",
            "url": "https://vdp.cuzk.gov.cz/",
            "dataDate": metadata["data_date"],
            "license": "CC-BY-4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
            "attribution": metadata["attribution"],
            "package": database.parent.name,
        },
        "coverage": {
            "scope": metadata["scope"],
            "branchBits": BRANCH_BITS,
            "note": "Adresy uvnitř obrazců Rudná a Hostivice včetně hranic. Beroun není v tomto výběru.",
        },
        "fields": ["id", "label", "branchMask", "postalCode"],
        "count": len(records),
        "records": records,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Exported {len(records)} public address records to {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    options = parser.parse_args()
    export_addresses(options.database, options.output)
