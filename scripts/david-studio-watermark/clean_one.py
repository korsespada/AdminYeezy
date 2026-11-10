#!/usr/bin/env python3
"""Чистка вотермарки на ОДНОМ фото — точка входа для локального воркера.

Логика детектора и затирания живёт в clean_david_watermark.py (общий модуль),
здесь только CLI: файл на входе, файл на выходе, отчёт JSON и два кропа «до/после»
для экрана ревью.

Запуск:
  python clean_one.py --in photo.jpg --out clean.webp --report report.json \
      --crop-before before.png --crop-after after.png \
      --templates data/david-studio/watermark --model tmp/models/big-lama.pt

Постоянный режим для воркера (модель грузится один раз, а не на каждое фото):
  python clean_one.py --serve --templates ... --model ...
  stdin:  по строке JSON на фото {"in", "out", "report", "crop_before", "crop_after", "box"}
  stdout: строка {"ready": true} после загрузки, затем по строке {"ok": true, "report": {...}}
          или {"ok": false, "error": "..."} на каждое фото. Логи идут в stderr.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import clean_david_watermark as core  # noqa: E402


def load_templates(directory: str) -> list[np.ndarray]:
    templates = []
    for name in ("template-a.png", "template-b.png"):
        path = os.path.join(directory, name)
        mask = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        if mask is None:
            raise SystemExit(f"не читается шаблон {path}")
        templates.append((mask > 127).astype(np.uint8))
    return templates


def crop_pair(image: np.ndarray, clean: np.ndarray, box: list[int], zoom: float = 3.0):
    x, y, w, h = box
    mx, my = int(w * 0.08), int(h * 0.45)
    x0, y0 = max(x - mx, 0), max(y - my, 0)
    x1, y1 = min(x + w + mx, image.shape[1]), min(y + h + my, image.shape[0])
    if x1 <= x0 or y1 <= y0:
        return None, None
    size = (max(int((x1 - x0) * zoom), 1), max(int((y1 - y0) * zoom), 1))
    before = cv2.resize(image[y0:y1, x0:x1], size, interpolation=cv2.INTER_NEAREST)
    after = cv2.resize(clean[y0:y1, x0:x1], size, interpolation=cv2.INTER_NEAREST)
    return before, after


class CleanError(Exception):
    """Ошибка одного кадра: в постоянном режиме не роняет процесс."""


class LamaHolder:
    """Модель LaMa грузится один раз на процесс и только когда понадобилась."""

    def __init__(self, path: str):
        self.path = path
        self.model = self.torch = None

    def get(self):
        if self.model is None:
            if not os.path.exists(self.path):
                raise CleanError(f"нет модели LaMa: {self.path}")
            self.model, self.torch = core.load_lama(core.ensure_model(self.path))
        return self.model, self.torch


def clean_file(job: dict, templates: list[np.ndarray], lama: LamaHolder | None) -> dict:
    """Чистит один файл: job = {in, out, report, crop_before, crop_after, box}."""
    started = time.time()
    image = cv2.imread(job["in"], cv2.IMREAD_COLOR)
    if image is None:
        raise CleanError(f"не читается файл {job['in']}")

    norm = core.normalize(image)
    manual = False
    box = None
    box_arg = job.get("box") or ""
    if box_arg:
        try:
            parts = [float(value) for value in box_arg.replace(" ", "").split(",")]
            if len(parts) != 4:
                raise ValueError("нужно четыре числа")
            box = tuple(parts)
            manual = True
        except ValueError as error:
            raise CleanError(f"не разобрал --box {box_arg!r}: {error}")

    if manual:
        # Чистка по рамке оператора: он обвёл надпись сам, поэтому затираем ровно
        # эту рамку — без автоопределения и без порогов по контрасту. Кадр не может
        # уйти в «не найдена»: он либо очищен, либо отправлен на глаза.
        width, height = image.shape[1], image.shape[0]
        left, top = int(round(min(box[0], box[2]) * width)), int(round(min(box[1], box[3]) * height))
        right, bottom = int(round(max(box[0], box[2]) * width)), int(round(max(box[1], box[3]) * height))
        # Небольшой отступ внутрь: рамку рисуют от руки, и без него LaMa трогает
        # пиксели сразу за её границей.
        inset_x, inset_y = max(int(round((right - left) * 0.02)), 1), max(int(round((bottom - top) * 0.02)), 1)
        hit_orig = core.Hit(
            x=max(left + inset_x, 0), y=max(top + inset_y, 0),
            w=max(right - left - 2 * inset_x, 8), h=max(bottom - top - 2 * inset_y, 8),
            rel=round(max(right - left, 1) / width, 3), polarity="manual",
        )
        scale_to_norm = norm.shape[1] / width
        hit = core.Hit(**{**hit_orig.__dict__,
                          "x": int(hit_orig.x * scale_to_norm), "y": int(hit_orig.y * scale_to_norm),
                          "w": max(int(hit_orig.w * scale_to_norm), 8), "h": max(int(hit_orig.h * scale_to_norm), 8)})
        z_before = core.local_z(cv2.cvtColor(norm, cv2.COLOR_BGR2GRAY), templates, hit)
        # Детектора тут нет, поэтому в отчёте показываем измеренный отклик в рамке.
        hit_orig.z = hit.z = z_before
        confident = True
        passes = ()
    else:
        hit = core.detect(cv2.cvtColor(norm, cv2.COLOR_BGR2GRAY), templates)
        confident = core.is_confident(hit)
        back = image.shape[1] / norm.shape[1]
        hit_orig = core.Hit(**{**hit.__dict__, "x": int(hit.x * back), "y": int(hit.y * back),
                               "w": int(hit.w * back), "h": int(hit.h * back)})
        z_before = hit.z
        passes = core.PASSES

    clean = image.copy()
    mask_px = passes_done = 0
    z_after = z_before
    if manual and lama is not None:
        # Один проход по отмеченной рамке: LaMa перерисовывает её целиком.
        model, torch = lama.get()
        mask = np.zeros(image.shape[:2], np.uint8)
        mask[hit_orig.y:hit_orig.y + hit_orig.h, hit_orig.x:hit_orig.x + hit_orig.w] = 255
        mask_px = int(np.count_nonzero(mask))
        clean = core.apply_pass(model, torch, clean, mask)
        passes_done = 1
        z_after = core.local_z(cv2.cvtColor(core.normalize(clean), cv2.COLOR_BGR2GRAY), templates, hit)
    elif confident and lama is not None:
        model, torch = lama.get()
        prior = core.strokes_at(templates[0], hit_orig.w, hit_orig.h)
        box_area = max(hit_orig.w * hit_orig.h, 1)
        for pass_index, (mode, value, near_px) in enumerate(passes, 1):
            mask = core.pass_mask(cv2.cvtColor(clean, cv2.COLOR_BGR2GRAY), prior, hit_orig,
                                  mode, value, near_px)
            mask_px = int(np.count_nonzero(mask))
            if mask_px == 0 or mask_px > core.FILL_CAP * box_area:
                break
            clean = core.apply_pass(model, torch, clean, mask)
            passes_done = pass_index
            z_after = core.local_z(cv2.cvtColor(core.normalize(clean), cv2.COLOR_BGR2GRAY),
                                   templates, hit)
            if z_after < core.Z_STOP:
                break

    if not confident:
        status = "miss"
    elif z_after < core.Z_OK:
        status = "ok"
    else:
        status = "review"

    # Формат вывода задаётся расширением: воркер просит webp для S3.
    if job["out"].lower().endswith((".webp", ".jpg", ".jpeg")):
        params = [cv2.IMWRITE_WEBP_QUALITY, 92] if job["out"].lower().endswith(".webp") else [cv2.IMWRITE_JPEG_QUALITY, 92]
        cv2.imwrite(job["out"], clean, params)
    else:
        cv2.imwrite(job["out"], clean)

    crop_before, crop_after = job.get("crop_before") or "", job.get("crop_after") or ""
    if crop_before or crop_after:
        before, after = crop_pair(image, clean, [hit_orig.x, hit_orig.y, hit_orig.w, hit_orig.h])
        if before is not None:
            if crop_before:
                cv2.imwrite(crop_before, before)
            if crop_after:
                cv2.imwrite(crop_after, after)

    report = {
        "status": status,
        "confident": bool(confident),
        "manual": manual,
        "z": hit.z,
        "z_a": hit.z_a,
        "z_b": hit.z_b,
        "score": hit.score,
        "iso": hit.iso,
        "rel": hit.rel,
        "polarity": hit.polarity,
        "box": [hit_orig.x, hit_orig.y, hit_orig.w, hit_orig.h],
        "mask_px": mask_px,
        "passes": passes_done,
        "z_after": round(float(z_after), 2),
        "seconds": round(time.time() - started, 1),
        "image": [int(image.shape[1]), int(image.shape[0])],
    }
    if box is not None:
        report["manual_box"] = list(box)
    if job.get("report"):
        with open(job["report"], "w", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False)
    return report


def serve(templates: list[np.ndarray], lama: LamaHolder | None) -> None:
    """Постоянный режим: строка JSON на входе — строка JSON с результатом на выходе."""
    # Канал с воркером — UTF-8 независимо от кодовой страницы Windows.
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    protocol = sys.stdout
    sys.stdout = sys.stderr  # логи модуля чистки не должны попасть в протокол
    if lama is not None:
        lama.get()

    def reply(payload: dict) -> None:
        protocol.write(json.dumps(payload, ensure_ascii=False) + "\n")
        protocol.flush()

    reply({"ready": True})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            reply({"ok": True, "report": clean_file(json.loads(line), templates, lama)})
        except Exception as error:  # noqa: BLE001 — один плохой кадр не роняет процесс
            reply({"ok": False, "error": str(error) or error.__class__.__name__})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--in", dest="input")
    parser.add_argument("--out", dest="output")
    parser.add_argument("--report", default="")
    parser.add_argument("--crop-before", default="")
    parser.add_argument("--crop-after", default="")
    parser.add_argument("--templates", default="data/david-studio/watermark")
    parser.add_argument("--model", default="tmp/david-watermark-pilot/models/big-lama.pt")
    parser.add_argument("--no-lama", action="store_true")
    # Рамка вотермарки, отмеченная оператором: "x1,y1,x2,y2" в долях кадра (0..1).
    parser.add_argument("--box", default="")
    args = parser.parse_args()

    templates = load_templates(args.templates)
    lama = None if args.no_lama else LamaHolder(args.model)
    if args.serve:
        serve(templates, lama)
        return
    if not args.input or not args.output:
        parser.error("нужны --in и --out (или --serve)")
    try:
        report = clean_file({
            "in": args.input, "out": args.output, "report": args.report,
            "crop_before": args.crop_before, "crop_after": args.crop_after, "box": args.box,
        }, templates, lama)
    except CleanError as error:
        raise SystemExit(str(error))
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
