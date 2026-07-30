import csv
import json
import sys
import os


def _photos(product):
    value = product.get("photos") or []
    if isinstance(value, list):
        return value
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return []


def _classify_subcategory(description, standalone=False):
    cardholder_keywords = ['卡包']
    wallet_keywords = ['钱包', '三折包', '折包', '零钱包', '证件包']
    passport_keywords = ['护照夹']
    bag_markers = ['hobo', 'woc', 'cf', '手提', '托特', '能装', '容量', '尺寸：17', '尺寸:17']
    if not standalone:
        bag_markers += [
            '尺寸：30', '尺寸:30', '尺寸：25', '尺寸:25',
            '尺寸：20', '尺寸:20', '尺寸：13.5x17',
        ]
    lowered = description.lower()
    is_bag = any(keyword.lower() in lowered for keyword in bag_markers)
    is_small_leather = not is_bag and (
        any(keyword in description for keyword in passport_keywords)
        or any(keyword in description for keyword in cardholder_keywords)
        or any(keyword in description for keyword in wallet_keywords)
    )
    return "zugzfh1wu2tswfs" if is_small_leather else "dnckd3yiv2q0r5f", is_small_leather


def process_products(products):
    """Native JSON processor. Source order is significant for album pairing."""
    result = []
    index = 0
    while index < len(products):
        first = products[index]
        first_photos = _photos(first)
        photo_count = len(first_photos)

        if photo_count not in (8, 9, 11):
            index += 1
            continue

        second = products[index + 1] if index + 1 < len(products) else None
        second_photos = _photos(second) if second else []
        first_description = str(first.get("description") or "").strip()

        if second and len(second_photos) == 4:
            second_description = str(second.get("description") or "").strip()
            description = " ".join(part for part in (second_description, first_description) if part)
            index += 2
            if any(keyword in description for keyword in ('开发准备中', '准备中')):
                continue
            merged = dict(first)
            merged["description"] = description
            merged["photos"] = second_photos + first_photos
            merged["subcategory"], _ = _classify_subcategory(description)
            result.append(merged)
            continue

        index += 1
        if any(keyword in first_description for keyword in ('开发准备中', '准备中')):
            continue
        subcategory, is_small_leather = _classify_subcategory(first_description, standalone=True)
        if is_small_leather:
            standalone = dict(first)
            standalone["subcategory"] = subcategory
            result.append(standalone)

    return result

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

    new_rows = []
    
    i = 0
    # The final row must also be evaluated. A following row is only required
    # for the merge branch and is already guarded below.
    while i < len(rows):
        row1 = rows[i]
        
        try:
            # Парсим фото первого товара в паре
            photos1 = json.loads(row1[8]) if len(row1) > 8 else []
        except:
            photos1 = []
            
        len1 = len(photos1)
        
        # Проверяем, что первый товар имеет 8, 9 или 11 детальных фото
        if len1 in [8, 9, 11]:
            # Проверяем следующий товар
            row2 = rows[i+1] if i + 1 < len(rows) else None
            len2 = 0
            if row2:
                try:
                    photos2 = json.loads(row2[8]) if len(row2) > 8 else []
                    len2 = len(photos2)
                except:
                    photos2 = []
                    len2 = 0
            
            # Если следующий товар имеет ровно 4 фото, значит это пара!
            if row2 and len2 == 4:
                desc1 = row1[2].strip() if len(row1) > 2 else ""
                desc2 = row2[2].strip() if len(row2) > 2 else ""
                new_photos = photos2 + photos1
                
                result_row = row1.copy()
                new_desc = f"{desc2} {desc1}" if desc2 and desc1 else (desc2 or desc1)
                
                # Фильтр "В разработке"
                exclude_keywords = ['开发准备中', '准备中']
                if any(kw in new_desc for kw in exclude_keywords):
                    i += 2
                    continue

                # Логика заполнения полей
                result_row[2] = new_desc
                result_row[8] = json.dumps(new_photos, ensure_ascii=False)
                
                # Ключевые слова
                cardholder_keywords = ['卡包']
                wallet_keywords = ['钱包', '三折包', '折包', '零钱包', '证件包']
                passport_keywords = ['护照夹']
                bag_markers = ['hobo', 'woc', 'cf', '手提', '托特', '能装', '容量', '尺寸：30', '尺寸:30', '尺寸：25', '尺寸:25', '尺寸：20', '尺寸:20', '尺寸：17', '尺寸:17', '尺寸：13.5x17']
                
                # Сначала проверяем, не сумка ли это
                is_bag = any(kw.lower() in new_desc.lower() for kw in bag_markers)
                
                is_cardholder = False
                is_wallet = False
                is_passport = False
                
                if not is_bag:
                    is_passport = any(kw in new_desc for kw in passport_keywords)
                    is_cardholder = any(kw in new_desc for kw in cardholder_keywords)
                    is_wallet = any(kw in new_desc for kw in wallet_keywords)
                
                if is_passport:
                    result_row[6] = "zugzfh1wu2tswfs"
                elif is_cardholder:
                    result_row[6] = "zugzfh1wu2tswfs"
                elif is_wallet:
                    result_row[6] = "zugzfh1wu2tswfs"
                else:
                    result_row[6] = "dnckd3yiv2q0r5f"

                new_rows.append(result_row)
                i += 2
                continue
            else:
                # Одиночный товар (8, 9, 11 фото) без пары с 4 фото
                desc1 = row1[2].strip() if len(row1) > 2 else ""
                
                # Фильтр "В разработке"
                exclude_keywords = ['开发准备中', '准备中']
                if any(kw in desc1 for kw in exclude_keywords):
                    i += 1
                    continue
                
                # Ключевые слова
                cardholder_keywords = ['卡包']
                wallet_keywords = ['钱包', '三折包', '折包', '零钱包', '证件包']
                passport_keywords = ['护照夹']
                bag_markers = ['hobo', 'woc', 'cf', '手提', '托特', '能装', '容量', '尺寸：17', '尺寸:17']
                
                # Проверка на сумку
                is_bag = any(kw.lower() in desc1.lower() for kw in bag_markers)
                is_cardholder = False
                is_wallet = False
                is_passport = False
                
                if not is_bag:
                    is_passport = any(kw in desc1 for kw in passport_keywords)
                    is_cardholder = any(kw in desc1 for kw in cardholder_keywords)
                    is_wallet = any(kw in desc1 for kw in wallet_keywords)
                
                if is_cardholder or is_wallet or is_passport:
                    result_row = row1.copy()
                    result_row[6] = "zugzfh1wu2tswfs"
                    new_rows.append(result_row)
                
                # Если это не кошелек и пары нет — удаляем
                i += 1
                continue
                
        # Если паттерн не совпал (например, 12, 10, 6 фото или за 9 фото не идет 4 фото),
        # то просто пропускаем этот товар и идем дальше.
        i += 1

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
        print("Usage: python merge_photos_8_9_11.py <input_csv> [output_csv]")
