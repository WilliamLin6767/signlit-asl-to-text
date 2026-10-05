# Signlit

A webcam app that recognizes **ASL fingerspelling handshapes** and turns held
letters into an editable text message. Hand tracking and neural-network
inference run locally in a Web Worker. Video is never uploaded.

## Run it

You need Node.js 20+ and Python 3.9+. No API keys, backend, or account setup is
required to run the application locally.

```bash
npm run setup
npm start
```

Open **http://localhost:5173**. Use a current Chrome, Edge, or Firefox browser
with WebAssembly, Web Workers, OffscreenCanvas, and camera support. The first
setup downloads approximately 40 MB of model/runtime assets. After setup the
recognition assets are served from your own app.

Use `PORT=3000 npm start` to choose another local port. There are no required
environment variables. Open the app through a server, not `file://`.

For checks, install the development dependencies:

```bash
npm ci
npm test
npm run check
npm run test:vision
```

## Use it

1. Click **Start camera** and grant camera access.
2. Show one complete hand, facing the camera, in even lighting.
3. Form a letter and hold it for the selected hold time. The default is
   0.8 seconds with a minimum model score of 80%.
4. Use **Space** between words. For doubled letters, lower your hand briefly
   between signs or click **Repeat**.
5. Edit the message directly, then **Copy text**.

You can switch off auto-add and use **Add current letter** instead. Use the
alphabet guide for handshape reminders and manual J/Z entry. **Try a recorded
sample** replays actual photographed handshapes through the classifier. Its
predictions are computed live; the app does not type a canned HELLO string.

## Recognition scope

This is a **fingerspelling prototype**, not a conversational ASL translator.
It recognizes the 24 static letters A–I, K–Y. J and Z require motion; their
static CNN outputs are displayed when encountered but never automatically
committed. They can be entered manually.

ASL includes motion, two-handed signs, facial expression, body position, and
its own grammar. Those are outside this version. Scores are model estimates,
not calibrated probabilities of correctness. Similar handshapes, particularly
M/N/T/S, camera angle, occlusion, and lighting can cause errors. A CNN trained
on isolated handshapes can also confidently misclassify an unrelated pose.
Use the editable transcript and manual mode when appropriate.

## How it works

| Stage | Implementation |
| --- | --- |
| Capture | `getUserMedia`, video only, explicit Start/Stop, tracks stopped on exit |
| Hand tracking | MediaPipe Hand Landmarker, 21 landmarks, CPU delegate |
| Geometry | Convert x/y to pixels, preserve aspect ratio, center the bounding box at 70% canvas fill |
| Model input | Colored 192 px hand skeleton, area-averaged to 96×96 RGB floats in the 0–255 range |
| Recognition | Pretrained skeleton CNN in ONNX Runtime Web; softmax over the original 26 logits |
| Text decoding | Minimum score, minimum observation count, continuous hold, release detection, duplicate suppression |
| Interface | Vanilla ES modules and CSS, responsive layout, live overlay, editable message |

The worker serializes frames and resets, processes at most one active frame
at a time, closes transferred ImageBitmaps, and releases inference tensors.
Inference is throttled to roughly 15 frames/second; actual speed depends on
the device. No frame-rate or latency guarantee is claimed.

The worker is deliberately a **classic worker** with dynamic ES imports.
MediaPipe 0.10.21 uses `importScripts` for its WASM factory, which is prohibited
in module workers. ONNX uses a single WASM thread, so the app does not require
cross-origin isolation headers.

The pretrained classifier is by **Nicolás Florentín**. Signlit does not claim
to have trained that network or to reproduce its published accuracy numbers.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution, source
links, and model/dataset terms. Models and runtime binaries are intentionally
excluded from source commits and downloaded with pinned versions/checksums.

## Project map

```text
dist/                    Served website
  app.js                 Camera lifecycle, transcript, guides, controls
  core.js                Geometry, softmax, temporal decoder
  renderer.js            Skeleton rendering and model tensor preparation
  vision-worker.js       MediaPipe and ONNX inference
  samples/               CC0 photo sample and recorded landmarks
scripts/
  setup_assets.py        Pinned, checksum-verified asset downloader
  serve.mjs              Local static server
  check.mjs              Syntax and required asset validation
  vision_smoke.mjs        Real ONNX WASM inference smoke check
  make_samples.py        Reproduce photographed landmark fixtures
tests/                   Decoder, DOM interaction, and landmark fixtures
assets-lock.json         Asset versions and SHA-256 checksums
```

## Verification and limits

- Automated tests cover geometry, unstable predictions, repeated letters,
  missing frames, long inference gaps, text editing, denied camera access,
  camera shutdown, and the structured transcript tool contract.
- The neural-network smoke check runs the actual renderer and ONNX WASM
  runtime on real photographed hand landmarks and tests the full HELLO
  hold/release sequence.
- The 24 development fixtures come from a source dataset used by the model.
  They are not an independent evaluation set. The successful demo photos
  are deliberately chosen for demonstrating the flow and are not a benchmark.
- Live webcam behavior, browser/device coverage, and generalization to
  different signers require hands-on testing. Automated DOM tests stub camera
  permissions and the worker; they do not certify browser camera behavior.
- The Canvas renderer is a port of an OpenCV renderer. Their rasterization
  differs, so upstream model evaluation numbers do not measure this app.

## Reproduce the real-photo samples

Download the public [ASL Dataset by Ayush Thakur](https://www.kaggle.com/datasets/ayuraj/asl-dataset)
(CC0-1.0), then use a separate optional Python environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python scripts/make_samples.py --dataset-zip /path/to/asl-dataset.zip
```

The fixture generator chooses the first detectable neutral-view image per
static letter. The demonstration uses explicitly identified H/O photos; model
predictions still pass through the same runtime and decoder as webcam signs.

## Host it

Run `npm run setup`, then deploy **the contents of `dist/`** to an HTTPS static
host. Serve `.wasm` as `application/wasm` and `.mjs` as JavaScript. Camera access
requires HTTPS in production. Use relative paths to support deployment under
a repository subdirectory. Preserve the directory structure, including
`vendor/`, `models/`, and `samples/`.

No server sees video or transcript text. The page loads Google Fonts; if you
need to eliminate that network request, remove the CSS font import and use the
existing system-font fallbacks.

## Next research steps

For conversational ASL, replace the isolated-letter classifier with a trained
temporal model using licensed video sequences, face/pose/hand landmarks, and
signer-separated evaluation. Start with isolated words, measure per-signer
errors, then add continuous sequence decoding. J/Z support also requires a
temporal detector instead of trusting single-frame predictions.
