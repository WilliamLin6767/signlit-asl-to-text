// Module worker that runs Whisper with Transformers.js (ONNX Runtime Web, WASM).
// Everything loads from this app's own vendor/ and models/ folders, which
// `npm run setup` fills. Nothing is fetched from a CDN and no audio leaves the device.
//
// Messages in:  {type:'load'}  {type:'transcribe',id,audio:Float32Array at 16 kHz}
// Messages out: {type:'progress',loaded,total}  {type:'ready'}
//               {type:'result',id,text}  {type:'error',message}
const MODEL='Xenova/whisper-base.en';
let transcriber=null,loading=null,queue=Promise.resolve();

async function load(){
  const {pipeline,env}=await import('./vendor/transformers/transformers.min.js');
  env.allowRemoteModels=false;
  env.allowLocalModels=true;
  env.useBrowserCache=false; // Files are local already; skipping the cache avoids stale models.
  env.useWasmCache=false;
  // Relative on purpose: fetch() resolves it against this worker's URL, so hosting
  // under a subdirectory works. Transformers.js 4.x skips its local file checks
  // for http(s) URLs here, which leaves the tokenizer and feature extractor unloaded.
  env.localModelPath='./models/whisper/';
  // Without this the library loads ONNX Runtime from cdn.jsdelivr.net. The loader
  // and binary come from the ONNX Runtime Web build that transformers.min.js is pinned to.
  const ort=new URL('./vendor/transformers/',self.location.href).href;
  env.backends.onnx.wasm.wasmPaths={mjs:`${ort}ort-wasm-simd-threaded.asyncify.mjs`,wasm:`${ort}ort-wasm-simd-threaded.asyncify.wasm`};
  // Progress is counted here rather than with the pipeline's progress_callback:
  // in Transformers.js 4.x that option first GETs every model file to read its
  // size and never cancels those bodies, which downloads the model twice.
  const files=new Map();let reported=-1;
  env.fetch=async(url,init)=>{
    const response=await fetch(url,init);
    const size=Number(response.headers.get('content-length'));
    if(!response.ok||!response.body||!size||!String(url).endsWith('.onnx'))return response;
    const key=String(url);let loaded=0;
    const counted=response.body.pipeThrough(new TransformStream({transform(chunk,controller){
      loaded+=chunk.byteLength;files.set(key,[loaded,size]);
      let sum=0,total=0;
      for(const [l,t] of files.values()){sum+=l;total+=t;}
      const percent=Math.floor(100*sum/total);
      if(percent!==reported){reported=percent;self.postMessage({type:'progress',loaded:sum,total});}
      controller.enqueue(chunk);
    }}));
    return new Response(counted,{status:response.status,statusText:response.statusText,headers:response.headers});
  };
  transcriber=await pipeline('automatic-speech-recognition',MODEL,{dtype:'q8',device:'wasm'});
}

self.onmessage=({data})=>{
  if(data.type==='load'){
    loading??=load();
    loading.then(()=>self.postMessage({type:'ready'}),
      (error)=>{loading=null;self.postMessage({type:'error',message:String(error?.message||error)});});
  }else if(data.type==='transcribe'){
    // One phrase at a time, in the order they were spoken.
    queue=queue.then(async()=>{
      try{
        if(!transcriber)throw new Error('The speech model is not loaded.');
        const output=await transcriber(data.audio);
        self.postMessage({type:'result',id:data.id,text:String(output?.text??'')});
      }catch(error){
        self.postMessage({type:'result',id:data.id,text:'',error:String(error?.message||error)});
      }
    });
  }
};
