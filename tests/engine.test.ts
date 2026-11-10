import test from 'node:test';
import assert from 'node:assert/strict';
import {forecast,intervals,observations,KIND_WEIGHT,segment,daily,validate,model,analyze,DAY,type Vehicle,type Fill,type Interval} from '../lib/engine.ts';
const f=(i:number,more:Partial<Fill>={}):Fill=>({id:`f${i}`,date:new Date(Date.UTC(2026,0,1)+i*10*DAY).toISOString(),liters:30,amount:720,currency:'MXN',distance:i?360:null,distanceFrom:i?`f${i-1}`:null,odometer:null,full:true,remaining:null,route:'mixto',...more});
const v=(fills:Fill[]=[],more:Partial<Vehicle>={}):Vehicle=>({id:'car',name:'Prueba',brand:'',model:'',year:null,capacity:null,initialEfficiency:12,initialDaily:40,currency:'MXN',units:'metric',revision:0,fills,...more});
test('aceptación: 12 km/L × 30 L = 360 km; /40 = 9 días',()=>{const r=forecast(30,12,40,'2026-01-01T12:00:00Z',24);assert.equal(r.range,360);assert.equal(r.days,9);assert.equal(r.date,'2026-01-10T12:00:00.000Z');assert.equal(r.cost,2);});
test('primer registro sin distancia; sin supuestos no se inventan resultados',()=>{validate(v([f(0)]));const a=analyze(v([f(0)],{initialEfficiency:null,initialDaily:null}));assert.equal(a.prediction?.range,null);assert.equal(a.prediction?.date,null);assert.equal(a.intervals.length,0);assert.equal(a.total,null);});
test('historial parcial no mide consumo',()=>{const a=analyze(v([f(0,{full:false}),f(1,{full:false})]));assert.equal(a.intervals.length,0);assert.equal(a.prediction?.range,360);assert.equal(a.model.method,'Supuestos iniciales');});
test('incluye parciales y el llenado final; excluye inicial; no duplica litros',()=>{const data=[f(0,{liters:50}),f(1,{liters:10,full:false,distance:100}),f(2,{liters:20,distance:260}),f(3,{liters:30,distance:390})];const a=intervals(data);assert.deepEqual(a.map(x=>[x.distance,x.liters,x.efficiency]),[[360,30,12],[390,30,13]]);});
test('odómetro consecutivo se prioriza a distancia manual',()=>{assert.equal(segment(f(0,{odometer:1000}),f(1,{odometer:1400,distance:99})),400);});
test('odómetros de extremos rescatan intervalo con parcial sin distancia',()=>{const h=intervals([f(0,{odometer:1000}),f(1,{full:false,distance:null}),f(2,{odometer:1720,distance:null})]);assert.equal(h[0].efficiency,12);});
test('distancia faltante invalida intervalo sin inventar kilómetros',()=>{assert.equal(intervals([f(0),f(1,{distance:null})]).length,0);});
test('edición de litros y distancia recalcula rendimiento',()=>{const old=[f(0),f(1)];assert.equal(intervals(old)[0].efficiency,12);const updated=[old[0],{...old[1],liters:40,distance:400}];assert.equal(intervals(updated)[0].efficiency,10);});
test('eliminar carga no reasigna silenciosamente distancia manual',()=>{const data=[f(0),f(1,{full:false}),f(2)];assert.equal(intervals(data).length,1);const deleted=[data[0],data[2]];assert.equal(intervals(deleted).length,0);assert.ok(analyze(v(deleted)).warnings.length);});
test('edición cronológica conserva referencia manual y pide revisión',()=>{const data=[f(0),f(1,{date:'2026-02-15T00:00:00Z'}),f(2)];assert.equal(intervals(data).length,0);});
test('autonomía total requiere capacidad + lleno o restante conocido',()=>{assert.equal(analyze(v([f(0)],{capacity:50})).total?.range,600);assert.equal(analyze(v([f(0,{full:false,remaining:20})],{capacity:50})).total?.range,480);assert.equal(analyze(v([f(0,{full:false})],{capacity:50})).total,null);});
test('restante incompatible genera advertencia sin eliminar datos',()=>{const a=analyze(v([f(0,{full:false,remaining:80})],{capacity:50}));assert.equal(a.total,null);assert.ok(a.warnings.length);assert.equal(a.fills.length,1);});
test('uso diario mide tiempo transcurrido; rutina no muta historial',()=>{const car=v([f(0),f(1)]),before=JSON.stringify(car);assert.equal(daily(car.fills,40).value,36);assert.equal(analyze(car,60).prediction?.days,6);assert.equal(JSON.stringify(car),before);});
test('cero km diarios no genera infinito ni fecha',()=>{assert.equal(forecast(30,12,0,f(0).date,24).days,null);assert.equal(forecast(30,0,40,f(0).date,24).cost,null);});
test('rechaza valores inválidos, fechas futuras/duplicadas y odómetros decrecientes',()=>{for(const data of [[f(0,{liters:0})],[f(0,{amount:-1})],[f(0,{date:'2099-01-01'})],[f(0),f(0,{id:'other'})],[f(0,{odometer:1000}),f(1,{odometer:900})],[f(0,{remaining:101})],[f(0,{distance:-5})]])assert.throws(()=>validate(v(data)));});
test('cambiar precio no cambia rendimiento físico',()=>{const data=[f(0),f(1)];assert.equal(analyze(v(data)).model.efficiency,analyze(v(data.map(x=>({...x,amount:x.amount*3})))).model.efficiency);});
const obs=(i:number,y=12,route:Interval['route']='mixto'):Interval=>({start:String(i),end:String(i+1),distance:y*30,liters:30,efficiency:y,route,flag:false,kind:'lleno',weight:1});
test('modelo insuficiente usa base sin MAE ni banda inventados',()=>{const m=model(Array.from({length:19},(_,i)=>obs(i)),'mixto',null);assert.equal(m.used,false);assert.equal(m.baseMae,null);assert.equal(m.band,null);});
test('sin mejora conserva base, incluso con 30 intervalos',()=>{const m=model(Array.from({length:30},(_,i)=>obs(i)),'mixto',null);assert.equal(m.used,false);assert.equal(m.baseMae,0);assert.equal(m.efficiency,12);});
test('regresión real aprende recorrido y solo se activa si mejora temporalmente',()=>{const h=Array.from({length:40},(_,i)=>obs(i,i%2?18:8,i%2?'carretera':'ciudad'));const m=model(h,'carretera',null);assert.ok(m.used);assert.ok(m.mlMae!<=m.baseMae!*.9);assert.ok(m.efficiency!>15);assert.equal(m.validationCount,12);});
test('predicción de un prefijo no usa observaciones futuras',()=>{const h=Array.from({length:30},(_,i)=>obs(i,10+i*.1));const prior=model(h.slice(0,20),'mixto',null);h[25].efficiency=999;assert.deepEqual(model(h.slice(0,20),'mixto',null),prior);});
test('atípicos se conservan y señalan, bloquean activación ML reciente',()=>{const a=analyze(v([f(0),f(1,{distance:1800})]));assert.equal(a.intervals[0].efficiency,60);assert.ok(a.warnings.some(w=>w.includes('atípico')));});
test('cambiar tanque lleno a parcial reconstruye las observaciones usadas por el modelo',()=>{
 const data=[f(0),f(1,{liters:15,distance:120}),f(2,{liters:15,distance:240})];
 const complete=analyze(v(data));assert.equal(complete.intervals.length,2);assert.equal(complete.model.efficiency,40/3);
 const partial=analyze(v([data[0],{...data[1],full:false},data[2]]));assert.equal(partial.intervals.length,1);assert.equal(partial.intervals[0].liters,30);assert.equal(partial.model.efficiency,12);
});

// --- Predicción con cargas parciales ---
test('parciales con nivel restante y capacidad generan observaciones sin tanques llenos',()=>{
 // Tanque 50 L. Antes de cada carga queda 20 % (10 L) y se cargan 30 L: se consumen 30 L cada 360 km.
 const data=[0,1,2,3].map(i=>f(i,{full:false,remaining:20,liters:30}));
 const h=intervals(data,50);assert.equal(h.length,3);assert.ok(h.every(o=>o.kind==='nivel'&&o.weight===KIND_WEIGHT.nivel));assert.equal(h[0].liters,30);assert.equal(h[0].efficiency,12);
 const a=analyze(v(data,{capacity:50,initialEfficiency:null}));assert.equal(a.model.efficiency,12);assert.equal(a.model.method,'Promedio ponderado');assert.equal(a.model.usesPartials,true);assert.equal(a.prediction?.range,360);
});
test('lleno → parcial con nivel usa capacidad y nivel declarado',()=>{
 // Lleno (50 L en tanque), 240 km, queda 60 % (30 L): se consumieron 20 L → 12 km/L.
 const h=intervals([f(0),f(1,{full:false,remaining:60,liters:20,distance:240})],50);assert.equal(h.length,1);assert.equal(h[0].kind,'nivel');assert.equal(h[0].liters,20);assert.equal(h[0].efficiency,12);
});
test('parcial con nivel → lleno combina litros cargados después de la referencia',()=>{
 // Parcial: antes 10 L + 20 L = 30 L. Luego 300 km y lleno con 45 L: antes había 5 L → consumo 25 L.
 const h=intervals([f(0,{full:false,remaining:20,liters:20}),f(1,{liters:45,distance:300})],50);assert.equal(h[0].liters,25);assert.equal(h[0].efficiency,12);
});
test('sin capacidad, el nivel restante no se usa y los llenos se calculan igual que antes',()=>{
 const data=[f(0,{liters:50}),f(1,{liters:10,full:false,remaining:40,distance:100}),f(2,{liters:20,distance:260})];
 const h=intervals(data);assert.equal(h.length,1);assert.equal(h[0].kind,'lleno');assert.equal(h[0].efficiency,12);
});
test('con capacidad, un parcial con nivel divide el intervalo entre llenos',()=>{
 // Lleno, 120 km, queda 80 % (40 L) y carga 10 L; 240 km y lleno con 30 L (antes 20 L).
 const h=intervals([f(0),f(1,{full:false,remaining:80,liters:10,distance:120}),f(2,{liters:30,distance:240})],50);
 assert.deepEqual(h.map(o=>[o.kind,o.liters,o.efficiency]),[['nivel',10,12],['nivel',30,8]]);
});
test('consumo menor a 15 % del tanque espera más recorrido en vez de amplificar el error del indicador',()=>{
 // 60 km y 5 L consumidos (10 %): no se acepta. La siguiente carga mide desde la referencia anterior: 35 + 10 − 15 = 30 L en 300 km.
 const data=[f(0,{full:false,remaining:50,liters:10}),f(1,{full:false,remaining:60,liters:10,distance:60}),f(2,{full:false,remaining:30,liters:20,distance:240})];
 const h=intervals(data,50);assert.equal(h.length,1);assert.equal(h[0].start,data[0].date);assert.equal(h[0].distance,300);assert.equal(h[0].liters,30);assert.equal(h[0].efficiency,10);
});
test('nivel restante incompatible se advierte y no produce observación',()=>{
 const data=[f(0,{full:false,remaining:20,liters:10}),f(1,{full:false,remaining:90,liters:5,distance:100})];
 const r=observations(data,50);assert.equal(r.intervals.length,0);assert.ok(r.issues.length);assert.ok(analyze(v(data,{capacity:50})).warnings.some(w=>w.includes('no coincide')));
});
test('solo parciales sin nivel: tramos acumulados de al menos 80 L estiman consumo',()=>{
 const data=Array.from({length:7},(_,i)=>f(i,{full:false}));
 const h=intervals(data);assert.equal(h.length,2);assert.ok(h.every(o=>o.kind==='acumulado'&&o.weight===KIND_WEIGHT.acumulado));assert.equal(h[0].liters,90);assert.equal(h[0].efficiency,12);
 const a=analyze(v(data,{initialEfficiency:null}));assert.equal(a.model.efficiency,12);assert.equal(a.model.estimated,2);assert.equal(a.model.exact,0);
});
test('tramo acumulado exige dos tanques cuando se conoce la capacidad',()=>{
 const data=Array.from({length:4},(_,i)=>f(i,{full:false}));assert.equal(intervals(data).length,1);assert.equal(intervals(data,50).length,0);
});
test('tramo acumulado se corta si falta una distancia',()=>{
 const data=[f(0,{full:false}),f(1,{full:false}),f(2,{full:false,distance:null}),f(3,{full:false}),f(4,{full:false})];assert.equal(intervals(data).length,0);
});
test('los tramos acumulados no duplican litros ya usados entre llenos',()=>{
 const data=[f(0),f(1),f(2,{full:false}),f(3,{full:false}),f(4,{full:false}),f(5,{full:false})];
 const h=intervals(data);assert.deepEqual(h.map(o=>[o.kind,o.start,o.liters]),[['lleno',data[0].date,30],['acumulado',data[1].date,90]]);
});
test('las observaciones exactas pesan más que las estimadas en el promedio',()=>{
 const h:Interval[]=[{...obs(0,10),kind:'acumulado',weight:KIND_WEIGHT.acumulado},obs(1,14)];
 // pesos: 1×0.4 y 2×1 → (4 + 28) / 2.4
 assert.equal(model(h,'mixto',null).efficiency,(10*0.4+14*2)/2.4);
});
test('la regresión entrena y se activa con historial de cargas parciales',()=>{
 const data=Array.from({length:45},(_,i)=>f(i,{full:false,remaining:20,liters:30,distance:i?(i%2?540:240):null,distanceFrom:i?`f${i-1}`:null,route:i%2?'ciudad':'carretera'}));
 const a=analyze(v(data,{capacity:50}));assert.equal(a.intervals.length,44);assert.ok(a.intervals.every(o=>o.kind==='nivel'));assert.ok(a.model.used);assert.equal(a.model.method,'Regresión ridge');
});
