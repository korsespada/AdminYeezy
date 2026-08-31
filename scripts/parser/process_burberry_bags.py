"""Keep substantive Burberry bag albums and expose their model identity.

The source feed is a year-long timeline with repeated service cards.  The
Node batch workflow performs the cross-album duplicate check after this pure
filter has run, because it must protect external IDs already present in Rails.
"""

import copy
import hashlib
import re


MIN_PHOTOS = 6
MIN_DESCRIPTION_LENGTH = 100

MODEL_RE = re.compile(
    r"(?:model|型号|款号|货号|编号)\s*[:：#]?\s*([a-z0-9][a-z0-9._/-]{3,15})",
    re.IGNORECASE,
)
DIMENSIONS_RE = re.compile(
    r"\d{1,3}(?:\.\d+)?\s*[x×*<]\s*\d{1,3}(?:\.\d+)?"
    r"(?:\s*[x×*<]\s*\d{1,3}(?:\.\d+)?)?\s*(?:c\s*m)?",
    re.IGNORECASE,
)
GARBAGE_DESCRIPTION_RE = re.compile(
    r"comparison|compare|compared\s+(?:to|with)|vs|对比|对照|尺寸对比|"
    r"authentic\s+(?:product\s+image|real\s+shot)|"
    r"(?:small|medium|large)\s*/\s*(?:small|medium|large)|"
    r"(?:small|medium|large)\s+(?:and|\+)\s+(?:small|medium|large)|"
    r"image\s*(?:small|medium|large)|size\s+comparison",
    re.IGNORECASE,
)


def normalize_text(value):
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


def extract_model_code(description):
    match = MODEL_RE.search(str(description or ""))
    if not match:
        return ""
    code = re.sub(r"[^a-z0-9]", "", match.group(1).casefold())
    return code.upper() if any(char.isdigit() for char in code) else ""


def has_dimensions(description):
    return bool(DIMENSIONS_RE.search(str(description or "")))


def has_multiple_dimensions(description):
    values = {
        normalize_text(match.group(0)).replace(" ", "")
        for match in DIMENSIONS_RE.finditer(str(description or ""))
    }
    return len(values) > 1


def is_substantive(product):
    photos = product.get("photos") if isinstance(product, dict) else []
    description = product.get("description") if isinstance(product, dict) else ""
    if not isinstance(photos, list) or len(photos) < MIN_PHOTOS:
        return False
    if len(normalize_text(description)) < MIN_DESCRIPTION_LENGTH:
        return False
    if GARBAGE_DESCRIPTION_RE.search(str(description or "")):
        return False
    if has_multiple_dimensions(description):
        return False
    model_code = extract_model_code(description)
    if not model_code and not has_dimensions(description):
        return False
    # Service captions normally have neither a full model code nor dimensions;
    # those positive identity checks keep them out without rejecting a valid
    # product description that mentions a comparison or detail photo.
    return True


def process_products(products):
    result = []
    for original in products if isinstance(products, list) else []:
        if not isinstance(original, dict) or not is_substantive(original):
            continue
        product = copy.deepcopy(original)
        attributes = product.get("attributes")
        attributes = copy.deepcopy(attributes) if isinstance(attributes, dict) else {}
        model_code = extract_model_code(product.get("description"))
        if model_code:
            attributes["model_code"] = model_code
        product["attributes"] = attributes
        result.append(product)

    model_counts = {}
    for product in result:
        code = product.get("attributes", {}).get("model_code")
        if code:
            model_counts[code] = model_counts.get(code, 0) + 1
    for product in result:
        code = product.get("attributes", {}).get("model_code")
        if code and model_counts[code] > 1:
            product["variant_group_key"] = hashlib.md5(
                f"burberry:{code}".encode("utf-8")
            ).hexdigest()
            product["variant_group_name"] = f"Burberry {code}"
        else:
            product.pop("variant_group_key", None)
            product.pop("variant_group_name", None)
    return result
