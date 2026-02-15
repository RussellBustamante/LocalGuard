# LocalGuard

**Fully-local home security system: NO cloud, NO subscriptions. Your data never leaves your house.**

Built at TreeHacks 2026.

---

## Inspiration

Home security shouldn't require a cloud subscription or handing your private video feeds to Big Tech. At the Superbowl, Ring announced they'll use customers' cameras to track lost pets. That's great, until it starts tracking people. Society keeps heading toward "you will own nothing and be happy," all amidst constant surveillance.

We built LocalGuard to prove that a smart, multi-camera, voice-interactive security system can run **entirely on local hardware** — no internet required, no data ever leaving your home network.

## What It Does

LocalGuard is a network of small computers on a wired ethernet switch, each running a specialized AI task:

| Node | Hardware | Role |
|------|----------|------|
| **Camera** | NVIDIA Jetson Orin Nano ($250) | Real-time YOLO object detection with depth sensing at 30 FPS, plus Moondream2 VLM scene descriptions every ~5s |
| **Scene Intelligence** | NVIDIA DGX Spark ($2,999) | Runs **3 AI models concurrently** on 128 GB unified memory: YOLOv11 detection on scene camera (~17 FPS), Cosmos-Reason2-**2B** VLM for fast scene analysis every ~1.5s, and Cosmos-Reason2-**8B** VLM for deep multi-camera temporal reasoning every ~20s — all served simultaneously via vLLM with partitioned GPU memory |
| **Voice Assistant** | Orange Pi 5 Plus (~$280) | Wake-word activated. "Security, how many people?" — answered in <5s, fully on-device STT/LLM/TTS |
| **Reasoning** | Orange Pi 5 Max 16 GB (~$180) | Lightweight LLM node — distributed intelligence and low-cost compute |
| **Dashboard** | Any local computer | Web UI fusing all node data into risk scores, alert levels, event timeline, and live feeds |

LocalGuard is a modular framework. The core system runs on affordable ARM boards and a Jetson, combining detection, reasoning, and voice queries into a unified security posture with real-time alerting. The DGX Spark adds vision-language scene intelligence — its 128 GB unified memory lets us run multiple large models concurrently (YOLO + two VLMs) without swapping, something impossible on consumer GPUs.

## How It Works

### Sensor Fusion

The dashboard continuously polls all nodes and fuses their data into a unified security picture:

```
Jetson YOLO detections ──────────┐
Jetson VLM scene descriptions ───┤
Spark YOLO detections ───────────┤
Spark Fast VLM (2B, ~1.5s) ─────┼──→ Fusion Engine ──→ Risk Score (0-100)
Spark Deep VLM (8B, ~20s) ──────┤                      Alert Level
Orange Pi voice status ──────────┘                      Event Timeline
                                                        Scene Summary
```

- **Risk scoring** combines person count (both cameras), proximity (depth sensor), restricted object detection, and VLM keyword analysis across all three vision-language models
- **Alert levels** (low / guarded / elevated / critical) derived from risk score with thresholds
- **Timeline events** generated for person count changes, proximity alerts, restricted objects, and voice queries

### Voice Assistant

Fully on-device voice pipeline — wake word "Security" triggers:

1. **STT** — Parakeet TDT 0.6B (12.7x real-time) transcribes speech
2. **Intent Router** — deterministic fast-path for common queries (<1s response): "how many people?", "what's the status?", "any restricted objects?"
3. **LLM Fallback** — for open-ended questions, fetches live sensor context from the fusion API before querying the LLM, so answers are grounded in real detections — not hallucinated
4. **TTS** — Piper synthesizes the response and plays it back

### DGX Spark: Concurrent Multi-Model Inference

The Spark runs three models simultaneously on a single Blackwell GPU using partitioned vLLM containers:

| Model | GPU Allocation | Cadence | Role |
|-------|---------------|---------|------|
| YOLOv11 Nano | CPU (auto-fallback) | Real-time (~17 FPS) | Object detection on AKASO scene camera |
| Cosmos-Reason2-**2B** | 20% GPU | Every ~1.5s | Fast single-frame scene captions (~24 tok/s generation) |
| Cosmos-Reason2-**8B** | 40% GPU | Every ~20s | Deep temporal analysis fusing frames from **both** cameras (~6 tok/s generation) |

The 8B deep model ingests frames from both the local AKASO camera and the remote Jetson MJPEG stream, producing cross-scene temporal security assessments that capture patterns no single camera could see alone.

### Jetson: Detection + Depth + VLM

The Jetson runs YOLOv11 with TensorRT FP16 acceleration alongside an Intel RealSense D435 depth camera:

- **30 FPS** object detection with per-object depth measurements
- Proximity alerting when a person is within 1.5m of the camera
- **Moondream2** (1.86B VLM via Ollama) generates scene descriptions every ~5s with zero impact on YOLO FPS

## How It Was Built

- **Jetson**: YOLOv11 + TensorRT FP16, RealSense depth alignment, Moondream2 (1.86B VLM via Ollama)
- **Spark**: 3 models via partitioned vLLM Docker containers on Blackwell GPU — Cosmos-Reason2-2B (20% GPU), Cosmos-Reason2-8B (40% GPU), YOLOv11 (CPU)
- **Orange Pi 5 Plus (Voice)**: Parakeet TDT 0.6B (STT), Qwen3-1.7B via llama.cpp (LLM), Piper (TTS) — all CPU, all on-device
- **Orange Pi 5 Max (Reasoning)**: Qwen3-4B via llama.cpp — distributed reasoning on ARM
- **Dashboard**: Next.js 16, React 19, Tailwind 4, TypeScript — server-side sensor fusion across all nodes

Each node runs a Flask server. The dashboard fuses data server-side and serves a single UI. All communication stays on a local ethernet switch — **zero cloud dependencies, zero subscriptions, zero external API calls.**

---

## Technical Deep Dive

### Architecture

```
192.168.50.0/24 wired ethernet switch
   │
   ├── 192.168.50.1  MacBook         Dashboard (Next.js :3000)
   ├── 192.168.50.2  DGX Spark       YOLO + VLM inference (Flask :8090, vLLM :8001/:8002)
   ├── 192.168.50.3  Orange Pi 5+    Voice assistant (Flask :8070)
   └── 192.168.50.4  Jetson Nano     YOLO + depth + VLM (Flask :8080)
```

### Repo Layout

```
dashboard/                  Next.js app (React 19, Tailwind 4, TypeScript)
  app/page.tsx              Main page — node controls + posture banner + panels + feeds
  app/api/jetson/           Health check + SSH start/stop
  app/api/jetson/vlm/       Proxy for Jetson /vlm_results
  app/api/spark/            Health check + SSH start/stop
  app/api/spark/detections/ Proxy for Spark /detections (YOLO)
  app/api/spark/results/    Proxy for Spark /results, /results/fast, /results/deep
  app/api/detections/       Proxy for Jetson /detections
  app/api/orangepi/         Health check + SSH start/stop
  app/api/insights/         Fused snapshot endpoint
  app/api/insights/brief/   Compact context endpoint for voice assistant
  app/api/events/           Timeline events endpoint
  components/               UI components (CameraFeed, DetectionPanel, SparkInference,
                            VoiceAssistant, SecurityPosture, EventTimeline, NodeCard)
  lib/config.ts             Device URLs (env-overridable)
  lib/insights.ts           Sensor fusion engine + risk scoring + event generation
  lib/types.ts              Shared TypeScript types
jetson/stream.py            Flask server on Jetson (YOLO + D435 + Moondream VLM)
spark/spark_server.py       Flask server on Spark (YOLO + camera + dual VLM inference)
spark/start_vllm.sh         Multi-model vLLM launcher (partitioned GPU containers)
orangepi/voice_server.py    Flask server on Orange Pi (wake word + STT/LLM/TTS)
deploy.sh                   SCP files to devices and restart servers
```

### Sensor Fusion Engine (`insights.ts`)

The fusion engine runs server-side in Next.js, polling all nodes in parallel every ~700ms:

1. **Parallel fetch** — `Promise.all` across 6 endpoints (Jetson detections, Jetson VLM, Spark detections, Spark fast VLM, Spark deep VLM, Orange Pi status) with per-source timeouts (900-1500ms)
2. **Detection merge** — YOLO counts summed across both cameras, restricted objects (knife, scissors, gun, etc.) merged with max-confidence tracking
3. **Risk scoring** — weighted formula: person count (up to +30), restricted objects (up to +44), proximity (<1m = +35, <2m = +22), VLM keyword hits (+20 each from fast, deep, and Jetson VLM)
4. **Event generation** — cooldown-gated timeline entries for person count changes, proximity alerts, restricted object sightings, and voice queries
5. **Snapshot caching** — 700ms TTL with in-flight deduplication to handle concurrent dashboard + voice polling

### Voice Context Grounding

The voice assistant doesn't just answer from its LLM's training data — before every response, it fetches live sensor context:

- **Intent router path**: Fetches `/api/insights/brief` JSON, returns templated responses using real-time data (people count, nearest person distance, alert level, restricted objects, deep analysis summary)
- **LLM fallback path**: Fetches the same brief, serializes it into a context string prepended to the user's question: `"Live local context: level elevated; risk 47; people 2; nearest 1.34m; deep analysis A person is standing near the entrance..."`
- **Caching**: 2s local cache + 1.2s fetch timeout to keep voice latency tight

### Spark vLLM Container Management

Models are served via Docker containers from `nvcr.io/nvidia/vllm:26.01-py3`:

```bash
# GPU memory partitioned via --gpu-memory-utilization
vllm-cosmos-2b:  --gpu-memory-utilization 0.20  (port 8001)
vllm-cosmos-8b:  --gpu-memory-utilization 0.40  (port 8002)
# Total: 60% of 128 GB = ~77 GB actively used

# Containers launched sequentially to avoid memory profiling races
./start_vllm.sh cosmos-2b   # wait for health check
./start_vllm.sh cosmos-8b   # then launch 8B
```

All models are gated on HuggingFace — require an HF token at `/home/asus/.cache/huggingface/token`. Weights cached on disk (~20+ GB) for fast cold starts (~30-60s per model).

### Observed Performance

| Component | Metric |
|-----------|--------|
| Jetson YOLO | ~30 FPS (TensorRT FP16) |
| Spark YOLO | ~17 FPS (CPU auto-fallback) |
| Cosmos-2B (fast VLM) | ~272 tok/s prompt, ~24 tok/s generation, ~1.5s/inference |
| Cosmos-8B (deep VLM) | ~127 tok/s prompt, ~6 tok/s generation, ~20-25s/inference |
| Parakeet STT | RTF 0.079 (12.7x real-time) |
| Piper TTS | RTF 0.102 (9.8x real-time) |
| Voice end-to-end | ~3-5s (speech end to audio playback) |
| Intent router | <1s response |
| Fusion cycle | ~700ms |

### Running It

```bash
# Dashboard
cd dashboard && nvm use 20.18.0 && npm run dev

# Deploy device code after editing
./deploy.sh              # all nodes
./deploy.sh jetson       # Jetson only
./deploy.sh spark        # Spark only
./deploy.sh orangepi     # Orange Pi only

# SSH into devices
ssh antwon@192.168.50.4  # Jetson
ssh asus@192.168.50.2    # Spark
ssh ubuntu@192.168.50.3  # Orange Pi
```
