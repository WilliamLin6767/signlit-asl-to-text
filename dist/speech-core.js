/**
 * Speech to text logic with no browser dependencies, so it can be unit tested.
 * PhraseDetector turns a stream of microphone samples into spoken phrases:
 * it measures the room for a second, starts recording when the volume rises
 * above that, and ends the phrase after a pause.
 */
export const TARGET_RATE=16000; // Whisper's input sample rate.
export const DEFAULTS=Object.freeze({
  blockMs:30,        // analysis block size
  calibrateMs:1000,  // room noise measurement before listening
  prerollMs:300,     // audio kept from before speech started, so first words are not clipped
  silenceMs:800,     // pause that ends a phrase
  minVoicedMs:300,   // shorter bursts are clicks or bumps and are dropped
  tailMs:240,        // silence kept at the end of a phrase
  maxPhraseMs:28000, // Whisper reads at most 30 seconds at a time
  sensitivity:3,     // threshold = room noise x this
  minThreshold:0.004,
  maxThreshold:0.06
});

export function rms(samples){
  let sum=0;
  for(let i=0;i<samples.length;i++)sum+=samples[i]*samples[i];
  return Math.sqrt(sum/(samples.length||1));
}

export function median(values){
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b),mid=sorted.length>>1;
  return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
}

function join(blocks){
  const out=new Float32Array(blocks.reduce((n,b)=>n+b.length,0));
  let offset=0;
  for(const block of blocks){out.set(block,offset);offset+=block.length;}
  return out;
}

export class PhraseDetector{
  constructor(sampleRate,options={}){
    if(!Number.isFinite(sampleRate)||sampleRate<=0)throw new Error('A positive sample rate is required.');
    const o={...DEFAULTS,...options};
    const blocks=(ms)=>Math.max(1,Math.round(ms/o.blockMs));
    this.options=o;this.sampleRate=sampleRate;
    this.blockSize=Math.max(1,Math.round(sampleRate*o.blockMs/1000));
    this.calibrateBlocks=blocks(o.calibrateMs);this.prerollBlocks=blocks(o.prerollMs);
    this.silenceBlocks=blocks(o.silenceMs);this.minVoicedBlocks=blocks(o.minVoicedMs);
    this.tailBlocks=blocks(o.tailMs);this.maxBlocks=blocks(o.maxPhraseMs);
    this.block=new Float32Array(this.blockSize);this.fill=0;
    this.noise=[];this.threshold=null;
    this.preroll=[];this.speech=[];this.talking=false;this.quiet=0;this.voiced=0;
  }

  /**
   * Feed any number of samples. Returns the events they caused, in order:
   *   {type:'ready',threshold}  calibration finished, now listening
   *   {type:'speech-start'}     someone started talking
   *   {type:'phrase',audio}     a finished phrase as a Float32Array at sampleRate
   */
  push(samples){
    const events=[];
    let offset=0;
    while(offset<samples.length){
      const take=Math.min(this.blockSize-this.fill,samples.length-offset);
      this.block.set(samples.subarray(offset,offset+take),this.fill);
      this.fill+=take;offset+=take;
      if(this.fill===this.blockSize){this.#consume(this.block.slice(),events);this.fill=0;}
    }
    return events;
  }

  /** Call when the mic stops. Returns a final phrase event if someone was mid-sentence. */
  flush(){
    const events=[];
    if(this.talking&&this.voiced>=this.minVoicedBlocks)events.push({type:'phrase',audio:join(this.speech)});
    this.talking=false;this.speech=[];this.preroll=[];this.quiet=0;this.voiced=0;this.fill=0;
    return events;
  }

  #consume(block,events){
    const level=rms(block);
    if(this.threshold===null){
      this.noise.push(level);
      if(this.noise.length>=this.calibrateBlocks){
        const o=this.options;
        this.threshold=Math.min(o.maxThreshold,Math.max(o.minThreshold,median(this.noise)*o.sensitivity));
        events.push({type:'ready',threshold:this.threshold});
      }
      return;
    }
    const loud=level>this.threshold;
    if(!this.talking){
      this.preroll.push(block);
      if(this.preroll.length>this.prerollBlocks)this.preroll.shift();
      if(loud){
        this.talking=true;this.speech=this.preroll;this.preroll=[];this.quiet=0;this.voiced=1;
        events.push({type:'speech-start'});
      }
      return;
    }
    this.speech.push(block);
    this.quiet=loud?0:this.quiet+1;
    if(loud)this.voiced++;
    if(this.quiet>=this.silenceBlocks||this.speech.length>=this.maxBlocks){
      const keep=Math.min(this.speech.length,this.speech.length-this.quiet+this.tailBlocks);
      if(this.voiced>=this.minVoicedBlocks)events.push({type:'phrase',audio:join(this.speech.slice(0,keep))});
      this.talking=false;this.speech=[];this.quiet=0;this.voiced=0;
    }
  }
}

/**
 * Tidy Whisper output. Whisper labels non-speech sounds like [BLANK_AUDIO] or
 * (music); those are removed, and a result with no letters or digits is dropped.
 */
export function cleanTranscript(text){
  const cleaned=String(text??'').replace(/\[[^\]]*\]|\([^)]*\)/g,' ').replace(/\s+/g,' ').trim();
  return /[\p{L}\p{N}]/u.test(cleaned)?cleaned:'';
}

/** Uppercase A–Z words for the fingerspelling row: "Nice to meet you!" -> ["NICE","TO","MEET","YOU"]. */
export function spellWords(text){
  return String(text??'').toUpperCase().split(/\s+/).map((word)=>word.replace(/[^A-Z]/g,'')).filter(Boolean);
}
