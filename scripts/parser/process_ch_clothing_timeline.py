"""Post-process the `CH Одежда` Szwego all-timeline feed (supplier 5).

Feed evidence (immutable raw ``SCRAPED`` snapshot of batch
``b2446b7d-0fe8-4434-988b-c3bb9dfd02b4``, 493 albums, complete batch):

* 112 albums are a bare ``➨`` without photos; they delimit product blocks.
* 54 albums are the real product cards: a brand (``Chrome Hearts``/``克罗心``),
  a full description and 4 photos (one card has 6).  A card is always the last
  album of its own service run, and no block holds albums after its last card.
* The supplier publishes the service albums of a product *before* its card:
  ``尺码表`` (32), ``实拍视频`` (47), on-model/look albums such as
  ``上身图参考``, ``搭配``, ``look``, ``张韶涵同款`` (45 cards), packaging
  ``标配：配套YB雪梨纸 手提袋+6`` (48) and ``局部细节参考`` (52 cards).
* 46 blocks consist of a single album: stock/ad posts (``‼️今日份资讯分享‼️``,
  ``‼️原版开发‼️…``, ``一系列 齐码现货``, ``三色``, ``原版级绣花一致``).  They
  never contain a card and must not become catalogue products.
* The same model is republished per colour, and the colours are split either
  inside one block (63/68/74, 110/114/118, 210/216/222/228, 386/392,
  449/454) or over adjacent blocks (82/90, 97/103, 142/149/156, 256/263/270,
  344/349/353).  Models that differ in garment type are different products
  (179 短裤 / 186 长裤; 440 短裤 / 461 卫裤 / 468 套头卫衣 / 475 连帽卫衣).

Rules implemented here:

1. ``➨`` closes the block of one product run.
2. The product card is the album that carries the brand and a full
   description; everything between the previous card and it belongs to it.
3. The card keeps photos 1 and 3 of its cover album: the 2nd and 4th photo are
   the same shots taken at an angle (verified on the raw pictures of #7).
4. Gallery order: cover → ``局部细节`` → on-model photos → ``尺码表`` last.
   Packaging albums and single-photo text albums are dropped.
5. Video: the card's own ``实拍视频`` album wins.  When a colour family has
   exactly one video (or one size chart) in total, every card of the family
   gets it — the operator confirmed one shared video belongs to all colours.
6. Cards whose descriptions match after removing colour words form one colour
   family even across ``➨``, with a stable md5 ``variant_group_key``; a lone
   card gets no key.
7. The processor is idempotent: produced cards carry
   ``attributes.album_merge_version`` and a second run returns the input.
"""

from __future__ import annotations

import copy
import hashlib
import re
from typing import Any

MERGE_VERSION = "ch-clothing-timeline-2"
SUPPLIER_KEY = "ch-clothing"

SEPARATOR = "➨"
BRAND_RE = re.compile(r"chrome\s*hearts|克罗心", re.IGNORECASE)
# The double exclamation glyph marks supplier stock/ad posts, never a card.
BANG_RE = re.compile("\u203c")
SIZE_RE = re.compile(r"尺码表|尺寸表|尺码标|尺寸标", re.IGNORECASE)
PACK_RE = re.compile(r"标配|雪梨纸|手提袋|包装|配套")
DETAIL_RE = re.compile(r"局部细节|细节参考|细节图|细节")
COLLAGE_RE = re.compile(r"集合|合集|图集|拼图")
# A service caption stays a service caption even when it names the brand
# ("𝗖𝗵𝗿𝗼𝗺𝗲 𝗛𝗲𝗮𝗿𝘁𝘀上身图参考", "上身图参考 灰色卫衣太好穿了").
SERVICE_CAPTION_RE = re.compile(
    r"上身图|上身参考|上身照|上身效果|模特|搭配|look|试穿|"
    r"尺码表|尺寸表|标配|雪梨纸|手提袋|局部细节|细节参考",
    re.IGNORECASE,
)
EMOJI_RE = re.compile("[\U0001F000-\U0001FAFF\u2190-\u2BFF\uFE0F\U0001F1E6-\U0001F1FF]+")
# Colour words are removed before two descriptions are compared: the supplier
# republishes the same model card for every colour with an otherwise identical
# text, and splits those cards over several ➨ blocks.
COLOUR_RE = re.compile(
    r"黑|白|红|蓝|绿|紫|粉|灰|黄|棕|橙|藏青|藏蓝|卡其|奶茶|米|咖|银|金|彩|色|"
    r"black|white|red|blue|green|purple|pink|grey|gray|yellow|brown|orange|"
    r"beige|khaki|silver|gold|cream|ivory",
    re.IGNORECASE,
)
NON_WORD_RE = re.compile(r"[\W_]+", re.UNICODE)
# A card occasionally repeats the colour and the size line at the very end
# ("… 单穿内搭都能打。 黑色 / S M L"), which is not part of the model text.
TRAILING_SIZE_RE = re.compile(r"(?:[smlx]{1,5}|\d{1,3}|均码|码|号)+$", re.IGNORECASE)
FAMILY_NAME_CUT_RE = re.compile(r"[，。！,\.!（(]")
# 1-based positions 2 and 4 of the cover album: the angled repeat of the 1st
# and 3rd shot.
COVER_DROP_INDEXES = frozenset({1, 3})


def _text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _photos(product: dict[str, Any]) -> list[str]:
    photos = product.get("photos") or []
    if not isinstance(photos, list):
        return []
    return [str(photo) for photo in photos if photo]


def _position(product: dict[str, Any], fallback: int = 0) -> int:
    try:
        return int(product.get("source_position", fallback))
    except (TypeError, ValueError):
        return fallback


def _video(product: dict[str, Any]) -> tuple[str | None, str | None]:
    attributes = product.get("attributes") or {}
    if not isinstance(attributes, dict):
        return None, None
    url = _text(attributes.get("szwego_video_url") or attributes.get("video_url"))
    poster = _text(
        attributes.get("szwego_video_poster_url") or attributes.get("video_poster_url")
    )
    return (url or None, poster or None)


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def _is_card(product: dict[str, Any], description: str) -> bool:
    """A catalogue card: brand, full description, more than one photo."""
    if len(_photos(product)) < 2 or len(description) < 12:
        return False
    if not BRAND_RE.search(description):
        return False
    if BANG_RE.search(description) or COLLAGE_RE.search(description):
        return False
    if SIZE_RE.search(description) or SERVICE_CAPTION_RE.search(description):
        return False
    return True


def _role(product: dict[str, Any], description: str) -> str:
    photos = _photos(product)
    if not photos and description == SEPARATOR:
        return "separator"
    if _is_card(product, description):
        return "card"
    if _video(product)[0]:
        return "video"
    if SIZE_RE.search(description):
        return "size"
    if PACK_RE.search(description):
        return "pack"
    if DETAIL_RE.search(description):
        return "detail"
    if len(photos) >= 2:
        return "model"
    return "noise"


def _cover_photos(product: dict[str, Any]) -> list[str]:
    return [
        photo
        for index, photo in enumerate(_photos(product))
        if index not in COVER_DROP_INDEXES
    ]


def _build_card(
    card: dict[str, Any], owned: list[dict[str, Any]]
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return the product card with its service albums attached."""
    merged = copy.deepcopy(card)
    cover = _cover_photos(card)
    details: list[str] = []
    models: list[str] = []
    sizes: list[str] = []
    videos: list[tuple[str, str | None, dict[str, Any]]] = []
    positions = [_position(card)]
    attached = {"detail": 0, "model": 0, "size": 0, "video": 0}
    size_source: dict[str, Any] | None = None

    for album in owned:
        role = _role(album, _text(album.get("description")))
        if role == "detail":
            details.extend(_photos(album))
            attached["detail"] += 1
        elif role == "model":
            models.extend(_photos(album))
            attached["model"] += 1
        elif role == "size":
            sizes.extend(_photos(album))
            attached["size"] += 1
            size_source = album
        elif role == "video":
            url, poster = _video(album)
            if url:
                videos.append((url, poster, album))
                attached["video"] += 1
        else:
            # Packaging, single-photo text albums and noise are dropped.
            continue
        positions.append(_position(album))

    merged["photos"] = _unique(cover + details + models + sizes)
    attributes = dict(merged.get("attributes") or {})
    video_meta: tuple[str, str | None, dict[str, Any]] | None = videos[0] if videos else None
    if video_meta is not None:
        url, poster, album = video_meta
        attributes.setdefault("szwego_video_url", url)
        if poster:
            attributes.setdefault("szwego_video_poster_url", poster)
        attributes["album_video_source_id"] = str(album.get("external_id") or "")
    if size_source is not None:
        attributes["size_chart_source_id"] = str(size_source.get("external_id") or "")
    attributes["album_merge_version"] = MERGE_VERSION
    attributes["album_source_positions"] = sorted(set(positions))
    attributes["album_attached"] = {key: value for key, value in attached.items() if value}
    merged["attributes"] = attributes
    meta = {
        "sizes": sizes,
        "size_source_id": str(size_source.get("external_id") or "") if size_source else None,
        "video": video_meta,
    }
    return merged, meta


def _family_text(description: str) -> str:
    text = EMOJI_RE.sub("", description)
    text = COLOUR_RE.sub("", text)
    text = NON_WORD_RE.sub("", text).lower()
    return TRAILING_SIZE_RE.sub("", text)


def _family_name(descriptions: list[str]) -> str:
    """A colour-neutral readable name: the common prefix of the family."""
    texts = [_text(EMOJI_RE.sub("", description)) for description in descriptions]
    name = texts[0] if texts else ""
    for other in texts[1:]:
        limit = min(len(name), len(other))
        index = 0
        while index < limit and name[index] == other[index]:
            index += 1
        name = name[:index]
    cut = FAMILY_NAME_CUT_RE.search(name)
    if cut:
        name = name[: cut.start()]
    return name.strip()[:80] or "Chrome Hearts"


def _apply_families(cards: list[tuple[dict[str, Any], dict[str, Any]]]) -> None:
    groups: dict[str, list[tuple[dict[str, Any], dict[str, Any]]]] = {}
    for card, meta in cards:
        groups.setdefault(_family_text(_text(card.get("description"))), []).append((card, meta))

    for members in groups.values():
        if len(members) < 2:
            card = members[0][0]
            card["variant_group_key"] = None
            card["variant_group_name"] = None
            continue
        family_key = hashlib.md5(
            f"{SUPPLIER_KEY}|{_family_text(_text(members[0][0].get('description')))}".encode("utf-8")
        ).hexdigest()
        family_name = _family_name([_text(card.get("description")) for card, _meta in members])
        videos = {meta["video"][0]: meta["video"] for _, meta in members if meta["video"]}
        charts = {
            tuple(meta["sizes"]): meta for _, meta in members if meta["sizes"]
        }
        for card, meta in members:
            card["variant_group_key"] = family_key
            card["variant_group_name"] = family_name
            attributes = card["attributes"]
            attributes["album_family_key"] = family_key
            attributes["album_family_name"] = family_name
            attributes["album_family_size"] = len(members)
            if not attributes.get("szwego_video_url") and len(videos) == 1:
                url, poster, album = next(iter(videos.values()))
                attributes["szwego_video_url"] = url
                if poster:
                    attributes["szwego_video_poster_url"] = poster
                attributes["album_video_source_id"] = str(album.get("external_id") or "")
                attributes["album_video_shared"] = True
            if not meta["sizes"] and len(charts) == 1:
                shared = next(iter(charts.values()))
                card["photos"] = _unique(_photos(card) + list(shared["sizes"]))
                attributes["size_chart_source_id"] = shared["size_source_id"]
                attributes["album_size_chart_shared"] = True


def process_products(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(products, list):
        raise ValueError("products должен быть массивом")
    ordered = sorted(
        (copy.deepcopy(product) for product in products),
        key=lambda product: _position(product),
    )
    if any(
        isinstance(product.get("attributes"), dict)
        and product["attributes"].get("album_merge_version") == MERGE_VERSION
        for product in ordered
    ):
        return ordered

    blocks: list[list[dict[str, Any]]] = []
    block: list[dict[str, Any]] = []
    for product in ordered:
        description = _text(product.get("description"))
        if not _photos(product) and description == SEPARATOR:
            if block:
                blocks.append(block)
            block = []
            continue
        block.append(product)
    if block:
        blocks.append(block)

    cards: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for block in blocks:
        card_indexes = [
            index
            for index, product in enumerate(block)
            if _role(product, _text(product.get("description"))) == "card"
        ]
        previous = -1
        for index in card_indexes:
            cards.append(_build_card(block[index], block[previous + 1 : index]))
            previous = index

    _apply_families(cards)
    return [card for card, _meta in cards]
