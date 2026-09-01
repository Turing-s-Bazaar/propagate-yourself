"""Render 2D slice montages for each axis (x, y, z) of ct.mha to examples/.

Array layout from SimpleITK GetArrayFromImage is (z, y, x):
  axis 0 = z (superior->inferior), axis 1 = y, axis 2 = x
  axial   (cut z): rows=y, cols=x
  coronal (cut y): rows=z, cols=x
  sagittal(cut x): rows=z, cols=y
"""

import numpy as np
import SimpleITK as sitk
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

PATH = "dataset/ct.mha"
OUT = "examples"
LEVEL, WIDTH = 40, 400  # soft-tissue window

image = sitk.ReadImage(PATH)
a = sitk.GetArrayFromImage(image)  # (z, y, x)
sp = image.GetSpacing()            # (x, y, z)

print("== array diagnostics ==")
print("GetSize (x,y,z)        =", image.GetSize())
print("GetSpacing (x,y,z)     =", sp)
print("GetOrigin (x,y,z)      =", [round(v, 1) for v in image.GetOrigin()])
print("Direction (9-vector)   =", [round(v, 2) for v in image.GetDirection()])
print("array.shape (z,y,x)    =", a.shape, "| dtype", a.dtype,
      "| min/max", int(a.min()), int(a.max()))
print("axis mapping: 0=z, 1=y, 2=x")


def window(vol):
    lo, hi = LEVEL - WIDTH / 2, LEVEL + WIDTH / 2
    return np.clip((vol.astype(np.float32) - lo) / (hi - lo), 0, 1)


def montage(axis, idxs, aspect, title, fname, rowlabel):
    fig, axes = plt.subplots(1, len(idxs), figsize=(3.2 * len(idxs), 4))
    for ax, i in zip(axes, idxs):
        sl = np.take(a, i, axis=axis)
        ax.imshow(window(sl), cmap="gray", vmin=0, vmax=1,
                  aspect=aspect, origin="lower")
        ax.set_title(f"{rowlabel}={i}", fontsize=9)
        ax.set_axis_off()
    fig.suptitle(title, fontsize=11)
    fig.tight_layout()
    fig.savefig(f"{OUT}/{fname}", dpi=140)
    plt.close(fig)
    print(f"  wrote {fname}: cuts axis {axis}, "
          f"idxs={idxs}, slice shape={np.take(a, idxs[0], axis=axis).shape}, "
          f"aspect={aspect}")


print("\n== rendering (tissue bbox y:50..356, x:79..482, z:58..132) ==")

montage(0, np.linspace(58, 132, 6).astype(int), sp[1] / sp[0],
        "axial (cut z)", "axial_z.png", "z")

montage(1, np.linspace(50, 356, 6).astype(int), sp[2] / sp[0],
        "coronal (cut y)", "coronal_y.png", "y")

montage(2, np.linspace(79, 482, 6).astype(int), sp[2] / sp[1],
        "sagittal (cut x)", "sagittal_x.png", "x")
