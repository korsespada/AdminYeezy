import psycopg2
import os
import dotenv
import json

dotenv.load_dotenv()

def get_suppliers():
    conn = psycopg2.connect(os.getenv('SCRAPING_DATABASE_URL'))
    cur = conn.cursor()
    cur.execute("SELECT id, name, ai_instructions FROM suppliers")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return rows

suppliers = get_suppliers()
for s in suppliers:
    print(f"ID: {s[0]}, Name: {s[1]}, Instructions: {s[2]}")
