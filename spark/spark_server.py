#!/usr/bin/env python3
"""
Spark multi-model inference server for LocalGuard.

Runs YOLO object detection on the AKASO camera, plus two VLM inference loops
(fast + deep) against Cosmos-Reason2 models served by vLLM containers.

Serves:
  GET /stream          — live MJPEG feed from AKASO Brave 4 (annotated with YOLO boxes)
  GET /detections      — JSON YOLO detections (matches Jetson format, no depth_m)
  GET /results         — combined fast+deep results sorted by timestamp desc
  GET /results/fast    — fast inference results only
  GET /results/deep    — deep inference results only
  GET /health          — health check

Run on the Spark:
  cd ~/cam-inference && source .venv/bin/activate && python3 spark_server.py
"""

import os
import cv2
import base64
import time
import threading
import json
import uuid
import urllib.request
import numpy as np
from collections import deque
from flask import Flask, Response, jsonify
from openai import OpenAI
from ultralytics import YOLO

app = Flask(__name__)


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

# --- Config ---
FAST_VLLM_URL  = "http://localhost:8001/v1"   # Cosmos-2B
DEEP_VLLM_URL  = "http://localhost:8002/v1"   # Cosmos-8B
FAST_MODEL     = "cosmos-fast"
DEEP_MODEL     = "cosmos-deep"
CAMERA_INDEX   = int(os.environ.get("CAMERA_INDEX", "1"))
JETSON_STREAM  = "http://192.168.50.4:8080/stream"
FAST_INTERVAL  = 1.5   # seconds
DEEP_INTERVAL  = 20.0  # seconds
FAST_MAX_TOKENS = 150
DEEP_MAX_TOKENS = 400

# YOLO config (env-overridable)
YOLO_MODEL     = os.environ.get("YOLO_MODEL", "yolo11n.pt")  # nano model, auto-downloads
YOLO_CONF      = float(os.environ.get("YOLO_MIN_CONF", "0.25"))
YOLO_LABEL_FILTER = os.environ.get("YOLO_LABEL_FILTER", "person")  # "person", "all", or comma-separated
YOLO_DEVICE    = os.environ.get("YOLO_DEVICE", "0")  # GPU device
FAST_PROMPT = "Describe what you see in this image. Be concise (2-3 sentences)."
DEEP_PROMPT = (
    "You are analyzing security camera feeds. Image 1 is the AKASO scene camera. "
    "Image 2 (if present) is the Jetson depth camera. Provide a temporal security "
    "assessment: describe activity, any changes, people positions, and potential "
    "concerns. Be specific and actionable (4-6 sentences)."
)

# --- Shared state ---
lock = threading.Lock()
latest_frame = None       # raw JPEG bytes for MJPEG stream (annotated with YOLO boxes)
latest_frame_raw = None   # numpy array for inference (AKASO, clean — no overlays)
latest_jetson_frame = None  # numpy array from Jetson MJPEG
fast_results = deque(maxlen=5)
deep_results = deque(maxlen=3)

# YOLO detection state
yolo_detections = {
    "fps": 0.0,
    "timestamp": 0.0,
    "source": "spark",
    "counts": {},
    "person_count": 0,
    "nearest_person_m": None,
    "detections": [],
}


def camera_loop():
    """Continuously capture frames from the AKASO camera."""
    global latest_frame, latest_frame_raw
    cap = cv2.VideoCapture(CAMERA_INDEX)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    if not cap.isOpened():
        print("ERROR: Cannot open camera")
        return

    print(f"Camera opened (device {CAMERA_INDEX})")
    while True:
        ret, frame = cap.read()
        if not ret:
            time.sleep(0.1)
            continue
        with lock:
            latest_frame_raw = frame


def parse_label_filter(filter_str):
    """Parse YOLO_LABEL_FILTER env into a set of allowed labels or None for all."""
    if not filter_str or filter_str.strip().lower() in ("all", "*"):
        return None
    return set(l.strip().lower() for l in filter_str.split(",") if l.strip())


def yolo_detection_loop():
    """Run YOLO inference on AKASO frames and update detection state."""
    global yolo_detections

    import torch
    device = YOLO_DEVICE
    if device != "cpu" and not torch.cuda.is_available():
        print(f"WARNING: CUDA not available (torch {torch.__version__}), falling back to CPU for YOLO")
        device = "cpu"

    print(f"YOLO detection loop starting (model: {YOLO_MODEL}, device: {device}, conf: {YOLO_CONF})")
    model = YOLO(YOLO_MODEL)
    allowed_labels = parse_label_filter(YOLO_LABEL_FILTER)
    print(f"YOLO model loaded. Label filter: {allowed_labels or 'all'}")

    fps_counter = 0
    fps_timer = time.time()
    current_fps = 0.0

    while True:
        with lock:
            frame = latest_frame_raw

        if frame is None:
            time.sleep(0.05)
            continue

        try:
            results = model(frame, conf=YOLO_CONF, device=device, verbose=False)
            result = results[0]

            detections = []
            counts = {}
            person_count = 0

            for box in result.boxes:
                cls_id = int(box.cls[0])
                label = result.names[cls_id]
                conf = float(box.conf[0])
                x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]

                if allowed_labels is not None and label.lower() not in allowed_labels:
                    continue

                detections.append({
                    "label": label,
                    "confidence": round(conf, 3),
                    "bbox": [x1, y1, x2, y2],
                })
                counts[label] = counts.get(label, 0) + 1
                if label == "person":
                    person_count += 1

            # FPS tracking
            fps_counter += 1
            elapsed = time.time() - fps_timer
            if elapsed >= 1.0:
                current_fps = fps_counter / elapsed
                fps_counter = 0
                fps_timer = time.time()

            detection_payload = {
                "fps": round(current_fps, 1),
                "timestamp": time.time(),
                "source": "spark",
                "counts": counts,
                "person_count": person_count,
                "nearest_person_m": None,  # no depth sensor on AKASO
                "detections": detections,
            }

            # Draw bounding boxes on the frame for the MJPEG stream
            annotated = frame.copy()
            for det in detections:
                x1, y1, x2, y2 = det["bbox"]
                color = (0, 255, 0) if det["label"] == "person" else (0, 200, 255)
                cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
                text = f"{det['label']} {det['confidence']:.2f}"
                (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                cv2.rectangle(annotated, (x1, y1 - th - 6), (x1 + tw, y1), color, -1)
                cv2.putText(annotated, text, (x1, y1 - 4),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1, cv2.LINE_AA)

            _, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])

            with lock:
                global latest_frame
                latest_frame = buf.tobytes()
                yolo_detections = detection_payload

        except Exception as e:
            print(f"YOLO inference error: {e}")
            time.sleep(0.5)


def jetson_snapshot_fetcher():
    """Periodically grab a single frame from the Jetson MJPEG stream."""
    global latest_jetson_frame
    print(f"Jetson snapshot fetcher started ({JETSON_STREAM})")

    while True:
        time.sleep(2.0)
        try:
            req = urllib.request.Request(JETSON_STREAM)
            with urllib.request.urlopen(req, timeout=3) as resp:
                # Read enough bytes to get one JPEG frame from the MJPEG stream
                buf = b""
                while True:
                    chunk = resp.read(4096)
                    if not chunk:
                        break
                    buf += chunk
                    # Look for JPEG end marker
                    end = buf.find(b"\xff\xd9")
                    if end != -1:
                        # Find JPEG start marker
                        start = buf.find(b"\xff\xd8")
                        if start != -1 and start < end:
                            jpeg_data = buf[start:end + 2]
                            frame = cv2.imdecode(
                                np.frombuffer(jpeg_data, dtype=np.uint8),
                                cv2.IMREAD_COLOR,
                            )
                            if frame is not None:
                                with lock:
                                    latest_jetson_frame = frame
                        break
        except Exception as e:
            # Jetson may be offline — that's fine
            pass


def frame_to_b64(frame, quality=85):
    """Encode a numpy frame to base64 JPEG string."""
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return base64.b64encode(buf).decode("utf-8")


def fast_inference_loop():
    """Run frequent inference on single AKASO frame using Cosmos-2B."""
    client = OpenAI(base_url=FAST_VLLM_URL, api_key="unused")
    print(f"Fast inference loop started (model: {FAST_MODEL}, interval: {FAST_INTERVAL}s)")

    while True:
        time.sleep(FAST_INTERVAL)

        with lock:
            frame = latest_frame_raw

        if frame is None:
            continue

        b64 = frame_to_b64(frame)

        entry = {
            "id": uuid.uuid4().hex[:8],
            "output": None,
            "status": "processing",
            "timestamp": time.time(),
            "model": "fast",
        }

        with lock:
            fast_results.append(entry)

        try:
            t0 = time.time()
            response = client.chat.completions.create(
                model=FAST_MODEL,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{b64}"
                                },
                            },
                            {"type": "text", "text": FAST_PROMPT},
                        ],
                    }
                ],
                max_tokens=FAST_MAX_TOKENS,
            )
            output = response.choices[0].message.content
            elapsed = time.time() - t0
            print(f"[{time.strftime('%H:%M:%S')}] Fast inference done in {elapsed:.1f}s")

            with lock:
                entry["output"] = output
                entry["status"] = "done"
                entry["elapsed"] = round(elapsed, 1)
        except Exception as e:
            print(f"Fast inference error: {e}")
            with lock:
                entry["output"] = f"Error: {e}"
                entry["status"] = "error"


def deep_inference_loop():
    """Run periodic multi-camera inference using Cosmos-8B."""
    client = OpenAI(base_url=DEEP_VLLM_URL, api_key="unused")
    print(f"Deep inference loop started (model: {DEEP_MODEL}, interval: {DEEP_INTERVAL}s)")

    while True:
        time.sleep(DEEP_INTERVAL)

        with lock:
            akaso_frame = latest_frame_raw
            jetson_frame = latest_jetson_frame

        if akaso_frame is None and jetson_frame is None:
            continue

        # Build multi-image content
        content = []
        cameras_used = []

        if akaso_frame is not None:
            content.append({
                "type": "text",
                "text": "Image 1 (AKASO scene camera):",
            })
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{frame_to_b64(akaso_frame)}",
                },
            })
            cameras_used.append("akaso")

        if jetson_frame is not None:
            img_num = len(cameras_used) + 1
            content.append({
                "type": "text",
                "text": f"Image {img_num} (Jetson depth camera):",
            })
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{frame_to_b64(jetson_frame)}",
                },
            })
            cameras_used.append("jetson")

        content.append({"type": "text", "text": DEEP_PROMPT})

        entry = {
            "id": uuid.uuid4().hex[:8],
            "output": None,
            "status": "processing",
            "timestamp": time.time(),
            "model": "deep",
            "cameras": cameras_used,
        }

        with lock:
            deep_results.append(entry)

        try:
            t0 = time.time()
            response = client.chat.completions.create(
                model=DEEP_MODEL,
                messages=[{"role": "user", "content": content}],
                max_tokens=DEEP_MAX_TOKENS,
            )
            output = response.choices[0].message.content
            elapsed = time.time() - t0
            print(f"[{time.strftime('%H:%M:%S')}] Deep inference done in {elapsed:.1f}s "
                  f"(cameras: {','.join(cameras_used)})")

            with lock:
                entry["output"] = output
                entry["status"] = "done"
                entry["elapsed"] = round(elapsed, 1)
        except Exception as e:
            print(f"Deep inference error: {e}")
            with lock:
                entry["output"] = f"Error: {e}"
                entry["status"] = "error"


def generate_mjpeg():
    """Yield MJPEG frames for the /stream endpoint."""
    while True:
        with lock:
            frame = latest_frame
        if frame is None:
            time.sleep(0.05)
            continue
        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
        )
        time.sleep(0.033)  # ~30fps cap


def format_result(r):
    """Format a result entry for JSON output."""
    out = {
        "id": r["id"],
        "output": r["output"],
        "status": r["status"],
        "timestamp": r["timestamp"],
        "elapsed": r.get("elapsed"),
        "model": r.get("model"),
    }
    if "cameras" in r:
        out["cameras"] = r["cameras"]
    return out


@app.route("/stream")
def stream():
    return Response(
        generate_mjpeg(),
        mimetype="multipart/x-mixed-replace; boundary=frame",
    )


@app.route("/detections")
def get_detections():
    with lock:
        data = dict(yolo_detections)
    return jsonify(data)


@app.route("/results")
def get_results():
    with lock:
        combined = list(fast_results) + list(deep_results)
    combined.sort(key=lambda r: r["timestamp"], reverse=True)
    return jsonify([format_result(r) for r in combined])


@app.route("/results/fast")
def get_results_fast():
    with lock:
        data = list(fast_results)
    return jsonify([format_result(r) for r in data])


@app.route("/results/deep")
def get_results_deep():
    with lock:
        data = list(deep_results)
    return jsonify([format_result(r) for r in data])


@app.route("/health")
def health():
    with lock:
        has_frame = latest_frame is not None
        has_jetson = latest_jetson_frame is not None
        n_fast = len(fast_results)
        n_deep = len(deep_results)
        yolo_fps = yolo_detections.get("fps", 0)
    return jsonify({
        "ok": True,
        "camera": has_frame,
        "jetson_snapshot": has_jetson,
        "fast_results": n_fast,
        "deep_results": n_deep,
        "yolo_fps": yolo_fps,
    })


if __name__ == "__main__":
    threading.Thread(target=camera_loop, daemon=True).start()
    threading.Thread(target=yolo_detection_loop, daemon=True).start()
    threading.Thread(target=jetson_snapshot_fetcher, daemon=True).start()
    threading.Thread(target=fast_inference_loop, daemon=True).start()
    threading.Thread(target=deep_inference_loop, daemon=True).start()
    print("Starting server on :8090")
    app.run(host="0.0.0.0", port=8090, threaded=True)
