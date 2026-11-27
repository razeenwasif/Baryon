"""Fairy's experiment tracker, from inside a run (docs/tracker-plan.md).

Fairy copies this beside every run it records (run_experiment) and puts its
folder on PYTHONPATH, so `import fairy_track` works however the run was
written. What it writes stays in the run's folder, FAIRY_RUN_DIR, and Fairy
reads it when the run ends:

    param("lr", 3e-4)                 # params.json
    metric("loss", 0.31)              # metrics.json, by name
    metric("loss", 0.29, step=200)    # a series: the latest value, and every step
    metric("acc", 92.4, "%")          # with a unit
    figure("curve")                   # a matplotlib figure (the current one if none), as figures/curve.png

Any language can do the same by writing params.json ({"name": value}) and
metrics.json ({"name": {"value": v, "unit": u}}) into FAIRY_RUN_DIR, or, in a
Nexus job, into $DUET_OUTPUT_DIR.
Nothing here reaches the network or anything outside the run's folder.
"""

import json
import math
import os
import pathlib

# On this Mac, the run's own folder; in a Nexus job, the job's outputs, which come back to Fairy when it ends.
RUN = pathlib.Path(os.environ.get("FAIRY_RUN_DIR") or os.environ.get("DUET_OUTPUT_DIR") or pathlib.Path(__file__).resolve().parent)
STEPS = 10000


def _name(name, default, suffix):
    stem = "".join(c if c.isalnum() or c in "-_." else "-" for c in str(name or default)).strip("-.") or default
    return stem if stem.endswith(suffix) else stem + suffix


def _read(name):
    try:
        value = json.loads((RUN / name).read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(name, value):
    RUN.mkdir(parents=True, exist_ok=True)
    path = RUN / name
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, indent=2) + "\n")
    temp.replace(path)


def _plain(value):
    """A value JSON keeps as it is: numbers, text, true or false; anything else as text."""
    if hasattr(value, "item") and callable(value.item):
        try:
            value = value.item()
        except (TypeError, ValueError):
            pass
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return str(value)


def param(name, value):
    """Record a setting the run used: params.json, by name."""
    params = _read("params.json")
    params[str(name)] = _plain(value)
    _write("params.json", params)
    return value


def params(values):
    """Record several settings at once, from a dict or an argparse Namespace."""
    for name, value in (vars(values) if hasattr(values, "__dict__") else dict(values)).items():
        param(name, value)
    return values


def metric(name, value, unit=None, step=None):
    """Record a number the run found: metrics.json, by name. With step, the steps are kept as a series."""
    metrics = _read("metrics.json")
    value = _plain(value)
    entry = metrics.get(str(name)) if isinstance(metrics.get(str(name)), dict) else {}
    entry["value"] = value
    entry["unit"] = unit if unit is not None else entry.get("unit")
    if step is not None:
        steps = entry.get("steps") if isinstance(entry.get("steps"), list) else []
        steps.append([_plain(step), value])
        entry["steps"] = steps[-STEPS:]
    metrics[str(name)] = entry
    _write("metrics.json", metrics)
    return value


def figure(name=None, fig=None, dpi=144):
    """Save a matplotlib figure, the current one unless given, into figures/. Name and figure in either order."""
    if hasattr(name, "savefig") and not hasattr(fig, "savefig"):
        name, fig = fig, name
    if fig is None:
        import matplotlib

        matplotlib.use("Agg", force=False)
        import matplotlib.pyplot as plt

        fig = plt.gcf()
    folder = RUN / "figures"
    folder.mkdir(parents=True, exist_ok=True)
    taken = len(list(folder.glob("*.png")))
    path = folder / _name(name, f"figure-{taken + 1}", ".png")
    fig.savefig(path, dpi=dpi, bbox_inches="tight")
    return path
