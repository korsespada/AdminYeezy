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
    {"name": "On", "id": "085f112c-d6a9-44de-9176-d6fbb5eeab03", "aliases": ["On Running", "On"]},
    {"name": "Rick Owens", "id": "837433da-2847-4128-85ba-1892b4d47cd3", "aliases": ["Rick Owens", "RickOwens"]},
    {"name": "Emporio Armani", "id": "f2c53014-0500-4c8c-a905-51b3c41be1a1", "aliases": ["Emporio Armani"]},
    {"name": "Norda", "id": "7a86c94d-d7cd-4388-be65-56ba24462068", "aliases": ["Norda"]},
    {"name": "Maison Mihara Yasuhiro", "id": "aba3c0ce-79e6-4c42-96c6-dd9d23ea38f2", "aliases": ["Maison Mihara Yasuhiro", "Mihara Yasuhiro"]},
    {"name": "xVESSEL", "id": "4c96f687-a419-4c8f-b478-19a490740786", "aliases": ["xVESSEL", "x Vessel"]},
    {"name": "Kailas", "id": "01ca0c86-b593-4b61-8f7c-ad6c4cbcf538", "aliases": ["Kailas", "凯乐石"]},
    {"name": "Gimaguas", "id": "5decb636-4019-439f-8336-f84538787556", "aliases": ["Gimaguas"]},
    {"name": "Cotemp", "id": "5548b0a5-29f3-49ba-8195-8931baa27042", "aliases": ["Cotemp"]},
    {"name": "VIBAe", "id": "09c6988d-b03e-4062-afbf-ab8feec621f7", "aliases": ["VIBAe", "Vibae"]},
    {"name": "AnOther Project", "id": "581a8afc-16b7-4240-a0d3-3b7c72ea9167", "aliases": ["AnOther Project", "Another Project"]},
    {"name": "Ann Demeulemeester", "id": "43d15688-bb7d-4ad8-ae49-aa34e2994ee1", "aliases": ["Ann Demeulemeester"]},
    {"name": "HIDEMI", "id": "2e5987ca-994e-462c-adcd-d607a1bf8eba", "aliases": ["HIDEMI", "Hidemi"]},
    {"name": "ICE DUST", "id": "fc0dcd68-c0fa-4bb1-a864-f6f3aaacefcd", "aliases": ["ICE DUST", "Ice Dust"]},
    {"name": "Christen", "id": "028cd6a4-4f6f-41c7-abef-99fe61c706b2", "aliases": ["Christen"]},
    {"name": "ODTD", "id": "25f3c82f-511a-4439-99ff-32a29bc651f7", "aliases": ["ODTD"]},
    {"name": "SHUSHU/TONG", "id": "1ca12af9-58e8-463c-8f58-9ce72f249a88", "aliases": ["SHUSHU/TONG", "SHUSHU TONG"]},
    {"name": "3.1 Phillip Lim", "id": "6a7885e3-40cc-4ba2-b185-bb84cfeb36ef", "aliases": ["3.1 Phillip Lim", "3 1 Phillip Lim"]},
    {"name": "IIIVIVINIKO", "id": "5fdd669e-83c8-4980-8d9b-6fac14ddafcc", "aliases": ["IIIVIVINIKO"]},
    {"name": "Elia Maurizi", "id": "c1e7a733-de58-4a40-9468-35119b312b39", "aliases": ["Elia Maurizi"]},
    {"name": "Benci Brothers", "id": "277ff77e-d829-4567-b38f-904d107a2159", "aliases": ["Benci Brothers"]},
    {"name": "Ann Andelman", "id": "0b079b0d-d024-40a6-8f1b-a7ec2e149c52", "aliases": ["Ann Andelman"]},
    {"name": "DYMONLATRY", "id": "2d13274f-33c2-4bca-8b38-2ed11be64a13", "aliases": ["DYMONLATRY"]},
    {"name": "ABRA", "id": "8664be21-18db-4f00-bbd0-b2ae9f85fee3", "aliases": ["ABRA"]},
    {"name": "Casadei", "id": "4156af3d-b2e6-4288-b9cb-f2b37ff8d0aa", "aliases": ["Casadei"]},
    {"name": "Aeyde", "id": "51f65a1b-c08f-4806-a27a-8c71ff9c6369", "aliases": ["Aeyde"]},
    {"name": "Lost in Echo", "id": "241d1312-63aa-4f81-9b92-3e48f6914dde", "aliases": ["Lost in Echo"]},
    {"name": "untitlab", "id": "e8febd67-380b-46cc-ad7f-ba8d0419a33a", "aliases": ["untitlab"]},
    {"name": "Pierre Hardy", "id": "cf0f5294-1964-4d2a-a714-e01e3fa92c39", "aliases": ["Pierre Hardy"]},
    {"name": "Alohas", "id": "4a202ab0-3834-4816-aa91-b1b027e222ac", "aliases": ["Alohas"]},
    {"name": "ORINOU", "id": "4cb23f02-0ce0-4ad7-ab8c-a6423b553140", "aliases": ["ORINOU"]},
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
