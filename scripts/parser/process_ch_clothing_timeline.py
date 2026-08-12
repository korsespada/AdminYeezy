"""Post-process the `CH Одежда` Szwego all-timeline feed.

The supplier publishes each product in reverse order: service albums (detail
photos and a video) normally appear immediately *before* the actual product
card.  `➨` is useful as a loose boundary but is not present for every product,
so a product description is the only record that commits an accumulated block.
"""

from __future__ import annotations

import copy
import json
import re
from typing import Any


SEPARATOR_RE = re.compile(r"^\s*➨\s*$")
SIZE_RE = re.compile(r"尺码表|尺寸表|size\s*(?:chart|guide|table)", re.IGNORECASE)
MODEL_RE = re.compile(r"上身图|上身照|模特|真人|穿搭|试穿", re.IGNORECASE)
PACKAGING_RE = re.compile(r"标配|雪梨纸|手提袋|包装|配套", re.IGNORECASE)
OUTFIT_RE = re.compile(r"搭(?:配|短裙|工装裤)|配工装裤|配短裙|穿搭", re.IGNORECASE)
# Do not match the ordinary word 细节 in a product description, such as
# "版型细节全部还原". Only album-style captions belong to this category.
DETAIL_RE = re.compile(r"局部细节|细节(?:参考|图)", re.IGNORECASE)
VIDEO_RE = re.compile(r"(?:实拍|上身)?视频", re.IGNORECASE)
COLLECTION_RE = re.compile(r"集合图|图集|拼图|上新(?:预告|合集)?|新品推荐", re.IGNORECASE)
# `中古` (vintage) and `男女同款` are common parts of actual CH product
# descriptions.  Treat references as service content only with an explicit
# model/celebrity signal.
REFERENCE_RE = re.compile(r"(?:上身图|上身照|模特|真人).*(?:同款|参考)|(?:虞书欣|钟欣潼).*(?:同款|参考)", re.IGNORECASE)
HARDWARE_RE = re.compile(r"原版五金|925\s*(?:制银|银)|纯银|纽扣|拉链|百达灵|百灵达", re.IGNORECASE)
BRAND_RE = re.compile(r"chrome\s*hearts|克罗心", re.IGNORECASE)
PROMO_RE = re.compile(r"面料像缎子|显白天花板|真的太帅|哪个颜色都好看|随便搭配", re.IGNORECASE)
# These are supplier-wide advertising albums, not product cards.  Require the
# announcement marker, but not a second marker: this supplier uses both forms
# (`‼️原版开发‼️` and `‼️原版开发克罗心…`).  A normal description such as
# `原版：5500购入开发` is deliberately not matched.
DEVELOPMENT_PROMO_RE = re.compile(r"‼\ufe0f?\s*原版\s*开发", re.IGNORECASE)
# Keep these narrow and caption-shaped.  For example, a genuine long product
# description may mention `热固油材质印花` or `全码现货秒发`.
STANDALONE_PROMO_RE = re.compile(
    r"^(?:"
    r"顶级\s*(?:长袖|短袖)\s*现货\s*秒发|"
    r"发货\s*发到过年.*?(?:新款.*?在仓|在仓).*?现货\s*秒发|"
    r"真正顶级工艺[：:].*?热固油材质印花|"
    r"自然光下.*?原版暗纹面料|"
    r"手工制作工艺.*?热固油|"
    r"正品原厂.*?(?:面料供应|原版一致)|"
    r"直线距离.*?感受一下|"
    r"真正的手工制作工艺.*?热固油"
    r")",
    re.IGNORECASE,
)
# Text-only shop/factory/lifestyle posts which contain neither a concrete item
# nor a usable product presentation.  Keep this separate from product-copy
# terms such as `热固油材质印花`, which can be part of a real description.
SHOWCASE_PROMO_RE = re.compile(
    r"(?:显白.*?打光|打光.*?显白)|"
    r"YB展示.*?(?:最后一次联名|Mattyboy)|"
    r"YB开发.*?(?:颜色定染对色|区别市场货)|"
    r"季度热门.*?mattyboy",
    re.IGNORECASE,
)
COLOR_RE = re.compile(r"黑|白|红|蓝|绿|紫|粉|灰|黄|棕|橙")


def _description(product: dict[str, Any]) -> str:
    return " ".join(str(product.get("description") or "").split())


def _photos(product: dict[str, Any]) -> list[str]:
    photos = product.get("photos") or []
    if isinstance(photos, list):
        return [str(photo) for photo in photos if photo]
    try:
        parsed = json.loads(photos)
    except (TypeError, json.JSONDecodeError):
        return []
    return [str(photo) for photo in parsed] if isinstance(parsed, list) else []


def _video(product: dict[str, Any]) -> tuple[str | None, str | None]:
    attrs = product.get("attributes") or {}
    if not isinstance(attrs, dict):
        return None, None
    url = attrs.get("szwego_video_url") or attrs.get("video_url")
    poster = attrs.get("szwego_video_poster_url") or attrs.get("video_poster_url")
    return (
        str(url).strip() if url else None,
        str(poster).strip() if poster else None,
    )


def _is_primary(product: dict[str, Any], description: str) -> bool:
    """A real card has a substantive description, not a service-caption."""
    if len(description) < 12 or not (_photos(product) or _video(product)[0]):
        return False
    if any(pattern.search(description) for pattern in (
        SIZE_RE, MODEL_RE, OUTFIT_RE, DETAIL_RE, VIDEO_RE, COLLECTION_RE, REFERENCE_RE,
        PROMO_RE, DEVELOPMENT_PROMO_RE, STANDALONE_PROMO_RE, SHOWCASE_PROMO_RE,
    )):
        return False
    # Product descriptions often mention the included packaging or 925 hardware.
    # Those words mean "service album" only when the card does not identify CH.
    if (PACKAGING_RE.search(description) or HARDWARE_RE.search(description)) and not BRAND_RE.search(description):
        return False
    return True


def _unique(items: list[str]) -> list[str]:
    seen: set[str] = set()
    return [item for item in items if not (item in seen or seen.add(item))]


def _shared_chinese_phrase(left: str, right: str) -> str:
    """Return a meaningful common Chinese product-name fragment, if any."""
    best = ""
    for phrase in re.findall(r"[\u4e00-\u9fff]{5,}", left):
        for offset in range(len(phrase) - 4):
            candidate = phrase[offset:]
            if candidate in right and len(candidate) > len(best):
                best = candidate
    return best


def _can_merge_adjacent_primary(previous: dict[str, Any], current: dict[str, Any]) -> bool:
    """Recognise a long presentation album immediately followed by its set."""
    previous_photos = _photos(previous)
    current_photos = _photos(current)
    if len(previous_photos) < 8 or not current_photos or len(current_photos) > 6:
        return False
    previous_description = _description(previous)
    current_description = _description(current)
    # Do not fold separate explicitly coloured variants into one record.
    previous_colours = set(COLOR_RE.findall(previous_description))
    current_colours = set(COLOR_RE.findall(current_description))
    if previous_colours and current_colours and previous_colours != current_colours:
        return False
    return len(_shared_chinese_phrase(previous_description, current_description)) >= 5


def _merge_primary_albums(previous: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    merged = copy.deepcopy(previous)
    merged["photos"] = _unique(_photos(previous) + _photos(current))
    previous_attributes = dict(merged.get("attributes") or {})
    current_video, current_poster = _video(current)
    if current_video:
        previous_attributes.setdefault("szwego_video_url", current_video)
        if current_poster:
            previous_attributes.setdefault("szwego_video_poster_url", current_poster)
    merged["attributes"] = previous_attributes
    return merged


def _merge_pending(primary: dict[str, Any], pending_photos: list[str], video: tuple[str | None, str | None]) -> dict[str, Any]:
    merged = copy.deepcopy(primary)
    merged["photos"] = _unique(_photos(primary) + pending_photos)
    video_url, poster_url = video
    if video_url:
        attributes = dict(merged.get("attributes") or {})
        # A genuine video attached to the product itself has priority.
        attributes.setdefault("szwego_video_url", video_url)
        if poster_url:
            attributes.setdefault("szwego_video_poster_url", poster_url)
        merged["attributes"] = attributes
    return merged


def process_products(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep CH product cards and attach preceding detail/video albums to them."""
    ordered = sorted(
        (copy.deepcopy(product) for product in products),
        key=lambda product: product.get("source_position", 0),
    )
    result: list[dict[str, Any]] = []
    pending_photos: list[str] = []
    pending_videos: list[tuple[str | None, str | None]] = []
    separator_since_primary = True

    for product in ordered:
        description = _description(product)
        if SEPARATOR_RE.match(description):
            # Never carry an incomplete service block into the next explicit one.
            pending_photos = []
            pending_videos = []
            separator_since_primary = True
            continue

        if _is_primary(product, description):
            # A supplier can publish several videos before several colour/product
            # cards. Keep their source order instead of overwriting the previous URL.
            pending_video = pending_videos.pop(0) if pending_videos else (None, None)
            primary = _merge_pending(product, pending_photos, pending_video)
            # Some adjacent album pairs have no `局部细节` caption: a large
            # presentation gallery is followed by a short gallery with the
            # same product-name core.  Merge only this asymmetric shape so
            # ordinary colour cards (usually 4+4 photos) stay independent.
            if result and not separator_since_primary and _can_merge_adjacent_primary(result[-1], primary):
                result[-1] = _merge_primary_albums(result[-1], primary)
            else:
                result.append(primary)
            pending_photos = []
            separator_since_primary = False
            continue

        video = _video(product)
        if video[0] or VIDEO_RE.search(description):
            # The video card is usually before the primary card, including when
            # the supplier omitted a `➨` separator.
            if video[0]:
                pending_videos.append(video)
            continue

        if DETAIL_RE.search(description) or (HARDWARE_RE.search(description) and not BRAND_RE.search(description)):
            pending_photos.extend(_photos(product))
            continue

        # Size tables, model shots, packaging/lifestyle collages and captions
        # are intentionally discarded; they must not become catalogue products.

    return result
