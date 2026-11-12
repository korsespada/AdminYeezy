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

## Chanel Сумки (supplier 39)

Для поставщика активна DB-backed версия `chanel_bags_tt.py` (v3, с
2026-11-10; v1 — сборка альбомов, v2 — цветовые семьи, v3 — защита от склейки
через паузы). Она заменяет legacy-файл `process_chanel_bags_timeline.py`,
который на текущей ленте оставлял 14 карточек из 5372. Лента идёт от новых
карточек к старым; один товар — это серия карточек подряд:

- **новый формат (с октября 2026):** одиночки-модель → `穿搭展示` (альбом на
  модели) → [одиночки-замеры] → видео → основной (3–6 студийных фото) →
  [одиночки-дубли] → альбом деталей (9 фото, `尺寸`/`五金`) → [одиночки-замеры]
  → [второй альбом `尺寸`] → `包装展示`;
- **старый формат (до сентября 2026):** одиночки-модель → `包装展示` → видео →
  альбом деталей (9 фото, `尺寸`) → основной (4 фото).

Правила, проверенные визуально на выгрузке `d18e02f8`:

1. Товар — это минимум два текстовых альбома (основной и детали).
   `external_id` и `source_position` берутся у основного. Формат блока
   определяется по первому текстовому альбому: 7 и больше фото — старый формат.
2. Порядок фото: основной → альбомы деталей → упаковка → фото на модели.
   Описание: основной текст → тексты деталей → строка `背法…` из `穿搭展示`.
3. Одиночки без текста (1 фото) в новом формате удаляются: перед `穿搭展示` они
   повторяют сам альбом, между основным и деталями повторяют альбом деталей,
   а после деталей и после `穿搭展示` — это замеры с китайским текстом.
   В старом формате одиночки прямо перед `包装展示` — уникальные фото на модели
   следующего товара; они идут в конец галереи.
4. Блок заканчивается на `包装展示` и на альбоме на модели (`穿搭展示`,
   `上包展示`). Новый товар начинают:
   - второе видео в блоке или видео после паузы больше 10 минут;
   - текстовый альбом через час и больше после предыдущего текстового альбома
     или видео (одиночки этот отсчёт не сбрасывают; альбомы одного товара
     выкладываются в пределах ~30 минут);
   - третий текстовый альбом в старом формате (там ровно детали + основной);
   - альбом с другим кодом модели в начале текста (`26p`, `25c`, `cf23`, `woc`).
5. Удаляются: посты разработки (`首版`, `头版`, `产前第一版`, `最终版`, `大货`,
   `新品筹备`, `原版实拍`, `对皮`, `开版`, `测量数据`, `同台/同框` и т.п.),
   `合集/集合`, подвески и
   аксессуары, видео с рекламным текстом, текстовые карточки с 1–2 фото
   (заголовки серий) и одиночные альбомы без пары (в основном картхолдеры).
   Фраза `与zp一致` в описании деталей — заявление о качестве, а не мусор.
6. Повторный запуск идемпотентен: карточки, у которых
   `attributes.album_merge_version` начинается с `chanel-bags-tt-`, проходят без
   пересборки, им только заново считаются семьи. В
   `attributes.album_source_positions` записаны позиции всех исходных карточек.
7. Цветовые семьи. Первая строка альбома с `尺寸：<размеры>` имеет вид
   «код + модель + цвет + фурнитура» (`cf23羊枣红浅金`, `26p 保龄球黑`). Слова цвета
   (`黑`, `酒红`, `浅米`, `高级灰`, `卡其绿`, …) отбрасываются. Семью образуют
   бренд + основа модели + цвет фурнитуры (`金`/`浅金`/`银`/`古金`/`枪色`;
   пусто, если в подписи фурнитуры нет) + точные размеры. Семья — это минимум
   два товара и минимум два разных цвета; им ставится общий md5
   `variant_group_key` и имя вида `Chanel cf23羊 浅金 14.5x23x6`. Если цвет
   не распознан, товар остаётся без семьи. Поэтому `cf23羊黑金` и
   `cf23羊黑银` — разные семьи, а `26b lp蜥蜴银` (серебристая кожа) не
   считается фурнитурой. Галереи, `external_id` и `source_position` у каждого
   цвета свои. Повтор одного цвета в семье (поставщик выложил товар дважды)
   не удаляется.

Результат v3 на выгрузке `d18e02f8` (5372 сырые карточки): 651 товар, у 645
есть видео, у 590 — упаковка, у 249 — фото на модели; 113 цветовых семей
покрывают 374 товара. Сама выгрузка была обработана версией v1 (без семей),
поэтому семьи появятся после повторного запуска шага постобработки.

### Legacy: process_chanel_bags_timeline.py

Описание ниже относится к старому файлу. Он используется, только если у
поставщика нет активной DB-версии.

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

## LV Сумки, кошельки (supplier 48)

Активная версия — `LV сумки — альбомы, видео, габариты и цветовые семьи v1
(11.11.2026)`, маркер `lv-albums-1`, выгрузка `2eac023e` (`1 188` альбомов).
Исходник хранится в `supplier_post_process_scripts`; локального файла нет.
Прежний `process_lv_bags_timeline.py` остаётся только историческим fallback —
активная DB-версия имеет приоритет.

Лента Szwego (новые сверху) публикует один товар всплеском карточек, и раскладка
менялась: осенью 2026 — `[фото на модели] [упаковка] видео ЛУКБУК(4)
ОСНОВНОЙ(9–12) упаковка`, весной 2026 — `упаковка видео ОСНОВНОЙ ЛУКБУК`,
в 2025 — `видео ОСНОВНОЙ упаковка`. ЛУКБУК — альбом на 3–5 фото без артикула,
ОСНОВНОЙ — альбом на 6–15 фото с `款号` и `尺寸`.

Товарный блок собирается динамическим программированием по всей ленте: в блоке
ровно один ОСНОВНОЙ альбом, а видео, упаковка, ЛУКБУК и одиночные фото на модели
притягиваются к ближайшему альбому по позиции; споры между соседними товарами
решает `szwego_timestamp` (всплеск одного поста). Идентичность карточки —
первый товарный альбом блока (`external_id`, `source_position`). Порядок фото:
ЛУКБУК → ОСНОВНОЙ (первый кадр удаляется, когда ЛУКБУК идёт раньше и повторяет
обложку) → упаковка → одиночные фото на модели. Видео остаётся в
`attributes.szwego_video_url` и отдельным товаром не выходит. Описание — строка
ОСНОВНОГО альбома, затем текст ЛУКБУКА.

Не выпускаются: разделители `合集`/`集合`, рекламные и сравнительные посты
(`清仓`, `🆚`, `原版细节实拍`, `首款升级`, `新品筹备`/`开发准备`), а также кулоны
`包饰` и брелоки `钥匙扣`. Точные повторы одной модели, цвета и габаритов
(разные артикулы одного поста) схлопываются в более свежую карточку: в выгрузке
так удалены `#360` и `#217`.

Габариты из `尺寸` сразу пишутся в `attributes.dimensions` в виде
`Ш × В × Г см` (запятая в дробях, пара `Ш × В см` допустима). Кошельки,
картхолдеры, обложки на паспорт и чехлы для телефона получают категорию
`Аксессуары` и соответствующую подкатегорию (`Кошельки и картхолдеры`,
`Обложки для паспорта`, `Чехлы для телефона`) ещё до AI-этапа.

Цветовая семья строится по строке `<модель>-<цвет> 款号… 尺寸…`: основа модели,
точные габариты и бренд дают стабильный 32-hex `variant_group_key`. Нужны два и
более товара минимум с двумя разными цветами; галереи, `external_id` и
`source_position` остаются у каждого цвета, ничего не склеивается. Разный порядок
чисел в габаритах или разное написание модели семью не собирает.

Выгрузка `2eac023e`: `1 188 → 272` карточки, `271` с видео, `52` цветовые семьи
на `130` карточках. Примеры оператора воспроизводятся точно: `#8` = фото `#8`,
детали `#10` без первого кадра, упаковка `#11`, видео `#9`; `#32` = фото `#32`,
детали `#33` без первого кадра, упаковка `#34`, фото на модели `#28–#30`, видео
`#31`. Результат идемпотентен, исходный снимок `SCRAPED` не изменяется.

Публикация этой выгрузки сначала падала на проверке цветовых семей: ИИ
проставляет `hardware_color` и `bag_width_cm`/`bag_height_cm` отдельно каждому
цвету, и у LV фурнитура у цветов действительно бывает золотой и серебряной
(12 семей), а ширина/высота иногда читаются с перестановкой. Поставщик `48`
добавлен в `app_settings.family_check_skip_suppliers` (`[3,48]`): конфликты
пишутся предупреждением `[batch-publish]`, публикация продолжается, карточки
сохраняют свой цвет фурнитуры. `bag_width_cm`/`bag_height_cm` внутри семей
выровнены по самому частому значению, `dimensions` не расходится с постобработкой.
В `suppliers.ai_instructions` добавлено правило: кошельки, картхолдеры, обложки
на паспорт и чехлы для телефона — «Аксессуары» со своими подкатегориями, не
«Сумки», и подтверждённые габариты не пересчитывать.

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

DB-backed version 2 (active). The source lives in
`supplier_post_process_scripts`; nothing is committed under `scripts/parser/`.
Evidence is the immutable `SCRAPED` snapshot of batch
`e4a7bb8b-0be7-47a6-b638-987e03a567da` — 8992 albums, feed 2026-07-01 ..
2026-11-10, 1075 cards.

The feed is newest-first and publishes a product as one burst of albums: the
one-photo price/size card (`2190💰CD手工立体钉珠领口拼接羊绒廓形大衣`), then
on-model albums (`造型 搭配`, `ZG Show`, `搭配look`), service albums (`GW`,
`ZG`, `大图`, `大图 细节`, `领口 细节`, `双色之选`, `水洗唛工艺细节`,
`可加配 防尘袋`), then the detail albums with real detail text, and finally the
branded product album (`DIO 26S 手工立体钉珠领口拼接羊绒廓形大衣 甄选…`).
Because the branded album is always the *last* album of its burst, the burst
after the previous closing album and up to it belongs to that card.

Gallery order is fixed: branded album → all consecutive detail albums (feed
order) → the first styling album (`造型`/`搭配`, at least two photos, `ZG`,
`Show` and `大图` albums do not count) → the price/size-card photo last. The
detail texts are appended to the description; `name` is never written — the AI
stage names the card. A burst is bounded by its price card, its branded album,
a season-coded card of a brandless designer product, and by any eyewear album,
so a pair of sunglasses can never glue two clothing products into one gallery.

Scarves (`围巾`, `围脖`, `披肩`), hats (`棒球帽`, `冷帽`, `针织帽` …), caps and
gloves are written to the `Аксессуары` category
(`1bd865aa-f058-4db2-aeb7-8e9bc7d191dd`); they are recognised by the head noun
that ends the price-card title (`5990💰…真丝围巾`), so a coat with a `围巾领`
or a hooded `连帽` jacket stays clothing. Every other card keeps the
supplier's `Одежда` category. 14 cards of this batch are accessories.

The brand is resolved from the branded album's leading code — `DIO`/`CD`,
`CHA`/`双C`, `HER`/`H`, `LOUIS`, `MIU`, `PRA`/`PD`, `BC`, `CEL`, `GUC`/`GG`,
`FEN`/`FF`, `Loro Pia`/`LP`, `YSL`, `VALEN`/`VT`, `CHO`, `Anc`/`Acne`, `LOW`,
`MON`, `THE RO`, `MM6`, `ES`, `BAL`, `加拿大鹅`, `Ralph L拉夫`/`RL拉夫`,
`BVLG`, `D&G`, `Isadel`, `BUR`, `BV`, `AW`, `LEMAI`, `DVN` — to the
canonical `catalog_id_mappings` id, with the readable name and matched alias in
`attributes.brand_name`/`attributes.brand_alias`. The code has to stand alone
(`双C撞色胸针 黑白格纹…` is a detail album, not a Chanel card), and a burst
whose closing album has no brand code — designer `设计师` cards, the
supplier's own unbranded `TR` shoes, `65💰加配H…防尘袋` add-ons — is not
published. Eyewear (`GM`, `GG`, `BVLG` sunglasses) and Chrome Hearts are not
published at all.

Reposts are deduped on brand plus the *branded album caption* (not the merged
description, which carries the burst's detail texts and differs between
copies): 79 extra copies return days or weeks later under the same title and
price with another photo set, and only the newest copy is kept, its dropped
positions recorded in `attributes.album_dedup_positions`. The same title with a
*different* caption (`#421` grey vs `#428` oatmeal) is a colour variant, not a
repost, and stays a separate card with its own gallery and `external_id`. Cards
are recorded with `attributes.album_merge_version`, `album_source_positions`,
`price_card_source_id`, `size_chart_source_position`, `model_source_position`
and `detail_source_positions`; a second run returns the input unchanged.

### Legacy: process_womens_clothing_5.py

The committed `scripts/parser/process_womens_clothing_5.py` remains the
fallback while a supplier has no active DB version. It merged the season-coded
product album with up to two nearby detail albums, appended the size-card photo
last, never attached on-model photos, dropped cards without a recognised brand
and removed a first photo shared by two cards. Its brand list used the old
`filter_task_152.py` ids, so the current version replaces it.

## Женская одежда 2

The DB-backed post-process for `Женская одежда ZP 2` reads the supplier's
newest-first timeline of separator blocks. Every block opens with a photo-less
`✨✨✨ ✨✨分割线✨✨✨ ✨✨ <tag>` card and then holds, in feed order, up to six
bare single-photo model cards, the nine-photo `模特图。` lookbook, the one-photo
`尺码表。` chart, the nine-photo `默认软包发货 如需全套包装➕30💰` packaging
album, the nine-photo `随意实拍` product gallery, the nine-photo `挂拍对比图🆚`
comparison album and the nine-photo `<price>💰<BRAND>顶版出货 … 码数：…`
description album.

A catalogue product is every `随意实拍` album. Separators, bare single-photo
cards, `挂拍对比图` and the description album never become products: batch
`c3cd7c39-c4a3-4622-bfaf-677bc5f91991` holds 1606 albums and yields 139 cards.

Gallery order is fixed: the 9 gallery photos, then the block's 9 lookbook
photos, then the first 3 packaging photos, then the size chart last, so a card
has 22 photos. A block without the lookbook album (`扣肩无袖连衣裙`) yields 13
photos and a block without the packaging album (`蓝色老花短裤`) 19; a missing
service album is skipped, never filled from a neighbouring block.

The description album is the block's album with `顶版出货`/`码数`; its raw
multi-line text becomes the product description. The brand is the token between
`💰` and `顶版出货` (`LOUIS VUITTON`, `MIUMIU`, `PRADA`, `Dior`, `LOEWE`,
`Celine`, `CHANEL`, `GUCCI`, `Acne`, `FENDI`, `YSL`), mapped to the canonical
`catalog_id_mappings` brand id and written to `brand`, with the readable name
and raw alias in `attributes.brand_name`/`attributes.brand_alias`. All 121
blocks of the batch resolve a brand.

Two or more `随意实拍` albums in one block are colour variants of one model: 17
blocks hold 2–3 galleries (35 cards). Each gallery stays its own card and keeps
its `external_id` and `source_position`; the members share a
`variant_group_key` = md5(`64|<description album external_id>`) and a readable
`variant_group_name` such as `Dior 两色刺绣短衫`. The description album is the
family anchor because the tag alone is not unique over time (`两色短袖` is
reused) and a later repost must not merge with a different price. All 17
multi-gallery blocks were checked visually: each is one model in 2–3 colours,
including the three-colour `三色大标衫` (Celine) and the two washed-denim
`两色做旧背心` (Acne Studios).

Identity stays with the gallery: `external_id`, `source_position`, name, price
and status are never taken from a service album. Attached album ids are recorded
as `attributes.description_source_id`, `model_source_id`,
`packaging_source_id` and `size_chart_source_id`, the used positions as
`attributes.album_source_positions`, and `attributes.album_merge_version`
(`zp2_blocks_v1`) makes a second run return the cards unchanged. An album is
attached only when its block holds exactly one such card (or one per gallery);
ambiguous service cards are left unattached instead of guessed from adjacency.

## Одежда МЖ 2

The supplier publishes one catalogue product as a *run* of consecutive Szwego
albums that all carry the same product tag (`（无标）miu灰色水钻翻领卫衣`). The
active DB-backed version `v3: цветовые семьи, без Chrome Hearts, VT=Valentino,
бренд по тегу` reads that run instead of a single target album. A run becomes a
product only when it contains the detail album `【实拍图一组】`; photo-less
caption albums (`-`, `⚠️货期…`) never become products.

Inside a run the albums have fixed roles:

- `新品现货` / `翻单现货` / `独家现货` / `补单现货` / `补货现货` / `返单现货`
  and `新品预告` / `新品上架` — the clean stock shot of the item;
- `【实拍图一组】` — exactly nine detail photos (216 albums of batch
  `8241cef1-b037-4aff-9965-5c5cbca9c6b8`, 73 of batch `d9beef37…`);
- `尺码表`/`尺寸表` — the size chart, always one photo;
- `Compare …对比` / `…对比🆚` — technical blocks (fabric, trims, print, buttons);
- `💲原版购买凭证` — a purchase-proof screenshot;
- `特写` — a macro close-up that belongs to the comparison set;
- all other albums — model/lookbook shots with marketing captions only.

The stock-album marker was widened after the supplier renamed it: in batch
`8241cef1…` the feed holds 263 `新品现货`, 5 `补单现货`, 1 `翻单现货`,
1 `独家现货`, 1 `补货现货` and 1 `返单现货` album, and a bare `现货` is never
accepted because it also appears inside `搭配参考 现货`.

Gallery order is fixed: the clean stock shot first, then the nine detail
photos, then up to `MAX_LOOKBOOK_PHOTOS` (8) lookbook photos in source order,
then the size chart last. The batch opener `超多新品现货 火爆接单中`, every
comparison album (`Compare`, `对比`, `🆚`, `特写`) and every receipt album
contribute no photos, so a gallery holds 15–19 photos instead of the 113 raw
photos of the largest run.

The description is the product name followed by the technical blocks only:
captions matching `Compare`/`对比`/`🆚`/`防伪点` after normalisation and tag
removal. The name comes from the product tag; when the tag is empty the detail
caption is used instead with the `【实拍图一组】` marker removed. Marketing,
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

### Tags are mandatory

The run key is the Szwego product tag, so the source batch must be scraped with
`parse_tags_enabled` (`--parse_tags`); otherwise every card has an empty
`attributes.szwego_tags` and the runs cannot be separated. Batch
`8241cef1-b037-4aff-9965-5c5cbca9c6b8` was scraped without tags (6,169 albums,
zero `szwego_tags`) after the scraping database was recreated on 2026-11-07, so
the processor now raises an explicit error instead of returning an empty
product list, which would have wiped the batch. The supplier flags
`post_process_enabled` and `parse_tags_enabled` were both off after that
recreation and were turned back on together with the active version.

Validation on the new feed shape (6,169 albums, tags derived from each stock
album because the re-export was not available yet): 216 detail albums, 295 stock
albums, 270 size charts, 714 comparison albums, 242 receipts; 195 products with
15–19 photos, 20 colour families over 44 cards.

The re-exported batch `29543e9a-fb92-4f46-a8af-2854c67efbd0` arrived with tags
(5,765 of 6,169 albums carry `szwego_tags`) and the automatic post-process ran
the active version: `6,169 → 200` products, 14–19 photos, 21 colour families
over 46 cards, no Chrome Hearts card, every gallery starting with its stock shot
and ending with its size chart.

### Brand vocabulary and canonical ids

The recreated scraping database holds only canonical Rails brand ids in
`catalog_id_mappings` (154 rows, no legacy short ids), so the previous
`cn386fag2q87srw`-style ids resolved to an empty brand and all 200 products lost
their brand. `BRAND_DATA` now uses the canonical UUIDs, and the brand aliases
were widened to the spellings this feed actually uses: `Gu7`/`G7` → Gucci,
`Pra` → Prada, `Acn` → Acne Studios, `LP` → Loro Piana,
`Blsj`/`BL`/`巴黎世家` → Balenciaga, `Mon` → Moncler, plus `SLP` → Saint Laurent.
On batch `29543e9a…` this leaves 0 of 200 products without a brand: Miu Miu 57,
Loewe 29, Gucci 18, Louis Vuitton 17, Celine 16, Prada 14, Acne Studios 9,
Brunello Cucinelli 9, Burberry 8, Dior 6, Valentino 6, Balenciaga 5, Moncler 4,
Loro Piana 2.

Only `brand` and `name` were corrected on that batch; photos, descriptions,
`source_position` and colour-family keys were diffed against the freshly
computed result and are identical. The `SCRIPT_PROCESSED` snapshot was rewritten
from the corrected rows so the pre-AI restore point matches the products.


## Одежда МЖ

### Версия 2 (активна): блоки по сепараторам

С 10.11.2026 активна DB-backed версия 2 `Одежда МЖ — блоки по сепараторам:
основной + 细节实拍 + фото на модели, бренды v2` (маркер
`attributes.album_merge_version = mzh_sep_blocks_v2`). Выгрузка
`880f95d9-1b57-4bb5-a5fb-f709335b6c7c` пришла без `szwego_tags`, поэтому v1
(привязка по тегам) на ней не работает.

Лента идёт от новых к старым, каждый товар — блок, который открывается
альбомом-сепаратором: не больше одного фото, без видео и без текста (сердечко,
логотип, полоска эмодзи, `-` или вовсе без фото). Внутри блока: первым идёт
альбом фото на модели, затем маркетинг, официальные описания и посты о
разработке, затем один или несколько альбомов `细节实拍`, затем основной альбом
с названием, размерами и `款号`/`现货抢购`.

Правила:

- Товар — группа карточек внутри блока с одинаковым названием модели и цвета
  (текст до маркеров `细节`, `现货`, `款号`, размерного ряда). Бренд в названии
  нормализуется (`Miumiu` и `Miu` — один бренд). Группа становится товаром
  только при наличии основного альбома или `细节实拍`.
- В одном блоке может быть несколько товаров (комплект: куртка и брюки) или
  один товар из нескольких частей под одним названием (костюм-тройка,
  двусторонняя куртка с парой «детали + основной» на каждую часть) — такие
  части собираются в один товар.
- Детали с другим цветом в подписи (детали `-白色`, основной `-豆绿色（不是纯白）`)
  присоединяются к единственному основному альбому той же модели в блоке; `细节实拍`
  без названия — к карточке сразу после него.
- Идентичность (`external_id`, `source_position`, описание) — у первого
  основного альбома группы; если основного нет, у последнего `细节实拍`.
- Порядок фото: основные альбомы, `细节实拍` (по порядку ленты), затем первый
  альбом блока с фото на модели. Он не берётся, если это видео или подпись
  указывает на разработку, сравнение, ткань, официальный сайт (`官网`, `开发`,
  `对比`, `YB`, `原版`, `材料`, `采用`, `本款`, `走线` и др.) или это
  официальная карточка бренда с `男款`/`女款`.
- Прочие альбомы (маркетинг, `同款` знаменитостей, официальные фото, видео,
  разработка) не публикуются.
- Бренд берётся из префикса названия и пишется в `brand` каноническим id из
  `catalog_id_mappings`; имя бренда — в `attributes.post_process_brand_name`.
  Сокращения поставщика: `L4` — Louis Vuitton, `CD`/`D1or` — Dior,
  `Miu`/`Miumiu` — Miu Miu, `BL`/`BLCG`/`BAL.COM` — Balenciaga, `PD` — Prada,
  `BV` — Bottega Veneta, `BC` — Brunello Cucinelli, `BBR` — Burberry,
  `Gu`/`Gu7` — Gucci, `MGL` — Maison Margiela.
- Chrome Hearts (`CH`, `克罗心`, `Chrome Hearts`) по-прежнему не публикуется.
- Цветовая семья: тот же бренд и модель, минимум две разные цветовые метки
  после `-`; ключ — md5 `brand id | модель`.
- Источники записываются в `attributes.album_source_positions`,
  `attributes.post_process_detail_source_ids` и
  `attributes.post_process_lookbook_source_id`. Повторный запуск возвращает
  карточки с маркером `mzh_` (и `mzh_post_process_v1`) без изменений.

На выгрузке `880f95d9…`: `1867 → 289` товаров, у всех бренд (Louis Vuitton 96,
Miu Miu 65, Dior 42, Balenciaga 28, Prada 19, Bottega Veneta 12, Loewe 9,
Gucci 5, Brunello Cucinelli 5, Burberry 4, Maison Margiela 2, Celine 1,
The Row 1), фото на модели у 260, 18 цветовых семей на 40 товарах, товары
Chrome Hearts исключены. Пример из блока #1–#6: товар #6 = фото #6,
затем #5 (`细节实拍`), затем #2 (на модели). Версия сохранена без запуска
стадии; партия осталась в `SCRAPED`.

### Версия 1 (неактивна): альбомы с артикулом по тегам

Версия `Одежда МЖ — альбомы с
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

The active rule for supplier 20 is DB-backed version 2
`zhenskaya_odezhda_3_albums.py` in `supplier_post_process_scripts`; the
committed `scripts/parser/process_womens_clothing_3.py` is only the legacy
fallback. The feed publishes every product as one block opened by a photo-less
`•••提莫·TIMO (只做Zp研发)•••` separator.

Inside a block the fixed order is: six one-photo lookbook cards (exact URL
duplicates of the model album), `下单尺寸表～` (one photo), `模特上身效果图~`,
`出口老外订单…`, `从买版到开发…`, `常规发货…`, `➕30💰可配全套包装…`, the
product albums `不吹嘘多么的好…`, the detail albums `真实不调色…`, and the
closing description album `<price>💰<brand>…`. The product albums start after
the whole-packaging album, so a stock packaging card that the supplier
mislabelled `不吹嘘` in the shipping slot of one block stays out.

Every `不吹嘘` album is one catalogue card (one colour): it keeps its own
`external_id` and `source_position`, gets the detail album with the same index,
the reverse-album model photos and the size chart last, and takes the text,
`attributes.szwego_price` and the Rails brand id from the closing description
album. Model albums are attributed per colour only when their count equals the
product count; otherwise every card of the block receives all of them. The six
lookbook singles, `出口老外订单`, `从买版到开发`, `常规发货` and
`➕30💰可配全套包装` are stock or text-overlaid and stay out. Two blocks with
only a detail album use it as the gallery.

Brand detection reads the description album (Latin and Chinese aliases of the
50 catalogue brands) and writes the current Rails brand id taken from
`catalog_id_mappings` (synced 2026-11-11; the ids used by the previous rule
belonged to the retired catalogue and no longer name any brand); the
Chrome Hearts block is skipped unconditionally, and a block without a
recognisable brand is skipped. Colour variants of one model
share a 32-hex `variant_group_key` = md5 of the brand id and the full caption
(the price stays inside the signature: a repost after a price change is not one
family and the publication check requires one price per family) and a readable
`variant_group_name`; families need at least two cards. Audit data lives in
`attributes.album_merge_version`, `album_source_positions`,
`description_source_id`, `size_chart_source_id` and `album_family_*`; a second
run on processed cards is a pass-through keyed on the merge marker prefix.

For batch `f34a3c29-b04f-4b84-a7b2-caddfec715cb` the rule gives
`11506 → 747` cards: 80 Chrome Hearts cards skipped, 227 cards in 104 colour
families, 28 photos on a normal card (9 product + 9 detail + 9 model + 1 size
chart), 37 when a card takes two model albums, and 19–25 when the block's model
album is shorter.
The `SCRAPED` snapshot is untouched; the batch was re-run after the brand id
update and now holds 747 `SCRIPT_PROCESSED` cards with the current brand ids and
104 colour families, without AI processing.

## Женская одежда ZP

The DB-backed post-process for `Женская одежда ZP` turns each newest-first
service run into one product per substantial `P<number>` album. A product is a
description starting with `P<number>` with at least eight photos; the card
keeps its own `external_id`, `source_position`, name, description, price and
status.

A run is the stretch between the previous `P` card and the current one. Cards
in the run are attached only when they are within 30 minutes of the product and
carry a short visual caption (at most 20 characters): `look`, `搭配`, `上身图`,
`模特图`, `专柜图`, `GW图`, `官网图`, `展示图`, `明星图`, celebrity names,
`OOTD`, etc. Long product-description albums, empty captions, packaging
(`重金打造...`) and soft-pack (`常规发货...`) cards are not emitted; a card with
another recognised brand is also skipped. Cards without a recognised brand and
all Chrome Hearts cards are dropped. Scarves, gloves, hats and caps are
written to the catalog category `Аксессуары`
(`1bd865aa-f058-4db2-aeb7-8e9bc7d191dd`); the supplier's allowed categories now
include both `Одежда` and `Аксессуары`. Bags and jewellery are not
reclassified by this script.

Photo order is the product gallery with its last photo moved to second place
(front, back, details), then the attached visual albums in feed order, then the
one-photo `尺码表`/size chart last. If a run has several size charts, the last
one is used. Exact duplicate URLs are removed.

The brand is read from the description with the ZP aliases (`Chane*`, `Dio*`,
`MiuMi*`, `Prad*`, `L*`, `LP`, `BC`, `Moncler`/`Mon*`, `Loew*`, ...), choosing
the alias that appears earliest, and written as the current canonical
`catalog_id_mappings` brand UUID plus `attributes.brand_name` and
`attributes.brand_alias`. All 1,008 emitted cards resolve a brand; the 13
cards without a brand and the 12 Chrome Hearts cards are dropped.

Colour families: products share a 32-hex `variant_group_key` (md5 of the brand
UUID and the description after removing the `P` marker and colour words) and a
readable `variant_group_name` when their first explicit colours differ.
Batch `bea1ef37-6603-4dd7-b122-6e9072b16d9f` yields 17 families / 41 products,
including `#295`/`#299` Loro Piana cashmere polos. Galleries and identities are
never merged.

The processor writes `attributes.album_merge_version` (`zp_women_blocks_v1`),
`album_source_positions`, `album_source_ids`, `model_source_ids`,
`size_chart_source_id`, and for families `color_family_source_ids`. A second
run returns the cards unchanged.

For batch `bea1ef37-6603-4dd7-b122-6e9072b16d9f`: 4,178 raw albums -> 1,008
products; 923 size charts and 1,129 short visual albums were attached; 751
packaging and 72 soft-pack albums were dropped; six `P` cards with fewer than
eight photos (hats, bag charms, one duplicate one-photo vest) were not emitted.
61 products are in `Аксессуары`: 30 scarves, 25 hats/caps and 6 gloves.

The ZP supplier AI instruction treats the leading `P<number>` as a source
price marker rather than a public price. Product photos are analysed through
the standard 3-by-3 contact sheets, with optional full-size refinement for
ambiguous frames. Size charts remain technical evidence for sizes and
measurements, and reversible garments remain one product when both sides show
the same item. ZP uses the nine price-rule records and the price instruction
list copied from `Женская одежда 3`; the price mapping is kept outside the
supplier text prompt.

## Обувь

Active version — `Обувь: альбомы, видео и цветовые семьи v3 (11.11.2026)`,
marker `obuv-albums-3`, batch `583c7319` (`17 424` albums).

The Szwego all-timeline stream is one model group after another. A group is
closed by the *separator* album: a single photo, an empty caption and the same
fixed placeholder image on every posting (album `17` in the operator's grid).
Bare singles look identical in the data — one photo, empty caption — but they
are the covers of the detail albums below them, so the separator is recognised
by its photo URL (the known key, plus any single-photo caption-less URL that
repeats more than fifty times), never by shape alone.

Inside a group the roles are fixed: intro caption (`Brand*｜model`), video card,
size chart (`N码为例`), lookbook album (`新款分享`/`上脚分享`/`细节图`), bare
singles, then the detail albums. Only a detail album becomes a product — eight
or more photos and a `💰`/`￥` price line. The price marker replaced the earlier
200-character gate, which was throwing away about 1 700 real cards while a
lookbook album of the same nine photos never carries a price.

The video is scoped to the model group, not to the separator block, because the
supplier sometimes starts a new model without posting a separator. A group ends
at the separator, at the next caption that names a model, or after a pause of
more than an hour (15 114 consecutive cards sit under 30 minutes, only 26 gaps
reach an hour). Each product takes the first video posted after its group
header, which also skips the later `原版对比实拍视频` comparison clips.

The brand is the token the supplier truncates in front of `*` (`Chane` → Chanel,
`Bottega Venet` → Bottega Veneta, `Prada*`). When the caption opens with a
Chinese marketing word (`代购级别 Loro Piana …`) or a generic first line
(`代购级`, `顶级代购版本`), the catalogue name is read from the first two lines
instead. A match is an exact or unique prefix of a `catalog_id_mappings` brand
name after accent and case folding, so a `*` token that does not resolve drops
the card rather than guessing a neighbour's brand. Shortened or typo tokens are
listed explicitly: `Al` → Alo, `GGD` → Golden Goose, `LP` → Loro Piana,
`Unfoil` → Unfolio, `Saintlauran` → Saint Laurent, `13DE MARZ` → 13 DEMARZO.

The operator then cut the long tail on 11.11.2026. Hermes (96 cards) is not
published from this feed although the brand stays in the catalogue for the other
suppliers, and the Loro Piana Openwalk and Summerwalk models are dropped too (30
cards — the `openwalk` and `LP summer` captions). A brand also needs at least
five cards in a run: anything smaller is dropped, so one-off names never reach
the catalogue. The eighteen brands that appeared only in this batch with two to
four cards (13 DEMARZO, ABRA, Aeyde, Ann Andelman, Benci Brothers, Birkenstock,
Carven, Casadei, Elia Maurizi, Hogan, ICE DUST, IIIVIVINIKO, ORINOU, Pierre
Hardy, Puma, SMFK, Versace, untitlab) were removed from `catalog_id_mappings`
and from the processor's embedded brand table, so they can never resolve again.
Acne Studios and Salomon stay: other batches carry 157 and 25 of their cards, so
only their five cards here are dropped by the five-card rule.

Colour variants are never merged into one card. The albums of one model in
different colours carry a byte-identical description (the supplier only swaps
the photos), so they get one stable `variant_group_key` — md5 of the brand and
the full description — while every colour keeps its own gallery, `external_id`
and `source_position`. A leading `新色`/`新增色` marker is removed before
matching. The price line stays inside the signature on purpose: the publish-time
family check compares price, so two colours sold at different prices belong to
different families.

Batch `583c7319`: `17 424 → 3 962` cards (`4 145` before the operator
exclusions), `3 891` with a video, `1 020` colour families covering `3 846`
cards. Besides the 52 cards of the eighteen removed brands, `107` cards were
dropped for another brand that is missing from the catalogue: AMINA MUADDI, Alev,
Paris Texas, YOEYYO, Miista, R13, The Attico, ARKE, RH, AS, SUGARS, GROSMOT, OSO,
LE MONDE, Tory Burch, 73hour, SARTOR and LUCIA TACCARDI — none of them exists in
the catalogue. The processor is idempotent and leaves an ambiguous gallery
retained without inventing a video.

## Обувь 2

Активная версия — `Обувь 2 — альбомы деталей, бренды и цветовые семьи v3
(11.11.2026)` с маркером `obuv2_albums_v2` (выгрузка `5544c5f5`). Лента Szwego
содержит
четыре вида карточек: основной альбом на девять и более фотографий (товар),
служебный альбом деталей на 2–8 фотографий, однокадровая карточка (другой
ракурс, наличие, скриншот) и пустая карточка `NO IMAGE`.

Товаром остаётся только альбом с девятью и более фотографиями. Его собственные
`external_id`, `source_position`, описание и порядок фотографий не меняются.
Служебный альбом стоит непосредственно перед своим основным
(`source_position - 1`), имеет 2–8 фотографий и тот же бренд; его фотографии
дописываются после основных с удалением только точных повторов URL, а сам он
в результат не попадает. Бренд сравнивается по упоминаниям в описании, поэтому
коллаборация (`Nike x Jacquemus`) остаётся совместимой. Замер на выгрузке:
3480 карточек → 475 товаров, 155 служебных альбомов присоединено (+530
фотографий), у 94 из них подпись `细节图`, у 61 — `бренд + модель + цвет`.
Единственное несовпадение брендов в парах — коллаборация, где оба бренда
названы на обеих карточках.

Однокадровые карточки, пустые карточки, видео и служебные альбомы без своего
основного (预告, 开发, 投厂, 素材, 对比图, 出货) не публикуются; видео и poster
в товарные карточки не записываются. Для аудита товар получает
`attributes.album_merge_version = obuv2_albums_v2`,
`attributes.album_source_positions` (все использованные позиции) и
`attributes.merged_detail_photos` (сколько фотографий добавлено).

Не публикуются также Hermes (29 карточек), любой товар без распознанного
бренда (4 карточки) и служебная подборка материалов, у которой короткая
подпись называет материал или отгрузку (`素材`, `准备出货`, `预告`, `开发`,
`投厂`, `对比图`; в этой ленте `Dior素材 #132`). Повторная публикация того же
цвета, у которой с исходной галереей совпадает не меньше половины фотографий
меньшей галереи, удаляется: остаётся более ранняя карточка — так же выбирает
пару batch-level `deduplicatePostProcessedProducts`. В этой ленте такой повтор
один: `LV Tatic Runner` синий `#2786/#2787` (общих 6 из 9 фотографий).

Цветовая семья — непрерывная серия сохранённых товаров одного бренда с
одинаковой подписью после удаления цветовых слов. В этой ленте цвет есть только
на фотографиях: `#23/#30/#38` (Pocket Gradient), восемь альбомов Zegna
`TRIPLE STITCH`, двадцать альбомов Maison Margiela `Replica` и шесть
`LV WAVELIGHT` имеют одинаковый текст и различаются только цветом, поэтому
признаком семьи служит сама подпись, а не тег или слово цвета. Галереи внутри
семьи не склеиваются: каждый цвет сохраняет свою карточку, описание и
фотографии. Замер: 107 семей, 363 товара в них. Имя семьи — канонический бренд
плюс первая фраза описания без бренда и цвета (`Balenciaga 圆头绳扣 口袋鞋`).
Серия из одной карточки ключ не получает; повтор модели после другой модели
начинает новую серию, но одинаковый стабильный ключ объединяет её с прежней.

Бренд записывается каноническим UUID из `catalog_id_mappings`
(`entity_type = 'brand'`): Rails сравнивает идентификаторы, а не названия.
Побеждает бренд, упомянутый в описании раньше всех, поэтому в коллаборации
берётся первый (`TB x ASICS` → Thom Browne, `Jacquemus x Nike` → Jacquemus).
Без бренда остаются только тизер `AF1` (#309), `Grounds` (#676, #682 — бренда
нет в справочнике) и `Samba` (#1577), где название бренда в тексте не
встречается; эти карточки не публикуются.

Правило идемпотентно: повторный прогон не находит служебных альбомов и не
добавляет фотографии второй раз. Ограничение, которое пока не исправлено:
альбомы на 6–8 фотографий с полноценным описанием и без основного альбома
(ботинки Venom `#855/#857/#862/#866/#870/#884`, `LV 马丁靴` #43) правилом
«девять и более» отбрасываются.

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

Активная DB-backed версия — `Valentino Сумки — альбомы, видео, модели, дубли и
цветовые семьи v2 (11.11.2026)`, маркер `valentino-bags-albums-2`, выгрузка
`5f21a08e`. Исходник хранится в `supplier_post_process_scripts`; локального
файла нет. Прежнее описание «полные альбомы от 8 фото и 95 символов» в текущей
БД не найдено: у поставщика не было ни одной версии скрипта. Версия 1
(`valentino-bags-albums-1`) осталась точкой отката.

Лента Szwego идёт от новых карточек к старым и покрывает семь месяцев, поэтому
один товар опубликован несколько раз (до пяти публикаций на модель/цвет). Один
товар — это всплеск соседних карточек: поставщик публикует «основной альбом →
однокадровая карточка → видео → альбом на модели», поэтому в сетке служебные
карточки стоят над товаром. Товарный альбом — 6 и более фотографий и артикул
`款号`/`型号` (`038`, `0311`, `0388`, `2031`): это единственный признак, который
есть у всех товарных карточек выгрузки.

Дубли схлопываются по основному альбому до привязки служебных карточек: товары
с одинаковым набором фото, а также случаи, когда набор одного целиком входит в
набор другого, — это один товар (поставщик перезаливает те же файлы, поэтому
разные цвета фотографий не делят). Остаётся самая старая публикация — та, что
скорее всего уже есть в Rails, и тот же выбор делает штатная дедупликация
приложения; видео и фото на модели снятых публикаций переносятся, если у
оставшейся их нет. Скрины оператора `#322`/`#470`/`#913`/`#1425` и
`#325`/`#473`/`#916`/`#1428` дают по одной карточке на цвет. Сверка на выгрузке:
128 групп, 237 снятых карточек, во всех группах один и тот же артикул — но
правило смотрит только на фото и не привязано к артикулу.

Служебная карточка принадлежит ближайшему товару ниже — тому, что опубликован
перед ней. К товару присоединяются ближайшее видео (`attributes.szwego_video_url`,
сама карточка не публикуется) и один ближайший альбом на модели; в серии иногда
несколько `上身图` разных цветов, поэтому берётся только ближайший. На выгрузке
`5f21a08e` из 271 присоединённого видео 264 подписи содержат артикул своего
товара и ни одна — чужой. Карточка, отстоящая от альбома больше двух часов,
считается другой публикацией и не присоединяется (`#1269` — `上身图`,
опубликованный на следующее утро).

Однокадровая карточка без подписи не присоединяется: 74 из 373 побайтно
совпадают с фото основного альбома (`#9` — это ровно 6-е фото `#10`), остальные
повторяют тот же кадр «сумка + коробка», который уже есть в альбоме; пример
оператора `#29`/`#28` это подтверждает. Не выпускаются: разделитель
`————VA————` без фото (закрывает серию — через него не проходят ни привязка,
ни семья), распродажные `特价`/`特惠`/`福利`/`🉐` (`特价🉐300`,
`中秋特惠🉐300`) вместе со своими служебными карточками, заголовки `款号：……` без
описания, коллажи `🆕Loco 四色` и однокадровые карточки.

Габариты из `尺寸` сразу пишутся в `attributes.dimensions` в формате
`21,5 × 15,5 × 8,5 см` (как у LV) — до AI-этапа; одно число размером не считается.
Покрытие на выгрузке — 198 из 202 карточек.

Цветовая семья — подряд идущие товары с одним артикулом и одинаковыми
габаритами из `尺寸`: `2031（兰）` и `2031（彩）` дают одну семью, `大号` и малый
размер — разные. Цвет есть только на фотографиях, и поставщик публикует один
товар на цвет, поэтому две соседние карточки одной модели — два цвета. Ключ —
`md5("Valentino|<артикул>|<габариты>|<external_id первого товара>")`: повтор
модели через месяцы не склеивается с прежней серией. Галереи, `external_id` и
`source_position` остаются у каждого цвета. В серии `0388` смешаны `绒面` и
`粒面` — оператор считает её одной семьёй, поэтому тип кожи в подпись не входит.

Для выгрузки `5f21a08e-3882-4afe-a68d-af78410b34ee` Preview v2 дал `1462 → 202`
карточки: 132 с видео, 54 семьи на 169 товарах, 198 с габаритами; снято 237
повторов. Примеры оператора воспроизводятся (`#10` = альбом + видео `#8` + фото
`#7`; после схлопывания дублей этот товар остаётся на позиции `#119`). Исходный
снимок `SCRAPED` не изменён.

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

Публикация `5f21a08e` упиралась в проверку цветовых семей: 18 расхождений на 16
семьях — 15 `цвет фурнитуры различается`, 2 `габариты` и 1 `высота сумки`.
У Valentino разные цвета действительно идут с разной фурнитурой
(золото/серебро), а габариты ИИ читает по фото с разбросом; цена, бренд и
категория в этой выгрузке не расходились. С 12.11.2026 фурнитура и габариты в
проверке семей — предупреждение для всех поставщиков (см.
`docs/batch-ai-workflow.md`), а `44` дополнительно добавлен в
`app_settings.family_check_skip_suppliers` (`[3,40,44,48]`), чтобы публикацию не
останавливали и остальные расхождения семьи: карточки уходят в Rails как есть.

## Fendi Сумки (supplier 40)

Активна DB-backed версия `Fendi Сумки — альбомы, фото на модели, дубли,
рюкзаки и цветовые семьи v1` (md5 `7e30bc844f977ce13fb6a61c10a6ae97`).
Товарным считается альбом минимум с шестью фотографиями и содержательным
описанием: код модели после `🐝`/`🍌`/`货号`, метка размера (`尺寸`, `Size`,
`36*13*27`) или текст от 100 символов. Лента newest-first: карточка с меньшей
`source_position` опубликована позже. `external_id`, `source_position`, бренд,
категория и порядок сохраняются.

Сервисная карточка (1–9 фото, текст до 60 символов) присоединяется к альбому,
который идёт следующим в ленте: поставщик публикует альбом, а фото на модели —
сразу после него, поэтому в ленте они стоят перед альбомом. Нужен разрыв по
`szwego_timestamp` не больше трёх минут. Фото на модели дописываются после фото
альбома, точные дубли URL убираются; в галерею попадает не больше двух
сервисных карточек и не больше 27 фотографий. Не присоединяются скриншоты
(`官网图`, `砖柜`, `转柜`, `随手拍`, `杂志`, `合集`), мультицветные подборки
(`3色`, `个颜色可选`) и служебные заметки (`对比`, `尺寸图`, `测量`); карточки
подвесов и брелоков (`包挂`, `挂饰`, `钥匙扣`) не выпускаются.

Повтор удаляется, когда совпадают нормализованное описание, артикул и размер, а
посты разнесены больше чем на 12 часов; остаётся карточка с более полной
галереей, при равенстве — более новая. Цветовые варианты одного шаблона в одной
серии постов сохраняются: по тексту и фото они неотличимы от повтора, поэтому
удаляются только повторы, разнесённые по времени.

Рюкзаки получают подкатегорию `Рюкзаки`
(`08211d84-d3ac-4fdc-ae54-e7d9dd2d6fd6`) по ключевым словам
`双肩包`/`双肩背`/`背包`/`backpack`/`书包`; `双肩带` (двойной ремешок) рюкзаком
не считается.

Цветовая семья строится по артикулу и нормализованному размеру: числа размера
сортируются, поэтому `26*9.5*18` и `26*18*9.5` — один размер. Нужно минимум два
товара; `variant_group_key` — md5 от бренда, артикула и размера, имя
`Fendi <артикул>`, а при нескольких размерах одного артикула — с размером
(`Fendi 7012M75 · 34 см`). В источнике цвета описываются одним общим текстом,
поэтому семья опирается на артикул и точные габариты, а не на название цвета.

Для выгрузки `7c8405b9-615d-4f9e-89ba-87a55d62414f` обработка дала `562 → 253`:
252 сервисные карточки присоединено к альбомам, 55 карточек не выпущено
(скриншоты, одиночные фото без своего альбома, рекламные подборки), 2 повтора
удалены (`#154`/`#452` — чёрный Peekaboo, `#155`/`#451` — серый). Сформировано
52 семьи на 171 товаре, 18 рюкзаков. Примеры оператора воспроизводятся: `#1` →
`#2`, `#3` → `#4`, `#5` → `#6`, `#7` → `#8` (4/9/9/9 фото на модели), все
четыре альбома — одна семья `6688M125`. Исходный `SCRAPED` снимок (562)
сохранён, партия переведена в `SCRIPT_PROCESSED` (253).

Ограничение: одинаковые по тексту карточки внутри одной серии постов
(`#158`/`#159`, `#63`/`#65`) могут быть как повтором, так и другим цветом — по
доступным данным они неотличимы, поэтому оставлены обе. Присоединение
сервисной карточки эвристическое по соседству и времени; в проверке этой
партии одна пара ошибочна (`#390` получил фото розовой сумки из `#389`).

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

### Версия 3 (активна с 12.11.2026): бренд по коду, отбраковка рекапов

Выгрузка `fb6b4509-89fc-4339-bf51-016ba25b8cf7` (5445 сырых карточек): в
`SCRIPT_PROCESSED` сохранено 692 товара вместо 713. Бренд стал обязательным
полем: карточка без распознанного бренда не выпускается. Код берётся из первого
слова описания (`1V`, `D1OR`, `MC`, `BU`/`BUR`, `AC`, `LOE`, `PR`, `GUCC1`,
`BLCG`/`BL`, `AM`, `CE`, `CH`/Chanel, `MU`, `PL`, `FD`, `DE`, `LP`, `BC`, `KL`,
`ST`, `BR`, `TB`, `MM`, `YS`, `AR`, `ZE`, `BV`, `GV`, `MOOSE`, `TF`, `HE`, `LU`),
иначе ищутся однозначные коды в тексте (`1V`, `D1OR`, `GUCC1`, `BLCG`, `MOOSE`)
и названия брендов. Канонический id пишется в `brand`, в
`attributes.brand_name`/`brand_alias`, маркер версии — в
`attributes.post_process_version` (повторный прогон проходит как есть).

Две карточки-ошибки из примеров оператора удалены: `#756` (`1V 绒面束腰夹克`,
шесть разных цветов, фото 2024–2026 годов) и `#1272` (`MC …拉链开衫`, дубль
основной карточки, после склейки два фото). Цветовым рекапом считается карточка,
чьи собственные фото загружены в три и более разных дня с разбросом больше
45 дней; такие карточки собираются из перевыкладок разных постов и товаром не
являются (удалены также `#4545`). Карточки с менее чем тремя фото после склейки
(`#2040`, `#3475`) отбрасываются. `LU` определён как Lululemon, которого нет в
`catalog_id_mappings`, поэтому четыре товара не выпущены. `CH` — Chanel (5
товаров: джинсы, рубашки, кардиган; сверено по ярлыкам `CHANEL` и пуговицам CC),
`KL` — Chrome Hearts (8 товаров), и Chrome Hearts по указанию оператора не
выпускается вовсе. Семьи строятся только внутри одного бренда; 146 семей /
338 товаров.

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

## Мужская одежда (supplier 24)

Активная DB-backed версия `Мужская одежда — блоки-разделители, бренды и
цветовые семьи v11 (10.11.2026)` (v1 `…v10 (восстановлен 07.11.2026)`
выключена) живёт только в `supplier_post_process_scripts`; отдельного файла в
репозитории нет, деплой для правки не нужен. Проверена на полном сыром снимке
выгрузки `bf851e30-fb56-4fdd-801f-e7170d8525b5`: `14793 → 1308` товаров.
Собственного снимка `SCRAPED` у выгрузки не было (сырьё лежало только в
`products`), поэтому до запуска этапа он пересоздан из текущих `products`:
`59058d1f-8e0c-4b17-9fd3-a5384dc2fc27` (14793). Этап постобработки не
запускался, `products` по-прежнему сырые.

Лента — блоки, разделённые альбомами без фото с подписью `·····黑桃分隔线·····`
(1046 шт.) и `～～～～～分割线～～～～～` (2 шт.). Внутри блока по порядку:
одиночные фото модели (обычно 6) → `下单尺寸表` (1 фото) → `模特上身效果图` (9) →
`NN购买正品开发` (1) → упаковка `包装给你…`/`常规版发货…`/`加20元升级全套礼盒…` →
`发货视频展示` (видео) → `两个色发售…` (общий альбом двух цветов) → один или
несколько альбомов `细节图请品鉴 无滤镜实拍` по 9 фото → `NN💰Бренд 特殊版本…`
(9 фото).

Правила:

* Товар — каждый альбом `细节图请品鉴` (9 фото; три карточки по 6). Одиночки
  модели, `下单尺寸表`, `购买正品开发`, общий `两个色发售`, упаковка и
  видео-карточка товарами не становятся.
* Описание берётся из ближайшего следующего альбома `NN💰Бренд…`, а если его
  нет — из ближайшего предыдущего (один блок `#12530`, где описание стоит перед
  товаром). Два блока (`#4444`, `#9054`) содержат по два описания и по два
  товара — каждый товар получает своё.
* Фото карточки: товар → `模特上身效果图` → упаковка → `下单尺寸表` последней
  (28 фото; 25, если упаковка `常规版发货` с 6 фото). Из двух упаковок берётся
  только базовая `常规版发货`; `加20元升级全套礼盒` не приклеивается.
* Видео `发货视频展示` пишется в `attributes.szwego_video_url` и
  `video_source_id` всем товарам блока (286 карточек).
* Бренд определяется детерминированно по первым 48 символам описания (латиница
  и китайские написания: `Celine赛琳`, `LOEWE罗意威`, `拉夫劳伦`, `克罗心CH`,
  `大鹅`, `始祖鸟`, `GVC`, `AMI`, `TB`, `BV` и т. д.) и записывается каноническим
  Rails id; совпавший алиас — в `attributes.brand_alias`, имя — в
  `attributes.brand_name`. Все 1292 товара с описанием получают бренд (21 бренд);
  16 товаров без описания остаются без бренда.
* Chrome Hearts (`克罗心CH`, 138 товаров) не публикуется, как и в v10.
* Цветовая семья — товары одного блока с общим описанием (≥2). Ключ — md5 от
  `24|<external_id альбома-описания>`, имя — бренд. Блоки, где описание
  оценивает комплект (`上衣…裤子…`, 47 блоков: брюки и верх продаются
  отдельно), семьёй не считаются — это разные вещи, а не цвета.
* 20 карточек упаковки `加20元升级全套礼盒发货 细节图请品鉴…` содержат текст
  детального альбома; роль проверяется в порядке упаковка → детали, иначе они
  становились бы товарами.
* `external_id` и `source_position` сохраняются у альбома-товара; повторный
  запуск идемпотентен по `attributes.album_merge_version` (префикс
  `muzhskaya_odezhda_blocks`).

Результат: 1308 товаров, 1296 с фото на модели, 1300 с упаковкой, 1304 с
размерной сеткой, 286 с видео; 666 товаров в 305 семьях (255 пар, 45 троек,
4 четвёрки, 1 пятёрка). Не стали товарами 138 альбомов Chrome Hearts и все
сервисные карточки; 16 товаров без описания — блоки без альбома `NN💰…`.

Проверены примеры оператора: `#12` и `#13` — два товара (чёрный и хаки) с
описанием `#15`, моделью `#9`, упаковкой `#11`, сеткой `#8`, общий
`variant_group_key`; `#27` — джинсы LOEWE с описанием `#28`, моделью `#24`,
упаковкой `#26`, сеткой `#23`. Упаковка в задании была названа «из 9», но
`#9` — это `模特上身效果图`, упаковка лежит в `#11`; взята `#11`.

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

С 11.11.2026 активна DB-backed версия 1 `Valentino Одежда — альбом + видео +
описание v1` (`supplier_post_process_scripts`). Правила пересобраны под
выгрузку `742c4afa-0005-4a7b-ae80-df5f6cee51bb`: `3177 → 247` товаров, сырой
снимок `SCRAPED` не изменялся, у поставщика включён `post_process_enabled`.
Стадия `SCRIPT_PROCESSED`, AI-нормализация и публикация в Rails не запускались.

Один товар — серия карточек подряд (лента идёт от новых к старым): 3 (иногда
6) модельные одиночки → видео → галерея товара → [`gw`] → описание.

- Галерея товара — карточка с собственной подписью `实物拍摄图` (реже
  `实物拍摄图片`): реальные кадры на белом фоне — спереди, сзади, в профиль,
  бирка, деталь. Размер гуляет: 5–16 фото, обычный — 8 (у оператора это #10 и
  #18). Каждый такой альбом — отдельный товар.
- Описание — карточка с длинным текстом (≥ 20 символов) и фото на модели того
  же изделия (#13, #20). Рекламная `ꫛꫀꪝ … 朋友圈折叠 …` описанием не считается.
- Видео — карточка с `szwego_video_url` перед галереей (#9, #17): в
  `attributes.szwego_video_url`, обложка — в `szwego_video_poster_url`; в
  `photos` видео не попадает.
- `gw`, `参考图`, `秀场` — плоские и lookbook-кадры, в товар не идут.

Фото товара: галерея → фото на модели из описания. `external_id` и
`source_position` остаются у галереи. Блок без галереи не публикуется: в
выгрузке таких 119 (только одиночки, `gw` и текст). Галерея без описания в том
же постинге тоже пропускается — если ближайшее описание дальше 2 часов (одна
серия длится минуты, максимум в выгрузке 35 минут), это уже другой товар;
отброшено 19 альбомов (3 из них — «галереи» из одного фото).

Поставщик перепубликовывает товар в течение ленты. Карточки с тем же текстом и
тем же набором фото сворачиваются в одну, остаётся самая свежая: из 331
собранного товара удалено 84 повтора. Цветовые варианты с разными фото
остаются отдельными товарами.

Повторный запуск идемпотентен
(`attributes.album_merge_version = valentino-odezhda-album-1`), пустых фото и
повторяющихся `external_id` нет.


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

С 10.11.2026 активна DB-backed версия 2
(`Мужская обувь — альбомы, сервисные карточки и цветовые семьи (актуальная)`,
id `29384ebb-1ee1-4f5f-93a2-aa77620e58a3`). Версия 1
(`process_muzhskaya_obuv (восстановлен 07.11.2026)`) деактивирована. Исходник
версии живёт только в `supplier_post_process_scripts` и не требует деплоя.
Выгрузка `d07ecbc7-562c-464d-aa49-caa73deb4ff7` (3469 товаров) остаётся в
`SCRAPED`; проверка на сыром наборе даёт 1727 карточек, 380 семей и 17
одиночных, без утечек исключённых брендов. Предыдущая выгрузка
`a5710915-59ec-48f8-9b15-819b23e476ca` обрабатывалась версией 3 до миграции
базы. У поставщика включён `post_process_enabled`; отдельная настройка
`first_photo_screenshot_filter` (см. раздел «Фильтр первого фото-скриншота»)
требует деплоя AdminYeezy и миграции.

Лента — альбомы Szwego с номером `#` исходной позиции. Товаром считается
альбом минимум с двумя фотографиями и содержательной подписью от 80 знаков.
Однокадровые служебные альбомы (`Zegna`, `Bally`, `Prada`) и короткие
служебные подписи (`官网图`, `官网新品`, `官网售价`, `下单图`,
`Official website diagram`, `Order image`, `Display of process details` и
др.) не публикуются. В сырой выгрузке это 523 служебных подписи и 88
однокадровых альбомов; правило не требует вести список всех служебных
ярлыков, потому что настоящая подпись всегда длиннее 80 знаков.

Товары Loro Piana, Hermes, Louis Vuitton, BOSS, GIORGIO ARMANI, Premiata,
Uncle Bright, Paul&Shark и Dunhill удаляются до AI-этапа. Проверяются и
нормализованный Szwego-тег, и описание: часть карточек ошибочно помечена чужим
тегом, но бренд явно указан в подписи. В выгрузке `d07ecbc7` теги Szwego
пустые, поэтому проверка описания обязательна; на старой выгрузке так удалены
482 карточки Loro Piana/Hermes/LV. Бренд Bally добавлен в Rails-каталог
(`50b69217-488b-43f8-a204-36d5baba0c1d`, slug `bally`) и не исключается
постпроцессором.

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
семейства), восстановлена 10.11.2026» (`album_merge_version = albums-3`) живёт
только в `supplier_post_process_scripts`; файла в `scripts/parser/` нет, деплой
для правки не нужен. После потери Beget и переезда на `yu_scraping` (07.11.2026)
у поставщика 1 не осталось ни одной версии скрипта и был выключен
`post_process_enabled`, поэтому выгрузка
`c3accede-bfd6-450e-abe9-61167a1d0588` (2207 альбомов) лежала в `SCRAPED`.
Правило восстановлено по этой сессии, сохранено как версия 1, активировано и
включено; к партии добавлен снимок `SCRIPT_PROCESSED` на 708 карточек, сырой
снимок не изменялся.

Ранее это же правило применялось к выгрузкам `65196f95` (667 товаров) и
`56a377cc` (683 карточки, версия v3).

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
    `LP`, `BC`, `TF`, `YSL`/`SLP`, `DG`, `MM6`. После переезда на `yu_scraping`
    таблица брендов переписана на её текущие UUID (10.11.2026), иначе карточки
    ссылались на бренды старой базы. Категория у всех карточек принудительно
    `Одежда` (`7eb4103f-970b-4c9d-8077-bf328e12c967`), подкатегория не задаётся.
14. Повторный запуск идемпотентен: `attributes.album_merge_version`.

Итог по выгрузке `65196f95`: `2158 → 667` (691 карточка − 8 женских − 2 аксессуара
− 11 без бренда − 3 дубля). Галереи 3–49 фото. Безымянные карточки без описания,
видеоленты и H-секция не публикуются. Дубли по фото и тексту в остальных случаях
не определяются: у перезаливов другие файлы и переписанный текст, поэтому
автоматически склеиваются только одинаковые подписи разных дней и подтверждённые
пары.

Итог по выгрузке `c3accede` (после восстановления): `2207 → 708`, 614 карточек с
ценой 53 000–346 000, 43 цветовых семейства на 117 карточек, карточек без
бренда и с 0–1 фото нет.

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

### Hermes, версия 10.11.2026 (v1, выгрузка 9607a1c9)

Поставщик 68 «Hermes»: одна Szwego-лента (`szwego_parse_mode='all'`), выгрузка
`9607a1c9-5e8e-42f1-bee7-0443c5a86ab9` на 84 073 альбома. DB-версия
`Hermes - albums by spec block, reposts and colour families v1` (`version=1`,
md5 `94bf2cb816cb8e338761538a78d77d4f`), `post_process_enabled=true`.

Лента смешивает четыре года перевыкладок. Товарная карточка — только альбом с
блоком характеристик поставщика:

```text
H2200 Style：Kelly to go Colour：37/gold Size：19*11.5*1.5cm
Leather：Epsom From France Hardware：gold
凯莉单肩斜挎包，金棕, … 客订实拍🐎🐎customer order🐎🐎 Constance to go/康康to go
```

Блок разбирается так же, как в `lib/video-match-fields.ts` (ключи в любом
порядке, `Colour`/`Color`, опечатка `Haedware`, значения обрезаются по
следующему ключу или по подписям обуви `鞋面材料`/`Upper material`/`Sole`).
Нормализация: модель — слова в нижнем регистре по алфавиту (`Kelly Mini 2` =
`mini kelly 2`), размер — до трёх чисел через `x`, кожа — до `from/imported`,
фурнитура — `silver|gold|rose|black|other` (`sliver` = silver), код цвета без
`ck` (`ck89/noir` = `89/noir`), `OL` = `0L`.

Один цвет выкладывается одним всплеском в пределах минуты: видео-карточка,
детальный альбом (10–15 фото) и главный альбом (9 фото). Перед всплеском
поставщик повторяет три одиночных кадра обложки — они несут только китайское
название серии и отбрасываются. Всплеск = одинаковый `szwego_timestamp` в
пределах минуты + одинаковый день съёмки в URL фото + соседние позиции
(разрыв ≤ 3). Тот же цвет переснимают и перевыкладывают через недели и месяцы
(до 22 постов); берётся самый свежий пост, а если он тоньше 6 фото — более
полный (медиана 18 фото, максимум 44).

Порядок фото: главный альбом (последний альбом поста — закрытая вещь, как #118
в примере оператора), затем детальные альбомы от новых к старым, затем фото на
модели (`上身图`/`上脚图`), видео берётся ссылкой из видео-карточки, её обложка
не используется. `external_id` и `source_position` остаются от главного
альбома; разобранные поля пишутся в `attributes.hermes_model`,
`hermes_colour`, `hermes_size`, `hermes_leather`, `hermes_hardware`,
`hermes_article`.

Не публикуются: 双11/七夕/秒杀/特价/原价, `集合`/`对比图` (мультиколор),
`上脚图` без товарного альбома, старые ленты 2019–2024 без блока характеристик.

Цветовые семьи: подпись `модель (слова по алфавиту) + размер + кожа + цвет
фурнитуры`, различается только цвет; gold и silver, другая кожа или размер —
разные семьи. Ключ — `md5('Hermes|<подпись>')` (32 hex), имя вида
`Hermes Kelly to go 19×11.5×1.5 Epsom Gold`. Семья — минимум два товара и два
разных цвета.

Результат применённого этапа: `84 073 → 5 353` карточки, 4 302 с видео, 680
цветовых семей на 4 789 карточках (крупнейшие — Birkin 25 Togo silver 81 цвет,
Picotin Lock 18 Clemence silver 76), 571 одиночная карточка, галереи 1–44 фото
(в среднем 18), одна карточка с менее чем 3 фото, цены не заполнялись
(«цена по запросу»). Повторный запуск идемпотентен через
`attributes.album_merge_version`; снимок `SCRAPED` сохранён, этап —
`SCRIPT_PROCESSED`. AI-нормализация и публикация в Rails не запускались.

## Zimmermann Одежда (supplier 33)

Активна DB-версия `zimmermann_series_v4.py` (`version=4`,
md5 `25f580dccf5993c2c8ff7830e3e2226e`); `version=1`–`version=3`
отключены, `post_process_enabled=true`. Выгрузка
`e9b2e9ad-52ba-4a87-a6f9-11b8df838d31` (5 138 альбомов) лежит в
`SCRIPT_PROCESSED` (855 товаров, версия 4). Снимок `SCRAPED` (5 138 строк)
восстановлен из сохранённого сырого дампа и записан в `batch_snapshots`; в
истории остались `SCRIPT_PROCESSED` версии 1 (762) и текущий 4 (855).

Лента — серии Zimmermann (`𝒁**𝒎𝒆𝒓𝒎𝒂𝒏𝒏`) и Camilla (`《CAMILLA》`), новые
серии идут сверху. Роли альбомов:

- `🌟全系列预览` / `🌟全系列集结预览` — превью серии: 1 фото, все вещи и
  артикулы; товаром не является;
- `❥❥尺码表` — размерные сетки; сколько артикулов в подписи, столько фото,
  порядок фото = порядок артикулов/вещей; фото идёт последним в карточку
  своей вещи;
- `🌟官配` — фото комплекта (несколько вещей вместе), товаром не является;
- `ꫛ…【…N️⃣】…` — основная карточка вещи; `♥𝑰𝒕𝒆𝒎 𝑫𝒆𝒕𝒂𝒊𝒍`/английский
  `The … Collection` — её детали; `今日新品发布`/`翻单`/`现货` — лукбук;
- `💛奶油色 🖤黑色 • 𝚂𝚒𝚣𝚎… #F3269` — карточка цветов: список цветов
  одной вещи, товаром не является.

Товар — одна строка вещи в превью (один артикул или пара цветовых артикулов
одной вещи). В карточку складываются все основные альбомы этой вещи, все её
детали и один комплект сетки; общие превью, `官配` и лукбук с несколькими
вещами не добавляются. Новые основные альбомы несут все артикулы серии
(`#F3514#F3515`), поэтому склейка по артикулу запрещена: вещь определяется
номером `N️⃣` в `【…】` и превью серии, а сетка делится по порядку фото.
Старый расклад (сетка/основная/детали на каждую вещь отдельно) обрабатывается
тем же правилом; если превью нет — по ближайшей одиночной сетке или порядку
сетки. Неоднозначные старые карточки остаются отдельными товарами с
`attributes.album_merge_confidence='low'` и `album_merge_notes=['unmapped']`.

Цветовые семьи. Если карточка цветов перечисляет N ≥ 2 цветов и у вещи ровно
N основных карточек в том же блоке, вещь делится на N товаров: основная
карточка i получает цвет i в порядке ленты, детали и лукбук — по ближайшей
предшествующей основной, сетка копируется всем цветам
(`album_color_split='order'`). Если цветов N, а основных карточек больше N,
но они группируются по дате съёмки (папка `YYYYMMDD` в URL фото) ровно в N
групп, вещь делится по датам: лишние основные — дубли одного цвета
(`album_color_split='date'`). Цвет пишется, только если в группе есть
собственное цветовое слово; иначе `variant_color` не ставится и цвет называет
AI-этап по фото (так F3016 разделён на 13 и 28 фото без имени цвета). Если
карточки цветов нет, но основные карточки имеют разные названия коллекций
(`源自我们“…”`) и в группах есть два разных цветовых слова, вещь тоже делится
по датам — так разделены F2619 (咖色 12 фото и чёрный 11 фото). Если цветов N,
а основных не N и даты не дают N групп, товар не делится:
`album_color_split='ambiguous'` и `album_colors`. Для этого батча вручную
проверены и разделены по `MANUAL_COLOR_GROUPS` (source_position,
`album_color_split='manual'`): F3465 杏色/咖色, F3377 杏色/黑色,
F3168 粉色/黄色, F3169 黄色/粉色, F3166 黄色/粉色, F3296 褐色/黑色,
F2547/48/77-шорты 黑色/象牙白. Остались `ambiguous` 3: F3199,
F2867/2797 и F2547/48/77-юбка. Если карточки цветов нет и цвета смешаны
внутри альбомов (например F3358), детерминированно разделить нельзя —
остаётся один товар; для такого случая нужен визуальный или AI-разбор,
скрипт его не делает.

Каждый член семьи получает top-level `variant_group_key` (32-hex
`md5('zimmermann|артикулы|модель')`) и `variant_group_name`
(`Zimmermann <модель>`), в атрибутах — `variant_color` (если определён),
`album_color_split`, `album_colors`, `album_color_source_position`.

Порядок галереи: основная карточка → остальные основные → детали → лукбук
этой вещи → сетка. Основные фото и детали не обрезаются; лукбук добирается
до 30 фото, сетка идёт последней. Если основных и деталей уже ≥30, лукбук не
добавляется. Это убирает хвост перевыкладок: до версии 2 было 207 товаров
с >30 фото, 76 с >50, 22 с >80, 11 с >100 (максимум 150); после — максимум
30 фото, 184 товара обрезаны. Описание — основная подпись + английские
детали; текст лукбука не копируется. `external_id` и `source_position` — от
основной карточки с наибольшим числом фото (при равенстве — более свежей).

Аудит: `attributes.album_merge_version='zimmermann_series_v4'`,
`album_source_positions`, `article_codes`, `album_item_number`,
`album_merge_confidence`, `variant_color`, `album_color_split`,
`album_colors`, `album_color_source_position`, при наличии —
`size_chart_source_position` и `album_photo_cap`.

Preview на полном сырье: `5 138 → 855` товаров, 93 цветовые семьи (186
членов), 3 неоднозначных цветовых товара, максимум 30 фото; повторный
запуск идемпотентен, пустой вход даёт 0, неизвестных и дублирующихся
`external_id` нет. 29 старых товаров остаются с
`album_merge_confidence='low'`. Версия 4 применена к батчу: 855 товаров,
`SCRIPT_PROCESSED`, снимок `SCRAPED` (5 138 строк) сохранён. AI-нормализация и
публикация в Rails не запускались.

## LP, Row Сумки (supplier 46)

Активна DB-backed версия `lp_row_bags.py` (v2, с 2026-11-11; v1 — только
товары и склейки, v2 — товар только с описанием, бренды по модели и цветовые
семьи). Legacy-файла нет. Лента идёт от новых карточек к старым: на каждый цвет
модели поставщик выкладывает альбом-карточку с описанием (`尺寸`, размеры,
`¥`), а между ними — карточки на 1–3 фото с подписью-настроением (`🤍`,
`限定色#`, `冷调芥末青`) или с цветом крупным планом (`◾️实拍 白色#`).
Визуальная проверка выгрузки `c5cd09a1` показала, что такие мелкие карточки
повторяют или дополняют альбом соседнего цвета, но их позиция относительно
этого альбома не постоянна: лайфстайл-кадр стоит то сразу после альбома, то
перед альбомом следующего цвета.

Правила:

1. Товар — карточка со своей спецификацией: `尺寸` и рядом цифры либо `¥` с
   числом. Карточка, у которой в описании только имя серии (`33吐司包`,
   `手包`, `MX麂皮`, `饭盒23`, `信封包`, `汉堡包`, `MX14`, `水桶包`),
   маркетинговая строка (`慵懒显贵新方式｜高级 Extra bag23`) или пометка
   (`原版购入 双肩背包`, `书包 原版购入 双肩背包`) — не товар, даже если у неё
   целый альбом на 9 фото: каталогу нужно описание, а не только картинки.
   Подпись-заявление `尺寸拿捏的刚刚好` товаром не считается.
2. Остальное удаляется, кроме случаев с положительным доказательством:
   - это компаньон-альбом без подписи (подпись равна имени серии): целый альбом
     7+ фото или детальный сет 4–6 фото, предыдущая карточка — товар той же
     серии, и серия повторяет такую раскладку не меньше трёх раз (проверено на
     `水桶包小中大`: 11 пар «альбом цвета + альбом без подписи», цвет совпал во
     всех). Единичный альбом без подписи компаньоном не считается: у Terrasse
     #770 чёрный после тёмно-коричневого #769, у Agnes #817 коричневый после
     чёрного #816 — это отдельные цвета;
   - у мелкой карточки есть точный URL фото одного из соседних (±3 позиции,
     та же серия) товаров — то же фото перезалито;
   - её подпись — уникальный префикс подписи одного соседнего товара той же
     серии (`𝗘𝘅𝘁𝗿𝗮 𝗕𝗮𝗴 𝗟19编织包 红棕色`).
   Фото добавляются после альбома товара в порядке ленты.
3. Два товара одной серии, у которых 3+ общих точных URL фото, — перевыкладка
   одного цвета: галереи объединяются в карточку с большим числом фото (при
   равенстве — в более свежую).
4. Видео-карточка (`szwego_video_url`, всегда 1 фото) прикрепляется к товару той
   же серии с совпадающим цветом в подписи, иначе к ближайшему (при равенстве —
   к альбому, выложенному после неё); если в серии один товар — к нему. URL
   видео переносится в `attributes`.
5. Бренд, в порядке приоритета: подпись, называющая свой бренд (`𝐿𝑒𝑚𝑎𝑖𝑟*` →
   Lemair `93422721-1ff1-46be-80de-4f5223641e5f`); явные маркеры (`𝗟𝗣`,
   `LP`, `Loro`, `𝗘𝘅𝘁𝗿𝗮`, `Extra Bag`, `𝗕𝗮𝗹𝗲`, `𝗕𝗼𝗯𝗯𝗶𝗻`, `𝗟𝗼𝗼𝗺` —
   Loro Piana `0ea28040-c9e9-4bdd-846a-f67f9d1e22bf`; `𝑻𝒉𝒆`, `The Row`,
   `TheRow`, `TR` — The Row `0d54dee3-d584-4528-8db3-06865e74b93e`);
   большинство маркеров по всей серии в батче; карта моделей, заданная
   оператором 2026-11-11 (`𝑵𝒆𝒆𝒅𝒍𝒆`, `𝑮𝒉𝒊𝒆𝒓𝒂` → Loro Piana;
   `𝑨𝒔𝒕𝒓𝒂`, `𝑬𝒅𝒊𝒕𝒉`, `𝑻𝒆𝒓𝒓𝒂𝒔𝒔𝒆`, `𝑵𝒖𝒂𝒏𝒄𝒆`, `𝟵𝟬𝘀`, `𝑷𝒆𝒈𝒈𝒚`,
   `𝑹𝒂𝒚 𝑩𝒂𝒈` → The Row); название семейства, доказанное самим батчем
   (`饭盒`/`腰包`/`双肩` → Loro Piana, `水桶`/`mx`/`MX` → The Row).
   Описания не переписываются — выжившая карточка сохраняет свой текст целиком.
6. Цветовые семьи. Семья — одна модель с одинаковыми габаритами, одинаковой
   кожей и одинаковой ценой, минимум в двух цветах. Ключ —
   `md5(бренд|серия|габариты|цена|материалы)`; члены семьи обязаны отличаться
   хвостом подписи (меткой цвета), поэтому одинаковые подписи семью не дают
   (у `饭盒包 鳄鱼🐊`, `蜥蜴🦎`, `蛇皮🐍` цвет есть только на фото — семей нет).
   Товары с двумя парами «размер + цена» в одной подписи (Bobbin: `尺寸
   小号19*6*16cm 大号32*7*21cm ¥小 950 大 1100`) не группируются вообще.
   `variant_group_name` = бренд + общий префикс подписи (модель и поколение) +
   габариты, чтобы две семьи одной серии не назывались одинаково. Галереи,
   `external_id` и `source_position` у каждого цвета свои, ничего не склеивается.
7. Аудит: `attributes.album_merge_version='lp-row-bags-2'` и
   `attributes.album_source_positions`. Повторный запуск идемпотентен: карточки
   с этим префиксом проходят без пересборки.

Preview на полном сырье `c5cd09a1-13ce-490e-beab-df693f97039f` (1 162
карточки): `1 162 → 387` товаров, 55 из них склеены (57 впитанных карточек).
Бренды: 235 Loro Piana, 136 The Row, 16 Lemair, без бренда — 0. Цветовых семей
69, в них 322 товара (83 %), 65 товаров остались вне семей. Видео у 13 товаров.
Фото всего 3 624, в среднем 9,4 на товар (от 6 до 18). Повторный запуск
идемпотентен, пустой вход даёт 0, неизвестных и дублирующихся `external_id`
нет; описания, `external_id` и `source_position` совпадают с источником,
минимальная длина описания — 74 символа.

Полностью ушли серии без спецификации: `信封包`, `MX麂皮`, `MX14`,
`汉堡包`, `饭盒23`, `33吐司包`, `手包`, `水桶包`. Известные ограничения:
4–6 фото карточки с маркетинговой подписью (`🌟红棕色`, `复古红`) удаляются как
неподтверждённые (около 40 «сиротских» текстовых альбомов по `diag`); у
`𝑻𝒆𝒓𝒓𝒂𝒔𝒔𝒆` (#763 и #769 без `¥`, разные материалы в подписи) и `𝑮𝒉𝒊𝒆𝒓𝒂`
`Shetland` (без цены) семьи не собрались; у 9 карточек `Bobbin` семьи нет по
правилу двух размеров.

Батч `c5cd09a1` переобработан версией 2: `SCRIPT_PROCESSED`, 387 товаров,
снимок `SCRAPED` (1 162 карточки) сохранён. AI-нормализация и публикация в Rails
не запускались.

## Dior Обувь (supplier 9)

Активна DB-backed версия 2 `dior_shoes_pairs.py` (2026-11-11; v1 — склейка и
семьи, v2 — маска цвета вместе со связкой `采用`/`采` и чистка имён семей).
Legacy-файла нет. Лента идёт от новых карточек к старым: на каждый цвет модели
поставщик выкладывает альбом-карточку с полным текстом Dior (9 фото, в конце
строки `Size`/`尺码` и `P`/`价格`), а прямо перед ним — 1–3 карточки на одно фото
без описания вовсе (кадр на подиуме, на ноге, на модели). Между блоками идут
служебные карточки: разделители без фото (`🐳 ．·°∴ ☆．．·°．`), подписи на одно
фото (`集合图`, `合集图`, `Set diagram`, `two colors`, имя модели, эмодзи),
видео-подписи (`视频`, `无滤镜视频`) и альбомы сравнения с оригиналом
(`𝐙𝐏🆚大货`, `爆拆`, `大货⚡️正品`, 2–9 фото).

Правила:

1. Товар — альбом с описанием: 3+ фото и текст от 60 символов без меток
   сравнения. Он сохраняет `external_id`, `source_position` и описание.
2. Карточка на одно фото без описания и без видео — обложка следующего
   альбома, не товар.
3. Служебные карточки удаляются и цепочку обложек не разрывают: в батче
   подпись ни разу не стоит между обложкой и её альбомом, поэтому обложки
   «схлопываются» до ближайшего альбома (формулировка оператора: «если
   невозможно различать — схлопывать между ними»).
4. Фото: обложки в порядке ленты, затем 9 фото альбома. Точных дублей URL нет —
   у каждой обложки свой кадр.
5. Карточка без альбома не удаляется молча: остаётся товаром с
   `attributes.album_description_missing` (в батче таких нет).
6. Цветовая семья: товары, у которых описания совпадают после снятия цветовых
   слов (общий шаблон `…色` плюс формы без `色`: `浅蓝`; связка `采用`/`采`/`和`
   снимается вместе со словом цвета), получают общий `variant_group_key` =
   `md5('dior-shoes|текст')` и имя из общего префикса подписи. Нужны минимум два
   товара и два разных цвета; при совпадении имён разных семей добавляется
   `(1)`, `(2)`.
7. Аудит: `attributes.album_merge_version='dior-shoes-pairs-v1'`,
   `album_source_positions`, `album_source_ids`, `album_cover_photos`,
   `album_attached_cards`, `description_source_id`, у семей —
   `album_family_key`, `album_family_name`, `album_family_size`,
   `album_family_colour`. Повторный запуск идемпотентен по префиксу маркера.

Preview на полном сырье `acadb467-d5b9-4212-a2e7-3fbb59d64f9b` (745
карточек): `745 → 227` товаров, 390 обложек впитано (118 альбомов с одной, 55 с
двумя, 52 с тремя, один с шестью), 50 разделителей, 70 подписей и 8 прочих
служебных карточек (7 альбомов сравнения и постер видео без подписи) удалены.
Фото 2 433, на товар от 9 до 15 (в среднем 10,7), пустых галерей и товаров без
описания нет. Цветовых семей 33 на 96 товарах (крупнейшая — Chrono DiorAlps,
11 карточек в 6 цветах), 131 товар остался вне семей. Повторный запуск
идемпотентен, пустой вход даёт 0, неизвестных и дублирующихся `external_id`
нет.

Проверено на примерах оператора: `#1`+`#2` (первое фото из обложки, дальше
альбом), `#4`+`#5` … `#18`+`#19`, карточки `#3` и `#20` удалены; на втором
скриншоте `#421–#423`+`#424` и `#425–#427`+`#428`. Дополнительное
доказательство склейки: 458 из 468 позиций обложек лежат в той же папке
загрузки, что и альбом, а `szwego_timestamp` внутри блока совпадает до секунды.

Ограничения: 12 повторов цвета внутри семей (`#5`/`#13` белые,
`#9`/`#15`/`#22` серебристые, `#11`/`#17` чёрные, `#2`/`#24` верблюжьи) — это
перевыкладки поставщика, удаляются только по решению оператора; четыре группы
моделей не собрались в семьи из-за расхождений текста помимо цвета (D-Major
5 карточек, J'ADior 12 — три семьи по высоте каблука, capture 穆勒 8 — две по
каблуку, Dentelle带跟 5 — две из-за опечатки `(Trianongr`); шесть видео-карточек
не прикрепляются, потому что принадлежность товара не доказана, и постер видео
не считается фотографией товара.

Батч остаётся на этапе `SCRAPED` (745 товаров, снимок `Сырой товар`
сохранён); стадия по постобработке, AI-нормализация и публикация в Rails не
запускались.

## DG Одежда (supplier 7)

Активная версия — `dg_odezhda_albums.py` (v3, 11.11.2026), маркер
`dg_odezhda_albums_v3`, выгрузка `3ceafa1a-4008-4840-a601-89eeac30a0bf`
(987 карточек). Исходник хранится в `supplier_post_process_scripts`, локального
файла нет. v1 склеивала комплекты и держала стоковые карточки, v2 их выбросила,
но оставила в одной карточке две расцветки — заменены.

Форма блока: `[карточка размера] → [альбом товара] → [перевыкладки того же
поста]`.

1. Карточка размера — подпись `尺寸` (или пустая) и 1–2 фото: скриншоты таблицы
   размеров из заметок Apple. Самостоятельным товаром не считается.
2. Товар — альбом с подписью-описанием, 9 фото.
3. Дальше поставщик перевыкладывает тот же товар: селфи на модели, лукбук.
   Меняются только остатки по размерам (`s5 L1` → `m19 L2`) и слова акции.

Правила:

- берутся только посты с настоящим описанием (`新款`, `新品`, `系列`, `面料`).
  Карточка, у которой подпись — только строка остатков (`🉐s10 m7 L11 🉐360`),
  в каталог не идёт и свой скриншот размера не забирает.
- подпись сводится к набору чисел: цена после `🉐` плюс 3–4-значные числа
  (префикс `p10090` и проценты вроде `100%` снимаются). Остатки по размерам и
  рекламные слова в подпись не входят, поэтому перевыкладка остаётся одной
  карточкой.
- пост, где названы две цены, — комплект (рубашка + юбка, жилет + кардиган).
  По тексту альбомы комплекта не разделить, поэтому целиком такой пост в этой
  стадии не берётся: лучше пропустить, чем склеить четыре товара в одну
  карточку.
- карточка размера приклеивается к следующей группе товара и закрывает
  предыдущую: новая карточка размера — новый товар.
- если перед товаром несколько карточек размера, остаётся та, что загружена в
  тот же всплеск (±1 час по метке времени в имени файла), чужая старая
  отбрасывается (`#380` от 2025 года при товаре 2023 года, `#950`).

Расцветки в одной карточке. Цвет в подписи чаще всего не назван (`#599` про
цвет не говорит ничего), а альбомы обеих расцветок загружены в один день,
поэтому по тексту и по времени их не разделить — раскладка прочитана по фото и
записана в `SPLIT_PLAN` по id поста Szwego (id стабильны между выгрузками):

- `#599` рубашка из жаккарда — серая `#599`+`#600`, бежевая `#601`+`#602`;
- `#834` кардиган — чёрный `#834`+`#835`, красный `#836`–`#838`;
- `#851` кардиган с запахом — чёрный `#851`+`#854`, бежевый `#852`+`#853`+`#855`;
- `#604` рубашка — `#604`–`#606`, альбом `#607` с платьем другого товара
  отброшен.

Скриншот размера достаётся только первой карточке пары: на скриншоте снят один
цвет. Остальные альбомы поста, не перечисленные в плане, отбрасываются.

Фото: сначала все альбомы поста в порядке ленты, затем скриншоты размера — чтобы
скриншот никогда не стал главным фото. Дубли по точному URL убираются.

Идентичность: `external_id`, `source_position` и описание берутся у первого
альбома. В `attributes` пишутся `album_merge_version`,
`album_source_positions` и `size_chart_positions`. Повторный запуск идемпотентен
по точному значению маркера, пустой вход даёт пустой список.

Preview на сырье `3ceafa1a-4008-4840-a601-89eeac30a0bf`: `987 → 88` товаров,
2 037 фото, у товара от 11 до 45 фото (медиана 19), скриншот размера есть у 83
товаров.

Проверка на дубли: у всех 41 карточки с более чем 20 фото попарно сравнены
перцептивные хеши (dHash, порог 6 бит). Дублирующихся альбомов нет; на карточку
приходится 1–4 близких кадра — это серии одного кадра в съёмке, а не
перевыкладка. Обложки альбомов всех 42 крупных карточек просмотрены глазами:
кроме перечисленных четырёх постов, внутри карточки один товар одного цвета.

Ограничения: комплекты с двумя ценами (10 постов, включая `#243`, `#244`,
`#245`) в каталог не попадают — их раскладка требует решения оператора.
`SPLIT_PLAN` покрывает только разобранные посты; новый пост с двумя расцветками
попадёт в одну карточку, пока его не разберут и не добавят в план.

Батч прошёл стадию на версии 1 (`SCRIPT_PROCESSED`, 274 товара); сырой снимок
`SCRAPED` на месте, поэтому перезапуск стадии пересоберёт результат по версии 3.

## Чемоданы (supplier 52)

Активная версия — `Чемоданы — дедупликация, бренды, ручная чистка мусора v4
(11.11.2026)`, id `06cb0def-1212-4b1f-8a72-f63041dd48f6`, маркер
`chemodany_dedupe_v4`, выгрузка `fa0392bd-4936-4286-8a8f-04673c627f9d`
(31 186 карточек). Исходник хранится в `supplier_post_process_scripts`,
локального файла нет.

Лента Szwego — витрина перевыкладок: поставщик публикует один и тот же альбом
(те же URL фото) снова и снова, до 304 раз на карточку, и хранит историю с 2019
года. Замер по сырью 11.11.2026: 3 295 уникальных наборов фото, 541 из них
повторяется, самый крупный — 304 копии. Набор фото и есть идентичность альбома:
перевыкладки переиспользуют точные URL, а разные расцветки и размеры внутри
одной подписи не делят ни одного фото (максимальный Jaccard 0.10). Верх ленты
(11–18.09) — блок шкатулок, перевыложенный 8 раз; ниже идут чемоданы.

Правила:

- карточки группируются по md5 отсортированных URL фото; остаётся самая ранняя
  карточка — оригинал поста, более поздние перевыкладки выбрасываются;
- единичные перевыкладки меняют одно фото, поэтому карточки с одинаковой
  подписью и пересечением ≥ 60 % меньшего набора фото считаются тем же
  альбомом;
- выбрасываются сервисные карточки (集合图/全部颜色/12色, отзывы, «после
  продажи», скидки, оптовые объявления) и карточки с менее чем 5 фото: нужен
  полноценный студийный альбом, а не тизер на 1–4 кадра;
- карточка с подписью короче 20 символов после снятия тега не публикуется:
  одно название цвета — не описание товара;
- остаются только чемоданы и шкатулки/футляры для часов/сигар; сумки, рюкзаки,
  чехлы для телефонов, картхолдеры, Goyard-«коробки»-сумки и мебель LV
  (茶几/木箱/塔箱/表柜 и голые размеры 45–80 см) не публикуются;
- Dior, Fendi, Moncler и Tiffany в этой ленте — коллабы с Rimowa, поэтому их
  бренд — Rimowa; шкатулки и футляры для часов Goyard не сохраняются (только
  чемоданы Goyard); товар без распознанного бренда не публикуется;
- `MANUAL_DROP_IDS` — ручной разбор 1 092 карточек Preview (11.11.2026):
  люди/модели, магазинные полки, коллажи, сумки, упаковка, макро-снимки
  фурнитуры и прочий не-товар. Список хранится в исходнике по `external_id`
  (131 карточка), поэтому решение переживает перевыгрузки;
- бренд берётся сначала из тега поставщика (`Lv拉杆箱`, `Hms爱马仕`,
  `Original经典925铝合金`, `戈雅拉杆箱`, ...), затем из подписи; пишется
  канонический UUID из `catalog_id_mappings`;
- подкатегория: чемоданы → `Чемоданы`, шкатулки → `Шкатулки для украшений`,
  часы → `Футляры для часов`;
- `attributes.sizes` удаляется: скрапер принял габариты 36/24/50 см за размеры.

Preview на сырье: `31 186 → 961` товар (888 чемоданов, 73 шкатулки/футляра:
45 шкатулок для украшений и 28 футляров для часов). Бренды: Rimowa 481,
Louis Vuitton 339, Hermes 70, Goyard 67, Chanel 2, Gucci 2; товаров без
бренда нет. Точных дублей отброшено 27 891 карточка, близких — 6, вручную —
131. Идемпотентность, пустой вход, уникальность `external_id` и
`source_position`, сохранность `photos` проверены runner'ом; у всех товаров
самый ранний timestamp в своей группе фото.

Ограничения: карточки-наборы из 2–3 размеров одной модели оставлены (это
семейства размеров, а не дубли); карточки с 3–4 фото и короткими подписями
отсечены ещё правилами. Видео — отдельные карточки с 1 фото, к товарам не
приклеивались. Зонтов в ленте нет.

Батч был обработан на версии 1 (`SCRIPT_PROCESSED`, 1 705 товаров) до
активации v4; сырой снимок `SCRAPED` на месте (31 186 товаров), поэтому
перезапуск стадии пересоберёт результат по v4 в 961 товар.

Инструкции для ИИ (`suppliers.ai_instructions`, 12.11.2026): карточка — одна
модель в одной расцветке; при нескольких разных чемоданах в кадре описывается
главный, остальные не перечисляются; при нескольких размерах одной модели
`name` — цвет + «чемодан» + линейка без одного размера, все размеры в дюймах
уходят в `sizes`, в описании перечисляются одной фразой; при одном размере он
входит в `name`. Бренд в `name` не пишется (системное правило), `model_name`
только подтверждённая линейка. Добавлен словарь китайских обозначений
(寸/см, 铝镁合金, 聚碳酸酯, 万向轮, 海关锁 и т.д.).

## Очки (supplier 60)

Активная версия — `Очки — только очки 2025–2026: альбомы с моделью, бренды,
цветовые семьи, дубли v2`, id `c68ff229-2163-4a53-ae2b-6e631e85760f`, маркер
`ochki_model_albums_v1`, выгрузка `3ab569c7-7a9a-41f8-abc5-97dd1e2715ef`
(46 276 карточек). Исходник хранится в `supplier_post_process_scripts`,
локального файла нет.

Лента — вся история альбома 2018–2026: ювелирка 2018–2020 (теги
`四叶草饰品`, `香家饰品`, `卡地亚饰品`, …) и очки 2021–2026 (теги `*眼镜`,
`PRADA普拉达`, `V牌GM`, `JACQUES`). Оператору нужны только очки и только
2025–2026: очки за 2018–2024 не публикуются. Целевой формат карточки —
`BRAND* / MODEL: … / SIZE: 54口20-145 / 260 BRAND`.

Правила:

- очки определяются по тегу (`眼镜`/`墨镜`, тег бренда очков) либо по подписи
  со словом «очки/солнцезащитные» и строкой размера;
- карточка товара — только запись с меткой MODEL и меткой SIZE и только за
  2025–2026 годы (1 574 из 46 276). Старые подписи без модели, коллажи
  цветов, лукбуки без этих полей и вся история 2018–2024 не публикуются;
- выбрасываются сервисные карточки (`集合图`, `上脸图`, `官网图`, `模特图`,
  `细节图`, `效果图`, `合集`, `实拍图`) и карточки с менее чем 5 фото;
- Chrome Hearts (`克罗星眼镜`, `克罗心`) не публикуется совсем;
- бренд: сначала голова подписи (код бренда), затем тег, затем полный текст.
  Тег ненадёжен: `JM眼镜` содержит Jacques Marie Mage, Jimmy Choo и Jacquemus,
  поэтому подпись важнее. Пишется канонический UUID из `catalog_id_mappings`;
  14 брендов очков, которых там не было (Gentle Monster, Maybach, Jacques
  Marie Mage, Ray-Ban, Dita, CARIN, Lotos, ic! Berlin, Kimhekim, Linda Farrow,
  THENRI, ROAV, David Beckham, Lindberg), добавлялись локальными
  каноническими строками 12.11.2026. Из них 11 брендов с ≤ 10 товарами в
  выгрузке 2025–2026 удалены обратно вместе с товарами (CARIN, Dita, Linda
  Farrow, THENRI, Lotos, ic! Berlin, Kimhekim, ROAV, Lindberg, David Beckham,
  Ray-Ban); остались Gentle Monster (101 товар), Maybach (74) и Jacques Marie
  Mage (59). Позже, 12.11.2026, оператор удалил товары Maybach и сам бренд из
  `catalog_id_mappings` (в скрипте бренд остаётся: повторный запуск стадии
  снова создаст эти товары, и тогда бренд нужно либо вернуть в справочник,
  либо убрать из скрипта); в справочнике 156 брендов;
- дубли: одинаковый набор URL фото — один товар, остаётся самая полная подпись
  (есть SIZE), при равенстве — самая свежая; близкие перевыкладки (тот же
  бренд/модель/размер, пересечение ≥ 60 % меньшего набора фото, разница
  ≥ 7 дней) тоже схлопываются. Расцветки одного поста не превышают 0.56
  Jaccard, поэтому порог 0.6 их не задевает;
- цветовая семья: подряд идущие в отфильтрованном списке товары одной
  модели и одного размера получают общий `variant_group_key`
  (md5 `ochki:brand:model:size`) и `variant_group_name` вида
  `Prada PR D15SD 54-20-145`; минимум 2 товара, галереи не склеиваются; имя
  семьи приводится к одному варианту, если посты пишут модель по-разному;
- категория/подкатегория принудительно `Аксессуары` / `Очки`; в `attributes`
  пишутся `album_merge_version`, `album_source_positions`,
  `album_duplicates_dropped`, `album_near_duplicates_dropped`, `brand_name`,
  `brand_source`, `model_code`, `size_label`.

Preview на сырье (46 276 карточек): `46 276 → 1 574` товара, 323 цветовые
семьи (1 285 товаров, медиана 3, самая большая — 20 расцветок Prada SPR C05),
289 одиночных товаров. Точных дублей отброшено 33, близких перевыкладок —
11. По годам: 2025 — 14, 2026 — 1 560. Бренды (22): Cartier 205, Miu Miu 169,
Dior 169, Prada 124, Louis Vuitton 103, Chanel 102, Gentle Monster 101,
Tom Ford 96, Maybach 74, Tiffany 62, Jacques Marie Mage 59, Saint Laurent 55,
Gucci 53, Fendi 44, остальные ≤ 30. У всех товаров есть бренд, модель, размер
и ≥ 5 фото; идемпотентность, пустой вход, уникальность `external_id` и
`source_position` проверены runner'ом на «сплющенном» входе, как в
production (`flattenDescription`).

Полный прогон v3 на сырье даёт 1 574 товара; в базе после ручных удалений
оператора 12.11.2026 осталось 1 354 товара и 21 бренд (Maybach удалён).

Ограничения:

- перевыкладка с полностью новыми фото того же цвета по тексту неотличима от
  новой расцветки: такие пары остаются, пока их не разберут визуально
  (в ленте, например, Prada SPR C05 публиковалась дважды — 10 карточек в мае
  и 10 в июле 2026);
- карточки-«лотки» с несколькими цветами в кадре (например, `#8536/#8537`
  Maybach THE LOEW) проходят как товар, если в подписи есть MODEL и SIZE;
- семья объединяет карточки одной модели из разных постов; если поставщик
  переснимал те же цвета, в семье окажутся повторы;
- карточки с моделью, но без SIZE, отброшены по выбору оператора (например,
  цветовые карточки `型号ch:4266:透明色`).

Инструкции для ИИ поставщика (`suppliers.ai_instructions`) пока не писались —
следующий шаг после постобработки.

Батч в стадии `SCRIPT_PROCESSED`: 1 354 товара, снапшоты «Сырой товар» →
«Обработан скриптом» (перезапуск 12.11.2026 на версии 3), сырой снимок
`Сырой товар` на месте (11.11.2026 18:06). Preview/повторный запуск
пересоберёт результат по активной версии 3 (md5 `ceabd2c8`).
