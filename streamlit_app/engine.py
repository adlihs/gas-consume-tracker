"""Pure, deterministic fuel accounting and temporally validated regression."""
from datetime import datetime, timedelta, timezone
from math import ceil, isfinite
from statistics import mean, pstdev
import re

ROUTES = ('sin-dato', 'ciudad', 'carretera', 'mixto')

def instant(value):
    date = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if date.tzinfo is None:
        raise ValueError('La fecha necesita una zona horaria.')
    return date.astimezone(timezone.utc)

def ordered(fills):
    return sorted(fills, key=lambda f: instant(f['date']))

def number(value):
    return type(value) in (float, int) and isfinite(value)

def validate(v, now=None):
    now = now or datetime.now(timezone.utc)
    if not isinstance(v.get('name'), str) or not 1 <= len(v['name'].strip()) <= 80:
        raise ValueError('Escribe un alias de 1 a 80 caracteres.')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', v['id']):
        raise ValueError('Identificador inválido.')
    for key in ('brand', 'model'):
        if not isinstance(v.get(key), str) or len(v[key]) > 80:
            raise ValueError('Marca y modelo: máximo 80 caracteres.')
    year = v.get('year')
    if year is not None and (type(year) is not int or not 1886 <= year <= now.year + 1):
        raise ValueError('Revisa el año del vehículo.')
    for key in ('capacity', 'initialEfficiency', 'initialDaily'):
        value = v.get(key)
        if value is not None and (not number(value) or value <= 0):
            raise ValueError('Capacidad y supuestos deben ser positivos o quedar vacíos.')
    if v.get('units') not in ('metric', 'imperial'):
        raise ValueError('Unidades inválidas.')
    def currency(value):
        if not isinstance(value, str) or not re.fullmatch('[A-Z]{3}', value):
            raise ValueError('Moneda: usa tres letras, por ejemplo MXN, USD o EUR.')
    currency(v['currency'])
    if not isinstance(v['fills'], list) or len(v['fills']) > 3000:
        raise ValueError('Máximo 3000 cargas por vehículo.')
    dates, ids, previous_odo = set(), set(), -1
    for f in ordered(v['fills']):
        date = instant(f['date'])
        if date > now + timedelta(seconds=60) or date in dates:
            raise ValueError('Las fechas deben ser distintas y no estar en el futuro.')
        dates.add(date)
        if f['id'] in ids:
            raise ValueError('Identificador de carga duplicado.')
        ids.add(f['id'])
        for key in ('liters', 'amount'):
            if not number(f[key]) or f[key] <= 0:
                raise ValueError('Litros y monto deben ser mayores que cero.')
        currency(f['currency'])
        odo = f.get('odometer')
        if odo is not None:
            if not number(odo) or odo < 0 or odo <= previous_odo:
                raise ValueError('El odómetro debe aumentar entre lecturas.')
            previous_odo = odo
        distance, remaining = f.get('distance'), f.get('remaining')
        if distance is not None and (not number(distance) or distance < 0):
            raise ValueError('La distancia no puede ser negativa.')
        if remaining is not None and (not number(remaining) or not 0 <= remaining <= 100):
            raise ValueError('El nivel restante debe estar entre 0 y 100 %.')
        if type(f['full']) is not bool or f['route'] not in ROUTES:
            raise ValueError('Selecciona tanque lleno o parcial y un recorrido válido.')

def segment(a, b):
    if a['odometer'] is not None and b['odometer'] is not None:
        return b['odometer'] - a['odometer']
    return b['distance'] if b.get('distanceFrom') == a['id'] else None

def intervals(fills):
    fills, result, start = ordered(fills), [], None
    for i, f in enumerate(fills):
        if not f['full']:
            continue
        if start is not None:
            a = fills[start]
            if a['odometer'] is not None and f['odometer'] is not None:
                distance = f['odometer'] - a['odometer']
            else:
                segments = [segment(fills[j-1], fills[j]) for j in range(start+1, i+1)]
                distance = sum(segments) if all(x is not None for x in segments) else None
            liters = sum(x['liters'] for x in fills[start+1:i+1])
            if distance is not None and distance > 0 and liters > 0:
                efficiency = distance / liters
                result.append(dict(start=a['date'], end=f['date'], distance=distance,
                                   liters=liters, efficiency=efficiency, route=a['route'],
                                   flag=efficiency < 3 or efficiency > 35))
        start = i
    return result

def weighted(values):
    values = values[-6:]
    return sum((i+1)*x for i, x in enumerate(values))/sum(range(1, len(values)+1)) if values else None

def features(history, route):
    y = [x['efficiency'] for x in history[-6:]]
    return [1, (weighted(y) or 0)/20, (pstdev(y) if y else 0)/5,
            (y[-1] if y else 0)/20, int(route == 'ciudad'), int(route == 'carretera'), int(route == 'mixto')]

def regress(history, route):
    # Ridge with fixed regularization, fitted only on already closed intervals.
    p = 7
    a = [[(0.001 if r == 0 else 1.0) if r == c else 0.0 for c in range(p+1)] for r in range(p)]
    for i in range(3, len(history)):
        x, y = features(history[:i], history[i]['route']), history[i]['efficiency']
        for r in range(p):
            for c in range(p):
                a[r][c] += x[r]*x[c]
            a[r][p] += x[r]*y
    for i in range(p):
        pivot = max(range(i, p), key=lambda r: abs(a[r][i]))
        a[i], a[pivot] = a[pivot], a[i]
        divisor = a[i][i]
        if abs(divisor) < 1e-10:
            return float('nan')
        a[i] = [x/divisor for x in a[i]]
        for r in range(p):
            if r != i:
                factor = a[r][i]
                a[r] = [a[r][c]-factor*a[i][c] for c in range(p+1)]
    return sum(x*a[i][p] for i, x in enumerate(features(history, route)))

def model(history, route, initial=None):
    base = weighted([o['efficiency'] for o in history]) if history else initial
    base_mae = ml_mae = band = None
    used, errors, candidate = False, [], None
    if len(history) >= 20:
        b, m = [], []
        for i in range(max(12, len(history)-12), len(history)):
            prior, target = history[:i], history[i]
            b.append(abs(target['efficiency']-weighted([o['efficiency'] for o in prior])))
            m.append(abs(target['efficiency']-regress(prior, target['route'])))
        base_mae, ml_mae = mean(b), mean(m)
        candidate = regress(history, route)
        used = (isfinite(ml_mae) and base_mae > 0 and ml_mae <= .9*base_mae
                and 0 < candidate <= 60 and not any(o['flag'] for o in history[-6:]))
        errors = m if used else b
        if len(errors) >= 8:
            band = sorted(errors)[ceil(len(errors)*.8)-1]
    recent = [o['efficiency'] for o in history[-6:]]
    variation = pstdev(recent)/mean(recent) if len(recent) > 1 else None
    quality = ('Datos por revisar' if any(o['flag'] for o in history[-6:]) else
               'Estimación inicial' if len(history) < 3 else
               'Historial variable' if variation is not None and variation > .2 else
               'Historial en formación' if len(history) < 8 else 'Historial consistente')
    return dict(efficiency=candidate if used else base, used=used, baseMae=base_mae,
                mlMae=ml_mae, band=band, validationCount=len(errors), quality=quality,
                method='Regresión ridge' if used else 'Promedio ponderado' if history else 'Supuestos iniciales')

def daily(fills, initial=None):
    fills, points = ordered(fills), []
    for a, b in zip(fills, fills[1:]):
        km, days = segment(a, b), (instant(b['date'])-instant(a['date'])).total_seconds()/86400
        if km is not None and km >= 0 and days > 0:
            points.append(dict(date=b['date'], km=km, days=days, value=km/days))
    recent = points[-6:]
    divisor = sum((i+1)*p['days'] for i, p in enumerate(recent))
    return dict(value=sum((i+1)*p['km'] for i, p in enumerate(recent))/divisor if divisor else initial,
                points=points, source='Historial de distancias y fechas' if divisor else 'Supuesto inicial')

def forecast(liters, efficiency, km_daily, date, price):
    reach = liters*efficiency if efficiency is not None and efficiency > 0 else None
    days = reach/km_daily if reach is not None and km_daily is not None and km_daily > 0 else None
    try:
        when = (instant(date)+timedelta(days=days)).isoformat() if days is not None else None
    except (OverflowError, ValueError):
        when = None
    return dict(range=reach, days=days, date=when, cost=price/efficiency if efficiency and efficiency > 0 else None)

def analyze(v, override=None):
    fills = ordered(v['fills'])
    last = fills[-1] if fills else None
    history = intervals(fills)
    m, d = model(history, last['route'] if last else 'sin-dato', v['initialEfficiency']), daily(fills, v['initialDaily'])
    value = override if override is not None else d['value']
    prediction = forecast(last['liters'], m['efficiency'], value, last['date'], last['amount']/last['liters']) if last else None
    fuel = None
    if last and v['capacity'] and last['liters'] <= v['capacity']:
        remaining = last['remaining']
        consistent = remaining is None or v['capacity']*remaining/100+last['liters'] <= v['capacity']+.000001
        if consistent:
            fuel = v['capacity'] if last['full'] else v['capacity']*remaining/100+last['liters'] if remaining is not None else None
    total = forecast(fuel, m['efficiency'], value, last['date'], last['amount']/last['liters']) if fuel is not None else None
    warnings = []
    for i, f in enumerate(fills):
        if v['capacity'] and (f['liters'] > v['capacity'] or (f['remaining'] is not None and f['liters']+v['capacity']*f['remaining']/100 > v['capacity']+.000001)):
            warnings.append(f"Carga {f['date']}: litros y nivel restante superan la capacidad; revisa los datos.")
        if i and segment(fills[i-1], f) is None:
            warnings.append(f"Carga {f['date']}: falta distancia desde la anterior; revisa la referencia tras editar o eliminar.")
        if i and f['distance'] is not None and fills[i-1]['odometer'] is not None and f['odometer'] is not None and abs(f['distance']-(f['odometer']-fills[i-1]['odometer'])) > 2:
            warnings.append(f"Carga {f['date']}: el odómetro difiere de la distancia manual; se usa el odómetro.")
    warnings += [f"Intervalo hasta {o['end']}: {o['efficiency']:.1f} km/L atípico, conservado para revisión." for o in history if o['flag']]
    if any(p['value'] > 500 for p in d['points']):
        warnings.append('Hay un uso superior a 500 km/día. Revisa fechas y distancias.')
    return dict(fills=fills, last=last, intervals=history, model=m, daily=d, dailyValue=value,
                prediction=prediction, total=total, warnings=warnings)
