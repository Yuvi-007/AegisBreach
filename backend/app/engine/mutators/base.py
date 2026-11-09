"""Base class and shared helpers for prompt mutators.

Mutators never use regular expressions. Every transform is a single pass over
the input (str.translate, str.join, slicing or itertools.groupby), so run time
grows linearly with input length and there is no ReDoS risk.
"""

import random
from abc import ABC, abstractmethod
from collections.abc import Iterable, Mapping
from typing import Any, ClassVar

CATEGORIES = ("typographic", "unicode", "encoding", "framing")


class BaseMutator(ABC):
    """A transform that turns one prompt into one or more adversarial variants."""

    name: ClassVar[str]
    description: ClassVar[str]
    category: ClassVar[str]

    @abstractmethod
    def mutate(self, text: str, **kwargs: Any) -> list[str]:
        """Return 1 or more variants of text. Empty input comes back as [text]."""


def make_rng(seed: int | None) -> random.Random:
    """Seeded RNG for reproducible variants. Not used for anything security-related."""
    return random.Random(seed)  # nosec B311


def check_intensity(intensity: float) -> None:
    if not 0.0 <= intensity <= 1.0:
        raise ValueError(f"intensity must be between 0.0 and 1.0, got {intensity}")


def substitute(
    text: str,
    table: Mapping[str, str],
    translation: dict[int, str],
    intensity: float,
    seed: int | None,
) -> str:
    """Replace characters found in table.

    intensity=1.0 replaces every match (deterministic, C-speed str.translate).
    Lower values replace each match with that probability, using seed.
    """
    check_intensity(intensity)
    if intensity == 1.0:
        return text.translate(translation)
    if intensity == 0.0:
        return text
    rng = make_rng(seed)
    return "".join(
        table[ch] if ch in table and rng.random() < intensity else ch for ch in text
    )


def unique(variants: Iterable[str]) -> list[str]:
    """Drop duplicate variants, keeping first-seen order."""
    return list(dict.fromkeys(variants))
