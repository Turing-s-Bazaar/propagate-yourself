"""SimSetup: grid + time configuration.

Replicated from OpenwaterHealth/openlifu-python ``src/openlifu/sim/sim_setup.py``,
adapted to jwave (no xarray / pandas / openlifu dependencies). Keeps the same
field names, defaults, and extent-rounding behaviour, and adds ``get_domain``
to build the jwave ``Domain``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Tuple

import numpy as np

from jwave.geometry import Domain

COORD_DIMS = ("x", "y", "z")
COORD_NAMES = ("Lateral", "Elevation", "Axial")

_UNIT_TO_METERS = {
    "m": 1.0,
    "mm": 1e-3,
    "cm": 1e-2,
    "um": 1e-6,
}


def _to_meters(value: float, units: str) -> float:
    if units not in _UNIT_TO_METERS:
        raise ValueError(f"Unknown length unit: {units!r}")
    return value * _UNIT_TO_METERS[units]


@dataclass
class SimSetup:
    """Grid and time parameters for a jwave simulation.

    Mirrors openlifu ``SimSetup``. Extents are given in ``units`` (default mm)
    and are rounded to whole multiples of ``spacing`` on construction.
    """

    spacing: float = 1.0
    units: str = "mm"
    x_extent: Tuple[float, float] = (-30.0, 30.0)
    y_extent: Tuple[float, float] = (-30.0, 30.0)
    z_extent: Tuple[float, float] = (-4.0, 60.0)
    dt: float = 0.0
    t_end: float = 0.0
    c0: float = 1500.0
    cfl: float = 0.3

    def __post_init__(self):
        for name in ("x_extent", "y_extent", "z_extent"):
            ext = getattr(self, name)
            if len(ext) != 2:
                raise ValueError(f"{name} must have length 2.")
            if ext[0] >= ext[1]:
                raise ValueError(f"{name} must be in the form (min, max) with min < max.")
        if not isinstance(self.spacing, (int, float)) or self.spacing <= 0:
            raise ValueError("spacing must be a positive number.")
        if _to_meters(1.0, self.units) == 0:
            raise ValueError(f"units must be a length unit, got {self.units!r}.")
        if self.cfl <= 0:
            raise ValueError("cfl must be a positive number.")
        if self.c0 <= 0:
            raise ValueError("c0 must be a positive number.")

        # Round each extent so it evenly divides by spacing (openlifu behaviour).
        for name in ("x_extent", "y_extent", "z_extent"):
            ext = np.asarray(getattr(self, name), dtype=float)
            n = np.round(np.diff(ext) / self.spacing)
            new_ext = tuple(np.arange(2) * n * self.spacing + ext[0])
            frac = (0.5 - np.abs((np.diff(ext) / self.spacing) % 1 - 0.5)) / n
            if (frac > 1e-3).any():
                logging.warning(
                    f"{name} {tuple(ext)} does not evenly divide by spacing "
                    f"({self.spacing}). Rounding to {new_ext}."
                )
            setattr(self, name, new_ext)

    def get_extent(self, dims=None) -> Tuple[Tuple[float, float], ...]:
        dims = COORD_DIMS if dims is None else dims
        extents = {"x": self.x_extent, "y": self.y_extent, "z": self.z_extent}
        return tuple(extents[d] for d in dims)

    def get_size(self, dims=None) -> Tuple[int, ...]:
        """Number of voxels along each dim (openlifu: round(diff/spacing) + 1)."""
        dims = COORD_DIMS if dims is None else dims
        return tuple(
            int(np.round(np.diff(np.asarray(ext, dtype=float))[0] / self.spacing)) + 1
            for ext in self.get_extent(dims)
        )

    def get_spacing(self, units: str | None = None) -> float:
        """Grid spacing in the requested units (default: native units)."""
        target = self.units if units is None else units
        spacing_m = _to_meters(self.spacing, self.units)
        return spacing_m / _to_meters(1.0, target)

    def get_domain(self) -> Domain:
        """Build the jwave ``Domain`` (voxel count, spacing in metres)."""
        spacing_m = _to_meters(self.spacing, self.units)
        return Domain(self.get_size(), (spacing_m,) * 3)

    def to_table(self) -> list[dict]:
        """Table of setup parameters (name, value, unit), openlifu-style."""
        return [
            {"Name": "Spacing", "Value": self.spacing, "Unit": self.units},
            {"Name": "X Extent", "Value": f"{self.x_extent[0]} to {self.x_extent[1]}", "Unit": self.units},
            {"Name": "Y Extent", "Value": f"{self.y_extent[0]} to {self.y_extent[1]}", "Unit": self.units},
            {"Name": "Z Extent", "Value": f"{self.z_extent[0]} to {self.z_extent[1]}", "Unit": self.units},
            {"Name": "Time Step", "Value": self.dt, "Unit": "s"},
            {"Name": "End Time", "Value": self.t_end, "Unit": "s"},
            {"Name": "Speed of Sound", "Value": self.c0, "Unit": "m/s"},
            {"Name": "CFL", "Value": self.cfl, "Unit": ""},
        ]

    @staticmethod
    def from_dict(d: dict) -> "SimSetup":
        return SimSetup(**d)
