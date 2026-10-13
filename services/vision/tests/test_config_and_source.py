import json
import tempfile
import unittest
from pathlib import Path

from vision.config import load_rois, parse_source, save_rois
from vision.domain import ParkingRoi
from vision.source import SourceOpenError, open_video_source


class FakeCapture:
    def __init__(self, opened: bool) -> None:
        self.opened = opened
        self.released = False

    def isOpened(self) -> bool:  # OpenCV-compatible method name.
        return self.opened

    def release(self) -> None:
        self.released = True


class ConfigAndSourceTests(unittest.TestCase):
    def test_source_parser_supports_webcam_file_and_rtsp(self) -> None:
        self.assertEqual(parse_source("0"), 0)
        self.assertEqual(parse_source("sample.mp4"), "sample.mp4")
        self.assertEqual(parse_source("rtsp://camera/live"), "rtsp://camera/live")

    def test_invalid_source_raises_clear_error(self) -> None:
        fake = FakeCapture(False)
        with self.assertRaises(SourceOpenError):
            open_video_source("missing.mp4", lambda _source: fake)
        self.assertTrue(fake.released)

    def test_normalized_roi_round_trip_preserves_database_mapping(self) -> None:
        rois = [
            ParkingRoi(
                spot_id=f"spot-{index}",
                code=f"A0{index}",
                polygon=((0.1, 0.1), (0.2, 0.1), (0.2, 0.8), (0.1, 0.8)),
            )
            for index in range(1, 6)
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rois.json"
            save_rois(path, "camera-01", rois, 1280, 720)
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(payload["coordinateSystem"], "normalized")
            camera_id, loaded = load_rois(path)
            self.assertEqual(camera_id, "camera-01")
            self.assertEqual([roi.spot_id for roi in loaded], [roi.spot_id for roi in rois])


if __name__ == "__main__":
    unittest.main()
