# Post-Processing Scripts Guide

This project uses Python post-processing sources to transform JSON products before AI processing or publication through Rails API. For new supplier rules, the normal runtime source is stored in `supplier_post_process_scripts` and assigned through the DB-backed supplier workflow; a committed file under `scripts/parser/` is only a legacy fallback or an explicitly requested Git artifact.

## Where Legacy Scripts Live

Put every supplier post-processing script in:

```text
scripts/parser/
```

Then set the supplier field `post_process_script` to the file name only:

```text
process_new_supplier.py
```

For a DB-backed version, do not create a repository file or deploy it to Coolify: save, Preview, and activate the source through the supplier post-process action/API or the dedicated scraping database. Legacy files must still be committed and deployed so they survive redeploys.

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

## Шарфы (supplier 58)

The active DB-backed version `Шарфы: длинные шарфы и головные уборы без квадратных шалей v4`
keeps the original `external_id`, `source_position`, photo order, and all
non-filtered fields. It detects the canonical Rails brand from the normalized
description and writes the current canonical brand id to `brand` and the
canonical brand name to `name`.

The source export is an independent album feed: every substantive album is
treated as one product, even when several albums share a brand or family tag.
Albums are not merged and `source_position` remains the position in the raw
snapshot. The product type is determined from the description header, before
the first `Size`/`尺码`/`均码`/`头围`/`规格` marker. This prevents a later sentence
such as “can be worn as a shawl” from turning an ordinary scarf into a shawl.

The allowed product families are:

- scarves and long scarves: `围巾`, `长巾`, `丝巾`, cashmere or long/silk
  scarves;
- hats and bucket/panama hats: `帽子`, `渔夫帽`, `棒球帽`, `毛线帽`, `冷帽`,
  `贝雷帽`, `panama`, `bucket hat`, `beanie`, or `hat`.

The processor excludes a primary `披肩`, `披巾`, `披风`, `披毯`, `斗篷`,
`shawl`, `poncho`, `cape`, `stole`, or `wrap` product. If the description has
no clear type, an excluded tag or a 140 cm square tag is treated as shawl
evidence. Any square measurement where both sides are equal, including
`90x90`, `70x70`, `120x120`, or `140x140 cm`, is removed before type labels are
considered. This means even a card labelled `丝巾` or `方巾` is excluded when
its dimensions are square. Long rectangular scarves and hats are still kept.

The processor removes an album when:

- it has zero or one photo;
- its normalized description is shorter than 100 characters;
- the description contains `披肩现货`;
- it is a small ribbon/twilly/hair-ribbon product, identified by ribbon terms
  together with a narrow size such as `120x5cm` or `86x5cm`;
- it is a video/photo-service card, identified by markers such as `店拍视频`,
  `店拍图视频`, `live video`, or `vlog`;
- it is home textile rather than a wearable scarf, with terms such as
  `毛毯`, `抱枕`, `沙发毯`, `汽车毯`, `家居用品`, `家居旅行`, `blanket`, or
  `pillow`.

Square-size albums are not retained even when their description calls them a
scarf or says they can be worn as a shawl. Long rectangular scarves remain
separate, and the rule does not merge similar albums or rewrite the immutable
raw snapshot. Previewing batch `f54d32e6-1134-4243-b215-48344231368b` gave
4,906 raw cards and 109 retained products, including four substantive
bucket-hat cards.

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

## Alaia, Ferragamo, Jacquemus, Maison Margiela, Acne Studios — сумки (supplier 50)

Для поставщика `Alaia, Balenciaga, Ferragamo, Jacq, MM Сумки` активна
DB-backed версия `Alaia Ferragamo Jacquemus MM Acne — альбомы, видео,
цветовые семьи и дедупликация v3`. Из единой Szwego-ленты сохраняются только альбомы от
девяти фотографий с распознанным артикулом и габаритами в описании. Бренд
определяется по тексту и полным `szwego_tags`; остаются только Alaia,
Ferragamo, Jacquemus, Maison Margiela и Acne Studios, после чего в `brand`
записывается текущий канонический Rails ID. Lookbook/ZP, детали, упаковка,
видео и прочие короткие сервисные альбомы не выпускаются.

Видео присоединяется к ближайшему следующему товарному альбому не далее трёх
исходных позиций только при совпадении бренда, артикула и полного набора
`attributes.szwego_tags`; видео-карточка удаляется из результата. Цветовая
семья строится глобально по бренду, артикулу и размеру (small/medium/large
либо нормализованные габариты), галереи не склеиваются. Семья получает
стабильный 32-символьный hex `variant_group_key`, а одиночные группы остаются
без ключа. Правило идемпотентно и сохраняет `external_id`,
`source_position` и порядок фотографий.

Перевыкладки удаляются только после положительного совпадения: одинаковый
бренд, полный артикул, размер и совпадающая минимум на 80% нормализованная
галерея. Один артикул без совпадения цвета/галереи дублем не считается, поэтому
цветовые карточки одной семьи не схлопываются. Оставляется более поздняя
карточка, а из более ранней переносятся отсутствующие атрибуты, видео,
описание и дополнительные фотографии. При сохранении обычный upsert по
`(batch_id, external_id)` обновляет уже существующую карточку и добавляет новую;
удаляются только карточки, исключённые активным результатом постобработки.

Для выгрузки `c6fc852b-4679-47ef-a240-75d555a32ff9` обработка дала
`28323 → 309` карточек: 53 Acne Studios, 46 Maison Margiela, 141 Jacquemus,
51 Alaia и 18 Ferragamo; видео присоединено к 128 альбомам, сформировано 60
семейств на 290 карточках. Дедупликация убрала 21 подтверждённую перевыкладку
по галереям, включая две пары с одной заменённой фотографией. Для примера из
скриншота видео из UI-альбома `#153` сначала было привязано к `#155`, а после
удаления дубля перенесено на выжившую перевыкладку `source_position=22026`.
Остальные пары `#160 ← #159`, `#164 ← #161`, `#170 ← #168` сохранились.
Исходный `SCRAPED` снимок сохранён, итог записан в `SCRIPT_PROCESSED`.

## Celine Сумки

Для поставщика `Celine Сумки` активна DB-backed версия `Celine сумки — альбомы,
видео и цветовые семьи v1`. Товарным альбомом считается фотоальбом минимум с
пятью фотографиями, в описании которого найден артикул после `编号`/`货号`/
`款号` или размер в сантиметрах. Короткие сервисные, рекламные и lookbook-
карточки без этих признаков не выпускаются. Каждый товар сохраняет свой
`external_id`, `source_position`, описание и порядок исходных фотографий.

Непосредственно предыдущий альбом присоединяется как детали только при
маркере `细节`/`特写`/`尺码表` и совпадении полного `attributes.szwego_tags`;
фото добавляются после основной галереи. Непосредственно следующий
однокадровый альбом с `szwego_video_url` присоединяется как видео и удаляется
из результата. Для двух видео-карточек без тега применяется только узкий
fallback: пустое описание и непосредственное следование за товаром.

Цветовая семья строится по точному нормализованному артикулу и требует двух
или более товарных альбомов; галереи не объединяются. Если артикул отсутствует,
используется только подтверждённая непрерывная серия товарных альбомов с одним
полным тегом, одинаковыми размерами и похожим описанием. Ключ семьи — стабильный
32-символьный hex в `variant_group_key`, одиночные и неоднозначные карточки
остаются без ключа. Правило идемпотентно.

На выгрузке `96d23c57-af36-4c5d-a61b-e5214b71b3dd` обработка дала `2326 → 172`
карточки: присоединено 168 деталей и 168 видео, сформировано 41 семейство на
104 карточках. Для примера из ленты позиции `#9` и `#20` получили фото деталей
и видео, а позиции `#37` и `#48` с артикулом `187363B` получили общий ключ.
Исходный `SCRAPED` снимок сохранён без изменений; текущий этап —
`SCRIPT_PROCESSED`.

## Loewe Сумки (supplier 42)

Для поставщика `Loewe Сумки` активна DB-backed версия `Loewe сумки —
качественные альбомы, видео и цветовые семьи v1`. Из полной ленты сохраняются
только фотоальбомы минимум с четырьмя фотографиями и содержательным описанием
не короче 50 символов, где найден точный артикул или габариты. Короткие
lookbook/service-карточки, рекламные карточки с `特惠`/`全新商品`/`售罄` и
явные карточки Goyard удаляются; соседство само по себе не считается доказательством
товара.

Видео берётся из непосредственно предыдущей карточки только при совпадении её
короткого названия с товарным альбомом после нормализации размера, материала и
вариантов написания цвета. Так видео не переезжает на соседний цвет при сбое
ленты. Видео-карточка не выпускается отдельным товаром. В товаре сохраняются
`attributes.szwego_video_url`, `attributes.model_code` и нормализованные
`attributes.dimensions`.

Цветовая семья создаётся только для двух и более сохранённых альбомов с одним
точным артикулом и одинаковыми габаритами. Галереи не склеиваются: каждый
альбом сохраняет собственные `external_id`, `source_position`, описание и
фотографии; общий стабильный ключ записывается в `variant_group_key`.

На выгрузке `38c04e58-6f36-45de-b6e0-3ed5d4eeaf50` результат составил
`3396 → 658` карточек: к 551 товару присоединено видео, сформировано 108
семейств на 625 карточках. В примере `source_position=10` и `17` (карточки
`#11` и `#18` в UI) получили видео из предыдущих `source_position=9` и `16`
(`#10` и `#17`) и общий ключ для артикула `898033L1080` и размеров
`26×13×10`. Исходный снимок `SCRAPED` сохранён, этап — `SCRIPT_PROCESSED`;
правило идемпотентно.

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

## Одежда МЖ 2

The active DB-backed version `Одежда МЖ 2 — галерея, описание и размерная
таблица v1` keeps only substantive product galleries marked `【实拍图一组】`
with at least eight photos. The target gallery remains the authoritative
product identity, photo order, and base description. Lookbook, model,
packaging, receipt, stock, and other service albums are not emitted as
separate products and their photos are not copied into the gallery.

The processor matches a one-photo `尺码表`/`尺寸表` album to the target by the
same complete `attributes.szwego_tags` value. The chart photo is appended last
and its source is recorded as `attributes.size_chart_source_id`. Technical
descriptions from the same tag group between the chart and target, including
`Compare`/`对比`, fabric, construction, embroidery, trim, button, ribbing, and
wash details, are appended to the target description. Their source ids are
recorded as `attributes.post_process_description_source_ids`; marketing and
lookbook text is not copied.

No gallery is merged with another product: `external_id` and
`source_position` stay those of the target album. Exact duplicate photo URLs
are removed and the processor is idempotent. A target with a missing tag is
left without an inferred attachment unless the same tag is positively present
on both sides of its bounded source run. The immutable `SCRAPED` snapshot is
kept as the recovery boundary.

The first verified batch `54133cc0-9629-40ac-83f9-5b19589b9f1b` produced 119
cards from 3427 raw albums. Display albums #14 and #60 each retained nine
product photos, received one size-chart photo, and received respectively
three and four technical description sources.

## Одежда МЖ

Для поставщика `Одежда МЖ` активна DB-backed версия `Одежда МЖ — альбомы с
артикулом, детали и цветовые семьи v1`. Товарной карточкой считается альбом с
артикулом `款号...`; альбомы Chrome Hearts (`Chrome Hearts`, `克罗心` или
отдельный префикс `CH`) полностью исключаются.

Карточка с артикулом сохраняет свой `external_id`, `source_position`, описание
и собственные фотографии. Непосредственно предыдущий альбом присоединяется
только при совпадении полного `attributes.szwego_tags`, отсутствии артикула,
наличии минимум трёх фотографий и отсутствии явного маркера разработки;
фотографии добавляются после фотографий товарной карточки. Описание из альбома
перед присоединённым альбомом добавляется только при том же теге и отсутствии
артикула у источника. Идентификаторы присоединённых источников сохраняются в
`attributes.post_process_attached_source_ids` и
`attributes.post_process_description_source_ids`.

Цветовая семья определяется по паре `артикул + нормализованная модельная
сигнатура`, а не по одному артикулу: один и тот же `款号` встречается у разных
моделей. В семью попадают минимум две разные цветовые метки; одинаковые
цветовые дубли и одиночные модели остаются без `variant_group_key`. Галереи не
склеиваются между карточками, ключ стабилен, а повторный запуск идемпотентен.

Для партии `10d64628-cd78-43dd-adc1-158b5a362a35` обработка дала `1459 → 213`
карточек: удалены 10 Chrome Hearts, фото присоединены к 210 карточкам,
содержательное описание — к 120, найдено 10 цветовых семей на 25 карточках.
Исходный снимок `SCRAPED` сохранён; итог записан в `SCRIPT_PROCESSED`.

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
Miu, Louis Vuitton, Valentino, Fendi, Hermes, Burberry, and New Balance. Ami,
Arcteryx, On, Rick Owens, Emporio Armani, Norda, Maison Mihara Yasuhiro, xVESSEL,
Kailas, Gimaguas, Cotemp, VIBAe, AnOther Project, Ann Demeulemeester, HIDEMI,
ICE DUST, Christen, ODTD, SHUSHU/TONG, 3.1 Phillip Lim, IIIVIVINIKO, Elia
Maurizi, Benci Brothers, Ann Andelman, DYMONLATRY, ABRA, Casadei, Aeyde, Lost
in Echo, untitlab, Pierre Hardy, Alohas, and ORINOU are also recognized by their
Latin spellings. A
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

## Обувь 2

`Обувь 2` публикует ленту без отдельных альбомов деталей: каждый альбом с
девятью и более фотографиями остаётся самостоятельной товарной карточкой.
Фотографии, описание, `external_id` и `source_position` не объединяются и не
переносятся между альбомами. Однокадровые карточки с видео являются служебными
и удаляются из результата; видео и poster не записываются в товарные карточки.

Цветовая семья определяется непрерывной серией товарных альбомов с одинаковым
нормализованным полным набором тегов **и одинаковой текстовой сигнатурой
модели**. Один тег сам по себе недостаточен: например, `Nike 002` и `Nike 001`
разделяются, как и `Balenciaga Venom` и `Balenciaga Hummer`. Китайские варианты
цвета вроде `米色` и `米白色` нормализуются и не разрывают одну модель. Повтор той
же модели после другой модели начинает новую семью; серия из одной карточки не
получает ключ цветовой семьи. Внутри семьи карточки получают общий
стабильный `variant_group_key`, но остаются отдельными цветами. Правило
идемпотентно и не требует маркера цены или минимальной длины китайского
описания: в этой ленте такие маркеры отсутствуют даже у обычных товарных
альбомов.

## Обувь жен муж new

DB-backed post-process для `Обувь жен муж new` читает Szwego all-timeline с
включёнными тегами. Товарным альбомом считается альбом с минимум девятью
фотографиями и исходным ценовым маркером `P <число>`, `💰`, `￥` или `¥`, кроме
альбома `细节组图`. Альбомы GGDB/Golden Goose (`GGDB`, `大黄蜂`) и Hermes
(`Hermes`, `爱马仕`) отбрасываются полностью до сборки результата.

У товарного блока основной альбом сохраняет свои `external_id`,
`source_position`, описание и порядок фотографий. Непосредственно предыдущий
альбом `细节组图` присоединяется только при совпадении полного набора
`szwego_tags`; его фотографии добавляются после основных с удалением только
точных URL-дубликатов. Однокадровые видеоальбомы не публикуются, а их URL
записывается в `attributes.szwego_video_url`.

Если в одном блоке несколько подходящих видео, выбирается самое раннее видео
в source-порядке, то есть более дальнее от пары `детали → основной альбом`.
Поэтому для наблюдаемых примеров сохраняются пары `#7/#6/#5`, `#16/#15/#14`
и `#24/#23/#21`, а ближайшее видео `#22` в третьем блоке не используется.
Один альбом без распознанного тега допускает узкий fallback только при
одновременном наличии соседней tagged-detail, совпадении бренда и смыслового
синонима типа обуви (`半拖`, `凉拖`, `人字拖`, `穆勒拖`). Простая близость
альбомов сама по себе не является основанием для присоединения.

Подряд идущие сохранённые альбомы одной модели с одинаковым полным набором
тегов получают общий стабильный `variant_group_key`, если их текстовая
сигнатура совпадает после удаления цвета, размера и цены. Галереи при этом не
склеиваются в одну карточку: каждый цвет сохраняет отдельные identity,
описание и фотографии.

## Обувь МЖ

Для `Обувь МЖ` сохраняются только альбомы, у которых нормализованное описание
начинается с точной последовательности `牛货🔥`. Это отсеивает рекламные,
служебные и неполные карточки; остальные поля не используются как замена
этому положительному признаку. Каждый сохранённый альбом остаётся отдельным
товаром со своими `external_id`, `source_position`, описанием и фотографиями.

Канонический Rails `brand` определяется из текста описания по наблюдаемым
английским и китайским написаниям бренда (`Chanel`, `Loro Piana`,
`Louis Vuitton`, `Miu Miu`, `Celine`, `Zegna`, `Prada`, `Alaia`, `Dior`,
`Loewe`). AI обязан сохранять непустой установленный `brand`.

Карточки Hermes удаляются полностью по описанию или тегу (`Hermes`, `爱马仕`);
до AI-обработки они не доходят.

Цветовая семья строится только для непрерывной последовательности сохранённых
альбомов с одинаковым брендом, нормализованным ценовым/конструктивным маркером в начале
описания (`高帮60.0`, `低帮58.0`, `48.0（6.5中跟）` и т. п.) и одинаковой
текстовой сигнатурой модели. Повторный префикс `牛货🔥56.0 size：牛货🔥56.0`
и пробелы вокруг скобок нормализуются и не разрывают одну семью. Один тег бренда сам по себе недостаточен:
например, Loro Piana `高帮60.0` и `低帮58.0`, а также разные модели Chanel с
одинаковой ценой получают разные семьи. Внутри семьи альбомы не объединяются:
им присваивается общий стабильный `variant_group_key`; одиночные или
неоднозначные карточки остаются без ключа. Правило идемпотентно.

## LV, DG, Dior, Loro — сумки экзотика (supplier 51)

Активная DB-backed версия `LV, DG, Dior, Loro — альбомы и видео v1` оставляет
каждый содержательный фотоальбом самостоятельным товаром. Альбомы между собой
не склеиваются: сохраняются исходные `external_id`, `source_position`, описание
и порядок фотографий. Обычная однокадровая карточка без видео не становится
товаром; явные сервисные/коллажные альбомы с маркерами вроде `合集`, `图集` и
`九宫格` также не публикуются.

Видео присоединяется только если в исходной карточке есть непустой
`attributes.szwego_video_url`. Такая короткая карточка удаляется из результата,
а URL записывается в фотоальбом товара; poster сохраняется только как атрибут и
не добавляется фотографией в галерею. В пределах трёх позиций сначала ищется
положительное совпадение полного `szwego_tags` и папки/даты медиа в URL. Если
теги отличаются, допускается только сильное пересечение идентификаторов; при
неоднозначности видео остаётся неприсоединённым. Пример из выгрузки сохраняется
как `#166 → #165`.

Preview на исходных снимках дал следующие результаты:

| Выгрузка | Сырьё | Товарные альбомы | Видео-карточки удалены | Видео присоединено |
| --- | ---: | ---: | ---: | ---: |
| Louis Vuitton | 320 | 191 | 129 | 105 |
| Dolce & Gabbana | 331 | 233 | 98 | 92 |
| Dior | 136 | 71 | 65 | 50 |
| Loro Piana | 315 | 256 | 59 | 50 |

Проверены сохранение identity и порядка, отсутствие удаления длинных товарных
альбомов и повторный прогон без изменений. Четыре исходных выгрузки оставлены
в стадии `SCRAPED`; правило активировано для поставщика, но к существующим
выгрузкам постобработка не применялась.

## BV Сумки (supplier 35)

Для поставщика `BV Сумки` активна DB-backed версия `BV Сумки — альбомы 8+
фото, цветовые семьи и дубли v1`. Из полной сырой ленты сохраняются только
альбомы минимум с восемью фотографиями и содержательным описанием от 50
символов. Сервисные, lookbook, сравнения размеров, цветовые карточки без
описания и другие короткие альбомы не выпускаются; скидочные описания не
исключаются только из-за слова о скидке. Оригинальные `external_id`,
`source_position`, порядок фотографий и остальные атрибуты сохраняются.

Перед фильтром workflow проверяет все сырые `external_id` в Rails. Уже
существующие товары принудительно остаются для обновления, даже если будущая
версия фильтра сочтёт их недостаточно полными. После фильтрации используется
только положительное доказательство перевыкладки. Сначала сравнивается
нормализованная полная галерея (query/hash в URL не учитываются), затем —
содержимое фото по CDN `ETag`, сохранённому в
`supplier_photo_fingerprints`. Дубликатом по содержимому считается только
совпадение минимум трёх фото и не менее 30% меньшей галереи внутри одной
модельно-размерной семьи. Одно общее фото, одинаковое описание, модель или тег
без этого условия дублем не считаются, поэтому разные цвета не схлопываются.
В подтверждённой группе сохраняется существующий Rails-ID; если его нет,
остаётся карточка с более поздней исходной позицией. Если несколько членов
группы уже существуют в Rails, они не удаляются автоматически и попадают в
отчёт для отдельного решения.

Цветовая семья строится по модели и нормализованному размеру, например
`6608 + 25x22x10.5` отдельно от `6608 + 32x24x12`. Варианты записи `×`, `*`,
`x` и разделители с `cm` приводятся к одной сигнатуре. Семья получает
стабильный 32-символьный hex `variant_group_key`; одиночные и неоднозначные
карточки остаются без ключа. Правило идемпотентно и не изменяет immutable
`SCRAPED` snapshot.

Для выгрузки `9a144575-f5c6-4f62-a858-daabc1265f4a` базовый прогон дал
`12823 → 2579 → 2099` карточек: из 3005 альбомов с 8+ фото сохранено 2579,
удалено 480 точных перевыкладок, сохранены все 1229 уже существующих Rails-ID,
сформировано 219 семейств на 1916 карточках. В дополнительном аудите CDN по
17 021 фото найдено 29 пар с совпадением содержимого; 16 сильных пар дали 13
новых карточек для безопасного удаления. Три сильные пары состоят из уже
существующих Rails-ID и не удаляются автоматически. В результате не осталось
точных дубликатов галерей, а содержательные перевыкладки с другими URL теперь
схлопываются при постобработке. В начале ленты позиции
`#7/#13/#16/#19/#27` получили семью `6608 + 25x22x10.5`, а
`#14/#17/#20/#28` — отдельную семью `6608 + 32x24x12`. Итог записывается в
`SCRIPT_PROCESSED`; публикация в Rails не запускается.

## Сумки Gucci (supplier 65)

Для поставщика `Сумки Gucci` активна DB-backed версия `Gucci — альбомы, видео
и цветовые семьи v4`. Она обрабатывает единую Szwego-ленту, где товарный блок
может содержать карточки упаковки, видео, фото на белом фоне и полноценный
альбом. В результат попадает только фотоальбом от семи фотографий с
подтверждённым артикулом; карточки других брендов, `官网同步`, упаковки,
lookbook/модельные, коллажные альбомы и альбомы с маркером `新品集合` не
публикуются. Для положительной бренд-проверки используются `Gucci`, `古驰` или
отдельное `GG` в описании/тегах. `新品集合`
проверяется и в описании, и в тегах — это маркер белого фона/каталожной
подборки из примера поставщика.

Видео присоединяется только к последующему товарному альбому в том же
ограниченном блоке, если совпадают полные `szwego_tags` и артикул либо есть
однозначная близкая OCR-опечатка. Используется карточка `实拍`/`大货实拍`, а
`包装实拍` всегда исключается. Видео и poster остаются в `attributes`, poster
не добавляется в `photos`.

Альбомы разных цветов не склеиваются: каждый сохраняет собственные
`external_id`, `source_position`, описание и фотографии. Общий
`variant_group_key` получает вся выгрузка с одним артикулом независимо от
порядка карточек и служебного текста тега; для серии
кошельков дополнительно учитываются тип, габариты и конструктивные признаки
(количество отделений/карманов), что позволяет объединять разные артикулы
одной модели, но не разные размеры и конструкции. Ключ записывается как
стабильный 32-символьный hex, чтобы его принимал интерфейс семей.

Для выгрузки `68f9930e-df6f-411a-b1f7-a4bc14b41de8` v4 дала `4549 → 275`
товарных альбомов, 240 присоединённых видео и 224 карточки в 57 цветовых
семьях. Проверено, что `876404` на позициях `#13`, `#25` и `#66` получает
один ключ; в интерфейсе эти группы теперь считаются валидными. Короткие
описания `702823` без характеристик удалены. Проверенный пример видео:
альбом `#142` получил видео из `#140`, а видео упаковки из `#139` не
присоединено. Исходный снимок `SCRAPED` сохранён без изменений; текущий этап —
`SCRIPT_PROCESSED`.

Дополнительно выполнена проверка точного ключа `артикул + цвет` по датам
`supplier_published_on` внутри all-timeline (2025-02-12—2026-08-28). Найдены
3 повторяющихся ключа в 6 альбомах, но все повторы имеют одну и ту же дату;
совпадений с разницей около года (не менее 300 дней) не найдено.

## Сумки Valentino (supplier 44)

Активная DB-backed версия `Valentino Сумки — полные альбомы, видео и цветовые
семьи v1` оставляет только альбомы минимум с восемью фотографиями и полным
описанием от 95 Unicode-символов. Короткие карточки, включая распродажные
`特价🉐...💰`, карточки с `Miumiu`/`Miu Miu` и однофотные видео-карточки не
публикуются. У оставшихся карточек принудительно сохраняется канонический бренд
Valentino.

Видео присоединяется к последующему фотоальбому только при совпадении полного
`attributes.szwego_tags` и артикула из `款号`/`型号`/`货号`/`编号` либо из
однозначного короткого видео-текста. Используется ближайшее ещё не занятое
видео в пределах шести исходных позиций; спорные и лишние видео остаются
неприсоединёнными. Галереи не склеиваются: каждый товар сохраняет свой
`external_id`, `source_position`, описание и порядок фотографий.

Цветовые семьи строятся глобально по точному нормализованному артикулу из
полного описания. Семья создаётся только при наличии минимум двух альбомов и
получает стабильный 32-символьный hex `variant_group_key`; одиночные товары
остаются без ключа.

Для batch `47e8dec3-5858-48d3-9925-d97e1a5cac29` Preview дал `2887 → 617`
карточек, 344 присоединённых видео и 65 цветовых семейств (603 карточки в
семьях). Альбомы `#8` и `#11` получили видео из `#6` и `#9` соответственно;
исходный `SCRAPED` снимок не изменяется.

На этапе `SCRIPT_PROCESSED` для поставщика 44 дополнительно выполняется
детерминированная дедупликация: одинаковый нормализованный полный набор фото
считается одной карточкой, порядок фотографий и query-параметры URL не влияют
на fingerprint. В группе сохраняется существующий в Rails `external_id`, если
он найден, иначе — карточка с последней исходной позицией. Недостающие
атрибуты, более полное описание и видео объединяются в сохранённую карточку;
разные цветовые галереи не склеиваются. При недоступности проверки Rails этап
останавливается, чтобы не потерять карточку, которую нужно обновить.

Для batch `47e8dec3-5858-48d3-9925-d97e1a5cac29` это сокращает результат
`617 → 225`: 150 карточек обновляют существующие товары, 75 остаются новыми,
392 повтора отсекаются до AI и публикации. Проверка Preview использует те же
правила; исходный `SCRAPED` снимок сохраняется неизменным.

## Fendi Сумки (supplier 40)

Активна DB-backed версия `Fendi Сумки — альбомы от 6 фото, дубли и цветовые
семьи v1`. Товарным считается альбом минимум с шестью фотографиями и
описанием от 100 Unicode-символов. Карточки рекламных/lookbook-публикаций,
подвесов и брелоков (`包挂`, `挂饰`, `钥匙扣`), подборок (`合集`) и явных
сервисных фото не выпускаются. Галерея, `external_id`, `source_position` и
исходный порядок сохраняются.

Артикул извлекается из кода после одного или нескольких `🐝`/`🍌`, включая
варианты с пробелом или дефисом (`🐝🐝094M68`, `🐝🐝129M200`), а также из
редкого `货号:`. Совпадение точного артикула создаёт цветовую семью, но не
склеивает альбомы: каждый цвет остаётся отдельной карточкой. Семья получает
стабильный 32-символьный hex `variant_group_key` и имя `Fendi <артикул>`;
одиночные артикулы остаются без ключа.

Дубликатом считается только подтверждённый повтор: одинаковая нормализованная
галерея либо одинаковое описание с тем же артикулом и явным цветом. Одинаковый
шаблон текста при разных галереях и без цветового признака сохраняется, потому
что в этом источнике он может описывать разные цвета.

Для выгрузки `2a5daf43-aeac-4e93-b8cf-86c46f30e5dc` обработка дала `875 → 312`:
444 карточки имели минимум шесть фото, после порога описания осталось 339,
удалены 11 сервисных/аксессуарных карточек и 16 подтверждённых повторов.
Сформировано 66 цветовых семейств на 240 карточках. Позиции `#15`, `#17`,
`#19`, `#21`, `#23`, `#25` с артикулом `094M68` получили общий ключ.
Исходный `SCRAPED` снимок сохранён; партия применена в `SCRIPT_PROCESSED`.

За последний год в scraping-БД найдена только эта одна выгрузка Fendi, поэтому
межпартийное сравнение за год выполнить не из чего. Внутри текущей партии
найдены повторяющиеся описания; совпадения разных фото без достаточного
доказательства не удалялись.

## Сумки Burberry (supplier 37)

Активна DB-backed версия `Burberry Сумки — строгий мусорный фильтр и дубли v2`.
Товарным считается альбом минимум с шестью фотографиями,
содержательным описанием от 100 Unicode-символов и подтверждённой моделью или
размером. Сервисные карточки без этих признаков (например, `Authentic product
image`, `comparison`, сравнения размеров и альбомы с несколькими разными
размерными рядами) не выпускаются. Полный код после
`Model`/`型号`/`款号`/`货号`/`编号` сохраняется в `attributes.model_code`.

Цветовые альбомы не склеиваются. После дедупликации карточки с одним полным
`model_code` получают стабильный 32-символьный hex `variant_group_key` и имя
семейства `Burberry <model_code>`; одиночные модели ключ не получают.

Проверка дублей использует только положительное совпадение: одинаковую
нормализованную галерею либо тот же полный артикул, описание и пересечение
фотографий в исходной медиадиректории. Слабое совпадение с одной общей
фотографией считается перевыкладкой только при разрыве не менее 100 позиций в
годовой ленте; соседние альбомы одного артикула остаются цветовыми вариантами.
Совпадение рекламного текста, тега или четырёхзначного семейного номера само по
себе дублем не считается.

Перед дедупликацией workflow получает существующие в Rails `external_id` по
всему сырому снимку. Карточки с такими ID восстанавливаются даже если фильтр
их исключил; если в группе несколько уже существующих ID, сохраняются все они.
Новые перевыкладки удаляются, а `external_id` и `source_position` сохранённой
карточки не меняются.

Для выгрузки `dd880e60-7c52-452e-a35a-00258645774a` Preview дал `4786 → 1275`
после фильтра и `1275 → 1128` после дедупликации. Проверено 451 уже
существующий Rails `external_id`: потерянных ID — 0; повторный прогон
идемпотентен. Для артикула `388150` остались две цветовые карточки, а старые
перевыкладки `#95/#1618` и `#99/#1626` удалены в пользу уже существующих ID.
Сырой снимок сохранён неизменным. Последний запуск через интерфейс сохранил
1275 карточек старым UI-путём, который применял только Python-фильтр; после
подключения общего финализатора повторный запуск должен сохранить 1128. Версия
v2 активна.
