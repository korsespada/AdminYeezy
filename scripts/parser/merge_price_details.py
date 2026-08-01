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
CLOTHING_CATEGORY_ID = "lrg3k8cd5bgw3jv"
SHOES_CATEGORY_ID = "nzg3vsvajpiv1e8"


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


def _model_code(*texts):
    joined = " ".join(str(value or "") for value in texts).upper()
    match = re.search(r"(?<![A-Z0-9])(BC|LP|ZE)\s*[-_]?\s*(\d{2,})\b", joined)
    return f"{match.group(1)}{match.group(2)}" if match else ""


def _model_key(*texts):
    """Normalize supplier typos such as BC0105 vs BC105 for source matching."""
    code = _model_code(*texts)
    match = re.match(r"^(BC|LP|ZE)(\d+)$", code)
    return f"{match.group(1)}{int(match.group(2))}" if match else ""


def _classify(product, context=""):
    text = f"{_text(product)} {context}"
    code = _model_code(text)
    prefix = re.match(r"^(BC|LP|ZE)", code)
    if prefix:
        brand_id, brand_name = BRANDS[prefix.group(1)]
        product["brand"] = brand_id
        product["name"] = brand_name

    compact = re.sub(r"\s+", "", text.upper())
    if re.search(r"(?:^|[•,;/])(?:M|L|XL|XXL|XXXL|2XL|3XL)(?:[•,;/]|$)", compact):
        product["category"] = CLOTHING_CATEGORY_ID
    elif re.search(r"\b\d{2}\s*[-–—]\s*\d{2}\b", text):
        product["category"] = SHOES_CATEGORY_ID
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
    """Build products by model code instead of treating a whole MAN section as one model."""
    descriptions = [(index, row) for index, row in enumerate(rows) if _is_model_description(row)]
    size_grids = [(index, row) for index, row in enumerate(rows) if _is_size_grid(row)]
    headers = [(index, row) for index, row in enumerate(rows) if _is_header(row)]
    result = []
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
        price_row["description"] = full_description or price_text
        price_row["photos"] = _unique(
            _photos(details_row) + _photos(price_row) + size_photos
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
