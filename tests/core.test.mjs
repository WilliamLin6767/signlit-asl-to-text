import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLandmarks,softmax,LetterDecoder,insertText,STATIC_LABELS} from '../dist/core.js';

const hand=Array.from({length:21},(_,i)=>({x:.2+(i%5)*.04,y:.2+Math.floor(i/5)*.04,z:0}));
test('normalization preserves pixel geometry at different aspect ratios',()=>{
  const a=normalizeLandmarks(hand,640,480);
  const samePixels=hand.map((p)=>({...p,x:p.x*2,y:p.y*1.5}));
  const b=normalizeLandmarks(samePixels,320,320);
  a.forEach((p,i)=>p.forEach((v,j)=>assert.ok(Math.abs(v-b[i][j])<1e-9)));
  const axes=[0,1].map((axis)=>Math.max(...a.map((p)=>p[axis]))-Math.min(...a.map((p)=>p[axis])));
  assert.ok(Math.abs(Math.max(...axes)-.7)<1e-9);
});
test('normalization rejects malformed and degenerate hands',()=>{
  assert.throws(()=>normalizeLandmarks(hand.slice(1),640,480));
  assert.throws(()=>normalizeLandmarks(hand.map(()=>({x:.5,y:.5})),640,480));
  assert.throws(()=>normalizeLandmarks(hand.map(()=>({x:NaN,y:.5})),640,480));
});
test('softmax stays finite for large logits and preserves all class probability',()=>{
  const logits=Array(26).fill(-1000);logits[11]=1000;
  const p=softmax(logits);assert.equal(p[0].label,'L');assert.equal(p[0].confidence,1);
  assert.ok(Math.abs(p.reduce((a,b)=>a+b.confidence,0)-1)<1e-8);
  assert.throws(()=>softmax([1,2,3]));
});
const sign=(label='A',confidence=.9)=>({label,confidence});
function hold(d,label,start=0,end=1000){const results=[];for(let t=start;t<=end;t+=100)results.push(d.update(sign(label),t));return results;}
test('a held sign commits only once and cannot spray repeated characters',()=>{
  const d=new LetterDecoder();const r=hold(d,'A',0,2000);
  assert.deepEqual(r.filter((p)=>p.commit).map((p)=>p.commit),['A']);
});
test('another held sign may commit without lifting the hand',()=>{
  const d=new LetterDecoder();hold(d,'A',0,1000);
  const results=hold(d,'B',1100,2200);assert.deepEqual(results.filter((p)=>p.commit).map((p)=>p.commit),['B']);
});
test('a sustained hand release allows a doubled letter',()=>{
  const d=new LetterDecoder();hold(d,'L',0,1000);
  for(let t=1100;t<=1500;t+=100)d.update(null,t);
  const r=hold(d,'L',1600,2600);assert.deepEqual(r.filter((p)=>p.commit).map((p)=>p.commit),['L']);
});
test('one missing frame cannot unlock a repeated letter',()=>{
  const d=new LetterDecoder();hold(d,'L',0,1000);d.update(null,1100);
  assert.equal(hold(d,'L',1200,2500).filter((p)=>p.commit).length,0);
});
test('low confidence and motion-only letters never commit',()=>{
  const d=new LetterDecoder();
  for(let t=0;t<2000;t+=100)assert.equal(d.update(sign('M',.6),t).commit,null);
  for(const label of ['J','Z'])for(let t=2100;t<4100;t+=100)assert.equal(d.update(sign(label),t).commit,null);
  assert.equal(STATIC_LABELS.length,24);
});
test('a stalled stream cannot satisfy the hold time or impersonate release',()=>{
  const d=new LetterDecoder();d.update(sign(),0);d.update(sign(),100);
  assert.equal(d.update(sign(),5000).commit,null);assert.equal(d.update(sign(),5000).progress,0);
  hold(d,'A',5100,6100);d.update(null,6200);d.update(null,10000);
  assert.equal(hold(d,'A',10100,11200).filter((p)=>p.commit).length,0);
});
test('changing the handshape resets the candidate hold timer',()=>{
  const d=new LetterDecoder();hold(d,'A',0,600);
  const r=hold(d,'B',700,1200);assert.equal(r.filter((p)=>p.commit).length,0);
});
test('text insertion replaces selection and respects a character limit',()=>{
  assert.deepEqual(insertText('HELLO',1,4,'I'),{text:'HIO',cursor:2});
  assert.deepEqual(insertText('HELLO',5,5,' WORLD',8),{text:'HELLO WO',cursor:8});
  assert.deepEqual(insertText('HELLO',4,5,''),{text:'HELL',cursor:4});
});
