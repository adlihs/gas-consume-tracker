import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createAuth,digest,configuredOrigin} from '../lib/auth.ts';
import {createGarageAPI} from '../lib/garage-api.ts';
import type {Database} from '../lib/database.ts';
const db=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
const database:()=>Database=()=>({
 prepare:(sql)=>({
  bind:(...values)=>({
   all:async<T>()=>({results:db.prepare(sql).all(...values as (string|number|null)[]) as T[]}),
   run:async()=>({meta:{changes:Number(db.prepare(sql).run(...values as (string|number|null)[]).changes)}})
  })
 })
});
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'test-key',alg:'RS256',use:'sig'};
const b64=(s:string|Uint8Array)=>Buffer.from(typeof s==='string'?new TextEncoder().encode(s):s).toString('base64url');
const origin='https://ruta.test';let clock=Date.UTC(2026,8,14);const config={APP_ORIGIN:origin,GOOGLE_CLIENT_ID:'test-google-client',GOOGLE_CLIENT_SECRET:'test-secret'};
type Grant={sub:string;nonce:string;challenge:string;overrides?:Record<string,unknown>};const grants=new Map<string,Grant>();
async function token(g:Grant){const header=b64(JSON.stringify({alg:'RS256',kid:'test-key'}));const body=b64(JSON.stringify({iss:'https://accounts.google.com',aud:config.GOOGLE_CLIENT_ID,sub:g.sub,email:g.sub+'@example.test',email_verified:true,name:g.sub,iat:Math.floor(clock/1000),exp:Math.floor(clock/1000)+3600,nonce:g.nonce,...g.overrides}));const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(header+'.'+body));return header+'.'+body+'.'+b64(new Uint8Array(signature));}
const google=async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);if(url==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});assert.equal(url,'https://oauth2.googleapis.com/token');const body=new URLSearchParams(init?.body as URLSearchParams);assert.equal(body.get('client_secret'),config.GOOGLE_CLIENT_SECRET);assert.equal(body.get('redirect_uri'),origin+'/api/auth/callback');const g=grants.get(body.get('code')??'');if(!g)return Response.json({error:'invalid_grant'},{status:400});assert.equal(await digest(body.get('code_verifier')!),g.challenge);return Response.json({id_token:await token(g)});};
const auth=createAuth(database,()=>config,google as typeof fetch,()=>clock);const garage=createGarageAPI(database,auth.owner,()=>config);
const cookie=(r:Response,prefix:string)=>r.headers.getSetCookie().find(x=>x.startsWith(prefix))?.split(';')[0]??'';
async function begin(sub:string,overrides?:Record<string,unknown>){const r=await auth.handle(new Request(origin+'/api/auth/login',{headers:{'cf-connecting-ip':sub}}));assert.equal(r.status,302);const u=new URL(r.headers.get('location')!);assert.equal(u.origin,'https://accounts.google.com');assert.equal(u.searchParams.get('code_challenge_method'),'S256');const code=crypto.randomUUID();grants.set(code,{sub,nonce:u.searchParams.get('nonce')!,challenge:u.searchParams.get('code_challenge')!,overrides});return {callback:origin+'/api/auth/callback?'+new URLSearchParams({state:u.searchParams.get('state')!,code}),browserCookie:cookie(r,'__Host-ruta_oauth=')};}
async function login(sub:string){const flow=await begin(sub);const response=await auth.handle(new Request(flow.callback,{headers:{cookie:flow.browserCookie}}));assert.equal(response.status,303);assert.equal(response.headers.get('location'),origin+'/');const sessionCookie=cookie(response,'__Host-ruta_session=');assert.ok(sessionCookie);assert.match(response.headers.getSetCookie().find(s=>s.startsWith('__Host-ruta_session='))!,/HttpOnly; SameSite=Lax; Max-Age=604800; Secure/);return sessionCookie;}
const request=(path:string,cookie='',method='GET',body?:unknown)=>new Request(origin+path,{method,headers:{cookie,origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const vehicle={id:'vehicle-alice',name:'Auto privado',brand:'',model:'',year:null,capacity:50,initialEfficiency:12,initialDaily:40,currency:'MXN',units:'metric',revision:0,fills:[{id:'fill1',date:'2026-01-01T12:00:00Z',liters:30,amount:720,currency:'MXN',distance:null,distanceFrom:null,odometer:null,full:false,remaining:null,route:'mixto'}]};
test('dos cuentas: Google firmado, sesiones persistidas, lectura/escritura aislada y cierre de sesión',async()=>{
 const alice=await login('alice'),bob=await login('bob');const au=await auth.user(request('/',alice)),bu=await auth.user(request('/',bob));assert.ok(au);assert.notEqual(au!.id,bu!.id);
 const saved=await garage.PUT(request('/api/garage',alice,'PUT',vehicle));assert.equal(saved.status,200);const data=await saved.json() as {vehicle:unknown;analysis:{prediction:{range:number;days:number}}};assert.equal(data.analysis.prediction.range,360);assert.equal(data.analysis.prediction.days,9);
 assert.equal(((await (await garage.GET(request('/api/garage',alice))).json()) as unknown[]).length,1);
 assert.deepEqual(await (await garage.GET(request('/api/garage',bob))).json(),[]);
 assert.equal((await garage.PUT(request('/api/garage',bob,'PUT',data.vehicle))).status,409);
 const bcar={...vehicle,id:'vehicle-bob',name:'Auto Bob'};assert.equal((await garage.PUT(request('/api/garage',bob,'PUT',bcar))).status,200);
 assert.equal(((await (await garage.GET(request('/api/garage',alice))).json()) as {name:string}[])[0].name,'Auto privado');
 const hashes=db.prepare('SELECT token_hash FROM auth_sessions').all();assert.ok(hashes.every(x=>!alice.includes(String(x.token_hash))));
 assert.equal((await auth.handle(request('/api/auth/logout',alice,'POST'))).status,204);assert.equal((await garage.GET(request('/api/garage',alice))).status,401);assert.ok(await auth.user(request('/',bob)));
});
test('cabeceras de identidad falsificadas no autentican',async()=>{assert.equal((await garage.GET(new Request(origin+'/api/garage',{headers:{'oai-authenticated-user-id':'alice','oai-authenticated-user-email':'alice@example.test'}}))).status,401);});
test('state vinculado al navegador, un solo uso y sin sesión ante CSRF',async()=>{const f=await begin('csrf');const bad=await auth.handle(new Request(f.callback));assert.match(bad.headers.get('location')!,/auth_error/);const good=await auth.handle(new Request(f.callback,{headers:{cookie:f.browserCookie}}));assert.ok(cookie(good,'__Host-ruta_session='));const replay=await auth.handle(new Request(f.callback,{headers:{cookie:f.browserCookie}}));assert.match(replay.headers.get('location')!,/auth_error/);assert.equal(cookie(replay,'__Host-ruta_session='),'');});
test('rechaza tokens con emisor, audiencia, nonce, correo o vencimiento inválidos',async()=>{for(const overrides of [{iss:'https://evil.test'},{aud:'other-client'},{nonce:'wrong'},{email_verified:false},{exp:1},{azp:'other-client'}]){const f=await begin('bad-identity',overrides);const r=await auth.handle(new Request(f.callback,{headers:{cookie:f.browserCookie}}));assert.match(r.headers.get('location')!,/auth_error/);assert.equal(cookie(r,'__Host-ruta_session='),'');}});
test('rechaza firma manipulada',async()=>{const malicious=async(input:RequestInfo|URL,init?:RequestInit)=>{const r=await google(input,init);if(String(input).endsWith('/token')){const body=await r.json() as {id_token:string};const parts=body.id_token.split('.');parts[1]=b64(JSON.stringify({sub:'attacker'}));return Response.json({id_token:parts.join('.')});}return r;};const badAuth=createAuth(database,()=>config,malicious as typeof fetch,()=>clock);const f=await begin('signature');const r=await badAuth.handle(new Request(f.callback,{headers:{cookie:f.browserCookie}}));assert.match(r.headers.get('location')!,/auth_error/);});
test('rechaza escrituras y logout sin Origin o desde origen ajeno',async()=>{const session=await login('origins');for(const o of ['', 'https://evil.test']){const r=new Request(origin+'/api/garage',{method:'PUT',headers:{cookie:session,...(o?{origin:o}:{})},body:JSON.stringify(vehicle)});assert.equal((await garage.PUT(r)).status,403);const out=new Request(origin+'/api/auth/logout',{method:'POST',headers:{cookie:session,...(o?{origin:o}:{})}});assert.equal((await auth.handle(out)).status,403);}});
test('las sesiones caducan y el mismo Google sub conserva su cuenta',async()=>{const session=await login('returning');const first=await auth.user(request('/',session));const second=await login('returning');assert.equal((await auth.user(request('/',second)))!.id,first!.id);clock+=8*86400000;assert.equal(await auth.user(request('/',session)),null);});
test('sin configuración no hay acceso ni credenciales ficticias',async()=>{const closed=createAuth(database,()=>({}),google as typeof fetch);const response=await closed.handle(request('/api/auth/session'));assert.deepEqual(await response.json(),{user:null,configured:false});assert.equal((await closed.handle(request('/api/auth/login'))).status,503);assert.throws(()=>configuredOrigin({APP_ORIGIN:'http://public.example',ALLOW_HTTP_LOCALHOST:'true'}));});
test.after(()=>db.close());
