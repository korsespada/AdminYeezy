# Post-Processing Scripts Guide

This project uses Python post-processing scripts to transform JSON products before AI processing or publication through Rails API.

## Where Scripts Live

Put every supplier post-processing script in:

```text
scripts/parser/
```

Then set the supplier field `post_process_script` to the file name only:

```text
process_new_supplier.py
```

Do not store scripts only on the VPS or inside a running container. They must be committed to the repo, pushed, and deployed to Coolify so they survive redeploys.

## Required JSON Contract

New scripts must expose a function:

```python
def process_products(products):
    return products
```

`products` is an ordered list of dictionaries. The runner reads the list from UTF-8 JSON on stdin and returns UTF-8 JSON on stdout. Do not connect the script directly to Postgres and do not create intermediate files.

Preserve these canonical fields whenever possible:

```text
external_id
name
description
price
status
brand
category
subcategory
gender
photos
attributes
source_position
ai_processed
```

Minimum useful output fields:

```text
external_id, name, description, price, brand, category, subcategory, gender, photos
```

Rules:

- `external_id` must remain stable. Do not invent a new one unless the source row truly lacks it.
- `photos` must remain a Python list of URL strings.
- `brand`, `category`, and `subcategory` should use the current staging dictionary IDs when known. The Rails publication adapter is responsible for mapping them to Rails catalog records.
- `price` should be a number without currency symbols.
- `status` should be `active` or `inactive` if emitted.
- Put supplier-specific additional values inside `attributes`.
- Preserve `source_position`; do not recalculate it after filtering or merging.

## Safe Script Template

```python
def process_products(products):
    result = []
    for product in products:
        if should_delete(product):
            continue
        updated = dict(product)
        updated["description"] = normalize_description(product.get("description", ""))
        result.append(updated)
    return result
```

## What Not To Do

- Do not hardcode local Windows paths like `C:\\projects\\...`.
- Do not rely on packages missing from `requirements.txt`.
- Do not mutate the input list or dictionaries in place; return copied products.
- Do not call the legacy `shop` DB or Rails CRM Postgres from a post-process script. The script only transforms the supplied JSON products.
- Do not upload photos to S3 here. Media handling happens during the publication pipeline.
- Do not remove `external_id` unless the row is intentionally being deleted.

## Dependencies

Prefer Python standard library.

If a new dependency is truly needed:

1. Add it to `requirements.txt`.
2. Test locally.
3. Commit and push.
4. Redeploy Coolify so the Docker image installs it.

## Testing Locally

Use a small JSON fixture and the shared runner:

```bash
python scripts/parser/json_postprocess_runner.py < tmp/sample_payload.json
```

Then inspect:

- output is a valid JSON array;
- product count is expected;
- `photos` is an array;
- `external_id` and `source_position` are preserved.

## Deployment Flow

1. Create or edit `scripts/parser/my_script.py`.
2. Run local sample test.
3. Commit and push.
4. Redeploy Coolify.
5. In supplier settings, set `post_process_script` to `my_script.py`.
6. Open a batch and click `Пост-обработка скриптом`, либо включите для поставщика флажок `Автоматически`, чтобы запускать этот же шаг сразу после сырого парсинга.

The admin uses the script through the DB-backed flow: `scraping.products -> JSON stdin -> script -> JSON stdout -> scraping.products`.

Publication is a separate step:

```text
yeezy_scraping.products -> AdminYeezy publication adapter -> Rails API -> Rails CRM Postgres -> storefront
```

The legacy `shop` database is not the source of truth for the new storefront.

## Chanel Bags

`Chanel Сумки` uses `process_chanel_bags_timeline.py` against the `全部 / единая
лента` source. It keeps only a substantive main product card and safely joins
its nearby service cards in this output order:

1. main gallery and its description. When a technical close-up album appears
   first but the matching following album has the substantive product copy, the
   latter becomes the main gallery and is placed first. A preceding tag-only
   one/two-photo cover is discarded altogether when the following tagged album
   is substantive, so a different-background shot cannot become a duplicate
   product or enter the gallery. The same ordering is mandatory for a 7-10
   photo technical album with an article/size followed by a 3-6 photo studio
   gallery of the proven same product;
2. only the first following short detail gallery, when both cards have the
   same parsed Szwego tag, or (for an old snapshot without tags) the same
   concrete model code. Generic Chinese phrases never prove that two cards are
   one product. Later short cards with the same generic label are
   lookbook/model shots on a different background and are excluded. The
   accepted detail description is appended after the main description. A
   7+ photo album is never joined merely because of a shared tag: such tags
   may name a family rather than one exact colour or item;
3. a preceding packaging gallery;
4. a preceding video URL (the video card itself is not a catalogue product).

Packaging text is not copied into the product description. Collages, `合集`,
factory/quality posts, `ZP` comparisons, first/final-version notes and material
development announcements are not merged or emitted. If the first detail image is the same as the first main
image, it is removed when the URL is identical. The script never downloads or
decodes source photos; URL-distinct visual duplicates are left for the
photo-enabled AI pass, which already evaluates the complete gallery.

After all merges and packaging attachments, only galleries with 10–14 photos
remain. A gallery without video must also contain at least 12 meaningful
description characters after tags, article codes and dimensions are removed;
this excludes bare factory captions such as `原版实拍`. Watches, jewellery,
hair accessories, bag charms and scarf clips are also excluded, even if they
meet the photo threshold.

When supplier setting `Парсинг тегов` is enabled, `SzwegoParser.py` keeps the
source labels both at the end of the description for AI context and in
`attributes.szwego_tags` for deterministic post-processing. Existing raw
snapshots without this attribute merge only cards with the same concrete
article; recurring Chinese marketing text never proves one product.

## LV Сумки, кошельки

`process_lv_bags_timeline.py` handles the supplier's reverse service-card
pattern. The source block is typically `комплектация → видео → основной
альбом`, optionally followed by a short detail album. The result is one
product card with photos in the order `основные → детали → комплектация`; the
video URL remains in `attributes.szwego_video_url` and the video card is not
emitted as a separate product.

The detail album is joined only when the long album has at least seven photos
and the following main album has up to six photos. When `Парсинг тегов` is
enabled, every album in one LV product block must have the **same complete
`szwego_tags` set**; this exact tag group is used before any text fallback.
Without tags, a concrete model code or meaningful Chinese/Latin product name
is required.
In this four-album pattern the short album is the main product, while the
preceding long album is the detail set; its first repeated cover photo is
removed before joining. Short albums that were not joined to a main album are
discarded at the end; they do not become separate products.
Service cards are assigned to the nearest matching product block, so packaging
photos are appended after all product/detail photos. The original
`external_id` and `source_position` of the main card are preserved.

## Dior Сумки

`process_dior_bags_timeline.py` processes the `全部 / единая лента` source for
the Dior Bags supplier. It does not use `szwego_tags`: video posts do not have
them. A catalogue product is a photo album whose source description starts
with `【…】`; decorative Unicode letters in that label are normalised before
comparison.

A video immediately before one such product is attached only when the main
album begins within three source positions. This keeps a video from a
neighbouring product block off a later bag. When two or more nearby bracketed
albums share a meaningful leading model label and differ after it by colour,
they form one colour family. The same video is copied to every variant in that
family. An unlabelled photo album is emitted only when it lies between proven
variants in that family; an overview collage before the first variant is not a
product. The script never merges their galleries: every colour keeps its own
`external_id`, photos and `source_position`.

## Женская одежда 5

`process_womens_clothing_5.py` handles the supplier's reverse album pattern.
The raw stream usually starts a product with a one-photo price/size card,
continues with service, styling, or lookbook albums, and ends with a
substantive 6+ photo product card whose description contains the season code.

The output starts with the substantive branded product album, then adds up to
two nearby detail albums whose descriptions contain real detail text. Their
descriptions are appended to the main product description. Short service
labels such as `GW`, `Show`, `大图`, `大图 细节`, `搭配/look`, `系列` and
`全套礼盒` are excluded together with their photos. The matching one-photo
size-card image is added last. The size card is assigned by brand and
Chinese/Latin product-name overlap, so multiple queued tables can be matched
to later products without relying on timestamp alone.

When two final product cards reuse the same first photo, that shared photo is
removed from both galleries. This prevents a combined outfit image from
becoming the hero image for two separate products. The final card's
`description`, `external_id`, and `source_position` remain authoritative.

Brand detection uses the alias order and boundary matching from the previous
`filter_task_152.py` script, with `BV`/`BVLG` mapped to Bottega Veneta.
Eyewear is excluded by its product terms, and clothing cards without a
recognised brand are dropped at the final assembly step. The main product
description, `external_id`, and `source_position` remain authoritative.

## Женская одежда 2

The DB-backed post-process for `Женская одежда ZP 2` reads the supplier's
all-timeline blocks separated by `✨✨✨ ✨✨分割线✨✨✨ ✨✨`. A catalogue
product is every album with at least five photos whose description contains
`随意实拍`. These albums are emitted independently: the same Szwego tag does
not merge them, because separate albums can be separate colours. Model,
packaging, `挂拍对比图` and other service albums are not emitted.

The final album in the same block containing a price, `顶版`/`出货` and `码数`
is the authoritative description source. Its text and catalog fields are
copied to each retained gallery, while the gallery's `external_id`,
`source_position` and photo order remain authoritative. The preceding
one-to-three-photo `尺码表`/`尺寸表`/`尺码` album is attached only when its
`szwego_tags` intersects the gallery's tags and the albums are in the same
separator block. Its photo is appended last and the source id is recorded as
`attributes.size_chart_source_id`.

The processor keeps exact source identities, does not merge on adjacency or
generic text, and is idempotent. If a legacy block has no tags, an attachment
is allowed only when that block contains exactly one matching service card;
otherwise the ambiguous data is left unattached.

## Женская одежда 3

`process_womens_clothing_3.py` reads the supplier's TIMO-separated blocks.
The final substantial album in a block contains the full description, price,
sizes, and brand; the product keeps the `external_id` and `source_position` of
the immediately preceding gallery album, as required by the source pattern.
The final album's description and the current Rails canonical brand id are
copied to that gallery album. The one-photo `下单尺寸表` album from the same
block is appended last and recorded as `attributes.size_chart_source_id`.

Other preview, lookbook, packaging, and service albums are not emitted. Brand
matching supports the observed Latin/Chinese spellings for Chrome Hearts,
Acne Studios, Gucci, Dior, Prada, Chanel, Loewe, Celine, Saint Laurent, Miu
Miu, Louis Vuitton, Valentino, Fendi, Hermes, Burberry, and New Balance. Ami
and Arcteryx are also recognized by their Latin spellings. A
Chrome Hearts block is always excluded after brand detection. A
block without a recognisable final brand card or without a usable preceding
gallery is skipped. The processor is idempotent and preserves source identity.

## Женская одежда ZP

The DB-backed post-process for `Женская одежда ZP` keeps only substantial
product albums with at least eight photos whose description starts with a
`P<number>` price marker. Albums without that marker, including short marketing
descriptions, are not product cards. Standalone accessories such as hats,
scarves, gloves, jewellery, bags, shoes, and glasses are also excluded even
when their description starts with a price marker. One-photo `尺码表`/size-chart
albums are attached to the matching product and appended last; lookbook, model,
packaging, shipping, and generic service albums are not emitted.

ZP sometimes places a product's size chart before a `细节图` or
`反面细节图` album and before the descriptive product album. The processor
matches charts inside the bounded product block by the source media folder and
the timestamp embedded in the photo URL; products with a detail album claim
the chart before adjacent products without one. It then emits photos in the
order `main -> detail -> size chart`. For example, the visible cards `#139`,
`#138`, and `#136` are retained as one product in that order; the same pattern
applies to `#162`, `#161`, and `#157`. The descriptive album remains
authoritative for `external_id`, `source_position`, and description. Exact
duplicate photo URLs are removed and the processor is idempotent.

Cards whose description contains `Chrome Heart*`, `Chrome Hearts`, the common
misspelling `Chrome hearth`, or `克罗心` are excluded completely.

The ZP supplier AI instruction treats the leading `P<number>` as a source
price marker rather than a public price. Product photos are analysed through
the standard 3-by-3 contact sheets, with optional full-size refinement for
ambiguous frames. Size charts remain technical evidence for sizes and
measurements, and reversible garments remain one product when both sides show
the same item. ZP uses the nine price-rule records and the price instruction
list copied from `Женская одежда 3`; the price mapping is kept outside the
supplier text prompt.

## Обувь

The DB-backed post-process for `Обувь` reads the Szwego all-timeline stream in
bounded blocks separated by an empty untagged album. It keeps only albums with
at least nine photos, a substantial description of at least 200 characters,
and a source price marker (`💰`, `￥`, or `¥`). This excludes covers, videos,
size cards, lookbook/model cards, separators, and other short service albums.

Each retained gallery keeps its original `external_id`, `source_position`,
description, and photo order. A video is copied only from an earlier card in
the same separator block with the exact same complete `szwego_tags` value;
the processor never carries a video across a separator or from a neighbouring
model. When at least two retained galleries share that evidence, they receive
one stable `variant_group_key` while their galleries remain separate colour
variants. The processor is idempotent and leaves an ambiguous or video-less
gallery retained without inventing a video.
