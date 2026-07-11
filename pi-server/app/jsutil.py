"""Helpers that replicate JavaScript coercion semantics from Current_Code.gs.

The Apps Script backend leans on JS quirks (parseInt on "45ft", truthiness,
Number coercion in comparisons). These helpers keep the port behaviour-exact.
"""
import math
import re

_INT_PREFIX = re.compile(r'^[+-]?\d+')


def js_parse_int(value):
    """JS parseInt(value, 10). Returns None where JS returns NaN."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return None
        return math.trunc(value)
    m = _INT_PREFIX.match(str(value).strip())
    return int(m.group(0)) if m else None


def js_parse_int_or(value, fallback):
    """JS `parseInt(x, 10) || fallback` — note 0 also falls back, like JS."""
    n = js_parse_int(value)
    return fallback if not n else n


def js_number(value):
    """JS Number() coercion (used where JS compares strings numerically)."""
    if value is None or value == '':
        return 0
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float)):
        return value
    try:
        return float(str(value).strip())
    except ValueError:
        return float('nan')


def js_truthy(value):
    """JS truthiness for sheet cell values ('' and 0 are falsy)."""
    if value is None or value is False:
        return False
    if isinstance(value, str):
        return value != ''
    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return False
        return value != 0
    return True


def intify(x):
    """Collapse integral floats to int so JSON matches JS output (36.0 -> 36)."""
    if isinstance(x, float) and x.is_integer():
        return int(x)
    return x


def floor_div2(n):
    """Math.floor((n - 10) / 2) — the ability modifier formula."""
    return math.floor((js_number(n) - 10) / 2)
