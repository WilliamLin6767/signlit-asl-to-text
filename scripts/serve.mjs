import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../dist/',import.meta.url));
const port=Number(process.env.PORT||5173);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.wasm':'application/wasm','.onnx':'application/octet-stream','.task':'application/octet-stream'};
const server=createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const path=resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
    if(!path.startsWith(root.endsWith(sep)?root:root+sep)){res.writeHead(403);res.end('Forbidden');return;}
    if(!(await stat(path)).isFile()){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});
    if(req.method==='HEAD'){res.end();return;}
    if(req.method!=='GET'){res.writeHead(405);res.end('Method not allowed');return;}
    res.end(await readFile(path));
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Signlit is running at http://localhost:${port}`));
