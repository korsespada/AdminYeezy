import csv
import sys
import os

def filter_csv_by_keyword(input_path, output_path=None):
    if not os.path.exists(input_path):
        print(f"Ошибка: Файл {input_path} не найден")
        return
    
    if output_path is None:
        # Если выходной файл не указан, создаем новый с постфиксом
        output_path = input_path.replace(".csv", "_filtered.csv")

    try:
        with open(input_path, 'r', encoding='utf-8-sig') as f:
            first_line = f.readline()
            delimiter = ';' if ';' in first_line else ','
            f.seek(0)
            
            reader = csv.reader(f, delimiter=delimiter)
            header = next(reader)
            
            # Оставляем только те строки, где в 3-й колонке (индекс 2) есть "细节图"
            filtered_rows = [row for row in reader if len(row) > 2 and "细节图" in row[2]]

        with open(output_path, 'w', encoding='utf-8-sig', newline='') as f:
            writer = csv.writer(f, delimiter=delimiter)
            writer.writerow(header)
            writer.writerows(filtered_rows)
            
        print(f"Успешно! Сохранено строк: {len(filtered_rows)}")

    except Exception as e:
        print(f"Ошибка: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 2:
        filter_csv_by_keyword(sys.argv[1], sys.argv[2])
    elif len(sys.argv) > 1:
        filter_csv_by_keyword(sys.argv[1])
    else:
        print("Использование: python script.py <input_csv> [output_csv]")