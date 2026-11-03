"""Basira-authored Stage 0 screening tasks (A10 follow-up, DECISIONS 2026-11-03).

Three tasks that use a published task FORMAT with entirely new, generated items. They never reuse the original
tests' items, pictures, layouts or names, and they have no norms: the scorer returns a raw proportion correct only.

- nonverbal-pattern-basira-v0 (construct nonverbal_iq): "pick the missing piece" with generated SVG figures in
  three blocks (sequence, 3x3 grid, analogy). Format family: matrix-reasoning tasks such as Raven (1938).
  Exclusionary use only; never shown as an IQ.
- orientation-basira-v0 (construct reversal): same vs mirrored shapes, normal vs mirrored Arabic letters, and a
  non-mirror control block, after the mirror-discrimination idea in Houbben & Vannuscorps (2022). Supplementary only.
- number-sense-basira-v0 (construct dyscalculia): reaction-time baseline (unscored), dot counting, number comparison
  with size conflict, single-digit addition; the block structure follows Butterworth (2003).

Every item passes deterministic validators; an item that fails is discarded and a new one is drawn (never repaired).
Colours come from a fixed palette with no red (non-negotiable 3). Output is identical in content/dist/stage0/ (read by
the web app) and basira_ai/data/stage0/ (read by the scorer); answers are included, as in the item bank.
"""

from __future__ import annotations

import json
import math
import random
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from importlib import resources
from pathlib import Path

VERSION = "0.1.0"
SEED = 20261103
NOTICE_AR = "مُهِمَّةُ فَحْصٍ مِنْ إِعْدادِ بَصيرَة، غَيْرُ مُقَنَّنَةٍ"
NOTICE_EN = "Basira-authored screening task, not standardized. Raw score only; no norms apply."

# no red anywhere in the child's experience: every colour must come from this list
PALETTE = {"blue": "#2563EB", "green": "#15803D", "purple": "#7C3AED", "amber": "#CA8A04", "teal": "#0F766E"}
INK = "#1F2937"  # figure outlines, digits, letters
MUTED = "#9CA3AF"  # empty-slot frame and "?"
ALLOWED_COLOURS = {*PALETTE.values(), INK, MUTED, "none", "#FFFFFF"}
ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
FONT = "Noto Naskh Arabic, Amiri, Scheherazade New, serif"


def ar(n: int) -> str:
    return "".join(ARABIC_DIGITS[int(d)] for d in str(n))


class Rejected(ValueError):
    """An item failed validation and is discarded."""


# ---------------------------------------------------------------- SVG figures

SHAPES = ("circle", "square", "triangle", "diamond", "hexagon")
SIZES = {1: 0.22, 2: 0.32, 3: 0.42}  # fraction of the panel
ROTATIONS = (0, 90, 180, 270)


@dataclass(frozen=True)
class Figure:
    shape: str = "circle"
    colour: str = "blue"
    size: int = 2
    count: int = 1
    rot: int = 0  # only visible on the "arrow" shape

    def key(self) -> tuple:
        return (self.shape, self.colour, self.size, self.count, self.rot if self.shape == "arrow" else 0)


def _polygon(points: list[tuple[float, float]]) -> str:
    return " ".join(f"{x:.1f},{y:.1f}" for x, y in points)


def _shape(shape: str, cx: float, cy: float, r: float, fill: str, rot: int) -> str:
    style = f'fill="{fill}" stroke="{INK}" stroke-width="1.5"'
    if shape == "circle":
        return f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" {style}/>'
    if shape == "square":
        return f'<rect x="{cx - r:.1f}" y="{cy - r:.1f}" width="{2 * r:.1f}" height="{2 * r:.1f}" {style}/>'
    if shape == "triangle":
        pts = [(cx, cy - r), (cx + r * 0.95, cy + r * 0.8), (cx - r * 0.95, cy + r * 0.8)]
    elif shape == "diamond":
        pts = [(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)]
    elif shape == "hexagon":
        pts = [(cx + r * math.cos(math.pi / 3 * i), cy + r * math.sin(math.pi / 3 * i)) for i in range(6)]
    elif shape == "arrow":  # points up at rot=0; asymmetric under rotation only
        pts = [(cx, cy - r), (cx + r * 0.8, cy), (cx + r * 0.3, cy), (cx + r * 0.3, cy + r),
               (cx - r * 0.3, cy + r), (cx - r * 0.3, cy), (cx - r * 0.8, cy)]
        return f'<polygon points="{_polygon(pts)}" {style} transform="rotate({rot} {cx:.1f} {cy:.1f})"/>'
    else:
        raise ValueError(shape)
    return f'<polygon points="{_polygon(pts)}" {style}/>'


COUNT_LAYOUT = {1: [(0.5, 0.5)], 2: [(0.3, 0.5), (0.7, 0.5)], 3: [(0.5, 0.28), (0.28, 0.72), (0.72, 0.72)],
                4: [(0.28, 0.28), (0.72, 0.28), (0.28, 0.72), (0.72, 0.72)]}


def figure_svg(f: Figure, x: float, y: float, w: float) -> str:
    """The figure drawn inside the square panel at (x, y) with side w."""
    scale = 1.0 if f.count == 1 else 0.55
    r = SIZES[f.size] * w * scale
    return "".join(_shape(f.shape, x + px * w, y + py * w, r, PALETTE[f.colour], f.rot)
                   for px, py in COUNT_LAYOUT[f.count])


def panel(x: float, y: float, w: float, content: str = "", empty: bool = False) -> str:
    frame = MUTED if empty else INK
    dash = ' stroke-dasharray="6 4"' if empty else ""
    mark = (f'<text x="{x + w / 2:.1f}" y="{y + w * 0.66:.1f}" font-size="{w * 0.45:.1f}" text-anchor="middle" '
            f'fill="{MUTED}" font-family="{FONT}">؟</text>') if empty else ""
    return (f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{w:.1f}" rx="6" fill="#FFFFFF" '
            f'stroke="{frame}" stroke-width="2"{dash}/>{content}{mark}')


def svg(width: float, height: float, body: str, label: str) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} {height:.0f}" role="img" '
            f'aria-label="{label}">{body}</svg>')


def single(f: Figure) -> str:
    return svg(100, 100, panel(2, 2, 96, figure_svg(f, 2, 2, 96)), "شَكْل")


# ---------------------------------------------------------------- validators


def check_svg(markup: str) -> None:
    try:
        root = ET.fromstring(markup)
    except ET.ParseError as e:
        raise Rejected(f"svg does not parse: {e}") from e
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        if tag in {"script", "foreignObject", "image", "use"}:
            raise Rejected(f"svg contains <{tag}>")
        for attr, value in el.attrib.items():
            name = attr.split("}")[-1]
            if name.startswith("on") or name == "href":
                raise Rejected(f"svg attribute {name} not allowed")
            if name in {"fill", "stroke"} and value not in ALLOWED_COLOURS:
                raise Rejected(f"colour {value} is not in the palette (no red)")


def check_choice(item: dict, figures: dict[str, Figure], answer: Figure) -> None:
    keys = [f.key() for f in figures.values()]
    if len(set(keys)) != len(keys):
        raise Rejected("two options look the same")
    if keys.count(answer.key()) != 1:
        raise Rejected("not exactly one option matches the rule")
    if item["answer"] not in figures or figures[item["answer"]].key() != answer.key():
        raise Rejected("answer id does not point at the correct figure")


# ---------------------------------------------------------------- task 1: pattern completion

ATTRS = {"shape": SHAPES, "colour": tuple(PALETTE), "size": (1, 2, 3), "count": (1, 2, 3, 4)}


def _random_figure(rng: random.Random, **fixed) -> Figure:
    f = Figure(shape=rng.choice(SHAPES), colour=rng.choice(tuple(PALETTE)), size=rng.choice((1, 2, 3)), count=1)
    return replace(f, **fixed)


def _mutate(rng: random.Random, f: Figure, attrs: tuple[str, ...]) -> Figure:
    attr = rng.choice(attrs)
    if attr == "rot":
        return replace(f, rot=rng.choice([r for r in ROTATIONS if r != f.rot]))
    return replace(f, **{attr: rng.choice([v for v in ATTRS[attr] if v != getattr(f, attr)])})


def _options(rng: random.Random, answer: Figure, plausible: list[Figure], attrs: tuple[str, ...], n: int = 6):
    pool = [answer]
    for p in plausible:
        if p.key() not in {q.key() for q in pool}:
            pool.append(p)
    tries = 0
    while len(pool) < n and tries < 500:
        tries += 1
        cand = _mutate(rng, answer, attrs)
        if rng.random() < 0.35:
            cand = _mutate(rng, cand, attrs)
        if cand.key() not in {q.key() for q in pool}:
            pool.append(cand)
    pool = pool[:n]
    rng.shuffle(pool)
    ids = [f"o{i + 1}" for i in range(len(pool))]
    figures = dict(zip(ids, pool, strict=True))
    answer_id = next(i for i, f in figures.items() if f.key() == answer.key())
    return figures, answer_id


def _choice_item(item_id, kind, stimulus, figures, answer_id, answer, practice):
    item = {
        "item_id": item_id, "kind": kind, "practice": practice, "stimulus_svg": stimulus, "stimulus_text": None,
        "options": [{"option_id": i, "svg": single(f), "text": None} for i, f in figures.items()],
        "response_type": "option_id", "answer": answer_id,
    }
    check_choice(item, figures, answer)
    for markup in [stimulus, *(o["svg"] for o in item["options"])]:
        check_svg(markup)
    return item


SEQUENCE_RULES = ("colour_cycle", "shape_cycle", "size_grow", "count_grow", "rotate")
ANALOGY_CHANGES = ("colour", "size", "shape", "count", "rot")


def sequence_item(rng: random.Random, item_id: str, practice: bool, k: int = 0) -> dict:
    """Four panels follow one rule; choose the fifth. Rules rotate with k so every block covers all of them."""
    rule = SEQUENCE_RULES[k % len(SEQUENCE_RULES)]
    base = _random_figure(rng)
    if rule == "colour_cycle":
        a, b = rng.sample(tuple(PALETTE), 2)
        seq = [replace(base, colour=c) for c in (a, b, a, b, a)]
        attrs = ("colour", "shape", "size")
    elif rule == "shape_cycle":
        s = rng.sample(SHAPES, 2)
        seq = [replace(base, shape=x) for x in (s[0], s[1], s[0], s[1], s[0])]
        attrs = ("shape", "colour", "size")
    elif rule == "size_grow":
        sizes = (1, 2, 3, 1, 2) if rng.random() < 0.5 else (3, 2, 1, 3, 2)
        seq = [replace(base, size=x) for x in sizes]
        attrs = ("size", "colour", "shape")
    elif rule == "count_grow":  # counts cycle; at most 4 per panel
        counts = rng.choice(((1, 2, 1, 2, 1), (1, 2, 3, 1, 2), (4, 3, 2, 1, 4), (1, 2, 3, 4, 1)))
        seq = [replace(base, size=2, count=c) for c in counts]
        attrs = ("count", "colour", "shape")
    else:  # rotate an arrow by 90 degrees each step
        base = replace(base, shape="arrow", rot=rng.choice(ROTATIONS))
        seq = [replace(base, rot=(base.rot + 90 * i) % 360) for i in range(5)]
        attrs = ("rot", "colour")
    shown, answer = seq[:4], seq[4]
    w, gap = 90, 10
    width = 5 * (w + gap) + gap
    xs = [width - gap - w - i * (w + gap) for i in range(5)]  # right to left: Arabic reading order
    body = "".join(panel(xs[i], gap, w, figure_svg(f, xs[i], gap, w)) for i, f in enumerate(shown))
    body += panel(xs[4], gap, w, empty=True)
    stimulus = svg(width, w + 2 * gap, body, "سِلْسِلَةُ أَشْكال")
    figures, answer_id = _options(rng, answer, [shown[-1], shown[-2]], attrs)
    item = _choice_item(item_id, "pattern_sequence", stimulus, figures, answer_id, answer, practice)
    item["rule"] = rule
    return item


def matrix_item(rng: random.Random, item_id: str, practice: bool) -> dict:
    """3x3 grid: the row sets one attribute and the column another; the bottom-right cell is missing."""
    row_attr, col_attr = rng.sample(("shape", "colour", "size", "count"), 2)
    rows = rng.sample(list(ATTRS[row_attr])[:3] if row_attr in {"size"} else list(ATTRS[row_attr]), 3)
    cols = rng.sample(list(ATTRS[col_attr]), 3)
    base = _random_figure(rng, size=2)
    grid = [[replace(base, **{row_attr: rows[r], col_attr: cols[c]}) for c in range(3)] for r in range(3)]
    answer = grid[2][2]
    w, gap = 90, 10
    body = ""
    for r in range(3):
        for c in range(3):
            x, y = gap + c * (w + gap), gap + r * (w + gap)
            body += panel(x, y, w, empty=True) if (r, c) == (2, 2) else panel(x, y, w, figure_svg(grid[r][c], x, y, w))
    stimulus = svg(3 * (w + gap) + gap, 3 * (w + gap) + gap, body, "شَبَكَةُ أَشْكال")
    plausible = [grid[2][1], grid[1][2], grid[1][1]]
    figures, answer_id = _options(rng, answer, plausible, (row_attr, col_attr))
    item = _choice_item(item_id, "pattern_matrix", stimulus, figures, answer_id, answer, practice)
    item["rule"] = f"row:{row_attr}, column:{col_attr}"
    return item


def analogy_item(rng: random.Random, item_id: str, practice: bool, k: int = 0) -> dict:
    """A changes into B; apply the same change to C. Changes rotate with k."""
    change = ANALOGY_CHANGES[k % len(ANALOGY_CHANGES)]
    if change == "rot":
        a = _random_figure(rng, shape="arrow", rot=rng.choice(ROTATIONS))
        c = replace(_random_figure(rng, shape="arrow", rot=rng.choice(ROTATIONS)), size=a.size)
        step = rng.choice((90, 180, 270))
        b, d = replace(a, rot=(a.rot + step) % 360), replace(c, rot=(c.rot + step) % 360)
        attrs = ("rot", "colour")
    elif change in {"colour", "shape"}:
        a = _random_figure(rng, count=1)
        new = rng.choice([v for v in ATTRS[change] if v != getattr(a, change)])
        c = replace(_random_figure(rng), **{change: getattr(a, change)})
        if c.key() == a.key():
            raise Rejected("C equals A")
        b, d = replace(a, **{change: new}), replace(c, **{change: new})
        attrs = (change, "shape" if change == "colour" else "colour", "size")
    elif change == "size":
        a = _random_figure(rng, size=1)
        c = _random_figure(rng, size=1)
        b, d = replace(a, size=3), replace(c, size=3)
        attrs = ("size", "colour", "shape")
    else:  # count + 1
        a = _random_figure(rng, size=2, count=rng.choice((1, 2)))
        c = _random_figure(rng, size=2, count=rng.choice((1, 2, 3)))
        b, d = replace(a, count=a.count + 1), replace(c, count=c.count + 1)
        attrs = ("count", "colour", "shape")
    if c.key() in {a.key(), b.key()}:
        raise Rejected("C repeats the example")
    w, gap = 90, 10
    width = 4 * w + 2 * gap + 2 * 30 + 50

    def arrow(tip: float) -> str:  # points left (right-to-left reading), tip at x
        pts = _polygon([(tip + 20, 50), (tip, 60), (tip + 20, 70)])
        return f'<polygon points="{pts}" fill="{MUTED}" stroke="none"/>'

    # right to left: A -> B | C -> ?
    xa = width - gap - w
    xb = xa - 30 - w
    xc = xb - 50 - w
    xd = xc - 30 - w
    body = (panel(xa, gap, w, figure_svg(a, xa, gap, w)) + arrow(xb + w + 5)
            + panel(xb, gap, w, figure_svg(b, xb, gap, w))
            + f'<line x1="{xc + w + 25}" y1="15" x2="{xc + w + 25}" y2="{w + 5}" stroke="{MUTED}" stroke-width="2"/>'
            + panel(xc, gap, w, figure_svg(c, xc, gap, w)) + arrow(xd + w + 5)
            + panel(xd, gap, w, empty=True))
    stimulus = svg(width, w + 2 * gap, body, "تَشابُهُ أَشْكال")
    figures, answer_id = _options(rng, d, [c, b], attrs)
    item = _choice_item(item_id, "pattern_analogy", stimulus, figures, answer_id, d, practice)
    item["rule"] = f"change:{change}"
    return item


# ---------------------------------------------------------------- task 2: orientation

# asymmetric outlines (no mirror symmetry) on a 100x100 canvas; all newly drawn for Basira
GLYPHS = {
    "flag": [(30, 15), (30, 85), (40, 85), (40, 50), (75, 38), (40, 22), (40, 15)],
    "boot": [(30, 15), (50, 15), (50, 65), (80, 65), (80, 85), (30, 85)],
    "hook": [(35, 15), (70, 15), (70, 55), (50, 55), (50, 85), (35, 85)],
    "step": [(20, 85), (20, 60), (45, 60), (45, 35), (70, 35), (70, 15), (85, 15), (85, 85)],
    "key": [(20, 40), (55, 40), (55, 30), (80, 30), (80, 70), (55, 70), (55, 55), (45, 55), (45, 65), (35, 65),
            (35, 55), (20, 55)],
    "sail": [(30, 85), (30, 15), (78, 70), (45, 70), (45, 85)],
    "bird": [(15, 50), (45, 35), (60, 15), (65, 40), (88, 55), (60, 60), (40, 85), (40, 60)],
    "chair": [(30, 15), (42, 15), (42, 55), (75, 55), (75, 85), (65, 85), (65, 67), (42, 67), (42, 85), (30, 85)],
}


def _check_glyphs() -> None:
    """A glyph with a mirror axis would make a "mirror" item look like a rotation, or identical: reject such glyphs."""
    for name, pts in GLYPHS.items():
        cx = sum(x for x, _ in pts) / len(pts)
        cy = sum(y for _, y in pts) / len(pts)
        base = {(round(x - cx, 1), round(y - cy, 1)) for x, y in pts}
        mirrored = {(-x, y) for x, y in base}
        rotations = [{(round(x * c - y * s_, 1) + 0.0, round(x * s_ + y * c, 1) + 0.0) for x, y in base}
                     for c, s_ in ((1, 0), (0, 1), (-1, 0), (0, -1))]
        if any(mirrored == r for r in rotations):
            raise Rejected(f"glyph {name} is mirror-symmetric")


# isolated letters whose mirror image is clearly different (no left-right symmetry)
LETTERS = ("ج", "ع", "ك", "ل", "ر", "د", "ف", "ق", "ب", "ن", "ي", "ح", "ش", "ص")


def _glyph(points, x: float, colour: str, mirror: bool, extra: str = "", scale: float = 1.0) -> str:
    body = (f'<polygon points="{_polygon(points)}" fill="{PALETTE[colour]}" stroke="{INK}" stroke-width="2"/>'
            + extra)
    t = f"translate({x + (100 if mirror else 0):.1f} 0) scale({-1 if mirror else 1} 1)"
    if scale != 1.0:
        t += f" translate(50 50) scale({scale}) translate(-50 -50)"
    return f'<g transform="{t}">{body}</g>'


def _pair_svg(left: str, right: str) -> str:
    return svg(240, 110, panel(5, 5, 100) + f'<g transform="translate(5 5)">{left}</g>'
               + panel(135, 5, 100) + f'<g transform="translate(135 5)">{right}</g>', "شَكْلانِ")


SAME_MIRROR = [{"option_id": "same", "svg": None, "text": "مُتَشابِهانِ"},
               {"option_id": "mirror", "svg": None, "text": "في المِرْآةِ"}]
LETTER_OPTIONS = [{"option_id": "normal", "svg": None, "text": "كَما نَكْتُبُهُ"},
                  {"option_id": "mirror", "svg": None, "text": "في المِرْآةِ"}]
SAME_DIFFERENT = [{"option_id": "same", "svg": None, "text": "مُتَشابِهانِ"},
                  {"option_id": "different", "svg": None, "text": "مُخْتَلِفانِ"}]


def _binary_item(item_id, kind, stimulus, options, answer, practice, rule):
    check_svg(stimulus)
    if answer not in {o["option_id"] for o in options}:
        raise Rejected("answer is not an option")
    return {"item_id": item_id, "kind": kind, "practice": practice, "stimulus_svg": stimulus, "stimulus_text": None,
            "options": options, "response_type": "option_id", "answer": answer, "rule": rule}


def mirror_item(rng: random.Random, item_id: str, practice: bool, mirrored: bool) -> dict:
    name = rng.choice(tuple(GLYPHS))
    colour = rng.choice(tuple(PALETTE))
    rot = rng.choice((0, 90, 180, 270))
    def rotated(s: str) -> str:
        return f'<g transform="rotate({rot} 50 50)">{s}</g>'
    left = rotated(_glyph(GLYPHS[name], 0, colour, False))
    right = rotated(_glyph(GLYPHS[name], 0, colour, mirrored))
    return _binary_item(item_id, "same_mirror", _pair_svg(left, right), SAME_MIRROR,
                        "mirror" if mirrored else "same", practice, f"glyph:{name}")


def letter_item(rng: random.Random, item_id: str, practice: bool, mirrored: bool, letter: str) -> dict:
    t = ' transform="translate(100 0) scale(-1 1)"' if mirrored else ""
    body = (panel(2, 2, 96) + f'<g{t}><text x="50" y="68" font-size="56" text-anchor="middle" fill="{INK}" '
            f'font-family="{FONT}">{letter}</text></g>')
    return _binary_item(item_id, "letter_orientation", svg(100, 100, body, "حَرْف"), LETTER_OPTIONS,
                        "mirror" if mirrored else "normal", practice, f"letter:{letter}")


def control_item(rng: random.Random, item_id: str, practice: bool, changed: bool) -> dict:
    """Non-mirror change (a dot added or the shape shrunk): shows whether errors are mirror-specific."""
    name = rng.choice(tuple(GLYPHS))
    colour = rng.choice(tuple(PALETTE))
    left = _glyph(GLYPHS[name], 0, colour, False)
    how = rng.choice(("dot", "smaller")) if changed else "none"
    if how == "dot":
        right = _glyph(GLYPHS[name], 0, colour, False, f'<circle cx="80" cy="80" r="7" fill="{INK}"/>')
    elif how == "smaller":
        right = _glyph(GLYPHS[name], 0, colour, False, scale=0.7)
    else:
        right = left
    return _binary_item(item_id, "same_different", _pair_svg(left, right), SAME_DIFFERENT,
                        "different" if changed else "same", practice, f"glyph:{name}, change:{how}")


# ---------------------------------------------------------------- task 3: number sense


def reaction_item(item_id: str, practice: bool) -> dict:
    pts = [(50 + (40 if i % 2 == 0 else 17) * math.sin(math.pi / 5 * i),
            50 - (40 if i % 2 == 0 else 17) * math.cos(math.pi / 5 * i)) for i in range(10)]
    stimulus = svg(100, 100, f'<polygon points="{_polygon(pts)}" fill="{PALETTE["amber"]}" stroke="{INK}" '
                   f'stroke-width="2"/>', "نَجْمَة")
    check_svg(stimulus)
    return {"item_id": item_id, "kind": "reaction", "practice": practice, "stimulus_svg": stimulus,
            "stimulus_text": None, "options": None, "response_type": "tap", "answer": None, "rule": "baseline"}


def dots_item(rng: random.Random, item_id: str, practice: bool, n: int) -> dict:
    r, placed = 9.0, []
    while len(placed) < n:
        x, y = rng.uniform(20, 180), rng.uniform(20, 180)
        if all(math.dist((x, y), p) > 3.2 * r for p in placed):
            placed.append((x, y))
        if len(placed) < n and rng.random() < 0.0005:
            raise Rejected("could not place the dots")
    dots = "".join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{INK}"/>' for x, y in placed)
    stimulus = svg(200, 200, panel(2, 2, 196) + dots, "نُقَط")
    check_svg(stimulus)
    if len(re.findall(r"<circle", stimulus)) != n:
        raise Rejected("dot count does not match the answer")
    return {"item_id": item_id, "kind": "dot_count", "practice": practice, "stimulus_svg": stimulus,
            "stimulus_text": None, "options": None, "response_type": "number", "answer": n, "rule": f"dots:{n}"}


def digit_svg(n: int, size: int) -> str:
    return svg(100, 100, panel(2, 2, 96) + f'<text x="50" y="{50 + size * 0.35:.0f}" font-size="{size}" '
               f'text-anchor="middle" fill="{INK}" font-family="{FONT}">{ar(n)}</text>', ar(n))


def compare_item(rng: random.Random, item_id: str, practice: bool, congruent: bool) -> dict:
    a, b = rng.sample(range(1, 10), 2)
    big, small = max(a, b), min(a, b)
    # congruent: the bigger number is also printed bigger; incongruent: printed smaller (numerical Stroop)
    sizes = {big: 70, small: 40} if congruent else {big: 40, small: 70}
    order = [a, b]
    options = [{"option_id": f"n{n}", "svg": digit_svg(n, sizes[n]), "text": None} for n in order]
    for o in options:
        check_svg(o["svg"])
    if big == small:
        raise Rejected("equal numbers")
    return {"item_id": item_id, "kind": "number_compare", "practice": practice, "stimulus_svg": None,
            "stimulus_text": None, "options": options, "response_type": "option_id", "answer": f"n{big}",
            "rule": "congruent" if congruent else "incongruent"}


def addition_item(rng: random.Random, item_id: str, practice: bool) -> dict:
    total = rng.randint(2, 9)  # sum first, so sums spread over the 1-9 keypad
    a = rng.randint(1, total - 1)
    b = total - a
    if not 2 <= a + b <= 9:
        raise Rejected("sum outside the 1-9 keypad")
    return {"item_id": item_id, "kind": "addition", "practice": practice, "stimulus_svg": None,
            "stimulus_text": f"{ar(a)} + {ar(b)} = ؟", "options": None, "response_type": "number",
            "answer": a + b, "rule": f"{a}+{b}"}


# ---------------------------------------------------------------- assembly


def _draw(make, n_scored: int, prefix: str, report: dict) -> list[dict]:
    """One practice item then n_scored items; a rejected draw is discarded and redrawn (never repaired)."""
    items, seen = [], set()
    attempts = 0
    while len(items) < n_scored + 1:
        attempts += 1
        if attempts > 50 * (n_scored + 1):
            raise RuntimeError(f"{prefix}: too many rejected items")
        k = len(items)  # 0 = practice, then 1..n_scored: lets a block balance its scored items
        practice = k == 0
        item_id = f"{prefix}-p01" if practice else f"{prefix}-{k:02d}"
        try:
            item = make(item_id, practice, k)
        except Rejected as e:
            report["rejected"].append({"block": prefix, "reason": str(e)})
            continue
        signature = (item["stimulus_svg"], item["stimulus_text"], json.dumps(item["options"], ensure_ascii=False))
        if signature in seen and item["kind"] != "reaction":  # baseline trials are identical by design
            report["rejected"].append({"block": prefix, "reason": "duplicate item"})
            continue
        seen.add(signature)
        items.append(item)
    return items


def _block(block_id, title_ar, title_en, instructions_ar, instructions_en, scored, items):
    return {"block_id": block_id, "title_ar": title_ar, "title_en": title_en, "instructions_ar": instructions_ar,
            "instructions_en": instructions_en, "scored": scored, "items": items}


def _taskset(instrument_id, construct, title_ar, title_en, format_source, blocks, generated_at):
    return {"version": VERSION, "generated_at": generated_at, "instrument_id": instrument_id, "construct": construct,
            "title_ar": title_ar, "title_en": title_en, "notice_ar": NOTICE_AR, "notice_en": NOTICE_EN,
            "format_source": format_source,
            "review": {"status": "unreviewed", "reviewer": None, "reviewed_on": None}, "blocks": blocks}


def pattern_task(generated_at: str, report: dict) -> dict:
    rng = random.Random(SEED + 1)
    blocks = [
        _block("sequence", "السِّلْسِلَةُ", "Sequence",
               "هَيّا نَنْظُرُ إِلى الصُّوَرِ، وَنَخْتارُ الصّورَةَ الَّتي تَأْتي بَعْدَها.",
               "Look at the pictures and choose the one that comes next.", True,
               _draw(lambda i, p, k: sequence_item(rng, i, p, k), 8, "seq", report)),
        _block("matrix", "الشَّبَكَةُ", "Grid",
               "هَيّا نَبْحَثُ عَنِ القِطْعَةِ النّاقِصَةِ في الشَّبَكَةِ.",
               "Find the missing piece of the grid.", True,
               _draw(lambda i, p, _: matrix_item(rng, i, p), 8, "grid", report)),
        _block("analogy", "التَّشابُهُ", "Analogy",
               "هذِهِ الصّورَةُ تَغَيَّرَتْ هكَذا. هَيّا نُغَيِّرُ الصّورَةَ الأُخْرى بِالطَّريقَةِ نَفْسِها.",
               "The first picture changed like this; change the other picture the same way.", True,
               _draw(lambda i, p, k: analogy_item(rng, i, p, k), 8, "ana", report)),
    ]
    return _taskset("nonverbal-pattern-basira-v0", "nonverbal_iq", "إِكْمالُ النَّمَطِ", "Complete the pattern",
                    "Matrix-reasoning format (Raven, J.C. 1938, Progressive Matrices); items newly generated by "
                    "Basira, none taken from or adapted from the original.", blocks, generated_at)


def orientation_task(generated_at: str, report: dict) -> dict:
    _check_glyphs()
    rng = random.Random(SEED + 2)
    flips = [False, True, True, False, True, False, False, True]  # 4/4, fixed order, no long runs
    letters = rng.sample(LETTERS, 9)
    blocks = [
        _block("shape_mirror", "الأَشْكالُ وَالمِرْآةُ", "Shapes and mirror",
               "هَلِ الشَّكْلانِ مُتَشابِهانِ، أَمْ أَحَدُهُما مِثْلُ صورَةِ الآخَرِ في المِرْآةِ؟",
               "Are the two shapes the same, or is one a mirror image of the other?", True,
               _draw(lambda i, p, k: mirror_item(rng, i, p, True if p else flips[(k - 1) % 8]), 8, "mir", report)),
        _block("letter_mirror", "الحُروفُ وَالمِرْآةُ", "Letters and mirror",
               "هَلْ هذا الحَرْفُ مَكْتوبٌ كَما نَكْتُبُهُ، أَمْ كَصورَتِهِ في المِرْآةِ؟",
               "Is this letter written the usual way, or as its mirror image?", True,
               _draw(lambda i, p, k: letter_item(rng, i, p, False if p else flips[(k - 1) % 8], letters[k % 9]),
                     8, "let", report)),
        _block("control", "مُتَشابِهانِ أَمْ مُخْتَلِفانِ", "Same or different (control)",
               "هَلِ الشَّكْلانِ مُتَشابِهانِ تَمامًا، أَمْ مُخْتَلِفانِ؟",
               "Are the two shapes exactly the same, or different? (Non-mirror changes: compare with block 1.)",
               True, _draw(lambda i, p, k: control_item(rng, i, p, True if p else flips[(k - 1) % 8]), 8, "ctl",
                           report)),
    ]
    return _taskset("orientation-basira-v0", "reversal", "اتِّجاهُ الأَشْكالِ وَالحُروفِ",
                    "Shape and letter orientation",
                    "Mirror-discrimination format after Houbben & Vannuscorps (2022, GCPN Mons); items newly drawn "
                    "by Basira. Supplementary only: reversals alone never indicate dyslexia.", blocks, generated_at)


def number_task(generated_at: str, report: dict) -> dict:
    rng = random.Random(SEED + 3)
    counts = rng.sample(range(1, 10), 9) + [rng.randint(1, 9)]
    congruent = [True, False, False, True, True, False, True, False, False, True]
    blocks = [
        _block("reaction", "سُرْعَةُ اللَّمْسِ", "Reaction time (baseline)",
               "عِنْدَما تَظْهَرُ النَّجْمَةُ، نَلْمِسُها بِسُرْعَةٍ.",
               "Tap as soon as the star appears. Show it after a random 1-3 s pause. Baseline only, not scored.",
               False, _draw(lambda i, p, _: reaction_item(i, p), 5, "rt", report)),
        _block("dots", "عَدُّ النُّقَطِ", "Dot counting",
               "كَمْ نُقْطَةً نَرى؟", "How many dots? Answer on the 1-9 keypad.", True,
               _draw(lambda i, p, k: dots_item(rng, i, p, 3 if p else counts[(k - 1) % 10]), 10, "dot", report)),
        _block("compare", "أَيُّهُما أَكْبَرُ", "Number comparison",
               "أَيُّ الرَّقْمَيْنِ أَكْبَرُ قيمَةً؟",
               "Which number is bigger in value (not in print size)?", True,
               _draw(lambda i, p, k: compare_item(rng, i, p, True if p else congruent[(k - 1) % 10]), 10, "cmp",
                     report)),
        _block("addition", "الجَمْعُ", "Addition",
               "هَيّا نَجْمَعُ العَدَدَيْنِ.", "Add the two numbers; answer on the 1-9 keypad.", True,
               _draw(lambda i, p, _: addition_item(rng, i, p), 8, "add", report)),
    ]
    return _taskset("number-sense-basira-v0", "dyscalculia", "حِسُّ العَدَدِ", "Number sense",
                    "Block structure after Butterworth, B. (2003) Dyscalculia Screener (reaction time, dot "
                    "enumeration, number comparison, arithmetic); items newly generated by Basira.", blocks,
                    generated_at)


TASKS = (pattern_task, orientation_task, number_task)


def build_tasks(generated_at: datetime | None = None) -> tuple[list[dict], dict]:
    stamp = (generated_at or datetime.now(UTC)).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    report: dict = {"rejected": []}
    tasks = [make(stamp, report) for make in TASKS]
    report["items"] = {t["instrument_id"]: sum(len(b["items"]) for b in t["blocks"]) for t in tasks}
    return tasks, report


def package_dir() -> Path:
    return Path(str(resources.files("basira_ai").joinpath("data/stage0")))


def write_tasks(tasks: list[dict], *dirs: Path) -> list[Path]:
    written = []
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)
        for t in tasks:
            p = d / f"{t['instrument_id']}.json"
            p.write_text(json.dumps(t, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
            written.append(p)
    return written
