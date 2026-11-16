"""Smart Parking Gate Vision + Arduino Barrier Controller."""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import time
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any

from .arduino_gate import ArduinoGateController
from .config import GateSettings, load_gate_settings, save_scan_region
from .detector import DetectorSettings, YoloVehicleDetector
from .domain import Detection
from .gate_client import GateApiClient
from .plate_detector import GatePlateLocator, PlateRegion
from .plate_ocr import PaddlePlateOcr, PlateReading
from .plate_preprocess import PreprocessSettings, crop_original, preprocess
from .plate_temporal import PlateConsensus
from .plate_text import plausible_plate
from .source import SourceOpenError, open_video_source

REASON_LABELS = {
    "valid_reservation_entry": "KHOP VE DAT TRUOC -> MO CONG VAO",
    "active_session_exit": "XE RA KHOI BAI -> MO CONG RA",
    "vehicle_not_registered": "TU CHOI: BIEN SO CHUA DANG KY",
    "vehicle_inactive": "TU CHOI: PHUONG TIEN DA KHOA",
    "no_valid_reservation": "TU CHOI: CHUA CO VE HOP LE",
    "reservation_expired": "TU CHOI: VE DA HET HAN",
    "reservation_not_started": "TU CHOI: CHUA DEN GIO DAT VE",
    "reservation_not_confirmed": "TU CHOI: VE CHUA DUOC XAC NHAN",
    "payment_required": "TU CHOI: CHUA THANH TOAN VE",
    "wrong_lot": "TU CHOI: SAI BAI XE DA DAT",
    "lot_inactive": "TU CHOI: BAI XE DANG NGUNG",
    "reentry_cooldown": "DANG CHO XE QUA CONG",
    "weak_ocr_evidence": "CHUA DU DO TIN CAY OCR",
    "invalid_plate_format": "DINH DANG BIEN SO CHUA HOP LE",
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Smart Parking Gate: USB webcam ANPR + Backend verification + Arduino SG90 barrier"
    )
    parser.add_argument(
        "--settings",
        default="config/gate.json",
        help="Path to gate JSON settings",
    )
    parser.add_argument(
        "--no-api",
        action="store_true",
        help="Run local camera/OCR preview without sending scans to backend",
    )
    parser.add_argument(
        "--no-arduino",
        action="store_true",
        help="Simulate Arduino barrier commands without opening a COM port",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run without opening an OpenCV window",
    )
    parser.add_argument(
        "--max-frames",
        type=int,
        default=0,
        help="Stop after N frames (0 = run until Q/ESC)",
    )
    return parser


def _ocr_worker(
    engine: PaddlePlateOcr,
    frame: Any,
    regions: list[PlateRegion],
    prep_settings: PreprocessSettings,
) -> tuple[PlateReading, bool, PlateRegion | None]:
    for region in regions:
        crop = crop_original(frame, region.bbox)
        image, sharp = preprocess(crop, prep_settings)
        if not sharp:
            continue
        reading = engine.read(image)
        if reading.raw:
            return reading, True, region
    return PlateReading(), bool(regions), regions[0] if regions else None


def _resolve_lot_id(
    client: GateApiClient | None, configured_lot_id: str | None
) -> str | None:
    if configured_lot_id or client is None:
        return configured_lot_id
    with contextlib.suppress(OSError, RuntimeError, ValueError):
        lots = client.get_lots()
        if len(lots) == 1:
            return str(lots[0]["id"])
    return None


def main() -> int:
    args = build_parser().parse_args()
    settings: GateSettings = load_gate_settings(args.settings)

    api_key = os.getenv("VISION_API_KEY", settings.api_key)
    client: GateApiClient | None = None
    if not args.no_api and api_key:
        client = GateApiClient(settings.api_url, api_key)
    elif not args.no_api:
        print(
            "VISION_API_KEY is empty; running without backend verification.",
            flush=True,
        )

    lot_id = _resolve_lot_id(client, settings.lot_id)

    arduino = ArduinoGateController(
        enabled=settings.arduino.enabled and not args.no_arduino,
        port=settings.arduino.port,
        baudrate=settings.arduino.baudrate,
        default_open_ms=settings.arduino.open_ms,
    )
    if arduino.enabled:
        if arduino.connect():
            print(
                f"ARDUINO_CONNECTED: port={arduino.active_port} baud={arduino.baudrate}",
                flush=True,
            )
        else:
            print(
                f"ARDUINO_WAITING: {arduino.last_error or 'not connected yet'}",
                flush=True,
            )
    else:
        print("ARDUINO_SIMULATED: --no-arduino / disabled in config", flush=True)

    detector = None
    if settings.yolo_enabled:
        detector = YoloVehicleDetector(
            DetectorSettings(
                model=settings.yolo_model,
                device=settings.device,
                confidence=settings.yolo_confidence,
                image_size=settings.image_size,
            )
        )

    locator = GatePlateLocator(
        mode=settings.plate_mode,
        scan_region=settings.scan_region,
        prefer_vehicle_crop=settings.prefer_vehicle_crop,
        model_path=settings.plate_model_path,
        class_ids=settings.plate_class_ids,
        confidence=settings.plate_confidence,
        device=settings.device,
    )
    prep_settings = PreprocessSettings(**settings.preprocess)
    consensus = PlateConsensus(**settings.consensus)

    capture = open_video_source(
        settings.source,
        backend=settings.video_backend,
        camera_name=settings.camera_name,
    )

    import cv2

    window_title = f"Smart Parking Gate - {settings.gate_id}"
    if not args.headless:
        cv2.namedWindow(window_title, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(window_title, 1060, 700)

    pool = ThreadPoolExecutor(max_workers=1)
    ocr_future: Future[Any] | None = pool.submit(PaddlePlateOcr, settings.ocr)
    ocr_engine: PaddlePlateOcr | None = None
    loading_ocr = True

    last_ocr_started = 0.0
    last_heartbeat = 0.0
    last_command_poll = 0.0
    last_sent_plate_at: dict[str, float] = {}
    barrier_open_until = 0.0
    frame_count = 0

    status_banner = "Dang tai PaddleOCR..."
    banner_color = (0, 200, 255)  # BGR Amber
    latest_ocr_text = "Cho bien so..."

    print(
        json.dumps(
            {
                "type": "GATE_STARTED",
                "gateId": settings.gate_id,
                "lotId": lot_id,
                "source": settings.source,
                "backend": capture.getBackendName(),
                "plateMode": settings.plate_mode,
                "arduinoEnabled": arduino.enabled,
                "arduinoPort": arduino.active_port,
            }
        ),
        flush=True,
    )

    try:
        while True:
            ok, frame = capture.read()
            if not ok or frame is None:
                print(
                    json.dumps({"type": "CAMERA_LOST", "gateId": settings.gate_id}),
                    flush=True,
                )
                break

            frame_count += 1
            now = time.monotonic()
            height, width = frame.shape[:2]

            detections: list[Detection] = (
                detector.detect(frame) if detector is not None else []
            )
            regions = locator.locate(frame, detections)

            if ocr_future is not None and ocr_future.done():
                try:
                    result = ocr_future.result()
                    if loading_ocr:
                        ocr_engine = result
                        loading_ocr = False
                        status_banner = "SAN SANG QUET BIEN SO"
                        banner_color = (0, 200, 255)
                    else:
                        reading, sharp, used_region = result
                        if not sharp:
                            latest_ocr_text = "Anh mo - giu xe on dinh"
                        elif not reading.raw:
                            latest_ocr_text = "Khong doc duoc chu"
                        else:
                            stable, samples = consensus.update("gate", reading, now)
                            tag = (
                                "READ"
                                if stable
                                else (
                                    "PENDING"
                                    if plausible_plate(reading.normalized)
                                    else "TEXT_ONLY"
                                )
                            )
                            latest_ocr_text = f"{reading.normalized} ({tag} {reading.confidence:.2f}, {samples} mau)"
                            if stable:
                                plate = stable.normalized
                                last_at = last_sent_plate_at.get(plate, 0.0)
                                if now - last_at >= settings.cooldown_seconds:
                                    last_sent_plate_at[plate] = now
                                    if client is not None:
                                        try:
                                            outcome = client.scan(
                                                gate_id=settings.gate_id,
                                                lot_id=lot_id,
                                                plate_raw=stable.raw,
                                                ocr_confidence=stable.confidence,
                                                vehicle_confidence=(
                                                    used_region.confidence
                                                    if used_region
                                                    else None
                                                ),
                                                plate_samples=samples,
                                                metadata={
                                                    "plateMode": settings.plate_mode
                                                },
                                            )
                                            reason_code = str(outcome.get("reason", ""))
                                            status_banner = REASON_LABELS.get(
                                                reason_code,
                                                f"{outcome.get('decision')}: {reason_code}",
                                            )
                                            if outcome.get("barrierAction") == "OPEN":
                                                banner_color = (40, 200, 60)
                                                opened = arduino.open_gate(
                                                    settings.arduino.open_ms
                                                )
                                                if opened:
                                                    barrier_open_until = (
                                                        now
                                                        + settings.arduino.open_ms
                                                        / 1000.0
                                                    )
                                            elif outcome.get("decision") == "COOLDOWN":
                                                banner_color = (0, 200, 255)
                                            else:
                                                banner_color = (45, 60, 230)
                                            print(
                                                json.dumps(
                                                    {
                                                        "type": "GATE_SCAN_RESULT",
                                                        **outcome,
                                                    },
                                                    ensure_ascii=False,
                                                ),
                                                flush=True,
                                            )
                                        except (OSError, RuntimeError, ValueError) as api_error:
                                            status_banner = (
                                                f"LOI KET NOI API: {api_error}"
                                            )
                                            banner_color = (45, 60, 230)
                                    else:
                                        status_banner = f"LOCAL OCR: {plate} (chua noi API)"
                                        banner_color = (0, 200, 255)
                except (OSError, RuntimeError, ValueError, TypeError) as error:
                    loading_ocr = False
                    status_banner = f"LOI OCR: {error}"
                    banner_color = (45, 60, 230)
                ocr_future = None

            if (
                ocr_engine is not None
                and ocr_future is None
                and regions
                and now - last_ocr_started >= settings.ocr_interval_seconds
            ):
                last_ocr_started = now
                ocr_future = pool.submit(
                    _ocr_worker, ocr_engine, frame.copy(), regions, prep_settings
                )

            if client is not None and now - last_command_poll >= 1.0:
                last_command_poll = now
                with contextlib.suppress(OSError, RuntimeError, ValueError):
                    cmd = client.claim_command(settings.gate_id)
                    if cmd and cmd.get("command") == "OPEN":
                        duration_ms = int(cmd.get("durationMs", settings.arduino.open_ms))
                        if arduino.open_gate(duration_ms):
                            barrier_open_until = now + duration_ms / 1000.0
                        status_banner = "MO BARIE THU CONG TU WEB ADMIN"
                        banner_color = (40, 200, 60)
                        print(
                            json.dumps(
                                {
                                    "type": "MANUAL_COMMAND_EXECUTED",
                                    "commandId": cmd.get("id"),
                                    "durationMs": duration_ms,
                                }
                            ),
                            flush=True,
                        )

            if client is not None and now - last_heartbeat >= 2.0:
                last_heartbeat = now
                with contextlib.suppress(OSError, RuntimeError, ValueError):
                    client.heartbeat(
                        gate_id=settings.gate_id,
                        lot_id=lot_id,
                        camera_connected=True,
                        arduino_connected=arduino.is_connected,
                        arduino_port=arduino.active_port,
                    )

            if not args.headless:
                display = frame.copy()
                for det in detections:
                    x1, y1, x2, y2 = (int(v) for v in det.bbox)
                    cv2.rectangle(display, (x1, y1), (x2, y2), (40, 210, 70), 2)
                    cv2.putText(
                        display,
                        f"{det.class_name} {det.confidence:.2f}",
                        (x1, max(20, y1 - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.55,
                        (40, 210, 70),
                        2,
                    )
                for reg in regions:
                    x1, y1, x2, y2 = (int(v) for v in reg.bbox)
                    cv2.rectangle(display, (x1, y1), (x2, y2), (255, 225, 40), 2)

                cv2.rectangle(display, (0, 0), (width, 108), (22, 26, 30), -1)
                gate_state = "OPEN" if now < barrier_open_until else "CLOSED"
                ard_text = (
                    f"Arduino {arduino.active_port or 'WAITING'}"
                    if arduino.enabled
                    else "Arduino SIMULATED"
                )
                cv2.putText(
                    display,
                    f"Gate: {settings.gate_id} | Barrier: {gate_state} | {ard_text}",
                    (12, 26),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.56,
                    (230, 240, 240),
                    1,
                )
                cv2.putText(
                    display,
                    f"OCR: {latest_ocr_text[:72]}",
                    (12, 56),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.58,
                    (255, 235, 130),
                    2,
                )
                cv2.putText(
                    display,
                    status_banner[:78],
                    (12, 90),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.62,
                    banner_color,
                    2,
                )
                cv2.putText(
                    display,
                    "R: Chon vung quet | O: Thu mo barie | C: Quet lai | Q/ESC: Thoat",
                    (12, height - 14),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    (220, 230, 230),
                    1,
                )
                cv2.imshow(window_title, display)

                key = cv2.waitKey(1) & 0xFF
                if (
                    key in (ord("q"), 27)
                    or cv2.getWindowProperty(window_title, cv2.WND_PROP_VISIBLE) < 1
                ):
                    break
                if key == ord("r") and settings.plate_mode == "scan_zone":
                    sel_title = "Keo chon vung bien so truoc cong - ENTER xac nhan"
                    cv2.namedWindow(sel_title, cv2.WINDOW_NORMAL)
                    cv2.resizeWindow(sel_title, 1000, 680)
                    rx, ry, rw, rh = cv2.selectROI(sel_title, frame, False, False)
                    cv2.destroyWindow(sel_title)
                    if rw > 0 and rh > 0:
                        new_region = (
                            float(rx / width),
                            float(ry / height),
                            float((rx + rw) / width),
                            float((ry + rh) / height),
                        )
                        save_scan_region(args.settings, new_region)
                        locator.scan_region = new_region
                        consensus.reset()
                        last_sent_plate_at.clear()
                        status_banner = "DA CAP NHAT VUNG QUET MOI"
                        banner_color = (0, 200, 255)
                elif key == ord("o"):
                    if arduino.open_gate(settings.arduino.open_ms):
                        barrier_open_until = now + settings.arduino.open_ms / 1000.0
                        status_banner = "THU MO BARIE TAI CHO (5S)"
                        banner_color = (40, 200, 60)
                    else:
                        status_banner = f"LOI ARDUINO: {arduino.last_error or 'khong mo duoc'}"
                        banner_color = (45, 60, 230)
                elif key == ord("c"):
                    consensus.reset()
                    last_sent_plate_at.clear()
                    latest_ocr_text = "Da xoa bo nho dem - san sang quet lai"
                    status_banner = "SAN SANG QUET BIEN SO"
                    banner_color = (0, 200, 255)

            if args.max_frames and frame_count >= args.max_frames:
                break
    finally:
        capture.release()
        if not args.headless:
            cv2.destroyAllWindows()
        pool.shutdown(wait=True, cancel_futures=True)
        arduino.close()

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, ValueError, SourceOpenError, RuntimeError) as error:
        print(f"Gate vision error: {error}")
        raise SystemExit(1) from error
