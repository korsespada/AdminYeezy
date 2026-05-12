import os

file_path = 'actions/suppliers.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace assignments
content = content.replace("const aliases = formData.get('aliases') as string || ''", 
                          "const ai_deep_search_enabled = formData.get('ai_deep_search_enabled') === 'on'")
content = content.replace("const merge_enabled = formData.get('merge_enabled') === 'on'", 
                          "const ai_resize_enabled = formData.get('ai_resize_enabled') === 'on'")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
