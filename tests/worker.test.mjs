import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);const wranglerRequire=createRequire(require.resolve('wrangler/package.json'));const {Miniflare}=wranglerRequire('miniflare');
const root=resolve('dist/server');
const modulePaths=['index.js',...readdirSync(root,{recursive:true}).filter(p=>/\.m?js$/.test(p)&&p!=='index.js')];
const mf=new Miniflare({modules:modulePaths.map(path=>({type:'ESModule',path:resolve(root,path)})),modulesRoot:root,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'test-db'},bindings:{APP_ORIGIN:'https://ruta.test',GOOGLE_CLIENT_ID:'runtime-test',GOOGLE_CLIENT_SECRET:'runtime-test'},cf:false});
test('Worker compilado: dos sesiones separadas, persistencia D1 y rechazo de cabeceras falsas',async()=>{
 const db=await mf.getD1Database('DB');for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort()){for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();}
 const now=Date.now();const tokenA='A'.repeat(43),tokenB='B'.repeat(43);const hash=s=>createHash('sha256').update(s).digest('base64url');
 for(const [id,token]of[['alice',tokenA],['bob',tokenB]]){await db.prepare('INSERT INTO auth_users (id,google_sub,email,name,created_at) VALUES (?,?,?,?,?)').bind(id,id,id+'@example.test',id,now).run();await db.prepare('INSERT INTO auth_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(hash(token),id,now+86400000).run();}
 const call=(path,token='',method='GET',body)=>mf.dispatchFetch('https://ruta.test'+path,{method,headers:{cookie:'__Host-ruta_session='+token,origin:'https://ruta.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const a=await call('/api/auth/session',tokenA);assert.equal(a.status,200);assert.equal((await a.json()).user.id,'alice');
 const car={id:'alice-auto',name:'Privado',brand:'',model:'',year:null,capacity:null,initialEfficiency:12,initialDaily:40,currency:'MXN',units:'metric',revision:0,fills:[]};
 const saved=await call('/api/garage',tokenA,'PUT',car);assert.equal(saved.status,200);const payload=await saved.json();
 assert.equal((await (await call('/api/garage',tokenA)).json()).length,1);assert.deepEqual(await (await call('/api/garage',tokenB)).json(),[]);assert.equal((await call('/api/garage',tokenB,'PUT',payload.vehicle)).status,409);
 const fake=await mf.dispatchFetch('https://ruta.test/api/garage',{headers:{'oai-authenticated-user-id':'alice'}});assert.equal(fake.status,401);
 const home=await call('/');assert.equal(home.status,200);assert.match(await home.text(),/Ruta|ruta/);assert.equal(home.headers.get('X-Frame-Options'),'DENY');
});
test.after(()=>mf.dispose());
