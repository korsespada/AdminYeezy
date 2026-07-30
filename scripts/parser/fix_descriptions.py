import csv
import os


def process_products(products):
    result = []
    pending_indices = []
    for product in products:
        description = str(product.get("description") or "")
        if description.startswith("细节图请品鉴"):
            pending_indices.append(len(result))
            result.append(dict(product))
        elif "💰" in description:
            if pending_indices:
                for index in pending_indices:
                    result[index]["description"] = description
                pending_indices = []
            else:
                result.append(dict(product))
        else:
            result.append(dict(product))
    return result


def fix_csv_descriptions(input_path, output_path):
    import pandas as pd
    print(f"Читаю файл: {input_path}...")
    # Загружаем CSV с разделителем ;
    df = pd.read_csv(input_path, sep=';', encoding='utf-8-sig')
    
    final_rows = []
    pending_indices = [] # Список индексов накопленных строк "деталей" в итоговом списке
    
    for _, row in df.iterrows():
        description = str(row['description'])
        
        # 1. Если строка начинается на паттерн деталей
        if description.startswith('细节图请品鉴'):
            pending_indices.append(len(final_rows))
            final_rows.append(row.copy().to_dict())
            
        # 2. Если в строке есть значок цены
        elif '💰' in description:
            if pending_indices:
                # Заменяем описание во всех накопленных строках
                for idx in pending_indices:
                    final_rows[idx]['description'] = description
                
                # Очищаем список накопления
                pending_indices = []
                
                # Саму строку с ценой НЕ добавляем (она удаляется)
                continue
            else:
                # Если деталей перед ценой не было, оставляем строку как есть
                final_rows.append(row.copy().to_dict())
        
        # 3. Все остальные строки
        else:
            final_rows.append(row.copy().to_dict())
            # Если мы встретили что-то другое, кроме деталей или цены, 
            # мы добавляем это в файл. Если до этого были детали, 
            # они все еще ждут цены (на случай если между ними пустая строка)

    # Создаем новый DataFrame из списка словарей
    df_result = pd.DataFrame(final_rows)
    
    # Сохраняем результат
    df_result.to_csv(output_path, sep=';', index=False, encoding='utf-8-sig', quoting=csv.QUOTE_MINIMAL)
    
    print(f"Готово! Было строк: {len(df)}, стало: {len(df_result)}")
    print(f"Итог сохранен в: {output_path}")

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 2:
        INPUT_FILE = sys.argv[1]
        OUTPUT_FILE = sys.argv[2]
        if os.path.exists(INPUT_FILE):
            fix_csv_descriptions(INPUT_FILE, OUTPUT_FILE)
        else:
            print(f"Ошибка: файл {INPUT_FILE} не найден.")
        sys.exit(0)

    BASE_PATH = os.path.dirname(os.path.abspath(__file__))
    INPUT_FILE = os.path.join(BASE_PATH, "szwego1.csv")
    OUTPUT_FILE = os.path.join(BASE_PATH, "szwego_fixed1.csv")
    
    if os.path.exists(INPUT_FILE):
        fix_csv_descriptions(INPUT_FILE, OUTPUT_FILE)
    else:
        print(f"Ошибка: файл {INPUT_FILE} не найден.")
