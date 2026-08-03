import csv
import copy
import json
import sys
import os
import re


BRANDS = {
    "BC": ("ll73bx30faqq27r", "Brunello Cucinelli"),
    "LP": ("5f3npdmxcv8f190", "Loro Piana"),
    "ZE": ("8xod4z3cjpbltoa", "Zegna"),
}
# Some supplier model codes do not use the brand's usual prefix.
MODEL_BRAND_ALIASES = {
    "ST2579": ("7rwzlqrppoe8hue", "Santoni"),
    "ST2545-1M": ("7rwzlqrppoe8hue", "Santoni"),
}
CLOTHING_CATEGORY_ID = "lrg3k8cd5bgw3jv"
SHOES_CATEGORY_ID = "nzg3vsvajpiv1e8"
MIN_SHOE_PHOTOS = 6

SHOE_KEYWORDS = (
    "лофер", "мокасин", "кроссов", "обув", "кед", "сникер",
    "loafer", "moccasin", "sneaker", "trainer", "shoe", "shoes",
    "乐福鞋", "运动鞋", "休闲鞋", "板鞋", "德训鞋", "老爹鞋", "鞋",
)


def _text(product):
    return " ".join(str(product.get("description") or "").replace("\r", " ").replace("\n", " ").split())


def _photos(product):
    value = product.get("photos") or []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            value = []
    return [str(url).strip() for url in value if str(url).strip()]


def _unique(values):
    result = []
    seen = set()
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def _is_price(product):
    return bool(re.search(r"\bPRICE\s*:", _text(product), re.IGNORECASE))


def _is_details(product):
    return bool(re.search(r"\bDETAILS\b", _text(product), re.IGNORECASE))


def _is_size_grid(product):
    text = _text(product)
    return bool(re.search(r"\bSIZE\s*GRID\b|РАЗМЕРН\w*\s+(?:СЕТК|ТАБЛ)", text, re.IGNORECASE))


def _is_header(product):
    text = _text(product).upper()
    return not _photos(product) and "MAN" in text and bool(re.search(r"\b(?:SS|FW|AW)\s*\d{2}\b", text))


def _has_clothing_sizes(text):
    compact = re.sub(r"\s+", "", str(text or "").upper())
    return bool(re.search(
        r"(?:^|[•,;/])(?:XS|S|M|L|XL|XXL|XXXL|2XL|3XL)(?:[•,;/]|$)",
        compact,
    ))


def _has_shoe_sizes(text):
    value = str(text or "")
    # Szwego uses all of these separators: 39-46, 39~46, 39～46 and 39至46.
    if re.search(r"(?<!\d)(?:3[5-9]|4[0-7])\s*[-–—~～至]\s*(?:3[5-9]|4[0-7])(?!\d)", value):
        return True

    # Some cards list sizes separately: 39 40 41 42 43 44.
    sizes = re.findall(r"(?<!\d)(?:3[5-9]|4[0-7])(?!\d)", value)
    return len(set(sizes)) >= 2


def _looks_like_shoe(text):
    value = str(text or "")
    if _has_shoe_sizes(value):
        return True
    # Clothing descriptions sometimes mention loafers as a styling suggestion.
    # Do not turn those clothing cards into shoes when a clothing size run is present.
    return bool(re.search("|".join(re.escape(keyword) for keyword in SHOE_KEYWORDS), value, re.IGNORECASE)) and not _has_clothing_sizes(value)


def _is_shoe_product(product):
    return product.get("category") == SHOES_CATEGORY_ID or _looks_like_shoe(
        f"{product.get('name') or ''} {_text(product)}"
    )


def _model_code(*texts):
    joined = " ".join(str(value or "") for value in texts).upper()
    match = re.search(
        r"(?<![A-Z0-9])([A-Z]{2,5})\s*[-_]?\s*\d{2,}(?:[-_]?[A-Z0-9]+)?(?![A-Z0-9])",
        joined,
    )
    return re.sub(r"\s+", "", match.group(0)).replace("_", "") if match else ""


def _model_key(*texts):
    """Normalize supplier typos such as BC0105 vs BC105 for source matching."""
    code = _model_code(*texts)
    match = re.match(r"^(BC|LP|ZE)(\d+)(.*)$", code)
    if match:
        return f"{match.group(1)}{int(match.group(2))}{match.group(3)}"
    return code


def _classify(product, context=""):
    text = f"{_text(product)} {context}"
    code = _model_code(text)
    prefix = re.match(r"^(BC|LP|ZE)", code)
    brand = BRANDS.get(prefix.group(1)) if prefix else None
    brand = brand or MODEL_BRAND_ALIASES.get(code)
    if brand:
        brand_id, brand_name = brand
        product["brand"] = brand_id
        product["name"] = brand_name
    elif code and not str(product.get("name") or "").strip():
        # Do not guess an ambiguous brand prefix (for example, ST), but keep
        # the article visible until AI or an operator confirms the brand.
        product["name"] = f"Модель {code}"

    if _looks_like_shoe(text):
        product["category"] = SHOES_CATEGORY_ID
    elif _has_clothing_sizes(text):
        product["category"] = CLOTHING_CATEGORY_ID
    return code


def _pair_rows(rows):
    """Return Price/Details pairs; Details does not need to contain a model code."""
    used_details = set()
    pairs = []
    for price_index, price in enumerate(rows):
        if not _is_price(price):
            continue
        candidates = (price_index + 1, price_index - 1)
        details_index = next((index for index in candidates
                              if 0 <= index < len(rows)
                              and index not in used_details
                              and _is_details(rows[index])), None)
        if details_index is None:
            continue
        used_details.add(details_index)
        pairs.append((price_index, details_index))
    return pairs


def _is_model_description(product):
    text = _text(product)
    if len(text) < 40 or _photos(product):
        return False
    if _is_header(product) or _is_price(product) or _is_details(product) or _is_size_grid(product):
        return False
    return not re.search(r"\bUNPACKING\b|\bVIDEO\b|\bVIEW\s*360\b", text, re.IGNORECASE)


def _nearest_model_source(candidates, target_index, model_code,
                          exact_distance, anonymous_distance):
    target_key = _model_key(model_code)

    if target_key:
        exact = [(index, row) for index, row in candidates
                 if _model_key(_text(row)) == target_key
                 and abs(index - target_index) <= exact_distance]
        if exact:
            return min(exact, key=lambda item: abs(item[0] - target_index))

    anonymous = [(index, row) for index, row in candidates
                 if not _model_key(_text(row))
                 and abs(index - target_index) <= anonymous_distance]
    return min(anonymous, key=lambda item: abs(item[0] - target_index), default=(None, None))


def _header_before(candidates, target_index):
    candidates = [(index, row) for index, row in candidates if index <= target_index]
    return candidates[-1] if candidates else (None, None)


def _process_all(rows):
    """Build products by model code instead of treating a whole MAN section as one model.

    Clothing cards in this feed use Price + Details pairs. Shoe cards often omit
    Details and put the product photos directly on Price, so they need a separate
    fallback path below.
    """
    descriptions = [(index, row) for index, row in enumerate(rows) if _is_model_description(row)]
    size_grids = [(index, row) for index, row in enumerate(rows) if _is_size_grid(row)]
    headers = [(index, row) for index, row in enumerate(rows) if _is_header(row)]
    result = []
    result_external_ids = set()
    for price_index, details_index in _pair_rows(rows):
        price_row = copy.deepcopy(rows[price_index])
        details_row = rows[details_index]
        price_text = _text(price_row)
        price_code = _model_code(price_text)

        _, description_row = _nearest_model_source(
            descriptions, price_index, price_code, 100, 60
        )
        _, size_row = _nearest_model_source(
            size_grids, price_index, price_code, 80, 60
        )
        _, header_row = _header_before(headers, price_index)

        full_description = _text(description_row) if description_row else ""
        size_photos = _photos(size_row) if size_row else []
        header = _text(header_row) if header_row else ""
        code = _classify(price_row, full_description)
        source_photos = _unique(_photos(details_row) + _photos(price_row))
        if _is_shoe_product(price_row) and len(source_photos) < MIN_SHOE_PHOTOS:
            continue
        price_row["description"] = full_description or price_text
        price_row["photos"] = _unique(
            source_photos + size_photos
        )
        price_row["variant_group_key"] = price_row.get("variant_group_key") or code or None

        attributes = dict(price_row.get("attributes") or {})
        if code:
            attributes["model_code"] = code
        if header:
            attributes["szwego_group_header"] = header
        if full_description:
            attributes["description_source_id"] = description_row.get("external_id")
        attributes["details_source_id"] = details_row.get("external_id")
        if size_row:
            attributes["size_chart_source_id"] = size_row.get("external_id")
        price_row["attributes"] = attributes
        result.append(price_row)

        if price_row.get("external_id"):
            result_external_ids.add(str(price_row["external_id"]))

    # Shoes in the MAN timeline usually have no Details row. Keep every real
    # Price card that has product photos, the shared model description and its
    # nearest size grid. Video-only Price rows are intentionally ignored.
    for price_index, source_price in enumerate(rows):
        if not _is_price(source_price):
            continue
        external_id = str(source_price.get("external_id") or "")
        if not external_id or external_id in result_external_ids:
            continue

        price_text = _text(source_price)
        price_code = _model_code(price_text)
        _, description_row = _nearest_model_source(
            descriptions, price_index, price_code, 100, 60
        )
        _, size_row = _nearest_model_source(
            size_grids, price_index, price_code, 80, 60
        )
        full_description = _text(description_row) if description_row else ""
        size_text = _text(size_row) if size_row else ""
        if not _looks_like_shoe(f"{price_text} {full_description} {size_text}"):
            continue

        product_photos = _photos(source_price)
        if len(product_photos) < MIN_SHOE_PHOTOS:
            continue

        price_row = copy.deepcopy(source_price)
        header_row = _header_before(headers, price_index)[1]
        header = _text(header_row) if header_row else ""
        code = _classify(price_row, f"{full_description} {size_text}")
        price_row["description"] = full_description or price_text
        price_row["photos"] = _unique(product_photos + (_photos(size_row) if size_row else []))
        price_row["variant_group_key"] = price_row.get("variant_group_key") or code or None

        attributes = dict(price_row.get("attributes") or {})
        if code:
            attributes["model_code"] = code
        if header:
            attributes["szwego_group_header"] = header
        if full_description:
            attributes["description_source_id"] = description_row.get("external_id")
        if size_row:
            attributes["size_chart_source_id"] = size_row.get("external_id")
        attributes["shoe_without_details"] = True
        price_row["attributes"] = attributes
        result.append(price_row)
        result_external_ids.add(external_id)

    result.sort(key=lambda product: product.get("source_position", 0))
    return result


def _process_legacy(products):
    result = []
    index = 0
    while index < len(products):
        current = copy.deepcopy(products[index])
        _classify(current)
        if index + 1 < len(products):
            following = products[index + 1]
            if (_is_price(current) and _is_details(following)) or (_is_details(current) and _is_price(following)):
                price_row = current if _is_price(current) else copy.deepcopy(following)
                details_row = following if _is_details(following) else current
                _classify(price_row)
                price_row["photos"] = _unique(_photos(details_row) + _photos(price_row))
                if _is_shoe_product(price_row) and len(price_row["photos"]) < MIN_SHOE_PHOTOS:
                    index += 2
                    continue
                result.append(price_row)
                index += 2
                continue
        result.append(current)
        index += 1
    return result


def process_products(products):
    """Native JSON post-processing contract used by json_postprocess_runner.py."""
    ordered = sorted(
        (copy.deepcopy(product) for product in products),
        key=lambda product: product.get("source_position", 0),
    )
    all_mode = any((product.get("attributes") or {}).get("szwego_parse_mode") == "all" for product in ordered)
    return _process_all(ordered) if all_mode else _process_legacy(ordered)

def process_csv(input_path, output_path=None):
    if not os.path.exists(input_path):
        print(f"Error: File {input_path} not found")
        return

    if output_path is None:
        output_path = input_path

    # Читаем все строки
    rows = []
    header = []
    delimiter = ';' # По умолчанию для этого проекта

    try:
        with open(input_path, 'r', encoding='utf-8-sig') as f:
            # Пытаемся определить разделитель
            first_line = f.readline()
            if first_line:
                if ';' in first_line: delimiter = ';'
                elif ',' in first_line: delimiter = ','
            f.seek(0)
            
            reader = csv.reader(f, delimiter=delimiter)
            header = next(reader)
            rows = list(reader)
    except Exception as e:
        print(f"Error reading CSV: {e}")
        return

    if not rows:
        print("CSV is empty")
        return

    new_rows = []
    i = 0
    total = len(rows)
    merged_count = 0

    while i < total:
        current_row = rows[i]
        
        # Индексы: 1 - Имя, 2 - Описание, 4 - Бренд, 8 - Фото
        name_idx = 1
        desc_idx = 2
        brand_idx = 4
        photos_idx = 8
        
        # --- 1. ОПРЕДЕЛЕНИЕ БРЕНДА ---
        curr_desc = current_row[desc_idx] if len(current_row) > desc_idx else ""
        
        # Очищаем описание от лишних пробелов и переводим в верхний регистр для поиска
        clean_curr_desc = curr_desc.replace(" ", "").upper()
        
        brand_id = ""
        brand_name = ""

        if "BC" in clean_curr_desc:
            brand_id = "ll73bx30faqq27r"
            brand_name = "Brunello Cucinelli"
        elif "LP" in clean_curr_desc:
            brand_id = "5f3npdmxcv8f190"
            brand_name = "Loro Piana"
        elif "ZE" in clean_curr_desc:
            brand_id = "8xod4z3cjpbltoa"
            brand_name = "Zegna"

        if brand_id:
            current_row[brand_idx] = brand_id
            current_row[name_idx] = brand_name

        # --- 2. ОПРЕДЕЛЕНИЕ КАТЕГОРИИ ---
        # Индекс 5 - Категория
        cat_idx = 5
        cat_id = ""
        
        # Если есть буквенные размеры (M, L, XL...) - это одежда
        if any(x in clean_curr_desc for x in ["M•", "•L", "XL", "XXL", "2XL", "3XL"]):
            cat_id = "lrg3k8cd5bgw3jv"
        # Если есть диапазон цифр (например 39-46) - это обувь
        elif "-" in clean_curr_desc:
            import re
            if re.search(r'\d{2}-\d{2}', clean_curr_desc):
                cat_id = "nzg3vsvajpiv1e8"
        
        if cat_id:
            current_row[cat_idx] = cat_id

        # --- 3. СКЛЕЙКА ПАР (Price + Details) ---
        if i + 1 < total:
            next_row = rows[i+1]
            next_desc = next_row[desc_idx] if len(next_row) > desc_idx else ""
            clean_next_desc = next_desc.replace(" ", "").upper()
            
            # Ищем "PRICE" и "DETAILS" в верхнем регистре
            if "PRICE" in clean_curr_desc and "DETAILS" in clean_next_desc:
                try:
                    curr_photos = json.loads(current_row[photos_idx]) if len(current_row) > photos_idx and current_row[photos_idx] else []
                    next_photos = json.loads(next_row[photos_idx]) if len(next_row) > photos_idx and next_row[photos_idx] else []
                    
                    # Детальные фото ставим В НАЧАЛО
                    merged_photos = next_photos + curr_photos
                    current_row[photos_idx] = json.dumps(merged_photos, ensure_ascii=False)
                    
                    new_rows.append(current_row)
                    merged_count += 1
                    i += 2 # Пропускаем оба, так как мы их объединили
                    continue
                except Exception as e:
                    print(f"Error merging photos at row {i}: {e}")
        
        new_rows.append(current_row)
        i += 1

    # Сохраняем результат
    try:
        with open(output_path, 'w', encoding='utf-8-sig', newline='') as f:
            writer = csv.writer(f, delimiter=delimiter)
            writer.writerow(header)
            writer.writerows(new_rows)
        print(f"Done! Merged {merged_count} pairs of Price+Details. Saved to {output_path}")
    except Exception as e:
        print(f"Error saving CSV: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 2:
        process_csv(sys.argv[1], sys.argv[2])
    elif len(sys.argv) > 1:
        process_csv(sys.argv[1])
    else:
        print("Usage: python merge_price_details.py <input_csv> [output_csv]")
