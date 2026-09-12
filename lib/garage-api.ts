import {validate,analyze,type Vehicle} from './engine.ts';
type DB={prepare:(sql:string)=>{bind:(...values:unknown[])=>{all:<T>()=>Promise<{results:T[]}>;run:()=>Promise<{meta:{changes:number}}>}}};
export function createGarageAPI(database:()=>DB){
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
function owner(req:Request){const id=req.headers.get('oai-authenticated-user-id');if(!id)throw Error('AUTH');return id;}
async function GET(req:Request){try{const id=owner(req),r=await database().prepare('SELECT payload,revision FROM vehicles WHERE owner = ?').bind(id).all<{payload:string;revision:number}>();return json(r.results.map(r=>({...JSON.parse(r.payload),revision:r.revision})));}catch(e){console.error('garage GET',e);return json({error:e instanceof Error&&e.message==='AUTH'?'Inicia sesión para ver tus vehículos.':'No se pudieron cargar los vehículos. Intenta de nuevo.'},e instanceof Error&&e.message==='AUTH'?401:503);}}
async function PUT(req:Request){try{const id=owner(req);const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return json({error:'Origen no permitido.'},403);const raw=await req.text();if(raw.length>1500000)return json({error:'El historial es demasiado grande.'},413);let v:Vehicle;try{v=JSON.parse(raw);validate(v);if(!Number.isInteger(v.revision)||v.revision<0)throw Error('Versión inválida.');}catch(e){return json({error:e instanceof Error?e.message:'Datos inválidos.'},400);}
 const db=database(),payload=JSON.stringify(v);
 const r=v.revision===0?await db.prepare('INSERT INTO vehicles (id,owner,payload,revision) VALUES (?,?,?,1) ON CONFLICT(id) DO NOTHING').bind(v.id,id,payload).run():await db.prepare('UPDATE vehicles SET payload = ?, revision = revision + 1 WHERE id = ? AND owner = ? AND revision = ?').bind(payload,v.id,id,v.revision).run();
 if(!r.meta.changes)return json({error:'El vehículo cambió en otra sesión. Recarga los datos antes de guardar; tu formulario se conserva.'},409);
 return json({vehicle:{...v,revision:v.revision+1},analysis:analyze(v)});
 }catch(e){console.error('garage PUT',e);return json({error:e instanceof Error&&e.message==='AUTH'?'Inicia sesión para guardar.':'No se pudo guardar. Tus datos siguen en el formulario; intenta de nuevo.'},e instanceof Error&&e.message==='AUTH'?401:503);}}

return {GET,PUT};
}
