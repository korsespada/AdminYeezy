#!/usr/bin/env python3
"""Затирание вотермарки David Studio на фото поставщика (пилот + повторные прогоны).

Версия 4. Что учтено по замечаниям к пилоту:

  * оценка попадания — по ОТНОШЕНИЮ откликов двух шаблонов: у настоящей вотермарки
    второй шаблон даёт z в 1.7–2.3 раза выше первого, у фактуры металла отношение ≈1.0.
    Балл = zB * min(zB/zA, 2), порог 15 — отсекает ложные срабатывания;
  * изолированность пика (iso): у текста пик резкий, у фактуры — плато;
  * вместо раздутия маски — до пяти АДРЕСНЫХ проходов: три по порогу от контраста
    штрихов (0.35/0.18/0.10) и два по слабому остатку с порогом от шума фона
    (3σ и 2σ) — именно они добирают точечные следы, которые глаз ещё видит,
    а метрика уже считает нормой;
  * маска ограничена 40% бокса, иначе кадр уходит на глаза без правки;
  * при неуверенном детекте кадр не изменяется вообще.

Запуск (из корня репозитория):
  .venv\\Scripts\\python.exe scripts\\david-studio-watermark\\clean_david_watermark.py --per-category 3
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.request
from dataclasses import dataclass

import cv2
import numpy as np

# --- параметры -------------------------------------------------------------------
NORM_WIDTH = 800
SIGMA = 6.0
REL_SWEEP = [round(0.38 + 0.01 * i, 2) for i in range(23)]   # 0.38 .. 0.60
REL_LO, REL_HI = 0.40, 0.58     # кластер реальных масштабов вотермарки
ISO_MIN = 2.5                   # изолированность пика
SCORE_HIT = 15.0                # порог балла попадания: zB * min(zB/zA, 2)
# Мягкие пороги для низкого контраста: белые буквы на коже дают менее
# изолированный пик при том же согласии двух шаблонов. Согласие обязательно:
# у фактуры металла отношение zB/zA ≈ 1.04, у настоящей вотермарки ≥ 1.3.
# Диапазон масштабов не расширяем: кадр с чужим логотипом на масштабе 0.62
# проходил строгое правило и замазывался.
ISO_MIN_RELAXED = 2.0
SCORE_HIT_RELAXED = 13.0
RATIO_MIN = 1.3
Z_STOP = 0.30                  # прекращаем уточнять, когда остаток почти нулевой
Z_OK = 1.0                     # порог вердикта «готово»
MASK_DILATE = 4                 # рабочий шаг маски
FILL_CAP = 0.40                 # больше 40% бокса в маску не берём
# Проходы: ("pct", фактор от контраста штрихов, окно близости) или
#         ("abs", порог в сигмах шума фона, окно близости)
PASSES = (("pct", 0.35, 5), ("pct", 0.18, 5), ("pct", 0.10, 7),
          ("abs", 3.0, 9), ("abs", 2.0, 9))
LAMA_URL = "https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt"
LAMA_MD5 = "e3aa4aaa15225a33ec84f9f4bc47e500"
MAX_SIDE = 1024
REFERENCE_URL = ("https://cdn.shopify.com/s/files/1/0633/4827/7456/files/"
                 "1_d6962ddf-81e5-47bb-8ab4-df45aa9d3e41.jpg?v=1786285034&width=2000")
REFERENCE_BOX = (455, 1475, 1545, 1670)   # бокс вотермарки в эталонном кадре 2000x2000


def log(*args: object) -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    print(*args)
    sys.stdout.flush()


# --- шаблоны ---------------------------------------------------------------------
def residual(gray: np.ndarray) -> np.ndarray:
    """Пиксель минус локальный фон: устойчиво к фону и силе прозрачности."""
    return gray.astype(np.float32) - cv2.GaussianBlur(gray, (0, 0), SIGMA).astype(np.float32)


def strokes_from_gray(gray: np.ndarray, prior: np.ndarray | None = None) -> np.ndarray:
    """Штрихи по остатку кадра; при заданном prior — только рядом с ним."""
    magnitude = np.abs(residual(gray))
    region = magnitude[prior > 0] if prior is not None and np.count_nonzero(prior) else magnitude
    threshold = max(0.40 * float(np.percentile(region, 99.0)), 1.8)
    strokes = (magnitude > threshold).astype(np.uint8)
    if prior is not None and np.count_nonzero(prior):
        strokes = strokes * (cv2.dilate(prior, np.ones((5, 5), np.uint8)) > 0)
    return cv2.dilate(strokes, np.ones((2, 2), np.uint8), iterations=1)


def strokes_at(template: np.ndarray, width: int, height: int) -> np.ndarray:
    """Маска штрихов в нужном размере (INTER_AREA + мягкий порог: сохраняет тонкие штрихи)."""
    scaled = cv2.resize(template.astype(np.float32), (width, height), interpolation=cv2.INTER_AREA)
    return cv2.dilate((scaled > 0.25).astype(np.uint8), np.ones((2, 2), np.uint8), iterations=1)


# --- детектор --------------------------------------------------------------------
@dataclass
class Hit:
    z: float = -1.0
    z_a: float = 0.0
    z_b: float = 0.0
    score: float = 0.0
    iso: float = 0.0
    rel: float = 0.0
    polarity: str = ""
    x: int = 0
    y: int = 0
    w: int = 0
    h: int = 0


def normalize(image: np.ndarray) -> np.ndarray:
    scale = NORM_WIDTH / image.shape[1]
    return cv2.resize(image, (NORM_WIDTH, max(int(round(image.shape[0] * scale)), 8)),
                      interpolation=cv2.INTER_AREA)


def is_confident(hit: "Hit") -> bool:
    """Решение «вотермарка найдена».

    Строгое правило — высокий балл и изолированный пик. Мягкое включается только
    при согласии обоих шаблонов (zB/zA >= RATIO_MIN): так проходят кадры, где
    белые буквы лежат на коже и пик размывается фактурой, а ложные срабатывания
    на металле (отношение около 1.04) по-прежнему отсекаются.
    """
    if not (REL_LO <= hit.rel <= REL_HI):
        return False
    if hit.score >= SCORE_HIT and hit.iso >= ISO_MIN:
        return True
    ratio = (hit.z_b / hit.z_a) if hit.z_a else 0.0
    return (ratio >= RATIO_MIN
            and hit.score >= SCORE_HIT_RELAXED
            and hit.iso >= ISO_MIN_RELAXED)


def score_map_for(diff: np.ndarray, template: np.ndarray, width: int, height: int,
                  sign: float) -> np.ndarray | None:
    mask = strokes_at(template, width, height).astype(np.float32)
    area = float(mask.sum())
    if area < 100:
        return None
    return cv2.matchTemplate(diff, mask * sign, cv2.TM_CCORR) / np.sqrt(area)


def z_at(score_map: np.ndarray, y: int, x: int) -> float:
    mean, std = float(score_map.mean()), float(score_map.std())
    if std <= 1e-9:
        return 0.0
    y = min(max(y, 0), score_map.shape[0] - 1)
    x = min(max(x, 0), score_map.shape[1] - 1)
    return (float(score_map[y, x]) - mean) / std


def detect(gray: np.ndarray, templates: list[np.ndarray]) -> Hit:
    diff = residual(gray)
    base = templates[0]
    best = Hit()
    for rel in REL_SWEEP:
        width = int(round(rel * gray.shape[1]))
        height = int(round(base.shape[0] * width / base.shape[1]))
        if width >= gray.shape[1] or height >= gray.shape[0] or height < 8:
            continue
        for sign, label in ((-1.0, "dark"), (1.0, "light")):
            maps = [score_map_for(diff, template, width, height, sign) for template in templates]
            if any(m is None for m in maps):
                continue
            combined = sum(maps) / len(maps)
            mean, std = float(combined.mean()), float(combined.std())
            if std <= 1e-9:
                continue
            _, max_val, _, loc = cv2.minMaxLoc(combined)
            z_a, z_b = z_at(maps[0], loc[1], loc[0]), z_at(maps[1], loc[1], loc[0])
            ratio = z_b / z_a if z_a > 1e-6 else 0.0
            score = z_b * min(ratio, 2.0)
            top = float(np.percentile(combined, 99.0))
            iso = (max_val - mean) / (top - mean) if top - mean > 1e-9 else 0.0
            if score > best.score:
                best = Hit(z=round(float((max_val - mean) / std), 2), z_a=round(float(z_a), 2),
                           z_b=round(float(z_b), 2), score=round(float(score), 2),
                           iso=round(float(iso), 2), rel=rel, polarity=label,
                           x=int(loc[0]), y=int(loc[1]), w=width, h=height)
    return best


def local_z(gray: np.ndarray, templates: list[np.ndarray], hit: Hit) -> float:
    """z-оценка отклика строго в найденной точке: держит остаточный рисунок букв."""
    sign = -1.0 if hit.polarity.startswith("dark") else 1.0
    maps = [score_map_for(residual(gray), template, hit.w, hit.h, sign) for template in templates]
    if any(m is None for m in maps):
        return 0.0
    return z_at(sum(maps) / len(maps), hit.y, hit.x)


# --- затирание -------------------------------------------------------------------
def pass_mask(gray: np.ndarray, prior: np.ndarray, hit: Hit, mode: str, value: float,
              near_px: int) -> np.ndarray:
    """Штрихи шаблона + остаток кадра рядом с ними, в пределах бокса.

    Для режима "pct" порог берётся от контраста штрихов, для "abs" — от шума фона
    (нужно для точечных следов, которые слабее любого процента от контраста).
    """
    mask = np.zeros(gray.shape, np.uint8)
    y1, x1 = min(hit.y + hit.h, gray.shape[0]), min(hit.x + hit.w, gray.shape[1])
    if y1 <= hit.y or x1 <= hit.x:
        return mask
    local_prior = prior[: y1 - hit.y, : x1 - hit.x]
    if np.count_nonzero(local_prior) < 50:
        return mask
    magnitude = np.abs(residual(gray[hit.y:y1, hit.x:x1]))
    near = cv2.dilate(local_prior, np.ones((near_px, near_px), np.uint8), iterations=1) > 0
    if mode == "pct":
        threshold = max(value * float(np.percentile(magnitude[local_prior > 0], 99.0)), 1.4)
    else:
        background = magnitude[~near]
        if background.size:
            median = float(np.median(background))
            sigma = 1.4826 * float(np.median(np.abs(background - median)))
        else:
            sigma = 1.0
        threshold = max(value * max(sigma, 0.35), 1.2)
    observed = ((magnitude > threshold) & near).astype(np.uint8)
    strokes = ((local_prior > 0) | (observed > 0)).astype(np.uint8)
    strokes = cv2.dilate(strokes, np.ones((MASK_DILATE, MASK_DILATE), np.uint8), iterations=1)
    mask[hit.y:y1, hit.x:x1] = strokes * 255
    return mask


def lama_inpaint(model, torch, image_bgr: np.ndarray, mask: np.ndarray) -> np.ndarray:
    h, w = image_bgr.shape[:2]
    pad_h, pad_w = (8 - h % 8) % 8, (8 - w % 8) % 8
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    m = (mask > 0).astype(np.float32)
    rgb = np.pad(rgb, ((0, pad_h), (0, pad_w), (0, 0)), mode="symmetric")
    m = np.pad(m, ((0, pad_h), (0, pad_w)), mode="constant")
    with torch.inference_mode():
        out = model(torch.from_numpy(rgb.transpose(2, 0, 1)).unsqueeze(0),
                    torch.from_numpy(m).unsqueeze(0).unsqueeze(0))
    out = out[0].permute(1, 2, 0).numpy()
    out = np.clip(out * 255, 0, 255).astype(np.uint8)[:h, :w]
    return cv2.cvtColor(out, cv2.COLOR_RGB2BGR)


def apply_pass(model, torch, image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    work, mask_work, scale = image, mask, 1.0
    if max(image.shape[:2]) > MAX_SIDE:
        scale = MAX_SIDE / max(image.shape[:2])
        work = cv2.resize(image, (int(image.shape[1] * scale), int(image.shape[0] * scale)),
                          interpolation=cv2.INTER_AREA)
        mask_work = cv2.resize(mask, (work.shape[1], work.shape[0]), interpolation=cv2.INTER_NEAREST)
    filled = lama_inpaint(model, torch, work, mask_work)
    cleaned = work.copy()
    cleaned[mask_work > 0] = filled[mask_work > 0]
    if scale == 1.0:
        return cleaned
    out = cv2.resize(cleaned, (image.shape[1], image.shape[0]), interpolation=cv2.INTER_CUBIC)
    out[mask == 0] = image[mask == 0]
    return out


# --- прочее ----------------------------------------------------------------------
def ensure_model(path: str) -> str:
    if os.path.exists(path) and hashlib.md5(open(path, "rb").read()).hexdigest() == LAMA_MD5:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    log(f"скачиваю модель LaMa -> {path}")
    urllib.request.urlretrieve(LAMA_URL, path)
    digest = hashlib.md5(open(path, "rb").read()).hexdigest()
    if digest != LAMA_MD5:
        raise SystemExit(f"md5 модели не совпал: {digest}")
    return path


def load_lama(path: str):
    import torch
    torch.set_num_threads(max(os.cpu_count() or 4, 1))
    return torch.jit.load(path, map_location="cpu").eval(), torch


def download(url: str, path: str) -> tuple[str, str]:
    if os.path.exists(path):
        return path, ""
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        data, etag = response.read(), response.headers.get("ETag", "")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(data)
    return path, etag


def source_name(url: str) -> str:
    return hashlib.sha1(url.encode()).hexdigest()[:16] + os.path.splitext(url.split("?")[0])[1]


def sheets(panels: list[np.ndarray], path: str, columns: int = 2) -> None:
    if not panels:
        return
    width = max(p.shape[1] for p in panels)
    padded = [np.pad(p, ((0, 0), (0, width - p.shape[1]), (0, 0)), constant_values=255) for p in panels]
    rows = []
    for i in range(0, len(padded), columns):
        chunk = padded[i:i + columns]
        height = max(c.shape[0] for c in chunk)
        chunk = [np.pad(c, ((0, height - c.shape[0]), (0, 0), (0, 0)), constant_values=255) for c in chunk]
        rows.append(np.hstack(chunk))
    row_width = max(r.shape[1] for r in rows)
    rows = [np.pad(r, ((0, 0), (0, row_width - r.shape[1]), (0, 0)), constant_values=255) for r in rows]
    cv2.imwrite(path, np.vstack(rows))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", default="data/david-studio/catalog.json")
    parser.add_argument("--out", default="tmp/david-watermark-pilot")
    parser.add_argument("--per-category", type=int, default=3)
    parser.add_argument("--categories", default="")
    parser.add_argument("--extra", default="")
    parser.add_argument("--only", default="")
    parser.add_argument("--titles", default="")
    parser.add_argument("--model-dir", default="tmp/david-watermark-pilot/models")
    parser.add_argument("--no-lama", action="store_true")
    args = parser.parse_args()

    out_dir = os.path.abspath(args.out)
    src_dir, clean_dir = os.path.join(out_dir, "src"), os.path.join(out_dir, "clean")
    masks_dir = os.path.join(out_dir, "masks")
    for path in (src_dir, clean_dir, masks_dir):
        os.makedirs(path, exist_ok=True)
    manifest_path = os.path.join(out_dir, "manifest.json")
    manifest = json.load(open(manifest_path, encoding="utf-8")) if os.path.exists(manifest_path) else {}

    template_a_path = os.path.join(out_dir, "template-a.png")
    template_b_path = os.path.join(out_dir, "template-b.png")
    if not os.path.exists(template_a_path):
        path, _ = download(REFERENCE_URL, os.path.join(src_dir, "_reference-a.jpg"))
        reference = cv2.imread(path)
        cv2.imwrite(template_a_path,
                    strokes_from_gray(cv2.cvtColor(reference, cv2.COLOR_BGR2GRAY)[
                        REFERENCE_BOX[1]:REFERENCE_BOX[3], REFERENCE_BOX[0]:REFERENCE_BOX[2]]) * 255)
    template_a = (cv2.imread(template_a_path, cv2.IMREAD_GRAYSCALE) > 127).astype(np.uint8)

    tasks: list[dict] = []
    if args.only:
        for name in args.only.split("|"):
            tasks.append({"category": "manual", "title": name, "src": "", "file": name})
    else:
        catalog = json.load(open(args.catalog, encoding="utf-8"))
        categories = [c for c in args.categories.split(",") if c] or sorted(catalog["summary"]["byCategory"])
        for category in categories:
            for product in [p for p in catalog["products"] if p["category"] == category][: args.per_category]:
                if args.titles and not any(x.lower() in product["title"].lower()
                                           for x in args.titles.split("|")):
                    continue
                if product["images"]:
                    tasks.append({"category": category, "title": product["title"][:44],
                                  "src": product["images"][0]["src"], "file": ""})
        for url in [u.strip() for u in args.extra.split("|") if u.strip()]:
            tasks.append({"category": "extra", "title": "extra", "src": url, "file": ""})

    # Шаблон B — по кадру, где A даёт уверенное попадание с «подписью настоящей вотермарки».
    if not os.path.exists(template_b_path):
        candidate = None
        for task in tasks:
            if not task["src"]:
                continue
            path, _ = download(task["src"] + ("&width=2000" if "?" in task["src"] else "?width=2000"),
                               os.path.join(src_dir, source_name(task["src"])))
            image = cv2.imread(path)
            if image is None:
                continue
            hit = detect(cv2.cvtColor(normalize(image), cv2.COLOR_BGR2GRAY), [template_a, template_a])
            if hit.z >= 18 and hit.iso >= 5 and hit.polarity == "dark":
                candidate = (image, hit, path)
                break
        if candidate is None:
            raise SystemExit("не нашёл кадр для шаблона B — проверьте выгрузку")
        image, hit, path = candidate
        back = image.shape[1] / NORM_WIDTH
        x, y = int(hit.x * back), int(hit.y * back)
        w, h = int(hit.w * back), int(hit.h * back)
        roi = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)[y:y + h, x:x + w]
        cv2.imwrite(template_b_path, strokes_from_gray(roi, strokes_at(template_a, w, h)) * 255)
        log(f"шаблон B: {os.path.basename(path)} z={hit.z} iso={hit.iso} -> {template_b_path}")
    template_b = (cv2.imread(template_b_path, cv2.IMREAD_GRAYSCALE) > 127).astype(np.uint8)
    templates = [template_a, template_b]

    model = torch = None
    if not args.no_lama:
        model, torch = load_lama(ensure_model(os.path.join(args.model_dir, "big-lama.pt")))

    report, panels = [], []
    started_all = time.time()
    for index, task in enumerate(tasks, 1):
        etag = ""
        if task["file"]:
            src_path = os.path.join(src_dir, task["file"])
            url = ""
        else:
            url = task["src"]
            src_path = os.path.join(src_dir, source_name(url))
            src_path, etag = download(url + ("&width=2000" if "?" in url else "?width=2000"), src_path)
        image = cv2.imread(src_path)
        if image is None:
            log(f"  [{index}/{len(tasks)}] {task['title']}: файл не читается, пропуск")
            continue

        started = time.time()
        norm = normalize(image)
        hit = detect(cv2.cvtColor(norm, cv2.COLOR_BGR2GRAY), templates)
        confident = is_confident(hit)
        back = image.shape[1] / norm.shape[1]
        hit_orig = Hit(**{**hit.__dict__, "x": int(hit.x * back), "y": int(hit.y * back),
                          "w": int(hit.w * back), "h": int(hit.h * back)})

        clean = image
        final_mask = np.zeros(image.shape[:2], np.uint8)
        mask_px = 0
        passes_done = 0
        z_after = hit.z
        if model is not None and confident:
            prior = strokes_at(template_a, hit_orig.w, hit_orig.h)
            box_area = max(hit_orig.w * hit_orig.h, 1)
            for pass_index, (mode, value, near_px) in enumerate(PASSES, 1):
                mask = pass_mask(cv2.cvtColor(clean, cv2.COLOR_BGR2GRAY), prior, hit_orig,
                                 mode, value, near_px)
                mask_px = int(np.count_nonzero(mask))
                if mask_px == 0 or mask_px > FILL_CAP * box_area:
                    break
                clean = apply_pass(model, torch, clean, mask)
                final_mask = cv2.bitwise_or(final_mask, mask)
                passes_done = pass_index
                z_after = local_z(cv2.cvtColor(normalize(clean), cv2.COLOR_BGR2GRAY), templates, hit)
                if z_after < Z_STOP:
                    break

        if not confident:
            status = "miss"
        elif z_after < Z_OK:
            status = "ok"
        else:
            status = "review"
        clean_name = "clean-" + os.path.basename(src_path)
        cv2.imwrite(os.path.join(clean_dir, clean_name), clean)
        cv2.imwrite(os.path.join(masks_dir, "mask-" + os.path.basename(src_path)), final_mask)

        record = {"title": task["title"], "category": task["category"], "file": os.path.basename(src_path),
                  "clean": clean_name, "z": hit.z, "z_a": hit.z_a, "z_b": hit.z_b, "score": hit.score,
                  "iso": hit.iso, "rel": hit.rel, "polarity": hit.polarity,
                  "box": [hit_orig.x, hit_orig.y, hit_orig.w, hit_orig.h], "confident": bool(confident),
                  "mask_px": mask_px, "passes": passes_done, "z_after": round(float(z_after), 2),
                  "status": status, "seconds": round(time.time() - started, 1)}
        report.append(record)
        manifest[url.split("?")[0] if url else os.path.basename(src_path)] = {
            "file": os.path.basename(src_path), "etag": etag, "processed_at": time.time(),
            "status": status, "score": hit.score, "rel": hit.rel,
        }
        log(f"  [{index}/{len(tasks)}] {status:6s} score={hit.score:>6.1f} rel={hit.rel:.2f} iso={hit.iso:>5.2f} "
            f"z_after={z_after:>5.2f} mask={mask_px:>6d}px x{passes_done} {record['seconds']:>5.1f}s  "
            f"{task['title'][:32]}")

        x, y, w, h = hit_orig.x, hit_orig.y, hit_orig.w, hit_orig.h
        mx, my = int(w * 0.12), int(h * 0.6)
        x0, y0 = max(x - mx, 0), max(y - my, 0)
        x1, y1 = min(x + w + mx, clean.shape[1]), min(y + h + my, clean.shape[0])
        zoom = max(1.0, 620 / max(x1 - x0, 1))
        size = (int((x1 - x0) * zoom), int((y1 - y0) * zoom))
        panel = np.hstack([cv2.resize(image[y0:y1, x0:x1], size, interpolation=cv2.INTER_CUBIC),
                           np.full((size[1], 6, 3), 255, np.uint8),
                           cv2.resize(clean[y0:y1, x0:x1], size, interpolation=cv2.INTER_CUBIC)])
        cv2.putText(panel, f"{status} score={hit.score:.0f} z_after={z_after:.2f} {task['title'][:28]}",
                    (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
        panels.append(panel)

    with open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=1, ensure_ascii=False)
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=1, ensure_ascii=False)
    for i in range(0, len(panels), 6):
        sheets(panels[i:i + 6], os.path.join(out_dir, f"before-after-{i // 6 + 1}.png"))
    counts: dict[str, int] = {}
    for record in report:
        counts[record["status"]] = counts.get(record["status"], 0) + 1
    log(f"\nкадров: {len(report)}, время {round(time.time() - started_all, 1)} с, статусы: {counts}")
    log(f"отчёт: {os.path.join(out_dir, 'report.json')}")


if __name__ == "__main__":
    main()
