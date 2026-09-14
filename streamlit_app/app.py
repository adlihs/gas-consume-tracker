"""Run with `python run_local.py` or configure OIDC for a shared server."""
import copy
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import uuid
from zoneinfo import ZoneInfo

import pandas as pd
import streamlit as st

from demo import vehicle as demo_vehicle
from engine import ROUTES, analyze, instant, ordered, validate
from storage import Store

st.set_page_config(page_title='Ruta · Gasolina', page_icon='⛽', layout='centered')
st.markdown('''<style>
.block-container {max-width:960px;padding-top:2rem;padding-bottom:3rem}
button {min-height:44px} [data-testid="stMetricValue"] {font-size:1.8rem}
@media(max-width:600px){.block-container{padding-left:1rem;padding-right:1rem}}
</style>''', unsafe_allow_html=True)

st.title('⛽ Ruta')
st.caption('Tu gasolina, con cuentas claras · Versión Streamlit')
demo = st.sidebar.toggle('Explorar demostración', key='demo_mode')
local = os.getenv('RUTA_AUTH_MODE') == 'local'
if demo:
    owner = 'demo'
    st.warning('DEMOSTRACIÓN · Datos sintéticos. Los cambios solo duran esta sesión y no se guardan en tu base de datos.')
elif local:
    if st.get_option('server.address') not in ('127.0.0.1', 'localhost', '::1'):
        st.error('El modo local requiere server.address=127.0.0.1. Ejecuta python run_local.py.')
        st.stop()
    owner = 'local'
    st.sidebar.caption('Modo personal local · SQLite en este equipo')
else:
    try:
        auth_configured = 'auth' in st.secrets
    except FileNotFoundError:
        auth_configured = False
    if not auth_configured:
        st.info('Para uso personal ejecuta python run_local.py. Para acceso compartido configura el inicio de sesión indicado en el README. También puedes explorar la demostración.')
        st.stop()
    if not st.user.is_logged_in:
        st.info('Inicia sesión para consultar y guardar tus vehículos.')
        if st.button('Iniciar sesión con Google', type='primary'):
            st.login()
        st.stop()
    subject = st.user.get('sub')
    if not subject:
        st.error('El proveedor no devolvió un identificador de usuario. Revisa OIDC.')
        st.stop()
    owner = hashlib.sha256((str(st.user.get('iss', 'google'))+':'+str(subject)).encode()).hexdigest()
    st.sidebar.caption(st.user.get('email', 'Sesión iniciada'))
    if st.sidebar.button('Cerrar sesión'):
        st.logout()

zone = ZoneInfo(st.sidebar.selectbox('Zona horaria', ['UTC', 'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Argentina/Buenos_Aires', 'Europe/Madrid']))
store = None if demo else Store(os.getenv('RUTA_DB_PATH', str(Path(__file__).parent/'data/ruta.sqlite3')))
if demo and 'demo_vehicles' not in st.session_state:
    st.session_state.demo_vehicles = [demo_vehicle()]
vehicles = copy.deepcopy(st.session_state.demo_vehicles) if demo else store.list(owner)

def save(v):
    validate(v)
    if demo:
        saved = dict(v, revision=v.get('revision', 0)+1)
        st.session_state.demo_vehicles = [x for x in st.session_state.demo_vehicles if x['id'] != v['id']]+[saved]
    else:
        store.save(owner, v)
    st.session_state.flash = 'Cambios guardados. Intervalos y estimaciones recalculados.'
    st.rerun()

if 'flash' in st.session_state:
    st.success(st.session_state.pop('flash'))

def vehicle_form(existing=None):
    v = existing or dict(id=uuid.uuid4().hex, name='', brand='', model='', year=None,
                         capacity=None, initialEfficiency=None, initialDaily=None,
                         currency='MXN', units='metric', fills=[], revision=0)
    with st.form('vehicle_'+owner+'_'+(v['id'] if existing else 'new')+'_'+str(v['revision'])):
        name = st.text_input('Alias del vehículo *', value=v['name'], max_chars=80)
        brand = st.text_input('Marca (opcional)', value=v['brand'], max_chars=80)
        model_name = st.text_input('Modelo (opcional)', value=v['model'], max_chars=80)
        year = st.number_input('Año (opcional)', min_value=1886, max_value=datetime.now().year+1, value=v['year'], step=1)
        st.caption('La configuración técnica se ingresa en km y litros; las unidades de visualización se eligen abajo.')
        capacity = st.number_input('Capacidad del tanque (L, opcional)', min_value=0.1, value=v['capacity'])
        efficiency = st.number_input('Rendimiento inicial (km/L, opcional)', min_value=0.1, value=v['initialEfficiency'])
        daily = st.number_input('Uso inicial (km/día, opcional)', min_value=0.1, value=v['initialDaily'])
        currency = st.text_input('Moneda predeterminada (código de 3 letras)', value=v['currency'], max_chars=3)
        units = st.selectbox('Unidades para mostrar resultados', ['metric', 'imperial'], index=0 if v['units']=='metric' else 1,
                             format_func=lambda x: 'Kilómetros y litros' if x=='metric' else 'Millas y galones estadounidenses')
        submitted = st.form_submit_button('Guardar vehículo', type='primary')
    if submitted:
        try:
            save(dict(v, name=name.strip(), brand=brand, model=model_name, year=year, capacity=capacity,
                      initialEfficiency=efficiency, initialDaily=daily, currency=currency.upper(), units=units))
        except ValueError as exc:
            st.error(str(exc))

if not vehicles:
    st.subheader('Comienza con tu vehículo')
    st.write('Agrega los supuestos que conozcas. Sin ellos mostraremos solo lo que se pueda calcular.')
    vehicle_form()
    st.stop()

selected = st.sidebar.selectbox('Vehículo', [v['id'] for v in vehicles], format_func=lambda x: next(v['name'] for v in vehicles if v['id']==x))
v = next(v for v in vehicles if v['id']==selected)
page = st.sidebar.radio('Secciones', ['Inicio', 'Registrar carga', 'Historial', 'Estadísticas', 'Configuración', 'Nuevo vehículo'], key='page')
imperial = v['units']=='imperial'
distance_factor, volume_factor = (1/1.609344, 1/3.785411784) if imperial else (1, 1)
du, vu, eu = ('mi', 'gal US', 'mpg US') if imperial else ('km', 'L', 'km/L')
def fmt(value, digits=1):
    return '—' if value is None else f'{value:,.{digits}f}'
def dated(value):
    return instant(value).astimezone(zone).strftime('%d/%m/%Y %H:%M') if value else '—'

def fill_form(existing=None):
    f = existing or dict(id=uuid.uuid4().hex, date=datetime.now(timezone.utc).isoformat(), liters=None,
                         amount=None, currency=v['currency'], distance=None, distanceFrom=None,
                         odometer=None, full=None, remaining=None, route='sin-dato')
    dt = instant(f['date']).astimezone(zone)
    with st.form('fill_'+owner+'_'+v['id']+'_'+(f['id'] if existing else 'new')+'_'+str(v['revision'])):
        date = st.date_input('Fecha de carga', value=dt.date(), max_value=datetime.now(zone).date())
        time = st.time_input('Hora de carga', value=dt.time().replace(microsecond=0), step=60)
        status = st.radio('¿Cómo quedó el tanque? *', ['Tanque lleno', 'Tanque parcial'],
                          index=None if f['full'] is None else 0 if f['full'] else 1)
        liters = st.number_input(f'Combustible comprado ({vu}) *', min_value=0.001, value=None if f['liters'] is None else float(f['liters']*volume_factor), format='%.3f')
        amount = st.number_input('Monto total pagado *', min_value=0.01, value=f['amount'], format='%.2f')
        currency = st.text_input('Moneda', value=f['currency'], max_chars=3)
        distance = st.number_input(f'Distancia desde la carga anterior ({du}, opcional)', min_value=0.0, value=None if f['distance'] is None else float(f['distance']*distance_factor))
        odometer = st.number_input(f'Odómetro ({du}, opcional)', min_value=0.0, value=None if f['odometer'] is None else float(f['odometer']*distance_factor))
        st.caption('Con dos lecturas consecutivas se calcula la distancia automáticamente. La primera carga puede dejarla vacía.')
        remaining = st.number_input('Combustible restante antes de cargar (%, opcional)', min_value=0.0, max_value=100.0, value=f['remaining'])
        route = st.selectbox('Recorrido previsto hasta la próxima carga', ROUTES, index=ROUTES.index(f['route']), format_func=lambda x: 'Sin dato' if x=='sin-dato' else x.capitalize())
        st.caption('Se registra la rutina prevista al cargar para que el modelo no use información futura.')
        confirm = st.checkbox('Confirmo que la distancia manual corresponde a la carga inmediatamente anterior', value=not bool(existing))
        submitted = st.form_submit_button('Guardar carga', type='primary')
    if submitted:
        try:
            if status is None:
                raise ValueError('Selecciona tanque lleno o tanque parcial.')
            if liters is None or amount is None:
                raise ValueError('Ingresa combustible comprado y monto pagado.')
            when = datetime.combine(date, time, tzinfo=zone).astimezone(timezone.utc).isoformat()
            previous = [x for x in ordered(v['fills']) if x['id'] != f['id'] and instant(x['date']) < instant(when)]
            predecessor = previous[-1]['id'] if previous else None
            km = distance/distance_factor if distance is not None else None
            changed = not existing or km != f['distance'] or predecessor != f.get('distanceFrom')
            if km is not None and predecessor and changed and not confirm:
                raise ValueError('Confirma la referencia de la distancia manual antes de guardar.')
            new_fill = dict(f, date=when, liters=liters/volume_factor, amount=amount, currency=currency.upper(),
                            distance=km, distanceFrom=predecessor if (confirm or changed) else f.get('distanceFrom'),
                            odometer=odometer/distance_factor if odometer is not None else None,
                            full=status=='Tanque lleno', remaining=remaining, route=route)
            save(dict(v, fills=[x for x in v['fills'] if x['id'] != f['id']]+[new_fill]))
        except ValueError as exc:
            st.error(str(exc))

a = analyze(v)
if page == 'Nuevo vehículo':
    st.subheader('Agregar vehículo')
    vehicle_form()
elif page == 'Configuración':
    st.subheader('Configuración y supuestos')
    vehicle_form(v)
elif page == 'Registrar carga':
    st.subheader('Registrar carga')
    fill_form()
elif page == 'Inicio':
    st.subheader(v['name'])
    def register():
        st.session_state.page = 'Registrar carga'
    st.button('Registrar carga', type='primary', on_click=register)
    if not a['last']:
        st.info('Todavía no hay cargas. Registra la primera para estimar el alcance de los litros comprados.')
    else:
        if st.toggle('Explorar un cambio de rutina', key='override_'+v['id']):
            routine = st.number_input(f'Uso para esta simulación ({du}/día)', min_value=0.0, value=float((a['dailyValue'] or 0)*distance_factor))
            a = analyze(v, routine/distance_factor)
            st.caption('Simulación temporal: no cambia el historial ni tus supuestos guardados.')
        p, m, last = a['prediction'], a['model'], a['last']
        st.caption(f"Última carga: {dated(last['date'])} · {'Tanque lleno' if last['full'] else 'Tanque parcial'}")
        st.write(f"**{m['quality']}** · {m['method']} · {len(a['intervals'])} intervalos fiables")
        c1, c2 = st.columns(2)
        c1.metric(f'Rendimiento estimado ({eu})', fmt(m['efficiency']*distance_factor/volume_factor if m['efficiency'] is not None else None))
        c2.metric(f'Alcance de esta carga ({du})', fmt(p['range']*distance_factor if p['range'] is not None else None))
        c1, c2 = st.columns(2)
        c1.metric('Duración de los litros añadidos (días)', fmt(p['days']))
        c2.metric('Fecha probable · litros añadidos', dated(p['date']))
        st.write(f"Precio por {vu}: **{last['amount']/last['liters']/volume_factor:.2f} {last['currency']}** · Costo estimado por {du}: **{fmt(p['cost']/distance_factor if p['cost'] is not None else None, 3)} {last['currency']}**")
        st.caption(f"Uso estimado: {fmt(a['dailyValue']*distance_factor if a['dailyValue'] is not None else None)} {du}/día · {a['daily']['source']}")
        if m['efficiency'] is None:
            st.info('Falta rendimiento: agrega un supuesto inicial en Configuración o completa un intervalo entre dos llenados completos.')
        if a['dailyValue'] is None or a['dailyValue'] <= 0:
            st.info('Para calcular días y fecha necesitas un uso diario mayor que cero. Agrégalo en Configuración o explora una rutina.')
        if a['total'] and a['total']['range'] is not None:
            st.metric(f'Autonomía total estimada al terminar la carga ({du})', fmt(a['total']['range']*distance_factor))
            st.caption(f"Incluye combustible restante. Duración total: {fmt(a['total']['days'])} días. Fecha probable total: {dated(a['total']['date'])}.")
        else:
            st.info('Los días y la fecha corresponden a los litros añadidos. El combustible restante podría extenderlos; falta información suficiente para estimar autonomía total.')
        if m['band'] is not None and m['efficiency'] is not None:
            low, high = max(0, m['efficiency']-m['band']), m['efficiency']+m['band']
            st.write(f"Rango empírico de alcance: **{low*last['liters']*distance_factor:.0f}–{high*last['liters']*distance_factor:.0f} {du}**.")
            st.caption(f"Basado en errores absolutos de {m['validationCount']} predicciones temporales (percentil 80). No es una probabilidad de confianza ni incorpora incertidumbre del uso diario.")
        st.caption('Estimaciones al momento de cargar, sin seguimiento en tiempo real. Suponen un rendimiento y una rutina similares; tráfico, clima y conducción pueden cambiarlos.')
elif page == 'Historial':
    st.subheader('Historial editable')
    if not a['fills']:
        st.info('Tu historial aparecerá al registrar la primera carga.')
    else:
        rows = [{'Fecha':dated(f['date']), 'Tanque':'Lleno' if f['full'] else 'Parcial', vu:f['liters']*volume_factor,
                 'Monto':f['amount'], 'Moneda':f['currency'], f'Precio/{vu}':f['amount']/f['liters']/volume_factor} for f in a['fills']]
        st.dataframe(pd.DataFrame(rows), hide_index=True, width='stretch')
        edit_id = st.selectbox('Carga para editar', [f['id'] for f in reversed(a['fills'])], format_func=lambda x: dated(next(f['date'] for f in a['fills'] if f['id']==x)))
        target = next(f for f in a['fills'] if f['id']==edit_id)
        # Keys include selected record so form values do not bleed between records.
        with st.container(key='edit_'+edit_id):
            fill_form(target)
        with st.expander('Eliminar esta carga'):
            confirmed = st.checkbox('Confirmo que quiero eliminar esta carga', key='delete_'+edit_id)
            if st.button('Eliminar carga', disabled=not confirmed):
                try:
                    save(dict(v, fills=[f for f in v['fills'] if f['id'] != edit_id]))
                except ValueError as exc:
                    st.error(str(exc))
elif page == 'Estadísticas':
    st.subheader('Rendimiento y gasto')
    if not a['fills']:
        st.info('Registra cargas para ver la evolución de gasto y rendimiento.')
    else:
        for currency in sorted({f['currency'] for f in a['fills']}):
            rows = [{'Fecha':instant(f['date']), 'Gasto':f['amount']} for f in a['fills'] if f['currency']==currency]
            frame = pd.DataFrame(rows).set_index('Fecha')
            st.metric(f'Gasto total · {currency}', fmt(float(frame['Gasto'].sum()), 2))
            st.bar_chart(frame.resample('MS').sum(), y='Gasto')
        st.caption('Gasto mensual separado por moneda; no se suman monedas distintas ni se asume conversión.')
        if a['intervals']:
            frame = pd.DataFrame([{'Fecha':instant(o['end']), eu:o['efficiency']*distance_factor/volume_factor} for o in a['intervals']]).set_index('Fecha')
            st.line_chart(frame)
            st.dataframe(pd.DataFrame(a['intervals']).rename(columns={'start':'Inicio','end':'Fin','distance':'Distancia (km)','liters':'Litros consumidos','efficiency':'km/L','route':'Recorrido previsto','flag':'Revisar'}), hide_index=True)
        else:
            st.info('Historial insuficiente: el consumo medido requiere dos llenados completos y una distancia conocida entre ellos.')
        if a['daily']['points']:
            st.line_chart(pd.DataFrame([{'Fecha':instant(p['date']), f'{du}/día':p['value']*distance_factor} for p in a['daily']['points']]).set_index('Fecha'))
        st.write(f"**Modelo activo:** {a['model']['method']}")
        if a['model']['baseMae'] is not None:
            st.write(f"Validación temporal ({a['model']['validationCount']} intervalos): MAE base {a['model']['baseMae']:.3f} km/L; MAE regresión {a['model']['mlMae']:.3f} km/L.")
        st.caption('Regresión ridge desde 20 intervalos, solo si reduce el MAE al menos un 10 % y no hay valores atípicos recientes. Se reevalúa al cambiar el historial. El precio no es una característica del rendimiento.')

if a['warnings']:
    with st.expander(f"Revisar datos ({len(a['warnings'])})", expanded=True):
        for warning in a['warnings']:
            st.warning(warning)
with st.expander('Cómo se calculan las estimaciones'):
    st.write('Consumo medido = distancia entre dos llenados completos ÷ suma de litros comprados después del primero y hasta el segundo. Incluye todas las cargas parciales intermedias una sola vez.')
    st.write('Alcance = litros añadidos × km/L. Días = alcance ÷ km diarios. Fecha = fecha de carga + días. Costo/km = precio/L ÷ km/L.')
    st.write('El indicador lleno/parcial determina qué intervalos pueden entrenar el modelo. No se interpreta como una causa física del consumo. Los intervalos sin distancia suficiente se conservan en el historial pero no entrenan.')
