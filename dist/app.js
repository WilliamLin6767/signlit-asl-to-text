import {LABELS,STATIC_LABELS,SIGN_GUIDE,CONNECTIONS,LetterDecoder,insertText} from './core.js';
const $=(id)=>document.getElementById(id);
const video=$('webcam'),overlay=$('overlay'),transcript=$('transcript');
const decoder=new LetterDecoder();
let worker=null,readyPromise=null,stream=null,mode='idle',busy=false,runId=0,current=null,lastLetter=null;
let frameRequest=0,lastVideoTime=-1,lastSent=0,sampleTimer=0,sampleStarted=0,samples=null,sampleIndex=-1;
let disposed=false;
const requestWaiters=new Map();
const status=(text)=>{$('transcript-status').textContent=text;};
function showError(text){$('error-message').textContent=text;$('error-message').hidden=!text;}
function refreshText(){
  const n=transcript.value.length;$('letter-count').textContent=`${n} character${n===1?'':'s'}`;
  $('copy-text').disabled=!n;
}
function addText(text,message){
  const focused=document.activeElement===transcript;
  const start=focused?transcript.selectionStart:transcript.value.length;
  const end=focused?transcript.selectionEnd:transcript.value.length;
  const next=insertText(transcript.value,start,end,text);
  if(next.text===transcript.value){status('Your message has reached 5,000 characters.');return;}
  transcript.value=next.text;transcript.setSelectionRange(next.cursor,next.cursor);refreshText();
  if(/^[A-Z]$/.test(text)){lastLetter=text;$('repeat-letter').disabled=false;}
  status(message||`Added ${text===' '?'a space':text}`);
}
function showMode(next){
  mode=next;const active=['camera','sample'].includes(next),loading=next==='loading';
  $('camera-empty').hidden=active;$('camera-toolbar').hidden=!active;
  video.hidden=next!=='camera';$('sample-image').hidden=next!=='sample';
  $('viewfinder').classList.toggle('sample',next==='sample');
  $('camera-badge').className=`badge ${next==='camera'?'active':next==='sample'?'demo':''}`;
  $('camera-badge').textContent=next==='camera'?'Camera on':next==='sample'?'Recorded sample':loading?'Starting…':'Camera off';
  $('start-camera').disabled=loading;$('sample-button').disabled=loading;
  $('start-camera').innerHTML=`<svg class="icon" aria-hidden="true"><use href="#camera-icon"/></svg>${loading?'Loading recognition…':'Start camera'}`;
}
function clearOverlay(){const ctx=overlay.getContext('2d');ctx.clearRect(0,0,overlay.width,overlay.height);}
function drawHand(landmarks,width,height){
  overlay.width=width;overlay.height=height;clearOverlay();
  if(!landmarks||!$('show-landmarks').checked)return;
  const ctx=overlay.getContext('2d');ctx.strokeStyle='#c8f578';ctx.lineWidth=Math.max(2,width/400);ctx.fillStyle='#dcffaa';
  ctx.lineJoin='round';ctx.lineCap='round';
  for(const[a,b]of CONNECTIONS){ctx.beginPath();ctx.moveTo(landmarks[a].x*width,landmarks[a].y*height);ctx.lineTo(landmarks[b].x*width,landmarks[b].y*height);ctx.stroke();}
  for(const p of landmarks){ctx.beginPath();ctx.arc(p.x*width,p.y*height,Math.max(3,width/200),0,Math.PI*2);ctx.fill();}
}
function renderResult(result){
  if(!['camera','sample'].includes(mode)||result.id!==runId)return;
  const {landmarks,candidates,latency}=result;current=candidates[0]||null;
  // Process timestamps when results arrive, preventing slow inference from accumulating hidden hold time.
  const decoded=decoder.update(landmarks?current:null,performance.now());
  const allowed=!!current&&STATIC_LABELS.includes(current.label)&&current.confidence>=decoder.threshold;
  $('prediction-letter').textContent=current?.label||'—';
  $('confidence-label').textContent=current?`${Math.round(current.confidence*100)}%`:'—';
  $('confidence-bar').style.width=`${current?current.confidence*100:0}%`;
  $('hold-bar').style.width=`${decoded.progress*100}%`;
  $('latency-label').textContent=`${Math.round(latency)} ms`;
  $('tracking-label').textContent=landmarks?'Hand detected':'Looking for a hand';
  $('prediction-status').textContent=!landmarks?'Show one hand':decoded.reason==='motion-letter'?'Motion letter: add manually':allowed?'Recognizing your sign':'Try adjusting your hand';
  $('hold-label').textContent={
    'no-hand':'Hold a sign to add a letter','motion-letter':'J & Z require motion; use the sign guide',
    uncertain:'Below the minimum model score',holding:$('auto-add').checked?'Hold steady…':'Ready to add manually',
    added:$('auto-add').checked?'Letter added':'Ready to add manually','already-added':'Lower your hand to repeat this letter',
  }[decoded.reason];
  $('candidates').replaceChildren(...candidates.map((candidate)=>{
    const el=document.createElement('span');el.className='candidate';
    const label=document.createElement('b');label.textContent=candidate.label;el.append(label,` ${Math.round(candidate.confidence*100)}%`);return el;
  }));
  if(!candidates.length){const el=document.createElement('span');el.className='muted';el.textContent='Predictions appear here as you sign.';$('candidates').append(el);}
  $('add-current').disabled=!allowed;
  if(decoded.commit&&$('auto-add').checked)addText(decoded.commit,mode==='sample'?`Sample recognized ${decoded.commit}`:`Recognized ${decoded.commit}`);
  if(mode==='camera')drawHand(landmarks,video.videoWidth,video.videoHeight);
  else if(samples&&sampleIndex>=0)drawHand(landmarks,samples.frames[sampleIndex].width,samples.frames[sampleIndex].height);
}
function initRecognition(){
  if(readyPromise)return readyPromise;
  readyPromise=new Promise((resolve,reject)=>{
    let settled=false;
    const timeout=setTimeout(()=>fail(new Error('Recognition took too long to load. Check your connection and try again.')),90000);
    const fail=(error)=>{
      if(!settled){settled=true;clearTimeout(timeout);reject(error);}
      else if(mode!=='idle'){stop();showError('Recognition stopped unexpectedly. Please try again.');}
      for(const waiter of requestWaiters.values())waiter.reject(error);requestWaiters.clear();
      worker?.terminate();worker=null;readyPromise=null;
    };
    try{
      if(!window.Worker||!window.OffscreenCanvas)throw new Error('This browser does not support local recognition. Try a current Chrome, Edge, or Firefox browser.');
      worker=new Worker(new URL('./vision-worker.js',import.meta.url));
      worker.onmessage=({data})=>{
        if(data.type==='ready'){settled=true;clearTimeout(timeout);resolve();return;}
        if(data.type==='error'){console.warn('Recognition worker:',data.message);fail(new Error('The recognition model could not load. Check your connection and try again.'));return;}
        if(data.type==='result'){busy=false;renderResult(data);const waiting=requestWaiters.get(data.id);waiting?.resolve(data);requestWaiters.delete(data.id);}
      };
      worker.onerror=()=>fail(new Error('The recognition files could not load. Refresh the page or check your connection.'));
      worker.postMessage({type:'init'});
    }catch(error){fail(error);}
  });
  return readyPromise;
}
async function tick(timestamp){
  if(mode!=='camera')return;
  frameRequest=requestAnimationFrame(tick);
  if(document.hidden||busy||video.readyState<2||video.currentTime===lastVideoTime||timestamp-lastSent<65)return;
  busy=true;const id=runId;lastVideoTime=video.currentTime;lastSent=timestamp;
  try{
    const bitmap=await createImageBitmap(video);
    if(mode!=='camera'||id!==runId){bitmap.close();busy=false;return;}
    worker.postMessage({type:'frame',bitmap,timestamp:performance.now(),id},[bitmap]);
  }catch(error){busy=false;stop();showError('Could not read the camera frame. Please try again.');}
}
function stop(){
  runId++;cancelAnimationFrame(frameRequest);clearTimeout(sampleTimer);frameRequest=0;
  stream?.getTracks().forEach((track)=>track.stop());stream=null;video.pause();video.srcObject=null;
  busy=false;current=null;decoder.reset();worker?.postMessage({type:'reset'});showMode('idle');clearOverlay();
  $('prediction-letter').textContent='—';$('confidence-label').textContent='—';$('prediction-status').textContent='Ready when you are';
  $('confidence-bar').style.width='0%';$('hold-bar').style.width='0%';$('hold-label').textContent='Hold a sign to add a letter';
  $('latency-label').textContent='';$('add-current').disabled=true;
}
function cameraError(error){
  const messages={NotAllowedError:'Camera access was denied. Allow camera access in your browser, then try again. You can also try the recorded sample.',NotFoundError:'No camera was found. Connect a webcam or try the recorded sample.',NotReadableError:'Your camera is busy. Close other apps using it, then try again.',OverconstrainedError:'This camera cannot use the requested settings. Try another camera.',SecurityError:'Camera access is blocked by this browser. Open the app over HTTPS or localhost.'};
  return messages[error.name]||error.message||'Could not start the camera. Please try again.';
}
async function startCamera(){
  stop();showError('');showMode('loading');const id=runId;
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access needs HTTPS or localhost and a compatible browser.');
    // Ask for camera permission first, while the action clearly belongs to the user's click.
    const acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:640},height:{ideal:480}}});
    if(disposed||id!==runId){acquired.getTracks().forEach((track)=>track.stop());return;}
    stream=acquired;video.srcObject=stream;
    const loading=initRecognition();await video.play();await loading;
    if(disposed||id!==runId)return;
    stream.getVideoTracks()[0]?.addEventListener('ended',()=>{if(mode==='camera'){stop();showError('Camera access ended. Start the camera again to continue.');}});
    showMode('camera');lastVideoTime=-1;lastSent=0;frameRequest=requestAnimationFrame(tick);status('Camera ready. Sign your first letter.');
  }catch(error){if(id===runId){stop();showError(cameraError(error));}}
}
async function loadSamples(){
  if(samples)return samples;
  const response=await fetch('./samples/sequence.json');if(!response.ok)throw new Error('The recorded sample could not load. Please try again.');
  const data=await response.json();
  if(!Array.isArray(data.frames)||!data.frames.length)throw new Error('No recorded sample is available.');
  samples=data;return data;
}
async function runSample(){
  stop();showError('');showMode('loading');const id=runId;
  try{
    const [data]=await Promise.all([loadSamples(),initRecognition()]);
    if(id!==runId)return;sampleStarted=performance.now();sampleIndex=-1;showMode('sample');
    status('Recorded sample running. These are model predictions.');
    const advance=()=>{
      if(mode!=='sample'||id!==runId)return;
      const elapsed=performance.now()-sampleStarted;
      let cursor=0,index=-1;
      for(let i=0;i<data.frames.length;i++){cursor+=data.frames[i].durationMs;if(elapsed<cursor){index=i;break;}}
      if(index<0){stop();status('Sample finished. Start the camera to sign your own message.');return;}
      const frame=data.frames[index];
      if(index!==sampleIndex){sampleIndex=index;$('sample-image').src=`./samples/${frame.image}`;$('sample-image').alt=frame.landmarks?'Recorded handshape from the ASL Dataset':'Pause between recorded handshapes';}
      if(!busy){busy=true;worker.postMessage({type:'sample',id,timestamp:performance.now(),landmarks:frame.landmarks,width:frame.width,height:frame.height});}
      sampleTimer=setTimeout(advance,85);
    };advance();
  }catch(error){if(id===runId){stop();showError(error.message);}}
}

$('start-camera').addEventListener('click',startCamera);
$('stop-camera').addEventListener('click',()=>{stop();status('Camera stopped. Your message is still here.');});
$('sample-button').addEventListener('click',runSample);
transcript.addEventListener('input',()=>{refreshText();status('Message updated.');});
$('add-space').addEventListener('click',()=>addText(' '));
$('repeat-letter').addEventListener('click',()=>{if(lastLetter)addText(lastLetter,`Repeated ${lastLetter}`);});
$('add-current').addEventListener('click',()=>{
  if(current&&STATIC_LABELS.includes(current.label)&&current.confidence>=decoder.threshold){addText(current.label);decoder.lastCommitted=current.label;}
});
$('backspace').addEventListener('click',()=>{
  if(!transcript.value)return;
  const focused=document.activeElement===transcript;const end=focused?transcript.selectionEnd:transcript.value.length;
  const start=focused&&transcript.selectionStart!==end?transcript.selectionStart:Math.max(0,end-1);
  const next=insertText(transcript.value,start,end,'');transcript.value=next.text;transcript.setSelectionRange(next.cursor,next.cursor);refreshText();status('Deleted previous character.');
});
$('clear-text').addEventListener('click',()=>{transcript.value='';lastLetter=null;$('repeat-letter').disabled=true;refreshText();status('Message cleared.');});
$('copy-text').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(transcript.value);status('Copied to clipboard.');}
  catch{transcript.focus();transcript.select();status('Press Ctrl+C or ⌘C to copy your selected message.');}
});
$('hold-time').addEventListener('input',()=>{decoder.holdMs=Number($('hold-time').value);$('hold-value').textContent=`${(decoder.holdMs/1000).toFixed(1)} s`;decoder.reset();});
$('confidence-threshold').addEventListener('input',()=>{decoder.threshold=Number($('confidence-threshold').value)/100;$('threshold-value').textContent=`${Math.round(decoder.threshold*100)}%`;decoder.reset();});
$('auto-add').addEventListener('change',()=>{decoder.reset();status($('auto-add').checked?'Letters will be added after you hold a sign.':'Use Add current letter to add each prediction.');});
// Keep the textarea selection when clicking an editing control with the mouse.
for(const button of document.querySelectorAll('.text-controls button'))button.addEventListener('mousedown',(event)=>{if(document.activeElement===transcript)event.preventDefault();});
$('show-landmarks').addEventListener('change',()=>{if(!$('show-landmarks').checked)clearOverlay();});

function selectGuide(letter){
  $('guide-letter').textContent=letter;
  for(const button of $('alphabet-grid').children)button.setAttribute('aria-pressed',String(button.textContent===letter));
  $('guide-description').replaceChildren(document.createTextNode(SIGN_GUIDE[letter]));
  if(['J','Z'].includes(letter)){
    const button=document.createElement('button');button.className='button secondary';button.textContent=`Add ${letter}`;
    button.addEventListener('click',()=>addText(letter,`Added ${letter} manually`));$('guide-description').append(button);
  }
}
for(const letter of LABELS){
  const button=document.createElement('button');button.className=`alphabet-button ${['J','Z'].includes(letter)?'motion':''}`;
  button.textContent=letter;button.setAttribute('aria-label',`${letter}: ${['J','Z'].includes(letter)?'motion letter, manual entry':'handshape guide'}`);
  button.setAttribute('aria-pressed',String(letter==='A'));button.addEventListener('click',()=>selectGuide(letter));$('alphabet-grid').append(button);
}
document.addEventListener('keydown',(event)=>{
  if(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement||event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.code==='Space'&&event.target===document.body){event.preventDefault();addText(' ');}
  if(event.key.toLowerCase()==='r'&&lastLetter&&event.target===document.body){event.preventDefault();addText(lastLetter,`Repeated ${lastLetter}`);}
  if(event.key==='Escape'&&mode!=='idle'){stop();status('Recognition stopped.');}
});
document.addEventListener('visibilitychange',()=>{decoder.reset();worker?.postMessage({type:'reset'});});
window.addEventListener('pagehide',()=>{disposed=true;stop();worker?.terminate();worker=null;readyPromise=null;});
window.addEventListener('pageshow',()=>{disposed=false;});
refreshText();

// Feature-detect the proposed WebMCP API. It uses the exact same transcript state as the UI.
const context=document.modelContext;
if(context?.registerTool){
  const lifecycle=new AbortController();
  const tools=[{
    name:'read_transcript',title:'Read Signlit transcript',description:'Read the current visible transcript and whether recognition is running. Does not access video.',
    inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},
    execute(input){if(input===null||typeof input!=='object'||Object.keys(input).length)throw new TypeError('Expected an empty object.');return{text:transcript.value,mode};},
  },{
    name:'replace_transcript',title:'Edit Signlit transcript',description:'Replace the visible text message. Does not start the camera or send text anywhere.',
    inputSchema:{type:'object',properties:{text:{type:'string',maxLength:5000}},required:['text'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},
    execute(input){if(!input||typeof input.text!=='string'||input.text.length>5000||Object.keys(input).some((k)=>k!=='text'))throw new TypeError('Expected text of at most 5,000 characters.');transcript.value=input.text;refreshText();status('Message updated.');return{text:transcript.value};},
  }];
  for(const tool of tools)try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
