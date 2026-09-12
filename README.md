# Ruta · Control de gasolina

MVP responsive en español para registrar vehículos, cargas y estimaciones. No requiere claves de IA ni servicios de predicción. Los registros reales empiezan vacíos; el botón **Explorar demostración** abre datos ficticios aislados, sin escribirlos en la base de datos.

## Arquitectura

- **Frontend:** React 19, TypeScript, Vinext/Vite, componentes accesibles Radix/Shadcn y CSS responsive. Una superficie con Inicio, Historial, Estadísticas, Ajustes y formularios de vehículo/carga.
- **Backend:** rutas HTTP ejecutadas en Cloudflare Workers. `GET /api/garage` obtiene los vehículos del usuario; `PUT /api/garage` crea o reemplaza un agregado de vehículo con validación y control de revisión.
- **Persistencia:** SQLite en Cloudflare D1; esquema y migración Drizzle incluidos. Cada fila contiene un vehículo con su historial JSON y una revisión. El agregado permite cambiar registros y referencias atómicamente. Índice por propietario, consultas preparadas y control optimista impiden sobrescrituras silenciosas. Un `409` pide recargar ante una versión desactualizada.
- **Predicción:** módulo TypeScript puro compartido entre frontend y backend. Promedio ponderado y regresión ridge real, sin dependencia de un servicio externo. El backend vuelve a validar y calcular; los valores derivados no se aceptan del cliente como fuente de verdad.
- **Identidad:** el despliegue privado usa la identidad autenticada de Sites. Cada operación filtra por el identificador estable del propietario. La cabecera de identidad solo es de confianza detrás del dispatcher de Sites; no publiques este Worker directamente en otro proxy sin implementar autenticación equivalente.

Esta elección mantiene una sola implementación de las fórmulas, reduce infraestructura y permite comprobar el motor sin navegador ni red.

## Archivos relevantes

| Componente | Ubicación |
|---|---|
| Interfaz y formularios | `app/page.tsx` |
| Estilos responsive | `app/globals.css` |
| Ruta backend | `app/api/garage/route.ts` |
| Validación HTTP y persistencia | `lib/garage-api.ts`, `db/raw.ts` |
| Motor de cálculos y regresión | `lib/engine.ts` |
| Demostración identificada | `lib/demo.ts` |
| Esquema | `db/schema.ts` |
| Migración inicial | `drizzle/0000_youthful_scrambler.sql` |
| Pruebas del motor y API/SQLite | `tests/engine.test.ts`, `tests/api.test.ts` |

## Ejecutar en una computadora

Requisitos: Node.js **24 LTS** (incluye SQLite para las pruebas), pnpm **11.25.0** y Git si se obtiene el código desde el repositorio. El proyecto incluye `pnpm-lock.yaml`; no cambies de gestor al instalar.

```sh
pnpm install --frozen-lockfile
pnpm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_youthful_scrambler.sql
pnpm run dev
```

Abre la dirección local que imprime el servidor (habitualmente `http://localhost:5173`). En modo portable, visita primero `/signin-with-chatgpt?return_to=/` en ese mismo origen para usar la identidad simulada de desarrollo. Esta simulación solo se habilita en loopback durante desarrollo y no se incluye en producción. No establezcas `SITES_MANAGED_LINUX_CONTAINER=1` en tu computadora. La configuración de perfil local no se incluye en el ZIP.

La migración anterior se aplica **una sola vez** a cada base local nueva. La base persiste en `.wrangler/state`. No borres esa carpeta si quieres conservar datos locales. Para arrancar el Worker compilado con Wrangler usa `pnpm start`; ese comando no simula identidad. Para la interfaz con identidad local usa `pnpm run dev`.

El despliegue en Sites provisiona D1 y aplica las migraciones antes de publicar. `.openai/hosting.json` declara `DB`; no contiene credenciales. Para cambios posteriores al esquema:

```sh
pnpm run db:generate
```

Revisa y aplica únicamente las nuevas migraciones. No modifiques migraciones ya aplicadas.

## Pruebas

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm run build
```

24 pruebas automatizadas cubren: aceptación, primer registro, ausencia de supuestos, parciales, suma de litros sin duplicar, odómetro, distancia faltante, edición, eliminación, cambios de fecha, autonomía total, rutina sin mutar historial, divisiones por cero, validación, independencia del precio, activación/rechazo de ML y predicción de prefijos. Las pruebas de API ejecutan las consultas reales sobre SQLite en un archivo temporal, lo cierran y reabren para verificar persistencia, y prueban propiedad, revisiones, ediciones y errores HTTP.

No se ejecutó una prueba visual ni end-to-end en navegador. La integración WebMCP opcional expone una consulta de solo lectura cuando el navegador la admite; no se pudo verificar en un contexto WebMCP compatible. No es necesaria para usar la aplicación.

## Tipo de carga

Al registrar gasolina se debe elegir explícitamente **Tanque lleno** o **Tanque parcial**; no se preselecciona ninguna opción nueva. Al editar, se conserva la elección guardada. El valor `full` determina los límites de los intervalos que alimentan el promedio y la regresión. Una carga parcial aporta sus litros al intervalo abierto y permite estimar el alcance añadido, pero por sí sola no crea una observación de consumo. Cambiar esta opción recalcula intervalos, entrenamiento y estimaciones.

## Consumo fiable

Ordenamos las cargas por fecha. Entre dos llenados completos consecutivos:

1. Excluimos los litros del llenado inicial.
2. Sumamos los litros comprados después de él, incluyendo cargas parciales y el llenado final.
3. Usamos la diferencia de odómetros de los extremos cuando ambos existen; de lo contrario, sumamos las distancias de todos los segmentos. Un segmento usa primero odómetros consecutivos y, si no existen, la distancia manual vinculada a su carga anterior.
4. Rendimiento = distancia del intervalo / litros repuestos.
5. El llenado final pasa a ser el inicio del siguiente intervalo. Los litros no se duplican.

Un intervalo con distancia desconocida o no positiva no produce una observación de consumo. Los registros permanecen guardados. La distancia manual almacena `distanceFrom`: al borrar, insertar o reordenar cargas, una distancia no se reasigna a otra referencia en silencio. La interfaz pide revisar/reingresar la distancia afectada. Si hay odómetros de los extremos, se puede recuperar la distancia total aun con parciales sin distancia.

Ejemplo: lleno inicial de 50 L; parcial de 10 L tras 100 km; lleno de 20 L tras 260 km. Consumo observado = (100 + 260) / (10 + 20) = **12 km/L**. Los 50 L iniciales no entran en el denominador.

## Estimaciones

- Alcance de esta carga = litros añadidos × km/L estimados.
- Días de esos litros = alcance / km diarios estimados.
- Fecha probable = fecha/hora de carga + días × 24 horas.
- Costo estimado por km = (monto / litros) / km/L.
- Autonomía total solo si se declara capacidad y tanque lleno, o capacidad y porcentaje restante antes de cargar. En este último caso se suman los litros añadidos. Información físicamente incompatible produce advertencia y suprime autonomía total.

Los cálculos no representan combustible actual: describen la situación al cargar. Cuando no se conoce el restante, la fecha corresponde a los litros añadidos; el combustible preexistente podría extenderla. No se fija una reserva de seguridad. El ajuste de rutina modifica solo la exploración visible, no las distancias ni el historial.

**Aceptación:** 12 km/L × 30 L = **360 km**; 360 / 40 km/día = **9 días**. La demostración mantiene esos valores. Su historial es sintético y no activa una regresión entrenada con datos de un usuario real.

Se almacenan km y litros. Ajustes puede mostrar millas y galones estadounidenses (1 mi = 1.609344 km; 1 gal US = 3.785411784 L). Al cambiar unidades, los valores del formulario conservan sus unidades indicadas hasta guardar. La auditoría conserva km y L para verificar las fórmulas. El gasto se agrupa por moneda sin conversiones de divisas. Cambiar moneda predeterminada no cambia monedas de cargas anteriores.

## Evolución del modelo

### Inicio y método base

Sin intervalos válidos, se usa el rendimiento inicial proporcionado. Si falta, no hay alcance ni costo por km. Con observaciones válidas, se usa la media móvil ponderada de los últimos **6** rendimientos, con pesos 1…n del más antiguo al reciente. Menos de 3 intervalos se identifica como estimación inicial.

El uso diario se aprende por separado de hasta 6 segmentos con distancia conocida y tiempo positivo: suma(km × peso de recencia) / suma(días × peso de recencia). Esto evita dar el mismo peso a un segmento de pocas horas que a uno de muchos días. Los periodos sin viajes sí cuentan como tiempo si su distancia es conocida. Sin segmentos se usa el supuesto inicial; si falta o el uso observado es 0, no se calcula una fecha.

### Regresión real

Se ajusta una regresión lineal ridge por vehículo mediante ecuaciones normales con pivoteo parcial, penalización 1 para características y 0.001 para intercepto. Entrenamiento determinista con observaciones de índice 3 en adelante. Características para cada observación:

- media ponderada de los últimos 6 rendimientos anteriores / 20;
- desviación estándar reciente / 5;
- último rendimiento anterior / 20;
- indicadores de ciudad, carretera y mixto registrados al **inicio** del intervalo;
- intercepto.

El campo de recorrido se explica como referencia de la conducción esperada después de cargar. No se usan litros, distancia, rendimiento ni precio del intervalo por predecir como características; solo el rendimiento es su etiqueta una vez cerrado. El monto no es causa del rendimiento físico.

Con **20 o más intervalos**, se comparan métodos mediante walk-forward: para cada índice desde `max(12, n−12)` hasta n−1, se reentrena con el prefijo anterior y se predice el siguiente intervalo. Ambos métodos usan exactamente los mismos puntos. Se evalúan entre 8 y 12 predicciones temporales.

ML se activa únicamente si:

- su MAE es finito y al menos un **10 % menor** que el MAE del método base;
- el MAE base es mayor que cero;
- la predicción actual es positiva y no supera 60 km/L;
- ninguno de los últimos 6 intervalos está marcado como atípico.

De lo contrario se conserva el método base. La evaluación se vuelve a ejecutar cuando el historial cambia; no se simula un estado de entrenamiento ni se persisten modelos obsoletos. Los coeficientes se recalculan con el historial del vehículo, con un límite de 3000 cargas y 1.5 MB por actualización.

### Calidad, rango y límites

La calidad es descriptiva: menos de 3 intervalos, inicial; 3–7, en formación; con más datos, consistente si la variación relativa reciente no supera 20 %. Se señala historial variable por encima de ese umbral y se pide revisión si hay atípicos recientes. Son reglas del MVP, **no porcentajes de confianza**.

Solo con al menos 8 errores temporales se muestra una banda empírica: predicción de km/L ± percentil 80 de los errores absolutos del método seleccionado, multiplicado por litros y truncado inferiormente en 0. No es un intervalo de confianza calibrado ni garantiza cobertura futura; la selección del modelo usa esa misma validación y el tamaño de muestra es pequeño. No se muestra un rango de días/fechas porque no se ha calibrado la incertidumbre del uso diario.

Los rendimientos inferiores a 3 o superiores a 35 km/L se marcan para revisión y **se conservan**, incluso en la base. También se advierte de consumos mayores que la capacidad, nivel restante incompatible, discrepancias entre odómetro y distancia, referencias faltantes y usos superiores a 500 km/día. Ningún dato se borra silenciosamente.

Los llenados incompletos marcados como completos, errores de odómetro, estimaciones del nivel de tanque, tráfico, carga transportada y cambios de rutina pueden sesgar resultados. No hay telemetría, pronóstico meteorológico ni garantía de combustible restante. Futuras mejoras: confirmación explícita de atípicos, validación independiente adicional y calibración conjunta de consumo y uso diario.
