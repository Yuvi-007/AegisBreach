"""Unicode mutators: look-alike characters and invisible characters."""

import string
from collections.abc import Iterable
from itertools import groupby

from app.engine.mutators.base import BaseMutator, substitute, unique

# Latin letter -> visually identical Cyrillic letter.
HOMOGLYPH_MAP = {
    "a": "\u0430", "c": "\u0441", "e": "\u0435", "i": "\u0456", "j": "\u0458",
    "o": "\u043e", "p": "\u0440", "s": "\u0455", "x": "\u0445", "y": "\u0443",
    "A": "\u0410", "B": "\u0412", "C": "\u0421", "E": "\u0415", "H": "\u041d",
    "I": "\u0406", "J": "\u0408", "K": "\u041a", "M": "\u041c", "O": "\u041e",
    "P": "\u0420", "S": "\u0405", "T": "\u0422", "X": "\u0425", "Y": "\u04ae",
}
_HOMOGLYPH_TABLE = str.maketrans(HOMOGLYPH_MAP)

ZWSP = "\u200b"  # zero-width space
ZWNJ = "\u200c"  # zero-width non-joiner
ZWJ = "\u200d"   # zero-width joiner
WORD_JOINER = "\u2060"
ZERO_WIDTH_CHARS = (ZWSP, ZWNJ, ZWJ, WORD_JOINER)


class HomoglyphMutator(BaseMutator):
    name = "homoglyph"
    description = "Swaps Latin letters for identical-looking Cyrillic ones (a, c, e, o, p, ...)."
    category = "unicode"

    def mutate(self, text: str, *, intensity: float = 1.0, seed: int | None = None) -> list[str]:
        """intensity=1.0 swaps every match; lower values swap each match with that probability."""
        if not text:
            return [text]
        return [substitute(text, HOMOGLYPH_MAP, _HOMOGLYPH_TABLE, intensity, seed)]


class ZeroWidthMutator(BaseMutator):
    name = "zero_width"
    description = "Hides zero-width characters inside words so keyword filters miss them."
    category = "unicode"

    def mutate(
        self,
        text: str,
        *,
        chars: Iterable[str] = (ZWSP, ZWJ),
        targets: Iterable[str] | None = None,
    ) -> list[str]:
        """Return one variant per zero-width character in chars.

        targets limits injection to those words (case-insensitive, surrounding
        punctuation ignored). By default every word is split up.
        """
        chars = tuple(chars)
        if not chars:
            raise ValueError("chars must contain at least one zero-width character")
        invalid = [c for c in chars if c not in ZERO_WIDTH_CHARS]
        if invalid:
            raise ValueError(f"Not zero-width characters: {invalid!r}")
        if not text:
            return [text]

        if targets is None and not any(zw in text for zw in ZERO_WIDTH_CHARS):
            return unique(_split_every_word(text, zw) for zw in chars)

        wanted = None if targets is None else {t.casefold() for t in targets}
        # groupby splits text into runs of whitespace / non-whitespace in one pass.
        runs = ["".join(group) for _, group in groupby(text, key=str.isspace)]

        def should_split(run: str) -> bool:
            if run[0].isspace():
                return False
            return wanted is None or run.strip(string.punctuation).casefold() in wanted

        split_mask = [should_split(run) for run in runs]
        return unique(
            "".join(zw.join(run) if split else run for run, split in zip(runs, split_mask))
            for zw in chars
        )


def _split_every_word(text: str, zw: str) -> str:
    """Put zw between every pair of adjacent non-whitespace characters.

    Joins zw between all characters, then removes it again next to whitespace.
    Each step is a C-level pass and there are only a few whitespace characters,
    so this stays O(N). Only valid when text has no zero-width characters already.
    """
    result = zw.join(text)
    for ws in {c for c in set(text) if c.isspace()}:
        result = result.replace(zw + ws, ws).replace(ws + zw, ws)
    return result
