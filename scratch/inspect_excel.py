import pandas as pd
import json

file_path = r'C:\Users\redmi\Desktop\Автовыгрузка\Таблица Поставщиков.xlsx'
try:
    df = pd.read_excel(file_path)
    print("Columns:", df.columns.tolist())
    print("First row data:")
    print(df.iloc[0].to_dict())
    
    # Let's also see some data for brand tags if they exist
    if 'tag id' in [c.lower() for c in df.columns]:
        tag_col = [c for c in df.columns if c.lower() == 'tag id'][0]
        print(f"Sample from {tag_col}:")
        print(df[tag_col].head(5).tolist())
        
except Exception as e:
    print(f"Error: {e}")
