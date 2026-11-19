import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const required=['dist/index.html','dist/styles.css','dist/app.js','dist/core.js','dist/renderer.js','dist/vision-worker.js','dist/vendor/mediapipe/vision_bundle.mjs','dist/vendor/mediapipe/wasm/vision_wasm_internal.wasm','dist/vendor/ort/ort.wasm.min.mjs','dist/vendor/ort/ort-wasm-simd-threaded.wasm','dist/models/hand_landmarker.task','dist/models/asl_cnn_model.onnx','dist/samples/sequence.json','dist/speech.js','dist/speech.css','dist/speech-core.js','dist/speech-worker.js','dist/mic-worklet.js','dist/vendor/transformers/transformers.min.js','dist/vendor/transformers/ort-wasm-simd-threaded.asyncify.mjs','dist/vendor/transformers/ort-wasm-simd-threaded.asyncify.wasm','dist/models/whisper/Xenova/whisper-base.en/onnx/encoder_model_quantized.onnx','dist/models/whisper/Xenova/whisper-base.en/onnx/decoder_model_merged_quantized.onnx'];
for(const path of required){const info=await stat(root+path);if(!info.size)throw new Error(`Empty file: ${path}`);}
for(const file of ['dist/app.js','dist/core.js','dist/renderer.js','dist/vision-worker.js','dist/speech.js','dist/speech-core.js','dist/speech-worker.js','dist/mic-worklet.js','scripts/serve.mjs'])execFileSync(process.execPath,['--check',root+file]);
const samples=JSON.parse(await readFile(root+'dist/samples/sequence.json','utf8'));
for(const frame of samples.frames){
  if(!Number.isFinite(frame.durationMs)||frame.durationMs<=0)throw new Error('Invalid sample duration.');
  if(!frame.image||frame.image.includes('..'))throw new Error('Invalid sample image.');
  await stat(root+'dist/samples/'+frame.image);
  if(frame.landmarks&&(frame.landmarks.length!==21||frame.landmarks.some((p)=>!Number.isFinite(p.x)||!Number.isFinite(p.y))))throw new Error('Invalid sample landmarks.');
}
console.log('All recognition assets, recorded samples, and JavaScript syntax checks passed.');
