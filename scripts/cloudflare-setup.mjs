import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
const origin=option('--origin')??process.env.APP_ORIGIN;
let url;try{url=new URL(origin);}catch{throw Error('Indica --origin https://gas-consume-tracker.TU-SUBDOMINIO.workers.dev o APP_ORIGIN.');}
if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('El origen debe ser HTTPS y no contener rutas, parámetros o credenciales.');
const cfg=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
function wrangler(args){const r=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js',...args],{encoding:'utf8',env:process.env});if(r.status!==0){process.stderr.write(r.stderr??'');throw Error('No se pudo consultar Cloudflare. Ejecuta wrangler login o configura CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID.');}return r.stdout;}
let id=option('--database-id')??process.env.CLOUDFLARE_D1_DATABASE_ID;
if(!id){const rows=JSON.parse(wrangler(['d1','list','--json']));const match=rows.find(x=>x.name===cfg.d1_databases[0].database_name);if(match)id=match.uuid;else{wrangler(['d1','create',cfg.d1_databases[0].database_name]);const created=JSON.parse(wrangler(['d1','list','--json']));id=created.find(x=>x.name===cfg.d1_databases[0].database_name)?.uuid;}}
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id??'')||id==='00000000-0000-4000-8000-000000000000')throw Error('No se obtuvo un identificador D1 válido.');
cfg.d1_databases[0].database_id=id;cfg.vars={APP_ORIGIN:url.origin};
writeFileSync('wrangler.jsonc',JSON.stringify(cfg,null,2)+'\n');
console.log('Cloudflare configurado. Base D1:',id,'Origen:',url.origin);
console.log('Configura GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET como secretos de Workers antes de cf:deploy.');
