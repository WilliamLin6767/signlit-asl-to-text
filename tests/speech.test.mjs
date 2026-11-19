import test from 'node:test';
import assert from 'node:assert/strict';
import {PhraseDetector,cleanTranscript,spellWords,rms,median,TARGET_RATE} from '../dist/speech-core.js';

const RATE=TARGET_RATE;
// Deterministic noise so the tests never flake.
function noise(seconds,amplitude,seed=1){
  let state=seed;
  const out=new Float32Array(Math.round(seconds*RATE));
  for(let i=0;i<out.length;i++){state=(state*1664525+1013904223)>>>0;out[i]=(state/2**32*2-1)*amplitude;}
  return out;
}
const QUIET=0.002,LOUD=0.2;
// Feed in uneven chunks, like a real audio callback does.
function run(detector,...segments){
  const events=[];
  for(const segment of segments)for(let i=0;i<segment.length;i+=1000)events.push(...detector.push(segment.subarray(i,i+1000)));
  return events;
}
const phrases=(events)=>events.filter((e)=>e.type==='phrase');
const seconds=(event)=>event.audio.length/RATE;

test('rms and median are computed correctly',()=>{
  assert.equal(rms(new Float32Array([0.5,-0.5,0.5,-0.5])),0.5);
  assert.equal(rms(new Float32Array(0)),0);
  assert.equal(median([3,1,2]),2);assert.equal(median([4,1,3,2]),2.5);assert.equal(median([]),0);
});

test('calibration sets a threshold above the room noise before listening',()=>{
  const detector=new PhraseDetector(RATE);
  assert.deepEqual(run(detector,noise(0.9,QUIET)),[]);
  const events=run(detector,noise(0.2,QUIET));
  assert.equal(events.length,1);assert.equal(events[0].type,'ready');
  assert.ok(events[0].threshold>=0.004&&events[0].threshold<LOUD/3);
});

test('a noisy room raises the threshold, and talking during calibration cannot push it out of reach',()=>{
  const noisy=run(new PhraseDetector(RATE),noise(1.1,0.02))[0].threshold;
  const quiet=run(new PhraseDetector(RATE),noise(1.1,QUIET))[0].threshold;
  assert.ok(noisy>quiet);
  assert.equal(run(new PhraseDetector(RATE),noise(1.1,0.5))[0].threshold,0.06);
});

test('a phrase is emitted after a pause, with its start kept and long silence trimmed',()=>{
  const detector=new PhraseDetector(RATE);
  const events=run(detector,noise(1.1,QUIET),noise(1.5,LOUD),noise(1.5,QUIET));
  assert.deepEqual(events.map((e)=>e.type),['ready','speech-start','phrase']);
  const length=seconds(phrases(events)[0]);
  // 1.5 s of speech + up to 0.3 s before it + 0.24 s after it.
  assert.ok(length>1.6&&length<2.15,`unexpected phrase length ${length}`);
});

test('a short pause inside a sentence does not split it',()=>{
  const detector=new PhraseDetector(RATE);
  const events=run(detector,noise(1.1,QUIET),noise(1,LOUD),noise(0.4,QUIET),noise(1,LOUD),noise(1.2,QUIET));
  assert.equal(phrases(events).length,1);
  assert.ok(seconds(phrases(events)[0])>2.4);
});

test('clicks and bumps are ignored, and the next real phrase still works',()=>{
  const detector=new PhraseDetector(RATE);
  const events=run(detector,noise(1.1,QUIET),noise(0.06,LOUD),noise(1.2,QUIET),noise(1,LOUD),noise(1.2,QUIET));
  assert.equal(phrases(events).length,1);
  assert.ok(seconds(phrases(events)[0])>1.1);
});

test('silence alone produces nothing',()=>{
  assert.equal(phrases(run(new PhraseDetector(RATE),noise(6,QUIET))).length,0);
});

test('nonstop talking is cut into chunks no longer than the limit',()=>{
  const detector=new PhraseDetector(RATE,{maxPhraseMs:3000});
  const events=run(detector,noise(1.1,QUIET),noise(7,LOUD),noise(1.2,QUIET));
  assert.equal(phrases(events).length,3);
  for(const phrase of phrases(events))assert.ok(seconds(phrase)<=3.01);
});

test('flush returns the sentence in progress when the mic stops, and nothing otherwise',()=>{
  const detector=new PhraseDetector(RATE);
  run(detector,noise(1.1,QUIET),noise(1,LOUD));
  const flushed=detector.flush();
  assert.equal(flushed.length,1);assert.ok(seconds(flushed[0])>0.9);
  assert.deepEqual(detector.flush(),[]);
  const idle=new PhraseDetector(RATE);run(idle,noise(2,QUIET));
  assert.deepEqual(idle.flush(),[]);
});

test('other sample rates give the same phrase timing',()=>{
  const rate=48000,detector=new PhraseDetector(rate);
  const make=(s,a)=>{const out=new Float32Array(Math.round(s*rate));for(let i=0;i<out.length;i++)out[i]=(i%2?a:-a);return out;};
  const events=[...detector.push(make(1.1,QUIET)),...detector.push(make(1.5,LOUD)),...detector.push(make(1.5,QUIET))];
  assert.equal(phrases(events).length,1);
  const length=phrases(events)[0].audio.length/rate;
  assert.ok(length>1.6&&length<2.15);
  assert.throws(()=>new PhraseDetector(0));
});

test('cleanTranscript removes non-speech tags and empty results',()=>{
  assert.equal(cleanTranscript('  Hello,  my name is William. '),'Hello, my name is William.');
  assert.equal(cleanTranscript('[BLANK_AUDIO]'),'');
  assert.equal(cleanTranscript(' (music) '),'');
  assert.equal(cleanTranscript('Okay [laughs] sure.'),'Okay sure.');
  assert.equal(cleanTranscript('...'),'');assert.equal(cleanTranscript(null),'');
  assert.equal(cleanTranscript('Room 12'),'Room 12');
});

test('spellWords keeps only A–Z letters grouped by word',()=>{
  assert.deepEqual(spellWords('Nice to meet you!'),['NICE','TO','MEET','YOU']);
  assert.deepEqual(spellWords("It's 9 o'clock"),['ITS','OCLOCK']);
  assert.deepEqual(spellWords(''),[]);
});
