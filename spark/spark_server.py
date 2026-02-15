#!/usr/bin/env python3
"""
Spark camera + Cosmos-Reason1-7B inference server.

Serves:
  GET /stream   — live MJPEG feed from AKASO Brave 4
  GET /results  — JSON array of last 3 inference results
  GET /health   — health check

Run on the Spark:
  cd ~/cam-inference && source .venv/bin/activate && python3 spark_server.py
"""

import cv2
import base64
import time
import threading
import json
import uuid
from collections import deque
from flask import Flask, Response, jsonify
from openai import OpenAI

app = Flask(__name__)


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

# --- Config ---
VLLM_URL = "http://localhost:8000/v1"
MODEL = "nvidia/Cosmos-Reason1-7B"
CAMERA_INDEX = 0
INFERENCE_PROMPT = "Describe what you see in this image. Be concise (2-3 sentences)."
MAX_TOKENS = 150
INFERENCE_INTERVAL = 2.0  # seconds between inference starts

# --- Shared state ---
lock = threading.Lock()
latest_frame = None  # raw JPEG bytes for MJPEG stream
latest_frame_raw = None  # numpy array for inference
results = deque(maxlen=3)  # list of {id, frame_b64, output, status, timestamp}


def camera_loop():
    """Continuously capture frames from the camera."""
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
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        with lock:
            latest_frame = buf.tobytes()
            latest_frame_raw = frame


def inference_loop():
    """Periodically grab the latest frame and run inference."""
    client = OpenAI(base_url=VLLM_URL, api_key="unused")
    print(f"Inference loop started (model: {MODEL})")

    while True:
        time.sleep(INFERENCE_INTERVAL)

        with lock:
            frame = latest_frame_raw

        if frame is None:
            continue

        # Encode frame for the API
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        b64 = base64.b64encode(buf).decode("utf-8")

        # Create a pending entry
        entry = {
            "id": uuid.uuid4().hex[:8],
            "frame_b64": b64,
            "output": None,
            "status": "processing",
            "timestamp": time.time(),
        }

        with lock:
            results.append(entry)

        # Run inference (slow — this is the blocking part)
        try:
            t0 = time.time()
            response = client.chat.completions.create(
                model=MODEL,
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
                            {"type": "text", "text": INFERENCE_PROMPT},
                        ],
                    }
                ],
                max_tokens=MAX_TOKENS,
            )
            output = response.choices[0].message.content
            elapsed = time.time() - t0
            print(f"[{time.strftime('%H:%M:%S')}] Inference done in {elapsed:.1f}s")

            with lock:
                entry["output"] = output
                entry["status"] = "done"
                entry["elapsed"] = round(elapsed, 1)
        except Exception as e:
            print(f"Inference error: {e}")
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


@app.route("/stream")
def stream():
    return Response(
        generate_mjpeg(),
        mimetype="multipart/x-mixed-replace; boundary=frame",
    )


@app.route("/results")
def get_results():
    with lock:
        data = list(results)
    # Don't send full base64 frames in the results endpoint — send a smaller thumbnail
    out = []
    for r in data:
        out.append({
            "id": r["id"],
            "frame_b64": r["frame_b64"],
            "output": r["output"],
            "status": r["status"],
            "timestamp": r["timestamp"],
            "elapsed": r.get("elapsed"),
        })
    return jsonify(out)


@app.route("/health")
def health():
    with lock:
        has_frame = latest_frame is not None
        n_results = len(results)
    return jsonify({"ok": True, "camera": has_frame, "results": n_results})


if __name__ == "__main__":
    threading.Thread(target=camera_loop, daemon=True).start()
    threading.Thread(target=inference_loop, daemon=True).start()
    print("Starting server on :8090")
    app.run(host="0.0.0.0", port=8090, threaded=True)
