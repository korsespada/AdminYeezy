"""Post-process the Женская одежда 3 all-timeline feed.

This supplier publishes one product as a bounded block.  The first album is a
TIMO separator, the last substantial album contains the brand and the full
description, and the album immediately before it contains the product gallery.
The one-photo ``下单尺寸表`` album belongs to the same block and is appended to
the gallery for later measurement recovery.
"""

from __future__ import annotations

import copy
import json
import re
import unicodedata
from typing import Any


# These are the current Rails catalog ids, checked against /catalog/brands.
BRANDS = [
    {"name": "Chrome Hearts", "id": "84ea2b2d-4f88-495b-9bba-7fd2bc191c73", "aliases": ["Chrome Hearts", "克罗心"]},
    {"name": "Acne Studios", "id": "994c0bed-31ee-420e-85e3-7a6d526912a9", "aliases": ["Acne Studios"]},
    {"name": "Gucci", "id": "af467691-e41e-4979-b55a-8cde5477ceb2", "aliases": ["Gucci", "古驰"]},
    {"name": "Dior", "id": "b6ee95cb-d59f-4326-a6c8-1813b990dea8", "aliases": ["Dior", "迪奥"]},
    {"name": "Prada", "id": "7f3ea40f-0fb3-4ce3-b6cc-864a49c8b156", "aliases": ["Prada", "普拉达"]},
    {"name": "Chanel", "id": "726cea13-4d63-4d5e-af8b-1d16e8aa58f2", "aliases": ["Chanel", "CHANEL", "香奈儿"]},
    {"name": "Loewe", "id": "f612aef8-0e3f-432e-b9d8-0ca4f97de7fe", "aliases": ["Loewe", "LOEWE", "罗意威"]},
    {"name": "Celine", "id": "17f52bce-82c1-4d7a-afbf-2ed8a9f7be6a", "aliases": ["Celine", "赛琳"]},
    {"name": "Saint Laurent", "id": "08da4a40-2825-40c9-aaec-760eb0f24ea2", "aliases": ["Saint Laurent", "YSL", "圣罗兰"]},
    {"name": "Miu Miu", "id": "296b4bac-ca5c-44d6-bc19-5892c8ac3bae", "aliases": ["Miu Miu", "MiuMiu"]},
    {"name": "Louis Vuitton", "id": "b31ffe55-28b0-4c5d-acde-dedfa62009d3", "aliases": ["Louis Vuitton", "路易威登"]},
    {"name": "Valentino", "id": "411bd1c7-11b5-43ee-b9dc-8febd04bee63", "aliases": ["Valentino", "华伦天奴"]},
    {"name": "Fendi", "id": "eab7b50f-c020-4a7f-8aee-da4a67e3feff", "aliases": ["Fendi"]},
    {"name": "Hermes", "id": "0996bebe-0108-476f-8e73-2b23f034aa56", "aliases": ["Hermes", "HERMES", "爱马仕"]},
    {"name": "Burberry", "id": "5b9f23ff-b05b-4c89-8ea7-45e472440dda", "aliases": ["Burberry", "巴宝莉"]},
    {"name": "New Balance", "id": "1970d718-1f79-4a2f-8e44-3e4f4341c97d", "aliases": ["New Balance"]},
    {"name": "Ami", "id": "35cb6e05-f37c-4976-9b78-d3ede3d7400c", "aliases": ["Ami", "AMI"]},
    {"name": "Arcteryx", "id": "a4801740-6290-4712-bff0-4e22b79c7ec6", "aliases": ["Arcteryx", "Arc'teryx", "Arc’teryx"]},
]

SEPARATOR_RE = re.compile(r"^•••提莫·TIMO\s*\(只做Zp研发\)•••")
PRICE_RE = re.compile(r"\d+\s*[💰💴¥￥]")
SIZE_TABLE_RE = re.compile(r"下单尺寸表|尺码表|尺寸表|size\s*(?:chart|guide|table)", re.IGNORECASE)
MIN_GALLERY_PHOTOS = 3
EXCLUDED_BRAND_IDS = {"84ea2b2d-4f88-495b-9bba-7fd2bc191c73"}  # Chrome Hearts


def _text(product: dict[str, Any]) -> str:
    return " ".join(str(product.get("description") or "").split())


def _photos(product: dict[str, Any]) -> list[str]:
    value = product.get("photos") or []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return []
    return [str(item) for item in value if item] if isinstance(value, list) else []


def _position(product: dict[str, Any], fallback: int) -> int:
    try:
        return int(product.get("source_position", fallback))
    except (TypeError, ValueError):
        return fallback


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def _latin_alias_pattern(alias: str) -> re.Pattern[str]:
    return re.compile(rf"(?<![A-Za-z]){re.escape(alias)}(?![A-Za-z])", re.IGNORECASE)


def find_brand(text: str) -> dict[str, str] | None:
    normalized = unicodedata.normalize("NFKC", text or "")
    aliases: list[tuple[str, dict[str, str]]] = [
        (alias, brand)
        for brand in BRANDS
        for alias in brand["aliases"]
    ]
    # Longer aliases must win over fragments such as ``YSL`` or ``Miu``.
    for alias, brand in sorted(aliases, key=lambda item: len(item[0]), reverse=True):
        if re.search(r"[A-Za-z]", alias):
            if _latin_alias_pattern(alias).search(normalized):
                return brand
        elif alias in normalized:
            return brand
    return None


def _is_separator(product: dict[str, Any]) -> bool:
    return not _photos(product) and bool(SEPARATOR_RE.search(_text(product)))


def _is_description_card(product: dict[str, Any]) -> bool:
    description = _text(product)
    return len(_photos(product)) >= 8 and bool(PRICE_RE.search(description)) and find_brand(description) is not None


def _find_size_table(block: list[dict[str, Any]]) -> dict[str, Any] | None:
    for product in block:
        if len(_photos(product)) == 1 and SIZE_TABLE_RE.search(_text(product)):
            return product
    return None


def _process_block(block: list[dict[str, Any]]) -> dict[str, Any] | None:
    description_index = next(
        (index for index in range(len(block) - 1, -1, -1) if _is_description_card(block[index])),
        None,
    )
    if description_index is None or description_index == 0:
        return None

    description_card = block[description_index]
    gallery_card = block[description_index - 1]
    gallery_photos = _photos(gallery_card)
    if len(gallery_photos) < MIN_GALLERY_PHOTOS:
        return None

    brand = find_brand(_text(description_card))
    if not brand:
        return None
    if brand["id"] in EXCLUDED_BRAND_IDS:
        return None

    size_table = _find_size_table(block)
    merged = copy.deepcopy(gallery_card)
    merged["description"] = _text(description_card)
    merged["name"] = brand["name"]
    merged["brand"] = brand["id"]
    merged["photos"] = _unique(gallery_photos + (_photos(size_table) if size_table else []))

    attributes = dict(merged.get("attributes") or {})
    if description_card.get("external_id"):
        attributes["description_source_id"] = description_card["external_id"]
    if size_table and size_table.get("external_id"):
        attributes["size_chart_source_id"] = size_table["external_id"]
    attributes["post_process_tail_source_ids"] = [
        source.get("external_id")
        for source in (gallery_card, description_card, size_table)
        if source and source.get("external_id")
    ]
    merged["attributes"] = attributes
    return merged


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

    result: list[dict[str, Any]] = []
    starts = [index for index, product in enumerate(ordered) if _is_separator(product)]
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(ordered)
        processed = _process_block(ordered[start:end])
        if processed:
            result.append(processed)
    return result
