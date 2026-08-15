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

1. main gallery and its description;
2. a following short detail gallery only when it shares a model code or a
   specific Chinese product-name fragment; for new batches an exact matching
   Szwego tag has priority. Its description is appended after the main
   description;
3. a preceding packaging gallery;
4. a preceding video URL (the video card itself is not a catalogue product).

Packaging text is not copied into the product description. Collages, `合集`,
factory/quality posts, `ZP` comparisons and development announcements are not
merged or emitted. If the first detail image is the same as the first main
image, it is removed when the URL is identical. The script never downloads or
decodes source photos; URL-distinct visual duplicates are left for the
photo-enabled AI pass, which already evaluates the complete gallery.

When supplier setting `Парсинг тегов` is enabled, `SzwegoParser.py` keeps the
source labels both at the end of the description for AI context and in
`attributes.szwego_tags` for deterministic post-processing. Existing raw
snapshots without this attribute remain compatible through the text fallback.
