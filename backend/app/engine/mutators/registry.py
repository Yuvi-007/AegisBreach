"""Find, register and run prompt mutators."""

import functools
import importlib
import inspect
import pkgutil
from collections.abc import Mapping, Sequence
from typing import Any, Literal

from app.engine.mutators.base import CATEGORIES, BaseMutator, unique

PipelineMode = Literal["independent", "chain"]
DEFAULT_MAX_VARIANTS = 100


class MutatorNotFoundError(LookupError):
    """Raised when a mutator name is not registered."""


def _check_metadata(mutator: BaseMutator) -> None:
    for attr in ("name", "description", "category"):
        value = getattr(mutator, attr, None)
        if not isinstance(value, str) or not value.strip():
            raise TypeError(f"{type(mutator).__name__}.{attr} must be a non-empty string")
    if mutator.category not in CATEGORIES:
        raise ValueError(
            f"{type(mutator).__name__}.category {mutator.category!r} must be one of {CATEGORIES}"
        )


class MutatorRegistry:
    def __init__(self) -> None:
        self._mutators: dict[str, BaseMutator] = {}

    def register(self, mutator: BaseMutator | type[BaseMutator]) -> BaseMutator:
        """Register a mutator instance or class. Names must be unique."""
        instance = mutator() if isinstance(mutator, type) else mutator
        if not isinstance(instance, BaseMutator):
            raise TypeError(f"{instance!r} is not a BaseMutator")
        _check_metadata(instance)
        if instance.name in self._mutators:
            raise ValueError(f"Mutator {instance.name!r} is already registered")
        self._mutators[instance.name] = instance
        return instance

    def discover(self, package: str = "app.engine.mutators") -> list[str]:
        """Import every module in package and register the concrete mutators defined there.

        Safe to call more than once: classes that are already registered are skipped.
        Returns the names registered by this call.
        """
        pkg = importlib.import_module(package)
        added: list[str] = []
        for info in pkgutil.iter_modules(pkg.__path__, prefix=f"{pkg.__name__}."):
            module = importlib.import_module(info.name)
            for obj in vars(module).values():
                if not (
                    inspect.isclass(obj)
                    and issubclass(obj, BaseMutator)
                    and obj.__module__ == module.__name__
                    and not inspect.isabstract(obj)
                ):
                    continue
                existing = self._mutators.get(getattr(obj, "name", None))
                if existing is not None and type(existing) is obj:
                    continue
                added.append(self.register(obj).name)
        return added

    def get(self, name: str) -> BaseMutator:
        try:
            return self._mutators[name]
        except KeyError:
            raise MutatorNotFoundError(
                f"Unknown mutator {name!r}; available: {sorted(self._mutators)}"
            ) from None

    def by_category(self, category: str) -> list[BaseMutator]:
        if category not in CATEGORIES:
            raise ValueError(f"Unknown category {category!r}; choose from {CATEGORIES}")
        return [m for m in self._mutators.values() if m.category == category]

    def names(self) -> list[str]:
        return list(self._mutators)

    def describe(self) -> list[dict[str, str]]:
        """Name, description and category of every mutator, for the UI."""
        return [
            {"name": m.name, "description": m.description, "category": m.category}
            for m in self._mutators.values()
        ]

    def __contains__(self, name: object) -> bool:
        return name in self._mutators

    def __len__(self) -> int:
        return len(self._mutators)

    def apply_pipeline(
        self,
        text: str,
        mutator_names: Sequence[str],
        *,
        mode: PipelineMode = "independent",
        options: Mapping[str, Mapping[str, Any]] | None = None,
        max_variants: int = DEFAULT_MAX_VARIANTS,
    ) -> list[dict[str, str]]:
        """Run mutators over text and return [{"mutator", "variant", "category"}, ...].

        mode="independent": each mutator runs on the original text.
        mode="chain": each mutator runs on every variant from the previous one; the
            result is labelled with the joined names/categories, e.g.
            "leetspeak>base64_wrapper" / "typographic>encoding".
        options: per-mutator keyword arguments, e.g. {"leetspeak": {"intensity": 0.5}}.
        max_variants: cap on variants kept after each chain step (and in total for
            independent mode), so chaining cannot blow up combinatorially.
        """
        if not mutator_names:
            raise ValueError("mutator_names must not be empty")
        if mode not in ("independent", "chain"):
            raise ValueError(f"mode must be 'independent' or 'chain', got {mode!r}")
        if max_variants < 1:
            raise ValueError("max_variants must be at least 1")
        options = dict(options or {})
        stray = sorted(set(options) - set(mutator_names))
        if stray:
            raise ValueError(f"options given for mutators not in the pipeline: {stray}")

        # Look everything up first so a typo fails before any work is done.
        mutators = [self.get(name) for name in mutator_names]

        if mode == "independent":
            results = [
                {"mutator": m.name, "variant": variant, "category": m.category}
                for m in mutators
                for variant in m.mutate(text, **options.get(m.name, {}))
            ]
            return results[:max_variants]

        variants = [text]
        for m in mutators:
            kwargs = options.get(m.name, {})
            variants = unique(out for v in variants for out in m.mutate(v, **kwargs))
            variants = variants[:max_variants]
        label = ">".join(m.name for m in mutators)
        category = ">".join(m.category for m in mutators)
        return [{"mutator": label, "variant": v, "category": category} for v in variants]


@functools.cache
def get_default_registry() -> MutatorRegistry:
    """Shared registry holding every built-in mutator."""
    registry = MutatorRegistry()
    registry.discover()
    return registry


def apply_pipeline(text: str, mutator_names: Sequence[str], **kwargs: Any) -> list[dict[str, str]]:
    """Run mutators from the default registry. See MutatorRegistry.apply_pipeline."""
    return get_default_registry().apply_pipeline(text, mutator_names, **kwargs)
