// AudioWorklet that forwards microphone samples to the page in ~2048-sample chunks.
// It runs on the audio thread, so it only copies samples and does no analysis.
class MicCapture extends AudioWorkletProcessor{
  constructor(){super();this.buffer=new Float32Array(2048);this.fill=0;}
  process(inputs){
    const input=inputs[0]?.[0];
    if(!input)return true;
    let offset=0;
    while(offset<input.length){
      const take=Math.min(this.buffer.length-this.fill,input.length-offset);
      this.buffer.set(input.subarray(offset,offset+take),this.fill);
      this.fill+=take;offset+=take;
      if(this.fill===this.buffer.length){this.port.postMessage(this.buffer.slice());this.fill=0;}
    }
    return true;
  }
}
registerProcessor('mic-capture',MicCapture);
