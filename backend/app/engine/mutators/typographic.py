"""Typographic mutators: character swaps and casing changes."""

import operator

from app.engine.mutators.base import BaseMutator, make_rng, substitute, unique

# Maps each byte value to its lowest bit, turning random bytes into 0/1 flips.
_LOW_BIT = bytes(i & 1 for i in range(256))

LEET_MAP = {
    "a": "4", "A": "4",
    "e": "3", "E": "3",
    "i": "1", "I": "1",
    "o": "0", "O": "0",
    "s": "5", "S": "5",
    "t": "7", "T": "7",
}
_LEET_TABLE = str.maketrans(LEET_MAP)


class LeetspeakMutator(BaseMutator):
    name = "leetspeak"
    description = "Swaps letters for look-alike digits (a->4, e->3, i->1, o->0, s->5, t->7)."
    category = "typographic"

    def mutate(self, text: str, *, intensity: float = 1.0, seed: int | None = None) -> list[str]:
        """intensity=1.0 swaps every match; lower values swap each match with that probability."""
        if not text:
            return [text]
        return [substitute(text, LEET_MAP, _LEET_TABLE, intensity, seed)]


class CaseJitterMutator(BaseMutator):
    name = "case_jitter"
    description = "Alternating and randomized letter casing (e.g. 'iGNoRe pReVIous')."
    category = "typographic"

    def mutate(self, text: str, *, seed: int | None = None) -> list[str]:
        """Return [alternating case, random case], minus duplicates."""
        if not text:
            return [text]
        rng = make_rng(seed)
        # One random 0/1 per character, generated in C.
        coin_flips = rng.randbytes(len(text)).translate(_LOW_BIT)

        lower, upper = text.lower(), text.upper()
        if len(lower) == len(upper) == len(text):
            # Fast path: slicing and map() keep the per-character work in C.
            alternating = list(lower)
            alternating[1::2] = upper[1::2]
            randomized = map(operator.getitem, zip(lower, upper), coin_flips)
        else:
            # Some characters change length when re-cased (e.g. German sharp s -> 'SS'), so
            # whole-string slices would no longer line up. Re-case one at a time.
            alternating = [c.upper() if i % 2 else c.lower() for i, c in enumerate(text)]
            randomized = (c.upper() if flip else c.lower() for c, flip in zip(text, coin_flips))

        return unique(["".join(alternating), "".join(randomized)])
