import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

db_url = os.getenv("SCRAPING_DATABASE_URL")
print(f"Connecting to: {db_url}")

try:
    conn = psycopg2.connect(db_url)
    print("Connection successful!")
    conn.close()
except Exception as e:
    print(f"Connection failed: {e}")

db_url_main = os.getenv("DATABASE_URL")
print(f"Connecting to main: {db_url_main}")
try:
    conn = psycopg2.connect(db_url_main)
    print("Main connection successful!")
    conn.close()
except Exception as e:
    print(f"Main connection failed: {e}")
