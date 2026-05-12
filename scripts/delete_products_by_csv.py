import os
import csv
import json
import boto3
from botocore.exceptions import ClientError
import psycopg2
from dotenv import load_dotenv

# --- НАСТРОЙКИ S3 BEGET ---
S3_ENDPOINT = "https://s3.ru1.storage.beget.cloud"
S3_REGION = "ru-1"
S3_ACCESS_KEY = "HAZ3Y4SJA3IO5FF4W3E3"
S3_SECRET_KEY = "e5PuCtCmWkxl7aAJ74JlEgZLviS9kWpFAM8MBlPB"
S3_BUCKET = "85758a34b2c7-yeezyunique-static"
S3_PUBLIC_DOMAIN = "https://static.yeezyunique.ru"
# --------------------------

# --- НАСТРОЙКИ ---
# Просто замени путь ниже на нужный файл
CSV_PATH = r"C:\Users\redmi\Desktop\Parsing\LV сумки и кошельки\szwego_ai_processed.csv"
COLUMN_NAME = "productId"  # Название колонки в CSV
DB_COLUMN = "external_id"  # Название колонки в базе данных (в таблице products)
# -----------------

def get_s3_client():
    """Создание S3 клиента для Beget"""
    return boto3.client(
        's3',
        endpoint_url=S3_ENDPOINT,
        region_name=S3_REGION,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY
    )

def extract_s3_key(url):
    """Извлечение ключа S3 из URL"""
    if not url:
        return None
    # Убираем домен из URL
    if url.startswith(S3_PUBLIC_DOMAIN):
        return url.replace(S3_PUBLIC_DOMAIN + "/", "")
    return None

def delete_photos_from_s3(photos_json):
    """Удаление фотографий из S3 (батчами)"""
    if not photos_json:
        return 0
    
    try:
        photos = json.loads(photos_json) if isinstance(photos_json, str) else photos_json
    except:
        return 0
    
    if not photos or not isinstance(photos, list):
        return 0
    
    # Извлекаем ключи
    keys = []
    for photo_url in photos:
        key = extract_s3_key(photo_url)
        if key:
            keys.append({'Key': key})
    
    if not keys:
        return 0
    
    s3 = get_s3_client()
    deleted_count = 0
    
    # Удаляем батчами по 1000 (лимит S3)
    for i in range(0, len(keys), 1000):
        batch = keys[i:i + 1000]
        try:
            s3.delete_objects(
                Bucket=S3_BUCKET,
                Delete={'Objects': batch, 'Quiet': True}
            )
            deleted_count += len(batch)
            print(f"  Удалено из S3: {len(batch)} фото")
        except ClientError as e:
            print(f"  Ошибка батч-удаления: {e}")
    
    return deleted_count

def delete_products():
    # Загружаем переменные окружения из .env (там лежит DATABASE_URL)
    load_dotenv()
    db_url = os.getenv("DATABASE_URL")
    
    if not db_url:
        print("Ошибка: DATABASE_URL не найден в .env файле")
        return

    # 1. Читаем ID из CSV
    ids_to_delete = []
    try:
        # Пробуем открыть файл
        if not os.path.exists(CSV_PATH):
            print(f"Ошибка: Файл не найден по пути {CSV_PATH}")
            return

        with open(CSV_PATH, mode='r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            
            # Авто-детект разделителя (запятая или точка с запятой)
            if not reader.fieldnames or len(reader.fieldnames) == 1:
                f.seek(0)
                content = f.read(1024)
                f.seek(0)
                delimiter = ';' if ';' in content else ','
                reader = csv.DictReader(f, delimiter=delimiter)

            # Проверяем наличие колонки
            actual_col = next((c for c in reader.fieldnames if c.strip().lower() == COLUMN_NAME.lower()), None)
            
            if not actual_col:
                print(f"Ошибка: Колонка '{COLUMN_NAME}' не найдена. Доступные колонки: {reader.fieldnames}")
                return

            for row in reader:
                val = row[actual_col].strip()
                if val:
                    ids_to_delete.append(val)
                    
    except Exception as e:
        print(f"Ошибка при чтении файла: {e}")
        return

    if not ids_to_delete:
        print("Файл пуст или ID не найдены.")
        return

    # Убираем дубликаты
    ids_to_delete = list(set(ids_to_delete))
    print(f"Найдено {len(ids_to_delete)} уникальных ID для удаления.")

    # 2. Подключаемся к БД
    conn = None
    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        
        # 2.1 Сначала получаем фотографии для удаления
        print("\n--- Получение фотографий из БД ---")
        photos_to_delete = {}
        
        for i in range(0, len(ids_to_delete), 500):
            chunk = ids_to_delete[i:i + 500]
            cur.execute(f"SELECT {DB_COLUMN}, photos FROM products WHERE {DB_COLUMN} IN %s", (tuple(chunk),))
            for row in cur.fetchall():
                product_id, photos = row
                if photos:
                    photos_to_delete[product_id] = photos
        
        print(f"Найдено товаров с фотографиями: {len(photos_to_delete)}")
        
        # 2.2 Удаляем фотографии из S3
        total_photos_deleted = 0
        if photos_to_delete:
            print("\n--- Удаление фотографий из S3 ---")
            for product_id, photos in photos_to_delete.items():
                count = delete_photos_from_s3(photos)
                total_photos_deleted += count
            print(f"Всего удалено фото из S3: {total_photos_deleted}")
        
        # 2.3 Удаляем товары из БД
        print("\n--- Удаление товаров из БД ---")
        chunk_size = 500
        total_deleted = 0
        
        for i in range(0, len(ids_to_delete), chunk_size):
            chunk = ids_to_delete[i:i + chunk_size]
            # SQL запрос на удаление
            cur.execute(f"DELETE FROM products WHERE {DB_COLUMN} IN %s", (tuple(chunk),))
            total_deleted += cur.rowcount
            print(f"Процесс: {i + len(chunk)} / {len(ids_to_delete)}...")
        
        conn.commit()
        print(f"\n--- ГОТОВО ---")
        print(f"Успешно удалено из базы: {total_deleted} товаров.")
        print(f"Удалено из S3: {total_photos_deleted} фотографий.")
        
    except Exception as e:
        if conn: conn.rollback()
        print(f"Ошибка при работе с базой данных: {e}")
    finally:
        if conn: conn.close()

if __name__ == "__main__":
    delete_products()
