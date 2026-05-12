import pandas as pd
import json
import math

file_path = r'C:\Users\redmi\Desktop\Автовыгрузка\Таблица Поставщиков.xlsx'

def clean_val(x):
    if isinstance(x, float) and math.isnan(x):
        return None
    return x

try:
    df = pd.read_excel(file_path)
    data = []
    for _, row in df.iterrows():
        item = {k: clean_val(v) for k, v in row.to_dict().items()}
        data.append(item)
    
    with open('tmp_suppliers.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("Exported to tmp_suppliers.json")
except Exception as e:
    print(f"Error: {e}")
