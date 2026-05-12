import csv
import json
import os
import re
import sys
import unicodedata

from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import RealDictCursor


load_dotenv()

DETAIL_RE = re.compile(r"实拍细节图\s*\d{6,}[A-Za-z]?")
TITLE_RE = re.compile(
    r"^\W*([A-Za-z][A-Za-z\s]{1,40})\*?\s*(?:\d{2}\s*new|new|早春|春夏)",
    re.IGNORECASE,
)
TITLE_BRAND_RE = re.compile(
    r"^\W*([A-Za-z][A-Za-z\s]{1,40})\*?\s*(?:\d{2}\s*new|new|早春|春夏)",
    re.IGNORECASE,
)

BRAND_ALIASES = {
    "Chrome Hearts": ["chromeheart", "chromehearts"],
    "Acne Studios": ["acnestudio", "acnestudios"],
    "Louis Vuitton": ["lv", "louisvuitton", "louisvuitto", "louisvuiton", "louisvutiion"],
    "Chanel": ["chane", "chanel"],
    "Miu Miu": ["miumi", "miumiu", "miu"],
    "Dior": ["dio", "dior"],
    "Alexander Wang": ["alexanderwan", "alexanderwang"],
    "Valentino": ["valentino"],
    "Loewe": ["loew", "loewe"],
    "Celine": ["celin", "celine"],
    "Prada": ["prad", "prada"],
    "Gucci": ["gucc", "gucci"],
    "Burberry": ["burberr", "burberry"],
    "Fendi": ["fend", "fendi"],
    "Hermes": ["herme", "hermes"],
    "Bottega Veneta": ["bottegavenet", "bottegaveneta"],
    "Thom Browne": ["thombrown", "thombrowne"],
    "Supreme": ["suprem", "supreme"],
    "CHEERi UP": ["cheeriup"],
}


def normalize_text(value):
    if not value:
        return ""
    return unicodedata.normalize("NFKC", value)


def compact_brand_key(value):
    normalized = normalize_text(value).lower()
    return re.sub(r"[^a-z0-9]+", "", normalized)


def get_brands_from_db():
    database_url = os.getenv("DATABASE_URL") or os.getenv("SCRAPING_DATABASE_URL")
    if not database_url:
        print("Warning: DATABASE_URL is not set, brand fields will not be filled", file=sys.stderr)
        return {}

    try:
        conn = psycopg2.connect(database_url)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT id, name FROM brands")
        rows = cur.fetchall()
        cur.close()
        conn.close()
    except Exception as exc:
        print(f"Warning: failed to load brands from DB: {exc}", file=sys.stderr)
        return {}

    brand_map = {}
    by_name = {row["name"].lower(): row for row in rows}

    for row in rows:
        brand_map[compact_brand_key(row["name"])] = row

    for canonical_name, aliases in BRAND_ALIASES.items():
        brand_row = by_name.get(canonical_name.lower())
        if not brand_row:
            continue
        for alias in aliases:
            brand_map[compact_brand_key(alias)] = brand_row

    return brand_map


def find_brand(description, brand_map):
    match = TITLE_BRAND_RE.search(normalize_text(description))
    if not match:
        return None

    brand_key = compact_brand_key(match.group(1))
    return brand_map.get(brand_key)


def canonicalize_description_brand(description, brand_name):
    normalized = normalize_text(description)
    return TITLE_BRAND_RE.sub(lambda match: f"{brand_name}{normalized[match.end(1):match.end()]}", normalized, count=1)


def move_third_photo_first(row):
    photos_raw = row.get("photos", "")
    if not photos_raw:
        return False

    try:
        photos = json.loads(photos_raw)
    except json.JSONDecodeError:
        return False

    if not isinstance(photos, list) or len(photos) < 3:
        return False

    photos = [photos[2], photos[0], photos[1], *photos[3:]]
    row["photos"] = json.dumps(photos, ensure_ascii=False)
    return True


def is_detail_row(row):
    description = row.get("description", "")
    return bool(DETAIL_RE.search(description))


def is_title_row(row):
    description = normalize_text(row.get("description", ""))
    if not description or is_detail_row(row):
        return False
    return bool(TITLE_RE.search(description))


def merge_description_into_detail(title_row, detail_row, brand_map):
    merged = detail_row.copy()
    description = title_row.get("description", "")
    brand = find_brand(description, brand_map)

    if not brand:
        return None

    merged["name"] = brand["name"]
    merged["brand"] = brand["id"]
    merged["description"] = canonicalize_description_brand(description, brand["name"])
    move_third_photo_first(merged)

    for key in ("name", "price", "brand", "category", "subcategory", "gender"):
        if key in ("name", "brand") and brand:
            continue
        title_value = title_row.get(key, "")
        detail_value = merged.get(key, "")
        if title_value and (not detail_value or detail_value in ("0", "0.0")):
            merged[key] = title_value

    return merged


def detect_delimiter(input_path):
    with open(input_path, "r", encoding="utf-8-sig", newline="") as f:
        first_line = f.readline()
    return ";" if ";" in first_line else ","


def process_csv(input_path, output_path=None):
    if not os.path.exists(input_path):
        print(f"Error: file not found: {input_path}", file=sys.stderr)
        return 1

    if output_path is None:
        output_path = input_path

    delimiter = detect_delimiter(input_path)
    brand_map = get_brands_from_db()

    with open(input_path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter=delimiter)
        fieldnames = reader.fieldnames or []
        rows = list(reader)

    result_rows = []
    pending_title = None
    pending_title_used = False
    detail_without_title = 0
    dropped_titles = 0
    dropped_unknown_brands = 0

    for row in rows:
        if is_detail_row(row):
            if pending_title:
                merged_row = merge_description_into_detail(pending_title, row, brand_map)
                if merged_row:
                    result_rows.append(merged_row)
                else:
                    dropped_unknown_brands += 1
                pending_title_used = True
            else:
                detail_without_title += 1
            continue

        if is_title_row(row):
            if pending_title and not pending_title_used:
                dropped_titles += 1
            pending_title = row
            pending_title_used = False
            continue

        # Service rows like purchase receipts are intentionally ignored.
        # The current title remains active until a photo row or the next title.

    if pending_title and not pending_title_used:
        dropped_titles += 1

    with open(output_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=delimiter, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(result_rows)

    print(
        "Success! "
        f"Input rows: {len(rows)}. "
        f"Output rows: {len(result_rows)}. "
        f"Details without title: {detail_without_title}. "
        f"Dropped titles without details: {dropped_titles}. "
        f"Dropped unknown brands: {dropped_unknown_brands}."
    )
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 2:
        raise SystemExit(process_csv(sys.argv[1], sys.argv[2]))
    if len(sys.argv) > 1:
        raise SystemExit(process_csv(sys.argv[1]))

    print("Usage: python process_task_67.py <input.csv> [output.csv]", file=sys.stderr)
    raise SystemExit(2)
