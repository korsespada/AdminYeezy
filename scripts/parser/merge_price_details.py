import csv
import json
import sys
import os

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
