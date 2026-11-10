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

## Chrome Hearts — сумки, серебро, ремни (supplier 3)

Активная DB-backed версия `CH Ювелирка, сумки, ремни — варианты по 型号, видео
по артикулу v4` обрабатывает смешанную ленту Szwego: сумки, серебро, ремни и
мелочь в одном таймлайне за 2023–2026 годы. Выгрузка
`3e140b07-5221-459f-86fa-4688adda9601` дала 11 808 альбомов и 613 товаров;
исходный `SCRAPED` snapshot не изменяется.

Карточка товара — альбом с `型号` и блоком характеристик
(`尺寸`/`长度`/`925银`/`纯手工`). Карточка закрывает свой прогон: сервисные
альбомы поставщик публикует до неё. Альбомы-паспорта `细节数据` тоже содержат
`型号`, но товаром не считаются: они уходят в технические фото блока. Белые
карточки `代理直转［无标识‼️白底图］` не публикуются, но закрывают блок.

Границы блока: карточка с `型号`, разделитель (альбом без фото или из одних
символов) и любой альбом с 5+ фото — поставщик сначала выкладывает основной
набор фото, затем одиночные кадры и карточку. Поэтому карточка не
подхватывает набор предыдущего товара.

Внутри блока в галерею попадают только альбомы с доказанной связью:
технический маркер (`数据图`/`尺寸图`/`克重`/`长度`), упаковка
(`包装图`/`标配`), артикул карточки в подписи или альбом без подписи.
Маркетинг (акции, `柜价`, `合集`, сторис, фото знаменитостей), видео-постеры
`发货视频` и белый фон отбрасываются. Порядок галереи: фото карточки → фото в
жизни/на модели → упаковка → техника (вес и габариты последними). Дубли
URL удаляются, хвост ограничен 22 фото, добираются ближайшие к карточке
альбомы.

Вариант одного артикула определяется по подписи, а не по фото. Сначала берётся
хвост строки `型号`: `·型号 K640 彩皮十字` → `彩皮十字`, `·型号 K640` → пусто.
Если хвоста нет, ключом становится китайское название товара без бренда и
английских слов (`JJ Dean 机车包` и `机车包` — один товар), затем слова
материала и цвета. Карточка без хвоста наследует ярлык, если у того же
артикула ровно один вариант с таким же названием. Побеждает карточка с самой
полной галереей (при равенстве — более свежая). Артикул сохраняется в
`attributes.model_code`, ярлык варианта — в `attributes.variant_label`,
исходные позиции альбомов — в `attributes.album_*_positions`.

Категории задаются детерминированно по префиксу артикула: `K` — Сумки
(тоут/на плечо/поясные/клатчи/рюкзаки/дорожные), `W`/`WE` — клатчи и
кошельки, `B` — Ремни, `H` — Браслеты (表链 — Цепочки), `N` — Колье, `D` —
Цепочки с подвесками, `L` — Цепочки, `E` — Серьги, `X` — Аксессуары/Другое,
`F` — Бижутерия/резинка для волос; gender `unisex`.

Видео привязывается по артикулу **и варианту**. Из альбомов с
`szwego_video_url` (режим парсинга `all`/`video`, файл `.mp4` в `pvod`)
строится список «артикул → ролики, свежие первыми». Совпадение ищется по
хвосту подписи ролика: сначала вхождение ярлыка варианта, потом названия
товара, затем общая подстрока; при неоднозначности ролик не прикрепляется.
Если у артикула один товар — берётся самый свежий ролик; если несколько, но
ровно один без ярлыка (базовый вариант), ему достаётся свежий ролик. Товару
пишутся `attributes.szwego_video_url`, `szwego_video_poster_url` (кадр),
`szwego_video_timestamp`, `szwego_video_caption`; спорные варианты получают
`attributes.video_candidates` (до 5 роликов) и `video_ambiguous` вместо
чужого видео. Видео не попадает в `photos`: его перезаливает и публикует
отдельный видео-пайплайн. На выгрузке `3e140b07` ролик получили 171 товар из
613, у 194 есть кандидаты на ручной выбор; пример K640: базовый `850` получает
ролик «K640 机车腋下包», а `858` (彩皮十字) и `866` (黑色十字) остаются с
кандидатами, потому что подписи роликов их не различают. Поставщику включён
режим `all`, чтобы видео приходило в каждой выгрузке.

Границы: в выгрузке нет кириллических описаний — текст карточки переводит
следующий AI-этап. Технические кадры без подписи распознаются как фото в жизни
и остаются в середине галереи. Белые карточки `代理直转` в выгрузке есть, но не
публикуются.

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

Для Balenciaga создан отдельный DB-backed скрипт v1 (supplier 50, версия
`4`, id `5b0686e7-0e45-4889-86ab-cf95b3279dbb`). Он использует те же правила
альбомов, привязки видео, цветовых семейств и дедупликации, но распознаёт и
оставляет только Balenciaga и записывает канонический brand ID. Preview на том
же raw-снимке дал `28323 → 235` карточек: 137 видео, 49 семейств на 205
карточках, все 235 `external_id` уникальны, коротких альбомов нет.

Версия сохранена неактивной: у одного supplier может быть только один активный
скрипт, а активация Balenciaga-only заменила бы текущую v3 и убрала пять уже
настроенных брендов при следующей обработке. Для добавления Balenciaga в общий
результат нужен отдельный комбинированный скрипт или отдельный supplier/batch.

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

The supplier publishes one catalogue product as a *run* of consecutive Szwego
albums that all carry the same product tag (`（无标）miu灰色水钻翻领卫衣`). The
active DB-backed version `v3: цветовые семьи, без Chrome Hearts, VT=Valentino,
бренд по тегу` reads that run instead of a single target album. A run becomes a
product only when it contains the detail album `【实拍图一组】`; photo-less
caption albums (`-`, `⚠️货期…`) never become products.

Inside a run the albums have fixed roles:

- `新品现货` / `新品预告` — the clean stock shot, always the last album of the run;
- `【实拍图一组】` — exactly nine detail photos (all 73 runs of batch
  `d9beef37-a66e-4e00-8d7c-43007075afe0`);
- `尺码表`/`尺寸表` — the size chart, always one photo;
- `Compare …对比` — technical blocks (fabric, trims, print, buttons, ribbing);
- `💲原版购买凭证` — a purchase-proof screenshot;
- `特写` — a macro close-up that belongs to the comparison set;
- all other albums — model/lookbook shots with marketing captions only.

Gallery order is fixed: the clean stock shot first, then the nine detail
photos, then up to `MAX_LOOKBOOK_PHOTOS` (8) lookbook photos in source order,
then the size chart last. The batch opener `超多新品现货 火爆接单中`, every
comparison album (`Compare`, `对比`, `🆚`, `特写`) and every receipt album
contribute no photos, so a gallery holds 15–19 photos instead of the 113 raw
photos of the largest run.

The description is the product caption from the detail album (the `【实拍图一组】`
marker is removed) followed by the technical blocks only: captions matching
`Compare`/`对比`/`🆚`/`防伪点` after normalisation and tag removal. Marketing,
lookbook, receipt and size-chart captions contribute no text.

Identity stays with the detail album: `external_id` and `source_position` are
never recalculated. The run tag is recorded as
`attributes.post_process_group_tag`, attached sources as
`attributes.post_process_source_ids`, the chart as
`attributes.size_chart_source_id`, and the stock album as
`attributes.stock_photo_source_id`; `attributes.post_process_version` marks a
processed card so a second run returns it unchanged. A photo album without
tags (for example a bare `【实拍图一组】`) joins the run only when both
neighbours carry the same product tag. Bookkeeping tags `搭配参考（陆续更新）`
and `搭配图📋` never identify a product.

Batch `d9beef37-a66e-4e00-8d7c-43007075afe0` transforms `2131 → 69` cards after
the brand rules below: all 73 detail albums become one product each, four Chrome
Hearts cards are dropped, no source album is attached to two products, and every
gallery starts with its stock shot and ends with its size chart.

### Brand rules

The brand is read from the product tag first and from the description only as a
fallback, using alphanumeric token boundaries. Technical captions contain
measurements such as `3mm`/`6mm`, and the previous letter-only boundary turned
those into `Maison Margiela`; the current rule leaves `PD黑色连帽三角牌冲锋衣`
as Prada and produces no Maison Margiela card in this batch. `VT` is the
supplier's shorthand for Valentino and is mapped to the canonical brand.

Chrome Hearts is not published at all: a run is dropped when its tag carries the
`CH` token or `克罗心`/`Chrome Hearts`, or when the resolved brand is Chrome
Hearts. Four cards were removed from this batch.

### Colour families

Consecutive cards of one model in different colours receive a stable
`variant_group_key` (md5 of `brand id | model signature`) and a readable
`variant_group_name` such as `Loewe 荆棘刺绣短袖`. The model signature strips
the `（无标）` marker, the brand alias and colour labels (`黑色`, `白色`, `深蓝`,
`杏棕`, …), then compares the remaining characters without regard to word order,
so `Burberry黑色袖格子短袖` and `Burberry格子袖白色短袖` are one family while
`L黑白拼色短袖` and `L黑白拼色长袖` stay two products. A family needs at least
two consecutive cards with different colour labels; galleries are never merged
and every colour keeps its own `external_id`, photos and `source_position`.
This batch yields 10 families covering 23 cards.

Version 1 stays in `supplier_post_process_scripts` as a rollback point and
versions 2 and 3 were saved without re-processing the batch; the operator had
already applied version 2 manually, so the stored products still hold 73 cards
until the stage is run again. The immutable `SCRAPED` snapshot remains the
recovery boundary.


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
содержимое фото по CDN `ETag` и кэшируемому визуальному отпечатку
(perceptual hash + нормализованный пиксельный образ) в
`supplier_photo_fingerprints`. На холодном кэше для каждого товара проверяются
только первые три фотографии; полный набор скачивается только для найденных
кандидатов. Ручной запуск из кнопки выполняется фоновой операцией с серверным
статусом; повторный запуск уже проверенные URL не скачивает.

Полная одинаковая галерея считается дублем даже при разных URL и ETag. Также
короткая карточка (до двух фото) считается дублем, если все её фото входят
ровно в одну более длинную галерею той же модельно-размерной семьи. Частичное
совпадение длинных галерей (даже три и более фото) теперь только попадает в
отчёт и не удаляет товар: одно общее фото, одинаковое описание, модель или тег
без полной визуальной галереи не являются основанием для схлопывания, поэтому
разные цвета не смешиваются.
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
`12823 → 2579 → 2083` карточек: из 3005 альбомов с 8+ фото сохранено 2579,
удалено 480 точных перевыкладок, первоначально сохранены все 1229 уже
существующих Rails-ID; после адресного удаления трёх подтверждённых Rails-дублей
активными остались 1226. Сформировано 219 семейств на 1900 карточках. В
дополнительном аудите CDN по
17 021 фото найдено 29 пар с совпадением содержимого; 16 сильных пар дали 16
удалённых перевыкладок после адресной очистки трёх старых duplicate-карточек
из Rails. В результате не осталось точных дубликатов галерей, а содержательные
перевыкладки с другими URL теперь схлопываются при постобработке. Повторный
прогон после расширения правила также вернул 2083 карточки без новых удалений;
в целевой семье `Bottega Veneta 6608 32x24x12` осталось 87 вариантов и не найдено
ни одной пары с общим содержательным фото. В начале ленты позиции
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

## Одежда МЖ ZP (supplier 66)

Для выгрузки `35ce7570-c4fa-4278-800c-0ba15110defd` активна DB-backed версия
`Одежда МЖ ZP — последовательные цветовые семьи v2`. Из 6783 исходных
карточек в `SCRIPT_PROCESSED` сохранено 945 карточек одежды; обувь, сумки,
аксессуары и разделители не выпускаются.

Товаром считается карточка с размером и ценой, отмеченная одежным тегом.
Если в одном исходном блоке есть полноценный альбом той же модели (пять и
более фото), короткая повторная карточка этой модели отбрасывается; отдельная
однофотная карточка без более полного повтора сохраняется. Альбомы не
склеиваются между собой и сохраняют исходные `external_id`,
`source_position` и порядок.

К основной карточке добавляется только непосредственно предшествующий альбом
`反面`/`洗涤说明`, если в нём больше одного фото. Таблица размеров (`尺码表` /
`尺寸表`) добавляется по точному нормализованному названию модели внутри того
же исходного блока и может быть общей для нескольких цветов. Карточки
`上身素材`, `明星素材`, `GW素材`, `ZP售价`, однофотные рекомендации по стирке
и обычные короткие повторы отдельными товарами не выпускаются. Техническая
история прикреплённых источников записывается в
`attributes.post_process_attached_source_ids`.

Карточки одной одежды получают стабильный 32-символьный hex
`variant_group_key` только при последовательном совпадении полной группы тегов
и нормализованной модели внутри одного исходного блока. Межблочные повторы не
смешиваются, а карточки остаются отдельными цветовыми товарами. В проверенных
примерах #32 получил #31 и #26, #41 — только #35, #81 — #80 и #77, #230 и
#233 сохранились раздельно и получили общий ключ, #1112 объединён только с
#1109. Семья Celine из примера разделена по блокам на 3 и 2 карточки. После
исправления максимальный размер семьи — 8 вместо 37; прикреплено 362 сервисных
альбома и 924 таблицы размеров. Сырой `SCRAPED` снимок сохранён.

## Касабланка (supplier 67)

Для поставщика `Касабланка` активна DB-backed версия для выгрузки
`00483394-f6f3-46df-9dcc-ac7183c6af9a`:
`Касабланка — альбомы, размеры и фото на модели без обуви` v1. Основной
товарный альбом определяется по исходному описанию с ценой/размером. Из него
исключаются карточки обуви (`鞋`/`靴` и соответствующие описания), а также
служебные и пустые карточки.

К ближайшему основному альбому присоединяются только непрерывные карточки
`尺码标`/`尺码表`/`尺寸表` и `上身效果`/`上身图`: фото идут в порядке
`основные → размерная таблица → фото на модели`, как в исходных блоках
`#3 ← #2 ← #1` и `#7 ← #6 ← #5`. Неизвестный служебный маркер (`秀`,
`一套都有`, пустая карточка и т. п.) останавливает присоединение, поэтому
соседние альбомы не поглощаются. Исходные `external_id`, `source_position`,
поля товара и порядок основных фото сохраняются; повторный запуск идемпотентен.

Preview на полном raw-снимке дал `1957 → 486` карточек: исключено 168
обувных товарных альбомов, 466 карточек получили дополнительные фото,
`external_id` и `source_position` уникальны, пустых галерей и обуви в выводе
нет. Исходный `SCRAPED` снимок остаётся неизменяемым; публикация в Rails этим
правилом не выполняется.

## Пуховики, куртки, пальто, жилеты (supplier 55)

Для выгрузки `09f879ba-749d-4143-b606-c489f4fe30bc` активна DB-backed версия
`Пуховики/куртки/пальто/жилеты — склейка альбомов по разделам v3 (без фото на
модели и без sizes)` (version 3; `v1` и `v2` отключены). Из 3759 исходных
альбомов в `SCRIPT_PROCESSED` сохранено 288 товаров.

Разделы отделены пустыми альбомами `➖➖➖➖➖M➖➖➖➖➖` (0 фото, 153 шт.: именно
они делят ленту, а не каждый товар). Раздел — это одна модель в нескольких
цветах. Товарный альбом — карточка, описание которой начинается со стрелки в
первых 14 символах (`Premium Down ⬆️`, `特级羽绒⬆️`, `Super King ⬆️`,
`羽绒上新⬆️`, `Down vest ⬆️`): 288 карточек. Внутри цветового блока продавец
публикует три витринных фото, видео, альбом деталей на 9 фото, иногда ещё
видео и общий альбом на 4 фото (`两色`/`三色`), и последним — главный альбом.
Поэтому главный альбом всегда последний в блоке, а его сервисные альбомы идут
перед ним в обратном хронологическом порядке. Границу блока ищут от главного
альбома назад через видео, детали, общий альбом, фото на модели и размерную
сетку до последней серии однофотных альбомов.

К главному альбому присоединяются сервисные альбомы его блока (витринные фото,
видео, детали) и общие для нескольких цветов альбомы (`two colour`/`两色`/
`三色`, `real-life photo group`); таблица размеров (`Size Chart`/`尺码表`) также
добавляется каждому цвету семейства и всегда идёт последней в галерее, а номер
модели из неё используется для читаемого имени семьи. Семейные видео
дополнительно сохраняются в `attributes.album_family_video_url`.

Не присоединяются: альбомы `上身效果`/`Upper body effect` (306 шт.: серия
публикуется одна на весь раздел и смешивает цвета), ведущие фото на модели в
многоцветном разделе, когда число групп из трёх альбомов не равно числу цветов,
а также одноцветные альбомы из общего блока многоцветного раздела (227 шт.).
Проверено по картинкам: в разделе Cygne общие витринные видео `#69–#71`
бежевые, `#72–#73` синие, то есть приклеивание их ко всем трём цветам
подмешивало бы чужой цвет. В одноцветном разделе смешивать нечего, поэтому его
общий блок сохраняется целиком. Реклама (`💥`/`⏳`/`🌟`/`👏`), скриншоты цены с
офсайта (`官网售价`, 78 шт.), упаковка (`出厂标配`, `礼盒`, 50 шт.) и
разделители товарами не становятся.

Парсер пишет в сырые карточки заглушку `attributes.sizes` (`["1","2","3","4","5"]`
и подобные значения на 194 карточках); в результат она не записывается.

Цветовые семейства строятся по разделу, поэтому внутри одного раздела все цвета
одной модели получают общий стабильный 32-символьный hex `variant_group_key`
(102 семьи; 38 одноцветных товаров ключа не получают). Проверено на выгрузке:
#39 и #45 — `Moncler Cygnes`, #83/#89/#95 — `Moncler Cygne`. Ведущие фото на
модели привязываются по порядку, когда групп ровно столько же, сколько цветов:
проверено визуально на `#5–#7` бежевые → `#39`, `#8–#10` тёмные → `#45`,
Liane (белый/бежевый/розовый/голубой) и Barante (белый/розовый/чёрный) — группы
совпадают с цветами товаров; для `#83` и `#95` групп нет, поэтому их ведущие
фото не присоединяются.

Техническая история склейки — в `attributes.album_source_positions`,
`album_attached`, `album_family_key`, `album_family_name`, `album_colour_index`,
`album_colours`. Итог: склеено 2447 альбомов, отброшено 1312; на товар
приходится от 3 до 17 альбомов (медиана 7), галерея — от 14 до 52 фото
(медиана 28, было 99). Повторный запуск на сохранённых товарах даёт побайтово
тот же результат; сырой `SCRAPED` снимок не изменялся, AI и публикация в Rails
не запускались.

### yu_scraping, версия 09.11.2026 (v4, отбраковка спеццены)

После переезда на `yu_scraping` поставщик 55 называется «Пуховики». Активна
DB-версия `Пуховики — склейка альбомов v4 (отбраковка 特价/🉐, без фото на
модели, без sizes)` — `version=2`, id `c064bce6-9d03-4bf1-b0f3-c847227dd8a3`,
`post_process_enabled=true`; прежняя v3 (восстановленная 07.11.2026) отключена.
На момент проверки флаг `post_process_enabled` был `false`, поэтому автозапуск
после парсинга не срабатывал и выгрузка оставалась в `SCRAPED`; ручная стадия
«Обработать скриптом» работает и без флага, потому что ей достаточно активной
DB-версии.

Новый фид вырос и теги стали китайскими (`szwego_tags` вида `Moncler针织系列`),
структура та же: разделы по `➖➖➖➖➖M➖➖➖➖➖`, товар — карточка со стрелкой в
первых 14 символах. Добавлена отбраковка спеццены: карточка с `特价` или `🉐`
(рядом обычно идёт `P6️⃣5️⃣0️⃣`, иногда `不配包装/不售后`) не публикуется вместе
со своим блоком. На сыром снимке маркер стоит у 100 карточек, из них 81 —
главные альбомы собственных разделов (74 с полными 9 фото, 3 с одним фото,
4 с четырьмя), поэтому правило убирает и самую тонкую часть фида. У `MR LEE`
(supplier 70) действует такое же правило по `清仓/特价/促销/处理/🉐`.

Результат на выгрузке `409c10e2-1e9c-4ac9-9048-39f5983bfea8`: `8801 → 575`
товаров, склеено 5212 альбомов, отброшено 3589; 190 семейств, 106 одноцветных,
574 с видео, галереи 11–58 фото (медиана 29), `sizes` нет ни у одного товара,
`特价`/`🉐` в описаниях нет, дублей `external_id` и фото нет. Сырой снимок
`SCRAPED` (8801, `f681b5e5…`) не изменялся, обработанный — `SCRIPT_PROCESSED`
(575); повторный запуск на сохранённых товарах побайтово совпадает с Preview.
AI и публикация в Rails не запускались.
## MR LEE (supplier 70)

Для поставщика `MR LEE` (`szwego_parse_mode = all`) активна DB-backed версия
`MR LEE — альбомы, видео и фото на моделях, без распродаж v2`; `v1` (977
товаров, с распродажами и бестекстовыми подборками) отключена. Версия
применена к выгрузке `4a7f4fd3-8dca-411f-a462-8784a7159a3b`: `4397 → 386`
товаров, сырой снимок `4786efd4-0296-4590-8b76-b6dbdbaf1f61` (4397) не
изменялся, обработанный — `4012aed2-c158-4f1f-b9c9-bbb49f8ba79e` (386).

Поставщик публикует товар одной сессией публикаций, порядок внутри сессии:
главный альбом (9 фото и одно и то же маркетинговое описание на 105–109
символов) → три одиночных фото деталей → видео-карточка (эмодзи-описание и
`attributes.szwego_video_url`) → одиночные фото на модели. Проверено на
сыром снимке: у 385 из 386 главных альбомов первые три карточки после альбома
— пустые одиночные, а все 12 видео новых сессий стоят ровно на четвёртой
позиции после своего альбома; на выгрузке 2026-09-09 альбом #39 получает
видео #35 и моделей #32–#34, альбом #31 — видео #27 и моделей #15–#26, а
детали #36–#38 и #28–#30 не публикуются.

Правило: сессия — непрерывная серия карточек с разрывом не больше 6 часов
(самый большой разрыв внутри сессии в сыром снимке — 28 минут, следующий по
величине — больше суток). Товаром становится **только** главный альбом с
маркетинговым описанием. Карточки сессии до первого альбома
(референс-скриншоты «на модели») присоединяются к этому альбому; первые три
пустых одиночных фото после альбома отбрасываются как детали; видео
переносится в `attributes.szwego_video_url`; остальные фото (в том числе
заметки вида `🖤🤍`, `垫肩`, `可拆卸`) идут в галерею.

Не публикуются вовсе: распродажи (`清仓`/`特价`/`促销`/`处理`/`🉐` с ценой и
размером, 508 карточек) и альбомы без описания (бестекстовые подборки от 6
фото, 4 карточки). Такая карточка обрывает галерею предыдущего альбома, а
вместе с ней отбрасываются и следующие за ней карточки её сессии. Сессия, в
которой нет главного альбома (93 сессии: распродажи, референс-фото, модельные
серии), не публикует ничего.

Итог: из 4397 карточек склеено 3420 и отброшено 4011 (3448 пустых, 508
распродаж, 28 видео, 23 заметки, 4 бестекстовых альбома); галереи владельцев
сохранены полностью, отброшены 1158 фото деталей и кадры-обложки
видео-карточек. Видео получили 15 товаров (все 12 видео новых сессий), пустых
галерей нет, `external_id` и `source_position` уникальны и сохранены у
владельца, дублей внутри галерей нет. Повторный запуск идемпотентен
(`attributes.szwego_album_owner`). AI и публикация в Rails не запускались.

## Верх Муж Одежда (supplier 71)

Активная DB-backed версия `Верх Муж Одежда — описание семьи, размерная сетка и
цветовые семьи v2 (обложка костюма, [Synchronization] у одиночек, без 2-3-фото
hand-made)` (`scripts/parser/process_verh_muzh_odezhda.py` — тот же код как
Git-артефакт; `v1` оставлена в истории и выключена) применена к выгрузке
`a4daf287-4af4-4388-8753-ae504e5eef9b`: `486 → 210` товаров, сырой снимок
`3fe15b8c-6aa6-4b2d-9f2c-184b4822ce99` (486) не изменялся, обработанный —
`bdd5b9f4-be8d-46b8-b696-c54f4c0c85ef` (210).

Поставщик публикует одну ленту, где альбомы одного товара разъединены:
описание семьи лежит в отдельном альбоме с маркером `📍` (в выгрузке 83 таких
альбома и ровно 83 семьи), размерная сетка — в альбоме `【size】` (40), цвет —
в альбоме `【Цвет】` (150) или в детальном альбоме («Details of White Pants»,
«[Blue Detail]», «Cowboy Blue Details», 106). Пустые альбомы `-` (62) —
разделители, `[Synchronization]` (45) — фото товара на модели.

Правило: семья — непрерывный отрезок ленты, который закрывается своим
альбомом-описанием. Разделители, `[Synchronization]` и альбом-описание не
становятся товарами: текст описания дословно переносится каждому цвету семьи,
а собственные фото альбома-описания (по одной обложке на цвет) не
присоединяются. Фото `【size】` копируются всем цветам семьи и остаются
последними в галерее. Все альбомы одного цвета склеиваются в один товар:
самый ранний по `source_position` сохраняет `external_id` и
`source_position`, остальные галереи дописываются по порядку ленты.

Цвет берётся из тега `【...】` или из подписи детального альбома после удаления
слов про детали и предмет одежды; написания grey/gray/glay сведены к одному
цвету, поэтому «Details of dark gray pants» и «Details of Dark Grey Coat»
остаются одним товаром. Детальный альбом без слова о цвете («🛶2026 FW NOW
AVAILABLE») — реклама и не публикуется. Семья из двух и более цветов получает
стабильный md5 `variant_group_key` и `variant_group_name`, цена одного цвета
— без ключа. Цвет каждого варианта записан в `attributes.colors` и
`attributes.album_colour`, имя семьи — в `attributes.album_family_name`,
исходные позиции собранной галереи — в `attributes.album_source_positions`,
источник описания — в `attributes.description_source_id`.

Костюм публикуется двумя альбомами на цвет (брюки и верх), поэтому у
склеенного товара нет фото комплекта. Если цвет собран из нескольких альбомов
и в альбоме-описании ровно столько же фото, сколько цветов, каждое фото
становится **обложкой** своего цвета в обратном порядке ленты: проверено на
картинках по примеру оператора — у семьи 421–425 первое фото №426 (фиолетовый
костюм целиком) уходит товару 424–425, второе (серый костюм целиком) — товару
422–423. Если количества не совпадают, фото не присоединяются (так у семей
410–415 и 453–461). Обложку получили 39 товаров.

У семьи с одним цветом нет цветовой семьи, которую нужно защищать, поэтому
фото `[Synchronization]` этой семьи дописываются её товару перед размерной
сеткой (17 одиночных товаров). У семей с двумя и более цветами
`[Synchronization]` по-прежнему не присоединяется: проверено на картинках, что
кадр показывает один конкретный цвет.

Альбом `【Hand-made】`/`【Hand-knitted 】` с двумя-тремя фото — обрывок семьи, а
не товар: такие карточки (позиции 68 и 155) не публикуются, а их семьи
становятся одноцветными.

Результат: 210 товаров (181 в 53 цветовых семьях, 29 одноцветных), пустых
галерей и описаний нет, `external_id` и `source_position` уникальны и
сохранены у владельца, размерную сетку получили 100 товаров, ключ — 32-hex и
совпадает у всех цветов семьи. Не стали товарами 231 служебная карточка (62
разделителя, 45 `[Synchronization]`, 40 размерных сеток, 83 альбома-описания),
1 рекламный альбом, 2 мелких hand-made/hand-knitted альбома; ещё 43 альбома
вошли в галерею своего цвета. Повторный запуск идемпотентен
(`attributes.album_merge_version`), повторная обработка выгрузки дала те же
210 товаров и не создала второй снимок `SCRIPT_PROCESSED`.

Проверены примеры оператора: `#4–#8` получают описание `#9` и сетку `#3`,
`#13–#16` — описание `#17` и сетку `#12`, каждая группа становится одной
цветовой семьёй. Единственная неоднозначная семья — позиции 310–317: у неё два
альбома-описания подряд («Brubello Cucinelli - wool suit pants» и «Brunello
Cucinelli - Wool Suit»); товары получают первое описание, а второй альбом
отброшен, потому что его фото — уже собранные обложки этих же двух цветов.
AI-нормализация и публикация в Rails не запускались.

## Мужская одежда 2 (supplier 25)

Активная DB-backed версия `Мужская одежда 2 — сервисные альбомы, ноунеймы и
бренд из описания v2 (бренд обязателен, добавлены Fendi, BV, Thom Browne, BUR)`
живёт только в `supplier_post_process_scripts` (`v1` выключена) и применена к
выгрузке `fdcd5560-d53f-4627-ad04-92c66994b89b`: `399 → 367` товаров, сырой
снимок не изменялся, обработанный снимок — 367 товаров. Исходник версии — из
базы, отдельного файла в репозитории нет: рантайм берёт код из БД, поэтому
деплой для такой правки не нужен.

Поставщик публикует по одному альбому на карточку, и почти каждая подпись
начинается с бренда, за которым идёт сезонный маркер: `BC*2026New New•新款夹克
款号 36938380 颜色 米 咖 码数 48-56`, `Z*EGNA/2026New …`, `L*P/ 2026New …`,
`Berluti /2026New …`, `76010 布鲁提*2026New …`. Звёздочку поставщик вставляет
внутрь имени, чтобы обойти фильтры по точному слову: в выгрузке встречены
`L*P`, `Lp*`, `B*C`, `Z*egna`, `Z*EGNA`, `P*RADA`, `D*ior`, `D*IOR`, `GU*CCI`,
`G*ucci`, `B*urberry`, `B*URBERRY`, `B*rioni`, `B*ERLUTI`, `T*F`, `L*V`,
`MON*CLER`, `M*oncler`, `Fe*ndi`, `BV*`, `BUR*`, `TB *`, `克罗心*2026New`,
`布鲁提*2026New`, `杰尼亚*2026New`. Звезда либо вставлена между буквами имени,
либо отделяет имя от сезона, поэтому шаблон алиаса допускает до трёх
небуквенных символов между соседними буквами и не требует перечисления всех
позиций звезды.

Правила: альбомы с подписью `官网图` (22 шт., 2–9 фото) и `预售款` (1 шт.) не
публикуются. Публикуется только карточка, в подписи которой распознан бренд:
список брендов ниже — это белый список, поэтому новый бренд поставщика нужно
добавить в него, иначе его карточки пропадут из выгрузки. Бренд назначается
детерминированно по `brand_id` каталога, а совпавший алиас сохраняется в
`attributes.brand_alias` и `attributes.brand_name`. Остальные поля — включая
`external_id`, `source_position`, фото, описание и атрибуты — переносятся без
изменений, альбомы не склеиваются и цветовые семьи не строятся.

Список брендов версии: Loro Piana (`LP`), Brunello Cucinelli (`BC`), Zegna
(`Zegna`, `杰尼亚`), Prada (`PRADA`), Dior (`DIOR`), Gucci (`Gucci`), Burberry
(`Burberry`, `BUR`), Brioni (`Brioni`), Berluti (`BERLUTI`, `布鲁提`), Tom Ford
(`TF`), Louis Vuitton (`LV`), Moncler (`MONCLER`), Kiton (`Kiton`), Loewe
(`Loewe`), Chrome Hearts (`克罗心`), Fendi (`FENDI`), Bottega Veneta (`BV`),
Thom Browne (`TB`). Китайский алиас `杰尼亚` добавлен к Zegna как точное
название бренда в источнике, а `FENDI`, `BV`, `TB` и `BUR` — по решению
оператора для карточек `Fe*ndi`, `BV*2026New`, `TB *2026New` и `BUR*2026New`;
в исходном списке оператора этих четырёх алиасов не было.

Итог: 367 товаров, у всех назначен бренд (Loro Piana 108, Zegna 74, Brunello
Cucinelli 61, Prada 23, Berluti 22, Moncler 19, Burberry 14, Tom Ford 12,
Brioni 9, Dior 7, Louis Vuitton 6, Kiton 4, Gucci 3, Loewe 1, Chrome Hearts 1,
Fendi 1, Bottega Veneta 1, Thom Browne 1). Не опубликованы 32 альбома: 23
сервисных (`官网图`, `预售款`) и 9 без распознанного бренда — шесть ноунеймов
вида `2026New New·新款牛仔裤 款号 99123 颜色 蓝 码数 29-36` и карточки
`ICE*2026New`, `36272010 POLOSS*2026New`, `B*uoni /2026New`, чьи ведущие токены
оператор признал неочевидными. Пустых галерей и описаний нет, `external_id` и
`source_position` уникальны и сохранены, фото и описания не изменялись,
повторный запуск идемпотентен (`attributes.brand_filter_version`) и не создал
второй снимок `SCRIPT_PROCESSED`. AI и публикация в Rails не запускались.

## CH Одежда (supplier 5)

Активная DB-backed версия «CH Одежда — блоки `➨`, чистка обложки,
детали/модель/видео/сетка и цветовые семьи v1» (`ch-clothing-timeline-2`)
проверена на полном сыром снимке выгрузки
`b2446b7d-0fe8-4434-988b-c3bb9dfd02b4` (493 альбома, снимок не изменялся):
54 товара, 26 из них в 10 цветовых семьях, 52 с видео, 39 с размерной сеткой,
пустых галерей нет. Исходник и legacy-fallback совпадают
(`scripts/parser/process_ch_clothing_timeline.py`), рантайм берёт код из
`supplier_post_process_scripts`, поэтому деплой для правки не нужен.

Правила выведены по всей ленте и подтверждены оператором на сетке партии:

* `➨` без фото закрывает блок товара (112 альбомов); товаром становится альбом
  с брендом `Chrome Hearts`/`克罗心`, описанием от 12 символов и 4 фото
  (одна карточка — 6 фото). Все 54 карточки — последний альбом своего
  сервисного прогона, альбомов после карточки в блоке нет.
* Сервисные альбомы идут перед карточкой: `尺码表` (32), `实拍视频` (47),
  фото на моделях — `上身图参考`, `搭配`, `look`, «明星同款», цветовые
  подписи (45 карточек), упаковка `标配：配套YB雪梨纸 手提袋+6` (48) и
  `局部细节参考` (52).
* Из обложки остаются 1-е и 3-е фото: на сырых картинках #7 2-е и 4-е — те же
  кадры под углом. Порядок галереи: обложка → детали → фото на моделях →
  `尺码表` последней.
* Упаковка и однофотонные текстовые альбомы (`三色`, `四色齐`,
  `原版级绣花一致`, `面料 五金自行对比`, `美瞎了`) не публикуются; блоки из
  одного альбома (`‼️今日份资讯分享‼️`, `‼️原版开发‼️…`, `一系列 齐码现货`,
  166/168/170/172) товара не дают.
* Видео: своё у каждой карточки; если на семью оно одно — копируется всем
  (`attributes.album_video_shared`). Общая размерная сетка семьи также
  копируется карточкам без своей (`attributes.album_size_chart_shared`).
* Цветовая семья — карточки с совпадающим описанием после снятия цветовых слов
  и хвоста «цвет / S M L», в том числе через `➨` (63/68/74, 110/114/118,
  210/216/222/228, 449/454, 82/90, 97/103, 135/164, 142/149/156,
  344/349/353); ключ — 32-hex md5, имя семьи — общий префикс описаний.
  Модели, отличающиеся типом вещи, остаются разными товарами (179 `短裤` /
  186 `长裤`; 440 `短裤` / 461 `卫裤` / 468 `套头` / 475 `连帽`), как и
  карточки, чьи описания расходятся не только цветом (`爆款…miami…连帽` против
  `miami…休闲套头卫衣帽衫`, `涂鸦系列 橙红工装` против `涂鸦系列 迈阿密限定`).
* Проверено: `external_id` и `source_position` принадлежат обложке, повторов
  позиций и пустых галерей нет, повторный запуск идемпотентен
  (`attributes.album_merge_version`). AI-нормализация и публикация в Rails не
  запускались.

## LP, Zegna, BC Мужская одежда (supplier 28)

Активная DB-backed версия `LP, Zegna, BC Мужская одежда — секции MAN/WOMAN,
бренд по артикулу, семейства, описание и сетка v2 (без 3-фото сборок)`
(`supplier_post_process_scripts`, `version=2`) применена к выгрузке
`69c945ba-2f7d-4bfa-acf8-9eec8018d435`: `2011 → 523` товара, сырой снимок не
изменялся. Исходник версии совпадает с
`scripts/parser/process_lp_zegna_bc.py`; рантайм читает код из БД, поэтому
деплой для правки не нужен. Legacy-поле `suppliers.post_process_script`
по-прежнему указывает на старый `merge_price_details.py`, но при активной
DB-версии не используется.

Лента — длинный таймлайн, разбитый альбомами без фото `•———• MAN•———• SS26`
и `•———• WOMAN•———• SS26`; сезон в заголовке не фиксирован (`26` может быть
`27`), поэтому заголовок распознаётся по слову MAN/WOMAN и маркеру `SS/FW`.
Внутри секции: альбом-описание модели без фото с `Код модели` (в нём же
палитра, размеры и цены), служебные альбомы (`Unpacking`, видео, `View 360`,
`Original vs. Our Version`, `The size grid`, карточка категории), групповое
фото в один кадр и цветовые карточки по 6 фото с подписью `Price:`.

Правила версии:

* Товар — карточка на 6 фото с `Price:` (`Details` в новых секциях). Сборки
  нескольких товаров в одном альбоме (например, `#187` с тремя фото и
  артикулами `LPH009/LPS005`) не публикуются: у реальной цветовой карточки
  шесть кадров. В секциях, где `Price` и `Details` чередуются, товаром
  становится `Details` (вещь на вешалке/столе), а предшествующий `Price`
  (кадры на модели) дописывается в галерею; `external_id` и `source_position`
  остаются у `Details`.
* Описание всем товарам секции берётся из альбома с `Код модели`.
* Размерная сетка — `The size grid` с тем же кодом модели, её фото идут
  последними. У аксессуаров сетки нет.
* Цветовое семейство — непрерывный ряд карточек одного кода модели в секции;
  ключ — 32-hex md5, имя — код модели. Одиночная карточка семейства не получает.
* Бренд определяется по артикулу: `LP`/`LPH`/`LPS` — Loro Piana, `BC`/`BCH`/
  `BCS`/`BCG` — Brunello Cucinelli, `ZE` — Zegna, `BL` — Berluti, `KT`/`KTH` —
  Kiton, `ST` — Santoni (артикулы `BL2533M`, `ST2615`).
* У аксессуаров (`男士配饰`) первый кадр — комплект, поэтому второе фото
  становится первым.
* Гендер — из заголовка секции: `MAN` → `male`, `WOMAN` → `female`.

Итог: 523 товара (Loro Piana 218, Brunello Cucinelli 144, Zegna 87, Kiton 39,
Berluti 24, Santoni 11), 78 цветовых семейств, 52 женских товара, 446 с
размерной сеткой (у 77 аксессуаров её нет), без бренда и без описания — 0.
Не публикуются 1488 альбомов: служебные (unpacking, видео, `View 360`,
`Original vs. Our Version`), заголовки, описания, групповые фото в один кадр,
белые луки, ценовые альбомы без фото и 3-фото сборка `#187`; 40 `Price`-альбомов
стали фото на модели у `Details`-товаров. В секции BC0123 (`#1955–1981`)
описание обещает «Палитра: 5», но карточек восемь (`#1974–1981`) — публикуются
все восемь.

Проверены примеры оператора: `#159–166` (ZE2618-1G) — одно семейство, описание
`#141`, сетка `#156`; `#136–139` (KT012) — описание `#119`, сетка `#133`;
`#66–72`, `#76–82`, `#87–93` (шапки/шарфы/перчатки) — три отдельных семейства,
общее описание `#47`, второе фото первым; `#687/689/691/693` (BC0125) — товары
`Details` с фото на модели `#686/688/690/692`, описание `#666`, сетка `#683`;
такой же паттерн в `#1561–1569` (KT007); `#1589–1599` (LP2639) — женская секция.
Повторный запуск на сыром снимке даёт те же 523 `external_id` в том же порядке.
AI-нормализация и публикация в Rails не запускались.

### yu_scraping, версия 09.11.2026 (v2, выгрузка 09fc0821)

После переезда на `yu_scraping` поставщик 28 называется «Мужская одежда #1».
Активна DB-версия `Мужская одежда #1 — без бренда в названии v2 (09.11.2026)`
(`version=2`, id `dbbe96b3-9f13-4031-8052-8cb10f3649f0`),
`post_process_enabled=true`. Файл `scripts/parser/process_lp_zegna_bc.py`
остался legacy-копией прежней версии и рантаймом не используется: код живёт
только в БД.

Новый фид (6193 альбома) отличается от прежнего: `szwego_tags` больше нет,
блок модели начинается альбомом без фото с `Код модели`, `Номер модели` или
`Описание модели`, а заголовки `•———• MAN/WOMAN` только задают гендер.

* Товар — `Price`-карточка с 6 фото либо `Details` с 6 фото. В группах
  «цена + детали» товаром становится `Details`, фото на модели дописываются.
* Группы только из `Details` (прайс-обложка на 0–2 фото) наследуют код из
  обложки или описания блока.
* Аксессуары — по префиксу артикула (`LPH/LPS/LPG/BCH/BCS/BCG`) и `Size: one`,
  у них второе фото ставится первым; сумки — `LB*` (Loro Piana, Extra Pouch);
  `R*` — Brioni (например, `R2567`, коробки Brioni).
* Бренды и категории пишутся каноническими UUID Rails из
  `catalog_id_mappings` восстановленной БД, а не старыми короткими id.
* Сборки из нескольких товаров (меньше 6 фото и несколько артикулов) не
  публикуются.
* Название скрипт не заполняет: бренд пишется только в поле `brand`, а `name`
  остаётся `Без названия` до AI-нормализации.

Результат: `6193 → 1534` товара, 221 семейство, 64 женских, 0 без бренда,
1428 с размерной сеткой, минимум 6 фото. Категории: одежда 755, обувь 678,
аксессуары 94, сумки 7. Бренды: Loro Piana 661, Brunello Cucinelli 554,
Zegna 219, Kiton 47, Berluti 24, Santoni 23, Brioni 6. Сырой снимок не
изменялся; AI и публикация в Rails не запускались.

## LP, BC Одежда (supplier 31)

Активная DB-backed версия `LP, BC Одежда: только LP/BC, без шалей и пустых
альбомов v1` (`supplier_post_process_scripts`, `version=1`) применена к
выгрузке `6d77b95d-0270-4c27-bc27-9f21e83558f1`: `192 → 107` товара, сырой
снимок не изменялся. Исходник версии живёт только в БД; файла в
`scripts/parser/` нет, деплой для правки не нужен. У поставщика включён
`post_process_enabled`, поэтому новые выгрузки обрабатываются этим скриптом
сразу после сырого парсинга.

Лента — независимая последовательность альбомов: один альбом с подписью на
товар, без служебных карточек, без склейки между альбомами. Поставщик держит
в одной ленте несколько брендов, хотя продаются только Loro Piana и Brunello
Cucinelli.

Правила версии:

* Удаляются альбомы шалей и квадратных платков: тип `围巾`/`丝巾`/`方巾`/
  `领巾`/`披肩`/`披巾`/`披毯`/`披风` в подписи до маркера размера
  (`尺码`/`尺寸`/`size`/`均码`/`规格`) и любой квадрат с равными сторонами
  (`尺寸95x95`). Из выгрузки так ушли `LP女士丝巾佩斯利花纹真丝羊毛方巾围巾`
  (`#73`, `#74`), `LP意式老花高级感真丝羊毛围巾` (`#75`, `#76`),
  `D迪家真丝斜纹精美印花丝巾披肩领巾 95x95` (`#149`) и набор
  `Maxmara … 披肩➕吊带` (`#72`). Обычная одежда, включая `斗篷`-пальто
  `#87`, остаётся.
* Удаляются альбомы, из которых нельзя собрать карточку: нормализованная
  подпись короче 15 знаков (пустые альбомы и обрывки вида `100%山羊绒- 🤍`)
  или меньше четырёх фото. В этой выгрузке 14 таких альбомов, и у всех
  подпись была пустой или односложной.
* Удаляются альбомы чужого бренда (`Maxmara`/`Max`/`M家`, `CELINE`, `Dior`/
  `D家`, `CHANEL`, `YSL`, `LV`, `POLO`, `HUGO BOSS`, `theory`) и альбомы без
  метки LP/BC (`no_brand`), потому что назначить им бренд нельзя.
* Оставшимся альбомам проставляется канонический id бренда текущего каталога:
  Loro Piana — `ff3b6874-53a6-4cdc-88d6-f382382484e0`, Brunello Cucinelli —
  `8fb4e194-6321-4804-b1c3-c2862b2fa095`. Метка читается в первых 30 знаках
  подписи, поэтому `🆕LP…`, `🙋🏻‍♂️BC…` и `模特图仅供参考 实物为准 BC…`
  распознаются как бренд.

Итог: 107 товаров (Loro Piana 60, Brunello Cucinelli 47), без пустого бренда,
без карточек с меньше чем четырьмя фото и с подписью короче 15 знаков — 0.
Удалены 85 альбомов: 6 шалей/платков, 14 пустых или слишком коротких, 36
чужих брендов, 29 без метки бренда. `external_id`, `source_position`, порядок,
подписи и галереи у оставшихся не менялись; повторный запуск на своём же
выводе ничего не меняет. AI-нормализация и публикация в Rails не запускались.

## LP, BC Одежда — альбомы (supplier 73)

Активная DB-backed версия `Одежда LP BC — альбомы, бренды LP/BC и цветовые
семьи v1` (`supplier_post_process_scripts`, `version=1`) применена к выгрузке
`2c2e6657-b9f7-4ae1-b217-f622c7b59481`: `1622 → 399` товаров, сырой снимок
`SCRAPED` сохранён. У поставщика включён `post_process_enabled`, а
`allowed_brand_ids` ограничен Loro Piana и Brunello Cucinelli.

Лента — альбомы Szwego; товары разделены альбомами без фото с подписью `.`
(363 штуки). Внутри такого блока альбомы с одинаковой подписью — один товар,
поэтому они склеиваются в одну карточку:

* главный альбом — первый, если у него ровно одно фото (цветовая линейка),
  иначе последний альбом блока (поставщик публикует итоговую линейку
  последней). Его `external_id`, `source_position` и описание остаются
  главными, его галерея идёт первой, затем фотографии остальных альбомов в
  исходном порядке; точные дубли URL удаляются;
* альбомы с пустой или служебной подписью (`细节`, `新色`, `美特图`,
  `爆款套装出货`) присоединяются к соседнему товару, а не выпускаются
  отдельно;
* блок без единой содержательной подписи — это независимые однокадровые
  карточки с артикулом на фото; каждая остаётся отдельным товаром;
* товары чужих брендов (`CE`, `CD`, `YSL`, `Miu`, `TB`, `self`, `mo`,
  `PRAD`) удаляются. Альбомам LP/BC сразу проставляется канонический id
  бренда (`ff3b6874-53a6-4cdc-88d6-f382382484e0` и
  `8fb4e194-6321-4804-b1c3-c2862b2fa095`); товары без метки бренда остаются
  без бренда и получают его на AI-этапе из ограниченного списка.

Цветовое семейство создаётся только для узкого случая: ровно три полных
альбома (по пять и более фото), а в подписи объявлено не меньше трёх цветов.
Такие альбомы остаются отдельными карточками с общим 32-символьным
`variant_group_key`, а второе фото каждого альбома ставится первым — первый
кадр является модельным. Для выгрузки это единственная семья: позиции `1–3`
(`LP经典坑条打底`, 6 цветов). Две неполные галереи, серия разных вещей и
одноцветная модель склеиваются в один товар.

Итог выгрузки: Loro Piana 177, Brunello Cucinelli 192, без бренда 30 (19
однокадровых карточек без подписи и 11 товаров без метки бренда), 3 карточки
цветовой семьи, максимум 38 фото у товара. Повторный запуск на том же сыром
снимке даёт тот же результат; AI-нормализация и публикация в Rails не
запускались.

## Valentino Одежда (supplier 32)

Активная DB-backed версия `Valentino Одежда — только 实物拍摄图, без повторов
v2` (`supplier_post_process_scripts`, `version=2`) применена к выгрузке
`f507f281-1381-4bf3-b328-587508c725c4`: `3206 → 294` товара, сырой снимок
`SCRAPED` не изменялся, у поставщика включён `post_process_enabled`. Версия 1
(`version=1`, 479 товаров) осталась неактивной для отката.

Лента — альбомы Szwego, товар закрывается длинным описанием (альбом 46). В
обычном блоке: 3 (иногда 6) однокадровых модельных альбома 41–43, видео 44,
галерея товара 45 (`实物拍摄图`, старые подписи `实物图`, `实物拍摄图片`,
`店内实物图`, `实拍图`, `大货实拍`), необязательный `gw`/`柜上` и описание 46.
Фото собираются в порядке: галерея товара → модель → описание → gw →
детальные галереи (`实物效果图`, `参考图`, `效果图`) → прочие lookbook
(`美图热播`, `秀场`, `主打色`, `…同款`, `…演绎`). Видео берётся из 44, обложка
видео становится постером. `external_id`/`source_position` остаются у главной
галереи, иначе у детальной.

Товар без альбома-галереи не публикуется: блоки, где единственная галерея —
`gw` или само описание, удалены (69 карточек). Повтор описания с тем же
текстом сворачивается в текущий товар; рекламный альбом
`ꫛꫀꪝ … 朋友圈折叠…` не публикуется. Повторы карточек удаляются: одинаковый
набор фото или одинаковые первый кадр и описание дают один товар, остаётся
карточка с самой большой галереей и самым длинным описанием, позиции дублей
пишутся в `album_duplicate_positions` (удалено 116 дублей у 95 карточек).
Цветовые варианты с разным первым кадром остаются отдельными.

Если внутри одного блока есть разрыв больше 6 часов и по обе стороны есть
галереи, старый блок отделяется и сохраняется отдельным товаром без описания
(`album_description_missing`); таких 17 из 294. Повторный запуск идемпотентен
(`attributes.album_merge_version = valentino-clothing-albums-2`), пустых
галерей и повторяющихся `external_id` нет. AI-нормализация и публикация в
Rails не запускались.

## Фильтр первого фото-скриншота

У поставщика появилась настройка `first_photo_screenshot_filter` (чекбокс
«Убирать вертикальные скриншоты из первого фото» в блоке пост-обработки).
Она не входит в Python-скрипт: после постобработки и до сохранения результата
сервер запрашивает у CDN уменьшенное превью первого фото
(`?imageView2/0/w/64`, около 2 КБ). Если высота превью больше ширины более
чем в 1.25 раза, первый кадр считается скриншотом официального сайта и
удаляется; остальные фото сохраняют порядок. В `attributes` записываются
`first_photo_screenshot_removed`, `first_photo_screenshot_dimensions` и
исходный URL для аудита. Товар с менее чем двумя фото не трогается; ошибка
CDN или таймаут оставляет фото на месте и только увеличивает счётчик ошибок,
поэтому выгрузка не падает. После 20 подряд ошибок или 5 минут проход
прекращается, остальные фото остаются без изменений. Запрашиваются только
URL с хостов из `AI_CATALOG_MEDIA_HOSTS` (по умолчанию
`static.yeezyunique.ru,xcimg.szwego.com`), поэтому произвольный URL из
карточки не может стать SSRF-запросом.

Фильтр применяется в Preview, в стандартном `SCRIPT_PROCESSED`-проходе и при
запуске скрипта из админки (`runCustomSupplierScriptAction`: авто-постобработка
после парсинга и кнопка запуска в выгрузке). До 2026-11-10 этот путь не читал
флаг поставщика и молча пропускал фильтр (выгрузка
`91028b96-7a42-4524-a640-6bc886fb8241`: 55 скриншотов не удалены); выгрузки,
обработанные скриптом до исправления, нужно перезапустить.

Авто-постобработка (`post_process_enabled`) запускается из колбэка завершения
парсера, уже после ответа сервера. Next запрещает там `revalidatePath`
(«used revalidatePath during render»), поэтому этот путь вызывает
`revalidatePathsSafely` из `lib/safe-revalidate.ts`: сбой ревалидации только
пишется в лог и не превращает сохранённый результат скрипта в ошибку
`Auto post-process failed`. Колонка добавляется миграцией
`npm run db:migrate:supplier-first-photo-filter`; для работы на сервере нужен
деплой AdminYeezy после миграции. На выгрузке
`a5710915-59ec-48f8-9b15-819b23e476ca` проверено 1094 товара: удалено 30
первых скриншотов (позиции `118–128` — 9 карточек, `794–800`, `945–948`,
`1132–1134`, `1215–1217`, `1808–1811`), ошибок 0; повторный замер первых фото
дал 0 вертикальных кадров.

## Мужская обувь (supplier 15)

Активная DB-backed версия `Мужская обувь — альбомы, сервисные карточки и
цветовые семьи` (`supplier_post_process_scripts`, `version=3`, id
`0fcc5381-945f-4244-a2e4-24c85fde0efb`) применена к выгрузке
`a5710915-59ec-48f8-9b15-819b23e476ca`: `2102 → 1094` товара, сырой снимок
`SCRAPED` сохранён без изменений. У поставщика включён
`post_process_enabled`; исходник версии живёт только в БД и не требует
деплоя. Отдельная настройка `first_photo_screenshot_filter` (см. раздел
«Фильтр первого фото-скриншота») требует деплоя AdminYeezy и миграции.

Лента — альбомы Szwego с номером `#` исходной позиции. Товаром считается
альбом минимум с двумя фотографиями и содержательной подписью от 80 знаков.
Однокадровые служебные альбомы (`Zegna`, `Bally`, `Prada`) и короткие
служебные подписи (`官网图`, `官网新品`, `官网售价`, `下单图`,
`Official website diagram`, `Order image`, `Display of process details` и
др.) не публикуются. В сырой выгрузке это 523 служебных подписи и 88
однокадровых альбомов; правило не требует вести список всех служебных
ярлыков, потому что настоящая подпись всегда длиннее 80 знаков.

Товары Loro Piana, Hermes, Louis Vuitton и BOSS удаляются до AI-этапа.
Проверяются и нормализованный Szwego-тег, и описание: часть карточек ошибочно
помечена `TODS` или `Sandals and slippers series`, но в подписи явно указан
Loro Piana/Hermes/LV. В выгрузке так удалены 482 карточки этих брендов.
Бренд Bally добавлен в Rails-каталог (`50b69217-488b-43f8-a204-36d5baba0c1d`,
slug `bally`); в выгрузке 66 карточек с тегом Bally.

Цветовая семья — непрерывная серия товарных альбомов; служебный или
исключённый альбом закрывает серию. Поэтому `#24–33` и `#35–39` остаются
двумя семьями, хотя их описания совпадают: между ними стоит `下单图`.
Карточки одной модели определяются по совпадению артикула (`货号`/
`产品代码`) **или** первых 300 нормализованных знаков до артикула. Это
склеивает цвета с последовательными SKU (`Bally #630/#631`) и карточки с
одной изменённой буквой в списке цветов (`Zegna #800`), но не склеивает
разные модели. Внутри семьи карточки не объединяются: каждая сохраняет
`external_id`, `source_position`, описание и галерею, а общий стабильный
32-символьный `variant_group_key`, `variant_group_name` и
`attributes.album_family_*` получают только семьи из двух и более карточек.
Итог: 255 семей на 1084 карточках, 10 одиночных товаров.

Первое фото альбомов `#794–800`, `#945–948` и ещё ряда карточек — вертикальный
скриншот официального сайта (`1080×1576…2760` против квадратных товарных
`1080×1080`/`1440×1440`). У поставщика включён
`first_photo_screenshot_filter`, поэтому media-проход удалил 30 таких первых
кадров; после повторного замера вертикальных первых фото в выгрузке 0. Сырой
снимок и порядок остальных фото не менялись; повторный запуск на своём выводе
идемпотентен. AI-нормализация и публикация в Rails не запускались.

## Balenciaga, Vetements Одежда (supplier 29)

Активная DB-backed версия «Balenciaga/Vetements Одежда — сетка, модели и бренд
по альбомам» (`bal-vtm-clothing-albums-2`, v1) живёт только в
`supplier_post_process_scripts`; файла в `scripts/parser/` нет, деплой для
правки не нужен. Версия применена к выгрузке
`040b9b9e-95dd-4dcf-95d7-7e424a042b71` (924 альбома, режим `all`): 228
товаров, сырой снимок `SCRAPED` не изменялся, к партии добавлен снимок
`SCRIPT_PROCESSED` на 228 товаров, у поставщика включён
`post_process_enabled`.

Лента Szwego идёт от новых к старым. Товар — альбом с 3+ фото (обычно 9,
устаревшие предзаказы — 3), сервисные альбомы — однокадровые: 103 размерные
сетки (`『尺码表』 …`, `尺码表！`) и 583 фото на моделях. Подпись настоящей
карточки начинается с бренда (`VTM`, `BAL`, `JIL`, `ACNE`, `FOG`, `ESS`,
`FG`, `MMJ`, `GUC`, `#JIL SANDER`); единственное исключение — `#26`, товар с
девятью фото, чья подпись всё ещё начинается с `『尺码表』`.

Ключ семьи — заголовок альбома Szwego в `attributes.szwego_tags`: у сетки,
фото на моделях и самого товара одной вещи он совпадает (`#45` сетка, `#46–48`
модели, `#49` товар — `黑色镜像字母短袖`). У альбомов до августа 2023
заголовка нет (421 альбом, 102 товара), поэтому там семья собирается по
ближайшему товарному альбому: сначала совпадение даты публикации, затем
расстояние, при равенстве выигрывает альбом, выложенный после серии (модели
поставщик публикует перед карточкой). Безымянная серия без товара в пределах
шести альбомов не прикрепляется.

Порядок галереи — как в задании оператора: фото товара, затем фото на
моделях, последней размерная сетка. На карточку прикрепляется не больше
восьми фото на моделях и одна сетка (`attributes.album_model_photos`,
`album_size_chart_photos`); повторяющиеся адреса удаляются, обложка товара
остаётся первой. Итог: 2040 фото товара + 485 фото на моделях + 112 сеток =
2733 фото, из них 141 карточка с моделями и 112 с сеткой; 650 сервисных
альбомов прикреплено, 36 не прикреплено (36 = служебные объявления
`VTM#Money印花Tee 尺码：XXS--M P248`, `VTM#条形码短袖 …` и группы без товара в
партии).

Одна группа осталась без прикрепления осознанно: `#84` сетка + `#85–87`
модели (`黑白圆圈V短袖`) — это чёрная футболка, а `#83` (`白黑圆圈V短袖`) белая
с чёрным логотипом, поэтому общий дизайн не склеивает цвета. Сетка `#14`
(`荧光绿圆圈V短袖`) прикреплена к `#10` (`荧光绿签名短袖`) по решению
оператора и по сырой картинке: коллаж `#14` — та же зелёная футболка
`HELLO my name is VETEMENTS` плюс таблица. Пары `橄榄绿印花长袖` (`#19`),
`梵文图腾短袖` (`#42`) и `黑白圆圈V短袖` (`#84–87`) остались без товара: их
альбомов в выгрузке нет.

Дубли по описанию: 18 пар на один товар. Десять из них повторяют полную
подпись, цену и размерный ряд (`VTM 签名圆领卫衣` `#533`/`#534`,
`VTM 警员圆领卫衣` `#582`/`#532`, `FOG#ESS背部logo卫衣` `#612`/`#620`,
`JIL SANDER刺绣短袖` `#640`/`#644`, `VTM 卡通动物短袖` `#852`/`#885` и др.) —
это перезалив одного альбома, они слиты, фото объединены, исходный номер
сохранён в `attributes.album_merged_duplicate_positions`. Пары с разным
наличием размеров (`限量尺码：M` против `码数XS--L`, `齐码现货` против
`码数：1.2.3.4`) оставлены двумя товарами: размерный ряд — реальные данные.

Бренд пишется детерминированно по префиксу подписи: VTM — Vetements (100),
BAL — Balenciaga (76), JIL — Jil Sander (9), ACNE — Acne Studios (3),
GUC — Gucci (1). В источнике есть ещё FOG/FG — Fear of God (24), ESS —
Fear of God Essentials (13) и MMJ — Mastermind Japan (1); этих брендов нет в
Rails-каталоге, поэтому `brand` у них пустой, а распознанное имя лежит в
`attributes.brand_name_detected`. Одна карточка (`#26`, `白色相机图标短袖`)
без бренда вовсе — в подписи его нет.

Повторный запуск идемпотентен (`attributes.album_merge_version`) и не создаёт
второй снимок `SCRIPT_PROCESSED`. AI-нормализация и публикация в Rails не
запускались.

## Верхняя мужская одежда (supplier 1)

Активная DB-backed версия «Верхняя мужская одежда — альбомы v6 (цветовые
семейства)» (`album_merge_version = albums-3`) живёт только в
`supplier_post_process_scripts`; файла в `scripts/parser/` нет, деплой для
правки не нужен. Правило применено к выгрузке
`65196f95-fefb-4ee7-a16e-8ccd2e0eb43c` (2158 альбомов): 667 товаров, сырой
снимок `SCRAPED` не изменялся, к партии добавлен снимок `SCRIPT_PROCESSED` на
667 карточек, у поставщика включён `post_process_enabled`. Предыдущая выгрузка
`56a377cc` осталась на версии v3 (683 карточки).

Лента Szwego составлена из нескольких потоков: блоки одной вещи, закрытые
разделителем `➖➖➖➖➖➖➖` (204 альбома без фото), самодостаточные альбомы с
полным описанием (`#96–317`, `#1771–1813`, `#2040–2158`), видеоленты
(`实拍视频`/`视屏实拍`) и секция `H 100%羊绒`. Внутри блока роли фиксированы:
`尺码表数据📊` — сетка (1–2 фото), `上身模特图参考#`/`上身模特参考#`/`挂拍`/`细节`/
`模特上身秀` — модельные и детальные кадры, `视频鉴赏❗️`/`实拍视频`/`视屏实拍` —
постер с `attributes.szwego_video_url`, `专柜在售<цена>w➕` — кадры из бутика.

Правила обработки:

1. Товаром становится каждая карточка с подписью от 60 символов. Блок без таких
   карточек — служебные данные и не публикуется.
2. Детальный прогон перед карточкой (не длиннее восьми альбомов) — её набор;
   прогон после последней карточки блока тоже её. Более длинные прогоны — чужие
   потоки (181-альбомная видеолента и 102/198-альбомные lookbook-блоки), они не
   присоединяются и не публикуются.
3. Карточка сохраняет `external_id` и `source_position`, её фотографии открывают
   галерею; детали идут в исходном порядке, сетка — последней; видео переносится
   как url + poster без повтора постера в галерее.
4. Сравнительные листы `面料、辅料、五金、标签…` (155) и `近看细节…` (1), скриншоты
   `对版开模/` (49), `原版开模/` (10), `GW同步…` (15), `参考图 同步发售` (1),
   `批量订单…` (3) и баннер `全码库存…` (1) удаляются.
5. Однокадровый альбом товаром не бывает: только сетка или видео.
6. Женские товары не публикуются: `裙` в названии или `女款`/`女装`/`女士`/`女式` в
   подписи — 8 карточек (`#142`, `#294`, `#468`, `#987`, `#990`, `#1581`, `#2089`,
   `#2090`).
7. Аксессуары не публикуются: `围领`, `围巾`, `帽子`, `手套`, `领带`, `袜子`,
   `球包`, `手袋`, `钱包`, `卡包`, `背包`, `腰包`, `胸包`, `旅行袋`, `行李箱`,
   `双肩包`, `托特包`, `手提包`, `单肩包` в названии — 2 карточки (`#1531`
   гольф-сумка, `#2091` воротник BV).
8. Карточка без определённого бренда не публикуется — 11 карточек (`Supreme`,
   `Courrèges`, `PHILIPP PLEIN`, `Leo Season`, `SEVEN`, `自主品牌`): этих брендов
   нет в `catalog_id_mappings`, поэтому `brand` остался бы пустым.
9. Цена: `attributes.szwego_price` (цена из карточки Szwego) умножается на 14 и
   складывается с наценкой, результат округляется вверх до 1000 (70 550 → 71 000) и
   пишется в `price`. Наценка: 50 000 ₽ до 3 000 ¥, затем линейно растёт до
   150 000 ₽ на 14 000 ¥ и продолжает расти (14 000 ¥ → 196 000 + 150 000 =
   346 000 ₽). Если хар-ки нет, та же цена берётся из маркера `P<число>` в
   подписи; если нет и его — цена 0 (по запросу). В выгрузке 585 карточек с ценой
   55 000–346 000 и 82 без цены.
10. Размеры: `attributes.sizes` из парсера, иначе разбирается строка `尺码:`
    (`S/M/L/XL`, `48/50/52/54`) — заполнено у 472 карточек.
11. Дубли: одинаковая подпись, опубликованная в разные дни, — один товар (2 пары:
    `#629/#1500`, `#744/#1517`); плюс подтверждённая оператором пара
    `_dmdrSOI8mxrUuCnLCRHJIpzpmgvxihA5cbkHjAw` /
    `_dpCrSoO7NZo4JNKIWsjTrNclWN1wK9O_gR0L0hg` (`#997/#2128`), у которой текст
    полностью переписан. Остаётся карточка с ценой, иначе более новая; недостающие
    `sizes` переносятся из удалённой. Цветовые варианты одного дня не склеиваются.
12. Цветовые семейства: подряд идущие карточки одной модели (один бренд, одна
    цена, один тип изделия, без конфликтующего слова фасона — `连帽` против
    `翻领` и т.п., без разного материала) получают общий `variant_group_key`
    (md5 от бренда и набора названий) и читаемый `variant_group_name`. Так
    собраны 41 семейство на 112 карточек: `#23/#24` Tom Ford, `#46–49` LV,
    `#84/#85` BV, ряды Hermes/Max Mara/Burberry. Цветовые варианты одного дня не
    склеиваются в один товар, но остаются одним семейством.
13. Бренд — канонический ID из `catalog_id_mappings`, диакритика складывается
    (`HERMÈS` = `Hermes`), поддержаны `LOE`, `TOMFORD`, `MaxMara`, `CH`, `BV`,
    `LP`, `BC`, `TF`, `YSL`/`SLP`, `DG`, `MM6`.
14. Повторный запуск идемпотентен: `attributes.album_merge_version`.

Итог по выгрузке: `2158 → 667` (691 карточка − 8 женских − 2 аксессуара −
11 без бренда − 3 дубля). Галереи 3–49 фото. Безымянные карточки без описания,
видеоленты и H-секция не публикуются. Дубли по фото и тексту в остальных случаях
не определяются: у перезаливов другие файлы и переписанный текст, поэтому
автоматически склеиваются только одинаковые подписи разных дней и подтверждённые
пары.

AI-нормализация и публикация в Rails не запускались.

## Мужская верхняя одежда (supplier 26)

Активная DB-backed версия «Мужская верхняя одежда — объединение альбомов v4
(чётные размеры, карточки без длинной подписи, дубли, цветовые прогоны)»
(`album_merge_version = muzh-verh-odezhda-albums-4`, md5
`a5173ef9ad8c2e356d649a57c455e5a2`) живёт только в
`supplier_post_process_scripts`; файла в `scripts/parser/` нет, деплой для
правки не нужен. Версия применена к выгрузке
`4b1e4739-530a-47cd-a376-d530ce7cd0cb` (1505 альбомов): 692 товара, сырой
снимок `SCRAPED` не изменялся, к партии добавлен один снимок
`SCRIPT_PROCESSED` на 692 карточки, у поставщика включён
`post_process_enabled` и AI-опция «поставить лучший кадр первым»
(`reorderFirstPhoto`).

Лента — обычный Szwego-поток: подпись товара от 60 символов, служебные
альбомы `官网图` (скриншоты брендового сайта), видео, `尺码表`, промо-тизеры
`真皮高定 … 持续出货`/`原版购入真品级` и фото-детали. Оператор подтвердил на
скриншотах: `#1–#4`, `#5–#9`, `#10–#15`, `#20–#21`, `#23–#25`, `#26–#28` —
по одному товару; `#16–#19` — сумки, не публиковать; `#115–#116` и
`#117–#119` — два цвета одной модели, границей служит фотоальбом деталей.

Правила обработки:

1. Подпись — описание от 60 символов, кроме промо-тизеров, сеток и аксессуаров.
   Видеоальбом становится подписью только если такого же текста нет у
   фотоальбома: 25 длинных видеоальбомов — дубли постов и остаются деталями,
   6 видео без фото-подписи публикуются как отдельные карточки.
2. Прогон подряд идущих подписей с одинаковым текстом (префикс цены и
   пунктуация игнорируются) из двух альбомов — один товар (дубль поста);
   прогон из трёх и более — цветовой ряд, каждая подпись становится отдельным
   товаром. Фотоальбом деталей между подписями всегда начинает новый прогон;
   видео, сетки, `官网图` и промо-тизеры прогон не разрывают.
3. Деталь присоединяется к группе с совпадающим артикулом (`款号` или отдельный
   код), иначе к ближайшей подписи; при равенстве — к следующей. Деталь с
   артикулом, которого нет среди подписей, но с товарным текстом (короткая
   карточка без длинного описания), становится отдельным товаром — так
   сохраняются `AG24080`, `XP2591`, `AG26911`, `FU2124` и подобные. Служебная
   деталь (`上身`, `细节`, `官网`, `实拍`, `模特`, `尺码表`) без совпадения
   артикула присоединяется к ближайшей подписи (так `#26` с чужим CR257
   попадает в CR275), а видео без подписи не публикуется.
4. Товар сохраняет описание и идентичность самой старой подписи группы
   (исходный пост; в примере оператора — `#4`). Галерея: эта подпись, затем
   остальные подписи в хронологическом порядке, затем фото-детали, затем
   `官网图`, затем сетка. Постеры видео в галерею не попадают, url видео
   сохраняются в `attributes.szwego_video_url` и
   `attributes.album_extra_video_urls`.
5. Аксессуары не публикуются: сильные существительные в первых 80 символах
   (кроме `连帽`/`可拆`/`拆卸`, чтобы не удалить куртку с капюшоном) и артикулы
   `LL*`, `AGY*`, `TF0*`. Все 23 альбома этих артикулов в выгрузке — сумки,
   ремни и чемоданы.
6. Цена: юани из подписи (цена в начале, `P<число>` или число перед
   `💰`/`！`/`!`/`（`, кроме розничных маркеров `原版`/`官网`/`专柜`/`售价`),
   умножаются на 14 и складываются с наценкой: 50 000 ₽ до 3 000 ¥, линейно до
   150 000 ₽ на 14 000 ¥, вверх до 1 000. Без цены — 0.
7. Одинаковые подписи в разных прогонах — перезалив одного товара. Они
   склеиваются в более новую карточку с ценой, галереи объединяются; склейка
   выполняется, только если общая галерея не превышает 32 фото. Цветовые ряды
   (подряд идущие товары с одинаковым текстом) не склеиваются.
8. Подряд идущие товары с одинаковым артикулом, ценой и типом изделия, чьи
   подписи отличаются только служебными фразами (`春季新款来袭`, `配送`/`配`,
   `赠送`/`送`, `更多细节`, `现货`, артикул, цифры), склеиваются в один товар.
   Цветовое слово или иное содержательное различие склейку блокирует: так
   `#354/#355` стали одной карточкой, а `#109/#110` остались разными цветами.
9. Оставшиеся подряд идущие товары с одинаковым артикулом, типом изделия и
   ценой получают общий 32-hex `variant_group_key` (цветовое семейство).
10. Карточка с более чем 32 фото помечается `attributes.album_photo_anomaly`;
    повторный запуск идемпотентен через `attributes.album_merge_version`.
11. Размеры: непрерывный числовой ряд с чётными границами (`48-56`, `46-54`)
    сокращается до чётных значений с шагом 2 (`48, 50, 52, 54, 56`); ряд с
    нечётными границами (`29-36` у皮裤, где размер —腰围) не меняется.
    В `suppliers.ai_instructions` добавлено то же правило и требование
    сохранять уже заполненное поле `sizes`.

Итог проверки: `1505 → 692` товара, 582 с ценой (69 000–199 000 ₽), 110 без
цены; 62 цветовых семейства на 179 товаров; 285 карточек с видео, 18 с
сеткой; максимальная галерея 34 фото, аномалий две. Размеры: у 546 карточек
заполнен `sizes`, у 544 ряд приведён к чётному шагу 2; единственное исключение —
`#1119` (`29-36`, размер皮裤 по腰围). Не публикуются 47
альбомов: 42 аксессуара, служебная инструкция по замерам и 4 видео без
подписи. Замечания оператора закрыты: `#52/#553` и `#227/#36` склеены как
перезаливы, `#304` больше не забирает чужие детали Margiela (`FU2124` —
отдельная карточка), `#354/#355` объединены, `#305–#309` — пять цветов одного
семейства. Скриншоты `官网图` остаются последними в галерее: их отбраковывает
AI-этап; порядок фото внутри альбома скрипт не меняет, первый кадр выбирает
AI-опция `reorderFirstPhoto`. Бренд и категория скриптом не назначаются —
это остаётся AI-этапу; размеры скрипт нормализует, AI их сохраняет.

AI-нормализация и публикация в Rails не запускались.

## N VERA (supplier 75)

Активна DB-backed версия `N VERA — альбомы, видео, комплектация и цветовые
семейства v1` (supplier 75, версия `1`). Источник — неизменённый снимок
`SCRAPED` выгрузки `c08a9530-6ae8-43ea-97d1-aceef98214c4` (1715 альбомов,
27.10.2026), проверенный по всей ленте через выделенную scraping-БД.

Лента — таймлайн модельных семейств. Семейство начинается пустым альбомом-
разделителем `➖➖➖➖➖N➖➖➖➖➖` и далее публикует: фото на модели (1 фото,
без подписи), комплектацию (4 фото, `…全系出厂标配实木FARFETCH…`), размерную
сетку (`尺码表：款号（…）` или `尺码：款号（…）`), семейное видео
(`两色/三色/五色实拍视频展示`), семейный фотоколлаж (4 фото, `…实拍图集展示`),
а затем по каждому цвету — основной альбом (9 фото, подпись начинается с
`特级外套⬆️`/`特级羽绒⬆️`, содержит цену, размерный ряд и артикул в скобках в
конце), видео цвета (`实拍视频展示`) и детали (`更多细节展示`, 9 фото, иногда
4).

Карточкой товара становится основной альбом: его `external_id`,
`source_position`, подпись и вложенные атрибуты сохраняются. Порядок галереи:
основной альбом → детали цвета → фото на модели → комплектация → размерная
сетка. Видео цвета пишется в `attributes.szwego_video_url`; если у цвета нет
своего видео, используется семейное. Семейный коллаж в галерею не добавляется —
его URL хранятся в `attributes.album_family_photo_urls`, чтобы не дублировать
чужие цвета на каждой карточке.

Фото на модели относятся к следующему основному альбому, поэтому у первого
цвета они стоят до комплектации. Бренд назначается детерминированно по
подписи (Loro Piana / Zegna / Brunello Cucinelli) каноническим ID словаря;
подпись, где бренд не найден, берёт его из сетки или комплектации. Цвета одного
семейства получают общий 32-hex `variant_group_key` (`md5` от `external_id`
разделителя), имя семейства — артикул из сетки; семейство из одного цвета ключа
не получает.

Итог Preview и применённого этапа: `1715 → 210` карточек (92 Loro Piana,
70 Zegna, 48 Brunello Cucinelli), 89 цветовых семейств (68 по два, 17 по три,
3 по четыре, 1 на пять цветов), 6 одиночных карточек без ключа; у всех 210
карточек есть бренд, видео и детали, у 203 — фото на модели; галереи 23–33
фото, дублей URL нет. Не публикуются 95 разделителей, 303 видео-альбома,
95 комплектаций, 95 сеток, 88 коллажей и служебная карточка цены. Повторный
запуск идемпотентен через `attributes.album_merge_version`; исходный снимок
`SCRAPED` сохранён, текущий этап — `SCRIPT_PROCESSED`.

AI-нормализация и публикация в Rails не запускались.

### yu_scraping, версия 09.11.2026 (v1, выгрузка 8bca9e34)

После переезда на `yu_scraping` (admin.yuconcierge.com) версия от 27.10 в
восстановленной БД отсутствовала: у поставщика 75 «N VERA» не было ни одного
скрипта, `post_process_enabled=false`, выгрузка `8bca9e34-b2df-4675-8564-5912abfb40e4`
(1886 альбомов) лежала в `SCRAPED`. Поэтому восстановлена и адаптирована
DB-версия `N VERA — альбомы, видео, комплектация и цветовые семейства v1
(09.11.2026)` (`version=1`, id `a5800f7b-ef00-4725-8eb2-cd44e1be9bc6`),
`post_process_enabled=true`.

Отличия фида 09.11 от 27.10: альбомы с фото на модели теперь подписаны именем
серии (`Loro Piana 轻薄系列`, `ZEGNA羽绒服系列`), разделитель тоже содержит
серию, комплектация начинается с маркера наценки `（➕50）`. Скрипт распознаёт
такие однокадровые альбомы как фото на модели, а карточку `官网售价` и
предупреждение `⚠️ 重要提醒` — как служебные.

Бренды пишутся каноническими UUID восстановленной БД из `catalog_id_mappings`:
Loro Piana `0ea28040-c9e9-4bdd-846a-f67f9d1e22bf`, Zegna
`26d40cfe-d180-43bf-b2bf-a526141d58f5`, Brunello Cucinelli
`6ad1b097-ee24-4282-be3e-b644fb9be8fa`. Старые короткие/прежние UUID из ленты
27.10 в этой БД недействительны.

Результат Preview и применённого этапа: `1886 → 245` карточек (Loro Piana 112,
Zegna 78, Brunello Cucinelli 55), 101 цветовое семейство (70 по два, 27 по три,
3 по четыре, 1 на пять цветов), 7 одиночных без ключа, у всех 245 есть бренд,
видео и детали, у 203 — фото на модели; галереи 23–33 фото. Не публикуются
109 разделителей, 351 видео-альбом, 108 комплектаций, 108 сеток, 100 коллажей
и 2 служебные карточки. Повторный запуск идемпотентен через
`attributes.album_merge_version`; снимок `SCRAPED` сохранён, этап —
`SCRIPT_PROCESSED`. AI-нормализация и публикация в Rails не запускались.
