"""Stream raw Szwego albums as JSON lines for the isolated V2 pipeline.

Unlike SzwegoParser.py this parser does not create CSV, apply min-photo/min-text
filters, merge albums, or write catalog products. Stdout is a machine-readable
JSONL stream; human diagnostics go to stderr.
"""

import argparse
import hashlib
import io
import json
import os
import re
import sys
import time
from datetime import date, datetime

import requests
from bs4 import BeautifulSoup


if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")


def log(message):
    print(message, file=sys.stderr, flush=True)


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


def get_session():
    session = requests.Session()
    proxy = os.getenv("BOT_PROXY")
    if proxy:
        session.proxies = {"http": proxy, "https": proxy}

    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry

    retries = Retry(total=3, backoff_factor=1, status_forcelist=[502, 503, 504])
    session.mount("https://", HTTPAdapter(max_retries=retries))
    session.mount("http://", HTTPAdapter(max_retries=retries))
    return session


def request_with_retry(session, method, url, max_retries=3, **kwargs):
    for attempt in range(max_retries):
        try:
            kwargs["timeout"] = kwargs.get("timeout", 60)
            response = session.request(method, url, **kwargs)
            response.raise_for_status()
            return response
        except (requests.exceptions.ReadTimeout, requests.exceptions.ConnectTimeout) as error:
            if attempt == max_retries - 1:
                raise
            log(f"Timeout ({attempt + 1}/{max_retries}), retry in 5s: {error}")
            time.sleep(5)
        except Exception as error:
            if attempt == max_retries - 1:
                raise
            log(f"Request error ({attempt + 1}/{max_retries}), retry in 2s: {error}")
            time.sleep(2)
    return None


def parse_date_from_text(text):
    if not text:
        return None
    value = str(text).strip()
    match = re.search(r"(\d{4})[./-](\d{2})[./-](\d{2})", value)
    if match:
        try:
            return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        except ValueError:
            pass
    match = re.search(r"(\d{2})[./-](\d{2})", value)
    if match:
        try:
            return date(datetime.now().year, int(match.group(1)), int(match.group(2)))
        except ValueError:
            pass
    return None


def parse_date_from_item_fields(item):
    fields = (
        "createTime", "create_time", "createdTime", "created_time",
        "uploadTime", "upload_time", "time", "date",
    )
    for field in fields:
        value = item.get(field)
        if value is None:
            continue
        if isinstance(value, (int, float)):
            try:
                timestamp = float(value)
                if timestamp > 10_000_000_000:
                    timestamp /= 1000.0
                return datetime.fromtimestamp(timestamp).date()
            except (ValueError, OSError, OverflowError):
                pass
        if isinstance(value, str):
            parsed = parse_date_from_text(value)
            if parsed:
                return parsed
    return None


def fetch_date_from_goods_page(session, url, headers):
    if not url:
        return None
    try:
        response = request_with_retry(session, "GET", url, headers=headers)
        if not response:
            return None
        element = BeautifulSoup(response.text, "html.parser").select_one(
            'div[class*="shopinfo_time_text"]'
        )
        return parse_date_from_text(element.get_text(strip=True)) if element else None
    except Exception:
        return None


def get_item_date(item, session, album_id, headers):
    parsed = parse_date_from_item_fields(item)
    if parsed:
        return parsed
    for field in ("goodsUrl", "goods_url", "detailUrl", "detail_url", "url", "link"):
        url = item.get(field)
        if isinstance(url, str) and url.strip():
            parsed = fetch_date_from_goods_page(session, url.strip(), headers)
            if parsed:
                return parsed
    goods_id = item.get("goods_id", "") or item.get("selfGoodsId", "")
    if goods_id:
        url = f"https://www.szwego.com/static/index.html#/shop_detail/{album_id}/goods_detail/{goods_id}"
        return fetch_date_from_goods_page(session, url, headers)
    return None


def normalized_photos(item):
    raw = item.get("imgsSrc", []) or item.get("imgs", []) or []
    result = []
    for value in raw:
        if not isinstance(value, str):
            continue
        url = value.strip()
        if not url:
            continue
        if url.startswith("//"):
            url = "https:" + url
        if "/pvod/" in url or re.search(r"\.mp4(?:\?|$)", url, re.IGNORECASE):
            continue
        result.append(url)
    return result


def iter_source_urls(value):
    if isinstance(value, str):
        candidate = value.strip()
        if candidate.startswith("//"):
            candidate = "https:" + candidate
        if candidate.startswith(("http://", "https://")):
            yield candidate
        return
    if isinstance(value, list):
        for child in value:
            yield from iter_source_urls(child)
        return
    if isinstance(value, dict):
        for child in value.values():
            yield from iter_source_urls(child)


def normalized_media(item, photos):
    media = []
    seen = set()

    def append(media_type, url, preview_url=None):
        clean_url = str(url or "").strip()
        if not clean_url:
            return
        if clean_url.startswith("//"):
            clean_url = "https:" + clean_url
        key = (media_type, clean_url.split("?", 1)[0])
        if key in seen:
            return
        seen.add(key)
        media.append({
            "type": media_type,
            "url": clean_url.split("?", 1)[0] if media_type == "video" else clean_url,
            "preview_url": preview_url or clean_url,
        })

    for photo in photos:
        if "/pvod/" in photo or re.search(r"\.mp4(?:\?|$)", photo, re.IGNORECASE):
            base_url = photo.split("?", 1)[0]
            append("video", base_url, photo if "vframe/" in photo else f"{base_url}?vframe/jpg/offset/0")
        else:
            append("image", photo, photo)

    # Szwego keeps video links outside imgsSrc for some album types. Walk the
    # provider payload so those albums remain visible without depending on one
    # unstable field name. Restrict the scan to Szwego's media CDN paths.
    for url in iter_source_urls(item):
        if "xcimg.szwego.com/pvod/" not in url and not re.search(r"\.mp4(?:\?|$)", url, re.IGNORECASE):
            continue
        base_url = url.split("?", 1)[0]
        append("video", base_url, url if "vframe/" in url else f"{base_url}?vframe/jpg/offset/0")

    return media


def item_tags(item):
    raw = item.get("tags", [])
    values = []
    if isinstance(raw, list):
        for tag in raw:
            if isinstance(tag, dict):
                value = str(tag.get("tagName", "")).strip()
            else:
                value = str(tag).strip()
            if value:
                values.append(value)
    elif isinstance(raw, dict):
        value = str(raw.get("tagName", "")).strip()
        if value:
            values.append(value)
    elif isinstance(raw, str) and raw.strip():
        values.append(raw.strip())
    return values


def stable_external_id(item, description, media):
    value = item.get("goods_id", "") or item.get("selfGoodsId", "")
    if value:
        return str(value).strip()
    digest = hashlib.sha256(
        json.dumps(
            {"description": description, "media": media},
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()[:32]
    return "content_" + digest


def parse_args():
    parser = argparse.ArgumentParser(description="Szwego DB-native V2 parser")
    parser.add_argument("--album_id", required=True)
    parser.add_argument("--cookie", required=True)
    parser.add_argument("--end_date")
    parser.add_argument("--group_id", default="")
    parser.add_argument("--tag_id", default="")
    parser.add_argument("--parse_tags", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    parsed_end_date = parse_date_from_text(args.end_date) if args.end_date else None
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Cookie": args.cookie,
        "Referer": f"https://www.szwego.com/static/index.html#shop_detail/{args.album_id}",
    }
    session = get_session()
    page_timestamp = int(time.time() * 1000)
    page_index = 1
    received = 0
    catalog_position = 0
    seen_in_process = set()

    while True:
        params = {
            "albumId": args.album_id,
            "searchValue": "",
            "searchImg": "",
            "startDate": "",
            "endDate": "",
            "transLang": "en",
            "requestDataType": "",
            "timestamp": page_timestamp,
        }

        if args.group_id:
            params["tagGroupId"] = args.group_id
            response = request_with_retry(
                session,
                "POST",
                "https://www.szwego.com/album/personal/image",
                params=params,
                data={"tagList": "[]"},
                headers=headers,
            )
        elif args.tag_id:
            response = request_with_retry(
                session,
                "POST",
                "https://www.szwego.com/album/personal/image",
                params=params,
                data={"tagList": f"[{args.tag_id}]"},
                headers=headers,
            )
        else:
            response = request_with_retry(
                session,
                "GET",
                "https://www.szwego.com/album/personal/image",
                params=params,
                headers=headers,
            )

        if not response:
            raise RuntimeError("Szwego did not return a response")

        data = response.json()
        if not data.get("success"):
            if data.get("errcode") == 9:
                raise RuntimeError("Cookie поставщика истёк")
            raise RuntimeError(f"Szwego API error: {data}")

        result = data.get("result", {}) or {}
        items = result.get("items", []) or []
        if not items:
            break

        dated_items = 0
        old_items = 0
        for page_position, item in enumerate(items, start=1):
            catalog_position += 1
            raw_text = (
                item.get("content", "")
                or item.get("title", "")
                or item.get("remark", "")
                or item.get("goods_name", "")
                or ""
            )
            description = " ".join(str(raw_text).replace("\r", " ").replace("\n", " ").split())
            if args.parse_tags:
                tags = item_tags(item)
                if tags:
                    description = " ".join([description, *tags]).strip()

            photos = normalized_photos(item)
            media = normalized_media(item, photos)
            external_id = stable_external_id(item, description, media)
            item_date = parse_date_from_item_fields(item)
            if parsed_end_date and not item_date:
                item_date = parse_date_from_text(description)
            if parsed_end_date and not item_date:
                item_date = get_item_date(item, session, args.album_id, headers)
            if item_date:
                dated_items += 1
            if parsed_end_date and item_date and item_date < parsed_end_date:
                old_items += 1
                continue

            # The same goods id may appear twice across Szwego pages. Emitting it
            # once keeps counters honest; cross-run dedupe is enforced by DB.
            if external_id in seen_in_process:
                continue
            seen_in_process.add(external_id)

            emit({
                "type": "album",
                "album": {
                    "external_id": external_id,
                    "name": str(item.get("goods_name", "") or "").strip(),
                    "description": description,
                    "photos": photos,
                    "media": media,
                    "source_published_at": item_date.isoformat() if item_date else None,
                    "source_position": catalog_position,
                    "source_page": page_index,
                    "page_position": page_position,
                    "raw_payload": item,
                },
            })
            received += 1

        log(f"V2 page {page_index}: emitted {received} total albums")
        if parsed_end_date and dated_items > 0 and old_items == len(items):
            break

        pagination = result.get("pagination", {}) or {}
        if not pagination.get("isLoadMore"):
            break
        page_timestamp = pagination.get("pageTimestamp")
        if not page_timestamp:
            break
        page_index += 1

    emit({"type": "summary", "received": received, "pages": page_index})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log(f"V2 parser failed: {error}")
        sys.exit(1)
