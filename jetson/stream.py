import pyrealsense2 as rs
import numpy as np
import cv2
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

def yolo_loop():
    global latest_frame, latest_detections, fps_val
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
            annotated = results[0].plot()

            detections = []
            for box in results[0].boxes:
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
                dist = depth_frame.get_distance(cx, cy)
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                label = model.names[cls_id]

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

            with lock:
                latest_frame = annotated
                latest_detections = detections
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
    return jsonify({"fps": round(fps_val, 1), "detections": dets})

if __name__ == "__main__":
    t = threading.Thread(target=yolo_loop, daemon=True)
    t.start()
    print("Stream at http://192.168.50.4:8080")
    app.run(host="0.0.0.0", port=8080, threaded=True)
