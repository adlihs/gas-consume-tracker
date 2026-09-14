"""Explicit single-user mode, bound to the loopback interface."""
import os
from pathlib import Path
import subprocess
import sys

if __name__ == '__main__':
    root = Path(__file__).resolve().parent
    env = dict(os.environ, RUTA_AUTH_MODE='local')
    raise SystemExit(subprocess.call([sys.executable, '-m', 'streamlit', 'run', str(root/'app.py'),
                                     '--server.address=127.0.0.1'], cwd=root, env=env))
