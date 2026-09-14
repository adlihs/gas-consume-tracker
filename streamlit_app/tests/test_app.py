import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import streamlit as st
from streamlit.testing.v1 import AppTest

APP = str(Path(__file__).resolve().parents[1]/'app.py')

class Interface(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'RUTA_AUTH_MODE':'local', 'RUTA_DB_PATH':str(Path(self.tmp.name)/'test.sqlite3')})
        self.env.start()
        st.config.set_option('server.address','127.0.0.1')

    def tearDown(self):
        self.env.stop(); self.tmp.cleanup()

    def test_create_fill_edit_delete(self):
        app = AppTest.from_file(APP, default_timeout=20).run()
        self.assertFalse(app.exception)
        app.text_input[0].set_value('Mi auto')
        next(x for x in app.number_input if 'Rendimiento inicial' in x.label).set_value(12.0)
        next(x for x in app.number_input if 'Uso inicial' in x.label).set_value(40.0)
        next(x for x in app.button if x.label=='Guardar vehículo').click().run()
        self.assertFalse(app.exception)
        next(x for x in app.button if x.label=='Registrar carga').click().run()
        next(x for x in app.number_input if 'Combustible comprado' in x.label).set_value(30.0)
        next(x for x in app.number_input if 'Monto total' in x.label).set_value(720.0)
        next(x for x in app.button if x.label=='Guardar carga').click().run()
        self.assertTrue(any('Selecciona tanque' in x.value for x in app.error))
        next(x for x in app.radio if 'Cómo quedó' in x.label).set_value('Tanque parcial')
        next(x for x in app.button if x.label=='Guardar carga').click().run()
        self.assertFalse(app.exception)
        app.sidebar.radio[0].set_value('Inicio').run()
        self.assertTrue(any(x.value=='360.0' for x in app.metric))
        self.assertTrue(any(x.value=='9.0' for x in app.metric))
        app.sidebar.radio[0].set_value('Historial').run()
        next(x for x in app.number_input if 'Combustible comprado' in x.label).set_value(20.0)
        next(x for x in app.button if x.label=='Guardar carga').click().run()
        app.sidebar.radio[0].set_value('Inicio').run()
        self.assertTrue(any(x.value=='240.0' for x in app.metric))
        app.sidebar.radio[0].set_value('Estadísticas').run()
        self.assertFalse(app.exception)
        app.sidebar.radio[0].set_value('Historial').run()
        next(x for x in app.checkbox if 'eliminar' in x.label).check().run()
        next(x for x in app.button if x.label=='Eliminar carga').click().run()
        self.assertFalse(app.exception)
        self.assertTrue(any('Tu historial aparecerá' in x.value for x in app.info))

    def test_demo_does_not_persist(self):
        app = AppTest.from_file(APP, default_timeout=20).run()
        app.sidebar.toggle[0].set_value(True).run()
        self.assertFalse(app.exception)
        self.assertTrue(any(x.value=='360.0' for x in app.metric))
        for page in ['Historial','Estadísticas','Configuración','Nuevo vehículo']:
            app.sidebar.radio[0].set_value(page).run()
            self.assertFalse(app.exception)
        from storage import Store
        self.assertEqual(Store(os.environ['RUTA_DB_PATH']).list('local'),[])

    def test_public_local_mode_blocked(self):
        st.config.set_option('server.address','0.0.0.0')
        app = AppTest.from_file(APP).run()
        self.assertTrue(any('modo local requiere' in x.value for x in app.error))

if __name__ == '__main__':
    unittest.main()
