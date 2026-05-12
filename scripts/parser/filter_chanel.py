import csv
import json
import os
import sys
import unicodedata
import re
import io

# Настройка кодировки для Windows, чтобы не было ошибок при выводе Unicode в консоль
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

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
    if not desc:
        return False
    for kw in JUNK_KEYWORDS:
        if kw in desc:
            return True
    return False

def normalize_text(text):
    """
    Преобразует красивые шрифты (жирный, курсив и т.д.) в обычный текст.
    Например: 𝐂𝐡𝐚𝐧𝐞𝐥 -> Chanel
    """
    if not text:
        return ""
    return unicodedata.normalize('NFKD', text)

def is_chanel_start(desc):
    """
    Проверяет, начинается ли описание с Chanel, игнорируя спецсимволы в самом начале.
    Если Chanel в середине или в конце (как в '种草人生之Chanel') - вернет False.
    """
    if not desc:
        return False
    
    # 1. Нормализуем шрифт
    norm = normalize_text(desc)
    
    # 2. Убираем только спецсимволы и пробелы из самого начала
    # \w включает буквы всех языков (в т.ч. китайский), поэтому если в начале китаец - он останется.
    # Мы убираем только "мусор" типа ￼, смайликов и т.д.
    clean_start = re.sub(r'^[^\w]+', '', norm).lower()
    
    # 3. Должно начинаться строго на chanel
    return clean_start.startswith('chanel')

def process_csv(input_path, output_path=None):
    if not os.path.exists(input_path):
        print(f"Ошибка: Файл {input_path} не найден")
        return
    
    if output_path is None:
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
            
            if not fieldnames:
                print("Ошибка: Не удалось прочитать заголовки")
                return

            # Ключи колонок
            desc_key = next((k for k in fieldnames if k.lower().replace('\ufeff', '').strip() == 'description'), 'description')
            name_key = next((k for k in fieldnames if k.lower().replace('\ufeff', '').strip() == 'name'), 'name')
            cat_key = next((k for k in fieldnames if k.lower().replace('\ufeff', '').strip() == 'category'), 'category')
            subcat_key = next((k for k in fieldnames if k.lower().replace('\ufeff', '').strip() == 'subcategory'), 'subcategory')
            price_key = next((k for k in fieldnames if k.lower().replace('\ufeff', '').strip() == 'price'), 'price')
            gender_key = next((k for k in fieldnames if k.lower().replace('\ufeff', '').strip() == 'gender'), 'gender')
            photos_key = next((k for k in fieldnames if k.lower().replace('\ufeff', '').strip() == 'photos'), 'photos')

            original_count = 0
            for row in reader:
                original_count += 1
                desc = row.get(desc_key, "")
                
                # Фильтр: Только Chanel в начале и не мусор
                if is_chanel_start(desc) and not is_junk(desc):
                    # 1. Меняем имя
                    row[name_key] = "Chanel"
                    
                    # 2. Логика Gender
                    # По умолчанию "Для женщин", если есть и "女款" и "男款" -> "Унисекс"
                    if "女款" in desc and "男款" in desc:
                        row[gender_key] = "Унисекс"
                    else:
                        row[gender_key] = "Для женщин"
                    
                    # 3. Перестановка фото (2-е становится 1-м)
                    photos_str = row.get(photos_key, "[]")
                    try:
                        photos = json.loads(photos_str)
                        if isinstance(photos, list) and len(photos) >= 2:
                            # Меняем местами 0 и 1 элементы
                            photos[0], photos[1] = photos[1], photos[0]
                            row[photos_key] = json.dumps(photos, ensure_ascii=False)
                    except:
                        pass # Если не JSON или битый, оставляем как есть

                    # Очищаем категории и цену для AI
                    row[cat_key] = ""
                    row[subcat_key] = ""
                    row[price_key] = ""
                    
                    rows.append(row)
                    
        print(f"Обработка завершена. Всего: {original_count}, Оставлено: {len(rows)}")
    except Exception as e:
        print(f"Ошибка: {e}")
        return

    try:
        with open(output_path, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=delimiter, extrasaction='ignore')
            writer.writeheader()
            writer.writerows(rows)
        print(f"Файл сохранен: {output_path}")
    except Exception as e:
        print(f"Ошибка при записи: {e}")

if __name__ == '__main__':
    if len(sys.argv) > 2:
        process_csv(sys.argv[1], sys.argv[2])
    elif len(sys.argv) > 1:
        process_csv(sys.argv[1])
    else:
        # Для тестов
        test_file = r"c:\projects-vibe\admin-yeezy-app\tmp\task_119.csv"
        if os.path.exists(test_file):
            process_csv(test_file)
        else:
            print("Укажите файл.")
