#!/usr/bin/env python3
"""Fetch pinned model/runtime assets. Uses Python's standard library only.

The generated runtime files are not committed. Package archives are verified
against npm's pinned SHA-512 integrity values, and individual outputs against
assets-lock.json when present. No credentials or API keys are needed.
"""
from __future__ import annotations
import base64
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
LOCK = ROOT / 'assets-lock.json'
MODEL_REV = '45ff2c0e26925c50f4546073bd573fe3ca7a5e6e'
PACKAGES = [
    {
        'name': 'mediapipe',
        'url': 'https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.21.tgz',
        'integrity': 'TuhKH+credq4zLksGbYrnvJ1aLIWMc5r0UHwzxzql4BHECJwIAoBR61ZrqwGOW6ZmSBIzU1t4VtKj8hbxFaKeA==',
        'files': {
            'package/vision_bundle.mjs': 'vendor/mediapipe/vision_bundle.mjs',
            'package/wasm/vision_wasm_internal.js': 'vendor/mediapipe/wasm/vision_wasm_internal.js',
            'package/wasm/vision_wasm_internal.wasm': 'vendor/mediapipe/wasm/vision_wasm_internal.wasm',
            'package/wasm/vision_wasm_nosimd_internal.js': 'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js',
            'package/wasm/vision_wasm_nosimd_internal.wasm': 'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm',
        },
    },
    {
        'name': 'ort',
        'url': 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.22.0.tgz',
        'integrity': 'Ud/+EBo6mhuaQWt/OjaOk0iNWjXqJoeeMFr6xQEERZdIZH2OWpGzuujz7lfuOBjUa6TEE/sc4nb7Da5dNL34fg==',
        'files': {
            'package/dist/ort.wasm.min.mjs': 'vendor/ort/ort.wasm.min.mjs',
            'package/dist/ort-wasm-simd-threaded.mjs': 'vendor/ort/ort-wasm-simd-threaded.mjs',
            'package/dist/ort-wasm-simd-threaded.wasm': 'vendor/ort/ort-wasm-simd-threaded.wasm',
        },
    },
]
MODELS = {
    'models/asl_cnn_model.onnx': f'https://raw.githubusercontent.com/punpuniacitizen/MediaPipe-ASL-sign-language-recognition/{MODEL_REV}/asl_cnn_model.onnx',
    'models/hand_landmarker.task': 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
}
NOTICES = {
    'vendor/mediapipe/LICENSE': 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.21/LICENSE',
    'vendor/ort/LICENSE': 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.22.0/LICENSE',
}
lock = json.loads(LOCK.read_text()) if LOCK.exists() else {'files': {}}

def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'Signlit-asset-setup/1.0'})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read()

def is_valid(path: str) -> bool:
    file = DIST / path
    expected = lock['files'].get(path)
    return bool(expected and file.exists() and sha256(file.read_bytes()) == expected)

def save(path: str, data: bytes) -> tuple[str, str]:
    digest = sha256(data)
    expected = lock['files'].get(path)
    if expected and expected != digest:
        raise ValueError(f'Checksum mismatch: {path}. Refusing to replace the asset.')
    file = DIST / path
    file.parent.mkdir(parents=True, exist_ok=True)
    temp = file.with_suffix(file.suffix + '.tmp')
    temp.write_bytes(data)
    temp.replace(file)
    return path, digest

def fetch_package(package: dict) -> dict[str, str]:
    paths = list(package['files'].values())
    if all(is_valid(path) for path in paths):
        print(f"Verified existing {package['name']} runtime.", flush=True)
        return {path: lock['files'][path] for path in paths}
    data = download(package['url'])
    actual = base64.b64encode(hashlib.sha512(data).digest()).decode()
    if actual != package['integrity']:
        raise ValueError(f"npm archive integrity mismatch: {package['name']}")
    outputs = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        # Read only explicitly selected regular files; never extract archive paths.
        for source, destination in package['files'].items():
            info = archive.getmember(source)
            if not info.isfile():
                raise ValueError(f'Not a regular file: {source}')
            path, digest = save(destination, archive.extractfile(info).read())
            outputs[path] = digest
        for info in archive.getmembers():
            if info.isfile() and Path(info.name).name.upper() in {'LICENSE', 'LICENSE.TXT', 'NOTICE', 'THIRDPARTYNOTICES.TXT'}:
                path, digest = save(f"vendor/{package['name']}/{Path(info.name).name}", archive.extractfile(info).read())
                outputs[path] = digest
    print(f"Prepared {package['name']} runtime.", flush=True)
    return outputs

def fetch_model(item: tuple[str, str]) -> dict[str, str]:
    path, url = item
    if is_valid(path):
        print(f'Verified existing {path}.', flush=True)
        return {path: lock['files'][path]}
    key, digest = save(path, download(url))
    print(f'Prepared {path}.', flush=True)
    return {key: digest}

def main() -> None:
    outputs = dict(lock['files'])
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        jobs = [pool.submit(fetch_package, package) for package in PACKAGES]
        jobs += [pool.submit(fetch_model, item) for item in (MODELS | NOTICES).items()]
        for job in concurrent.futures.as_completed(jobs):
            outputs.update(job.result())
    if not LOCK.exists():
        LOCK.write_text(json.dumps({'model_revision': MODEL_REV, 'mediapipe': '0.10.21', 'onnxruntime_web': '1.22.0', 'files': dict(sorted(outputs.items()))}, indent=2) + '\n')
    print('Signlit runtime assets are ready. Run npm start.', flush=True)

if __name__ == '__main__':
    main()
