import copy
from datetime import datetime, timedelta, timezone
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

from demo import vehicle
from engine import analyze, daily, forecast, intervals, model, validate
from storage import Conflict, Store

class Calculations(unittest.TestCase):
    def test_acceptance(self):
        p = forecast(30, 12, 40, '2025-01-01T00:00:00+00:00', 24)
        self.assertEqual((p['range'], p['days'], p['cost']), (360, 9, 2))
        self.assertEqual(p['date'], '2025-01-10T00:00:00+00:00')

    def test_partial_liters_and_no_double_count(self):
        v = vehicle()
        v['fills'] = v['fills'][:4]
        for i, f in enumerate(v['fills']):
            f['full'] = i != 1
        h = intervals(v['fills'])
        self.assertEqual(len(h), 2)
        self.assertEqual([(o['distance'], o['liters'], o['efficiency']) for o in h], [(720,60,12), (360,30,12)])

    def test_missing_history(self):
        v = vehicle(); v['fills'] = v['fills'][-1:]
        v['initialEfficiency'] = v['initialDaily'] = None
        a = analyze(v)
        self.assertIsNone(a['prediction']['range'])
        self.assertIsNone(a['prediction']['days'])
        self.assertIsNone(a['model']['band'])
        self.assertFalse(a['model']['used'])

    def test_partial_alone_uses_initial(self):
        v = vehicle(); v['fills'] = v['fills'][-1:]
        a = analyze(v)
        self.assertEqual((a['prediction']['range'], a['prediction']['days']), (360,9))
        self.assertIsNone(a['total'])

    def test_total_requires_remaining_or_full(self):
        v = vehicle()
        v['fills'][-1]['remaining'] = 20
        self.assertEqual(analyze(v)['total']['range'], 480)
        v['fills'][-1]['full'] = True
        self.assertEqual(analyze(v)['total']['range'], 600)
        v['fills'][-1]['remaining'] = 90
        self.assertIsNone(analyze(v)['total'])
        self.assertTrue(analyze(v)['warnings'])

    def test_edit_recalculates(self):
        v = vehicle(); old = analyze(v)['model']['efficiency']
        v['fills'][2]['liters'] = 60
        self.assertNotEqual(analyze(v)['model']['efficiency'], old)
        v['fills'][2]['full'] = False
        self.assertEqual(len(intervals(v['fills'])), 3)

    def test_delete_does_not_reuse_manual_distance(self):
        v = vehicle(); v['fills'] = v['fills'][:3]
        for f in v['fills']:
            f['odometer'] = None
        v['fills'].pop(1)
        self.assertEqual(intervals(v['fills']), [])
        self.assertTrue(analyze(v)['warnings'])

    def test_end_odometer_bridges_missing_segments(self):
        v = vehicle(); v['fills'] = v['fills'][:3]
        v['fills'][1].update(full=False, distance=None, odometer=None)
        self.assertEqual(intervals(v['fills'])[0]['distance'], 720)

    def test_zero_daily_and_missing_efficiency(self):
        self.assertIsNone(forecast(30, 12, 0, '2025-01-01T00:00:00Z', 24)['days'])
        self.assertIsNone(forecast(30, None, 40, '2025-01-01T00:00:00Z', 24)['cost'])

    def test_daily_separate_from_liters(self):
        v = vehicle()
        for f in v['fills']:
            f['liters'] = 100
        self.assertEqual(daily(v['fills'])['value'], 40)

    def test_cost_not_efficiency_feature(self):
        v = vehicle(); before = analyze(v)
        for f in v['fills']:
            f['amount'] *= 2
        after = analyze(v)
        self.assertEqual(before['model'], after['model'])
        self.assertEqual(after['prediction']['cost'], before['prediction']['cost']*2)

    def test_invalid_data(self):
        for field, value in [('liters', 0), ('amount', -1), ('liters', float('nan')), ('remaining', 101), ('full', None), ('odometer', 1), ('date','2099-01-01T00:00:00Z')]:
            with self.subTest(field=field, value=value):
                v = vehicle(); v['fills'][-1][field] = value
                with self.assertRaises(ValueError): validate(v)

    def test_duplicate_date(self):
        v = vehicle(); v['fills'][-1]['date'] = v['fills'][0]['date']
        with self.assertRaises(ValueError): validate(v)

    def test_outliers_retained(self):
        v = vehicle(); v['fills'][1]['liters'] = 1
        a = analyze(v)
        self.assertEqual(len(a['intervals']),4)
        self.assertTrue(a['intervals'][0]['flag'])
        self.assertTrue(a['warnings'])

    def test_override_not_persisted(self):
        v = vehicle(); original = copy.deepcopy(v)
        self.assertEqual(analyze(v,80)['prediction']['days'],4.5)
        self.assertEqual(v,original)

    def test_regression_gates_and_temporal_prefixes(self):
        h = [dict(efficiency=8 if i%2 else 18, route='ciudad' if i%2 else 'carretera', flag=False) for i in range(40)]
        result = model(h, 'carretera')
        self.assertTrue(result['used'])
        self.assertLessEqual(result['mlMae'], .9*result['baseMae'])
        self.assertEqual(result['validationCount'],12)
        self.assertIsNotNone(result['band'])
        from engine import regress
        with patch('engine.regress', wraps=regress) as spy:
            model(h[:20], 'ciudad')
            self.assertEqual([len(c.args[0]) for c in spy.call_args_list], list(range(12,20))+[20])
        self.assertFalse(model(h[:19], 'ciudad')['used'])
        h[-1]['flag'] = True
        self.assertFalse(model(h, 'carretera')['used'])

    def test_constant_model_keeps_base(self):
        h = [dict(efficiency=12, route='mixto', flag=False) for _ in range(25)]
        self.assertFalse(model(h, 'mixto')['used'])

class Persistence(unittest.TestCase):
    def test_restart_isolation_edit_delete_and_conflict(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)/'data.sqlite3'
            store = Store(path)
            saved = store.save('alice',vehicle())
            self.assertEqual(Store(path).list('alice'),[saved])
            self.assertEqual(store.list('bob'),[])
            stale = copy.deepcopy(saved)
            saved['fills'].pop()
            saved = store.save('alice',saved)
            self.assertEqual(len(store.list('alice')[0]['fills']),5)
            with self.assertRaises(Conflict): store.save('alice',stale)
            with self.assertRaises(Conflict): store.save('bob',saved)
            bad = copy.deepcopy(saved); bad['fills'][0]['liters']=0
            with self.assertRaises(ValueError): store.save('alice',bad)
            self.assertEqual(store.list('alice')[0],saved)

if __name__ == '__main__':
    unittest.main()
