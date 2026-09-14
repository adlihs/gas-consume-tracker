from datetime import datetime, timedelta, timezone

def vehicle():
    now = datetime.now(timezone.utc).replace(microsecond=0)
    fills = []
    for i in range(6):
        fills.append(dict(id=f'demo-{i}', date=(now-timedelta(days=9*(5-i))).isoformat(),
                          liters=30.0, amount=720.0, currency='MXN', distance=360.0 if i else None,
                          distanceFrom=f'demo-{i-1}' if i else None, odometer=12000.0+360*i,
                          full=i < 5, remaining=None, route='mixto'))
    return dict(id='demo', name='DEMO · Mi auto', brand='', model='', year=None,
                capacity=50.0, initialEfficiency=12.0, initialDaily=40.0,
                currency='MXN', units='metric', fills=fills, revision=0)
