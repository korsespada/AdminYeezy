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
LATIN_PHRASE_RE = re.compile(r"[A-Za-z][A-Za-z0-9'’-]*(?:\s+[A-Za-z][A-Za-z0-9'’-]*)+")
GENERIC_LATIN_PHRASES = {"video", "size chart", "product video"}

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


def _shared_latin_phrase(left: str, right: str) -> bool:
    right_phrases = {
        " ".join(phrase.split()).casefold()
        for phrase in LATIN_PHRASE_RE.findall(right)
    }
    return any(
        " ".join(phrase.split()).casefold() in right_phrases
        and " ".join(phrase.split()).casefold() not in GENERIC_LATIN_PHRASES
        for phrase in LATIN_PHRASE_RE.findall(left)
    )


def _same_product(left: dict[str, Any], right: dict[str, Any]) -> bool:
    """Use the exact Szwego tag group before any text fallback."""
    left_tags = _tags(left)
    right_tags = _tags(right)
    if left_tags or right_tags:
        # The supplier now publishes one identical tag set on every album of
        # a product. Intersecting tags is unsafe: a broad tag could otherwise
        # pull photos from a neighbouring product into this gallery.
        return bool(left_tags and right_tags and left_tags == right_tags)

    left_text = _description(left)
    right_text = _description(right)
    left_codes = _model_codes(left_text)
    right_codes = _model_codes(right_text)
    return (
        bool(left_codes & right_codes)
        or _shared_phrase(left_text, right_text)
        or _shared_latin_phrase(left_text, right_text)
    )


def _is_video(product: dict[str, Any]) -> bool:
    # The main LV album itself can carry a video badge and `video_url`.
    # A real product gallery must stay a product, not become a service card.
    if len(_photos(product)) >= MIN_MAIN_PHOTOS:
        return False
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


def _detail_photos(product: dict[str, Any]) -> list[str]:
    # In the four-album LV block the long album is the detail set. Its first
    # frame repeats the cover from the following four-photo main album.
    return _photos(product)[1:]


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
    # Once parsed tags are available, a service card must never fall back to a
    # merely nearby product. That would attach packaging/video to a different
    # bag when the supplier publishes two blocks next to one another.
    if _tags(service) and not matching:
        return None
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
    index = 0
    while index < len(product_cards):
        product = product_cards[index]
        next_product = product_cards[index + 1] if index + 1 < len(product_cards) else None

        # LV's four-album block is published as long detail album -> short
        # main album. The short card owns the product identity and becomes the
        # output card; the long card contributes detail photos and video.
        if (
            next_product is not None
            and len(_photos(product)) >= MIN_MAIN_PHOTOS
            and 1 <= len(_photos(next_product)) <= MAX_DETAIL_PHOTOS
            and _position(next_product, 0) - _position(product, 0) <= 2
            and _same_product(product, next_product)
        ):
            main = next_product
            main["photos"] = _unique(_photos(main) + _detail_photos(product))
            main["description"] = _merge_description(
                _description(main), _description(product)
            )
            groups.append({
                "main": main,
                "details": [product],
                "packaging": [],
                "video": _video(product) if _video(product)[0] else None,
            })
            index += 2
            continue

        # A long album without a following matching short album is the normal
        # three-album form: main photos -> video -> packaging.
        if len(_photos(product)) >= MIN_MAIN_PHOTOS:
            groups.append({"main": product, "details": [], "packaging": [], "video": None})
        # Short albums that were not joined are discarded at the end.
        index += 1

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
