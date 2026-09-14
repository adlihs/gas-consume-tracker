# Ruta · versión Streamlit

Aplicación independiente en español para vehículos, cargas de gasolina y estimaciones verificables. Convive con la versión React/Cloudflare del directorio raíz. **No comparte automáticamente sus usuarios ni su base de datos.**

## Arquitectura

Python 3.12 + Streamlit 1.63 para formularios, navegación y gráficos; SQLite para persistencia; motor Python puro para cálculos y regresión ridge. Este stack permite ejecutar el MVP con un solo proceso y comprobar los cálculos sin interfaz, servicios de ML ni claves externas. `app.py` es la interfaz/servidor, `storage.py` es el repositorio y `engine.py` el componente predictivo. Las consultas siempre incluyen el propietario.

## Ejecutar en tu equipo

Desde el repositorio:

```bash
cd streamlit_app
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python run_local.py
```

En Windows, activa con `.venv\Scripts\activate`. Abre <http://localhost:8501>.

El lanzador activa explícitamente el modo personal y escucha en `127.0.0.1`. No requiere credenciales. La primera pantalla permite crear un vehículo; después están Inicio, Registrar carga, Historial, Estadísticas, Configuración y Nuevo vehículo en la barra lateral. En celular abre el menú lateral para navegar.

La base se crea automáticamente en `streamlit_app/data/ruta.sqlite3`. Puedes cambiar la ruta con `RUTA_DB_PATH`. Cerrar y volver a abrir conserva los datos. No expongas el modo local mediante un proxy o túnel público: usa OIDC para acceso compartido.

## Datos de demostración

Activa **Explorar demostración** en la barra lateral. Los datos sintéticos están identificados y viven solo en la sesión: nunca se insertan en SQLite. El vehículo de demostración usa 12 km/L y 40 km/día; su última carga parcial de 30 L muestra **360 km y 9 días**. Puedes editarlo sin afectar vehículos reales.

## Uso compartido e inicio de sesión

El arranque directo `streamlit run app.py` exige autenticación para datos reales. Sin configurar OIDC solo permite explorar la demo. Para un servidor con acceso público:

1. Copia `.streamlit/secrets.example.toml` a `.streamlit/secrets.toml`.
2. Crea un cliente web OAuth de Google y configura el callback exacto `https://TU-DOMINIO/oauth2callback`. Completa `client_id`, `client_secret`, `redirect_uri` y un `cookie_secret` aleatorio (por ejemplo con `python -c "import secrets; print(secrets.token_urlsafe(48))"`). No subas estos secretos al repositorio.
3. Ejecuta `docker compose up --build -d` desde este directorio. Se crea el volumen persistente `ruta-data`. El archivo de secretos se monta en tiempo de ejecución y no se incorpora a la imagen.
4. Configura un proxy HTTPS hacia `127.0.0.1:8501`, con soporte WebSocket. No definas `RUTA_AUTH_MODE=local` en producción.

También puedes ejecutar Python directamente en un servidor con disco persistente. Documentación oficial: [autenticación de Streamlit](https://docs.streamlit.io/develop/api-reference/user/st.login).

Cada identidad OIDC tiene sus propios vehículos. No se usan correos como claves de autorización. El proveedor debe emitir un `sub` estable. El modo local tiene un único propietario y es independiente de los propietarios OIDC. La sesión y las cookies siguen el comportamiento de Streamlit; no hay roles administrativos ni controles de organización en este MVP.

**Persistencia en producción:** utiliza una sola instancia y un disco local persistente para SQLite. No dependas del disco efímero de un servicio gestionado para datos reales; esta versión no incluye un adaptador a una base externa para Streamlit Community Cloud. Un despliegue con varias réplicas requiere migrar el repositorio a PostgreSQL u otro servicio compartido. Streamlit necesita un servidor Python: no se ejecuta directamente como un Worker de Cloudflare.

El Dockerfile y la configuración están incluidos; el despliegue público y el flujo real de Google requieren tu servidor, dominio y credenciales y no se han ejecutado como parte de estas pruebas.

## Persistencia y migración

`migrations/001_initial.sql` se aplica automáticamente a una base nueva mediante `PRAGMA user_version`. La tabla guarda cada agregado de vehículo y sus cargas como JSON, con propietario, revisión y fecha de actualización. Las mutaciones son transacciones atómicas; el control de revisión rechaza escrituras concurrentes obsoletas. Una versión de esquema más reciente se rechaza.

Para respaldar una base en uso, utiliza la API de backup de SQLite; no copies solo el archivo principal mientras WAL esté activo:

```bash
python -c "import sqlite3; src=sqlite3.connect('data/ruta.sqlite3'); dst=sqlite3.connect('ruta-backup.sqlite3'); src.backup(dst); dst.close(); src.close()"
```

Guarda el respaldo fuera del contenedor y no lo subas a Git. Para restaurar, detén la aplicación y reemplaza la base con el respaldo, sin conservar archivos WAL/SHM de otra versión.

## Reglas verificables

- El formulario exige elegir **Tanque lleno** o **Tanque parcial**; no presupone que cada compra llena el tanque.
- Dos llenados completos delimitan un intervalo fiable. Se suman los litros posteriores al primero hasta el segundo, incluidas las compras parciales; el siguiente intervalo comienza en ese segundo llenado, sin duplicar litros.
- La distancia usa odómetros en los extremos del intervalo cuando existen. En otro caso exige todas las distancias consecutivas conocidas. Los odómetros consecutivos tienen prioridad sobre la distancia manual.
- Una distancia manual guarda el ID de su referencia anterior. Al insertar, mover o eliminar cargas, no se reasigna silenciosamente. Las distancias que pierden referencia generan un aviso y dejan de entrenar hasta revisarlas.
- Alcance de la carga = litros comprados × km/L. Duración = alcance ÷ km diarios. Fecha = fecha/hora de carga + duración. Costo/km = (monto ÷ litros) ÷ km/L.
- La autonomía total solo se calcula con capacidad y tanque lleno, o con capacidad y porcentaje restante conocido. Los valores incompatibles con la capacidad generan avisos y no producen autonomía total.
- El ajuste de rutina solo simula resultados. No modifica datos guardados. Cero km diarios no produce una fecha finita.
- Las fechas se guardan con zona horaria; el usuario elige la zona para capturar y consultar. Las unidades imperiales usan galón estadounidense. Los cálculos internos son km y L. Los gastos de distintas monedas se muestran separados, sin conversiones inventadas.

## Aprendizaje real, sin información futura

Sin intervalos se usan únicamente los supuestos proporcionados. Si faltan, se dejan vacíos los resultados que dependen de ellos. Con intervalos válidos, el método base pondera los últimos seis rendimientos con pesos 1 a n, dando más peso al reciente.

La regresión ridge usa media ponderada histórica, desviación reciente, último rendimiento y recorrido **previsto al comienzo del intervalo**. Por eso el formulario pide el recorrido previsto hasta la próxima carga. El indicador lleno/parcial interviene en la construcción de las observaciones: una carga parcial sola nunca se etiqueta como consumo medido. No se introduce el precio ni el monto como causa física del rendimiento.

Desde **20 intervalos** se compara ridge con el método base usando validación temporal: se predicen entre los últimos 8 y 12 intervalos, entrenando siempre solo con sus predecesores. Los ejemplos de entrenamiento también usan únicamente características anteriores a su objetivo. La regularización es fija (1; intercepto 0.001), sin selección con los datos de validación.

Se activa ridge únicamente si su MAE mejora **al menos 10 %**, el MAE base es positivo, la predicción está entre 0 y 60 km/L y ninguno de los últimos seis intervalos está marcado como atípico. De otro modo se conserva la base. Se reevalúa al registrar, editar o eliminar; no hay modelos ficticios ni resultados entrenados precargados.

El uso diario se calcula por separado: suma ponderada de distancias / suma ponderada de días en los últimos seis tramos conocidos. No depende del combustible comprado.

Con al menos ocho errores temporales se muestra una banda empírica usando el percentil 80 del error absoluto del método elegido. No es un intervalo calibrado de confianza y no incluye incertidumbre del uso diario. Antes de eso no se inventa ningún rango.

## Pruebas

```bash
cd streamlit_app  # omite esto si ya estás dentro
python -m unittest discover -s tests -v
```

21 pruebas cubren fórmulas, aceptación 360 km/9 días, cargas parciales sin doble conteo, autonomía total, falta de datos, referencias al eliminar, edición, valores atípicos, odómetro/fechas, costos independientes, ajuste de rutina, regresión/validación temporal, persistencia entre aperturas, aislamiento de propietarios y conflictos. Streamlit AppTest ejecuta además creación de vehículo, selección obligatoria de tanque, registro, edición, eliminación, demo y bloqueo de modo local expuesto.

## Límites

Las estimaciones corresponden al momento de la carga; no rastrean el combustible restante en tiempo real. Las lecturas y el nivel restante dependen de la precisión del usuario. Intervalos fuera de 3–35 km/L y usos superiores a 500 km/día se señalan para revisión sin borrar datos. El modelo usa una muestra pequeña y no incorpora tráfico, clima, mantenimiento o condiciones mecánicas. La selección de modelo sobre una ventana corta puede ser inestable. Máximo 3000 cargas por vehículo, sin importación entre versiones ni integración de pagos.
