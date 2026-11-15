import io
import json
import unittest
from contextlib import redirect_stdout
from types import SimpleNamespace
from unittest.mock import Mock, patch

from vision import app
from vision.domain import ParkingRoi


class AppReportingTests(unittest.TestCase):
    def test_integrated_app_reports_a_real_frame_result_and_releases_camera(self):
        settings = SimpleNamespace(
            camera_id="test-usb",
            source=2,
            camera_name="USB Camera",
            video_backend="dshow",
            roi_config="unused",
            plate_config=None,
            model="unused",
            device="cpu",
            detector_confidence=0.25,
            image_size=640,
            api_key="",
            api_url="http://test.invalid",
            report_interval_seconds=3,
        )
        roi = ParkingRoi("spot-a", "A01", ((0, 0), (1, 0), (1, 1), (0, 1)))
        capture = Mock()
        capture.read.return_value = (True, SimpleNamespace(shape=(100, 100, 3)))
        capture.getBackendName.return_value = "DSHOW"
        detector = Mock()
        detector.detect.return_value = []
        reporter = Mock()
        reporter.send.return_value = 1
        output = io.StringIO()
        with (
            patch("sys.argv", ["vision", "--headless", "--max-frames", "1"]),
            patch.object(app, "load_settings", return_value=settings),
            patch.object(app, "load_rois", return_value=("test-usb", [roi])),
            patch.object(app, "YoloVehicleDetector", return_value=detector),
            patch.object(app, "VisionApiReporter", return_value=reporter),
            patch.object(app, "open_video_source", return_value=capture) as opener,
            patch.object(app.time, "perf_counter", return_value=100.0),
            patch.dict("sys.modules", {"cv2": SimpleNamespace()}),
            patch.dict("os.environ", {"VISION_API_KEY": "test-key-never-print"}),
            redirect_stdout(output),
        ):
            self.assertEqual(app.main(), 0)
        opener.assert_called_once_with(2, backend="dshow", camera_name="USB Camera")
        reporter.send.assert_called_once()
        capture.release.assert_called_once()
        events = [json.loads(line) for line in output.getvalue().splitlines()]
        report = next(item for item in events if item["type"] == "VISION_REPORTED")
        self.assertEqual(report["accepted"], 1)
        self.assertEqual(report["observations"][0]["occupancyStatus"], "UNKNOWN")
        self.assertNotIn("test-key-never-print", output.getvalue())
