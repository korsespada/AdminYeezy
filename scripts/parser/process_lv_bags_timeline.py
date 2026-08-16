"""Post-process the LV bags and wallets all-timeline feed.

LV publishes the service albums before the product albums in the source
order. A usual block is therefore ``packaging -> video -> main gallery`` and
sometimes ``-> detail gallery``. The catalogue card must expose one gallery
in the opposite semantic order: main photos, detail photos, packaging photos;
the video is kept in the product attributes.
"""

from __future__ import annotations

import copy
import json
import re
from typing import Any


PACKAGING_RE = re.compile(
    r"包装(?:展示|图|清单)?|配套|标配|礼盒|防尘袋|手提袋|全套包装|附件清单",
    re.IGNORECASE,
)
VIDEO_RE = re.compile(r"(?:实拍)?视频|video", re.IGNORECASE)
MODEL_CODE_RE = re.compile(r"\b[A-Z]{1,6}\s*[-.]?\s*\d{3,}[A-Z0-9-]*\b", re.IGNORECASE)
CHINESE_RUN_RE = re.compile(r"[\u4e00-\u9fff]{5,}")

MAX_SERVICE_DISTANCE = 3
MIN_MAIN_PHOTOS = 7
MAX_DETAIL_PHOTOS = 6


def _description(product: dict[str, Any]) -> str:
    return " ".join(str(product.get("description") or "").split())


def _photos(product: dict[str, Any]) -> list[str]:
    photos = product.get("photos") or []
    if not isinstance(photos, list):
        try:
            photos = json.loads(photos)
        except (TypeError, json.JSONDecodeError):
            photos = []
    return [str(photo) for photo in photos if photo] if isinstance(photos, list) else []


def _position(product: dict[str, Any], fallback: int) -> int:
    try:
        return int(product.get("source_position", fallback))
    except (TypeError, ValueError):
        return fallback


def _video(product: dict[str, Any]) -> tuple[str | None, str | None]:
    attributes = product.get("attributes") or {}
    if not isinstance(attributes, dict):
        return None, None
    url = attributes.get("szwego_video_url") or attributes.get("video_url")
    poster = attributes.get("szwego_video_poster_url") or attributes.get("video_poster_url")
    return (
        str(url).strip() if url else None,
        str(poster).strip() if poster else None,
    )


def _tags(product: dict[str, Any]) -> set[str]:
    attributes = product.get("attributes") or {}
    values = attributes.get("szwego_tags") if isinstance(attributes, dict) else []
    if values is None:
        values = []
    if not isinstance(values, list):
        values = [values]
    return {
        " ".join(str(value).split()).casefold()
        for value in values
        if value is not None and str(value).strip()
    }


def _model_codes(text: str) -> set[str]:
    return {re.sub(r"\s+", "", code).upper() for code in MODEL_CODE_RE.findall(text)}


def _shared_phrase(left: str, right: str) -> bool:
    for phrase in CHINESE_RUN_RE.findall(left):
        if len(phrase) >= 5 and phrase in right:
            return True
    return False


def _same_product(left: dict[str, Any], right: dict[str, Any]) -> bool:
    """Require an explicit identity before joining a detail album."""
    left_tags = _tags(left)
    right_tags = _tags(right)
    if left_tags or right_tags:
        return bool(left_tags and right_tags and left_tags & right_tags)

    left_text = _description(left)
    right_text = _description(right)
    left_codes = _model_codes(left_text)
    right_codes = _model_codes(right_text)
    return bool(left_codes & right_codes) or _shared_phrase(left_text, right_text)


def _is_video(product: dict[str, Any]) -> bool:
    url, _ = _video(product)
    return bool(url or VIDEO_RE.search(_description(product)))


def _is_packaging(product: dict[str, Any]) -> bool:
    # Product descriptions may mention included packaging. A small album with
    # an explicit packaging caption is the service card shown by this supplier.
    return len(_photos(product)) <= MAX_DETAIL_PHOTOS and bool(PACKAGING_RE.search(_description(product)))


def _unique(photos: list[str]) -> list[str]:
    seen: set[str] = set()
    result = []
    for photo in photos:
        if photo not in seen:
            seen.add(photo)
            result.append(photo)
    return result


def _merge_description(main: str, detail: str) -> str:
    if not detail or detail == main:
        return main
    return f"{main}\n\n{detail}" if main else detail


def _attach_video(product: dict[str, Any], video: tuple[str | None, str | None]) -> None:
    url, poster = video
    if not url:
        return
    attributes = dict(product.get("attributes") or {})
    attributes.setdefault("szwego_video_url", url)
    if poster:
        attributes.setdefault("szwego_video_poster_url", poster)
    product["attributes"] = attributes


def _can_attach_detail(group: dict[str, Any], candidate: dict[str, Any]) -> bool:
    main = group["main"]
    main_photos = _photos(main)
    detail_photos = _photos(candidate)
    if len(main_photos) < MIN_MAIN_PHOTOS or not (1 <= len(detail_photos) <= MAX_DETAIL_PHOTOS):
        return False
    distance = _position(candidate, 0) - _position(main, 0)
    return 0 < distance <= 2 and _same_product(main, candidate)


def _service_identity_matches(service: dict[str, Any], group: dict[str, Any]) -> bool:
    cards = [group["main"], *group["details"]]
    return any(_same_product(service, card) for card in cards)


def _nearest_group(service: dict[str, Any], groups: list[dict[str, Any]]) -> dict[str, Any] | None:
    service_position = _position(service, 0)
    nearby = [
        group
        for group in groups
        if abs(service_position - _position(group["main"], 0)) <= MAX_SERVICE_DISTANCE
    ]
    if not nearby:
        return None

    matching = [group for group in nearby if _service_identity_matches(service, group)]
    candidates = matching or nearby
    return min(
        candidates,
        key=lambda group: (
            abs(service_position - _position(group["main"], 0)),
            # When equidistant, a service card before a product belongs to the
            # following product; a service card after it belongs to the prior one.
            0 if (_position(group["main"], 0) > service_position) else 1,
        ),
    )


def process_products(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered = sorted(
        (copy.deepcopy(product) for product in products),
        key=lambda item: _position(item, 0),
    )

    service_cards: list[dict[str, Any]] = []
    product_cards: list[dict[str, Any]] = []
    for product in ordered:
        if _is_video(product) or _is_packaging(product):
            service_cards.append(product)
        elif _photos(product):
            product_cards.append(product)

    groups: list[dict[str, Any]] = []
    for product in product_cards:
        if groups and _can_attach_detail(groups[-1], product):
            group = groups[-1]
            group["details"].append(product)
            group["main"]["photos"] = _unique(_photos(group["main"]) + _photos(product))
            group["main"]["description"] = _merge_description(
                _description(group["main"]), _description(product)
            )
            continue
        groups.append({"main": product, "details": [], "packaging": [], "video": None})

    for service in service_cards:
        group = _nearest_group(service, groups)
        if group is None:
            continue
        if _is_video(service):
            video = _video(service)
            if video[0] and group["video"] is None:
                group["video"] = video
        elif _is_packaging(service):
            group["packaging"].extend(_photos(service))

    result = []
    for group in groups:
        product = group["main"]
        product["photos"] = _unique(_photos(product) + group["packaging"])
        if group["video"]:
            _attach_video(product, group["video"])
        result.append(product)
    return result
