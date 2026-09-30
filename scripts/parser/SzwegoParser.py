import csv
import time
import requests
import json
import re
import os
import argparse
import sys
import io
from urllib.parse import urljoin
from bs4 import BeautifulSoup
from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo

try:
    MOSCOW_TZ = ZoneInfo("Europe/Moscow")
except Exception:
    # Windows Python may not ship the IANA timezone database. Moscow has no
    # daylight saving time, so UTC+3 is an exact operational fallback.
    MOSCOW_TZ = timezone(timedelta(hours=3))

# Принудительная кодировка UTF-8 для вывода в консоль (фикс для Windows)
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Настройка прокси и ретраев
def get_session():
    s = requests.Session()
    proxy = os.getenv('BOT_PROXY')
    if proxy:
        s.proxies = {"http": proxy, "https": proxy}
    
    # Добавляем автоматические повторы для сетевых ошибок (502, 503, 504)
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
    retries = Retry(total=3, backoff_factor=1, status_forcelist=[502, 503, 504])
    s.mount('https://', HTTPAdapter(max_retries=retries))
    s.mount('http://', HTTPAdapter(max_retries=retries))
    
    return s

def request_with_retry(session, method, url, max_retries=3, **kwargs):
    for i in range(max_retries):
        try:
            # Увеличиваем таймаут до 60 секунд
            kwargs['timeout'] = kwargs.get('timeout', 60)
            resp = session.request(method, url, **kwargs)
            resp.raise_for_status()
            return resp
        except (requests.exceptions.ReadTimeout, requests.exceptions.ConnectTimeout) as e:
            if i == max_retries - 1:
                raise
            print(f"⚠️ Timeout error (attempt {i+1}/{max_retries}), retrying in 5s... {e}")
            time.sleep(5)
        except Exception as e:
            if i == max_retries - 1:
                raise
            print(f"⚠️ Request error (attempt {i+1}/{max_retries}): {e}")
            time.sleep(2)
    return None

# ==========================================================

SZWEGO_BASE = "https://www.szwego.com"

# Каждый источник — тот же альбомный JSON-API, что использует веб-клиент Szwego.
MODE_ENDPOINTS = {
    "images": "/album/personal/image",   # альбомы / изображения
    "all": "/album/personal/all",        # 全部 / единая лента
    "video": "/album/personal/video",    # только видео-публикации
}

# Szwego отдаёт ~32 поста на страницу. Недокументированный `limit` поднимает
# размер страницы: проверено на боевом API — limit работает до 3999,
# limit=4000 возвращает errcode 1001002 «未知的搜索错误».
BULK_LIMIT_MAX = 3999
BULK_LIMIT_DEFAULT = 1000

# Первую страницу Szwego запрашивает с timestamp=-1: только такой ответ
# содержит закреплённые поставщиком посты (isTop). Обход с текущим timestamp их
# не видит вовсе. Закрепы — обычно старые промо и подборки, поэтому в выгрузку
# они не попадают без явного --include_pinned, но учитываются в полноте обхода.
FIRST_PAGE_TIMESTAMP = -1

SHOP_INFO_FIELDS = (
    "name", "id", "totalItemCount", "popularity", "online", "isFollowed", "isMy",
    "hasVideo", "isHasTag", "icon", "userType", "desc",
)

# Ответы Szwego, которые оператор должен видеть словами, а не кодом.
SZWEGO_ERROR_HINTS = {
    9: "Сессия Szwego истекла: обновите Cookie поставщика.",
    1019: "Магазин поставщика закрыт или недоступен для просмотра (已临时打烊). Свяжитесь с поставщиком или проверьте доступ к магазину.",
    2210013: "Szwego не подтвердил доступ к магазину: проверьте, что аккаунт с Cookie видит этот альбом.",
    2210024: "Этот адрес Szwego принимает только POST-запрос.",
    1001002: "Szwego отклонил недокументированный размер страницы.",
}

def _describe_api_error(data):
    """Ошибка Szwego одной строкой: код, китайский текст и подсказка оператору."""
    errcode = (data or {}).get("errcode")
    errmsg = (data or {}).get("errmsg") or ""
    base = f"Szwego вернул ошибку {errcode}: {errmsg}".strip()
    hint = SZWEGO_ERROR_HINTS.get(errcode)
    return f"{base}. {hint}" if hint else base

def _moscow_today() -> date:
    return datetime.now(MOSCOW_TZ).date()

def _parse_date_from_text(text: str) -> date | None:
    if not text: return None
    text = text.strip().lower()
    today = _moscow_today()
    if re.search(r"(刚刚|刚才|just now|только что|\d+\s*(?:秒|seconds?|сек\w*)\s*(?:前|ago)?|\d+\s*(?:分钟|分|minutes?|mins?|мин\w*)\s*(?:前|ago)?|\d+\s*(?:小时|hours?|hrs?|час\w*)\s*(?:前|ago)?)", text):
        return today
    if re.search(r"(昨天|yesterday|вчера)", text):
        return today - timedelta(days=1)
    days_ago = re.search(r"(\d+)\s*(?:天|days?|дн\w*)\s*(?:前|ago)?", text)
    if days_ago:
        return today - timedelta(days=int(days_ago.group(1)))
    m = re.search(r"(\d{4})[./-](\d{2})[./-](\d{2})", text)
    if m:
        try: return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError: pass
    m = re.search(r"(\d{2})[./-](\d{2})", text)
    if m:
        try: return date(today.year, int(m.group(1)), int(m.group(2)))
        except ValueError: pass
    return None

def _parse_timestamp(value) -> date | None:
    try:
        timestamp = float(value)
        if timestamp > 10_000_000_000:
            timestamp /= 1000.0
        return datetime.fromtimestamp(timestamp, tz=MOSCOW_TZ).date()
    except (TypeError, ValueError, OSError, OverflowError):
        return None

def _parse_date_from_item_fields(item: dict) -> date | None:
    for k in ("createTime", "create_time", "createdTime", "created_time", "uploadTime", "upload_time", "time", "date", "time_stamp", "update_time", "new_send_time"):
        v = item.get(k)
        if v is None: continue
        if isinstance(v, (int, float)):
            d = _parse_timestamp(v)
            if d: return d
        if isinstance(v, str):
            if re.fullmatch(r"\d{10,13}", v.strip()):
                d = _parse_timestamp(v)
                if d: return d
            d = _parse_date_from_text(v)
            if d: return d
    return None

def _fetch_date_from_goods_page(session, url, headers):
    if not url: return None
    try:
        resp = request_with_retry(session, "GET", url, headers=headers)
        if not resp: return None
        soup = BeautifulSoup(resp.text, "html.parser")
        el = soup.select_one('div[class*="shopinfo_time_text"]')
        if not el: return None
        return _parse_date_from_text(el.get_text(strip=True))
    except Exception:
        return None

def get_item_date(item, session, album_id, headers):
    d = _parse_date_from_item_fields(item)
    if d: return d
    for k in ("goodsUrl", "goods_url", "detailUrl", "detail_url", "url", "link"):
        url = item.get(k)
        if isinstance(url, str) and url.strip():
            d = _fetch_date_from_goods_page(session, urljoin(SZWEGO_BASE, url.strip()), headers)
            if d: return d
    goods_id = item.get("goods_id", "") or item.get("selfGoodsId", "")
    if goods_id:
        url = f"{SZWEGO_BASE}/static/index.html#/shop_detail/{album_id}/goods_detail/{goods_id}"
        d = _fetch_date_from_goods_page(session, url, headers)
        if d: return d
    return None

VIDEO_URL_KEYS = {
    "videoUrl", "videoURL", "video_url", "video", "playUrl", "playURL", "play_url",
    "src", "url", "source", "downloadUrl", "download_url",
}
POSTER_URL_KEYS = {
    "poster", "posterUrl", "posterURL", "poster_url", "cover", "coverUrl", "cover_url",
    "coverImage", "cover_image", "thumbnail", "thumb", "firstFrame", "first_frame",
}

TAG_ID_KEYS = ("tagId", "tag_id")
TAG_NAME_KEYS = ("tagName", "tag_name", "name")
GROUP_ID_KEYS = ("tagGroupId", "tag_group_id", "groupId", "group_id")
GROUP_NAME_KEYS = ("tagGroupName", "tag_group_name", "groupName", "group_name", "name")

def _first_nonempty_string(data, keys):
    if not isinstance(data, dict):
        return ""
    for key in keys:
        value = data.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""

def _collect_szwego_tags(value, found, seen, parent_key=""):
    """Collect typed tag/group references without treating arbitrary item IDs as tags."""
    if isinstance(value, list):
        for item in value:
            _collect_szwego_tags(item, found, seen, parent_key)
        return
    if not isinstance(value, dict):
        return

    parent_is_tag = "tag" in parent_key.lower()
    parent_is_group = "group" in parent_key.lower()
    tag_id = _first_nonempty_string(value, TAG_ID_KEYS)
    tag_name = _first_nonempty_string(value, TAG_NAME_KEYS)
    group_id = _first_nonempty_string(value, GROUP_ID_KEYS)
    group_name = _first_nonempty_string(value, GROUP_NAME_KEYS)

    # Some Szwego responses nest a tag/group object under a descriptive key and
    # use a generic `id`; accept that only together with a human-readable name.
    generic_id = _first_nonempty_string(value, ("id",))
    if not tag_id and parent_is_tag and not parent_is_group and tag_name:
        tag_id = generic_id
    if not group_id and parent_is_group and group_name:
        group_id = generic_id

    for item_type, label, item_id in (("tag", tag_name, tag_id), ("group", group_name, group_id)):
        if not label or not item_id:
            continue
        key = f"{item_type}:{item_id}"
        if key in seen:
            continue
        seen.add(key)
        found.append({"type": item_type, "label": label, "value": item_id})

    for key, child in value.items():
        _collect_szwego_tags(child, found, seen, key)

def _item_has_szwego_tag_id(value, wanted_id, parent_key=""):
    """Match a selected Szwego tag in an item from the full timeline response."""
    wanted = str(wanted_id or "").strip()
    if not wanted:
        return False
    if isinstance(value, list):
        return any(_item_has_szwego_tag_id(item, wanted, parent_key) for item in value)
    if not isinstance(value, dict):
        return False

    for key in TAG_ID_KEYS:
        if str(value.get(key) or "").strip() == wanted:
            return True

    # Some responses use a generic `id` inside a `tag`/`tags` object.
    if "tag" in parent_key.lower() and "group" not in parent_key.lower():
        if str(value.get("id") or "").strip() == wanted:
            return True

    return any(_item_has_szwego_tag_id(child, wanted, key) for key, child in value.items())

def _item_tag_labels(item):
    """Human-readable tag labels of one post (used by the preview statistics)."""
    labels = []
    tags_raw = item.get("tags")
    entries = tags_raw if isinstance(tags_raw, list) else ([tags_raw] if tags_raw else [])
    for entry in entries:
        if isinstance(entry, dict):
            label = _first_nonempty_string(entry, TAG_NAME_KEYS)
        elif isinstance(entry, str):
            label = entry.strip()
        else:
            label = ""
        if label:
            labels.append(label)
    return labels

def _album_params(album_id, timestamp, bulk_limit=0):
    params = {
        "albumId": album_id,
        "searchValue": "",
        "searchImg": "",
        "startDate": "",
        "endDate": "",
        "transLang": "en",
        "requestDataType": "",
        "timestamp": timestamp,
    }
    if bulk_limit:
        params["limit"] = bulk_limit
    return params

def fetch_album_page(session, headers, album_id, mode, timestamp, bulk_limit=0, tag_id="", group_id=""):
    """Одна страница альбома. mode: images | all | video."""
    url = SZWEGO_BASE + MODE_ENDPOINTS[mode]
    params = _album_params(album_id, timestamp, bulk_limit)
    if mode == "images" and group_id:
        params["tagGroupId"] = group_id
        response = request_with_retry(session, "POST", url, params=params, data={"tagList": "[]"}, headers=headers)
    elif mode == "images" and tag_id:
        response = request_with_retry(session, "POST", url, params=params, data={"tagList": f"[{tag_id}]"}, headers=headers)
    else:
        response = request_with_retry(session, "GET", url, params=params, headers=headers)
    if not response:
        return None
    return response.json()

def fetch_page_resilient(session, headers, args, mode, timestamp, bulk_limit):
    """Крупная страница с одним повтором.

    Szwego изредка отвечает errcode 1001002 на крупную страницу. Повторяем тот
    же запрос один раз и только потом возвращаемся к штатному размеру страницы,
    чтобы разовый сбой не превращал всю выгрузку в постраничную. Прочие ошибки
    (истёкшая сессия, закрытый магазин) возвращаются как есть: повторять их
    бессмысленно, а оператору нужен точный текст.
    """
    data = fetch_album_page(session, headers, args.album_id, mode, timestamp, bulk_limit, args.tag_id, args.group_id)
    if data is None or data.get("success") or not bulk_limit:
        return data, bulk_limit
    if data.get("errcode") != 1001002:
        return data, bulk_limit

    retry = fetch_album_page(session, headers, args.album_id, mode, timestamp, bulk_limit, args.tag_id, args.group_id)
    if retry is not None and retry.get("success"):
        return retry, bulk_limit

    print(f"⚠️ Szwego отклонил limit={bulk_limit} ({data.get('errcode')}: {data.get('errmsg')}); переходим на постраничный режим.", file=sys.stderr)
    return fetch_album_page(session, headers, args.album_id, mode, timestamp, 0, args.tag_id, args.group_id), 0

def _shop_info(data):
    """Метаданные просматриваемого магазина: имя, аватар, всего постов, онлайн."""
    result = (data or {}).get("result") or {}
    album = result.get("targetAlbum") or {}
    return {key: album.get(key) for key in SHOP_INFO_FIELDS if album.get(key) not in (None, "")}

def _fetch_szwego_tag_references(session, album_id, headers):
    """Read the category tree from one Szwego response, never the whole product feed."""
    found = []
    seen = set()

    data = fetch_album_page(session, headers, album_id, "images", int(time.time() * 1000), 1)
    if data is not None and not data.get("success"):
        # Дерево категорий приходит в любом успешном ответе: если крупная
        # страница отклонена, повторяем запрос штатным размером.
        data = fetch_album_page(session, headers, album_id, "images", int(time.time() * 1000), 0)
    if not data:
        raise RuntimeError("Не удалось получить дерево категорий от Szwego")
    if not data.get("success"):
        if data.get("errcode") == 9:
            raise RuntimeError("Сессия Szwego истекла. Обновите Cookie поставщика.")
        raise RuntimeError(data.get("errmsg") or "Szwego не вернул дерево категорий")

    # The category dialog is populated from this response: groups have
    # `groupId`/`groupName`; albums inside them have `tagId`/`tagName`.
    _collect_szwego_tags(data.get("result") or {}, found, seen)

    return found

def _normalize_media_url(value):
    if not isinstance(value, str):
        return ""
    url = value.strip()
    if url.startswith("//"):
        return "https:" + url
    return url

def _find_video_url(value):
    """Szwego has returned videoUrl both at the item root and nested in media objects."""
    if isinstance(value, dict):
        for key in VIDEO_URL_KEYS:
            candidate = _find_video_url(value.get(key))
            if candidate:
                return candidate
        for child in value.values():
            candidate = _find_video_url(child)
            if candidate:
                return candidate
    elif isinstance(value, list):
        for child in value:
            candidate = _find_video_url(child)
            if candidate:
                return candidate
    elif isinstance(value, str):
        candidate = _normalize_media_url(value)
        if re.search(r"(?:\.mp4(?:$|[?#])|/pvod/|\.m3u8(?:$|[?#]))", candidate, re.IGNORECASE):
            return candidate
    return ""

def _find_video_poster(value):
    if isinstance(value, dict):
        for key in POSTER_URL_KEYS:
            candidate = _normalize_media_url(value.get(key))
            if candidate and re.search(r"\.(?:jpe?g|png|webp)(?:$|[?#])", candidate, re.IGNORECASE):
                return candidate
        for child in value.values():
            candidate = _find_video_poster(child)
            if candidate:
                return candidate
    elif isinstance(value, list):
        for child in value:
            candidate = _find_video_poster(child)
            if candidate:
                return candidate
    return ""

def evaluate_item(item, args, session, headers, album_id, seen_photo_keys=None):
    """Правила выбранного режима для одной публикации.

    Возвращает (row, skip_reason, item_date). row — та же строка, что попадает
    в экспорт, поэтому предпросмотр статистики считает ровно те же правила.
    """
    goods_id = item.get("goods_id", "") or item.get("selfGoodsId", "")
    if not goods_id:
        goods_id = f"auto_{int(time.time() * 1000)}"

    raw_text = (item.get("content", "") or item.get("title", "") or item.get("remark", "") or item.get("goods_name", "") or "")

    # «集合图» — служебная подборка, а не товар. В единой ленте её сохраняют
    # ради постобработки, в альбомном режиме она отбрасывается.
    if args.parse_mode == "images" and "集合图" in raw_text:
        return None, "collection_image", None

    description = " ".join(raw_text.replace("\r", " ").replace("\n", " ").split())

    tags_list = []
    if args.parse_tags:
        tags_raw = item.get("tags", [])
        if isinstance(tags_raw, list):
            for tag in tags_raw:
                if isinstance(tag, dict) and "tagName" in tag:
                    val = str(tag["tagName"]).strip()
                    if val: tags_list.append(val)
                elif isinstance(tag, str) and tag.strip():
                    tags_list.append(tag.strip())
        elif isinstance(tags_raw, dict) and "tagName" in tags_raw:
            val = str(tags_raw["tagName"]).strip()
            if val: tags_list.append(val)
        elif isinstance(tags_raw, str) and tags_raw.strip():
            tags_list.append(tags_raw.strip())

        if tags_list:
            description += " " + " ".join(tags_list)

    if args.parse_mode == "images" and len(description) < args.min_desc:
        return None, "short_description", None
    if args.parse_mode == "video" and args.min_desc and len(description) < args.min_desc:
        return None, "short_description", None

    imgs_src = item.get("imgsSrc", []) or item.get("imgs", []) or []
    photos = [u.strip() for u in imgs_src if u and u.strip()]
    video_url = _find_video_url(item)
    video_poster_url = _find_video_poster(item)

    # Szwego может вернуть обычные фотографии и videoUrl в одной публикации.
    # Сохраняем изображения, а само видео передаём отдельно в технических
    # атрибутах.
    photos = [
        photo for photo in photos
        if photo != video_url and not re.search(r"(?:\.mp4(?:$|[?#])|/pvod/)", photo, re.IGNORECASE)
    ]

    # Видео само по себе является товарным медиа: не отбрасываем альбом с видео
    # только потому, что в нем меньше обычных фото.
    if args.parse_mode in ("images", "video") and len(photos) < args.min_photos and not video_url:
        return None, "few_photos", None

    item_date = _parse_date_from_item_fields(item) or _parse_date_from_text(description)
    if not item_date:
        item_date = get_item_date(item, session, album_id, headers)

    photo_key = tuple(sorted(set(photos)))
    if args.parse_mode == "images" and seen_photo_keys is not None and photo_key in seen_photo_keys:
        return None, "dup_photo", item_date

    attributes = {
        "szwego_parse_mode": args.parse_mode,
        "szwego_timestamp": item.get("time_stamp") or item.get("update_time") or item.get("new_send_time"),
    }
    if video_url:
        attributes["szwego_video_url"] = video_url
    if video_poster_url:
        attributes["szwego_video_poster_url"] = video_poster_url
    if tags_list:
        # Keep the identity signal separately from the human/AI source text.
        # Supplier post-processors can compare these labels without guessing
        # where the appended text begins.
        attributes["szwego_tags"] = list(dict.fromkeys(tags_list))
    attributes = {key: value for key, value in attributes.items() if value not in (None, "")}

    row = [goods_id, "", description, int(args.default_price), args.brand, args.category, args.subcategory, args.gender, json.dumps(photos, ensure_ascii=False), attributes, item_date.isoformat() if item_date else None]
    return row, None, item_date

def _histogram(values, definitions):
    counts = {label: 0 for label, _ in definitions}
    for value in values:
        for label, predicate in definitions:
            if predicate(value):
                counts[label] += 1
                break
    return counts

PHOTO_BUCKETS = (
    ("0", lambda n: n == 0),
    ("1", lambda n: n == 1),
    ("2", lambda n: n == 2),
    ("3-5", lambda n: 3 <= n <= 5),
    ("6-10", lambda n: 6 <= n <= 10),
    ("11+", lambda n: n >= 11),
)
DESC_BUCKETS = (
    ("0-9", lambda n: n < 10),
    ("10-19", lambda n: 10 <= n < 20),
    ("20-49", lambda n: 20 <= n < 50),
    ("50-99", lambda n: 50 <= n < 100),
    ("100+", lambda n: n >= 100),
)

def collect_feed_stats(session, headers, args, mode, progress_label):
    """Полный проход одного источника альбома для предпросмотра (без экспорта)."""
    feed = {
        "posts": 0,
        "unique_goods": 0,
        "pinned": 0,
        "with_video": 0,
        "text_only": 0,
        "kept": 0,
        "skipped": {},
        "photos": {label: 0 for label, _ in PHOTO_BUCKETS},
        "description": {label: 0 for label, _ in DESC_BUCKETS},
        "months": {},
        "top_tags": [],
        "first_post": None,
        "last_post": None,
    }
    seen_goods = set()
    seen_photo_keys = {}
    tag_counts = {}
    probe = argparse.Namespace(**vars(args))
    probe.parse_mode = mode
    if probe.min_desc is None:
        # Тот же порог по умолчанию, что и в выгрузке: альбомы отбрасывают
        # короткие подписи, лента и видео — нет.
        probe.min_desc = 10 if mode == "images" else 0

    bulk_limit = 0 if args.no_bulk else max(0, min(args.limit, BULK_LIMIT_MAX))
    timestamp_val = FIRST_PAGE_TIMESTAMP
    page_idx = 0

    while True:
        data, bulk_limit = fetch_page_resilient(session, headers, probe, mode, timestamp_val, bulk_limit)
        if data is None:
            feed["error"] = "Szwego не ответил"
            break
        if not data.get("success"):
            feed["error"] = _describe_api_error(data)
            break

        result = data.get("result") or {}
        raw_items = result.get("items", [])
        if not raw_items:
            break
        page_idx += 1
        if not feed.get("shop"):
            feed["shop"] = _shop_info(data)
            feed["album_total_posts"] = (result.get("targetAlbum") or {}).get("totalItemCount")
        # Тег в единой и видео-ленте отбирается по самой публикации, как в экспорте.
        if mode in ("all", "video") and args.tag_id:
            items = [item for item in raw_items if _item_has_szwego_tag_id(item, args.tag_id)]
            feed["tag_skipped"] = feed.get("tag_skipped", 0) + (len(raw_items) - len(items))
        else:
            items = raw_items

        for item in items:
            if item.get("isTop") and not args.include_pinned:
                feed["pinned"] += 1
                continue
            row, skip_reason, item_date = evaluate_item(item, probe, session, headers, args.album_id, seen_photo_keys)
            feed["posts"] += 1
            goods_id = item.get("goods_id", "") or item.get("selfGoodsId", "")
            if goods_id:
                seen_goods.add(goods_id)
            if _find_video_url(item):
                feed["with_video"] += 1
            photos = row[8] if row else (item.get("imgsSrc", []) or item.get("imgs", []) or [])
            photo_count = len(json.loads(photos)) if isinstance(photos, str) else len(photos)
            description = row[2] if row else (item.get("content", "") or item.get("title", "") or "")
            feed["photos"][next(label for label, test in PHOTO_BUCKETS if test(photo_count))] += 1
            feed["description"][next(label for label, test in DESC_BUCKETS if test(len(description)))] += 1
            if photo_count == 0 and not _find_video_url(item):
                feed["text_only"] += 1
            for label in _item_tag_labels(item):
                tag_counts[label] = tag_counts.get(label, 0) + 1
            if skip_reason:
                feed["skipped"][skip_reason] = feed["skipped"].get(skip_reason, 0) + 1
                continue
            if item_date:
                iso_date = item_date.isoformat()
                if feed["first_post"] is None or iso_date > feed["first_post"]:
                    feed["first_post"] = iso_date
                if feed["last_post"] is None or iso_date < feed["last_post"]:
                    feed["last_post"] = iso_date
                month = iso_date[:7]
                feed["months"][month] = feed["months"].get(month, 0) + 1
            photo_key = tuple(sorted(set(json.loads(row[8]) if isinstance(row[8], str) else row[8])))
            if mode == "images":
                seen_photo_keys[photo_key] = True
            feed["kept"] += 1

        print(f"PROGRESS:{feed['posts']}", flush=True)
        print(f"[stats:{progress_label}] page {page_idx}: {len(raw_items)} posts, kept {feed['kept']}", flush=True)

        pagination = result.get("pagination") or {}
        if not pagination.get("isLoadMore"):
            break
        timestamp_val = pagination["pageTimestamp"]

    feed["unique_goods"] = len(seen_goods)
    feed["top_tags"] = [
        {"label": label, "count": count}
        for label, count in sorted(tag_counts.items(), key=lambda pair: (-pair[1], pair[0]))[:20]
    ]
    feed["months"] = dict(sorted(feed["months"].items()))
    return feed

def run_stats(args, session, headers):
    """Предпросмотр альбома: что и сколько можно выгрузить в каждом режиме."""
    stats = {"album_id": args.album_id, "modes": {}, "shop": {}}
    for mode in ("all", "images", "video"):
        feed = collect_feed_stats(session, headers, args, mode, mode)
        stats["shop"] = stats["shop"] or feed.get("shop") or {}
        stats["album_total_posts"] = feed.get("album_total_posts")
        feed.pop("shop", None)
        feed.pop("album_total_posts", None)
        stats["modes"][mode] = feed
    stats["filters"] = {
        "min_photos": args.min_photos,
        # Без явного порога у каждого источника своё поведение по умолчанию.
        "min_desc": args.min_desc if args.min_desc is not None else {"images": 10, "all": 0, "video": 0},
        "tag_id": args.tag_id or None,
    }
    print("SZWEGO_STATS:" + json.dumps(stats, ensure_ascii=False))
    return stats

def main():
    parser = argparse.ArgumentParser(description="Szwego Parser")
    parser.add_argument("--album_id", required=True, help="Album ID")
    parser.add_argument("--cookie", required=True, help="Cookie string")
    parser.add_argument(
        "--parse_mode",
        choices=("images", "all", "video"),
        default="images",
        help="Szwego source: image albums (default), the 全部 timeline, or video posts only",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=BULK_LIMIT_DEFAULT,
        help=f"Размер страницы альбомного API (до {BULK_LIMIT_MAX}). 0 — штатные страницы Szwego",
    )
    parser.add_argument("--no_bulk", action="store_true", help="Не использовать крупные страницы API")
    parser.add_argument("--stats", action="store_true", help="Предпросмотр: сколько постов даст каждый режим, и выйти")
    parser.add_argument(
        "--include_pinned",
        action="store_true",
        help="Включить закреплённые поставщиком посты (isTop) в выгрузку",
    )
    parser.add_argument("--end_date", help="Stop date (YYYY-MM-DD)")
    parser.add_argument("--group_id", default="", help="Group ID filter")
    parser.add_argument("--tag_id", default="", help="Tag ID filter")
    parser.add_argument("--output", default="szwego.json", help="Output path")
    parser.add_argument("--format", choices=("json", "csv"), default="json", help="Output format")
    parser.add_argument("--min_photos", type=int, default=3)
    parser.add_argument(
        "--min_desc",
        type=int,
        default=None,
        help="Минимальная длина описания. Без флага: 10 для альбомов, без ограничения для ленты и видео",
    )
    parser.add_argument("--category", default="")
    parser.add_argument("--subcategory", default="")
    parser.add_argument("--brand", default="")
    parser.add_argument("--gender", default="")
    parser.add_argument("--default_price", type=float, default=0.0)
    parser.add_argument("--parse_tags", action="store_true")
    parser.add_argument("--list_tags", action="store_true", help="List visible Szwego tag/group names with their IDs and exit")
    
    parser.add_argument('--get_avatar', action='store_true', help='Only fetch shop avatar and exit')
    args = parser.parse_args()

    # Headers
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Cookie": args.cookie,
        "Referer": f"{SZWEGO_BASE}/static/index.html#shop_detail/{args.album_id}",
    }

    session = get_session()

    # РЕЖИМ ПОЛУЧЕНИЯ АВАТАРКИ
    if args.get_avatar:
        try:
            data = fetch_album_page(session, headers, args.album_id, "images", int(time.time() * 1000), 1)
            if not data:
                print(f"AVATAR_ERROR: Request failed")
                sys.exit(0)
            info = _shop_info(data)
            if data.get('success') and info.get('icon'):
                logo = info['icon']
                if logo.startswith('//'): logo = 'https:' + logo
                print(f"AVATAR_RESULT:{logo}")
            else:
                print(f"AVATAR_ERROR:No logo found")
        except Exception as e:
            print(f"AVATAR_ERROR:{e}")
        sys.exit(0)

    if args.list_tags:
        try:
            tags = _fetch_szwego_tag_references(session, args.album_id, headers)
            print("SZWEGO_TAGS_RESULT:" + json.dumps(tags, ensure_ascii=False))
        except Exception as e:
            print(f"SZWEGO_TAGS_ERROR:{e}", file=sys.stderr)
            sys.exit(1)
        sys.exit(0)

    if args.stats:
        try:
            run_stats(args, session, headers)
        except Exception as e:
            print(f"SZWEGO_STATS_ERROR:{e}", file=sys.stderr)
            sys.exit(1)
        sys.exit(0)

    # Проверка доступа к папке
    try:
        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    except Exception as e:
        print(f"DEBUG: Failed to create directory: {e}", file=sys.stderr)
        sys.exit(1)

    if args.min_desc is None:
        # Альбомный режим исторически отбрасывает короткие подписи по умолчанию;
        # единая лента и видео сохраняют публикации, пока оператор не задал порог.
        args.min_desc = 10 if args.parse_mode == "images" else 0

    all_rows = []
    skip_reasons = {}
    seen_photo_keys = {}
    seen_by_goods_id = {}
    
    page_idx = 1
    timestamp_val = FIRST_PAGE_TIMESTAMP
    parsed_end_date = _parse_date_from_text(args.end_date) if args.end_date else None
    # Крупные страницы API: одно обращение вместо десятков. Если Szwego
    # отклонит limit, парсер вернётся к штатным страницам на ходу.
    bulk_limit = 0 if args.no_bulk else max(0, min(args.limit, BULK_LIMIT_MAX))

    print(f"Starting parse for Album: {args.album_id} (mode: {args.parse_mode}, limit: {bulk_limit or 'default'})")
    if args.group_id: print(f"Group: {args.group_id}")
    if args.tag_id: print(f"Tag: {args.tag_id}")

    shop_info = {}
    expected_total = None
    pinned_skipped = 0
    newest_post = None
    oldest_post = None
    api_error = None

    csv_header = ["external_id", "name", "description", "price", "brand", "category", "subcategory", "gender", "photos"]

    try:
        while True:
            data, bulk_limit = fetch_page_resilient(session, headers, args, args.parse_mode, timestamp_val, bulk_limit)

            if data is None:
                print("❌ ОШИБКА: Не удалось получить данные от Szwego после нескольких попыток.")
                break

            if not data.get("success"):
                if data.get("errcode") == 9:
                    print("❌ ОШИБКА: Ваша сессия (Cookie) истекла. Пожалуйста, обновите Cookie в настройках поставщика в админке.")
                    sys.exit(1)
                # Текст ошибки печатается один раз — в итоговом блоке, вместе с
                # понятной причиной пустой выгрузки.
                api_error = _describe_api_error(data)
                break

            if not shop_info:
                shop_info = _shop_info(data)
                if shop_info:
                    print("SHOP_INFO:" + json.dumps(shop_info, ensure_ascii=False), flush=True)
                expected_total = ((data.get("result") or {}).get("targetAlbum") or {}).get("totalItemCount")

            raw_items = data.get("result", {}).get("items", [])
            if not raw_items: break
            items = raw_items
            # В единой ленте и в видео-ленте тег выбирается сервером не всегда,
            # поэтому отбор идёт по тегам самой публикации.
            if args.parse_mode in ("all", "video") and args.tag_id:
                items = [item for item in raw_items if _item_has_szwego_tag_id(item, args.tag_id)]

            page_saved = 0
            date_skip_count = 0

            for item in items:
                # Закрепы поставщика приходят только на первой странице и по
                # умолчанию не становятся товарами: это старые промо и подборки.
                if item.get("isTop") and not args.include_pinned:
                    pinned_skipped += 1
                    continue
                row, skip_reason, item_date = evaluate_item(item, args, session, headers, args.album_id, seen_photo_keys)
                if item_date:
                    # Границы периода нужны для понятной ошибки, когда фильтр по
                    # дате отбрасывает весь альбом.
                    if newest_post is None or item_date > newest_post:
                        newest_post = item_date
                    if oldest_post is None or item_date < oldest_post:
                        oldest_post = item_date
                if skip_reason:
                    skip_reasons[skip_reason] = skip_reasons.get(skip_reason, 0) + 1
                    continue

                goods_id = row[0]
                description = row[2]
                photos = json.loads(row[8])
                photo_key = tuple(sorted(set(photos)))

                # Debug first item of first page
                if page_idx == 1 and not all_rows and page_saved == 0:
                    print(f"Debug [First Item]: ID={goods_id}, Date={item_date}, DescLen={len(description)}, Photos={len(photos)}")

                if parsed_end_date and item_date and item_date < parsed_end_date:
                    date_skip_count += 1
                    skip_reasons["old_date"] = skip_reasons.get("old_date", 0) + 1
                    continue

                if goods_id in seen_by_goods_id:
                    old_info = seen_by_goods_id[goods_id]
                    if len(description) > old_info["desc_len"]:
                        all_rows[old_info["idx"]] = row
                        seen_by_goods_id[goods_id]["desc_len"] = len(description)
                    continue

                all_rows.append(row)
                page_saved += 1
                if args.parse_mode == "images":
                    seen_photo_keys[photo_key] = len(all_rows) - 1
                seen_by_goods_id[goods_id] = {"idx": len(all_rows) - 1, "desc_len": len(description)}

            print(f"PROGRESS:{len(all_rows)}", flush=True)
            print(f"Page {page_idx}: saved {page_saved}. Total: {len(all_rows)}", flush=True)
            
            if len(items) > 0 and page_saved == 0 and date_skip_count > 0:
                print(f"Reached end date: {args.end_date}")
                break

            pagination = data.get("result", {}).get("pagination") or {}
            if not pagination.get("isLoadMore"): break
            timestamp_val = pagination["pageTimestamp"]
            page_idx += 1

    finally:
        if skip_reasons:
            print(f"Skip reasons: {skip_reasons}")
            
        with open(args.output, "w", newline="", encoding="utf-8") as f:
            if args.format == "json":
                products = [
                    {
                        **dict(zip(csv_header, row)),
                        "photos": json.loads(row[8]) if row[8] else [],
                        "attributes": row[9] if len(row) > 9 else {},
                        "supplier_published_on": row[10] if len(row) > 10 else None,
                        "source_position": index,
                    }
                    for index, row in enumerate(all_rows)
                ]
                json.dump(products, f, ensure_ascii=False)
            else:
                writer = csv.writer(f, delimiter=";", lineterminator="\n")
                writer.writerow(csv_header)
                if all_rows:
                    writer.writerows(row[:len(csv_header)] for row in all_rows)

        summary = {
            "mode": args.parse_mode,
            "fetched": len(all_rows),
            "album_total_posts": expected_total,
            "pinned_skipped": pinned_skipped,
            "limit": bulk_limit or "default",
            "shop": shop_info,
            "skipped": skip_reasons,
            "newest_post": newest_post.isoformat() if newest_post else None,
            "oldest_post": oldest_post.isoformat() if oldest_post else None,
        }
        print("SZWEGO_SUMMARY:" + json.dumps(summary, ensure_ascii=False), flush=True)
        if pinned_skipped:
            print(f"PINNED:{pinned_skipped}", flush=True)

        # Полнота выгрузки проверяется только там, где источник отдаёт все посты
        # альбома без локальных фильтров. Закрепы входят в totalItemCount, но по
        # умолчанию не выгружаются, поэтому они прибавляются к собранному.
        if args.parse_mode == "all" and expected_total and not args.end_date and not args.tag_id and not args.group_id:
            collected = len(all_rows) + pinned_skipped
            if collected < expected_total:
                print(f"⚠️ Szwego сообщает {expected_total} постов, собрано {collected} (из них закреплённых {pinned_skipped}). Проверьте Cookie и повторите выгрузку.", file=sys.stderr)
        
        if all_rows:
            print(f"Final: Saved {len(all_rows)} items to {args.output}")
        else:
            print("No items found.")

    # Пустой результат — это провал выгрузки, а не успех с пустым файлом:
    # админка и Telegram показывают оператору причину из stderr.
    if not all_rows:
        if api_error:
            print(f"❌ {api_error}", file=sys.stderr)
        elif skip_reasons.get("old_date") and parsed_end_date and newest_post:
            print(
                f"❌ Публикаций позже {args.end_date} нет: последняя публикация в альбоме — {newest_post.isoformat()}. "
                f"Выберите «Все время» или более раннюю дату.",
                file=sys.stderr,
            )
        elif skip_reasons.get("old_date") and parsed_end_date:
            print(
                f"❌ Публикаций позже {args.end_date} в альбоме нет. Выберите «Все время» или более раннюю дату.",
                file=sys.stderr,
            )
        elif pinned_skipped and expected_total and pinned_skipped >= expected_total:
            print("❌ В альбоме только закреплённые публикации. Включите их флагом --include_pinned.", file=sys.stderr)
        else:
            detail = ", ".join(f"{reason}: {count}" for reason, count in sorted(skip_reasons.items())) or "совпадений нет"
            print(
                f"❌ Под настройки поставщика не подошла ни одна публикация ({detail}). "
                f"Проверьте пороги «мин. фото» и «мин. символов» или выберите другой источник.",
                file=sys.stderr,
            )
        sys.exit(1)

if __name__ == "__main__":
    main()
