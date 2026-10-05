#!/usr/bin/env python3
"""Reproduce the real-photo demonstration and landmark smoke-test fixtures.

Requires the optional development environment in requirements-dev.txt and the
public CC0 ASL Dataset ZIP from Ayush Thakur. Never accesses a webcam. This
fixture set is a development check, not an independent model evaluation set.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import zipfile
import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

ROOT = Path(__file__).resolve().parents[1]
DEMO_SOURCES = {
    'H': 'asl_dataset/asl_dataset/h/hand2_h_dif_seg_1_cropped.jpeg',
    'O': 'asl_dataset/asl_dataset/o/hand2_o_dif_seg_1_cropped.jpeg',
}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-zip', type=Path, required=True)
    args = parser.parse_args()
    output = ROOT / 'dist/samples'
    output.mkdir(parents=True, exist_ok=True)
    options = vision.HandLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(ROOT / 'dist/models/hand_landmarker.task')),
        running_mode=vision.RunningMode.IMAGE,
        num_hands=1,
        min_hand_detection_confidence=.5,
        min_hand_presence_confidence=.5,
    )
    fixtures = []
    demo = {}
    with zipfile.ZipFile(args.dataset_zip) as archive, vision.HandLandmarker.create_from_options(options) as detector:
        for label in 'ABCDEFGHIKLMNOPQRSTUVWXY':
            paths = sorted(set(p for p in archive.namelist() if f'/{label.lower()}/' in p.lower() and p.lower().endswith(('.jpg','.jpeg','.png'))))
            # Prefer the neutral camera view. Sorting is deterministic and unrelated to model scores.
            paths.sort(key=lambda p: ('_dif_' not in p, '_hand2_' in p, p))
            found = None
            for source in paths:
                image = cv2.imdecode(np.frombuffer(archive.read(source), dtype=np.uint8), cv2.IMREAD_COLOR)
                if image is None:
                    continue
                h, w = image.shape[:2]
                # Add a 15% border around tightly cropped source photos for palm detection.
                border = int(max(w, h) * .15)
                image = cv2.copyMakeBorder(image, border, border, border, border, cv2.BORDER_CONSTANT, value=(245,245,245))
                rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
                result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
                if not result.hand_landmarks:
                    continue
                points = [{'x': float(p.x), 'y': float(p.y), 'z': float(p.z)} for p in result.hand_landmarks[0]]
                target = label.lower() + '.jpg'
                cv2.imwrite(str(output / target), image)
                found = {'label': label, 'image': target, 'width': image.shape[1], 'height': image.shape[0], 'landmarks': points, 'source': source}
                fixtures.append(found)
                print(f"{label}: {source}", flush=True)
                break
            if found is None:
                print(f'{label}: no hand detected', flush=True)
        # Demonstration photos are deliberately chosen to show the successful
        # spelling flow. They do not replace the uncurated development fixtures.
        for label, source in DEMO_SOURCES.items():
            image = cv2.imdecode(np.frombuffer(archive.read(source), dtype=np.uint8), cv2.IMREAD_COLOR)
            border = int(max(image.shape[:2]) * .15)
            image = cv2.copyMakeBorder(image, border, border, border, border, cv2.BORDER_CONSTANT, value=(245,245,245))
            rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
            if not result.hand_landmarks:
                raise RuntimeError(f'Could not recreate demonstration landmarks for {label}.')
            target = label.lower() + '-demo.jpg'
            cv2.imwrite(str(output / target), image)
            demo[label] = {'image': target, 'width': image.shape[1], 'height': image.shape[0], 'source': source,
                           'landmarks': [{'x':float(p.x),'y':float(p.y),'z':float(p.z)} for p in result.hand_landmarks[0]]}
    (ROOT / 'tests/landmark-fixtures.json').write_text(json.dumps({'source': 'ASL Dataset by Ayush Thakur, CC0-1.0', 'method': 'First detected neutral-view photograph per class', 'fixtures': fixtures}, indent=2) + '\n')
    lookup = {f['label']: f for f in fixtures}
    blank = np.full((320,320,3), 20, dtype=np.uint8)
    cv2.imwrite(str(output / 'blank.jpg'), blank)
    frames = []
    for label in 'HELLO':
        fixture = demo.get(label, lookup[label])
        frames.append({k: fixture[k] for k in ['image','width','height','landmarks']} | {'durationMs': 2400})
        frames.append({'image': 'blank.jpg', 'width': 320, 'height': 320, 'landmarks': None, 'durationMs': 650})
    (output / 'sequence.json').write_text(json.dumps({'source': 'ASL Dataset by Ayush Thakur (CC0-1.0)', 'description': 'Real photographed handshapes replayed through the classifier, with explicit release frames. It is not a live signing video.', 'frames': frames}, indent=2) + '\n')
    print(f'Wrote {len(fixtures)} landmark fixtures and a real-photo HELLO sequence.')

if __name__ == '__main__':
    main()
