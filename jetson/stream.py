import pyrealsense2 as rs
import numpy as np
import cv2
import os
from ultralytics import YOLO
from flask import Flask, Response, jsonify
from flask_cors import CORS
import threading
import time

app = Flask(__name__)
CORS(app)

latest_frame = None
latest_detections = []
lock = threading.Lock()
fps_val = 0
latest_detection_ts = 0.0

FILTER_RAW = os.getenv("YOLO_LABEL_FILTER", "person").strip().lower()
try:
    MIN_CONFIDENCE = float(os.getenv("YOLO_MIN_CONF", "0.25"))
except ValueError:
    MIN_CONFIDENCE = 0.25
if FILTER_RAW in ("", "all", "*"):
    ACTIVE_LABEL_FILTER = None
else:
    ACTIVE_LABEL_FILTER = {label.strip() for label in FILTER_RAW.split(",") if label.strip()}

def yolo_loop():
    global latest_frame, latest_detections, fps_val, latest_detection_ts
    model = YOLO("yolo11s.engine")

    pipeline = rs.pipeline()
    config = rs.config()
    config.enable_stream(rs.stream.color, 640, 480, rs.format.bgr8, 30)
    config.enable_stream(rs.stream.depth, 640, 480, rs.format.z16, 30)
    pipeline.start(config)
    align = rs.align(rs.stream.color)

    print("YOLO inference loop started.")
    count = 0
    t0 = time.time()

    try:
        while True:
            frames = pipeline.wait_for_frames()
            aligned = align.process(frames)
            color_frame = aligned.get_color_frame()
            depth_frame = aligned.get_depth_frame()
            if not color_frame or not depth_frame:
                continue

            frame = np.asanyarray(color_frame.get_data())
            results = model(frame, verbose=False)
            annotated = frame.copy()

            detections = []
            for box in results[0].boxes:
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
                dist = depth_frame.get_distance(cx, cy)
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                label = model.names[cls_id]
                normalized_label = str(label).strip().lower()

                if conf < MIN_CONFIDENCE:
                    continue

                if ACTIVE_LABEL_FILTER is not None and normalized_label not in ACTIVE_LABEL_FILTER:
                    continue

                cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 220, 0), 2)
                cv2.putText(
                    annotated,
                    f"{label} {(conf * 100):.0f}%",
                    (x1, max(y1 - 28, 20)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    (0, 220, 0),
                    2,
                )
                cv2.putText(annotated, f"{dist:.2f}m", (x1, y1 - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

                detections.append({
                    "label": label,
                    "confidence": round(conf, 3),
                    "bbox": [x1, y1, x2, y2],
                    "depth_m": round(dist, 3),
                })

            count += 1
            elapsed = time.time() - t0
            if elapsed >= 1.0:
                fps_val = count / elapsed
                count = 0
                t0 = time.time()

            cv2.putText(annotated, f"{fps_val:.1f} FPS", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
            filter_text = "all" if ACTIVE_LABEL_FILTER is None else ",".join(sorted(ACTIVE_LABEL_FILTER))
            cv2.putText(
                annotated,
                f"Filter: {filter_text}",
                (10, 58),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (140, 200, 255),
                1,
            )

            with lock:
                latest_frame = annotated
                latest_detections = detections
                latest_detection_ts = time.time()
    finally:
        pipeline.stop()

def generate():
    while True:
        with lock:
            frame = latest_frame
        if frame is None:
            time.sleep(0.01)
            continue
        _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        yield (b"--frame\r\n"
               b"Content-Type: image/jpeg\r\n\r\n" + jpeg.tobytes() + b"\r\n")

HTML = """<html><body style="margin:0;background:#000;display:flex;
justify-content:center;align-items:center;height:100vh">
<img src="/stream" style="max-width:100%;max-height:100vh">
</body></html>"""

@app.route("/")
def index():
    return HTML

@app.route("/stream")
def stream():
    return Response(generate(), mimetype="multipart/x-mixed-replace; boundary=frame")

@app.route("/detections")
def detections():
    with lock:
        dets = list(latest_detections)
        ts = latest_detection_ts

    counts = {}
    nearest_person = None
    for det in dets:
        label = det["label"]
        counts[label] = counts.get(label, 0) + 1
        if label == "person":
            depth = det.get("depth_m")
            if isinstance(depth, (int, float)):
                if nearest_person is None or depth < nearest_person:
                    nearest_person = depth

    return jsonify({
        "fps": round(fps_val, 1),
        "timestamp": round(ts, 3) if ts else None,
        "source": "jetson",
        "counts": counts,
        "person_count": counts.get("person", 0),
        "nearest_person_m": round(nearest_person, 3) if nearest_person is not None else None,
        "detections": dets,
    })

if __name__ == "__main__":
    t = threading.Thread(target=yolo_loop, daemon=True)
    t.start()
    print("Stream at http://192.168.50.4:8080")
    app.run(host="0.0.0.0", port=8080, threaded=True)
