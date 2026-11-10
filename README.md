# Ruta · Gas consume tracker

Aplicación responsive en español con vehículos, cargas de gasolina, estimaciones verificables y sesiones privadas por usuario. Esta versión está preparada para **Cloudflare Workers + D1**, con inicio de sesión mediante Google independiente de ChatGPT.

## Estado de esta entrega

- Registro automático al entrar con Google, firma del ID token comprobada, sesiones persistidas y cierre de sesión.
- Historial filtrado por propietario en cada lectura y escritura. Se ignoran cabeceras de identidad externas.
- 45 pruebas de cálculos, API y OAuth; 1 prueba adicional del Worker compilado con D1 local y dos cuentas aisladas.
- Compilación y comprobación TypeScript correctas; ambas migraciones aplicadas en D1 local.
- **No se ha desplegado esta versión en una cuenta Cloudflare real.** Faltan la conexión de la cuenta y las credenciales OAuth. Las pruebas de OAuth usan un proveedor simulado con tokens RSA firmados. No sustituyen una prueba con cuentas Google reales.

La versión privada anterior de ChatGPT Sites conserva sus propios datos. Este cambio no copia esos registros a D1 en tu cuenta ni los asocia automáticamente a cuentas de Google.

## Desplegar en Cloudflare

Consulta [DEPLOY-CLOUDFLARE.md](./DEPLOY-CLOUDFLARE.md) para el recorrido completo, los secretos y las instrucciones de despliegue automático desde GitHub.

Requisitos locales: Node.js 24 LTS, pnpm 11.25.0 y acceso a tu cuenta Cloudflare.

```sh
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm run cf:setup -- --origin https://gas-consume-tracker.TU-SUBDOMINIO.workers.dev
pnpm exec wrangler secret put GOOGLE_CLIENT_ID --config wrangler.jsonc
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.jsonc
pnpm run cf:deploy
```

`cf:setup` reutiliza o crea una base llamada `gas-consume-tracker` y configura el origen público. Los secretos se introducen de forma interactiva en Wrangler. No los pegues en el código ni los subas a GitHub. `cf:deploy` comprueba configuración y secretos, ejecuta pruebas, compila, aplica migraciones, publica y consulta el estado del acceso. El identificador D1 del archivo original es **solo un marcador local** y el script impide desplegarlo.

## Desarrollo y pruebas

```sh
pnpm install --frozen-lockfile
pnpm run cf:migrate:local
# Copia .dev.vars.example a .dev.vars y completa las credenciales OAuth locales.
pnpm run dev
```

Para desarrollo, `wrangler.jsonc` debe tener `APP_ORIGIN: http://localhost:5173` y `ALLOW_HTTP_LOCALHOST: true`. El cliente Google debe permitir `http://localhost:5173/api/auth/callback`. No hay un usuario simulado ni una vía de acceso sin autenticación en la aplicación; sin credenciales puedes explorar la demostración.

```sh
pnpm test
pnpm run typecheck
pnpm run build
pnpm run test:worker
```

`pnpm test` ejecuta 45 pruebas. `test:worker` ejecuta el artefacto compilado con Miniflare/workerd y D1 aislada, con sesiones de prueba sembradas únicamente dentro de esa prueba. Ninguno de estos tests añade cuentas o rutas de acceso de prueba a producción. La base de desarrollo persiste en `.wrangler/state` y nunca se sube a GitHub.

## Arquitectura

| Componente | Implementación |
|---|---|
| Interfaz responsive | React, TypeScript, Vinext/Vite, Radix/Shadcn |
| Entrada Cloudflare | `worker/index.ts`, `wrangler.jsonc` |
| API de vehículos | `app/api/garage/route.ts`, `lib/garage-api.ts` |
| OAuth y sesiones | `app/api/auth/[action]/route.ts`, `lib/auth.ts` |
| Motor predictivo | `lib/engine.ts` |
| Base de datos | D1/SQLite, esquema Drizzle en `db/schema.ts` |
| Migraciones | `drizzle/0000_*.sql` y `drizzle/0001_*.sql` |
| Despliegue | `scripts/cloudflare-setup.mjs`, `scripts/cloudflare-deploy.mjs` |

Cada vehículo y su historial se guardan como un agregado JSON con revisión. Una modificación es atómica y un conflicto de revisión devuelve HTTP 409. Las consultas usan parámetros y siempre restringen por propietario. No se acepta un identificador de propietario desde el navegador.

## Autenticación

Google OAuth Authorization Code con PKCE S256, `state` vinculado al navegador, `nonce`, caducidad y consumo único del intento. El backend valida firma RSA, emisor, audiencia, vencimiento, nonce y correo verificado del ID token. La identidad estable se toma de Google `sub`, no del correo; no se enlazan cuentas por coincidencia de email.

Las sesiones usan tokens aleatorios de 256 bits. D1 almacena sus hashes SHA-256, no los tokens; la cookie de producción es `__Host-ruta_session`, `Secure`, `HttpOnly`, `SameSite=Lax` y caduca en 7 días. Cerrar sesión revoca el token. Las escrituras exigen el origen configurado. El inicio de OAuth limita intentos por dirección de Cloudflare y ventana temporal. No se guardan contraseñas ni access/refresh tokens de Google. Las tablas guardan nombre, correo y el identificador Google mínimo para la cuenta.

La implementación usa Web Crypto del runtime y los endpoints oficiales; no depende de una clave de IA. Referencia del protocolo: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

## Migraciones y datos existentes

`cf:deploy` aplica únicamente migraciones pendientes con Wrangler. No reescribas migraciones ya aplicadas; genera nuevas con `pnpm run db:generate`. Las cuentas y sesiones se agregan en la segunda migración sin cambiar registros de vehículos existentes. Si migras una base con propietarios de ChatGPT, habrá que hacer una asociación explícita y verificada; esos registros no se exponen a cuentas nuevas.

## Tipo de carga

Al registrar gasolina se debe elegir explícitamente **Tanque lleno** o **Tanque parcial**; no se preselecciona ninguna opción nueva. Al editar, se conserva la elección guardada. El valor `full`, junto con el nivel restante y la capacidad del tanque, determina las observaciones de consumo que alimentan el promedio y la regresión. **No se requieren tanques llenos para predecir:** las cargas parciales también generan observaciones (ver *Observaciones con cargas parciales*). Cambiar esta opción recalcula observaciones, entrenamiento y estimaciones.

## Consumo fiable

Ordenamos las cargas por fecha. Entre dos llenados completos consecutivos:

1. Excluimos los litros del llenado inicial.
2. Sumamos los litros comprados después de él, incluyendo cargas parciales y el llenado final.
3. Usamos la diferencia de odómetros de los extremos cuando ambos existen; de lo contrario, sumamos las distancias de todos los segmentos. Un segmento usa primero odómetros consecutivos y, si no existen, la distancia manual vinculada a su carga anterior.
4. Rendimiento = distancia del intervalo / litros repuestos.
5. El llenado final pasa a ser el inicio del siguiente intervalo. Los litros no se duplican.

Un intervalo con distancia desconocida o no positiva no produce una observación de consumo. Los registros permanecen guardados. La distancia manual almacena `distanceFrom`: al borrar, insertar o reordenar cargas, una distancia no se reasigna a otra referencia en silencio. La interfaz pide revisar/reingresar la distancia afectada. Si hay odómetros de los extremos, se puede recuperar la distancia total aun con parciales sin distancia.

Ejemplo: lleno inicial de 50 L; parcial de 10 L tras 100 km; lleno de 20 L tras 260 km. Consumo observado = (100 + 260) / (10 + 20) = **12 km/L**. Los 50 L iniciales no entran en el denominador.

## Observaciones con cargas parciales

Además de los intervalos entre tanques llenos, el motor (`observations()` en `lib/engine.ts`) crea observaciones estimadas con cargas parciales. Cada observación tiene un tipo y un peso:

| Tipo | Cuándo se crea | Peso |
|---|---|---|
| `lleno` | Entre dos tanques llenos (método anterior, sin cambios). | 1 |
| `nivel` | Al menos un extremo es una carga parcial con **nivel restante antes de cargar** y el vehículo tiene **capacidad** declarada. | 0.6 |
| `acumulado` | Tramo de cargas parciales sin nivel conocido. | 0.4 |

**Por nivel.** Cada carga con nivel conocido es una referencia: un lleno deja el tanque en la capacidad y tenía `capacidad − litros` antes; una parcial tenía `capacidad × restante %` y queda con eso más los litros. Consumo = nivel después de la referencia + litros intermedios − nivel antes de la siguiente referencia. Entre dos llenos la capacidad se cancela y el resultado es idéntico al método anterior. Si el consumo es menor que 15 % de la capacidad, el error del indicador dominaría: se conserva la referencia anterior y se espera más recorrido. Un consumo cero o negativo (niveles incompatibles) genera una advertencia y no se usa.

**Acumulado.** En las cargas no cubiertas por los métodos anteriores, se suman distancias y litros (excluyendo la carga inicial del tramo) hasta reunir al menos **2 tanques** de litros (80 L si no hay capacidad) y 3 cargas. Los litros comprados se aproximan a los consumidos; el sesgo está acotado por la diferencia de nivel del tanque entre los extremos, que se diluye en tramos largos. Una distancia faltante corta el tramo. Ningún litro se cuenta en dos observaciones.

Los pesos multiplican el peso de recencia en el promedio ponderado (`peso = posición × peso del tipo`) y se usan como pesos de muestra en la regresión ridge (`X'WX`). La validación walk-forward y los criterios de activación de ML no cambian; con 20 o más observaciones de cualquier tipo, la regresión puede activarse con un historial solo de cargas parciales. La interfaz indica cuántas observaciones son exactas y cuántas estimadas, y la auditoría muestra el tipo y peso de cada una. Registrar el nivel restante en las cargas parciales es la forma más precisa de mejorar las estimaciones sin llenar el tanque.

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

Sin observaciones válidas, se usa el rendimiento inicial proporcionado. Si falta, no hay alcance ni costo por km. Con observaciones válidas, se usa la media móvil ponderada de los últimos **6** rendimientos, con pesos 1…n del más antiguo al reciente. Menos de 3 intervalos se identifica como estimación inicial.

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

## Versión alternativa en Streamlit

La implementación Python independiente está en [streamlit_app](./streamlit_app/README.md), con SQLite, cálculos verificables, regresión ridge y pruebas. Para ejecutarla: instala sus dependencias y ejecuta `python run_local.py` desde esa carpeta.
