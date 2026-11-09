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
