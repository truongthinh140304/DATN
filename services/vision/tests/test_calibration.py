import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from vision.calibrate import select_spots
from vision.config import load_rois, load_settings
from vision.source import SourceOpenError, open_video_source
from vision.geometry import is_simple_polygon


class CalibrationTests(unittest.TestCase):
    def test_crossed_and_duplicate_polygons_are_rejected(self):
        self.assertTrue(is_simple_polygon([(0, 0), (4, 0), (4, 4), (0, 4)]))
        self.assertFalse(is_simple_polygon([(0, 0), (4, 4), (0, 4), (4, 0)]))
        self.assertFalse(is_simple_polygon([(0, 0), (4, 0), (4, 4), (0, 0)]))
        self.assertFalse(is_simple_polygon([(0, 0), (1, 1), (2, 2)]))

    def test_existing_ids_are_selected_without_changing_business_data(self):
        items = [{"id": "one", "code": "A01"}, {"id": "two", "code": "A02"}]
        self.assertEqual(select_spots(items, ["a01"], None), [items[0]])
        self.assertEqual(len(items), 2)
        for codes in (["A01", "A01"], ["missing"], []):
            with self.assertRaises(ValueError):
                select_spots(items, codes, None)
        duplicated = items + [{"id": "three", "code": "A01"}]
        with self.assertRaises(ValueError):
            select_spots(duplicated, ["A01"], None)
        self.assertEqual(select_spots(duplicated, None, ["three"])[0]["id"], "three")

    def test_settings_use_named_usb_camera_and_paths_relative_to_config(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "vision.json"
            path.write_text(
                json.dumps(
                    {
                        "cameraId": "usb",
                        "source": 2,
                        "videoBackend": "dshow",
                        "cameraName": "USB Camera",
                        "roiConfig": "rois.json",
                        "plateConfig": "plates.json",
                    }
                )
            )
            settings = load_settings(path)
            self.assertEqual(settings.camera_name, "USB Camera")
            self.assertEqual(settings.video_backend, "dshow")
            self.assertEqual(
                settings.roi_config, Path(directory).resolve() / "rois.json"
            )
            self.assertEqual(
                settings.plate_config, Path(directory).resolve() / "plates.json"
            )
            (Path(directory) / "rois.json").write_text(
                json.dumps({"cameraId": "usb", "spots": []})
            )
            with self.assertRaises(ValueError):
                load_rois(Path(directory) / "rois.json")

    def test_named_camera_follows_index_changes_and_never_falls_back(self):
        capture = Mock()
        capture.isOpened.return_value = True
        fake_cv = SimpleNamespace(
            CAP_ANY=0,
            CAP_DSHOW=700,
            CAP_MSMF=1400,
            VideoCapture=Mock(return_value=capture),
        )
        enumerate_cameras = Mock(
            return_value=[SimpleNamespace(name="USB Camera", index=4, backend=700)]
        )
        with patch.dict(
            "sys.modules",
            {
                "cv2": fake_cv,
                "cv2_enumerate_cameras": SimpleNamespace(
                    enumerate_cameras=enumerate_cameras
                ),
            },
        ):
            self.assertIs(
                open_video_source(2, backend="dshow", camera_name="USB Camera"), capture
            )
            fake_cv.VideoCapture.assert_called_once_with(4, 700)
            fake_cv.VideoCapture.reset_mock()
            enumerate_cameras.return_value = []
            with self.assertRaises(SourceOpenError):
                open_video_source(2, backend="dshow", camera_name="USB Camera")
            fake_cv.VideoCapture.assert_not_called()
            enumerate_cameras.return_value = [
                SimpleNamespace(name="USB Camera", index=4, backend=700)
            ] * 2
            with self.assertRaises(SourceOpenError):
                open_video_source(2, backend="dshow", camera_name="USB Camera")
            fake_cv.VideoCapture.assert_not_called()
