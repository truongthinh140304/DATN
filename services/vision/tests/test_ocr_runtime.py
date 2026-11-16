"""Optional real Paddle runtime check with synthetic text, not a parking accuracy test."""

import os
import unittest


@unittest.skipUnless(
    os.environ.get("RUN_OCR_TESTS") == "true",
    "Set RUN_OCR_TESTS=true to download/run real OCR models",
)
class OcrRuntimeTest(unittest.TestCase):
    def test_paddle_predict_contract_with_synthetic_text(self):
        self.check_synthetic_text({})

    def test_mobile_model_predict_contract_with_synthetic_text(self):
        self.check_synthetic_text(
            {
                "text_detection_model_name": "PP-OCRv5_mobile_det",
                "text_recognition_model_name": "en_PP-OCRv5_mobile_rec",
            }
        )

    def check_synthetic_text(self, config):
        import cv2
        import numpy as np

        from vision.plate_ocr import PaddlePlateOcr

        image = np.full((140, 600, 3), 255, dtype=np.uint8)
        cv2.putText(
            image, "30A-12345", (15, 100), cv2.FONT_HERSHEY_SIMPLEX, 2.6, (0, 0, 0), 4
        )
        result = PaddlePlateOcr(config).read(image)
        self.assertEqual(result.normalized, "30A12345")
        self.assertGreater(result.confidence, 0.7)
