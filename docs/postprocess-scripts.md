# Post-Processing Scripts Guide

This project uses Python post-processing scripts to transform supplier CSV rows before AI processing or push to the main shop.

## Where Scripts Live

Put every supplier post-processing script in:

```text
scripts/parser/
```

Then set the supplier field `post_process_script` to the file name only:

```text
process_new_supplier.py
```

Do not store scripts only on the VPS or inside a running container. They must be committed to the repo, pushed, and deployed to Coolify so they survive redeploys.

## Required CLI Contract

Every script must support this command shape:

```bash
python scripts/parser/my_script.py input.csv output.csv
```

The admin/Coolify flow will:

1. Export current `scraping.products` rows for the batch into a temporary CSV.
2. Run the supplier script with `input.csv` and `output.csv`.
3. Read `output.csv`.
4. Replace/update that batch in `scraping.products`.

So the script must:

- read the first CLI argument as input path;
- write the second CLI argument as output path;
- exit with code `0` on success;
- exit non-zero or write a clear stderr message on failure;
- create parent directories for output if needed.

## CSV Columns

Preserve these canonical columns whenever possible:

```text
external_id
name
description
price
status
brand
category
subcategory
gender
photos
ai_processed
```

Minimum useful output columns:

```text
external_id,name,description,price,brand,category,subcategory,gender,photos
```

Rules:

- `external_id` must remain stable. Do not invent a new one unless the source row truly lacks it.
- `photos` must be a JSON array string, for example `["https://.../1.jpg","https://.../2.jpg"]`.
- `brand`, `category`, and `subcategory` should use IDs from the main shop dictionaries when known.
- `price` should be numeric text, without currency symbols.
- `status` should be `active` or `inactive` if emitted.
- Keep unknown columns only if they are harmless; the importer ignores fields it does not understand.

## Encoding And Delimiters

Preferred output:

- encoding: `utf-8-sig` or `utf-8`;
- delimiter: `;`;
- quote fields through Python `csv.DictWriter`, not hand-built string joins.

Use:

```python
with open(output_path, "w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=";", extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
```

When reading, auto-detect `;` vs `,` if the script may receive old files.

## Safe Script Template

```python
import csv
import json
import os
import sys

CANONICAL_FIELDS = [
    "external_id",
    "name",
    "description",
    "price",
    "status",
    "brand",
    "category",
    "subcategory",
    "gender",
    "photos",
    "ai_processed",
]

def detect_delimiter(path):
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        first = f.readline()
    return ";" if first.count(";") >= first.count(",") else ","

def normalize_photos(value):
    if not value:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    raw = str(value).strip()
    try:
        parsed = json.loads(raw)
        return normalize_photos(parsed)
    except Exception:
        return [item.strip() for item in raw.split("|") if item.strip()]

def process_row(row):
    photos = normalize_photos(row.get("photos", ""))
    return {
        **row,
        "external_id": row.get("external_id", "").strip(),
        "name": row.get("name", "").strip(),
        "description": row.get("description", "").strip(),
        "price": row.get("price", "0").strip() or "0",
        "status": row.get("status", "active").strip() or "active",
        "brand": row.get("brand", "").strip(),
        "category": row.get("category", "").strip(),
        "subcategory": row.get("subcategory", "").strip(),
        "gender": row.get("gender", "").strip(),
        "photos": json.dumps(photos, ensure_ascii=False),
    }

def main(input_path, output_path):
    delimiter = detect_delimiter(input_path)
    with open(input_path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter=delimiter)
        rows = [process_row(row) for row in reader]

    rows = [row for row in rows if row.get("external_id") or row.get("name")]

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    fieldnames = [field for field in CANONICAL_FIELDS if any(field in row for row in rows)]
    for row in rows:
        for key in row.keys():
            if key not in fieldnames:
                fieldnames.append(key)

    with open(output_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=";", extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    print(f"Success: wrote {len(rows)} rows to {output_path}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python script.py input.csv output.csv", file=sys.stderr)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
```

## What Not To Do

- Do not hardcode local Windows paths like `C:\\projects\\...`.
- Do not write output next to the script unless it is the explicit `output.csv` argument.
- Do not rely on packages missing from `requirements.txt`.
- Do not mutate the input file in place.
- Do not call the production shop DB from a post-process script. The script should only transform CSV rows.
- Do not upload photos to S3 here. S3 upload happens during push to the main shop.
- Do not remove `external_id` unless the row is intentionally being deleted.

## Dependencies

Prefer Python standard library.

If a new dependency is truly needed:

1. Add it to `requirements.txt`.
2. Test locally.
3. Commit and push.
4. Redeploy Coolify so the Docker image installs it.

## Testing Locally

Use a small copied CSV sample:

```bash
python scripts/parser/my_script.py tmp/sample_input.csv tmp/sample_output.csv
```

Then inspect:

- output file exists;
- row count is expected;
- `photos` is valid JSON array text;
- important columns are still present;
- no absolute local paths leaked into the CSV.

## Deployment Flow

1. Create or edit `scripts/parser/my_script.py`.
2. Run local sample test.
3. Commit and push.
4. Redeploy Coolify.
5. In supplier settings, set `post_process_script` to `my_script.py`.
6. Open a batch and click `Пост-обработка скриптом`.

The admin will use the script through the DB-backed batch flow: `scraping.products -> temporary CSV -> script -> output CSV -> scraping.products`.
