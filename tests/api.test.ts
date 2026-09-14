import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createGarageAPI} from '../lib/garage-api.ts';
import {AuthError} from '../lib/auth.ts';
import type {Vehicle} from '../lib/engine.ts';
const dir=mkdtempSync(join(process.cwd(),'.db-test-'));const file=join(dir,'test.sqlite');
let db=new DatabaseSync(file);db.exec(readFileSync(new URL('../drizzle/0000_youthful_scrambler.sql',import.meta.url),'utf8'));
const api=createGarageAPI(()=>({
 prepare:(sql:string)=>({
  bind:(...values:unknown[])=>({
   all:async<T>()=>({results:db.prepare(sql).all(...values as (string|number|null)[]) as T[]}),
   run:async()=>({meta:{changes:Number(db.prepare(sql).run(...values as (string|number|null)[]).changes)}})
  })
 })
}),async(req)=>{const id=req.headers.get('test-owner');if(!id)throw new AuthError(401,'unauthorized','Inicia sesión.');return id;},()=>({APP_ORIGIN:'https://ruta.test'}));
const car:Vehicle={id:'car-a',name:'Persistencia',brand:'',model:'',year:null,capacity:50,initialEfficiency:12,initialDaily:40,currency:'MXN',units:'metric',fills:[],revision:0};
const req=(method='GET',body?:unknown,user='ed')=>new Request('https://ruta.test/api/garage',{method,headers:{'test-owner':user,'Content-Type':'application/json','Origin':'https://ruta.test'},...(body?{body:JSON.stringify(body)}:{})});
test('API + SQLite: persiste entre conexiones, edita, elimina cargas y bloquea conflictos/otros propietarios',async()=>{
 assert.equal((await api.PUT(req('PUT',car))).status,200);
 db.close();db=new DatabaseSync(file);
 const rows=await (await api.GET(req())).json() as Vehicle[];assert.equal(rows[0].name,'Persistencia');assert.equal(rows[0].revision,1);
 const loaded=rows[0];loaded.fills=[{id:'f1',date:'2026-01-01T12:00:00Z',liters:30,amount:720,currency:'MXN',distance:null,distanceFrom:null,odometer:null,full:false,remaining:null,route:'mixto'}];
 const saved=await (await api.PUT(req('PUT',loaded))).json() as {vehicle:Vehicle;analysis:{prediction:{range:number;days:number}}};assert.equal(saved.analysis.prediction.range,360);assert.equal(saved.analysis.prediction.days,9);
 assert.equal((await api.PUT(req('PUT',loaded))).status,409);
 assert.equal((await api.PUT(req('PUT',saved.vehicle,'other'))).status,409);
 assert.deepEqual(await (await api.GET(req('GET',undefined,'other'))).json(),[]);
 const edited={...saved.vehicle,fills:[{...saved.vehicle.fills[0],liters:20}]};const next=await (await api.PUT(req('PUT',edited))).json() as {vehicle:Vehicle;analysis:{prediction:{range:number}}};assert.equal(next.analysis.prediction.range,240);
 assert.equal((await api.PUT(req('PUT',{...next.vehicle,fills:[]}))).status,200);assert.equal(((await (await api.GET(req())).json()) as Vehicle[])[0].fills.length,0);
});
test('API rechaza datos inválidos, ausencia de identidad y origen ajeno',async()=>{
 assert.equal((await api.PUT(req('PUT',{...car,name:''}))).status,400);
 assert.equal((await api.GET(req('GET',undefined,''))).status,401);
 assert.equal((await api.PUT(new Request('https://ruta.test/api/garage',{method:'PUT',headers:{'test-owner':'ed',Origin:'https://other.test'},body:JSON.stringify(car)}))).status,403);
});
test.after(()=>{db.close();rmSync(dir,{recursive:true});});
