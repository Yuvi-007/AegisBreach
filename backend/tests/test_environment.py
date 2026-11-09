import pytest
import sys

def test_python_version():
    """Verify runtime is Python 3.10+."""
    assert sys.version_info >= (3, 10), "Python version must be 3.10 or higher"

def test_imports():
    """Verify core dependencies load without errors."""
    import fastapi
    import pydantic
    import httpx
    assert fastapi.__version__ is not None
    assert pydantic.__version__ is not None
    assert httpx.__version__ is not None

def test_app_package_imports():
    """Verify the project imports as `app.*` (backend/ is on sys.path)."""
    import app.api.v1
    import app.core
    import app.engine.judge
    import app.engine.mutators
    import app.engine.targets
    from pathlib import Path
    assert Path(app.__file__).parent.parent.name == "backend"
