"""Post-process the Chanel Bags all-timeline feed.

The supplier normally publishes a product in reverse order: packaging and a
video card, then the main gallery, then a short detail gallery. The output
must be main gallery -> detail gallery -> packaging photos. A generic
``8/9/11 photos + 4 photos`` rule is unsafe here: unrelated collages and
different bags are often adjacent in the timeline.
"""

from __future__ import annotations

import copy
import json
import re
from typing import Any


PACKAGING_RE = re.compile(r"包装(?:展示|图|清单)?|配套|标配|礼盒|防尘袋|手提袋", re.IGNORECASE)
VIDEO_RE = re.compile(r"(?:实拍)?视频", re.IGNORECASE)
JUNK_RE = re.compile(
    r"合集|图集|拼图|上新(?:预告)?|新品推荐|准备(?:开发|中)?|开发准备|品控|"
    r"我们\s*(?:🆚|vs)?\s*zp|(?<![a-z])zp(?![a-z])|工厂(?:展示|对比)?|档口(?:展示|对比)?|"
    r"(?:产前)?第?一版(?:已出|完工|落地|正式)?|最终版|大货版|初次对皮|对皮(?:中|完成|进度)?|"
    r"开发进度|生产素材碎片|开发素材碎片|打版|开版|待优化|同台.*对比",
    re.IGNORECASE,
)
SERVICE_RE = re.compile(r"尺码表|尺寸表|上身图|模特|真人|穿搭|参考", re.IGNORECASE)
DETAIL_MARKER_RE = re.compile(r"(?:款号|款式|款名|尺寸)\s*[:：]?", re.IGNORECASE)
NON_BAG_ACCESSORY_RE = re.compile(
    r"丝巾(?:扣|环)|包挂|包饰|钥匙扣|腕表|手表|表带|PREMIÈRE|"
    r"耳环|耳饰|项链|手链|手镯|戒指|发夹|发箍|头箍|头饰|蝴蝶结",
    re.IGNORECASE,
)
MODEL_CODE_RE = re.compile(r"\b[A-Z]{1,5}\s*[-.]?\s*\d{3,}\b", re.IGNORECASE)
MAX_PENDING_DISTANCE = 3
MIN_PRODUCT_PHOTOS = 10
MAX_PRODUCT_PHOTOS = 14
MIN_NO_VIDEO_DESCRIPTION_SCORE = 12


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


def _video(product: dict[str, Any]) -> tuple[str | None, str | None]:
    attributes = product.get("attributes") or {}
    if not isinstance(attributes, dict):
        return None, None
    url = attributes.get("szwego_video_url") or attributes.get("video_url")
    poster = attributes.get("szwego_video_poster_url") or attributes.get("video_poster_url")
    return (str(url).strip() if url else None, str(poster).strip() if poster else None)


def _tags(product: dict[str, Any]) -> set[str]:
    """Read the parser's structured Szwego labels, when this batch has them."""
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


def _position(product: dict[str, Any], fallback: int) -> int:
    value = product.get("source_position", fallback)
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _is_primary(product: dict[str, Any], description: str) -> bool:
    """Keep actual bag cards, not service cards or publication collages."""
    # Accessories can have one usable main image and no detail album.
    if not _photos(product) or len(description) < 8:
        return False
    if (
        JUNK_RE.search(description)
        or PACKAGING_RE.search(description)
        or SERVICE_RE.search(description)
        or NON_BAG_ACCESSORY_RE.search(description)
    ):
        return False
    video_url, _ = _video(product)
    return not (video_url or VIDEO_RE.search(description))


def _same_model(left: str, right: str) -> bool:
    left_codes = {re.sub(r"\s+", "", code).upper() for code in MODEL_CODE_RE.findall(left)}
    right_codes = {re.sub(r"\s+", "", code).upper() for code in MODEL_CODE_RE.findall(right)}
    return bool(left_codes & right_codes)


def _same_product(left: dict[str, Any], right: dict[str, Any]) -> bool:
    """Merge only on an explicit supplier identity, never generic copy text."""
    left_tags = _tags(left)
    right_tags = _tags(right)
    # A structured tag comes from Szwego itself. Do not fall back to prose when
    # just one old/service card lacks it: phrases about shape, hardware or
    # factory quality recur between unrelated products in this supplier feed.
    if left_tags or right_tags:
        return bool(left_tags and right_tags and left_tags & right_tags)
    left_description = _description(left)
    right_description = _description(right)
    # Old snapshots without parsed tags remain compatible only when a concrete
    # article is present on both cards. Missing proof means no merge.
    return _same_model(left_description, right_description)


def _is_matching_detail(main: dict[str, Any], candidate: dict[str, Any]) -> bool:
    """Only a short following detail album belongs to the main card."""
    candidate_photos = _photos(candidate)
    if not candidate_photos or len(candidate_photos) > 6:
        return False
    description = _description(candidate)
    if (
        not description
        or JUNK_RE.search(description)
        or PACKAGING_RE.search(description)
        or NON_BAG_ACCESSORY_RE.search(description)
    ):
        return False
    return _same_product(main, candidate)


def _unique(photos: list[str]) -> list[str]:
    seen: set[str] = set()
    return [photo for photo in photos if not (photo in seen or seen.add(photo))]


def _merge_description(main: str, detail: str) -> str:
    return main if not detail or detail == main else f"{main}\n\n{detail}"


def _description_score(product: dict[str, Any]) -> int:
    """Prefer the supplier's actual product copy over a technical detail label."""
    text = _description(product)
    for tag in _tags(product):
        text = re.sub(re.escape(tag), "", text, flags=re.IGNORECASE)
    text = MODEL_CODE_RE.sub("", text)
    text = re.sub(r"(?:款号|款式|款名|尺寸)\s*[:：]?\s*[\w.×xX\-]+", "", text)
    return len(re.sub(r"[\s\d\W_]", "", text))


def _prefer_following_album_as_main(current: dict[str, Any], following: dict[str, Any]) -> bool:
    """The feed sometimes puts close-ups before the actual product gallery."""
    current_score = _description_score(current)
    following_score = _description_score(following)
    # Szwego often posts a 9/10-photo technical set (article/size close-ups)
    # before a short 3-6-photo studio gallery. Once the shared product identity
    # is proven by the caller, the studio gallery must be first even when its
    # marketing copy is shorter than the generic score threshold.
    if (
        7 <= len(_photos(current)) <= 10
        and 3 <= len(_photos(following)) <= 6
        and DETAIL_MARKER_RE.search(_description(current))
        and following_score >= MIN_NO_VIDEO_DESCRIPTION_SCORE
    ):
        return True
    return following_score >= 18 and following_score >= current_score + 12 and following_score * 2 >= current_score * 3


def _is_placeholder_primary(product: dict[str, Any]) -> bool:
    """Recognise a tag-only cover that precedes the actual product gallery."""
    return len(_photos(product)) <= 2 and _description_score(product) < 18


def _is_usable_product(product: dict[str, Any]) -> bool:
    """Keep the supplier's complete bag sets, not incomplete source albums."""
    photo_count = len(_photos(product))
    if not MIN_PRODUCT_PHOTOS <= photo_count <= MAX_PRODUCT_PHOTOS:
        return False
    video_url, _ = _video(product)
    return bool(video_url or _description_score(product) >= MIN_NO_VIDEO_DESCRIPTION_SCORE)


def _attach_video(product: dict[str, Any], video: tuple[str | None, str | None] | None) -> None:
    if not video or not video[0]:
        return
    attributes = dict(product.get("attributes") or {})
    attributes.setdefault("szwego_video_url", video[0])
    if video[1]:
        attributes.setdefault("szwego_video_poster_url", video[1])
    product["attributes"] = attributes


def _append_packaging(product: dict[str, Any], pending_by_id: dict[str, list[str]]) -> None:
    """Append deferred packaging only after the detail album, if there is one."""
    external_id = str(product.get("external_id") or "")
    packaging = pending_by_id.pop(external_id, [])
    if packaging:
        product["photos"] = _unique(_photos(product) + packaging)


def _primary_key(product: dict[str, Any], fallback: int) -> str:
    """Keep transient merge state outside the product JSON passed downstream."""
    return str(product.get("external_id") or f"source-position-{_position(product, fallback)}")


def process_products(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build only Chanel products from their neighbouring service albums."""
    ordered = sorted(
        (copy.deepcopy(product) for product in products),
        key=lambda item: _position(item, 0),
    )
    result: list[dict[str, Any]] = []
    pending_packaging: list[tuple[int, dict[str, Any]]] = []
    pending_videos: list[tuple[int, dict[str, Any]]] = []
    packaging_by_primary_id: dict[str, list[str]] = {}
    detail_attached_to: set[str] = set()

    for fallback, product in enumerate(ordered):
        position = _position(product, fallback)
        description = _description(product)
        photos = _photos(product)
        video = _video(product)

        if JUNK_RE.search(description) or NON_BAG_ACCESSORY_RE.search(description):
            continue
        if PACKAGING_RE.search(description):
            pending_packaging.append((position, product))
            continue
        if video[0] or VIDEO_RE.search(description):
            if video[0]:
                pending_videos.append((position, product))
            continue

        # A bare one/two-photo tag card often precedes the actual gallery for
        # the same colour. It is not a detail set: discard it and retain the
        # substantive following album only. This keeps a different-background
        # cover/model shot out of the final gallery and avoids a duplicate row.
        if result and _is_primary(product, description) and _is_placeholder_primary(result[-1]) and _same_product(result[-1], product):
            discarded = result.pop()
            packaging_by_primary_id.pop(str(discarded.get("external_id") or ""), None)

        if result and _is_matching_detail(result[-1], product):
            main = result[-1]
            main_key = _primary_key(main, fallback)
            # One product block has exactly one secondary detail album. Later
            # short cards can share the same generic Szwego label, but are
            # usually lookbook/model shots on a different background. They are
            # not another detail set and must not turn into a duplicate card.
            if main_key in detail_attached_to:
                continue
            if _prefer_following_album_as_main(main, product):
                main["photos"] = _unique(photos + _photos(main))
                main["description"] = _merge_description(description, _description(main))
            else:
                main["photos"] = _unique(_photos(main) + photos)
                main["description"] = _merge_description(_description(main), description)
            detail_attached_to.add(main_key)
            _append_packaging(main, packaging_by_primary_id)
            continue

        if not _is_primary(product, description):
            continue

        if result:
            _append_packaging(result[-1], packaging_by_primary_id)
        primary = copy.deepcopy(product)
        # A service card belongs only to a nearby following main card. This
        # distance guard keeps workshop/collage albums from the next product
        # out of the gallery.
        nearby_packaging = [
            _photos(service_product)
            for service_position, service_product in pending_packaging
            if 0 < position - service_position <= MAX_PENDING_DISTANCE
            and _same_product(primary, service_product)
        ]
        nearby_videos = [
            _video(service_product)
            for service_position, service_product in pending_videos
            if 0 < position - service_position <= MAX_PENDING_DISTANCE
            and _same_product(primary, service_product)
        ]
        primary["photos"] = _unique(photos)
        _attach_video(primary, nearby_videos[0] if nearby_videos else None)
        result.append(primary)
        if nearby_packaging:
            packaging_by_primary_id[str(primary.get("external_id") or "")] = _unique(
                [photo for group in nearby_packaging for photo in group]
            )
        pending_packaging = []
        pending_videos = []

    if result:
        _append_packaging(result[-1], packaging_by_primary_id)
    # Validate the completed gallery only after main, detail and packaging
    # albums have been assembled. Video cards carry enough visual proof; a
    # no-video card also needs meaningful supplier copy, not just a tag/code.
    return [product for product in result if _is_usable_product(product)]
