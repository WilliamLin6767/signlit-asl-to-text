// This is a classic worker: MediaPipe 0.10.21 loads its WASM factory using
// importScripts(), which browsers prohibit inside module workers.
// Dynamic import still lets the application use shared ES modules below.
let handLandmarker,session,ort,normalizeLandmarks,softmax,renderModelInput;
const canvas=new OffscreenCanvas(192,192);
let previousPoints=null,previousTime=0;
let lastMediaPipeTimestamp=0;

async function initialize() {
  const core=await import('./core.js');
  const renderer=await import('./renderer.js');
  ({normalizeLandmarks,softmax}=core);({renderModelInput}=renderer);
  const vision=await import('./vendor/mediapipe/vision_bundle.mjs');
  ort=await import('./vendor/ort/ort.wasm.min.mjs');
  ort.env.wasm.wasmPaths=new URL('./vendor/ort/',self.location.href).href;
  ort.env.wasm.numThreads=1;
  ort.env.wasm.proxy=false;
  const fileset=await vision.FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm/',self.location.href).href);
  handLandmarker=await vision.HandLandmarker.createFromOptions(fileset,{
    baseOptions:{modelAssetPath:new URL('./models/hand_landmarker.task',self.location.href).href,delegate:'CPU'},
    runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.6,minHandPresenceConfidence:.6,minTrackingConfidence:.6,
  });
  session=await ort.InferenceSession.create(new URL('./models/asl_cnn_model.onnx',self.location.href).href,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
  postMessage({type:'ready'});
}

async function classify(landmarks,width,height,timestamp) {
  const points=normalizeLandmarks(landmarks,width,height);
  // Short time-aware smoothing. Do not mix two different hands after a missing frame.
  const gap=timestamp-previousTime;
  const alpha=1-Math.exp(-Math.max(1,gap)/35);
  const smoothed=previousPoints&&gap>0&&gap<250?points.map((p,i)=>p.map((v,j)=>alpha*v+(1-alpha)*previousPoints[i][j])):points;
  previousPoints=smoothed;previousTime=timestamp;
  const pixels=renderModelInput(smoothed,canvas);
  const feeds={[session.inputNames[0]]:new ort.Tensor('float32',pixels,[1,96,96,3])};
  const output=await session.run(feeds,['logits']);
  const candidates=softmax(output.logits.data).slice(0,3);
  Object.values(output).forEach((tensor)=>tensor.dispose?.());
  feeds[session.inputNames[0]].dispose?.();
  return candidates;
}

async function handleMessage({data}) {
  const {type,bitmap,timestamp,id}=data;
  try{
    if(type==='init'){await initialize();return;}
    if(type==='reset'){previousPoints=null;previousTime=0;return;}
    const started=performance.now();
    let landmarks=data.landmarks,width=data.width,height=data.height;
    if(type==='frame'){
      width=bitmap.width;height=bitmap.height;
      // MediaPipe VIDEO timestamps must remain monotonic across restarts.
      lastMediaPipeTimestamp=Math.max(timestamp,lastMediaPipeTimestamp+1);
      const result=handLandmarker.detectForVideo(bitmap,lastMediaPipeTimestamp);
      landmarks=result.landmarks[0];
    }
    if(!landmarks){previousPoints=null;postMessage({type:'result',id,landmarks:null,candidates:[],timestamp,latency:performance.now()-started});return;}
    const candidates=await classify(landmarks,width,height,timestamp);
    postMessage({type:'result',id,landmarks,candidates,timestamp,latency:performance.now()-started});
  }catch(error){postMessage({type:'error',id,message:error instanceof Error?error.message:String(error)});}
  finally{bitmap?.close();}
}
// Keep inference and resets ordered even if the user stops and restarts quickly.
let messageQueue=Promise.resolve();
self.onmessage=(event)=>{messageQueue=messageQueue.then(()=>handleMessage(event));};
