import csv
import os
import re
import sys
import io

# Настройка кодировки для Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Маппинг Брендов (Название -> ID из БД)
BRAND_TO_ID = {
    "Saint Laurent": "dvj7fjo7rtb0flc",
    "The Row": "u0b9d3xttoysjsf",
    "Loro Piana": "5f3npdmxcv8f190",
    "Brunello Cucinelli": "ll73bx30faqq27r",
    "Bottega Veneta": "59kttao0v819zzy",
    "Celine": "e89n7qtko2kop8t",
    "Hermes": "rakg8u0bx1y4qcy",
    "Loewe": "v0xek8wss4meybg",
    "Miu Miu": "cn386fag2q87srw",
    "Dior": "ivacgwvpdne0t35",
    "Balenciaga": "mj2732zh7c7pchi",
    "Givenchy": "trxbzp1tfpwhpc0",
    "Valentino": "h1qgeur5z4m2gph",
    "Versace": "4ue8ds9h5tpzeul",
    "Chanel": "3wxtez8ckauz7o1",
    "Gucci": "6bjd11fcyypitno",
    "Prada": "xf3tgcf0uj7yrqf",
    "Fendi": "kxb3v0730w6mnyn",
    "Burberry": "9610bhle5fdutm0",
    "Max Mara": "o05hllps088ly05",
    "Moncler": "hn1drp5rmss2i17",
    "Acne Studios": "ywtm8whmvoz75gh",
    "Toteme": "5xiia5bu18ip9ud",
    "Jacquemus": "3coil6dh82vx1b0",
    "Isabel Marant": "vtypwyvrub30ymp",
    "Zimmermann": "wey9whkcz1sve07",
    "Marine Serre": "l2rt9r69m84q6jy",
    "Chloe": "n2n1ul1n3pg6jqt",
    "Alaia": "y21537s97v1bl01",
    "Balmain": "hpjita6djsi5g07",
    "Alexander McQueen": "saco29qmz8q2s1j",
    "Alexander Wang": "6i43lc9v5qbua0a",
    "Maison Margiela": "j2146e3hgo0c6z7",
    "Jil Sander": "mx1kjmlty75dtju",
    "Lemaire": "s2rx2wedmvdj3w8",
    "Khaite": "ndj9ytnjvgclw45",
    "Dries Van Noten": "hkvdijfbag6qpc1",
    "Vivienne Westwood": "af6g1xov3e8ut25",
    "GANNI": "k73awybczjl81c9",
    "Ralph Lauren": "abrl89c5i3d8cjg",
    "Louis Vuitton": "977uh954t91spxq",
    "Goyard": "huwrir7nwl363bi"
}

# Регулярные выражения для поиска бренда в описании
BRAND_PATTERNS = [
    (r"saint\s*laure", "Saint Laurent"),
    (r"the\s*ro[^\w]", "The Row"),
    (r"the\s*row", "The Row"),
    (r"loro\s*p", "Loro Piana"),
    (r"brunello\s*cucin", "Brunello Cucinelli"),
    (r"bottega\s*venet", "Bottega Veneta"),
    (r"celin", "Celine"),
    (r"herm[^\w]?es", "Hermes"),
    (r"herme", "Hermes"),
    (r"\bh\b", "Hermes"),
    (r"loew[^\w]?e", "Loewe"),
    (r"miumi[^\w]?u", "Miu Miu"),
    (r"miu\s*miu", "Miu Miu"),
    (r"\bmiu\b", "Miu Miu"),
    (r"dio[^\w]", "Dior"),
    (r"\bdior\b", "Dior"),
    (r"редкий\s*мех", "unknown"),
    (r"balenciag", "Balenciaga"),
    (r"givench", "Givenchy"),
    (r"valentino", "Valentino"),
    (r"versace", "Versace"),
    (r"chanel", "Chanel"),
    (r"gucc", "Gucci"),
    (r"prad", "Prada"),
    (r"fend", "Fendi"),
    (r"ysl", "Saint Laurent"),
    (r"saint\s*laurent", "Saint Laurent"),
    (r"burberry", "Burberry"),
    (r"max\s*mara", "Max Mara"),
    (r"moncler", "Moncler"),
    (r"acne", "Acne Studios"),
    (r"acn[^\w]?e", "Acne Studios"),
    (r"\bacn\b", "Acne Studios"),
    (r"toteme", "Toteme"),
    (r"jacquemus", "Jacquemus"),
    (r"isabel\s*marant", "Isabel Marant"),
    (r"zimmermann", "Zimmermann"),
    (r"marine\s*serre", "Marine Serre"),
    (r"stella\s*mccartney", "Stella McCartney"),
    (r"chloe", "Chloe"),
    (r"alaia", "Alaia"),
    (r"balmai", "Balmain"),
    (r"alexander\s*mcqueen", "Alexander McQueen"),
    (r"alexander\s*wang", "Alexander Wang"),
    (r"maison\s*margiela", "Maison Margiela"),
    (r"jil\s*sander", "Jil Sander"),
    (r"lemaire", "Lemaire"),
    (r"khaite", "Khaite"),
    (r"proenza\s*schouler", "Proenza Schouler"),
    (r"dries\s*van\s*noten", "Dries Van Noten"),
    (r"vivienne\s*westwood", "Vivienne Westwood"),
    (r"ganni", "GANNI"),
    (r"ralph\s*lauren", "Ralph Lauren"),
    (r"louis\s*vuitton", "Louis Vuitton"),
    (r"goyard", "Goyard")
]

JUNK_KEYWORDS = [
    "Autumn News of 2026",
    "We accept orders",
    "Prepare for development",
    "Coming soon",
    "New arrival",
    "Limited edition",
    "CHILDREN RICH*SDEPRIMESCoat",
    "MAGDA BUTRY*M",
    "leather pants ➕ Recommended vest matching",
    "Customized men's style",
    "PHILI PP PLEIN",
    "The store manager's recommendations are all here",
    "must be something you like",
    "New shooting in progress",
    "Принимаем заказы!",
    "Actual shipment photos"
]

def find_brand_info(desc):
    if not desc:
        return "unknown", ""
    
    # Очищаем текст от "звездочек" и других символов внутри слов для лучшего поиска
    desc_clean = re.sub(r'[\*\^\b]', '', desc.lower())
    
    for pattern, brand_name in BRAND_PATTERNS:
        if re.search(pattern, desc_clean):
            brand_id = BRAND_TO_ID.get(brand_name, "")
            return brand_name, brand_id
            
    # Дополнительная проверка для обрубленных имен (на всякий случай)
    if "chane" in desc_clean:
        return "Chanel", BRAND_TO_ID.get("Chanel", "")
            
    return "unknown", ""

def is_junk(desc):
    if not desc or len(desc) < 15:
        return True
    
    desc_lower = desc.lower()
    
    # Динамическая проверка годов (Received orders in 2026/2027...)
    if re.search(r"received\s*orders\s*in\s*202\d", desc_lower):
        return True
        
    for kw in JUNK_KEYWORDS:
        if kw.lower() in desc_lower:
            return True
    return False

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
            brand_key = next((k for k in fieldnames if k.lower().replace('\ufeff', '').strip() == 'brand'), 'brand')

            original_count = 0
            for row in reader:
                original_count += 1
                desc = row.get(desc_key, "")
                
                # 1. Фильтр мусора
                if is_junk(desc):
                    continue
                
                # 2. Определение бренда
                brand_name, brand_id = find_brand_info(desc)
                
                # НОВОЕ: Если бренд не распознан — пропускаем строку полностью
                if brand_name == "unknown" or not brand_id:
                    continue
                
                # Записываем данные
                row[name_key] = brand_name
                row[brand_key] = brand_id
                
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
        print("Укажите файл.")
