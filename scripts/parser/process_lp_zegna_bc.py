"""Post-processing for supplier 28 «LP, Zegna, BC Мужская одежда».

The feed is a long timeline split into sections by photo-less header albums
such as ``•———• MAN•———• SS26`` or ``•———• WOMAN•———• SS26``.  The season suffix
is not fixed, so the header is recognised by the word MAN/WOMAN plus a season
marker rather than by the literal ``26``.

Inside a section the supplier publishes:

* one model description album (no photos, contains ``Код модели`` and the
  palette/sizes/prices of the model);
* service albums: unpacking, video, ``View 360``, ``Original vs. Our Version``,
  ``The size grid`` and a plain category marker;
* a group photo (one photo, usually all colours on a rack/table);
* the colour product cards: six photos each, captioned ``Price:`` (and in the
  newer sections an alternating ``Details`` card with the item itself).

Two layouts occur in the batch:

``Price-only``
    Every colour card is a ``Price`` album; each one is a product of its own.
``Price + Details``
    Colour cards alternate ``Price`` (photos on the model) and ``Details``
    (the item on a hanger/table).  The ``Details`` album is the product and the
    matching ``Price`` album supplies the on-model photos.

Every colour run of one model code is a colour family (``variant_group_key``),
shares the section description and the size grid with the same model code.
Hat/scarf/glove cards start with the "whole set" photo, so for accessories the
second photo is moved in front of the first.
"""

import copy
import hashlib
import re

CLOTHING_CATEGORY_ID = "lrg3k8cd5bgw3jv"
SHOES_CATEGORY_ID = "nzg3vsvajpiv1e8"
ACCESSORIES_CATEGORY_ID = "mxyz80e9uti03ia"

# Longest prefix first: LPH/LPS must win over LP, BCH/BCS/BCG over BC.
BRANDS = (
    ("LPH", "5f3npdmxcv8f190", "Loro Piana"),
    ("LPS", "5f3npdmxcv8f190", "Loro Piana"),
    ("LP", "5f3npdmxcv8f190", "Loro Piana"),
    ("BCH", "ll73bx30faqq27r", "Brunello Cucinelli"),
    ("BCS", "ll73bx30faqq27r", "Brunello Cucinelli"),
    ("BCG", "ll73bx30faqq27r", "Brunello Cucinelli"),
    ("BC", "ll73bx30faqq27r", "Brunello Cucinelli"),
    ("ZE", "8xod4z3cjpbltoa", "Zegna"),
    ("BL", "i5129fa1bqw2mtb", "Berluti"),
    ("KTH", "ztp7bbno4i8k9hw", "Kiton"),
    ("KT", "ztp7bbno4i8k9hw", "Kiton"),
    ("ST", "7rwzlqrppoe8hue", "Santoni"),
)
CODE_PREFIXES = "LPH|LPS|BCH|BCS|BCG|LP|BC|ZE|BL|KTH|KT|ST"
CODE_RE = re.compile(
    r"(?<![A-Z0-9])(" + CODE_PREFIXES + r")[\s_-]?(\d{2,})((?:[\s_-]?[A-Z0-9]+)?)(?![A-Z0-9])"
)
HEADER_RE = re.compile(r"\b(MAN|WOMAN)\b[•\s]*—+\s*[•\s]*S[SF]?\d{2}", re.I)
DESC_CODE_RE = re.compile(r"Код модели\s*:", re.I)
GRID_RE = re.compile(r"\bSIZE\s*GRID\b|РАЗМЕРН\w*\s+(?:СЕТК|ТАБЛ)|尺码表", re.I)
PRICE_RE = re.compile(r"\bPRICE\s*:", re.I)
DETAILS_RE = re.compile(r"\bDETAILS\b", re.I)
SHOE_TAG_RE = re.compile(r"ОБУВЬ|SHOES|鞋", re.I)
ACCESSORY_TAG_RE = re.compile(r"АКСЕССУАРЫ|ACCESSOR|配饰", re.I)

ALBUM_VERSION = "lp-zegna-bc-sections-2"

# A real colour card has six photos. Cards with fewer photos are collages that
# combine several products in one album (for example #187 with LPH009/LPS005).
MIN_PRODUCT_PHOTOS = 6


def _text(product):
    return " ".join(str(product.get("description") or "").split())


def _photos(product):
    value = product.get("photos") or []
    if isinstance(value, str):
        value = [value]
    return [str(url).strip() for url in value if str(url).strip()]


def _unique(values):
    result = []
    seen = set()
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def _normalize_code(code):
    # Keep the supplier's hyphen (``ZE2618-1G``), drop only spaces and underscores.
    return re.sub(r"[\s_]+", "", str(code or "").upper())


def _codes_in(text):
    return [_normalize_code(match.group(0)) for match in CODE_RE.finditer(str(text or "").upper())]


def _code_in(text):
    codes = _codes_in(text)
    return codes[0] if codes else ""


def _is_header(product):
    return not _photos(product) and bool(HEADER_RE.search(_text(product)))


def _gender_of(product):
    text = _text(product).upper()
    if "WOMAN" in text:
        return "female"
    if "MAN" in text:
        return "male"
    return ""


def _is_description(product):
    return not _photos(product) and bool(DESC_CODE_RE.search(_text(product)))


def _is_size_grid(product):
    return bool(GRID_RE.search(_text(product)))


def _is_product_card(product):
    if len(_photos(product)) < MIN_PRODUCT_PHOTOS:
        return False
    text = _text(product)
    return bool(PRICE_RE.search(text) or DETAILS_RE.search(text))


def _brand_for(code):
    for prefix, brand_id, name in BRANDS:
        if code.startswith(prefix):
            return brand_id, name
    return "", ""


def _category_for(product):
    text = _text(product).upper()
    if ACCESSORY_TAG_RE.search(text):
        return ACCESSORIES_CATEGORY_ID
    if SHOE_TAG_RE.search(text) or re.search(r"(?<!\d)(?:3[5-9]|4[0-7])\s*[-–—~～至]\s*(?:3[5-9]|4[0-7])(?!\d)", text):
        return SHOES_CATEGORY_ID
    return CLOTHING_CATEGORY_ID


def _family_key(section_index, run_index, code):
    seed = "supplier28:%s:%s:%s" % (section_index, run_index, code)
    return hashlib.md5(seed.encode("utf-8")).hexdigest()


def _split_sections(products):
    sections = []
    current = None
    for product in products:
        if _is_header(product):
            current = {
                "index": len(sections),
                "gender": _gender_of(product),
                "items": [],
            }
            sections.append(current)
            continue
        if current is None:
            current = {"index": len(sections), "gender": "", "items": []}
            sections.append(current)
        current["items"].append(product)
    return sections


def _units(items):
    """Combine ``Price`` + ``Details`` pairs into one output unit."""
    units = []
    index = 0
    while index < len(items):
        product = items[index]
        if not _is_product_card(product):
            index += 1
            continue
        text = _text(product)
        if PRICE_RE.search(text) and index + 1 < len(items):
            following = items[index + 1]
            following_text = _text(following)
            if (
                _is_product_card(following)
                and DETAILS_RE.search(following_text)
                and not PRICE_RE.search(following_text)
            ):
                units.append({
                    "card": following,
                    "model": product,
                    "code": _code_in(text) or _code_in(following_text),
                })
                index += 2
                continue
        units.append({"card": product, "model": None, "code": _code_in(text)})
        index += 1
    return units


def _run_sizes(units):
    run_index = -1
    previous = None
    for unit in units:
        if unit["code"] and unit["code"] != previous:
            run_index += 1
            previous = unit["code"]
        unit["run"] = run_index
    sizes = {}
    for unit in units:
        sizes[unit["run"]] = sizes.get(unit["run"], 0) + 1
    return sizes


def _pick_description(descriptions, positions, anchor, code):
    matching = [
        item for item in descriptions
        if positions[id(item)] < anchor and code and code in _codes_in(_text(item))
    ]
    if matching:
        return matching[-1]
    before = [item for item in descriptions if positions[id(item)] < anchor]
    if before:
        return before[-1]
    return descriptions[0] if descriptions else None


def _pick_size_grid(grids, positions, anchor, code):
    matching = [
        item for item in grids
        if positions[id(item)] < anchor and code and code in _codes_in(_text(item))
    ]
    if matching:
        return matching[-1]
    neutral = [
        item for item in grids
        if positions[id(item)] < anchor and not _codes_in(_text(item))
    ]
    return neutral[-1] if neutral else None


def _section_products(section):
    items = section["items"]
    positions = {id(item): index for index, item in enumerate(items)}
    descriptions = [item for item in items if _is_description(item)]
    grids = [item for item in items if _is_size_grid(item)]
    units = _units(items)
    run_sizes = _run_sizes(units)

    result = []
    for unit in units:
        card = unit["card"]
        code = unit["code"]
        anchor = positions.get(id(card), 0)
        description = _pick_description(descriptions, positions, anchor, code)
        grid = _pick_size_grid(grids, positions, anchor, code)

        photos = _photos(card)
        if unit["model"] is not None:
            photos = _unique(photos + _photos(unit["model"]))
        category = _category_for(card)
        if category == ACCESSORIES_CATEGORY_ID and len(photos) > 1:
            photos = [photos[1], photos[0]] + photos[2:]
        if grid is not None:
            photos = _unique(photos + _photos(grid))

        product = copy.deepcopy(card)
        product["photos"] = photos
        product["category"] = category
        if section["gender"]:
            product["gender"] = section["gender"]

        brand_id, brand_name = _brand_for(code)
        if brand_id:
            product["brand"] = brand_id
            product["name"] = brand_name

        attributes = dict(product.get("attributes") or {})
        attributes["album_merge_version"] = ALBUM_VERSION
        if code:
            attributes["model_code"] = code
        if description is not None:
            product["description"] = _text(description)
            attributes["description_source_id"] = description.get("external_id")
        if grid is not None:
            attributes["size_chart_source_id"] = grid.get("external_id")
        if unit["model"] is not None:
            attributes["model_photos_source_id"] = unit["model"].get("external_id")

        if run_sizes.get(unit["run"], 0) > 1 and code:
            key = _family_key(section["index"], unit["run"], code)
            product["variant_group_key"] = key
            product["variant_group_name"] = code
            attributes["album_family_key"] = key

        product["attributes"] = attributes
        result.append(product)
    return result


def process_products(products):
    ordered = sorted(
        (copy.deepcopy(product) for product in products),
        key=lambda product: product.get("source_position", 0),
    )
    output = []
    for section in _split_sections(ordered):
        output.extend(_section_products(section))
    output.sort(key=lambda product: product.get("source_position", 0))
    return output
