import csv
import os
import sys
import io
import re

# Настройка кодировки для Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Ключевые слова для фильтрации
MARKERS = ["【实拍图一组】"]

# Данные брендов: название, ID и список алиасов (регистронезависимо)
BRAND_DATA = [
    {'name': 'Dior', 'id': 'ivacgwvpdne0t35', 'aliases': ['CD', 'DR', 'Dior']},
    {'name': 'Louis Vuitton', 'id': '977uh954t91spxq', 'aliases': ['L', 'LV', 'Louis Vuitton']},
    {'name': 'Acne Studios', 'id': 'ywtm8whmvoz75gh', 'aliases': ['Ac', 'Acne Studios']},
    {'name': 'Miu Miu', 'id': 'cn386fag2q87srw', 'aliases': ['miu', 'Miu Miu']},
    {'name': 'Maison Margiela', 'id': 'j2146e3hgo0c6z7', 'aliases': ['MM', 'Maison Margiela']},
    {'name': 'Celine', 'id': 'e89n7qtko2kop8t', 'aliases': ['CE', 'Celine']},
    {'name': 'Prada', 'id': 'xf3tgcf0uj7yrqf', 'aliases': ['PD', 'Prada']},
    {'name': 'Loewe', 'id': 'v0xek8wss4meybg', 'aliases': ['Loe', 'Loewe']},
    {'name': 'Brunello Cucinelli', 'id': 'll73bx30faqq27r', 'aliases': ['BC', 'Brunello Cucinelli']},
    {'name': 'Burberry', 'id': '9610bhle5fdutm0', 'aliases': ['BBR', 'Burberry']},
    {'name': 'Gucci', 'id': '6bjd11fcyypitno', 'aliases': ['G', 'GG', 'Gucci']},
    {'name': 'Chrome Hearts', 'id': 'qbunqx3arwquz1j', 'aliases': ['CH', 'Chrome Hearts']},
    {'name': 'Dolce & Gabbana', 'id': '3v0rkg9178h5y5f', 'aliases': ['DG', 'Dolce & Gabbana', 'D&G']},
    {'name': 'Saint Laurent', 'id': 'dvj7fjo7rtb0flc', 'aliases': ['YSL', 'Saint Laurent']},
    {'name': 'Fendi', 'id': 'kxb3v0730w6mnyn', 'aliases': ['Fendi']},
    {'name': 'Balenciaga', 'id': 'mj2732zh7c7pchi', 'aliases': ['Balenciaga']},
]

def find_brand(text):
    """Ищет бренд в тексте по списку алиасов."""
    if not text:
        return None
    
    for brand in BRAND_DATA:
        for alias in brand['aliases']:
            # Используем регулярку, чтобы найти алиас как отдельное "слово" 
            # (окруженное не-буквами или границами строки)
            pattern = rf'(?:^|[^a-zA-Z]){re.escape(alias)}(?:[^a-zA-Z]|$)'
            if re.search(pattern, text, re.IGNORECASE):
                return brand
    return None

def process_csv(input_path, output_path=None):
    if not os.path.exists(input_path):
        print(f"Ошибка: Файл {input_path} не найден")
        return
    
    if output_path is None:
        output_path = input_path.replace('.csv', '_filtered.csv')

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

            original_count = 0
            for row in reader:
                original_count += 1
                
                description = row.get('description', '')
                
                # Проверяем маркеры
                if any(marker in description for marker in MARKERS):
                    # Пытаемся определить бренд
                    found = find_brand(description)
                    if found:
                        row['brand'] = found['id']
                        row['name'] = found['name']
                    
                    rows.append(row)
                    
        print(f"Обработка завершена. Всего строк: {original_count}, Оставлено: {len(rows)}")
    except Exception as e:
        print(f"Произошла ошибка при чтении: {e}")
        return

    try:
        with open(output_path, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=delimiter, extrasaction='ignore')
            writer.writeheader()
            writer.writerows(rows)
        print(f"Файл успешно сохранен: {output_path}")
    except Exception as e:
        print(f"Ошибка при записи файла: {e}")

if __name__ == '__main__':
    if len(sys.argv) > 2:
        process_csv(sys.argv[1], sys.argv[2])
    elif len(sys.argv) > 1:
        process_csv(sys.argv[1])
    else:
        print("Использование: python filter_supplier_csv.py <input_path> <output_path>")
