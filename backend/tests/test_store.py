"""Tests for the in-memory run store (Module 5)."""

import threading
import uuid

import pytest
from pydantic import ValidationError

from app.core.store import RunStore, TooManyActiveRunsError, get_run_store, run_store
from app.engine.judge.evaluator import calculate_metrics


def create(store: RunStore, **overrides):
    kwargs = {"target_type": "mock", "target_url": "mock://local", "suite_names": ["owasp_llm_top10"]}
    return store.create_run(**{**kwargs, **overrides})


def finish(store: RunStore, run_id: str):
    return store.update_run(run_id, status="COMPLETED")


def test_create_and_get():
    store = RunStore()
    record = create(store, mutator_names=["leetspeak"], max_concurrency=3)
    uuid.UUID(record.run_id, version=4)
    assert record.status == "QUEUED"
    assert record.created_at.tzinfo is not None
    assert (record.mutator_names, record.max_concurrency) == (["leetspeak"], 3)
    assert store.get_run(record.run_id) == record
    assert store.get_run("missing") is None
    assert len(store) == 1


def test_records_are_immutable_snapshots():
    store = RunStore()
    record = create(store)
    with pytest.raises(ValidationError):
        record.status = "RUNNING"
    store.update_run(record.run_id, status="RUNNING")
    assert record.status == "QUEUED"
    assert store.get_run(record.run_id).status == "RUNNING"


def test_update_run_validates_fields_and_values():
    store = RunStore()
    record = create(store)
    metrics = calculate_metrics([])
    updated = store.update_run(record.run_id, status="COMPLETED", metrics=metrics)
    assert updated.metrics == metrics
    with pytest.raises(KeyError):
        store.update_run("missing", status="RUNNING")
    with pytest.raises(ValueError, match="Cannot update fields"):
        store.update_run(record.run_id, colour="blue")
    with pytest.raises(ValueError, match="run_id"):
        store.update_run(record.run_id, run_id="other")
    with pytest.raises(ValidationError):
        store.update_run(record.run_id, status="PAUSED")


def test_list_runs_newest_first_with_paging():
    store = RunStore()
    ids = [finish(store, create(store).run_id).run_id for _ in range(5)]
    assert [r.run_id for r in store.list_runs()] == ids[::-1]
    assert [r.run_id for r in store.list_runs(limit=2, offset=1)] == [ids[3], ids[2]]
    assert store.list_runs(limit=0) == []
    with pytest.raises(ValueError):
        store.list_runs(limit=-1)


def test_refuses_new_runs_past_the_active_limit():
    store = RunStore(max_runs=10, max_active_runs=2)
    first, _ = create(store), create(store)
    with pytest.raises(TooManyActiveRunsError, match="limit 2"):
        create(store)
    finish(store, first.run_id)
    create(store)  # a slot freed up


def test_evicts_oldest_finished_runs_first():
    store = RunStore(max_runs=3, max_active_runs=2)
    oldest = finish(store, create(store).run_id)
    active = create(store)
    newer = finish(store, create(store).run_id)
    newest = create(store)
    assert len(store) == 3
    assert store.get_run(oldest.run_id) is None
    assert store.get_run(active.run_id) is not None
    assert store.get_run(newer.run_id) is not None
    assert store.get_run(newest.run_id) is not None


@pytest.mark.parametrize(
    "kwargs", [{"max_runs": 0}, {"max_active_runs": 0}, {"max_runs": 2, "max_active_runs": 3}]
)
def test_rejects_bad_limits(kwargs):
    with pytest.raises(ValueError):
        RunStore(**kwargs)


def test_concurrent_creates_and_updates_are_safe():
    store = RunStore(max_runs=1000, max_active_runs=1000)
    created: list[str] = []
    lock = threading.Lock()

    def worker():
        for _ in range(50):
            record = create(store)
            store.update_run(record.run_id, status="RUNNING")
            with lock:
                created.append(record.run_id)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(store) == len(set(created)) == 400
    assert all(store.get_run(rid).status == "RUNNING" for rid in created)


def test_default_store_dependency():
    assert get_run_store() is run_store
    assert isinstance(run_store, RunStore)
