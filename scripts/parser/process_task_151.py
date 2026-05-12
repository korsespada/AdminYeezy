import csv
import json
import os
import sys
import psycopg2
import re
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

# Используем DATABASE_URL для доступа к основной базе с брендами
DATABASE_URL = os.getenv("DATABASE_URL")

# Расширенный маппинг брендов на их алиасы для поиска в описании
BRAND_ALIASES = {
    "Dior": ["DIOR", "𝐃𝐈𝐎𝐑", "D", "迪奥", "CD", "Christan Dior"],
    "Chanel": ["Chanel", "𝐂𝐡𝐚𝐧𝐞𝐥", "香奈儿", "双C"],
    "Burberry": ["Burberry", "𝑩𝒖𝒓𝒃𝒆𝒓𝒓𝒚", "BURBERRY", "巴宝莉", "B家"],
    "Loro Piana": ["Loro Piana", "LORO PIANA", "𝓛𝓸𝓻𝓸 𝓟𝓲𝓪𝓷𝓪", "LORO", "LP", "诺悠翩雅", "LP家"],
    "Gucci": ["Gucci", "𝐆𝐮𝐜𝐜𝐢", "古驰", "古琦"],
    "Hermes": ["Hermes", "𝐇𝐞𝐫𝐦𝐞𝐬", "爱马仕", "H家"],
    "Louis Vuitton": ["Louis Vuitton", "𝐋𝐨𝐮𝐢𝐬 𝐕𝐮𝐢𝐭𝐭𝐨𝐧", "𝐋𝐨𝐮𝐢𝐬 𝐕𝐮𝐭𝐢𝐢𝐨𝐧", "LV", "路易威登", "驴家"],
    "Prada": ["Prada", "普拉达"],
    "Fendi": ["Fendi", "芬迪"],
    "Saint Laurent": ["Saint Laurent", "YSL", "圣罗兰"],
    "Celine": ["Celine", "赛琳"],
    "Balenciaga": ["Balenciaga", "巴黎世家"],
    "Bottega Veneta": ["Bottega Veneta", "BV", "葆蝶家"],
    "Miu Miu": ["Miu Miu", "MiuMiu"],
    "Valentino": ["Valentino", "华伦天奴"],
    "Versace": ["Versace", "范思哲"],
    "Goyard": ["Goyard", "戈雅"],
}

def normalize_text(text):
    """Нормализует текст: преобразует декоративные шрифты Unicode в обычные буквы"""
    if not text:
        return ""
    
    result = []
    for char in text:
        code = ord(char)
        # Mathematical Alphanumeric Symbols (Bold, Italic, etc.)
        # Range 0x1D400 - 0x1D7FF
        if 0x1D400 <= code <= 0x1D433: # Bold A-Z, a-z
            result.append(chr(code - 0x1D400 + ord('A') if code < 0x1D41A else code - 0x1D41A + ord('a')))
        elif 0x1D434 <= code <= 0x1D467: # Italic A-Z, a-z
            result.append(chr(code - 0x1D434 + ord('A') if code < 0x1D44E else code - 0x1D44E + ord('a')))
        elif 0x1D468 <= code <= 0x1D49B: # Bold Italic A-Z, a-z
            result.append(chr(code - 0x1D468 + ord('A') if code < 0x1D482 else code - 0x1D482 + ord('a')))
        elif 0x1D49C <= code <= 0x1D4CF: # Script A-Z, a-z
            result.append(chr(code - 0x1D49C + ord('A') if code < 0x1D4B6 else code - 0x1D4B6 + ord('a')))
        elif 0x1D5D4 <= code <= 0x1D607: # Sans-serif Bold A-Z, a-z
            result.append(chr(code - 0x1D5D4 + ord('A') if code < 0x1D5EE else code - 0x1D5EE + ord('a')))
        elif 0x1D608 <= code <= 0x1D63B: # Sans-serif Italic A-Z, a-z
            result.append(chr(code - 0x1D608 + ord('A') if code < 0x1D622 else code - 0x1D622 + ord('a')))
        elif 0x1D63C <= code <= 0x1D66F: # Sans-serif Bold Italic A-Z, a-z
            result.append(chr(code - 0x1D63C + ord('A') if code < 0x1D656 else code - 0x1D656 + ord('a')))
        elif 0x1D670 <= code <= 0x1D6A3: # Monospace A-Z, a-z
            result.append(chr(code - 0x1D670 + ord('A') if code < 0x1D68A else code - 0x1D68A + ord('a')))
        elif char in '•✨⭐🌟💕✈️🎁📦💗🤪👉👏🏻💫🔥🆚': # Спецсимволы заменяем на пробел
            result.append(' ')
        else:
            result.append(char)
    
    return ''.join(result)

def get_brands_from_db():
    """Получает актуальный список брендов из базы данных"""
    if not DATABASE_URL:
        print("⚠️ Ошибка: DATABASE_URL не найден в .env")
        return []
        
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        # Получаем и ID и Имя для привязки
        cur.execute("SELECT id, name FROM brands")
        brands = cur.fetchall()
        cur.close()
        conn.close()
        return brands
    except Exception as e:
        print(f"⚠️ Ошибка при подключении к БД: {e}")
        return []

def find_brand_in_description(description, brands_list):
    """Ищет бренд в тексте, используя алиасы и список из БД"""
    if not description:
        return None, None
    
    normalized = normalize_text(description)
    desc_upper = normalized.upper()
    
    # 1. Поиск по предопределенным алиасам (приоритет)
    for brand_canonical, aliases in BRAND_ALIASES.items():
        for alias in aliases:
            # ВАЖНО: нормализуем и сам алиас, так как в описании текст уже нормализован
            norm_alias = normalize_text(alias).upper()
            
            # Для коротких слов (D, LV) используем границы слов \b
            pattern = rf"\b{re.escape(norm_alias)}\b" if len(norm_alias) <= 3 else re.escape(norm_alias)
            if re.search(pattern, desc_upper):
                # Находим соответствующий ID в списке из БД
                for b in brands_list:
                    if b['name'].lower() == brand_canonical.lower():
                        return b['id'], b['name']
                # Если в БД нет, возвращаем хотя бы имя
                return None, brand_canonical
    
    # 2. Поиск по прямому совпадению имен из БД
    for b in brands_list:
        b_name = b['name'].upper()
        if re.search(rf"\b{re.escape(b_name)}\b", desc_upper):
            return b['id'], b['name']
            
    return None, None

def process_csv(input_path, output_path=None):
    if not os.path.exists(input_path):
        print(f"ERROR: File {input_path} not found")
        return
    
    if output_path is None:
        output_path = input_path
    
    print(f"Loading brands from DB...")
    brands_list = get_brands_from_db()
    print(f"Loaded {len(brands_list)} brands")
    
    rows = []
    fieldnames = []
    delimiter = ";"
    
    processed_count = 0
    found_count = 0
    
    try:
        with open(input_path, "r", encoding="utf-8-sig") as f:
            first_line = f.readline()
            if first_line:
                delimiter = ";" if ";" in first_line else ","
            f.seek(0)
            
            reader = csv.DictReader(f, delimiter=delimiter)
            fieldnames = reader.fieldnames
            
            for row in reader:
                description = row.get("description", "")
                
                # Поиск бренда
                brand_id, brand_name = find_brand_in_description(description, brands_list)
                
                if brand_name:
                    row["brand"] = brand_id if brand_id else ""
                    row["name"] = brand_name
                    found_count += 1
                
                rows.append(row)
                processed_count += 1
                
    except Exception as e:
        print(f"ERROR reading file: {e}")
        return
    
    try:
        with open(output_path, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=delimiter)
            writer.writeheader()
            writer.writerows(rows)
        print(f"SUCCESS! Processed {processed_count} items. Found brands: {found_count}")
        print(f"Result saved to: {output_path}")
    except Exception as e:
        print(f"ERROR writing file: {e}")

if __name__ == '__main__':
    if len(sys.argv) > 1:
        # Если передан один аргумент - это входной файл
        in_file = sys.argv[1]
        out_file = sys.argv[2] if len(sys.argv) > 2 else in_file
        process_csv(in_file, out_file)
    else:
        # По умолчанию обрабатываем task_151.csv если запущен без аргументов
        process_csv("tmp/task_151.csv")

