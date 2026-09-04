"""jwave-backed mirror of OpenwaterHealth/openlifu-python ``sim/kwave_if.py``.

Reproduces the openlifu k-Wave simulation flow (grid, array, medium, source,
recording) using jwave's time-domain k-space solver. ``run_simulation`` returns
the same quantities openlifu's k-Wave wrapper returns: ``p_max``, ``p_min``
(reported as peak-negative-pressure), and derived ``intensity``.
"""

from __future__ import annotations

import numpy as np
from jax import jit
from jax import numpy as jnp
from jwave.acoustics import simulate_wave_propagation
from jwave.geometry import Domain, Medium, Sources, TimeAxis

from sim_setup import SimSetup


def generate_drive_signal(
    cycles: float, frequency: float, dt: float, amplitude: float = 1.0
) -> np.ndarray:
    """Tone burst; copied verbatim from openlifu ``xdc/element.py``."""
    if dt <= 0:
        raise ValueError("dt must be positive.")
    if frequency <= 0:
        raise ValueError("frequency must be positive.")
    if cycles <= 0:
        raise ValueError("cycles must be positive.")
    n_samples = max(1, int(np.round(cycles / (frequency * dt))))
    t = np.arange(n_samples, dtype=np.float64) * dt
    return amplitude * np.sin(2 * np.pi * frequency * t)


def get_domain(setup: SimSetup) -> Domain:
    """Mirror of ``get_kgrid``: the computational grid."""
    return setup.get_domain()


def get_medium(
    domain: Domain,
    setup: SimSetup,
    medium_cfg: dict,
) -> tuple[Medium, np.ndarray, np.ndarray, np.ndarray]:
    """Mirror of ``get_medium``: build the acoustic medium from materials.

    Returns the jwave ``Medium`` plus the ``sound_speed``, ``density`` and
    ``attenuation`` arrays (kept for intensity and reporting). Attenuation is
    passed to the medium for parity; jwave's time-domain solver is lossless.
    """
    pml_size = medium_cfg.get("pml_size", 20)
    materials = medium_cfg["materials"]
    N = domain.N

    sound_speed = np.full(N, np.nan, dtype=np.float64)
    density = np.full(N, np.nan, dtype=np.float64)
    attenuation = np.full(N, np.nan, dtype=np.float64)

    layers = medium_cfg.get("layers")
    if layers is None:
        ref = medium_cfg.get("ref_material", "water")
        m = materials[ref]
        sound_speed[:] = m["sound_speed"]
        density[:] = m["density"]
        attenuation[:] = m["attenuation"]
    else:
        z_min = setup.z_extent[0]
        default = materials[layers[0]["material"]]
        sound_speed[:] = default["sound_speed"]
        density[:] = default["density"]
        attenuation[:] = default["attenuation"]
        for layer in layers:
            mat = materials[layer["material"]]
            z0, z1 = layer["z"]
            i0 = int(np.round((z0 - z_min) / setup.spacing))
            i1 = int(np.round((z1 - z_min) / setup.spacing))
            sound_speed[:, :, i0:i1] = mat["sound_speed"]
            density[:, :, i0:i1] = mat["density"]
            attenuation[:, :, i0:i1] = mat["attenuation"]

    medium = Medium(
        domain=domain,
        sound_speed=jnp.asarray(sound_speed),
        density=jnp.asarray(density),
        attenuation=jnp.asarray(attenuation),
        pml_size=pml_size,
    )
    return medium, sound_speed, density, attenuation


def get_time_axis(setup: SimSetup, medium: Medium) -> TimeAxis:
    """Mirror of ``get_kgrid`` time setup: auto from CFL unless dt/t_end given."""
    if setup.dt == 0 or setup.t_end == 0:
        return TimeAxis.from_medium(medium, cfl=setup.cfl)
    return TimeAxis(dt=setup.dt, t_end=setup.t_end)


def get_source(
    domain: Domain,
    time_axis: TimeAxis,
    frequency: float,
    cycles: float,
    amplitude: float,
    pml_size: int,
) -> Sources:
    """Mirror of ``get_karray`` + ``get_source``.

    Places the (single 64 mm) transducer element as a plane of point sources
    covering the full lateral face at the transducer side of the domain, each
    emitting the same tone burst. The signal is zero-padded to the time axis.
    """
    Nx, Ny, _ = domain.N
    xs = np.arange(pml_size, Nx - pml_size)
    ys = np.arange(pml_size, Ny - pml_size)
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    positions = (X.ravel(), Y.ravel(), np.full(X.size, pml_size))

    burst = generate_drive_signal(cycles, frequency, time_axis.dt, amplitude)
    padded = np.zeros(int(time_axis.Nt), dtype=np.float64)
    padded[: burst.size] = burst
    signals = jnp.stack([jnp.asarray(padded)] * X.size)

    return Sources(
        positions=positions,
        signals=signals,
        dt=time_axis.dt,
        domain=domain,
    )


@jit
def _solve(medium: Medium, time_axis: TimeAxis, sources: Sources):
    return simulate_wave_propagation(medium, time_axis, sources=sources)


def run_simulation(config: dict) -> dict:
    """Mirror of ``kwave_if.run_simulation``.

    Returns a dict with ``p_max``, ``p_min`` (PNP), ``intensity`` (W/cm^2) as
    numpy arrays, the medium fields, and the setup metadata.
    """
    setup = SimSetup.from_dict(config["sim_setup"])
    domain = get_domain(setup)
    medium, sound_speed, density, attenuation = get_medium(
        domain, setup, config["medium"]
    )
    time_axis = get_time_axis(setup, medium)

    frequency = config["drive_settings"]["operating_frequency_hz"]
    cycles = config["simulation"].get("cycles", 20)
    amplitude = config["drive_settings"]["output_level"]
    pml_size = config["medium"].get("pml_size", 20)
    sources = get_source(domain, time_axis, frequency, cycles, amplitude, pml_size)

    pressure = _solve(medium, time_axis, sources)
    p_field = pressure.on_grid[..., 0]  # jnp (Nt, Nx, Ny, Nz), kept on device

    p_max = np.asarray(p_field.max(axis=0))
    p_min = np.asarray(p_field.min(axis=0))
    pnp = -p_min  # peak negative pressure, positive (openlifu convention)
    Z = density * sound_speed
    intensity = 1e-4 * pnp**2 / (2.0 * Z)  # W/cm^2

    return {
        "p_max": p_max,
        "p_min": p_min,
        "pnp": pnp,
        "intensity": intensity,
        "p_field": p_field,
        "sound_speed": sound_speed,
        "density": density,
        "attenuation": attenuation,
        "domain": domain,
        "time_axis": time_axis,
        "setup": setup,
    }


def view_pressure_field(p_field, time_axis, axis: str = "coronal"):
    """Interactive pressure-field viewer with a slider scrubbing along t.

    Shows a 2D slice of the pressure time series: ``coronal`` (y-z at centre
    x, propagation axis vertical), ``axial`` (x-y at centre z), or ``sagittal``
    (x-z at centre y).
    """
    import matplotlib.pyplot as plt
    from matplotlib.widgets import Slider

    Nt, Nx, Ny, Nz = p_field.shape
    if axis == "coronal":
        data = np.asarray(p_field[:, Nx // 2, :, :])  # (Nt, Ny, Nz)
        xlabel, ylabel = "y [voxel]", "z [voxel]"
    elif axis == "axial":
        data = np.asarray(p_field[:, :, :, Nz // 2])  # (Nt, Nx, Ny)
        xlabel, ylabel = "x [voxel]", "y [voxel]"
    elif axis == "sagittal":
        data = np.asarray(p_field[:, :, Ny // 2, :])  # (Nt, Nx, Nz)
        xlabel, ylabel = "x [voxel]", "z [voxel]"
    else:
        raise ValueError(f"unknown axis {axis!r}")

    vmax = float(np.abs(data).max()) or 1.0
    t_arr = np.asarray(time_axis.to_array())

    fig, ax = plt.subplots(figsize=(6, 7))
    img = ax.imshow(
        data[0].T, origin="lower", cmap="RdBu_r",
        vmin=-vmax, vmax=vmax, aspect="equal",
    )
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.set_title(f"{axis} slice  p(t={t_arr[0]:.3e} s)")
    fig.colorbar(img, ax=ax, label="pressure [Pa]")

    plt.subplots_adjust(bottom=0.18)
    slider_ax = plt.axes([0.2, 0.05, 0.65, 0.03])
    t_slider = Slider(slider_ax, "t", 0, Nt - 1, valinit=0, valstep=1)

    def update(val):
        t = int(round(t_slider.val))
        img.set_data(data[t].T)
        ax.set_title(f"{axis} slice  p(t={t_arr[t]:.3e} s)")
        fig.canvas.draw_idle()

    t_slider.on_changed(update)
    plt.show()


if __name__ == "__main__":
    import sys
    from pathlib import Path

    import yaml

    cfg_path = Path(__file__).parent / "sim_config.yaml"
    config = yaml.safe_load(cfg_path.read_text())

    result = run_simulation(config)
    setup = result["setup"]

    print("== SimSetup ==")
    for row in setup.to_table():
        print(f"  {row['Name']:<14} {row['Value']} {row['Unit']}")
    print(f"  grid shape      {result['domain'].N}  dx={result['domain'].dx}")
    print(f"  time            dt={result['time_axis'].dt:.3e} s  "
          f"Nt={int(result['time_axis'].Nt)}")

    print("\n== medium scalars (per material) ==")
    for name, m in config["medium"]["materials"].items():
        print(f"  {name:<9} sound_speed={m['sound_speed']:>7.1f} m/s  "
              f"density={m['density']:>7.1f} kg/m^3  "
              f"attenuation={m['attenuation']:>4.1f} dB/cm/MHz")

    print("\n== medium field (built) ==")
    for name in ("sound_speed", "density", "attenuation"):
        arr = result[name]
        print(f"  {name:<12} unique={np.unique(arr)}  "
              f"min={arr.min():.1f}  max={arr.max():.1f}")

    print("\n== results ==")
    for name in ("p_max", "p_min", "pnp", "intensity"):
        arr = result[name]
        print(f"  {name:<10} shape={arr.shape}  min={arr.min():.3e}  max={arr.max():.3e}")

    pnp = result["pnp"]
    idx = np.unravel_index(np.argmax(pnp), pnp.shape)
    print(f"\n  peak PNP {pnp.max():.3e} Pa at voxel {idx}  "
          f"({pnp.max() / 1e6:.4f} MPa)")

    axis = sys.argv[1] if len(sys.argv) > 1 else "coronal"
    view_pressure_field(result["p_field"], result["time_axis"], axis=axis)
