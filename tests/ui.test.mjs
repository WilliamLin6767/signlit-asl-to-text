import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';

test('the real app handles transcript editing, sign guidance, denied camera access, and camera shutdown',async()=>{
  const window=new Window({url:'https://signlit.test/'});
  const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  window.document.body.innerHTML=html.match(/<body>([\s\S]*)<\/body>/)[1];
  const registered=new Map();
  Object.defineProperty(window.document,'modelContext',{value:{registerTool(tool){registered.set(tool.name,tool);}}});
  let tracksStopped=0;
  const fakeStream={getTracks:()=>[{stop(){tracksStopped++;}}],getVideoTracks:()=>[{addEventListener(){}}]};
  class FakeWorker{postMessage(data){if(data.type==='init')queueMicrotask(()=>this.onmessage({data:{type:'ready'}}));}terminate(){}}
  window.Worker=FakeWorker;window.OffscreenCanvas=class{};
  window.requestAnimationFrame=()=>1;window.cancelAnimationFrame=()=>{};
  Object.defineProperty(window.navigator,'mediaDevices',{value:{getUserMedia:async()=>{throw new window.DOMException('denied','NotAllowedError');}},configurable:true});
  Object.defineProperty(globalThis,'navigator',{value:window.navigator,configurable:true});
  Object.assign(globalThis,{window,document:window.document,Worker:FakeWorker,
    HTMLInputElement:window.HTMLInputElement,HTMLTextAreaElement:window.HTMLTextAreaElement,
    requestAnimationFrame:window.requestAnimationFrame,cancelAnimationFrame:window.cancelAnimationFrame});
  const get=(id)=>window.document.getElementById(id);
  get('overlay').getContext=()=>({clearRect(){}});
  Object.defineProperty(get('webcam'),'srcObject',{value:null,writable:true,configurable:true});
  get('webcam').play=async()=>{};get('webcam').pause=()=>{};
  const settle=()=>new Promise((resolve)=>setImmediate(resolve));
  await import('../dist/app.js?ui-test');
  assert.equal(get('alphabet-grid').children.length,26);
  const transcript=get('transcript');transcript.value='HELLO';transcript.dispatchEvent(new window.Event('input'));
  assert.equal(get('letter-count').textContent,'5 characters');assert.equal(get('copy-text').disabled,false);
  get('add-space').click();assert.equal(transcript.value,'HELLO ');
  get('backspace').click();assert.equal(transcript.value,'HELLO');
  const z=Array.from(get('alphabet-grid').children).find((b)=>b.textContent==='Z');z.click();
  assert.match(get('guide-description').textContent,/motion letter/i);
  get('guide-description').querySelector('button').click();assert.equal(transcript.value,'HELLOZ');
  get('repeat-letter').click();assert.equal(transcript.value,'HELLOZZ');
  get('clear-text').click();assert.equal(transcript.value,'');assert.equal(get('copy-text').disabled,true);
  get('start-camera').click();await settle();await settle();
  assert.match(get('error-message').textContent,/Camera access was denied/);assert.equal(get('start-camera').disabled,false);
  assert.equal(get('camera-badge').textContent,'Camera off');
  // Retry the actual start action with a permitted camera and a model-loader stub.
  window.navigator.mediaDevices.getUserMedia=async()=>fakeStream;
  get('start-camera').click();await settle();await settle();
  assert.equal(get('camera-badge').textContent,'Camera on',get('error-message').textContent);assert.equal(get('webcam').hidden,false);
  get('stop-camera').click();assert.equal(tracksStopped,1);assert.equal(get('webcam').srcObject,null);
  assert.equal(get('camera-badge').textContent,'Camera off');
  // Validate the structured tool contract against the same UI state.
  const edit=registered.get('replace_transcript');const read=registered.get('read_transcript');
  assert.deepEqual(edit.execute({text:'MY MESSAGE'}),{text:'MY MESSAGE'});assert.equal(transcript.value,'MY MESSAGE');
  assert.deepEqual(read.execute({}),{text:'MY MESSAGE',mode:'idle'});
  assert.throws(()=>edit.execute({text:'x'.repeat(5001)}));assert.throws(()=>read.execute({unexpected:true}));
  assert.equal(transcript.value,'MY MESSAGE');
  await window.happyDOM.close();
});
