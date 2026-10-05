/** Pure geometry and temporal decoding. No camera, DOM, or network side effects. */
export const LABELS = Object.freeze(Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'));
export const STATIC_LABELS = Object.freeze(LABELS.filter((label) => !['J', 'Z'].includes(label)));
export const CONNECTIONS = Object.freeze([
  [0,1],[0,5],[0,17],[5,9],[9,13],[13,17],
  [1,2],[2,3],[3,4],[5,6],[6,7],[7,8],
  [9,10],[10,11],[11,12],[13,14],[14,15],[15,16],[17,18],[18,19],[19,20],
]);

/** Preserve aspect ratio: convert both axes to pixels before centering/scaling. */
export function normalizeLandmarks(landmarks, width, height) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21 || width <= 0 || height <= 0) {
    throw new TypeError('Expected 21 landmarks and positive image dimensions.');
  }
  const points = landmarks.map(({x,y}) => [x * width, y * height]);
  if (points.some((p) => p.some((v) => !Number.isFinite(v)))) throw new TypeError('Invalid hand coordinates.');
  const lo = [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))];
  const hi = [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];
  const extent = [hi[0]-lo[0],hi[1]-lo[1]];
  const box = Math.max(...extent) / 0.7;
  if (box < 1e-6) throw new RangeError('Degenerate hand bounding box.');
  const origin = [lo[0]+extent[0]/2-box/2,lo[1]+extent[1]/2-box/2];
  return points.map((p) => [(p[0]-origin[0])/box,(p[1]-origin[1])/box]);
}

export function softmax(logits) {
  const values = Array.from(logits);
  if (values.length !== 26 || values.some((v) => !Number.isFinite(v))) throw new TypeError('Expected 26 finite logits.');
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp(v-max));
  const total = exps.reduce((a,b) => a+b,0);
  return exps.map((v,i) => ({label: LABELS[i],confidence:v/total})).sort((a,b) => b.confidence-a.confidence);
}

/** One commit per held sign. A real release or another committed letter unlocks repeats. */
export class LetterDecoder {
  constructor({holdMs=800,threshold=.8,releaseMs=300,maxGapMs=250,minFrames=6}={}) {
    this.holdMs=holdMs;this.threshold=threshold;this.releaseMs=releaseMs;
    this.maxGapMs=maxGapMs;this.minFrames=minFrames;this.reset();
  }
  reset() { this.candidate=null;this.startedAt=0;this.frames=0;this.lastTime=null;this.lastCommitted=null;this.missingSince=null; }
  update(prediction,time) {
    if (!Number.isFinite(time)) throw new TypeError('A finite timestamp is required.');
    if (this.lastTime!==null && (time<this.lastTime || time-this.lastTime>this.maxGapMs)) {
      this.candidate=null;this.frames=0;
      // A stalled or backgrounded stream is not evidence of a hand release.
      this.missingSince=null;
    }
    this.lastTime=time;
    if (!prediction) {
      this.candidate=null;this.frames=0;
      this.missingSince ??= time;
      if(time-this.missingSince>=this.releaseMs) this.lastCommitted=null;
      return {commit:null,progress:0,reason:'no-hand'};
    }
    this.missingSince=null;
    const {label,confidence}=prediction;
    if (!STATIC_LABELS.includes(label) || !Number.isFinite(confidence) || confidence<this.threshold) {
      this.candidate=null;this.frames=0;
      return {commit:null,progress:0,reason:STATIC_LABELS.includes(label)?'uncertain':'motion-letter'};
    }
    if(label!==this.candidate) {this.candidate=label;this.startedAt=time;this.frames=0;}
    this.frames++;
    if(label===this.lastCommitted) return {commit:null,progress:1,reason:'already-added'};
    const progress=Math.min(1,(time-this.startedAt)/this.holdMs);
    if(progress>=1 && this.frames>=this.minFrames) {
      this.lastCommitted=label;
      return {commit:label,progress:1,reason:'added'};
    }
    return {commit:null,progress,reason:'holding'};
  }
}

export function insertText(text,start,end,addition,maxLength=5000) {
  if(typeof text!=='string'||typeof addition!=='string')throw new TypeError('Text must be a string.');
  const left=Math.max(0,Math.min(text.length,start));
  const right=Math.max(left,Math.min(text.length,end));
  const room=Math.max(0,maxLength-(text.length-(right-left)));
  const inserted=addition.slice(0,room);
  return {text:text.slice(0,left)+inserted+text.slice(right),cursor:left+inserted.length};
}

export const SIGN_GUIDE = {
 A:'Make a fist with your thumb resting along the side of your index finger. Keep your palm facing forward.',
 B:'Hold four fingers straight up together, with your thumb folded across your palm.',
 C:'Curve your fingers and thumb into the shape of a C, leaving a gap between the tips.',
 D:'Point your index finger up. Touch your thumb to the curled fingertips of your other fingers.',
 E:'Curl all four fingertips toward your palm, resting them above your folded thumb.',
 F:'Touch your index fingertip to your thumb to form a circle. Extend the other three fingers.',
 G:'Point your index finger and thumb sideways, parallel to each other. Curl the remaining fingers.',
 H:'Extend your index and middle fingers together, pointing sideways. Fold the other fingers.',
 I:'Make a fist and extend your pinky straight up.',
 J:'Start with the I handshape and trace a J with your pinky. This motion letter is not recognized automatically. Use Add J below.',
 K:'Raise your index and middle fingers in a V. Put your thumb against the base of the middle finger.',
 L:'Extend your index finger up and thumb sideways to form an L. Curl the other fingers.',
 M:'Make a fist with your thumb tucked underneath your index, middle, and ring fingers.',
 N:'Make a fist with your thumb tucked underneath your index and middle fingers.',
 O:'Curve all your fingertips to meet your thumb, forming an O.',
 P:'Use the K handshape, pointing down toward the floor.',
 Q:'Use the G handshape, pointing your index finger and thumb down toward the floor.',
 R:'Cross your index and middle fingers while keeping the other fingers curled.',
 S:'Make a fist with your thumb across the front of your fingers.',
 T:'Make a fist with your thumb tucked between your index and middle fingers.',
 U:'Raise your index and middle fingers straight up, held together. Fold the others.',
 V:'Raise your index and middle fingers and spread them into a V.',
 W:'Raise your index, middle, and ring fingers, spread apart. Fold your pinky and thumb.',
 X:'Curl your index finger into a hook. Keep your other fingers folded.',
 Y:'Extend your thumb and pinky with the other fingers curled.',
 Z:'Extend your index finger and trace a Z in the air. This motion letter is not recognized automatically. Use Add Z below.',
};
