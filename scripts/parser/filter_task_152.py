import csv
import os
import sys
import io
import re
import json

# Настройка кодировки для Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Данные брендов: название, ID и список алиасов
BRAND_DATA = [
    {'name': 'Valentino', 'id': 'h1qgeur5z4m2gph', 'aliases': ['VALEN']},
    {'name': 'Celine', 'id': 'e89n7qtko2kop8t', 'aliases': ['CELI', 'CEL', 'CE']},
    {'name': 'Loewe', 'id': 'v0xek8wss4meybg', 'aliases': ['LOW', 'LOE']},
    {'name': 'Acne Studios', 'id': 'ywtm8whmvoz75gh', 'aliases': ['Acn Studios', 'Acn Studio', 'Acn', 'Anc', 'Ac']},
    {'name': 'Hermes', 'id': 'rakg8u0bx1y4qcy', 'aliases': ['HER']},
    {'name': 'Zimmermann', 'id': 'wey9whkcz1sve07', 'aliases': ['ZIMM']},
    {'name': 'Chanel', 'id': '3wxtez8ckauz7o1', 'aliases': ['CHL', 'CHA']},
    {'name': 'Louis Vuitton', 'id': '977uh954t91spxq', 'aliases': ['LOUIS', 'LV', 'L']},
    {'name': 'Saint Laurent', 'id': 'dvj7fjo7rtb0flc', 'aliases': ['SLP', 'YSL']},
    {'name': 'Fendi', 'id': 'kxb3v0730w6mnyn', 'aliases': ['FEN', 'FED']},
    {'name': 'The Row', 'id': 'u0b9d3xttoysjsf', 'aliases': ['THE RO']},
    {'name': 'Balenciaga', 'id': 'mj2732zh7c7pchi', 'aliases': ['BAL']},
    {'name': 'Alexander Wang', 'id': '6i43lc9v5qbua0a', 'aliases': ['AW']},
    {'name': 'Ermanno Scervino', 'id': 'ys2aedauky89igq', 'aliases': ['ES']},
    {'name': 'Loro Piana', 'id': '5f3npdmxcv8f190', 'aliases': ['Loro Pian', 'Lpro Pia', 'Loro Pia']},
    {'name': 'Dolce & Gabbana', 'id': '3v0rkg9178h5y5f', 'aliases': ['D&G', 'DG']},
    {'name': 'Brunello Cucinelli', 'id': 'll73bx30faqq27r', 'aliases': ['BC']},
    {'name': 'Toteme', 'id': '5xiia5bu18ip9ud', 'aliases': ['TOTEME']},
    {'name': 'Thom Browne', 'id': '5e10su2xpywak9l', 'aliases': ['THM BRON']},
    {'name': 'Isabel Marant', 'id': 'vtypwyvrub30ymp', 'aliases': ['ISABEL']},
    {'name': 'GANNI', 'id': 'k73awybczjl81c9', 'aliases': ['GAN']},
    {'name': 'Burberry', 'id': '9610bhle5fdutm0', 'aliases': ['BUR', 'BBR']},
    {'name': 'Chloe', 'id': 'n2n1ul1n3pg6jqt', 'aliases': ['CHO']},
    {'name': 'Dior', 'id': 'ivacgwvpdne0t35', 'aliases': ['DIO', 'CD']},
    {'name': 'Gucci', 'id': '6bjd11fcyypitno', 'aliases': ['GUC', 'GG', 'G']},
    {'name': 'Miu Miu', 'id': 'cn386fag2q87srw', 'aliases': ['Miu']},
    {'name': 'Maison Margiela', 'id': 'j2146e3hgo0c6z7', 'aliases': ['MM6', 'MM']},
    {'name': 'Prada', 'id': 'xf3tgcf0uj7yrqf', 'aliases': ['PRA', 'PD']},
]

def find_brand(text):
    """Ищет бренд в тексте по списку алиасов."""
    if not text:
        return None
    
    for brand in BRAND_DATA:
        for alias in brand['aliases']:
            # Используем lookarounds для поиска точного совпадения аббревиатуры
            pattern = rf'(?<![a-zA-Z]){re.escape(alias)}(?![a-zA-Z])'
            if re.search(pattern, text, re.IGNORECASE):
                return brand
    return None

def swap_photos(photos_json):
    """Меняет второе фото на первое место."""
    try:
        urls = json.loads(photos_json)
        if isinstance(urls, list) and len(urls) >= 2:
            # Меняем 1-ю и 2-ю фото местами
            urls[0], urls[1] = urls[1], urls[0]
            return json.dumps(urls)
    except:
        pass
    return photos_json

def process_csv(input_path, output_path=None):
    if not os.path.exists(input_path):
        print(f"Ошибка: Файл {input_path} не найден")
        return
    
    if output_path is None:
        output_path = input_path.replace('.csv', '_processed.csv')

    rows = []
    
    try:
        with open(input_path, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f, delimiter=";")
            fieldnames = reader.fieldnames
            
            if not fieldnames:
                print("Ошибка: Не удалось прочитать заголовки")
                return

            for row in reader:
                description = row.get('description', '')
                
                # 0. Удаляем строки с "baby"
                if 'baby' in description.lower():
                    continue

                # 1. Определяем бренд. Если не найден — удаляем товар (пропускаем строку)
                found = find_brand(description)
                if not found:
                    continue
                    
                row['brand'] = found['id']
                row['name'] = found['name']
                
                # 2. Меняем фото местами (2-е становится 1-м)
                if row.get('photos'):
                    row['photos'] = swap_photos(row['photos'])
                    
                rows.append(row)
                    
        print(f"Обработка завершена. Всего строк: {len(rows)}")
    except Exception as e:
        print(f"Произошла ошибка: {e}")
        return

    try:
        with open(output_path, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=";", extrasaction='ignore')
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
        print("Использование: python filter_task_152.py <input_path> <output_path>")
