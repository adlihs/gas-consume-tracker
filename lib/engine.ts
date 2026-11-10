export type Route = 'ciudad' | 'carretera' | 'mixto' | 'sin-dato';
export type Fill = {id:string; date:string; liters:number; amount:number; currency:string; distance:number|null; distanceFrom:string|null; odometer:number|null; full:boolean; remaining:number|null; route:Route};
export type Vehicle = {id:string; name:string; brand:string; model:string; year:number|null; capacity:number|null; initialEfficiency:number|null; initialDaily:number|null; currency:string; units:'metric'|'imperial'; fills:Fill[]; revision:number};
export const DAY=86400000;
export const sorted=(f:Fill[])=>[...f].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
const positive=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>0;
export function validate(v:Vehicle,now=Date.now()) {
 if(!v || typeof v.name!=='string'||!v.name.trim()||v.name.length>80) throw Error('Escribe un nombre de vehículo de hasta 80 caracteres.');
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(v.id))throw Error('Identificador inválido.');
 for(const s of [v.brand,v.model]) if(typeof s!=='string'||s.length>80)throw Error('Marca o modelo inválido.');
 if(v.year!==null&&(!Number.isInteger(v.year)||v.year<1886||v.year>new Date(now).getFullYear()+1))throw Error('Revisa el año del vehículo.');
 for(const n of [v.capacity,v.initialEfficiency,v.initialDaily])if(n!==null&&!positive(n))throw Error('Los supuestos y la capacidad deben ser positivos o quedar vacíos.');
 if(!['metric','imperial'].includes(v.units))throw Error('Unidades inválidas.');
 const currency=(c:string)=>{try{if(!/^[A-Z]{3}$/.test(c))throw Error();new Intl.NumberFormat('es',{style:'currency',currency:c});}catch{throw Error('Usa un código de moneda de tres letras, por ejemplo MXN.');}};currency(v.currency);
 if(!Array.isArray(v.fills)||v.fills.length>3000)throw Error('Máximo 3000 cargas por vehículo.');
 let prevTime=-Infinity,odo=-Infinity;const ids=new Set();
 for(const f of sorted(v.fills)){
  if(typeof f.id!=='string'||ids.has(f.id))throw Error('Identificador de carga duplicado.');ids.add(f.id);
  const t=Date.parse(f.date);if(!Number.isFinite(t)||t>now+60000||t<=prevTime)throw Error('Las fechas deben ser diferentes y no pueden estar en el futuro.');prevTime=t;
  if(!positive(f.liters)||!positive(f.amount))throw Error('Los litros y el monto deben ser mayores que cero.');currency(f.currency);
  if(f.odometer!==null){if(!Number.isFinite(f.odometer)||f.odometer<0||f.odometer<=odo)throw Error('El odómetro debe aumentar entre lecturas.');odo=f.odometer;}
  if(f.distance!==null&&(!Number.isFinite(f.distance)||f.distance<0))throw Error('La distancia no puede ser negativa.');
  if(f.remaining!==null&&(!Number.isFinite(f.remaining)||f.remaining<0||f.remaining>100))throw Error('El nivel restante debe estar entre 0 y 100 %.');
  if(typeof f.full!=='boolean'||!['ciudad','carretera','mixto','sin-dato'].includes(f.route))throw Error('Revisa el tipo de recorrido y tanque lleno.');
 }
}
export function segment(a:Fill,b:Fill):number|null {
 if(a.odometer!==null&&b.odometer!==null)return b.odometer-a.odometer;
 return b.distanceFrom===a.id?b.distance:null;
}
/**
 * Tipos de observación de consumo:
 * - lleno: entre dos tanques llenos. Exacta (salvo errores de llenado).
 * - nivel: al menos un extremo es una carga parcial con nivel restante declarado; requiere capacidad.
 *          Depende de la lectura aproximada del indicador, por eso pesa menos.
 * - acumulado: tramo de cargas parciales sin nivel conocido. Litros comprados ≈ litros consumidos
 *          cuando el tramo es largo; el error está acotado por la variación del nivel del tanque.
 */
export type ObsKind='lleno'|'nivel'|'acumulado';
export const KIND_WEIGHT:Record<ObsKind,number>={lleno:1,nivel:0.6,acumulado:0.4};
export const KIND_LABEL:Record<ObsKind,string>={lleno:'Tanque lleno',nivel:'Nivel declarado',acumulado:'Parciales acumuladas'};
/** Consumo mínimo, como fracción de la capacidad, para aceptar una observación por nivel. */
export const MIN_LEVEL_SHARE=0.15;
/** Litros mínimos de un tramo acumulado: 2 tanques si se conoce la capacidad; si no, 80 L. */
export const cumulativeLiters=(capacity:number|null)=>capacity?2*capacity:80;
export const MIN_CUMULATIVE_FILLS=3;
export type Interval={start:string;end:string;distance:number;liters:number;efficiency:number;route:Route;flag:boolean;kind:ObsKind;weight:number};
/** Distancia entre las cargas a y b (índices en orden cronológico). */
function distanceBetween(f:Fill[],a:number,b:number):number|null{
 if(f[a].odometer!==null&&f[b].odometer!==null)return f[b].odometer!-f[a].odometer!;
 let total=0;for(let k=a+1;k<=b;k++){const d=segment(f[k-1],f[k]);if(d===null)return null;total+=d;}return total;
}
/**
 * Litros en el tanque antes y después de una carga, cuando se pueden conocer.
 * Sin capacidad, un tanque lleno usa un nivel simbólico 0: entre dos llenos la capacidad se cancela.
 */
function tankLevel(x:Fill,capacity:number|null):{before:number;after:number}|null{
 if(x.full){const cap=capacity??0;return {before:cap-x.liters,after:cap};}
 if(capacity&&x.remaining!==null){const before=capacity*x.remaining/100;return {before,after:before+x.liters};}
 return null;
}
export function observations(fills:Fill[],capacity:number|null=null){
 const f=sorted(fills),result:Interval[]=[],issues:string[]=[],covered=new Set<number>();
 const push=(a:number,b:number,distance:number,liters:number,kind:ObsKind)=>{const efficiency=distance/liters;result.push({start:f[a].date,end:f[b].date,distance,liters,efficiency,route:f[a].route,flag:efficiency<3||efficiency>35,kind,weight:KIND_WEIGHT[kind]});for(let k=a+1;k<=b;k++)covered.add(k);};
 // 1) Observaciones entre cargas con nivel conocido (llenos y parciales con nivel restante).
 let anchor=-1;
 for(let j=0;j<f.length;j++){
  const end=tankLevel(f[j],capacity);if(!end)continue;
  if(anchor<0){anchor=j;continue;}
  const start=tankLevel(f[anchor],capacity)!,between=f.slice(anchor+1,j).reduce((s,x)=>s+x.liters,0);
  const liters=start.after+between-end.before,distance=distanceBetween(f,anchor,j);
  if(f[anchor].full&&f[j].full){if(distance!==null&&distance>0&&liters>0)push(anchor,j,distance,liters,'lleno');anchor=j;continue;}
  if(liters<=0){issues.push(`Carga ${f[j].date}: el nivel restante no coincide con los litros cargados desde la referencia anterior; no se usa para medir consumo.`);anchor=j;continue;}
  // Muy poco consumo: el error del indicador domina. Se conserva la referencia anterior y se espera más recorrido.
  if(liters<MIN_LEVEL_SHARE*capacity!)continue;
  if(distance!==null&&distance>0)push(anchor,j,distance,liters,'nivel');
  anchor=j;
 }
 // 2) Tramos de cargas parciales no cubiertos por el paso anterior.
 const chunk=cumulativeLiters(capacity);let s=0,dist=0,lit=0;
 for(let k=1;k<f.length;k++){
  const d=covered.has(k)?null:segment(f[k-1],f[k]);
  if(d===null||d<0){s=k;dist=0;lit=0;continue;}
  dist+=d;lit+=f[k].liters;
  if(lit>=chunk&&k-s>=MIN_CUMULATIVE_FILLS&&dist>0){push(s,k,dist,lit,'acumulado');s=k;dist=0;lit=0;}
 }
 result.sort((a,b)=>Date.parse(a.end)-Date.parse(b.end));
 return {intervals:result,issues};
}
export const intervals=(fills:Fill[],capacity:number|null=null)=>observations(fills,capacity).intervals;
/** Media ponderada de los últimos 6 valores: peso de recencia (1…n) × peso por tipo de observación. */
export function weighted(y:number[],w?:number[]){const a=y.slice(-6),ws=(w??y.map(()=>1)).slice(-6);let num=0,den=0;a.forEach((n,i)=>{const k=(i+1)*ws[i];num+=n*k;den+=k;});return a.length&&den>0?num/den:null;}
const base=(h:Interval[])=>weighted(h.map(o=>o.efficiency),h.map(o=>o.weight));
const mean=(a:number[])=>a.reduce((s,n)=>s+n,0)/a.length;
const sd=(a:number[])=>a.length?Math.sqrt(mean(a.map(n=>(n-mean(a))**2))):0;
function features(h:Interval[],route:Route){const r=h.slice(-6),y=r.map(o=>o.efficiency);return [1,(weighted(y,r.map(o=>o.weight))??0)/20,sd(y)/5,(y.at(-1)??0)/20,Number(route==='ciudad'),Number(route==='carretera'),Number(route==='mixto')];}
// Ridge ponderada: resuelve (X'WX + lambda I)b = X'Wy con pivoteo parcial; W = peso por tipo de observación.
function fit(h:Interval[]){
 const p=7,a=Array.from({length:p},(_,i)=>Array.from({length:p+1},(_,j)=>i===j?(i===0?0.001:1):0));
 for(let i=3;i<h.length;i++){const x=features(h.slice(0,i),h[i].route),y=h[i].efficiency,w=h[i].weight;for(let r=0;r<p;r++){for(let c=0;c<p;c++)a[r][c]+=w*x[r]*x[c];a[r][p]+=w*x[r]*y;}}
 for(let i=0;i<p;i++){let k=i;for(let j=i+1;j<p;j++)if(Math.abs(a[j][i])>Math.abs(a[k][i]))k=j;[a[i],a[k]]=[a[k],a[i]];const d=a[i][i];if(Math.abs(d)<1e-10)return null;for(let c=i;c<=p;c++)a[i][c]/=d;for(let r=0;r<p;r++)if(r!==i){const m=a[r][i];for(let c=i;c<=p;c++)a[r][c]-=m*a[i][c];}}
 return a.map(r=>r[p]);
}
const regress=(h:Interval[],route:Route)=>{const b=fit(h);return b?features(h,route).reduce((s,x,i)=>s+x*b[i],0):NaN;};
export function model(h:Interval[],route:Route,initial:number|null){
 const baseValue=base(h)??initial;
 let baseMae:number|null=null,mlMae:number|null=null,used=false;const errors:number[]=[];
 if(h.length>=20){const b:number[]=[],m:number[]=[];
  for(let i=Math.max(12,h.length-12);i<h.length;i++){const prior=h.slice(0,i);b.push(Math.abs(h[i].efficiency-base(prior)!));m.push(Math.abs(h[i].efficiency-regress(prior,h[i].route)));}
  baseMae=mean(b);mlMae=mean(m);const candidate=regress(h,route);
  used=Number.isFinite(mlMae)&&baseMae>0&&mlMae<=baseMae*.9&&candidate>0&&candidate<=60&&!h.slice(-6).some(o=>o.flag);
  errors.push(...(used?m:b));
 }
 const efficiency=used?regress(h,route):baseValue;
 const recent=h.slice(-6),estimated=h.filter(o=>o.kind!=='lleno').length;
 // Empirical absolute-error band, never presented as a confidence probability.
 const band=errors.length>=8?[...errors].sort((a,b)=>a-b)[Math.ceil(errors.length*.8)-1]:null;
 const variation=h.length>1?sd(h.slice(-6).map(o=>o.efficiency))/mean(h.slice(-6).map(o=>o.efficiency)):null;
 return {efficiency,method:used?'Regresión ridge':h.length?'Promedio ponderado':'Supuestos iniciales',usesPartials:recent.some(o=>o.kind!=='lleno'),exact:h.length-estimated,estimated,used,baseMae,mlMae,validationCount:errors.length,band,variation,quality:h.length<3?'Estimación inicial':h.slice(-6).some(o=>o.flag)?'Datos por revisar':variation!==null&&variation>.2?'Historial variable':h.length<8?'Historial en formación':'Historial consistente'};
}
export function daily(fills:Fill[],initial:number|null){const f=sorted(fills),points:{date:string;km:number;days:number;value:number}[]=[];for(let i=1;i<f.length;i++){const km=segment(f[i-1],f[i]),days=(Date.parse(f[i].date)-Date.parse(f[i-1].date))/DAY;if(km!==null&&km>=0&&days>0)points.push({date:f[i].date,km,days,value:km/days});}const recent=points.slice(-6);const d=recent.reduce((s,p,i)=>s+p.days*(i+1),0);return {value:d?recent.reduce((s,p,i)=>s+p.km*(i+1),0)/d:initial,points,source:d?'Historial de distancias y fechas':'Supuesto inicial'};}
export function forecast(liters:number,efficiency:number|null,kmDaily:number|null,date:string,price:number){const range=efficiency&&efficiency>0?liters*efficiency:null;const days=range!==null&&kmDaily&&kmDaily>0?range/kmDaily:null;const time=days!==null?Date.parse(date)+days*DAY:NaN;return {range,days,date:Number.isFinite(time)&&Math.abs(time)<=8.64e15?new Date(time).toISOString():null,cost:efficiency&&efficiency>0?price/efficiency:null};}
export function analyze(v:Vehicle,override:number|null=null){
 const fills=sorted(v.fills),last=fills.at(-1),{intervals:h,issues}=observations(fills,v.capacity);const m=model(h,last?.route??'sin-dato',v.initialEfficiency),d=daily(fills,v.initialDaily);const dailyValue=override!==null?override:d.value;
 const prediction=last?forecast(last.liters,m.efficiency,dailyValue,last.date,last.amount/last.liters):null;
 let fuel:number|null=null;
 if(last&&v.capacity&&last.liters<=v.capacity&&(last.remaining===null||v.capacity*last.remaining/100+last.liters<=v.capacity)){if(last.full)fuel=v.capacity;else if(last.remaining!==null&&v.capacity*last.remaining/100+last.liters<=v.capacity)fuel=v.capacity*last.remaining/100+last.liters;}
 const total=last&&fuel!==null?forecast(fuel,m.efficiency,dailyValue,last.date,last.amount/last.liters):null;
 const warnings:string[]=[];
 fills.forEach((f,i)=>{if(v.capacity&&f.liters>v.capacity)warnings.push(`Carga ${f.date}: los litros superan la capacidad del tanque.`);if(v.capacity&&f.remaining!==null&&f.liters+v.capacity*f.remaining/100>v.capacity)warnings.push(`Carga ${f.date}: el nivel restante y los litros superan la capacidad; revisa los datos.`);if(i&&segment(fills[i-1],f)===null)warnings.push(`Carga ${f.date}: falta la distancia desde la carga anterior; revisa la referencia tras editar o eliminar.`);if(i&&f.distance!==null&&fills[i-1].odometer!==null&&f.odometer!==null&&Math.abs(f.distance-(f.odometer-fills[i-1].odometer!))>2)warnings.push(`Carga ${f.date}: el odómetro difiere de la distancia manual; se usa el odómetro.`);});
 warnings.push(...issues);
 h.filter(o=>o.flag).forEach(o=>warnings.push(`Intervalo hasta ${o.end}: ${o.efficiency.toFixed(1)} km/L es atípico; se conserva para revisión.`));
 if(d.points.some(p=>p.value>500))warnings.push('Hay un uso superior a 500 km/día. Revisa fechas y distancias.');
 return {fills,last,intervals:h,model:m,daily:d,dailyValue,prediction,total,warnings};
}
