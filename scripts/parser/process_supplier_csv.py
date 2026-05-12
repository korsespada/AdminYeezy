import csv
import json
import os
import re
import sys

# --- СЛОВАРИ ИЗ ЗАПРОСА ---
BRAND_MAPPING = {
    "Chanel": "3wxtez8ckauz7o1", "Dior": "ivacgwvpdne0t35", "Maison Margiela": "j2146e3hgo0c6z7",
    "Balenciaga": "mj2732zh7c7pchi", "Prada": "xf3tgcf0uj7yrqf", "Khaite": "ndj9ytnjvgclw45",
    "Valentino": "h1qgeur5z4m2gph", "Lemaire": "s2rx2wedmvdj3w8", "The Row": "u0b9d3xttoysjsf",
    "Toteme": "5xiia5bu18ip9ud", "Unfolio": "5b8plef4xc0n22p", "Paloma Wool": "7m94lvzyxohksuz",
    "Alaia": "y21537s97v1bl01", "Phoebe Philo": "iilxsz8ncy7p70u", "Jacquemus": "3coil6dh82vx1b0",
    "Saint Laurent": "dvj7fjo7rtb0flc", "Marni": "7klibh89fg17wi2", "Christen": "t4rt1v6v8pcoq17",
    "Celine": "e89n7qtko2kop8t", "Chloe": "n2n1ul1n3pg6jqt", "Carven": "of6h1kc0cyqvvp2",
    "Loewe": "v0xek8wss4meybg", "Gianvito Rossi": "lfux3b8ixk1cj2g", "Vivaia": "b8f5thb4sq1351r",
    "Acne Studios": "ywtm8whmvoz75gh", "Bottega Veneta": "59kttao0v819zzy", "Mou": "cp0p02nyhjbtpd7",
    "Moon Boot": "r2t4q522vsij0i5", "Miu Miu": "cn386fag2q87srw", "Ugg": "rg0u4fh6sa4dcm9",
    "Jimmy Choo": "8e8b73nkjezcm7i", "Salomon": "2pkg7t2frmcwlzb", "Louis Vuitton": "977uh954t91spxq",
    "Alexander Wang": "6i43lc9v5qbua0a", "Roger Vivier": "4vr4ukv7pdgevuy", "Hidemi": "i05kwu0fbavgfwp",
    "Fendi": "kxb3v0730w6mnyn", "JW Anderson": "i3c64bc2e66va6x", "Diesel": "i5g7mc4p77q7pum",
    "Brunello Cucinelli": "ll73bx30faqq27r", "SMFK": "spf5kqt8k525g2h", "Isabel Marant": "vtypwyvrub30ymp",
    "Burberry": "9610bhle5fdutm0", "Alo": "objwxcnwqraa2om", "Adidas": "ng1kjzc2cengh1t",
    "Inuikii": "pkc7ijfirh6w0xb", "Stuart Weitzman": "6fzjgpdmnpat2o1", "Autry": "wsfk9zpydcvxkk7",
    "Open YY": "gss6cv87mm8pfeu", "Hermes": "rakg8u0bx1y4qcy", "Dries Van Noten": "hkvdijfbag6qpc1",
    "Hunter": "5becw9gatgv0yfa", "Gucci": "6bjd11fcyypitno", "New Balance": "oax1sgc7jlea0fq",
    "Low Classic": "6ieqbtt9xvesjst", "HOKA": "rwiwg1pwrr96oao", "Jil Sander": "mx1kjmlty75dtju",
    "GANNI": "k73awybczjl81c9", "Off-White": "6kpkutbw6ylvsjc", "Marine Serre": "l2rt9r69m84q6jy",
    "Comme Des Garcons": "hddenrcn5wxr5ac", "Tom Ford": "ume40c3zcv3w33", "13 DEMARZO": "f7q1ai5a5eudqdx",
    "Loro Piana": "5f3npdmxcv8f190", "Birkenstock": "0kzok78uhw3ru2a", "Puma": "lhsmhczzioywpww",
    "Christian Louboutin": "n45sc8t8sge343h", "Tods": "33g2f7p3s9shvca", "Moncler": "z49nph974t5q89a",
    "Chrome Hearts": "lkh666t2e60z4g3", "Vivienne Westwood": "57y3812832msh3u", "Vans": "0m12p94593tsh3w",
    "Timberland": "1m22t34594tsh3x", "Crocs": "2kzok78uhw3ru2b", "Maison Kitsune": "a02uobf9vlv2v0q"
}

BRAND_ALIASES = {
    "CHANE": "Chanel", "香奈儿": "Chanel", "DIO": "Dior", "迪奥": "Dior", "J'ADIOR": "Dior", "CD家": "Dior", "CD": "Dior",
    "MARGIEL": "Maison Margiela", "马吉拉": "Maison Margiela", "MM6": "Maison Margiela", "MAISONMARGIEL": "Maison Margiela",
    "BALENCIA": "Balenciaga", "巴黎世家": "Balenciaga", "BALEN": "Balenciaga", "PRAD": "Prada", "普拉达": "Prada",
    "VALENTIN": "Valentino", "华伦天奴": "Valentino", "VLTN": "Valentino", "THE ROW": "The Row", "THERO": "The Row",
    "LORO": "Loro Piana", "LOROPIANA": "Loro Piana", "LP": "Loro Piana", "TOTEM": "Toteme", "ALAI": "Alaia", "ALAÏ": "Alaia",
    "PHOEBEPHILO": "Phoebe Philo", "PHOEBE": "Phoebe Philo", "YSL": "Saint Laurent", "SAINT LAURAN": "Saint Laurent", "圣罗兰": "Saint Laurent",
    "MARN": "Marni", "CELI": "Celine", "CELINE": "Celine", "LOEW": "Loewe", "BV": "Bottega Veneta", "BOTTEGA": "Bottega Veneta",
    "MIU": "Miu Miu", "MIU-MIU": "Miu Miu", "缪缪": "Miu Miu", "UG": "Ugg", "JIMMYCHO": "Jimmy Choo", "J.CHOO": "Jimmy Choo",
    "LV": "Louis Vuitton", "路易威登": "Louis Vuitton", "ALEXANDERWANG": "Alexander Wang", "A.WANG": "Alexander Wang", "AW": "Alexander Wang", "王大仁": "Alexander Wang",
    "ROGER": "Roger Vivier", "RV": "Roger Vivier", "FEND": "Fendi", "芬迪": "Fendi", "JW ANDERSON": "JW Anderson", "J.W. ANDERSON": "JW Anderson",
    "BRUNELLO": "Brunello Cucinelli", "CUCINELLI": "Brunello Cucinelli", "BC": "Brunello Cucinelli", "ISABEL": "Isabel Marant",
    "BURBERR": "Burberry", "巴宝莉": "Burberry", "ADIDA": "Adidas", "阿迪达斯": "Adidas", "STUART": "Stuart Weitzman", "SW": "Stuart Weitzman",
    "HERME": "Hermes", "爱马仕": "Hermes", "GUCC": "Gucci", "古驰": "Gucci", "NEW BALANCE": "New Balance", "NB": "New Balance",
    "JIL SANDE": "Jil Sander", "JILSANDER": "Jil Sander", "OFF-WHIT": "Off-White", "OFF WHITE": "Off-White",
    "CDG": "Comme Des Garcons", "COMME DES GARÇONS": "Comme Des Garcons", "COMME": "Comme Des Garcons", "TOMFORD": "Tom Ford",
    "TODS": "Tods", "TOD'S": "Tods", "LOUBOUTIN": "Christian Louboutin", "CL": "Christian Louboutin",
    "MONCLE": "Moncler", "BIRKEN": "Birkenstock", "KHAIT": "Khaite", "LEMAIR": "Lemaire", "JACQUEMU": "Jacquemus", "CHLO": "Chloe",
    "CARVE": "Carven", "GIANVITO": "Gianvito Rossi", "ACNE": "Acne Studios", "MO": "Mou", "MOON BOOT": "Moon Boot", "SALOMO": "Salomon", "DIESE": "Diesel", "SMF": "SMFK",
    "ALO": "Alo", "INUIK": "Inuikii", "AUTR": "Autry", "OPEN YY": "Open YY", "DRIES": "Dries Van Noten",
    "HUNTE": "Hunter", "LOW CLASSIC": "Low Classic", "HOKA": "HOKA", "GANN": "GANNI",
    "MARINE SERRE": "Marine Serre", "13DEMARZO": "13 DEMARZO", "VIVAI": "Vivaia", "PALOMA": "Paloma Wool", "UNFOLI": "Unfolio", "REPETT": "Repetto",
    "CHROME HEARTS": "Chrome Hearts", "VIVIENNE": "Vivienne Westwood", "VANS": "Vans", "TIMBERLAND": "Timberland", "CROCS": "Crocs", "KITSUNE": "Maison Kitsune",
    "MIU MI": "Miu Miu", "TOTEM": "Toteme", "THE RO": "The Row"
}

# --- БРЕНДЫ ДЛЯ УДАЛЕНИЯ ---
EXCLUDE_BRANDS = ["Christen", "Hidemi", "Moncler"]

# --- ДОПОЛНИТЕЛЬНЫЕ МАРКЕРЫ ---
SUBCATEGORY_KEYWORDS = {
    # 1. Сначала ищем самое специфичное: Сапоги и Ботинки
    "92ve8obd2pkd36s": ["短靴", "靴", "Boots", "Сапоги", "Ботинки"],
    
    # 2. Лоферы (часто имеют приписку "休闲鞋", поэтому ищем их раньше кроссовок)
    "4pxynbc4fqy6aiu": ["乐福鞋", "Loafer", "Лоферы"],

    # 3. Туфли и каблуки
    "mect3or5ztq64fc": ["高跟", "尖头", "跟高", "珍珠跟", "Pump", "Heels", "高跟鞋", "Туфли", "Босоножки", "Slingbacks", "Слингбэки"],
    
    # 4. Шлепанцы и сандалии (ищем раньше кроссовок, чтобы "спортивные тапки" не стали кроссовками)
    "rbf3iprt2z3owjd": ["拖鞋", "凉拖", "人字拖", "凉鞋", "拖鞋", "夹趾", "Sandal", "Slippers", "Шлепанцы", "Вьетнамки", "Сандалии", "Тапки"],
    
    # 5. Кроссовки (самая широкая категория, ищем в конце)
    "ll3hofpd5wqxr81": ["运动鞋", "板鞋", "德训鞋", "登山鞋", "休闲鞋", "老爹鞋", "运动感", "Sneaker", "Trainer", "Кроссовки"],
    
    # 6. Балетки и Мэри Джейн
    "gquuvxk7z0ik5jn": ["玛丽珍", "Mary Jane", "芭蕾", "Ballerina", "Балетки", "Мари-Джейн", "Мэри Джейн", "分趾鞋"],
    
    # 7. Остальное
    "mgkrw7ofqwfh95s": ["Mules", "Мюли"],
    "owi4kqmgzy4veqz": ["Кеды"]
}

CATEGORY_SHOES_ID = "nzg3vsvajpiv1e8"

def clean_text(text):
    if not text: return ""
    return text.strip()

def find_brand(text):
    if not text: return "Unknown Brand", ""
    
    # 1. Проверяем паттерн "Brand*" в начале строки (самый точный способ у этого поставщика)
    # Ищем английские буквы в начале до звездочки
    match = re.search(r'^([A-Za-z\s]+)\*', text)
    if match:
        potential = match.group(1).strip()
        # Ищем в маппинге (полное или частичное совпадение)
        for full_name, brand_id in BRAND_MAPPING.items():
            if potential.lower() == full_name.lower() or full_name.lower().startswith(potential.lower()):
                return full_name, brand_id

    # 2. Ищем по алиасам с учетом границ слов (\b), чтобы избежать ложных срабатываний (типа MO в Dymonlatr)
    text_upper = text.upper()
    for alias, full_name in BRAND_ALIASES.items():
        # Используем regex для поиска отдельного слова или в начале строки
        pattern = r'\b' + re.escape(alias.upper()) + r'\b'
        if re.search(pattern, text_upper) or text_upper.startswith(alias.upper()):
            brand_id = BRAND_MAPPING.get(full_name)
            return full_name, brand_id
            
    return "Unknown Brand", ""

def find_gender(text):
    if not text: return ""
    text_lower = text.lower()
    
    # 1. Поиск по диапазонам размеров (Size: 35-41)
    # Ищем все вхождения паттернов типа 35-41 или 39-46
    size_matches = re.findall(r'(\d{2})-(\d{2})', text)
    
    has_female_sizes = False
    has_male_sizes = False
    
    for start_s, end_s in size_matches:
        start, end = int(start_s), int(end_s)
        # Если старт в районе 35-38, а конец до 42 - скорее женские
        if 34 <= start <= 38 and end <= 42:
            has_female_sizes = True
        # Если старт от 39 или конец 45-46 - мужские
        if start >= 39 or end >= 44:
            has_male_sizes = True
            
    if has_female_sizes and has_male_sizes:
        return "Унисекс"
    if has_female_sizes:
        return "Для женщин"
    if has_male_sizes:
        return "Для мужчин"

    # 2. Поиск по ключевым словам (если размеры не помогли)
    if any(k in text_lower for k in ["女", "woman", "women", "lady", "женск"]):
        return "Для женщин"
    if any(k in text_lower for k in ["男", "man", "men", "gentle", "мужск"]):
        return "Для мужчин"
        
    return "Для женщин" # По умолчанию

def find_subcategory(text):
    if not text: return ""
    text_lower = text.lower()
    for sub, keywords in SUBCATEGORY_KEYWORDS.items():
        if any(k.lower() in text_lower for k in keywords):
            return sub
    return ""

def process_csv(input_file, output_file):
    if not os.path.exists(input_file):
        print(f"Файл {input_file} не найден.")
        return

    # Читаем CSV с явным указанием разделителя ;
    rows = []
    fieldnames = []
    try:
        with open(input_file, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f, delimiter=';')
            fieldnames = reader.fieldnames
            for row in reader:
                # Убираем лишние данные, которые могут попасть в None
                if None in row:
                    del row[None]
                rows.append(row)
    except Exception as e:
        print(f"Ошибка при чтении: {e}")
        return

    if not fieldnames:
        print("Не удалось прочитать заголовки CSV.")
        return

    # Обновляем строки
    processed_rows = []
    for row in rows:
        desc = row.get('description', '')
        
        # 0. Удаляем слишком короткие описания (мусор)
        if len(desc) < 30:
            continue

        # 1. Определяем бренд
        brand_name, brand_id = find_brand(desc)

        # ФИЛЬТРАЦИЯ:
        # - Если бренд не найден
        if not brand_id or brand_name == "Unknown Brand":
            continue
        # - Если бренд в списке исключений
        if brand_name in EXCLUDE_BRANDS:
            continue
        
        # 2. Логика цены для сапог
        price = "23000"
        desc_lower = desc.lower()
        # Длинные сапоги (высокие, по колено, ботфорты)
        if any(k in desc_lower for k in ["长靴", "高筒", "过膝", "knee high", "tall boot"]):
            price = "38000"
        # Короткие сапоги/ботинки
        elif any(k in desc_lower for k in ["短靴", "靴", "boot"]):
            price = "28000"

        # Записываем данные
        if 'brand' in row: row['brand'] = brand_id
        if 'name' in row: row['name'] = brand_name # Нейронка допишет тип товара сюда
        if 'price' in row: row['price'] = price
        if 'gender' in row: row['gender'] = find_gender(desc)
        if 'subcategory' in row: row['subcategory'] = "" # Оставляем пустой для нейронки
        if 'category' in row: row['category'] = CATEGORY_SHOES_ID
        
        processed_rows.append(row)

    # Сохраняем результат
    try:
        with open(output_file, 'w', encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=';', extrasaction='ignore')
            writer.writeheader()
            writer.writerows(processed_rows)
        print(f"Успех! Сохранено {len(processed_rows)} товаров (было {len(rows)}). Результат: {output_file}")
    except Exception as e:
        print(f"Ошибка при сохранении: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Использование: python process_supplier_csv.py <input.csv> [output.csv]")
    else:
        inp = sys.argv[1]
        out = sys.argv[2] if len(sys.argv) > 2 else inp.replace('.csv', '_processed.csv')
        process_csv(inp, out)
