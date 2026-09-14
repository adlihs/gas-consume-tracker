import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const cfg=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
if(!cfg.vars?.APP_ORIGIN?.startsWith('https://')||cfg.vars.ALLOW_HTTP_LOCALHOST||cfg.d1_databases[0].database_id==='00000000-0000-4000-8000-000000000000')throw Error('Ejecuta primero pnpm run cf:setup -- --origin https://TU-ORIGEN.');
function run(args,capture=false){const r=spawnSync(process.execPath,args,{stdio:capture?'pipe':'inherit',encoding:'utf8',env:process.env});if(r.status!==0){if(capture)process.stderr.write(r.stderr??'');throw Error('El despliegue se detuvo. Corrige el error anterior antes de reintentar.');}return r.stdout;}
const wrangler=['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js'];
const secrets=JSON.parse(run([...wrangler,'secret','list','--config','wrangler.jsonc'],true));
for(const key of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'])if(!secrets.some(x=>x.name===key))throw Error(`Falta el secreto ${key}. Agrégalo con wrangler secret put ${key} --config wrangler.jsonc.`);
run(['--experimental-strip-types','--test','tests/engine.test.ts','tests/api.test.ts','tests/auth.test.ts']);
run(['./node_modules/typescript/bin/tsc','--noEmit']);
run(['--import','./scripts/sites-env.mjs','./node_modules/vinext/dist/cli.js','build']);
run(['--import','./scripts/sites-env.mjs','--test','tests/worker.test.mjs']);
run([...wrangler,'d1','migrations','apply','DB','--remote','--config','wrangler.jsonc']);
run([...wrangler,'deploy','--config','dist/server/wrangler.json']);
const check=await fetch(cfg.vars.APP_ORIGIN+'/api/auth/session',{signal:AbortSignal.timeout(15000)});
const result=await check.json();
if(!check.ok||result.configured!==true)throw Error('El Worker fue publicado, pero no pasó la comprobación de acceso. Revisa sus secretos, origen y registros.');
console.log('Worker publicado y configuración de acceso comprobada:',cfg.vars.APP_ORIGIN);
console.log('Completa la comprobación final entrando con dos cuentas de Google distintas.');
