"""SQLite repository: owner isolation and optimistic concurrency."""
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from engine import validate

class Conflict(ValueError):
    pass

class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            version = db.execute('PRAGMA user_version').fetchone()[0]
            if version > 1:
                raise RuntimeError('La base de datos pertenece a una versión más reciente.')
            if version < 1:
                db.executescript((Path(__file__).parent/'migrations/001_initial.sql').read_text())

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        try:
            db.execute('PRAGMA journal_mode=WAL')
            with db:
                yield db
        finally:
            db.close()

    def list(self, owner):
        with self.connect() as db:
            return [json.loads(row[0]) for row in db.execute('SELECT payload FROM vehicles WHERE owner=? ORDER BY updated_at DESC, id', (owner,))]

    def save(self, owner, vehicle):
        if not owner:
            raise ValueError('Inicia sesión para guardar.')
        validate(vehicle)
        saved = dict(vehicle, revision=vehicle.get('revision', 0)+1)
        payload = json.dumps(saved, allow_nan=False)
        with self.connect() as db:
            if vehicle.get('revision', 0) == 0:
                try:
                    db.execute('INSERT INTO vehicles(owner,id,revision,payload) VALUES(?,?,?,?)', (owner, vehicle['id'], 1, payload))
                except sqlite3.IntegrityError as exc:
                    raise Conflict('El vehículo ya existe. Recarga la página.') from exc
            else:
                updated = db.execute('UPDATE vehicles SET revision=?,payload=?,updated_at=CURRENT_TIMESTAMP WHERE owner=? AND id=? AND revision=?',
                                     (saved['revision'], payload, owner, vehicle['id'], vehicle['revision']))
                if updated.rowcount != 1:
                    raise Conflict('Otra sesión cambió este vehículo. Recarga antes de guardar.')
        return saved
