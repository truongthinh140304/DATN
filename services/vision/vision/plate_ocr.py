from dataclasses import dataclass
from typing import Any

from .plate_text import normalize_plate


@dataclass(frozen=True)
class PlateReading:
    raw: str = ""
    normalized: str = ""
    confidence: float = 0.0


def parse_prediction(results: Any) -> PlateReading:
    lines: list[tuple[float, float, str, float]] = []
    for result in results:
        texts = result.get("rec_texts", [])
        scores = result.get("rec_scores", [])
        boxes = result.get("rec_boxes")
        for index, (text, score) in enumerate(zip(texts, scores)):
            if not str(text).strip():
                continue
            x, y = (
                (float(boxes[index][0]), float(boxes[index][1]))
                if boxes is not None
                else (0.0, float(index))
            )
            lines.append((y, x, str(text), float(score)))
    if not lines:
        return PlateReading()
    # Paddle returns reading order for the crop. Sort rows top-to-bottom, with
    # x-order within each row; support two-line printed experimental plates.
    lines.sort(key=lambda line: (line[0], line[1]))
    rows: list[list[tuple]] = []
    for line in lines:
        if not rows or abs(line[0] - rows[-1][0][0]) > 12:
            rows.append([line])
        else:
            rows[-1].append(line)
    raw = "\n".join(
        " ".join(line[2] for line in sorted(row, key=lambda item: item[1]))
        for row in rows
    )
    # Conservative: a single low-confidence line makes the entire plate weak.
    return PlateReading(raw, normalize_plate(raw), min(line[3] for line in lines))


class PaddlePlateOcr:
    def __init__(self, config: dict):
        try:
            from paddleocr import PaddleOCR
        except ImportError as error:
            raise RuntimeError(
                "Install requirements-ocr.txt in the Python 3.11 environment"
            ) from error
        model_options = {
            key: config[key]
            for key in (
                "text_detection_model_name",
                "text_recognition_model_name",
                "text_det_limit_side_len",
            )
            if key in config
        }
        if not any(
            key in model_options
            for key in ("text_detection_model_name", "text_recognition_model_name")
        ):
            model_options.update({"lang": "en", "ocr_version": "PP-OCRv5"})
        self.engine = PaddleOCR(
            device=config.get("device", "cpu"),
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            **model_options,
        )

    def read(self, image: Any) -> PlateReading:
        return parse_prediction(self.engine.predict(image))
