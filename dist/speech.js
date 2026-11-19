/**
 * Speech to text panel. The microphone is captured here, split into phrases by
 * PhraseDetector, and each phrase is transcribed by Whisper in speech-worker.js.
 * It is separate from app.js, so the fingerspelling app behaves the same
 * whether or not this panel is ever used.
 */
import {PhraseDetector,TARGET_RATE,cleanTranscript,spellWords} from './speech-core.js';

const MAX_LINES=50;
const $=(id)=>document.getElementById(id);
if($('speech-panel'))init();

function init(){
  const toggle=$('speech-toggle'),clear=$('speech-clear'),badge=$('speech-badge');
  const statusEl=$('speech-status'),lines=$('speech-lines'),empty=$('speech-empty');
  // state: 'off' | 'starting' | 'calibrating' | 'listening'
  let state='off',session=0,pending=0,nextId=0;
  let worker=null,modelReady=null,stream=null,context=null,node=null,detector=null;

  const setStatus=(text)=>{statusEl.textContent=text;};

  function render(){
    const on=state==='calibrating'||state==='listening';
    badge.className=`badge ${state==='listening'||pending?'active':''}`;
    badge.textContent=pending?'Transcribing…':state==='listening'?'Listening':state==='calibrating'?'Calibrating':state==='starting'?'Starting…':'Mic off';
    toggle.textContent=on?'Stop listening':state==='starting'?'Cancel':'Start listening';
    toggle.className=`button ${state==='off'?'primary':'secondary'}`;
    clear.disabled=!lines.children.length;
    empty.hidden=!!lines.children.length;
  }

  function loadModel(){
    if(modelReady)return modelReady;
    modelReady=new Promise((resolve,reject)=>{
      worker=new Worker(new URL('./speech-worker.js',import.meta.url),{type:'module'});
      worker.onmessage=({data})=>{
        if(data.type==='progress'){if(state==='starting'&&data.total)setStatus(`Loading the speech model… ${Math.min(100,Math.round(100*data.loaded/data.total))}%`);}
        else if(data.type==='ready')resolve();
        else if(data.type==='error')reject(new Error(data.message));
        else if(data.type==='result')onResult(data);
      };
      worker.onerror=(event)=>reject(new Error(event.message||'The speech worker could not start.'));
      worker.postMessage({type:'load'});
    }).catch((error)=>{
      worker?.terminate();worker=null;modelReady=null;
      throw Object.assign(new Error(error.message),{name:'ModelError'});
    });
    return modelReady;
  }

  async function start(){
    const run=++session;
    state='starting';render();
    try{
      if(!navigator.mediaDevices?.getUserMedia||!window.AudioWorkletNode)throw Object.assign(new Error('unsupported'),{name:'UnsupportedError'});
      setStatus('Waiting for microphone access…');
      const media=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(run!==session){media.getTracks().forEach((track)=>track.stop());return;}
      stream=media;
      stream.getAudioTracks()[0]?.addEventListener('ended',()=>{if(run===session){stop();setStatus('The microphone was disconnected.');}});
      setStatus('Loading the speech model…');
      await loadModel();
      if(run!==session)return;
      context=new AudioContext();
      await context.audioWorklet.addModule(new URL('./mic-worklet.js',import.meta.url));
      if(run!==session)return;
      const rate=context.sampleRate;
      detector=new PhraseDetector(rate);
      node=new AudioWorkletNode(context,'mic-capture');
      node.port.onmessage=({data})=>{if(run===session)handle(detector.push(data),rate);};
      context.createMediaStreamSource(stream).connect(node);
      // The worklet writes no output, so this plays silence. It keeps the node processing in every browser.
      node.connect(context.destination);
      await context.resume();
      if(run!==session)return;
      state='calibrating';setStatus('Stay quiet for a second while it measures the room…');render();
    }catch(error){
      if(run!==session)return;
      stop();setStatus(explain(error));
    }
  }

  function stop(){
    const wasListening=state==='listening',rate=context?.sampleRate;
    session++;
    if(node){node.port.onmessage=null;node.disconnect();}
    if(wasListening&&detector)handle(detector.flush(),rate);
    stream?.getTracks().forEach((track)=>track.stop());
    context?.close().catch(()=>{});
    stream=context=node=detector=null;
    state='off';setStatus('Stopped listening.');render();
  }

  function explain(error){
    if(error.name==='NotAllowedError'||error.name==='SecurityError')return 'Microphone access was denied. Allow it in your browser\'s site settings, then try again.';
    if(error.name==='NotFoundError'||error.name==='OverconstrainedError')return 'No microphone was found. Plug one in and try again.';
    if(error.name==='NotReadableError')return 'The microphone is busy in another app. Close that app and try again.';
    if(error.name==='UnsupportedError')return 'This browser can\'t capture audio here. Use a current Chrome, Edge, or Firefox over http://localhost or HTTPS.';
    if(error.name==='ModelError')return `The speech model couldn't load. Run "npm run setup", then reload this page. (${error.message})`;
    return `Speech to text couldn't start. ${error.message||''}`.trim();
  }

  function handle(events,rate){
    for(const event of events){
      if(event.type==='ready'){state='listening';setStatus('Listening. Each phrase shows up when you pause.');render();}
      else if(event.type==='phrase')transcribe(event.audio,rate);
    }
  }

  async function transcribe(audio,rate){
    pending++;render();
    try{
      const samples=await resample(audio,rate);
      worker.postMessage({type:'transcribe',id:++nextId,audio:samples},[samples.buffer]);
    }catch(error){
      pending--;setStatus(`That phrase couldn't be transcribed. ${error.message||''}`.trim());render();
    }
  }

  function onResult(data){
    pending=Math.max(0,pending-1);
    const text=cleanTranscript(data.text);
    if(text)addLine(text);
    else if(data.error)setStatus(`That phrase couldn't be transcribed. ${data.error}`);
    render();
  }

  // Whisper needs 16 kHz mono. The browser's own resampler handles the filtering.
  async function resample(audio,rate){
    if(rate===TARGET_RATE)return audio;
    const offline=new OfflineAudioContext(1,Math.max(1,Math.ceil(audio.length*TARGET_RATE/rate)),TARGET_RATE);
    const buffer=offline.createBuffer(1,audio.length,rate);
    buffer.copyToChannel(audio,0);
    const source=offline.createBufferSource();
    source.buffer=buffer;source.connect(offline.destination);source.start();
    return (await offline.startRendering()).getChannelData(0).slice();
  }

  function addLine(text){
    const item=document.createElement('li');
    item.className='speech-line';
    const words=document.createElement('p');
    words.className='speech-text';words.textContent=text;

    const actions=document.createElement('div');
    actions.className='speech-actions';
    const add=document.createElement('button');
    add.className='text-button';add.textContent='Add to message';
    add.addEventListener('click',()=>addToMessage(text));
    const spell=document.createElement('button');
    spell.className='text-button';spell.textContent='Fingerspell';
    spell.setAttribute('aria-expanded','false');
    actions.append(add,spell);

    const letters=spellRow(text);
    letters.hidden=true;
    spell.addEventListener('click',()=>{
      letters.hidden=!letters.hidden;
      spell.setAttribute('aria-expanded',String(!letters.hidden));
    });

    item.append(words,actions,letters);
    lines.prepend(item);
    while(lines.children.length>MAX_LINES)lines.lastElementChild.remove();
    render();
  }

  // One chip per letter. Clicking a chip opens that letter in the app's sign guide.
  function spellRow(text){
    const row=document.createElement('div');
    row.className='spell-row';
    for(const word of spellWords(text)){
      const group=document.createElement('span');
      group.className='spell-word';
      for(const letter of word){
        const chip=document.createElement('button');
        chip.className='spell-letter';chip.textContent=letter;
        chip.setAttribute('aria-label',`Show how to sign ${letter}`);
        chip.addEventListener('click',()=>showInGuide(letter));
        group.append(chip);
      }
      row.append(group);
    }
    return row;
  }

  function showInGuide(letter){
    const button=[...($('alphabet-grid')?.children||[])].find((item)=>item.textContent===letter);
    if(!button)return;
    button.click();
    $('sign-guide')?.scrollIntoView({behavior:'smooth',block:'center'});
  }

  // Reuse the existing message box. Firing 'input' lets app.js update the count and Copy button.
  function addToMessage(text){
    const box=$('transcript');
    if(!box)return;
    const separator=box.value&&!/\s$/.test(box.value)?' ':'';
    const room=box.maxLength>0?box.maxLength-box.value.length:Infinity;
    box.value+=(separator+text).slice(0,Math.max(0,room));
    box.dispatchEvent(new Event('input',{bubbles:true}));
    const status=$('transcript-status');
    if(status)status.textContent='Added spoken text to your message.';
  }

  toggle.addEventListener('click',()=>{if(state==='off')start();else stop();});
  clear.addEventListener('click',()=>{lines.replaceChildren();render();});
  window.addEventListener('pagehide',()=>{if(state!=='off')stop();});
  render();
}
