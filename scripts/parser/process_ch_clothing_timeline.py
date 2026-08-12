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
MODEL_RE = re.compile(r"上身图|上身照|模特|真人|穿搭|试穿|二手|中古", re.IGNORECASE)
PACKAGING_RE = re.compile(r"标配|雪梨纸|手提袋|包装|配套", re.IGNORECASE)
OUTFIT_RE = re.compile(r"搭(?:配|短裙|工装裤)|配工装裤|配短裙|穿搭", re.IGNORECASE)
DETAIL_RE = re.compile(r"局部细节|细节(?:参考|图)?|细节参考", re.IGNORECASE)
VIDEO_RE = re.compile(r"(?:实拍|上身)?视频", re.IGNORECASE)
COLLECTION_RE = re.compile(r"集合图|图集|拼图|上新(?:预告|合集)?|新品推荐", re.IGNORECASE)
REFERENCE_RE = re.compile(r"同款|参考", re.IGNORECASE)


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
    return not any(pattern.search(description) for pattern in (
        SIZE_RE, MODEL_RE, PACKAGING_RE, OUTFIT_RE, DETAIL_RE, VIDEO_RE, COLLECTION_RE, REFERENCE_RE,
    ))


def _unique(items: list[str]) -> list[str]:
    seen: set[str] = set()
    return [item for item in items if not (item in seen or seen.add(item))]


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
    pending_video: tuple[str | None, str | None] = (None, None)

    for product in ordered:
        description = _description(product)
        if SEPARATOR_RE.match(description):
            # Never carry an incomplete service block into the next explicit one.
            pending_photos = []
            pending_video = (None, None)
            continue

        if _is_primary(product, description):
            result.append(_merge_pending(product, pending_photos, pending_video))
            pending_photos = []
            pending_video = (None, None)
            continue

        video = _video(product)
        if video[0] or VIDEO_RE.search(description):
            # The video card is usually before the primary card, including when
            # the supplier omitted a `➨` separator.
            if video[0]:
                pending_video = video
            continue

        if DETAIL_RE.search(description):
            pending_photos.extend(_photos(product))
            continue

        # Size tables, model shots, packaging/lifestyle collages and captions
        # are intentionally discarded; they must not become catalogue products.

    return result
