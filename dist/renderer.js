/** Browser port of the upstream skeleton renderer; see THIRD_PARTY_NOTICES.md. */
import {CONNECTIONS} from './core.js';
const GRAY=[128,128,128],RED=[255,48,48],PEACH=[255,229,180],PURPLE=[128,64,128],YELLOW=[255,204,0],GREEN=[48,255,48],BLUE=[21,101,192];
const COLORS=[RED,RED,PEACH,PEACH,PEACH,RED,PURPLE,PURPLE,PURPLE,RED,YELLOW,YELLOW,YELLOW,RED,GREEN,GREEN,GREEN,RED,BLUE,BLUE,BLUE];
const color=(rgb)=>`rgb(${rgb.join(',')})`;

/** Draw at 192 px, then area-average to 96 px. Inputs remain float32 RGB 0–255. */
export function renderModelInput(points,canvas) {
  canvas.width=192;canvas.height=192;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='black';ctx.fillRect(0,0,192,192);
  const coords=points.map((p)=>p.map((v)=>Math.round(v*192)));
  ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=1;
  for(let i=0;i<CONNECTIONS.length;i++){
    const [a,b]=CONNECTIONS[i];ctx.strokeStyle=color(i<6?GRAY:COLORS[b]);
    ctx.beginPath();ctx.moveTo(coords[a][0]+.5,coords[a][1]+.5);ctx.lineTo(coords[b][0]+.5,coords[b][1]+.5);ctx.stroke();
  }
  coords.forEach(([x,y],i)=>{
    ctx.beginPath();ctx.arc(x+.5,y+.5,3,0,Math.PI*2);ctx.fillStyle='rgb(224,224,224)';ctx.fill();
    ctx.beginPath();ctx.arc(x+.5,y+.5,2,0,Math.PI*2);ctx.fillStyle=color(COLORS[i]);ctx.fill();
  });
  const rgba=ctx.getImageData(0,0,192,192).data;
  const pixels=new Float32Array(96*96*3);
  for(let y=0;y<96;y++)for(let x=0;x<96;x++)for(let c=0;c<3;c++){
    const p=(y*2*192+x*2)*4+c;
    pixels[(y*96+x)*3+c]=Math.round((rgba[p]+rgba[p+4]+rgba[p+192*4]+rgba[p+192*4+4])/4);
  }
  return pixels;
}
