import os
import json
import base64
import logging
import requests
import psycopg2
from psycopg2.extras import RealDictCursor
from openai import OpenAI
import dotenv
import re
import hashlib
import httpx
from concurrent.futures import ThreadPoolExecutor

# Load environment variables
dotenv.load_dotenv()

# --- CONFIGURATION ---
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_PROXY_URL = os.getenv("OPENROUTER_PROXY_URL")
if OPENROUTER_PROXY_URL and OPENROUTER_PROXY_URL.startswith("socks5h://"):
    OPENROUTER_PROXY_URL = OPENROUTER_PROXY_URL.replace("socks5h://", "socks5://", 1)
SCRAPING_DATABASE_URL = os.getenv("SCRAPING_DATABASE_URL") or os.getenv("DATABASE_URL")
MODEL_NAME = "google/gemini-2.0-flash-lite:free" # Универсальная и быстрая модель

ATTRIBUTE_HINT_LABELS = {
    "sizes": "Размеры",
    "colors": "Цвета",
    "materials": "Материалы",
    "model_name": "Модель",
    "season": "Сезон",
    "fit": "Посадка",
    "clothing_measurements": "Замеры одежды",
    "sole_material": "Материал подошвы",
    "upper_material": "Материал верха",
    "lining_material": "Материал подкладки",
    "heel_height": "Высота каблука",
    "shoe_size_system": "Система размеров",
    "bag_dimensions": "Размеры сумки",
    "bag_capacity": "Вместимость",
    "strap_length": "Длина ремня",
    "watch_movement": "Механизм часов",
    "water_resistance": "Водозащита",
    "case_material": "Материал корпуса",
    "strap_material": "Материал ремешка",
    "dial_color": "Цвет циферблата",
    "country_of_origin": "Страна производства",
}

openrouter_http_client = httpx.Client(proxy=OPENROUTER_PROXY_URL) if OPENROUTER_PROXY_URL else None
client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=OPENROUTER_API_KEY,
    http_client=openrouter_http_client,
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def get_db_connection():
    return psycopg2.connect(SCRAPING_DATABASE_URL)

DATABASE_URL = os.getenv("DATABASE_URL") or SCRAPING_DATABASE_URL

def get_mapping_data():
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT id, name FROM brands")
        brands = {row['name'].lower(): row['id'] for row in cur.fetchall()}
        
        cur.execute("SELECT id, name FROM categories")
        categories = {row['name'].lower(): row['id'] for row in cur.fetchall()}
        
        cur.execute("SELECT id, name FROM subcategories")
        subcategories = {row['name'].lower(): {"id": row['id'], "category_id": row.get('category_id')} for row in cur.fetchall()}
        
        return {"brands": brands, "categories": categories, "subcategories": subcategories}
    finally:
        cur.close()
        conn.close()

def get_ai_settings(supplier_id):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Get Global Rules
        cur.execute("SELECT value FROM app_settings WHERE key = 'general_ai_rules'")
        global_rules = cur.fetchone()
        global_rules = global_rules['value'] if global_rules else ""

        # Get AI Model
        cur.execute("SELECT value FROM app_settings WHERE key = 'selected_ai_model'")
        model_name = cur.fetchone()
        model_name = model_name['value'] if model_name else "google/gemini-2.0-flash-lite:free"

        # Get Supplier Settings
        cur.execute("SELECT ai_instructions, ai_photo_enabled, ai_photo_instructions, ai_photo_models, ai_parallel_enabled, ai_parallel_count, ai_cache_enabled, default_attributes FROM suppliers WHERE id = %s", (supplier_id,))
        supplier_settings = cur.fetchone()

        mapping = get_mapping_data()

        return {
            "global_rules": global_rules,
            "supplier_instructions": supplier_settings['ai_instructions'] if supplier_settings else "",
            "ai_photo_enabled": supplier_settings['ai_photo_enabled'] if supplier_settings else False,
            "ai_photo_instructions": supplier_settings['ai_photo_instructions'] if supplier_settings else "",
            "ai_photo_models": supplier_settings['ai_photo_models'] if supplier_settings else "",
            "ai_parallel_enabled": supplier_settings['ai_parallel_enabled'] if supplier_settings else False,
            "ai_parallel_count": supplier_settings['ai_parallel_count'] if supplier_settings else 5,
            "ai_cache_enabled": supplier_settings['ai_cache_enabled'] if supplier_settings else False,
            "default_attributes": supplier_settings.get('default_attributes') if supplier_settings else [],
            "model_name": model_name,
            "mapping": mapping
        }
    finally:
        cur.close()
        conn.close()

def get_cached_result(cache_hash):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT result FROM ai_cache WHERE hash = %s", (cache_hash,))
        res = cur.fetchone()
        return res['result'] if res else None
    finally:
        cur.close()
        conn.close()

def save_to_cache(cache_hash, result):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO ai_cache (hash, result) VALUES (%s, %s) ON CONFLICT (hash) DO UPDATE SET result = EXCLUDED.result",
            (cache_hash, json.dumps(result))
        )
        conn.commit()
    finally:
        cur.close()
        conn.close()

def encode_image_from_url(url):
    try:
        # Szwego URLs often need imageMogr2 for smaller size to avoid payload limits
        if "szwego.com" in url and "imageMogr2" not in url:
            separator = "&" if "?" in url else "?"
            url = f"{url}{separator}imageMogr2/auto-orient/thumbnail/!800x800r/quality/80/format/jpg"
            
        resp = requests.get(url, timeout=10)
        if resp.status_code == 200:
            return base64.b64encode(resp.content).decode('utf-8')
    except Exception as e:
        logging.error(f"Error encoding image {url}: {e}")
    return None

import hashlib

def process_product_ai(product, settings):
    global_rules = settings["global_rules"]
    supplier_instr = settings["supplier_instructions"]
    ai_photo = settings["ai_photo_enabled"]
    use_cache = settings["ai_cache_enabled"]
    model_name = settings["model_name"]
    supplier_attributes = settings.get("default_attributes") or []
    if not isinstance(supplier_attributes, list):
        supplier_attributes = []

    # Calculate Cache Hash
    photo_url = product.get('photos', [''])[0] if product.get('photos') else ''
    cache_input = f"{product.get('description', '')}|{photo_url}|{global_rules}|{supplier_instr}|{model_name}|{json.dumps(supplier_attributes, ensure_ascii=False, sort_keys=True)}"
    cache_hash = hashlib.md5(cache_input.encode('utf-8')).hexdigest()

    if use_cache:
        cached = get_cached_result(cache_hash)
        if cached:
            logging.info(f"Using cached result for: {product.get('name')[:30]}...")
            return cached

    mapping = settings["mapping"]
    existing_attributes = product.get("attributes") if isinstance(product.get("attributes"), dict) else {}
    
    # Format mapping for prompt
    brands_list = ", ".join([f"{name} (ID: {mid})" for name, mid in mapping['brands'].items()])
    categories_list = ", ".join([f"{name} (ID: {mid})" for name, mid in mapping['categories'].items()])
    subcategories_list = ", ".join([f"{name} (ID: {mid['id']})" for name, mid in mapping['subcategories'].items()])

    photo_analysis = ""
    # Add photo if enabled and available
    if ai_photo and product.get('photos') and len(product['photos']) > 0:
        img_b64 = encode_image_from_url(product['photos'][0])
        if img_b64:
            photo_model = settings.get("ai_photo_models") or model_name
            photo_instr = settings.get("ai_photo_instructions") or "Describe what is on this photo (brand, product type, material)."
            
            logging.info(f"Running Step 1: Photo Analysis with model {photo_model}")
            try:
                photo_resp = client.chat.completions.create(
                    model=photo_model,
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": photo_instr},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}}
                        ]
                    }],
                    temperature=0.1
                )
                photo_analysis = photo_resp.choices[0].message.content
                logging.info(f"Photo Analysis Result: {photo_analysis[:100]}...")
            except Exception as pe:
                logging.error(f"Photo Analysis Error: {pe}")

    # Construct the instruction
    combined_instruction = f"{global_rules}\n\nДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ПОСТАВЩИКА:\n{supplier_instr}"
    if photo_analysis:
        combined_instruction += f"\n\nРЕЗУЛЬТАТ АНАЛИЗА ФОТО (ИСПОЛЬЗУЙ ЭТО):\n{photo_analysis}"

    prioritized_attributes = [
        f"{code} ({ATTRIBUTE_HINT_LABELS.get(code, code)})"
        for code in supplier_attributes
        if code in ATTRIBUTE_HINT_LABELS
    ]
    attribute_instruction = (
        "Нет специальных атрибутов поставщика."
        if not prioritized_attributes
        else (
            "В первую очередь извлеки следующие атрибуты поставщика: "
            + ", ".join(prioritized_attributes)
            + ". Используй указанные коды как ключи JSON. Не выдумывай значение: если данных нет, не добавляй ключ."
        )
    )
    
    prompt_text = (
        f"Проанализируй товар и верни JSON. Используй ID из списков ниже, если находишь соответствие.\n\n"
        f"СУЩЕСТВУЮЩИЕ БРЕНДЫ: {brands_list}\n"
        f"СУЩЕСТВУЮЩИЕ КАТЕГОРИИ: {categories_list}\n"
        f"СУЩЕСТВУЮЩИЕ ПОДКАТЕГОРИИ: {subcategories_list}\n\n"
        f"ИНСТРУКЦИИ:\n{combined_instruction}\n\n"
        f"ИСХОДНЫЕ ДАННЫЕ:\n"
        f"Name: {product.get('name', '')}\n"
        f"Description: {product.get('description', '')}\n"
        f"Price (raw): {product.get('price', '')}\n"
        f"Brand (default): {product.get('brand', '')}\n"
        f"Category (default): {product.get('category', '')}\n"
        f"Subcategory (default): {product.get('subcategory', '')}\n"
        f"Gender (default): {product.get('gender', '')}\n\n"
        f"УЖЕ СОХРАНЁННЫЕ АТРИБУТЫ (не удаляй их, дополни или уточни при необходимости):\n"
        f"{json.dumps(existing_attributes, ensure_ascii=False)}\n\n"
        f"ПРИОРИТЕТНЫЕ АТРИБУТЫ ПОСТАВЩИКА:\n{attribute_instruction}\n\n"
        f"ВЕРНИ JSON В ФОРМАТЕ:\n"
        "{\n"
        "  \"name\": \"...\",\n"
        "  \"description\": \"...\",\n"
        "  \"price\": number_or_string,\n"
        "  \"brand\": \"ID или название\",\n"
        "  \"category\": \"ID или название\",\n"
        "  \"subcategory\": \"ID или название\",\n"
        "  \"gender\": \"...\",\n"
        "  \"attributes\": {\"model_name\": \"...\", \"colors\": [\"...\"], \"materials\": [\"...\"], \"sizes\": [\"...\"], \"shoe_size_system\": \"EU\", \"upper_material\": \"...\", \"lining_material\": \"...\", \"sole_material\": \"...\", \"heel_height\": \"...\", \"season\": \"...\"}\n"
        "}"
    )

    content = [
        {"type": "text", "text": prompt_text}
    ]

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": content}],
            temperature=0.1,
            response_format={"type": "json_object"}
        )
        ai_res = json.loads(response.choices[0].message.content)
        
        # Cleanup price
        if 'price' in ai_res and isinstance(ai_res['price'], str):
             digits = re.findall(r"\d+\.?\d*", ai_res['price'].replace(',', '.'))
             if digits:
                 ai_res['price'] = float(digits[0])
        
        # Принудительная замена переносов строк на \n (требование пользователя)
        for field in ['description', 'name']:
            if field in ai_res and isinstance(ai_res[field], str):
                ai_res[field] = ai_res[field].replace('\r\n', '\\n').replace('\n', '\\n').replace('\r', '\\n')

        if not isinstance(ai_res.get('attributes'), dict):
            ai_res['attributes'] = existing_attributes
        else:
            ai_res['attributes'] = {**existing_attributes, **ai_res['attributes']}

        # Save to cache if enabled
        if use_cache:
            save_to_cache(cache_hash, ai_res)

        return ai_res
    except Exception as e:
        logging.error(f"AI Error for product {product.get('name')}: {e}")
        return None

# --- CLI Interface (for testing or background tasks) ---
if __name__ == "__main__":
    import sys
    if len(sys.argv) < 3:
        print("Usage: python universal_ai_process.py <supplier_id> <products_json>")
        sys.exit(1)

    supplier_id = sys.argv[1]
    products_raw = sys.argv[2]
    
    # Check if second arg is a file or a JSON string
    if os.path.exists(products_raw):
        with open(products_raw, 'r', encoding='utf-8') as f:
            products = json.load(f)
    else:
        products = json.loads(products_raw)
    
    settings = get_ai_settings(supplier_id)
    results = []
    
    parallel_enabled = settings.get("ai_parallel_enabled", False)
    parallel_count = settings.get("ai_parallel_count", 5)

    def process_and_merge(p):
        cleaned = process_product_ai(p, settings)
        if cleaned:
            return {**p, **cleaned, "ai_processed": True}
        else:
            return {**p, "ai_processed": False}

    if parallel_enabled and len(products) > 1:
        logging.info(f"Starting parallel processing with {parallel_count} threads...")
        with ThreadPoolExecutor(max_workers=parallel_count) as executor:
            results = list(executor.map(process_and_merge, products))
    else:
        for p in products:
            results.append(process_and_merge(p))
            
    print(json.dumps(results, ensure_ascii=False))
