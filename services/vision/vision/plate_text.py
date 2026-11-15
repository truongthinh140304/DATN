"""Shared normalization contract: remove separators, never guess O/0 or I/1."""

import re
import unicodedata


def normalize_plate(raw: str) -> str:
    text = unicodedata.normalize("NFKC", raw).upper()
    # Preserve unexpected characters so they fail validation instead of silently
    # turning arbitrary OCR text into a valid plate.
    return re.sub(r"[\s.\-\u2010-\u2015]", "", text)


def plausible_plate(text: str) -> bool:
    # Experimental Vietnamese civilian plates; not a complete legal plate parser.
    return re.fullmatch(r"[0-9]{2}[A-Z]{1,2}[0-9]{4,6}", text) is not None
