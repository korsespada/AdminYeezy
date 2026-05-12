import csv
import json
import os
import sys

JUNK_KEYWORDS = [
    "老钱风 summer walk",
    "关于产品品控",
    "我们🆚zp",
    "准备开发中",
    "敬请期待",
    "对料开发",
    "准备中",
    "上线",
    "限量",
    "预定",
    "出货",
    "排单"
]

def is_junk(desc):
    for kw in JUNK_KEYWORDS:
        if kw in desc:
            return True
    return False

def process_csv(input_path, output_path=None):
    if not os.path.exists(input_path):
        print(f"Ошибка: Файл {input_path} не найден")
        return
    
    if output_path is None:
        # Перезаписываем исходный файл, чтобы интерфейс увидел изменения
        output_path = input_path

    rows = []
    fieldnames = []
    delimiter = ";"
    
    try:
        with open(input_path, "r", encoding="utf-8-sig") as f:
            first_line = f.readline()
            if first_line:
                delimiter = ";" if ";" in first_line else ","
            f.seek(0)
            
            reader = csv.DictReader(f, delimiter=delimiter)
            fieldnames = reader.fieldnames
            for row in reader:
                desc = row.get("description", "")
                if not is_junk(desc):
                    # Parse photos to list
                    photos_str = row.get("photos", "[]")
                    try:
                        photos = json.loads(photos_str)
                    except:
                        photos = []
                    row["photos_list"] = photos
                    rows.append(row)
    except Exception as e:
        print(f"Ошибка при чтении: {e}")
        return

    merged_rows = []
    i = 0
    while i < len(rows):
        current_row = rows[i]
        
        # Check if next row exists and has <= 7 photos
        if i + 1 < len(rows):
            next_row = rows[i+1]
            if len(next_row["photos_list"]) <= 7 and len(current_row["photos_list"]) >= 8:
                # Merge current (detail) and next (general)
                merged_photos = next_row["photos_list"] + current_row["photos_list"]
                merged_desc = current_row["description"] + " " + next_row["description"]
                
                new_row = current_row.copy()
                new_row["photos_list"] = merged_photos
                new_row["description"] = merged_desc
                merged_rows.append(new_row)
                i += 2
                continue
                
        merged_rows.append(current_row)
        i += 1
        
    for row in merged_rows:
        # Оставляем поля для заполнения ИИ
        row["name"] = "Louis Vuitton"
        row["category"] = ""
        row["subcategory"] = ""
        row["price"] = ""
        row["gender"] = ""
            
        row["photos"] = json.dumps(row["photos_list"], ensure_ascii=False)
        if "photos_list" in row:
            del row["photos_list"]
        
    try:
        with open(output_path, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=delimiter, extrasaction='ignore')
            writer.writeheader()
            writer.writerows(merged_rows)
        print(f"Успешно! Было: {len(rows)}, стало: {len(merged_rows)}")
    except Exception as e:
        print(f"Ошибка при записи: {e}")

if __name__ == '__main__':
    if len(sys.argv) > 2:
        process_csv(sys.argv[1], sys.argv[2])
    elif len(sys.argv) > 1:
        process_csv(sys.argv[1])
    else:
        print("Использование: python process_task_111.py <input.csv> [output.csv]")
