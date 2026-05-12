import csv

file_path = r'c:\projects-vibe\admin-yeezy-app\tmp\task_ai_286354.csv'
sub_map = {}

with open(file_path, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f, delimiter=';')
    for row in reader:
        name = row['name']
        sub_id = row['subcategory']
        
        # Try to guess the subcategory name from the product name
        # Examples: "Hermes Вьетнамки Kelly", "Celine Лоферы", "Chanel Босоножки"
        parts = name.split()
        if len(parts) >= 2:
            sub_name = parts[1] # Usually the second word is the type
            if sub_id not in sub_map:
                sub_map[sub_id] = set()
            sub_map[sub_id].add(sub_name)

for sid, names in sub_map.items():
    print(f"{sid}: {list(names)}")
