import csv
import json
import sys
import os
import re

def extract_tags(text):
    """Ищет артикулы типа #F1234 для группировки"""
    if not text: return ""
    tags = re.findall(r'#([A-Za-z0-9]+)', text)
    if not tags: return ""
    return "_".join(sorted(list(set(tags))))

def get_explicit_type_marker(text):
    """Ищет только явные маркеры 1, 2, 3 в тексте"""
    if "1️⃣" in text: return "T1"
    if "2️⃣" in text: return "T2"
    if "3️⃣" in text: return "T3"
    return None

def is_main_post(text):
    """Проверяет, является ли пост главным заголовком (New 25/26)"""
    if not text or not text.startswith("ꫛꫀꪝ"):
        return False
    clean = text.replace(" ", "")
    if "2" in clean and ("6" in clean or "5" in clean):
        prefix_end = len("ꫛꫀꪝ")
        if clean[prefix_end:prefix_end+1] == "2":
            return True
    return False

def is_detail_post(text):
    """Проверяет, является ли пост блоком деталей"""
    return text.startswith("♥𝑰𝒕𝒆𝒎 𝑫𝒆𝒕𝒂𝒊𝒍：")

def is_double_emoji_post(text):
    """Проверяет, начинается ли строка с двух одинаковых эмодзи"""
    if len(text) < 2: return False
    return text[0] == text[1] and ord(text[0]) > 1000

def is_good_post(text):
    """Проверяет, является ли пост полезным"""
    if not text: return False
    if text.startswith("❥❥尺码表❥❥"):
        return False
    if is_main_post(text) or is_detail_post(text) or is_double_emoji_post(text):
        return True
    if "#F" in text: 
        return True
    return False

def should_delete_entirely(text):
    """Проверяет, нужно ли игнорировать саму строку и ее контент"""
    if not text: return True
    if text.startswith("❥❥尺码表❥❥"):
        return True
    if is_main_post(text) or is_detail_post(text) or is_double_emoji_post(text):
        return False
    if text.startswith("ꫛꫀꪝ 今꯭日꯭新꯭品꯭发꯭布꯭"):
        return True
    first_char_code = ord(text[0])
    if first_char_code > 1000 or first_char_code in [10071, 10024, 128293, 128717, 128227]:
        return True
    return False

def process_csv(input_path, output_path=None):
    if not os.path.exists(input_path):
        print(f"Error: File {input_path} not found")
        return
    if output_path is None:
        output_path = input_path
    delimiter = ';' 
    try:
        with open(input_path, 'r', encoding='utf-8-sig') as f:
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

    # СЛОВАРЬ ДЛЯ НАСЛЕДОВАНИЯ ТИПА (T1, T2, T3)
    last_type_per_tags = {}

    groups = {}
    order = []
    
    for row in rows:
        desc = row[2] if len(row) > 2 else ""
        tags_key = extract_tags(desc)
        if not tags_key:
            tags_key = f"SINGLE_{row[0][:10]}"
            full_key = tags_key
        else:
            explicit_type = get_explicit_type_marker(desc)
            if explicit_type:
                last_type_per_tags[tags_key] = explicit_type
            
            current_type = last_type_per_tags.get(tags_key, "T0")
            full_key = f"{tags_key}_{current_type}"
        
        if full_key not in groups:
            groups[full_key] = []
            order.append(full_key)
        groups[full_key].append(row)

    new_rows = []
    ZIMMERMANN_BRAND_ID = "wey9whkcz1sve07"
    ZIMMERMANN_BRAND_NAME = "Zimmermann"
    CLOTHING_CAT_ID = "lrg3k8cd5bgw3jv"

    for key in order:
        group_rows = groups[key]
        all_photos = []
        seen_photos = set()
        good_descriptions = []
        seen_descriptions = set()
        max_price = "0"
        base_row_candidate = None

        for r in group_rows:
            desc = r[2]
            is_trash = should_delete_entirely(desc)
            
            if not is_trash:
                try:
                    p_list = json.loads(r[8])
                    for p in p_list:
                        if p not in seen_photos:
                            all_photos.append(p)
                            seen_photos.add(p)
                except: pass
            
            if len(r) > 3 and r[3] not in ["0", "0.0", ""]:
                max_price = r[3]
            
            if is_good_post(desc) and not is_trash:
                if desc not in seen_descriptions:
                    good_descriptions.append(desc)
                    seen_descriptions.add(desc)
                    if not base_row_candidate:
                        base_row_candidate = r[:]

        if not good_descriptions:
            continue

        result_row = base_row_candidate
        result_row[2] = " ".join(good_descriptions)
        result_row[8] = json.dumps(all_photos, ensure_ascii=False)
        result_row[3] = max_price
        result_row[4] = ZIMMERMANN_BRAND_ID
        result_row[1] = ZIMMERMANN_BRAND_NAME
        result_row[5] = CLOTHING_CAT_ID
        new_rows.append(result_row)

    try:
        with open(output_path, 'w', encoding='utf-8-sig', newline='') as f:
            writer = csv.writer(f, delimiter=delimiter)
            writer.writerow(header)
            writer.writerows(new_rows)
        print(f"Success! Processed {len(new_rows)} merged products.")
    except Exception as e:
        print(f"Error saving CSV: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 2:
        process_csv(sys.argv[1], sys.argv[2])
    elif len(sys.argv) > 1:
        process_csv(sys.argv[1])
    else:
        print("Usage: python merge_zimmermann.py <input_csv> [output_csv]")
