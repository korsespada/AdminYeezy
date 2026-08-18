"""Post-process the Women's Clothing 5 all-timeline feed.

The supplier publishes a short one-photo price/size-card first, then service
albums, and finally the branded product album with the full description.  The
branded album must lead the gallery; only useful detail albums follow it.  The
matching size-card photo is appended last.  Eyewear, short example albums, and
unrecognised clothing brands are not catalogue products for this supplier.
"""

from __future__ import annotations

import copy
import json
import re
from collections import Counter
from typing import Any


BRAND_DATA = [
    {"name": "Valentino", "id": "h1qgeur5z4m2gph", "aliases": ["VALEN"]},
    {"name": "Celine", "id": "e89n7qtko2kop8t", "aliases": ["CELI", "CEL", "CE"]},
    {"name": "Loewe", "id": "v0xek8wss4meybg", "aliases": ["LOW", "LOE"]},
    {"name": "Acne Studios", "id": "ywtm8whmvoz75gh", "aliases": ["Acn Studios", "Acn Studio", "Acn", "Anc", "Ac"]},
    {"name": "Hermes", "id": "rakg8u0bx1y4qcy", "aliases": ["HER"]},
    {"name": "Zimmermann", "id": "wey9whkcz1sve07", "aliases": ["ZIMM"]},
    {"name": "Chanel", "id": "3wxtez8ckauz7o1", "aliases": ["CHL", "CHA"]},
    {"name": "Louis Vuitton", "id": "977uh954t91spxq", "aliases": ["LOUIS", "LV", "L"]},
    {"name": "Saint Laurent", "id": "dvj7fjo7rtb0flc", "aliases": ["SLP", "YSL"]},
    {"name": "Fendi", "id": "kxb3v0730w6mnyn", "aliases": ["FEN", "FED"]},
    {"name": "The Row", "id": "u0b9d3xttoysjsf", "aliases": ["THE RO"]},
    {"name": "Balenciaga", "id": "mj2732zh7c7pchi", "aliases": ["BAL"]},
    {"name": "Alexander Wang", "id": "6i43lc9v5qbua0a", "aliases": ["AW"]},
    {"name": "Ermanno Scervino", "id": "ys2aedauky89igq", "aliases": ["ES"]},
    {"name": "Loro Piana", "id": "5f3npdmxcv8f190", "aliases": ["Loro Pian", "Lpro Pia", "Loro Pia"]},
    {"name": "Dolce & Gabbana", "id": "3v0rkg9178h5y5f", "aliases": ["D&G", "DG"]},
    {"name": "Brunello Cucinelli", "id": "ll73bx30faqq27r", "aliases": ["BC"]},
    {"name": "Toteme", "id": "5xiia5bu18ip9ud", "aliases": ["TOTEME"]},
    {"name": "Thom Browne", "id": "5e10su2xpywak9l", "aliases": ["THM BRON"]},
    {"name": "Isabel Marant", "id": "vtypwyvrub30ymp", "aliases": ["ISABEL"]},
    {"name": "GANNI", "id": "k73awybczjl81c9", "aliases": ["GAN"]},
    {"name": "Burberry", "id": "9610bhle5fdutm0", "aliases": ["BUR", "BBR"]},
    {"name": "Chloe", "id": "n2n1ul1n3pg6jqt", "aliases": ["CHO"]},
    {"name": "Dior", "id": "ivacgwvpdne0t35", "aliases": ["DIO", "CD"]},
    {"name": "Gucci", "id": "6bjd11fcyypitno", "aliases": ["GUC", "GG", "G"]},
    {"name": "Bottega Veneta", "id": "59kttao0v819zzy", "aliases": ["BVLG", "BVL", "BV"]},
    {"name": "Miu Miu", "id": "cn386fag2q87srw", "aliases": ["Miu"]},
    {"name": "Maison Margiela", "id": "j2146e3hgo0c6z7", "aliases": ["MM6", "MM"]},
    {"name": "Prada", "id": "xf3tgcf0uj7yrqf", "aliases": ["PRA", "PD"]},
]

SEASON_RE = re.compile(r"(?<![A-Z0-9])(?:\d{2}|20\d{2})[SW](?![A-Z0-9])", re.IGNORECASE)
PRICE_RE = re.compile(r"\d+\s*[💰💴¥￥]")
SIZE_RE = re.compile(r"尺码|尺寸|size\s*(?:chart|guide|table)", re.IGNORECASE)
LATIN_TOKEN_RE = re.compile(r"[a-z0-9]+", re.IGNORECASE)
CHINESE_RUN_RE = re.compile(r"[\u4e00-\u9fff]+")
EYEWEAR_RE = re.compile(
    r"墨镜|太阳镜|眼镜|镜片|镜框|镜腿|偏光|防UV|sunglasses|eyewear|optical",
    re.IGNORECASE,
)

SHORT_ALBUM_PARTS = (
    "show",
    "gw",
    "zg",
    "look",
    "搭配",
    "搭配造型",
    "搭配look",
    "造型",
    "大图",
    "大图细节",
    "细节",
    "水洗唛",
    "水洗唛细节",
    "系列",
    "全套礼盒",
    "系列全套礼盒",
    "参考搭配",
    "zg同步",
    "同步搭配",
    "衬衫搭配",
    "单依纯",
    "双款选择",
    "双色之选",
)
MAX_DETAIL_ALBUMS = 2
MAX_TABLE_LOOKAHEAD = 20


def _text(product: dict[str, Any]) -> str:
    return " ".join(str(product.get("description") or "").split())


def _photos(product: dict[str, Any]) -> list[str]:
    value = product.get("photos") or []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return []
        if not isinstance(value, list):
            return []
    return [str(item) for item in value if item]


def _position(product: dict[str, Any], fallback: int) -> int:
    try:
        return int(product.get("source_position", fallback))
    except (TypeError, ValueError):
        return fallback


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def find_brand(text: str) -> dict[str, str] | None:
    """Use the same alias order and ASCII boundaries as the old supplier script."""
    if not text:
        return None

    for brand in BRAND_DATA:
        for alias in brand["aliases"]:
            pattern = rf"(?<![a-zA-Z]){re.escape(alias)}(?![a-zA-Z])"
            if re.search(pattern, text, re.IGNORECASE):
                return brand
    return None


def _is_table_card(product: dict[str, Any]) -> bool:
    if len(_photos(product)) != 1:
        return False
    description = _text(product)
    return bool(PRICE_RE.search(description) or SIZE_RE.search(description))


def _is_main_card(product: dict[str, Any]) -> bool:
    return len(_photos(product)) >= 6 and bool(SEASON_RE.search(_text(product)))


def _is_eyewear(product: dict[str, Any]) -> bool:
    return bool(EYEWEAR_RE.search(_text(product)))


def _has_usable_album_text(product: dict[str, Any]) -> bool:
    text = _text(product)
    compact = re.sub(r"\s+", "", text).casefold()
    if len(compact) < 8:
        return False
    remainder = compact
    for part in sorted(SHORT_ALBUM_PARTS, key=len, reverse=True):
        remainder = remainder.replace(part, "")
    return bool(remainder)


def _tokens(text: str) -> tuple[set[str], set[str]]:
    latin = set(LATIN_TOKEN_RE.findall(text.casefold()))
    chinese = set()
    for run in CHINESE_RUN_RE.findall(text):
        chinese.update(run[index:index + 2] for index in range(len(run) - 1))
    return latin, chinese


def _table_match_score(table: dict[str, Any], main: dict[str, Any]) -> int:
    table_text = _text(table)
    main_text = _text(main)
    table_brand = find_brand(table_text)
    main_brand = find_brand(main_text)
    score = 0

    if table_brand and main_brand:
        if table_brand["id"] == main_brand["id"]:
            score += 50
        else:
            score -= 30

    table_latin, table_chinese = _tokens(table_text)
    main_latin, main_chinese = _tokens(main_text)
    score += len(table_latin & main_latin) * 8
    score += len(table_chinese & main_chinese)
    return score


def _assign_tables(tables: list[dict[str, Any]], mains: list[dict[str, Any]]) -> dict[int, dict[str, list[str]]]:
    assigned: dict[int, dict[str, list[str]]] = {}
    for table in tables:
        table_position = _position(table, 0)
        candidates = [
            main for main in mains
            if table_position < _position(main, 0) <= table_position + MAX_TABLE_LOOKAHEAD
        ]
        if not candidates:
            continue

        ranked = sorted(
            ((_table_match_score(table, main), _position(main, 0), main) for main in candidates),
            key=lambda item: (-item[0], item[1]),
        )
        score, _, main = ranked[0]
        # A lone nearby table is still useful even when the supplier omitted a
        # recognisable brand/model token. With competing mains, require text
        # evidence so one table cannot be attached to the wrong product.
        if score <= 0 and len(ranked) > 1:
            continue
        main_position = _position(main, 0)
        entry = assigned.setdefault(main_position, {"photos": [], "source_ids": []})
        entry["photos"].extend(_photos(table))
        if table.get("external_id"):
            entry["source_ids"].append(str(table["external_id"]))
    return assigned


def _set_brand(product: dict[str, Any], table_texts: list[str]) -> dict[str, str] | None:
    brand = find_brand(_text(product))
    if not brand:
        for text in table_texts:
            brand = find_brand(text)
            if brand:
                break
    if not brand:
        return None
    product["brand"] = brand["id"]
    product["name"] = brand["name"]
    return brand


def _append_detail_descriptions(product: dict[str, Any], detail_albums: list[dict[str, Any]]) -> None:
    main_text = _text(product)
    additions = []
    for album in detail_albums:
        description = _text(album)
        if description and description != main_text and description not in additions:
            additions.append(description)
    if additions:
        product["description"] = " ".join([main_text, *additions]).strip()


def process_products(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered = sorted(
        (copy.deepcopy(product) for product in products if isinstance(product, dict)),
        key=lambda product: _position(product, 0),
    )
    if ordered and all(
        isinstance(product.get("attributes"), dict)
        and product["attributes"].get("post_process_tail_source_ids")
        for product in ordered
    ):
        return ordered
    mains = [
        product for product in ordered
        if _is_main_card(product) and not _is_eyewear(product)
    ]
    tables = [product for product in ordered if _is_table_card(product)]
    table_photos = _assign_tables(tables, mains)

    # A repeated first image is a shared/lookbook shot. It should not remain
    # as the hero image of several different products (the 26/29 case).
    main_first_photo_counts = Counter(
        _photos(main)[0] for main in mains if _photos(main)
    )
    shared_main_photos = {
        photo for photo, count in main_first_photo_counts.items() if count > 1
    }

    result = []
    previous_main_position = -1
    for main_index, main in enumerate(mains):
        main_position = _position(main, main_index)
        region = [
            product for product in ordered
            if previous_main_position < _position(product, 0) < main_position
            and not _is_table_card(product)
            and not _is_main_card(product)
            and len(_photos(product)) >= 3
        ]
        detail_albums = [album for album in region if _has_usable_album_text(album)]
        detail_albums = detail_albums[-MAX_DETAIL_ALBUMS:]
        source_albums = [main, *detail_albums]
        merged = copy.deepcopy(main)
        merged_photos = [photo for album in source_albums for photo in _photos(album)]
        assigned_table = table_photos.get(main_position, {})
        merged_photos.extend(assigned_table.get("photos", []))
        merged["photos"] = [
            photo for photo in _unique(merged_photos)
            if photo not in shared_main_photos
        ]
        assigned_table_ids = set(assigned_table.get("source_ids", []))
        table_texts = [
            _text(table)
            for table in tables
            if str(table.get("external_id") or "") in assigned_table_ids
        ]
        brand = _set_brand(
            merged,
            table_texts,
        )
        if not brand:
            continue

        _append_detail_descriptions(merged, detail_albums)

        attributes = dict(merged.get("attributes") or {})
        if assigned_table.get("source_ids"):
            attributes["size_chart_source_id"] = assigned_table["source_ids"][0]
        attributes["post_process_tail_source_ids"] = [
            album.get("external_id")
            for album in source_albums
            if album.get("external_id")
        ]
        merged["attributes"] = attributes
        result.append(merged)
        previous_main_position = main_position

    return result
