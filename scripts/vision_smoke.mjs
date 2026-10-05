/** Offline smoke check of the actual browser renderer and ONNX WASM runtime. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCanvas} from '@napi-rs/canvas';
import * as ort from 'onnxruntime-web/wasm';
import {normalizeLandmarks,softmax,LetterDecoder} from '../dist/core.js';
import {renderModelInput} from '../dist/renderer.js';

const root=new URL('../',import.meta.url);
ort.env.wasm.numThreads=1;
const session=await ort.InferenceSession.create(await readFile(new URL('dist/models/asl_cnn_model.onnx',root)),{executionProviders:['wasm']});
const canvas=createCanvas(192,192);
async function predict(frame){
  const pixels=renderModelInput(normalizeLandmarks(frame.landmarks,frame.width,frame.height),canvas);
  const input=new ort.Tensor('float32',pixels,[1,96,96,3]);
  const out=await session.run({[session.inputNames[0]]:input},['logits']);
  assert.equal(out.logits.data.length,26);assert.ok(Array.from(out.logits.data).every(Number.isFinite));
  const result=softmax(out.logits.data)[0];input.dispose();out.logits.dispose();return result;
}
try{
  const fixtureSet=JSON.parse(await readFile(new URL('tests/landmark-fixtures.json',root),'utf8'));
  let matched=0;const misses=[];
  for(const frame of fixtureSet.fixtures){const p=await predict(frame);if(p.label===frame.label)matched++;else misses.push(`${frame.label}→${p.label}`);}
  console.log(`Development fixtures: ${matched}/${fixtureSet.fixtures.length} top predictions match. Confusions: ${misses.join(', ')||'none'}.`);
  console.log('These photographs overlap the model source data; this is not an accuracy benchmark.');
  const sequence=JSON.parse(await readFile(new URL('dist/samples/sequence.json',root),'utf8'));
  const decoder=new LetterDecoder();let time=0,text='';
  for(const frame of sequence.frames){
    const p=frame.landmarks?await predict(frame):null;
    for(let dt=0;dt<frame.durationMs;dt+=100){const r=decoder.update(p,time);if(r.commit)text+=r.commit;time+=100;}
  }
  assert.equal(text,'HELLO','The real-photo demonstration should spell HELLO with default settings.');
  console.log('Real-photo renderer → ONNX WASM → hold/release decoder produced HELLO.');
}finally{await session.release();}
