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
            d = _fetch_date_from_goods_page(session, urljoin("https://www.szwego.com", url.strip()), headers)
            if d: return d
    goods_id = item.get("goods_id", "") or item.get("selfGoodsId", "")
    if goods_id:
        url = f"https://www.szwego.com/static/index.html#/shop_detail/{album_id}/goods_detail/{goods_id}"
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

def _fetch_szwego_tag_references(session, album_id, headers):
    """Read the category tree from one Szwego response, never the whole product feed."""
    found = []
    seen = set()

    params = {
        "albumId": album_id,
        "searchValue": "",
        "searchImg": "",
        "startDate": "",
        "endDate": "",
        "transLang": "en",
        "requestDataType": "",
        "timestamp": int(time.time() * 1000),
    }
    response = request_with_retry(
        session,
        "GET",
        "https://www.szwego.com/album/personal/image",
        params=params,
        headers=headers,
        max_retries=1,
        timeout=15,
    )
    if not response:
        raise RuntimeError("Не удалось получить дерево категорий от Szwego")
    data = response.json()
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

def main():
    parser = argparse.ArgumentParser(description="Szwego Parser")
    parser.add_argument("--album_id", required=True, help="Album ID")
    parser.add_argument("--cookie", required=True, help="Cookie string")
    parser.add_argument(
        "--parse_mode",
        choices=("images", "all"),
        default="images",
        help="Szwego source: image albums (default) or the 全部 timeline",
    )
    parser.add_argument("--end_date", help="Stop date (YYYY-MM-DD)")
    parser.add_argument("--group_id", default="", help="Group ID filter")
    parser.add_argument("--tag_id", default="", help="Tag ID filter")
    parser.add_argument("--output", default="szwego.json", help="Output path")
    parser.add_argument("--format", choices=("json", "csv"), default="json", help="Output format")
    parser.add_argument("--min_photos", type=int, default=3)
    parser.add_argument("--min_desc", type=int, default=10)
    parser.add_argument("--category", default="")
    parser.add_argument("--subcategory", default="")
    parser.add_argument("--brand", default="")
    parser.add_argument("--gender", default="")
    parser.add_argument("--default_price", type=float, default=0.0)
    parser.add_argument("--parse_tags", action="store_true")
    parser.add_argument("--list_tags", action="store_true", help="List visible Szwego tag/group names with their IDs and exit")
    
    parser.add_argument('--get_avatar', action='store_true', help='Only fetch shop avatar and exit')
    args = parser.parse_args()

    # РЕЖИМ ПОЛУЧЕНИЯ АВАТАРКИ
    if args.get_avatar:
        try:
            url = "https://www.szwego.com/album/personal/image"
            params = {
                "albumId": args.album_id,
                "requestDataType": ""
            }
            headers = {
                "User-Agent": "Mozilla/5.0",
                "Referer": f"https://www.szwego.com/static/index.html#shop_detail/{args.album_id}",
                "Cookie": args.cookie
            }
            session = get_session()
            resp = request_with_retry(session, "GET", url, params=params, headers=headers)
            if not resp:
                print(f"AVATAR_ERROR: Request failed")
                sys.exit(0)
            data = resp.json()
            if data.get('success') and data.get('result', {}).get('targetAlbum', {}).get('icon'):
                logo = data['result']['targetAlbum']['icon']
                if logo.startswith('//'): logo = 'https:' + logo
                print(f"AVATAR_RESULT:{logo}")
            else:
                print(f"AVATAR_ERROR:No logo found")
        except Exception as e:
            print(f"AVATAR_ERROR:{e}")
        sys.exit(0)

    # Проверка доступа к папке
    try:
        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    except Exception as e:
        print(f"DEBUG: Failed to create directory: {e}", file=sys.stderr)
        sys.exit(1)

    # Headers
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Cookie": args.cookie,
        "Referer": f"https://www.szwego.com/static/index.html#shop_detail/{args.album_id}",
    }

    session = get_session()

    if args.list_tags:
        try:
            tags = _fetch_szwego_tag_references(session, args.album_id, headers)
            print("SZWEGO_TAGS_RESULT:" + json.dumps(tags, ensure_ascii=False))
        except Exception as e:
            print(f"SZWEGO_TAGS_ERROR:{e}", file=sys.stderr)
            sys.exit(1)
        sys.exit(0)

    all_rows = []
    skip_reasons = {}
    seen_photo_keys = {}
    seen_by_goods_id = {}
    
    page_idx = 1
    timestamp_val = int(time.time() * 1000)
    parsed_end_date = _parse_date_from_text(args.end_date) if args.end_date else None

    print(f"Starting parse for Album: {args.album_id} (mode: {args.parse_mode})")
    if args.group_id: print(f"Group: {args.group_id}")
    if args.tag_id: print(f"Tag: {args.tag_id}")

    csv_header = ["external_id", "name", "description", "price", "brand", "category", "subcategory", "gender", "photos"]

    try:
        while True:
            params = {
                "albumId": args.album_id,
                "searchValue": "",
                "searchImg": "",
                "startDate": "",
                "endDate": "",
                "transLang": "en",
                "requestDataType": "",
                "timestamp": timestamp_val,
            }

            if args.parse_mode == "all":
                r = request_with_retry(
                    session,
                    "GET",
                    "https://www.szwego.com/album/personal/all",
                    params=params,
                    headers=headers,
                )
            elif args.group_id:
                params["tagGroupId"] = args.group_id
                r = request_with_retry(session, "POST", "https://www.szwego.com/album/personal/image", params=params, data={"tagList": "[]"}, headers=headers)
            elif args.tag_id:
                r = request_with_retry(session, "POST", "https://www.szwego.com/album/personal/image", params=params, data={"tagList": f"[{args.tag_id}]"}, headers=headers)
            else:
                r = request_with_retry(session, "GET", "https://www.szwego.com/album/personal/image", params=params, headers=headers)

            if not r:
                print("❌ ОШИБКА: Не удалось получить данные от Szwego после нескольких попыток.")
                break

            data = r.json()
            if not data.get("success"):
                if data.get("errcode") == 9:
                    print("❌ ОШИБКА: Ваша сессия (Cookie) истекла. Пожалуйста, обновите Cookie в настройках поставщика в админке.")
                    sys.exit(1)
                print("API Error:", data)
                break

            items = data.get("result", {}).get("items", [])
            if not items: break

            page_saved = 0
            date_skip_count = 0

            for item in items:
                goods_id = item.get("goods_id", "") or item.get("selfGoodsId", "")
                if not goods_id: goods_id = f"auto_{int(time.time() * 1000)}"

                raw_text = (item.get("content", "") or item.get("title", "") or item.get("remark", "") or item.get("goods_name", "") or "")
                
                # Debug first item of first page
                if page_idx == 1 and not all_rows and page_saved == 0:
                    item_date_debug = _parse_date_from_item_fields(item) or _parse_date_from_text(raw_text)
                    print(f"Debug [First Item]: ID={goods_id}, Date={item_date_debug}, DescLen={len(raw_text)}, Photos={len(item.get('imgsSrc', []) or item.get('imgs', []) or [])}")

                if args.parse_mode == "images" and "集合图" in raw_text:
                    skip_reasons["collection_image"] = skip_reasons.get("collection_image", 0) + 1
                    continue

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
                    skip_reasons["short_description"] = skip_reasons.get("short_description", 0) + 1
                    continue

                imgs_src = item.get("imgsSrc", []) or item.get("imgs", []) or []
                photos = [u.strip() for u in imgs_src if u and u.strip()]
                video_url = _find_video_url(item)
                video_poster_url = _find_video_poster(item)

                # Szwego может вернуть обычные фотографии и videoUrl в одной
                # публикации. Сохраняем изображения, а само видео передаём
                # отдельно в технических атрибутах.
                photos = [
                    photo for photo in photos
                    if photo != video_url and not re.search(r"(?:\.mp4(?:$|[?#])|/pvod/)", photo, re.IGNORECASE)
                ]

                # Видео само по себе является товарным медиа: не отбрасываем
                # альбом с видео только потому, что в нем меньше обычных фото.
                if args.parse_mode == "images" and len(photos) < args.min_photos and not video_url:
                    skip_reasons["few_photos"] = skip_reasons.get("few_photos", 0) + 1
                    continue

                item_date = _parse_date_from_item_fields(item) or _parse_date_from_text(description)
                if not item_date:
                    item_date = get_item_date(item, session, args.album_id, headers)

                if parsed_end_date and item_date and item_date < parsed_end_date:
                    date_skip_count += 1
                    skip_reasons["old_date"] = skip_reasons.get("old_date", 0) + 1
                    continue

                # Photo dup check
                photo_key = tuple(sorted(set(photos)))
                if args.parse_mode == "images":
                    if photo_key in seen_photo_keys:
                        skip_reasons["dup_photo"] = skip_reasons.get("dup_photo", 0) + 1
                        continue

                attributes = {
                    "szwego_parse_mode": args.parse_mode,
                    "szwego_timestamp": item.get("time_stamp") or item.get("update_time") or item.get("new_send_time"),
                }
                if video_url:
                    attributes["szwego_video_url"] = video_url
                if video_poster_url:
                    attributes["szwego_video_poster_url"] = video_poster_url
                if tags_list:
                    # Keep the identity signal separately from the human/AI
                    # source text. Supplier post-processors can compare these
                    # labels without guessing where the appended text begins.
                    attributes["szwego_tags"] = list(dict.fromkeys(tags_list))
                attributes = {key: value for key, value in attributes.items() if value not in (None, "")}

                row = [goods_id, "", description, int(args.default_price), args.brand, args.category, args.subcategory, args.gender, json.dumps(photos, ensure_ascii=False), attributes, item_date.isoformat() if item_date else None]
                
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
        
        if all_rows:
            print(f"Final: Saved {len(all_rows)} items to {args.output}")
        else:
            print("No items found.")

if __name__ == "__main__":
    main()
