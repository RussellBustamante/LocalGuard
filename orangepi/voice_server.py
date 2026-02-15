#!/usr/bin/env python3
"""
Orange Pi voice assistant node for LocalGuard.

Listens for wake word "Security" via continuous STT, then records a command,
sends it to the local LLM, and speaks the response.

Serves:
  GET /health   — health check
  GET /status   — current assistant state + recent interactions
  POST /start   — start the wake word listener
  POST /stop    — stop the wake word listener

Run on the Orange Pi:
  cd ~/voice-assistant && source ~/voice-assistant-venv/bin/activate
  python3 voice_server.py
"""

import io
import os
import time
import wave
import json
import urllib.request
import threading
import subprocess
import numpy as np
import pyaudio
import sherpa_onnx
from collections import deque
from flask import Flask, jsonify, request

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
WAKE_WORD = "security"

# Audio
AUDIO_DEVICE_NAME = "Blackwire"  # partial match for USB headset
SAMPLE_RATE = 16000
CHANNELS = 1
CHUNK = 512  # samples per read (~32ms at 16kHz)

# Models
MODEL_DIR = os.path.expanduser("~/voice-assistant/models")
PARAKEET_DIR = os.path.join(MODEL_DIR, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8")
VAD_MODEL = os.path.join(MODEL_DIR, "silero_vad.onnx")
PIPER_VOICE = os.path.join(MODEL_DIR, "piper-voices", "en_US-amy-low.onnx")

# LLM (llama-server OpenAI-compatible API)
LLM_URL = "http://127.0.0.1:8081/v1/chat/completions"
LLM_MODEL = "qwen3-1.7b"
SYSTEM_PROMPT = (
    "You are a security assistant for LocalGuard, a distributed edge AI monitoring "
    "system. Answer concisely in 1-3 sentences. Be direct and helpful. "
    "/no_think"
)
INSIGHTS_BRIEF_URL = os.getenv(
    "INSIGHTS_BRIEF_URL",
    "http://192.168.50.1:3000/api/insights/brief",
)
EVENTS_URL = os.getenv(
    "EVENTS_URL",
    "http://192.168.50.1:3000/api/events?limit=1",
)
INSIGHTS_TIMEOUT_S = 1.2
INSIGHTS_CACHE_TTL_S = 2.0

# Timing
SILENCE_AFTER_WAKE = 0.8   # seconds of silence before stopping command recording
MAX_COMMAND_DURATION = 10.0  # max seconds to record a command

# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------
lock = threading.Lock()
assistant_running = False
assistant_thread = None
current_state = "idle"  # idle, listening, recording, thinking, speaking
interactions = deque(maxlen=10)
llm_server_proc = None
cached_context = ""
cached_context_ts = 0.0

# ---------------------------------------------------------------------------
# Audio helpers
# ---------------------------------------------------------------------------

def find_audio_device(pa):
    """Find the USB headset device index."""
    for i in range(pa.get_device_count()):
        info = pa.get_device_info_by_index(i)
        if AUDIO_DEVICE_NAME.lower() in info["name"].lower():
            if info["maxInputChannels"] > 0:
                return i
    return None


def play_wav(pa, wav_bytes, device_index):
    """Play WAV audio bytes through the headset."""
    buf = io.BytesIO(wav_bytes)
    with wave.open(buf, "rb") as wf:
        stream = pa.open(
            format=pa.get_format_from_width(wf.getsampwidth()),
            channels=wf.getnchannels(),
            rate=wf.getframerate(),
            output=True,
            output_device_index=device_index,
        )
        data = wf.readframes(1024)
        while data:
            stream.write(data)
            data = wf.readframes(1024)
        stream.stop_stream()
        stream.close()


def find_output_device(pa):
    """Find the USB headset output device index."""
    for i in range(pa.get_device_count()):
        info = pa.get_device_info_by_index(i)
        if AUDIO_DEVICE_NAME.lower() in info["name"].lower():
            if info["maxOutputChannels"] > 0:
                return i
    return None


# ---------------------------------------------------------------------------
# STT
# ---------------------------------------------------------------------------

_recognizer = None


def get_recognizer():
    global _recognizer
    if _recognizer is None:
        log("Loading Parakeet TDT model...")
        t0 = time.time()
        _recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=os.path.join(PARAKEET_DIR, "encoder.int8.onnx"),
            decoder=os.path.join(PARAKEET_DIR, "decoder.int8.onnx"),
            joiner=os.path.join(PARAKEET_DIR, "joiner.int8.onnx"),
            tokens=os.path.join(PARAKEET_DIR, "tokens.txt"),
            num_threads=4,
            model_type="nemo_transducer",
        )
        log(f"Parakeet loaded in {time.time()-t0:.1f}s")
    return _recognizer


def transcribe(audio_samples):
    """Transcribe float32 audio samples at 16kHz."""
    rec = get_recognizer()
    stream = rec.create_stream()
    stream.accept_waveform(SAMPLE_RATE, audio_samples)
    rec.decode_stream(stream)
    return stream.result.text.strip()


# ---------------------------------------------------------------------------
# VAD
# ---------------------------------------------------------------------------

_vad = None


def get_vad():
    global _vad
    if _vad is None:
        log("Loading Silero VAD...")
        config = sherpa_onnx.VadModelConfig()
        config.silero_vad.model = VAD_MODEL
        config.silero_vad.min_silence_duration = SILENCE_AFTER_WAKE
        config.silero_vad.min_speech_duration = 0.1
        config.sample_rate = SAMPLE_RATE
        _vad = sherpa_onnx.VadModel.create(config)
        log("VAD loaded")
    return _vad


# ---------------------------------------------------------------------------
# TTS
# ---------------------------------------------------------------------------

_voice = None


def get_voice():
    global _voice
    if _voice is None:
        log("Loading Piper TTS voice...")
        t0 = time.time()
        from piper import PiperVoice
        _voice = PiperVoice.load(PIPER_VOICE)
        log(f"Piper loaded in {time.time()-t0:.1f}s")
    return _voice


def synthesize(text):
    """Synthesize text to WAV bytes."""
    voice = get_voice()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        voice.synthesize_wav(text, wf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# LLM
# ---------------------------------------------------------------------------

def get_live_context():
    """Fetch compact fused sensor context from dashboard with short timeout."""
    global cached_context, cached_context_ts

    now = time.time()
    if now - cached_context_ts < INSIGHTS_CACHE_TTL_S and cached_context:
        return cached_context

    try:
        with urllib.request.urlopen(INSIGHTS_BRIEF_URL, timeout=INSIGHTS_TIMEOUT_S) as resp:
            data = json.loads(resp.read())

        parts = []
        level = data.get("alert_level")
        risk = data.get("risk_score")
        people = data.get("person_count")
        nearest = data.get("nearest_person_m")
        objects = data.get("objects_of_interest") or []
        scene = (data.get("scene_summary") or "").strip()
        last_event = (data.get("last_event") or "").strip()

        if level:
            parts.append(f"level {level}")
        if isinstance(risk, (int, float)):
            parts.append(f"risk {int(risk)}")
        if isinstance(people, (int, float)):
            parts.append(f"people {int(people)}")
        if isinstance(nearest, (int, float)):
            parts.append(f"nearest {nearest:.2f}m")
        if objects:
            parts.append(f"objects {','.join(objects[:2])}")
        if scene:
            parts.append(f"scene {scene[:90]}")
        if last_event:
            parts.append(f"event {last_event[:80]}")

        context = "; ".join(parts)[:260]
        cached_context = context
        cached_context_ts = now
        return context
    except Exception:
        return cached_context


def llm_query(user_text, live_context=""):
    """Query the local LLM via llama-server HTTP API."""
    composed_user_text = user_text
    if live_context:
        composed_user_text = (
            f"Live local context: {live_context}\n"
            f"User request: {user_text}"
        )

    payload = json.dumps({
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": composed_user_text},
        ],
        "max_tokens": 150,
        "temperature": 0.3,
    }).encode()

    req = urllib.request.Request(
        LLM_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        log(f"LLM error: {e}")
        return f"Sorry, I couldn't process that. Error: {e}"


# ---------------------------------------------------------------------------
# LLM server management
# ---------------------------------------------------------------------------

def start_llm_server():
    """Start llama-server in the background."""
    global llm_server_proc

    # Check if already running
    try:
        urllib.request.urlopen("http://127.0.0.1:8081/health", timeout=2)
        log("LLM server already running")
        return
    except Exception:
        pass

    model_path = os.path.expanduser(
        "~/test_llm/models/qwen3-1.7b/Qwen3-1.7B-Q8_0.gguf"
    )
    server_bin = os.path.expanduser(
        "~/test_llm/ik_llama.cpp/build/bin/llama-server"
    )

    if not os.path.exists(server_bin):
        # Fallback to standard llama.cpp
        server_bin = os.path.expanduser(
            "~/test_llm/llama.cpp/build/bin/llama-server"
        )

    log(f"Starting LLM server: {os.path.basename(server_bin)}")
    llm_server_proc = subprocess.Popen(
        [
            "taskset", "-c", "4-7",
            server_bin,
            "-m", model_path,
            "-t", "4",
            "-c", "2048",
            "--port", "8081",
            "--host", "127.0.0.1",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # Wait for it to be ready
    for i in range(60):
        time.sleep(1)
        try:
            urllib.request.urlopen("http://127.0.0.1:8081/health", timeout=2)
            log("LLM server ready")
            return
        except Exception:
            pass
    log("WARNING: LLM server may not be ready")


def stop_llm_server():
    global llm_server_proc
    if llm_server_proc:
        llm_server_proc.terminate()
        llm_server_proc.wait(timeout=5)
        llm_server_proc = None
        log("LLM server stopped")


# ---------------------------------------------------------------------------
# Main assistant loop
# ---------------------------------------------------------------------------

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def set_state(state):
    global current_state
    with lock:
        current_state = state
    log(f"State: {state}")


def assistant_loop():
    """Main loop: listen for wake word, record command, LLM, speak."""
    global assistant_running

    # Load models eagerly
    get_recognizer()
    get_vad()
    get_voice()
    start_llm_server()

    pa = pyaudio.PyAudio()
    input_device = find_audio_device(pa)
    output_device = find_output_device(pa)

    if input_device is None:
        log("ERROR: No audio input device found")
        assistant_running = False
        return

    log(f"Audio input device: {pa.get_device_info_by_index(input_device)['name']}")
    log(f"Audio output device: {pa.get_device_info_by_index(output_device)['name'] if output_device else 'default'}")

    # Play a startup chime (synthesize a short greeting)
    try:
        greeting = synthesize("Local Guard voice assistant online.")
        play_wav(pa, greeting, output_device)
    except Exception as e:
        log(f"Startup greeting failed: {e}")

    log(f'Listening for wake word: "{WAKE_WORD}"')

    while assistant_running:
        try:
            _listen_cycle(pa, input_device, output_device)
        except Exception as e:
            log(f"Error in listen cycle: {e}")
            time.sleep(1)

    set_state("idle")
    pa.terminate()
    log("Assistant stopped")


def _listen_cycle(pa, input_device, output_device):
    """One cycle: accumulate audio, transcribe periodically, check for wake word."""
    set_state("listening")

    stream = pa.open(
        format=pyaudio.paInt16,
        channels=CHANNELS,
        rate=SAMPLE_RATE,
        input=True,
        input_device_index=input_device,
        frames_per_buffer=CHUNK,
    )

    vad = get_vad()
    audio_buffer = []
    speech_detected = False
    silence_start = None

    try:
        while assistant_running:
            raw = stream.read(CHUNK, exception_on_overflow=False)
            samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
            audio_buffer.extend(samples)

            # Check VAD
            is_speech = vad.is_speech(samples)

            if is_speech:
                speech_detected = True
                silence_start = None
            elif speech_detected:
                if silence_start is None:
                    silence_start = time.time()
                elif time.time() - silence_start > 0.6:
                    # Speech ended — transcribe what we have
                    audio_arr = np.array(audio_buffer, dtype=np.float32)
                    audio_buffer.clear()
                    speech_detected = False
                    silence_start = None

                    if len(audio_arr) < SAMPLE_RATE * 0.3:
                        continue  # too short, skip

                    text = transcribe(audio_arr)
                    if not text:
                        continue

                    log(f"Heard: {text}")

                    # Check for wake word
                    lower = text.lower().strip()
                    if lower.startswith(WAKE_WORD) or WAKE_WORD in lower[:30]:
                        # Extract command after wake word
                        idx = lower.find(WAKE_WORD)
                        command = text[idx + len(WAKE_WORD):].strip(" .,!?")

                        if len(command) < 3:
                            # Wake word only — record the actual command
                            stream.stop_stream()
                            stream.close()
                            _record_command(pa, input_device)
                            return

                        # We got wake word + command in one utterance
                        stream.stop_stream()
                        stream.close()
                        _handle_command(pa, command, output_device)
                        return

            # Don't let buffer grow forever
            max_samples = SAMPLE_RATE * 15
            if len(audio_buffer) > max_samples:
                audio_buffer = audio_buffer[-max_samples:]

    finally:
        try:
            if stream.is_active():
                stream.stop_stream()
            stream.close()
        except Exception:
            pass


def _record_command(pa, input_device):
    """Record a command after wake word was detected."""
    set_state("recording")

    # Play a short beep-like acknowledgment
    try:
        ack = synthesize("Yes?")
        output_device = find_output_device(pa)
        play_wav(pa, ack, output_device)
    except Exception:
        pass

    stream = pa.open(
        format=pyaudio.paInt16,
        channels=CHANNELS,
        rate=SAMPLE_RATE,
        input=True,
        input_device_index=input_device,
        frames_per_buffer=CHUNK,
    )

    vad = get_vad()
    audio_buffer = []
    speech_detected = False
    silence_start = None
    start_time = time.time()

    try:
        while time.time() - start_time < MAX_COMMAND_DURATION:
            raw = stream.read(CHUNK, exception_on_overflow=False)
            samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
            audio_buffer.extend(samples)

            is_speech = vad.is_speech(samples)

            if is_speech:
                speech_detected = True
                silence_start = None
            elif speech_detected:
                if silence_start is None:
                    silence_start = time.time()
                elif time.time() - silence_start > SILENCE_AFTER_WAKE:
                    break  # Done recording
    finally:
        try:
            stream.stop_stream()
            stream.close()
        except Exception:
            pass

    if not audio_buffer:
        return

    audio_arr = np.array(audio_buffer, dtype=np.float32)
    command = transcribe(audio_arr)
    log(f"Command: {command}")

    if command:
        output_device = find_output_device(pa)
        _handle_command(pa, command, output_device)


def fetch_structured_context():
    """Fetch parsed JSON from /api/insights/brief and latest event."""
    brief = None
    event = None

    try:
        with urllib.request.urlopen(INSIGHTS_BRIEF_URL, timeout=INSIGHTS_TIMEOUT_S) as resp:
            brief = json.loads(resp.read())
    except Exception:
        pass

    try:
        with urllib.request.urlopen(EVENTS_URL, timeout=INSIGHTS_TIMEOUT_S) as resp:
            data = json.loads(resp.read())
            events = data.get("events") or []
            if events:
                event = events[0]
    except Exception:
        pass

    return brief, event


# ---------------------------------------------------------------------------
# Intent router — fast deterministic answers for common demo questions
# ---------------------------------------------------------------------------

INTENT_PATTERNS = [
    # (intent_key, list of phrase fragments that trigger it)
    ("status",            ["status", "what's the status", "system status", "report"]),
    ("people_count",      ["how many people", "how many persons", "people count", "person count", "occupancy"]),
    ("nearest_person",    ["nearest person", "closest person", "how close", "how far"]),
    ("restricted_objects",["restricted object", "any restricted", "dangerous object", "weapon", "knife"]),
    ("last_event",        ["last event", "latest event", "what happened", "recent event", "most recent"]),
]


def match_intent(command):
    """Match command text against known intent patterns. Returns intent key or None."""
    lower = command.lower().strip()
    for intent_key, phrases in INTENT_PATTERNS:
        for phrase in phrases:
            if phrase in lower:
                return intent_key
    return None


def build_intent_response(intent_key, brief, event):
    """Build a templated response string for a matched intent."""
    if intent_key == "status":
        if not brief:
            return "I can't reach the dashboard right now. System status unknown."
        level = brief.get("alert_level", "unknown")
        risk = brief.get("risk_score", "?")
        people = brief.get("person_count", 0)
        nearest = brief.get("nearest_person_m")
        nearest_str = f"{nearest:.1f} meters" if isinstance(nearest, (int, float)) and nearest is not None else "unknown"
        return (
            f"System is at {level} alert, risk score {risk}. "
            f"{people} {'person' if people == 1 else 'people'} detected, "
            f"nearest at {nearest_str}."
        )

    if intent_key == "people_count":
        if not brief:
            return "I can't reach the sensors right now."
        people = brief.get("person_count", 0)
        return f"There {'is' if people == 1 else 'are'} {people} {'person' if people == 1 else 'people'} detected right now."

    if intent_key == "nearest_person":
        if not brief:
            return "Sensor data is unavailable."
        nearest = brief.get("nearest_person_m")
        if nearest is None or not isinstance(nearest, (int, float)):
            return "No person currently detected in range."
        return f"The nearest person is {nearest:.2f} meters away."

    if intent_key == "restricted_objects":
        if not brief:
            return "I can't check right now. Sensor data unavailable."
        objects = brief.get("objects_of_interest") or []
        if not objects:
            return "No restricted objects detected at this time."
        obj_list = ", ".join(objects[:4])
        return f"Restricted objects detected: {obj_list}."

    if intent_key == "last_event":
        if event:
            msg = event.get("message", "Unknown event")
            return f"The last event was: {msg}."
        if brief and brief.get("last_event"):
            return f"The last event was: {brief['last_event']}."
        return "No events recorded yet."

    return None


def _handle_command(pa, command, output_device):
    """Handle a voice command — try intent match first, fall back to LLM."""
    if not command:
        return

    set_state("thinking")
    log(f"Command: {command}")

    # --- Intent router: fast deterministic path ---
    intent_key = match_intent(command)
    if intent_key:
        log(f"Intent matched: {intent_key}")
        t0 = time.time()
        brief, event = fetch_structured_context()
        response = build_intent_response(intent_key, brief, event)
        intent_time = time.time() - t0
        log(f"Intent response ({intent_time:.2f}s): {response}")

        if response:
            set_state("speaking")
            t0 = time.time()
            wav_bytes = synthesize(response)
            tts_time = time.time() - t0
            log(f"TTS ({tts_time:.1f}s)")
            play_wav(pa, wav_bytes, output_device)

            with lock:
                interactions.append({
                    "timestamp": time.time(),
                    "command": command,
                    "response": response,
                    "intent_time": round(intent_time, 2),
                    "tts_time": round(tts_time, 2),
                    "source": "intent",
                })
            return

    # --- LLM fallback ---
    log(f"Asking LLM: {command}")
    live_context = get_live_context()
    if live_context:
        log(f"Context: {live_context}")

    t0 = time.time()
    response = llm_query(command, live_context)
    llm_time = time.time() - t0
    log(f"LLM response ({llm_time:.1f}s): {response}")

    # Remove <think>...</think> tags from Qwen3 reasoning output
    import re
    cleaned = re.sub(r"<think>.*?</think>", "", response, flags=re.DOTALL).strip()
    # If stripping removed everything, extract text from inside think tags
    if not cleaned:
        match = re.search(r"<think>(.*?)</think>", response, flags=re.DOTALL)
        if match:
            cleaned = match.group(1).strip()
    response = cleaned or "I'm not sure how to respond to that."

    set_state("speaking")
    t0 = time.time()
    wav_bytes = synthesize(response)
    tts_time = time.time() - t0
    log(f"TTS ({tts_time:.1f}s)")

    play_wav(pa, wav_bytes, output_device)

    # Record interaction
    with lock:
        interactions.append({
            "timestamp": time.time(),
            "command": command,
            "response": response,
            "llm_time": round(llm_time, 2),
            "tts_time": round(tts_time, 2),
            "source": "llm",
        })


# ---------------------------------------------------------------------------
# Flask routes
# ---------------------------------------------------------------------------

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.route("/health")
def health():
    with lock:
        return jsonify({
            "ok": True,
            "state": current_state,
            "running": assistant_running,
        })


@app.route("/status")
def status():
    with lock:
        return jsonify({
            "state": current_state,
            "running": assistant_running,
            "wake_word": WAKE_WORD,
            "interactions": list(interactions),
        })


@app.route("/start", methods=["POST"])
def start():
    global assistant_running, assistant_thread
    with lock:
        if assistant_running:
            return jsonify({"ok": True, "msg": "already running"})
        assistant_running = True
    assistant_thread = threading.Thread(target=assistant_loop, daemon=True)
    assistant_thread.start()
    return jsonify({"ok": True, "msg": "started"})


@app.route("/stop", methods=["POST"])
def stop():
    global assistant_running
    with lock:
        assistant_running = False
    return jsonify({"ok": True, "msg": "stopping"})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Auto-start the assistant
    assistant_running = True
    assistant_thread = threading.Thread(target=assistant_loop, daemon=True)
    assistant_thread.start()

    log("Starting voice server on :8070")
    app.run(host="0.0.0.0", port=8070, threaded=True)
