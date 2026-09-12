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
export type Interval={start:string;end:string;distance:number;liters:number;efficiency:number;route:Route;flag:boolean};
export function intervals(fills:Fill[]){
 const f=sorted(fills),result:Interval[]=[];let start=-1;
 for(let i=0;i<f.length;i++)if(f[i].full){
  if(start>=0){const a=f[start],b=f[i];let distance:number|null=null;
   if(a.odometer!==null&&b.odometer!==null)distance=b.odometer-a.odometer;
   else {const seg=f.slice(start+1,i+1).map((b,j)=>segment(f[start+j],b));if(seg.every(d=>d!==null))distance=(seg as number[]).reduce((a,b)=>a+b,0);}
   const liters=f.slice(start+1,i+1).reduce((s,b)=>s+b.liters,0);
   if(distance!==null&&distance>0&&liters>0){const efficiency=distance/liters;result.push({start:a.date,end:b.date,distance,liters,efficiency,route:a.route,flag:efficiency<3||efficiency>35});}
  }start=i;
 }
 return result;
}
export function weighted(y:number[]){const a=y.slice(-6);return a.length?a.reduce((s,n,i)=>s+n*(i+1),0)/(a.length*(a.length+1)/2):null;}
const mean=(a:number[])=>a.reduce((s,n)=>s+n,0)/a.length;
const sd=(a:number[])=>a.length?Math.sqrt(mean(a.map(n=>(n-mean(a))**2))):0;
function features(h:Interval[],route:Route){const y=h.slice(-6).map(o=>o.efficiency);return [1,(weighted(y)??0)/20,sd(y)/5,(y.at(-1)??0)/20,Number(route==='ciudad'),Number(route==='carretera'),Number(route==='mixto')];}
// Ridge: solve (X'X + lambda I)b = X'y with partial pivoting.
function fit(h:Interval[]){
 const p=7,a=Array.from({length:p},(_,i)=>Array.from({length:p+1},(_,j)=>i===j?(i===0?0.001:1):0));
 for(let i=3;i<h.length;i++){const x=features(h.slice(0,i),h[i].route),y=h[i].efficiency;for(let r=0;r<p;r++){for(let c=0;c<p;c++)a[r][c]+=x[r]*x[c];a[r][p]+=x[r]*y;}}
 for(let i=0;i<p;i++){let k=i;for(let j=i+1;j<p;j++)if(Math.abs(a[j][i])>Math.abs(a[k][i]))k=j;[a[i],a[k]]=[a[k],a[i]];const d=a[i][i];if(Math.abs(d)<1e-10)return null;for(let c=i;c<=p;c++)a[i][c]/=d;for(let r=0;r<p;r++)if(r!==i){const m=a[r][i];for(let c=i;c<=p;c++)a[r][c]-=m*a[i][c];}}
 return a.map(r=>r[p]);
}
const regress=(h:Interval[],route:Route)=>{const b=fit(h);return b?features(h,route).reduce((s,x,i)=>s+x*b[i],0):NaN;};
export function model(h:Interval[],route:Route,initial:number|null){
 const base=weighted(h.map(o=>o.efficiency))??initial;
 let baseMae:number|null=null,mlMae:number|null=null,used=false;const errors:number[]=[];
 if(h.length>=20){const b:number[]=[],m:number[]=[];
  for(let i=Math.max(12,h.length-12);i<h.length;i++){const prior=h.slice(0,i);b.push(Math.abs(h[i].efficiency-weighted(prior.map(o=>o.efficiency))!));m.push(Math.abs(h[i].efficiency-regress(prior,h[i].route)));}
  baseMae=mean(b);mlMae=mean(m);const candidate=regress(h,route);
  used=Number.isFinite(mlMae)&&baseMae>0&&mlMae<=baseMae*.9&&candidate>0&&candidate<=60&&!h.slice(-6).some(o=>o.flag);
  errors.push(...(used?m:b));
 }
 const efficiency=used?regress(h,route):base;
 // Empirical absolute-error band, never presented as a confidence probability.
 const band=errors.length>=8?[...errors].sort((a,b)=>a-b)[Math.ceil(errors.length*.8)-1]:null;
 const variation=h.length>1?sd(h.slice(-6).map(o=>o.efficiency))/mean(h.slice(-6).map(o=>o.efficiency)):null;
 return {efficiency,method:used?'Regresión ridge':h.length?'Promedio ponderado':'Supuestos iniciales',used,baseMae,mlMae,validationCount:errors.length,band,variation,quality:h.length<3?'Estimación inicial':h.slice(-6).some(o=>o.flag)?'Datos por revisar':variation!==null&&variation>.2?'Historial variable':h.length<8?'Historial en formación':'Historial consistente'};
}
export function daily(fills:Fill[],initial:number|null){const f=sorted(fills),points:{date:string;km:number;days:number;value:number}[]=[];for(let i=1;i<f.length;i++){const km=segment(f[i-1],f[i]),days=(Date.parse(f[i].date)-Date.parse(f[i-1].date))/DAY;if(km!==null&&km>=0&&days>0)points.push({date:f[i].date,km,days,value:km/days});}const recent=points.slice(-6);const d=recent.reduce((s,p,i)=>s+p.days*(i+1),0);return {value:d?recent.reduce((s,p,i)=>s+p.km*(i+1),0)/d:initial,points,source:d?'Historial de distancias y fechas':'Supuesto inicial'};}
export function forecast(liters:number,efficiency:number|null,kmDaily:number|null,date:string,price:number){const range=efficiency&&efficiency>0?liters*efficiency:null;const days=range!==null&&kmDaily&&kmDaily>0?range/kmDaily:null;const time=days!==null?Date.parse(date)+days*DAY:NaN;return {range,days,date:Number.isFinite(time)&&Math.abs(time)<=8.64e15?new Date(time).toISOString():null,cost:efficiency&&efficiency>0?price/efficiency:null};}
export function analyze(v:Vehicle,override:number|null=null){
 const fills=sorted(v.fills),last=fills.at(-1),h=intervals(fills);const m=model(h,last?.route??'sin-dato',v.initialEfficiency),d=daily(fills,v.initialDaily);const dailyValue=override!==null?override:d.value;
 const prediction=last?forecast(last.liters,m.efficiency,dailyValue,last.date,last.amount/last.liters):null;
 let fuel:number|null=null;
 if(last&&v.capacity&&last.liters<=v.capacity&&(last.remaining===null||v.capacity*last.remaining/100+last.liters<=v.capacity)){if(last.full)fuel=v.capacity;else if(last.remaining!==null&&v.capacity*last.remaining/100+last.liters<=v.capacity)fuel=v.capacity*last.remaining/100+last.liters;}
 const total=last&&fuel!==null?forecast(fuel,m.efficiency,dailyValue,last.date,last.amount/last.liters):null;
 const warnings:string[]=[];
 fills.forEach((f,i)=>{if(v.capacity&&f.liters>v.capacity)warnings.push(`Carga ${f.date}: los litros superan la capacidad del tanque.`);if(v.capacity&&f.remaining!==null&&f.liters+v.capacity*f.remaining/100>v.capacity)warnings.push(`Carga ${f.date}: el nivel restante y los litros superan la capacidad; revisa los datos.`);if(i&&segment(fills[i-1],f)===null)warnings.push(`Carga ${f.date}: falta la distancia desde la carga anterior; revisa la referencia tras editar o eliminar.`);if(i&&f.distance!==null&&fills[i-1].odometer!==null&&f.odometer!==null&&Math.abs(f.distance-(f.odometer-fills[i-1].odometer!))>2)warnings.push(`Carga ${f.date}: el odómetro difiere de la distancia manual; se usa el odómetro.`);});
 h.filter(o=>o.flag).forEach(o=>warnings.push(`Intervalo hasta ${o.end}: ${o.efficiency.toFixed(1)} km/L es atípico; se conserva para revisión.`));
 if(d.points.some(p=>p.value>500))warnings.push('Hay un uso superior a 500 km/día. Revisa fechas y distancias.');
 return {fills,last,intervals:h,model:m,daily:d,dailyValue,prediction,total,warnings};
}
