"""JSON stdin/stdout contract for supplier post-processors.

Native processors expose process_products(products). Older processors remain
available through an isolated compatibility path while they are migrated; no
CSV artifact is exposed to the application or stored in history.
"""

import contextlib
import csv
import importlib.util
import io
import json
import os
import sys
from unittest.mock import patch


CORE_FIELDS = [
    "external_id",
    "name",
    "description",
    "price",
    "brand",
    "category",
    "subcategory",
    "gender",
    "photos",
]
INTERNAL_FIELDS = {
    "id",
    "batch_id",
    "created_at",
    "updated_at",
    "ai_sampled",
}


def load_module(script_name):
    safe_name = os.path.basename(str(script_name or "").strip())
    if safe_name != script_name or not safe_name.endswith(".py"):
        raise ValueError("Недопустимое имя post-process скрипта")
    script_path = os.path.join(os.path.dirname(__file__), safe_name)
    if not os.path.isfile(script_path):
        raise ValueError(f"Post-process скрипт не найден: {safe_name}")
    spec = importlib.util.spec_from_file_location(f"supplier_{safe_name[:-3]}", script_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def legacy_columns(products):
    attribute_keys = []
    seen = set(CORE_FIELDS)
    for product in products:
        for key in (product.get("attributes") or {}).keys():
            if key not in seen:
                seen.add(key)
                attribute_keys.append(key)
        for key in product.keys():
            if key not in seen and key not in INTERNAL_FIELDS and key != "attributes":
                seen.add(key)
                attribute_keys.append(key)
    return CORE_FIELDS + attribute_keys


def csv_value(product, key):
    if key == "photos":
        return json.dumps(product.get("photos") or [], ensure_ascii=False)
    if key in CORE_FIELDS:
        value = product.get(key)
    else:
        value = product.get(key, (product.get("attributes") or {}).get(key))
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return "" if value is None else value


class CapturedTextOutput(io.StringIO):
    def __init__(self, capture):
        super().__init__()
        self.capture = capture

    def close(self):
        if not self.closed:
            self.capture["value"] = self.getvalue()
        super().close()


def run_legacy(module, products):
    columns = legacy_columns(products)
    source = io.StringIO()
    writer = csv.DictWriter(source, fieldnames=columns, delimiter=";", extrasaction="ignore")
    writer.writeheader()
    for product in products:
        writer.writerow({key: csv_value(product, key) for key in columns})
    source_text = source.getvalue()

    input_path = "__json_products_input__.csv"
    output_path = "__json_products_output__.csv"
    output_capture = {"value": ""}
    real_open = open
    real_exists = os.path.exists

    def virtual_open(file, mode="r", *args, **kwargs):
        normalized = os.fspath(file)
        if normalized == input_path and "r" in mode:
            return io.StringIO(source_text)
        if normalized == output_path and any(flag in mode for flag in ("w", "a", "x")):
            return CapturedTextOutput(output_capture)
        return real_open(file, mode, *args, **kwargs)

    def virtual_exists(file):
        return os.fspath(file) in (input_path, output_path) or real_exists(file)

    processor = (
        getattr(module, "process_csv", None)
        or getattr(module, "fix_csv_descriptions", None)
        or getattr(module, "filter_csv_by_keyword", None)
    )
    if not callable(processor):
        raise ValueError("Legacy post-process функция не найдена")

    with patch("builtins.open", virtual_open), patch("os.path.exists", virtual_exists):
        with contextlib.redirect_stdout(sys.stderr):
            processor(input_path, output_path)

    rows = list(csv.DictReader(io.StringIO(output_capture["value"]), delimiter=";"))

    originals = {str(product.get("external_id")): product for product in products}
    result = []
    for row in rows:
        original = originals.get(str(row.get("external_id")), {})
        product = dict(original)
        attributes = dict(original.get("attributes") or {})
        for key, value in row.items():
            if key == "photos":
                try:
                    product[key] = json.loads(value or "[]")
                except json.JSONDecodeError:
                    product[key] = []
            elif key in CORE_FIELDS:
                product[key] = value
            elif key and value not in (None, ""):
                attributes[key] = value
        product["attributes"] = attributes
        result.append(product)
    return result


def main():
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    script_name = str(payload.get("script") or "").strip()
    products = payload.get("products")
    if not isinstance(products, list):
        raise ValueError("products должен быть массивом")
    module = load_module(script_name)
    if callable(getattr(module, "process_products", None)) and not payload.get("force_legacy"):
        with contextlib.redirect_stdout(sys.stderr):
            result = module.process_products(products)
    elif any(callable(getattr(module, name, None)) for name in (
        "process_csv", "fix_csv_descriptions", "filter_csv_by_keyword"
    )):
        result = run_legacy(module, products)
    else:
        raise ValueError(f"{script_name} не поддерживает post-process контракт")
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise
