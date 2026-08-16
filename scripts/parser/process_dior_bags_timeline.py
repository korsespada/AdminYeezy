"""Post-process Dior Bags timeline posts without supplier tags.

The supplier places video cards before the product albums.  A video can be a
single-model clip or an overview of a consecutive colour family.  There are no
Szwego tags on the video cards, so association is deliberately limited to the
small, ordered block immediately after each video; a video is never assigned
just because a later bag is nearby.
"""

from __future__ import annotations

import copy
import json
import re
import unicodedata
from typing import Any


BRACKETED_PRODUCT_RE = re.compile(r"^\s*【([^】]+)】")
MAX_VIDEO_LEAD_DISTANCE = 3
MAX_VARIANT_GAP = 2
MIN_FAMILY_KEY_LENGTH = 5


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


def _product_label(product: dict[str, Any]) -> str | None:
    match = BRACKETED_PRODUCT_RE.match(_description(product))
    return match.group(1) if match else None


def _normalized_label(label: str) -> str:
    """Normalise decorative Latin glyphs but retain the full supplier label."""
    return "".join(
        char for char in unicodedata.normalize("NFKC", label).casefold()
        if not char.isspace()
    )


def _shared_prefix(left: str, right: str) -> str:
    prefix: list[str] = []
    for left_char, right_char in zip(left, right):
        if left_char != right_char:
            break
        prefix.append(left_char)
    return "".join(prefix)


def _family_indices_after_video(
    ordered: list[dict[str, Any]],
    video_index: int,
    segment_end: int,
) -> list[int]:
    """Return a bounded consecutive colour family after one video card.

    Two bracketed labels with a meaningful common prefix prove a colour family.
    Unlabelled photo albums are kept only between those proven variants; this
    permits a supplier to omit one colour caption without treating a preceding
    overview collage as a standalone catalogue item.
    """
    video_position = _position(ordered[video_index], video_index)
    anchors: list[tuple[int, str]] = []

    for index in range(video_index + 1, segment_end):
        product = ordered[index]
        label = _product_label(product)
        if not label:
            continue
        if not anchors and _position(product, index) - video_position > MAX_VIDEO_LEAD_DISTANCE:
            return []
        if anchors and _position(product, index) - _position(ordered[anchors[-1][0]], anchors[-1][0]) > MAX_VARIANT_GAP:
            break
        anchors.append((index, _normalized_label(label)))

    if len(anchors) < 2:
        return []

    family_key = _shared_prefix(anchors[0][1], anchors[1][1])
    if len(family_key) < MIN_FAMILY_KEY_LENGTH:
        return []

    family_anchors = [anchors[0][0], anchors[1][0]]
    for index, label in anchors[2:]:
        if not label.startswith(family_key):
            break
        family_anchors.append(index)

    if len(family_anchors) < 2:
        return []

    first_anchor, last_anchor = family_anchors[0], family_anchors[-1]
    family_indices = set(family_anchors)
    for index in range(first_anchor + 1, last_anchor):
        product = ordered[index]
        if _photos(product) and not _video(product)[0] and _product_label(product) is None:
            family_indices.add(index)
    return sorted(family_indices)


def _attach_video(product: dict[str, Any], video: tuple[str | None, str | None]) -> None:
    url, poster = video
    if not url:
        return
    attributes = dict(product.get("attributes") or {})
    attributes.setdefault("szwego_video_url", url)
    if poster:
        attributes.setdefault("szwego_video_poster_url", poster)
    product["attributes"] = attributes


def process_products(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Emit Dior product albums and attach nearby single/family video cards."""
    ordered = sorted(
        (copy.deepcopy(product) for product in products),
        key=lambda item: _position(item, 0),
    )
    included: set[int] = {
        index for index, product in enumerate(ordered)
        if _product_label(product) is not None and _photos(product) and not _video(product)[0]
    }

    video_indices = [index for index, product in enumerate(ordered) if _video(product)[0]]
    for offset, video_index in enumerate(video_indices):
        segment_end = video_indices[offset + 1] if offset + 1 < len(video_indices) else len(ordered)
        video = _video(ordered[video_index])
        family_indices = _family_indices_after_video(ordered, video_index, segment_end)
        if family_indices:
            for index in family_indices:
                included.add(index)
                _attach_video(ordered[index], video)
            continue

        # A single product may follow a video through a few technical/preview
        # albums.  The strict distance guard rejects a video from a neighbouring
        # product block when no family identity is available.
        video_position = _position(ordered[video_index], video_index)
        for index in range(video_index + 1, segment_end):
            product = ordered[index]
            if _position(product, index) - video_position > MAX_VIDEO_LEAD_DISTANCE:
                break
            if _product_label(product) is not None and _photos(product):
                _attach_video(product, video)
                break

    return [product for index, product in enumerate(ordered) if index in included]
