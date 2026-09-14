import type { Database } from './database.ts';
export type AuthConfig={APP_ORIGIN?:string;GOOGLE_CLIENT_ID?:string;GOOGLE_CLIENT_SECRET?:string;ALLOW_HTTP_LOCALHOST?:string};
export type AuthUser={id:string;email:string;name:string};
type Claims={iss:string;aud:string|string[];azp?:string;sub:string;email:string;email_verified:boolean;name?:string;exp:number;iat:number;nonce:string};
const ISSUER='https://accounts.google.com',TOKEN_ENDPOINT='https://oauth2.googleapis.com/token',JWKS_ENDPOINT='https://www.googleapis.com/oauth2/v3/certs';
const encoder=new TextEncoder();const SESSION_SECONDS=7*86400;
export class AuthError extends Error {status:number;code:string;constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}}
const fail=(status:number,code:string,message:string):never=>{throw new AuthError(status,code,message);};
function bytesToBase64(b:Uint8Array){let s='';for(const n of b)s+=String.fromCharCode(n);return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function fromBase64(s:string){if(!/^[A-Za-z0-9_-]+$/.test(s))return fail(401,'invalid_token','No se pudo verificar tu identidad.');const raw=atob(s.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-s.length%4)%4));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
const randomToken=()=>bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
export const digest=async(s:string)=>bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s))));
export function configuredOrigin(c:AuthConfig){
 let u:URL;try{u=new URL(c.APP_ORIGIN??'');}catch{return fail(503,'not_configured','El acceso todavía no está configurado.');}
 const local=c.ALLOW_HTTP_LOCALHOST==='true'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname);
 if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||(u.protocol!=='https:'&&!(u.protocol==='http:'&&local)))return fail(503,'not_configured','El origen de la aplicación no es válido.');
 return u.origin;
}
export function requireSameOrigin(req:Request,c:AuthConfig){if(req.headers.get('origin')!==configuredOrigin(c)||req.headers.get('sec-fetch-site')==='cross-site')fail(403,'csrf','Solicitud de otro origen bloqueada.');}
function cookieName(c:AuthConfig,kind:'session'|'oauth'){return `${configuredOrigin(c).startsWith('https:')?'__Host-':''}ruta_${kind}`;}
function cookie(c:AuthConfig,kind:'session'|'oauth',value:string,age:number){return `${cookieName(c,kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${configuredOrigin(c).startsWith('https:')?'; Secure':''}`;}
function readCookie(req:Request,c:AuthConfig,kind:'session'|'oauth'){const prefix=cookieName(c,kind)+'=';const matches=(req.headers.get('cookie')??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(prefix));if(matches.length!==1)return null;const value=matches[0].slice(prefix.length);return /^[A-Za-z0-9_-]{43}$/.test(value)?value:null;}
const noCache={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:noCache});
export function createAuth(db:()=>Database,config:()=>AuthConfig,fetcher:typeof fetch=fetch,now:()=>number=Date.now){
 let keys:{values:(JsonWebKey&{kid?:string;alg?:string;use?:string})[];expires:number}|null=null;
 function settings(){const c=config();configuredOrigin(c);if(!c.GOOGLE_CLIENT_ID||!c.GOOGLE_CLIENT_SECRET)fail(503,'not_configured','El inicio de sesión con Google aún no está configurado.');return c;}
 async function verifyIdToken(token:unknown,nonce:string,c:AuthConfig):Promise<Claims>{
  if(typeof token!=='string'||token.length>16384)fail(401,'invalid_token','No se pudo verificar tu identidad.');
  const parts=(token as string).split('.');if(parts.length!==3)fail(401,'invalid_token','Token de identidad inválido.');
  let header:{alg?:string;kid?:string};let claims:Claims;
  try{header=JSON.parse(new TextDecoder().decode(fromBase64(parts[0])));claims=JSON.parse(new TextDecoder().decode(fromBase64(parts[1])));}catch{return fail(401,'invalid_token','Token de identidad inválido.');}
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200)fail(401,'invalid_token','Firma de identidad no admitida.');
  if(!keys||keys.expires<now()||!keys.values.some(k=>k.kid===header.kid)){
   const r=await fetcher(JWKS_ENDPOINT,{signal:AbortSignal.timeout(10000)});if(!r.ok)fail(503,'provider_unavailable','Google no está disponible. Intenta de nuevo.');
   const body=await r.json() as {keys:NonNullable<typeof keys>['values']};if(!Array.isArray(body.keys))fail(503,'provider_unavailable','No se pudo verificar a Google.');
   keys={values:body.keys,expires:now()+3600000};
  }
  const jwk=keys!.values.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));
  if(!jwk)fail(401,'invalid_token','Clave de identidad no válida.');
  const key=await crypto.subtle.importKey('jwk',jwk!,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,fromBase64(parts[2]),encoder.encode(parts[0]+'.'+parts[1])))fail(401,'invalid_token','Firma de identidad inválida.');
  const t=Math.floor(now()/1000),aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(![ISSUER,'accounts.google.com'].includes(claims.iss)||!aud.includes(c.GOOGLE_CLIENT_ID!)||(claims.azp&&claims.azp!==c.GOOGLE_CLIENT_ID)||(aud.length>1&&claims.azp!==c.GOOGLE_CLIENT_ID)||!Number.isFinite(claims.exp)||claims.exp<=t||!Number.isFinite(claims.iat)||claims.iat>t+60||claims.nonce!==nonce||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>255||claims.email_verified!==true||typeof claims.email!=='string'||claims.email.length>320)fail(401,'invalid_token','La identidad recibida no es válida para esta aplicación.');
  return claims;
 }
 async function user(req:Request):Promise<AuthUser|null>{
  const c=config();configuredOrigin(c);const raw=readCookie(req,c,'session');if(!raw)return null;
  const r=await db().prepare('SELECT u.id,u.email,u.name FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').bind(await digest(raw),now()).all<AuthUser>();return r.results[0]??null;
 }
 async function owner(req:Request){const u=await user(req);if(!u)fail(401,'unauthorized','Inicia sesión para acceder a tus vehículos.');return u!.id;}
 async function start(req:Request){
  const c=settings(),origin=configuredOrigin(c);
  if(new URL(req.url).origin!==origin)fail(403,'origin','Origen no permitido.');
  // Bound temporary rows per trusted Cloudflare client address and 10-minute window.
  const bucket=await digest((req.headers.get('cf-connecting-ip')??'local')+':'+Math.floor(now()/600000));
  const n=await db().prepare('INSERT INTO auth_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count').bind(bucket,now()+1200000).all<{count:number}>();
  if(n.results[0].count>30)fail(429,'rate_limited','Demasiados intentos. Espera unos minutos antes de volver a entrar.');
  const state=randomToken(),verifier=randomToken(),nonce=randomToken(),browserToken=randomToken();
  await db().prepare('DELETE FROM auth_flows WHERE expires_at <= ?').bind(now()).run();
  await db().prepare('DELETE FROM auth_limits WHERE expires_at <= ?').bind(now()).run();
  await db().prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(now()).run();
  await db().prepare('INSERT INTO auth_flows (state_hash,browser_hash,verifier,nonce,expires_at) VALUES (?,?,?,?,?)').bind(await digest(state),await digest(browserToken),verifier,nonce,now()+600000).run();
  const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');auth.search=new URLSearchParams({client_id:c.GOOGLE_CLIENT_ID!,redirect_uri:origin+'/api/auth/callback',response_type:'code',scope:'openid email profile',state,nonce,code_challenge:await digest(verifier),code_challenge_method:'S256',access_type:'online',prompt:'select_account'}).toString();
  return new Response(null,{status:302,headers:{...noCache,Location:auth.href,'Set-Cookie':cookie(c,'oauth',browserToken,600)}});
 }
 async function callback(req:Request){
  const c=settings(),origin=configuredOrigin(c),url=new URL(req.url),state=url.searchParams.get('state'),code=url.searchParams.get('code'),browserToken=readCookie(req,c,'oauth');
  if(url.origin!==origin||!state||!/^[A-Za-z0-9_-]{43}$/.test(state)||!browserToken)fail(401,'invalid_state','La sesión de acceso caducó. Intenta entrar de nuevo.');
  const r=await db().prepare('DELETE FROM auth_flows WHERE state_hash = ? AND browser_hash = ? AND expires_at > ? RETURNING verifier,nonce').bind(await digest(state!),await digest(browserToken!),now()).all<{verifier:string;nonce:string}>();
  if(!r.results[0]||!code||code.length>4096||url.searchParams.has('error'))fail(401,'invalid_state','El acceso se canceló o ya fue utilizado. Intenta de nuevo.');
  const response=await fetcher(TOKEN_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:code!,client_id:c.GOOGLE_CLIENT_ID!,client_secret:c.GOOGLE_CLIENT_SECRET!,redirect_uri:origin+'/api/auth/callback',grant_type:'authorization_code',code_verifier:r.results[0].verifier}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)fail(401,'provider_failed','No se pudo completar el acceso con Google.');
  const tokens=await response.json() as {id_token?:string};const identity=await verifyIdToken(tokens.id_token,r.results[0].nonce,c);
  // Account ownership derives from Google's stable subject, never an email match.
  const accounts=await db().prepare('INSERT INTO auth_users (id,google_sub,email,name,created_at) VALUES (?,?,?,?,?) ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name RETURNING id,email,name').bind(crypto.randomUUID(),identity.sub,identity.email,(identity.name??identity.email).slice(0,150),now()).all<AuthUser>();
  const token=randomToken();const previous=readCookie(req,c,'session');if(previous)await db().prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await digest(previous)).run();
  await db().prepare('INSERT INTO auth_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await digest(token),accounts.results[0].id,now()+SESSION_SECONDS*1000).run();
  const headers=new Headers({...noCache,Location:origin+'/'});headers.append('Set-Cookie',cookie(c,'session',token,SESSION_SECONDS));headers.append('Set-Cookie',cookie(c,'oauth','',0));return new Response(null,{status:303,headers});
 }
 async function logout(req:Request){const c=config();requireSameOrigin(req,c);const token=readCookie(req,c,'session');if(token)await db().prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await digest(token)).run();return new Response(null,{status:204,headers:{...noCache,'Set-Cookie':cookie(c,'session','',0)}});}
 async function session(req:Request){let ready=true;try{settings();}catch{ready=false;}return json({user:ready?await user(req):null,configured:ready});}
 async function handle(req:Request){try{const path=new URL(req.url).pathname;if(path==='/api/auth/session'&&req.method==='GET')return await session(req);if(path==='/api/auth/login'&&req.method==='GET')return await start(req);if(path==='/api/auth/callback'&&req.method==='GET')return await callback(req);if(path==='/api/auth/logout'&&req.method==='POST')return await logout(req);return json({error:'Ruta no disponible.'},404);}catch(e){if(e instanceof AuthError){if(new URL(req.url).pathname.endsWith('/callback'))return new Response(null,{status:303,headers:{...noCache,Location:configuredOrigin(config())+'/?auth_error='+encodeURIComponent(e.code),'Set-Cookie':cookie(config(),'oauth','',0)}});return json({error:e.message,code:e.code},e.status);}console.error('Authentication service failure');return json({error:'No se pudo completar el acceso. Intenta de nuevo.'},503);}}
 return {handle,user,owner};
}
