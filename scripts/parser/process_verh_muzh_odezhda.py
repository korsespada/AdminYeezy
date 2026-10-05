"""Merge the Szwego album stream of «Верх Муж Одежда» (supplier 71).

Feed evidence (immutable raw `SCRAPED` snapshot of batch
``a4daf287-4af4-4388-8753-ae504e5eef9b``, 486 albums, complete batch):

* The feed is published as one album per post and is fragmented: a colour is
  its own album, while the shared caption and the size chart live in separate
  albums.  A family is closed by its caption album, whose text starts with the
  ``📍`` marker ("📍 Prada - Down jacket (feather)Size：48-56Color ：White Blue
  Red Green Black"); the batch contains 83 caption albums and 83 families.
* 62 albums have the caption ``-`` and no photos at all; they are separators
  between families and never become catalogue products.
* 45 albums are captioned ``[Synchronization]`` and carry one or two model
  shots.  Verified on the raw pictures (#2 Prada jacket, #11 Loro Piana coat):
  the photo shows one specific colour of the family, so it is never attached to
  the other colours.
* 40 albums are captioned ``【size】``/``【Size】`` and hold the size chart of
  their family.  The chart belongs to the whole family and is copied to every
  colour, staying last in the gallery.
* 150 albums are captioned ``【Colour】`` and hold the gallery of one colour.
* 106 albums are detail albums whose caption names the colour ("Details of
  White Pants", "Details of White Coat", "[Blue Detail]", "Cowboy Blue
  Details").  30 families have no ``【Colour】`` album at all and are built from
  these detail albums only.
* One colour is regularly split over two albums: ``【Gray】`` 6 photos followed
  by ``【Gray】`` 9 photos (batch positions 330-331), or "Details of White
  Pants" followed by "Details of White Coat".  The supplier's own caption album
  lists both as one colour ("Color：Blue Gray", "Color ：Brown Beige Blue"),
  so the family has one product per colour, not one per album.
* Operator requirement confirmed on the screenshot examples: albums #4-#8 take
  the caption of #9 and the size chart of #3, albums #13-#16 take the caption of
  #17 and the size chart of #12, and each of those groups becomes one colour
  family.

Rules implemented here:

1. A family is the run of albums that ends with its ``📍`` caption album.
2. Separator, ``[Synchronization]`` and caption albums never become catalogue
   products.  The caption is copied verbatim into the description of every
   colour of the family; the caption's own photos are the per-colour covers and
   are not attached.
3. Every album of one colour merges into a single product: the earliest album by
   ``source_position`` keeps ``external_id`` and ``source_position``, the other
   galleries are appended in source order, the size chart goes last.
4. A colour is taken from the ``【...】`` tag, or from the caption of a detail
   album after removing detail and garment words.  Grey spellings are unified so
   "Dark Grey Coat" and "dark gray pants" stay one colour.
5. A detail album without a colour word (only "🛶2026 FW NOW AVAILABLE" in this
   batch) is an advertisement and is dropped.
6. A family with more than one colour gets a stable md5 ``variant_group_key``
   and its readable ``variant_group_name``.  A single-colour family gets no key.
7. A colour that is a one-album ``【Hand-made】``/``【Hand-knitted】`` variant with
   two or three photos is not published.
8. Where a colour merges two albums (a suit: trousers + jacket) and the caption
   album holds exactly one photo per colour, that photo becomes the cover of the
   matching colour, taken in the reverse order of the feed.  Where the family has
   a single colour, the ``[Synchronization]`` model shots are appended to that
   product before the size chart.
9. The per-colour value is recorded in ``attributes.colors`` and
   ``attributes.album_colour`` so AI normalization can name each variant, and in
   ``attributes.album_family_name`` for the colour family itself.
10. The processor is idempotent: every produced card carries
    ``attributes.album_merge_version``, and a second run returns the input.
"""

from __future__ import annotations

import copy
import hashlib
import re
import unicodedata
from typing import Any

MERGE_VERSION = "verh-muzh-odezhda-albums-2"
SUPPLIER_KEY = "verh-muzh-odezhda"

DESCRIPTION_MARKER = "\U0001F4CD"
EMPTY_DESCRIPTIONS = frozenset({"", "-", "—", "–", "－", "―――"})
SYNC_RE = re.compile(r"^\[\s*synchroni[sz]ation\s*\]$", re.IGNORECASE)
SIZE_RE = re.compile(
    r"^(?:【\s*size\s*】|\[\s*size\s*\]|size\s*(?:chart|guide|table)|尺码表|尺寸表)",
    re.IGNORECASE,
)
TAG_RE = re.compile(r"【([^】]{1,60})】")
DETAIL_RE = re.compile(r"details?|colored|coloured|colour|color", re.IGNORECASE)
# A one-album hand-made/hand-knitted variant with two or three photos is a
# fragment of a family, not a catalogue product.
SMALL_VARIANT_RE = re.compile(r"\bhand[\s-]?(?:made|knitted)\b", re.IGNORECASE)
SMALL_VARIANT_MAX_PHOTOS = 3
FAMILY_CUT_RE = re.compile(
    # The supplier writes "Size ：48-56" both after a bracket ("(wool)Size ：") and
    # glued to a word ("vestSize ："), so the marker may start right after a letter.
    r"\s*(?:"
    r"(?:(?<![A-Za-z])|(?<=[a-z]))Sizes?\s*[:：]?\s*(?=[\dA-Za-z])"
    r"|(?:(?<![A-Za-z])|(?<=[a-z]))[Cc]olou?rs?\s*[:：]"
    r"|(?:尺码|尺寸)\s*[:：]?"
    r")"
)
EMOJI_RE = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\uFE0F]+")
WORD_RE = re.compile(r"[^\W_]+", re.UNICODE)
GREY_RE = re.compile(r"\b(?:glay|grey)\b")

COLOUR_STOPWORDS = frozenset(
    {
        "details", "detail", "colored", "coloured", "colour", "color", "colors", "colours",
        "of", "the", "on", "in", "with", "and",
        "pants", "pant", "trousers", "trouser", "coat", "coats", "jacket", "jackets",
        "suit", "suits", "set", "sets", "short", "shorts", "shirt", "shirts",
        "tshirt", "tshirts", "tee", "tees", "polo", "polos", "vest", "vests",
        "hoodie", "hoodies", "sweater", "sweaters", "knit", "knitted",
        "dress", "dresses", "skirt", "skirts", "blouse", "blouses", "top", "tops",
        "bag", "bags", "shoe", "shoes",
    }
)


def _text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _normalized(value: Any) -> str:
    return unicodedata.normalize("NFKC", _text(value))


def _photos(product: dict[str, Any]) -> list[str]:
    value = product.get("photos") or []
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item or "").strip()]


def _position(product: dict[str, Any], fallback: int = 0) -> int:
    try:
        return int(product.get("source_position"))
    except (TypeError, ValueError):
        return fallback


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in values:
        if item and item not in seen:
            seen.add(item)
            result.append(item)
    return result


def _role(card: dict[str, Any]) -> str:
    content = card["content"]
    if content in EMPTY_DESCRIPTIONS:
        return "separator"
    if SYNC_RE.match(content):
        return "sync"
    if SIZE_RE.match(content):
        return "size"
    if content.startswith(DESCRIPTION_MARKER):
        return "caption"
    if TAG_RE.search(content):
        return "colour"
    return "detail"


def _tag_label(content: str) -> str:
    match = TAG_RE.search(content)
    if not match:
        return ""
    label = re.sub(r"\s*\bdetails?\b\s*$", "", match.group(1), flags=re.IGNORECASE)
    return _text(label).strip(" -–—")


def _detail_label(content: str) -> str:
    """Colour of a detail album caption; empty when it carries no colour word."""
    if not DETAIL_RE.search(content):
        return ""
    value = content.replace("[", " ").replace("]", " ")
    tokens = [token for token in WORD_RE.findall(value) if token.casefold() not in COLOUR_STOPWORDS]
    return _text(" ".join(tokens))


def _colour_key(label: str) -> str:
    value = unicodedata.normalize("NFKC", _text(label)).casefold()
    value = GREY_RE.sub("gray", value)
    value = re.sub(r"[^\w\u4e00-\u9fff]+", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


def _family_name(content: str, fallback: str) -> str:
    value = EMOJI_RE.sub(" ", content.replace(DESCRIPTION_MARKER, " "))
    value = FAMILY_CUT_RE.split(value)[0]
    value = re.sub(r"[【】\[\]]", " ", value)
    value = re.sub(r"\s+", " ", value).strip(" -–—·:：")
    return (value or fallback)[:250]


def _family_key(anchor: str, name: str) -> str:
    payload = f"{SUPPLIER_KEY}:{anchor}:{name.casefold()}"
    return hashlib.md5(payload.encode("utf-8")).hexdigest()


def _is_processed(products: list[dict[str, Any]]) -> bool:
    return bool(products) and all(
        isinstance(product.get("attributes"), dict)
        and product["attributes"].get("album_merge_version") == MERGE_VERSION
        for product in products
    )


def process_products(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered = sorted(
        (copy.deepcopy(product) for product in products if isinstance(product, dict)),
        key=lambda product: (_position(product), str(product.get("external_id") or "")),
    )
    if _is_processed(ordered):
        return ordered

    cards: list[dict[str, Any]] = []
    for index, product in enumerate(ordered):
        raw_content = _text(product.get("description"))
        card = {
            "product": product,
            "content": _normalized(raw_content),
            # The caption is copied verbatim: the raw fullwidth punctuation stays.
            "raw_content": raw_content,
            "photos": _photos(product),
            "position": _position(product, index),
            "role": "",
        }
        card["role"] = _role(card)
        cards.append(card)

    families: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    for card in cards:
        current.append(card)
        if card["role"] == "caption":
            families.append(current)
            current = []
    if current:
        families.append(current)

    result: list[dict[str, Any]] = []
    for family in families:
        caption_card = next((card for card in reversed(family) if card["role"] == "caption"), None)
        size_cards = [card for card in family if card["role"] == "size"]
        sync_cards = [card for card in family if card["role"] == "sync"]

        members: dict[str, dict[str, Any]] = {}
        for card in family:
            if card["role"] == "colour":
                label = _tag_label(card["content"])
            elif card["role"] == "detail":
                label = _detail_label(card["content"])
            else:
                continue
            key = _colour_key(label)
            if not key:
                continue
            member = members.get(key)
            if member is None:
                members[key] = {"label": label, "carrier": card, "cards": [card]}
            else:
                member["cards"].append(card)

        for key, member in list(members.items()):
            member_photos = [photo for card in member["cards"] for photo in card["photos"]]
            if SMALL_VARIANT_RE.search(member["label"]) and len(member_photos) <= SMALL_VARIANT_MAX_PHOTOS:
                del members[key]

        if not members:
            continue

        caption = caption_card["content"] if caption_card else ""
        caption_text = caption_card["raw_content"] if caption_card else ""
        caption_photos = _photos(caption_card["product"]) if caption_card else []
        first_member = members[next(iter(members))]
        anchor = str(
            (caption_card["product"].get("external_id") if caption_card else "")
            or first_member["carrier"]["product"].get("external_id")
            or ""
        )
        fallback_name = _family_name(first_member["carrier"]["content"], SUPPLIER_KEY)
        family_name = _family_name(caption, fallback_name) if caption else fallback_name
        family_key = _family_key(anchor, family_name)

        # A set (trousers + jacket) is posted as two albums per colour, so the
        # merged product has no photo of the whole set.  The caption album holds
        # exactly one such photo per colour, in the reverse order of the feed
        # (verified on the raw pictures: #426 photo 1 is the purple suit for
        # #424-#425, photo 2 is the khaki suit for #422-#423).
        cover_photo: dict[str, str] = {}
        if caption_card and len(caption_photos) == len(members) and any(len(m["cards"]) > 1 for m in members.values()):
            ordered = list(members.values())
            for index, photo in enumerate(caption_photos):
                cover_photo[id(ordered[len(ordered) - 1 - index])] = photo

        # A family with a single colour has no colour family to protect, so the
        # "[Synchronization]" model shots belong to that product.
        sync_photos = [photo for card in sync_cards for photo in card["photos"]] if len(members) == 1 else []

        size_photos: list[str] = []
        size_positions: list[int] = []
        size_identifiers: list[str] = []
        for card in size_cards:
            size_photos.extend(card["photos"])
            size_positions.append(card["position"])
            if card["product"].get("external_id"):
                size_identifiers.append(str(card["product"]["external_id"]))

        for order, member in enumerate(members.values()):
            product = copy.deepcopy(member["carrier"]["product"])
            photos: list[str] = []
            positions: list[int] = []
            attached = 0
            cover = cover_photo.get(id(member))
            if cover:
                photos.append(cover)
                positions.append(caption_card["position"])
                attached += 1
            for card in member["cards"]:
                photos.extend(card["photos"])
                positions.append(card["position"])
                if card is not member["carrier"]:
                    attached += 1
            if sync_photos:
                photos.extend(sync_photos)
                positions.extend(card["position"] for card in sync_cards)
                attached += len(sync_cards)
            photos.extend(size_photos)
            positions.extend(size_positions)
            attached += len(size_cards)

            if caption_text:
                product["description"] = caption_text

            attributes = dict(product.get("attributes") or {})
            attributes["album_merge_version"] = MERGE_VERSION
            attributes["album_family_key"] = family_key
            attributes["album_family_name"] = family_name
            attributes["album_colour"] = member["label"]
            attributes["album_colour_index"] = order + 1
            attributes["album_colours"] = len(members)
            attributes["album_attached"] = attached
            attributes["album_source_positions"] = sorted(set(positions))
            attributes["colors"] = [member["label"]]
            if caption_card and caption_card["product"].get("external_id"):
                attributes["description_source_id"] = str(caption_card["product"]["external_id"])
            if cover and caption_card and caption_card["product"].get("external_id"):
                attributes["album_cover_source_id"] = str(caption_card["product"]["external_id"])
            if sync_photos:
                attributes["album_sync_source_ids"] = [
                    str(card["product"]["external_id"]) for card in sync_cards if card["product"].get("external_id")
                ]
            if size_identifiers:
                attributes["size_chart_source_id"] = size_identifiers[-1]
            product["attributes"] = attributes
            product["photos"] = _unique(photos)

            if len(members) > 1:
                product["variant_group_key"] = family_key
                product["variant_group_name"] = family_name
            else:
                product["variant_group_key"] = None
                product["variant_group_name"] = None
            result.append(product)

    return result
