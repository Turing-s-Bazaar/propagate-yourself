"""Open ct.mha in a napari viewer for interactive exploration."""

from pathlib import Path

import numpy as np
import SimpleITK as sitk
import napari # fast viewer

PATH = str(Path(__file__).parent / "dataset" / "ct.mha")

image = sitk.ReadImage(PATH)
array = sitk.GetArrayFromImage(image)  # (z, y, x)
sx, sy, sz = image.GetSpacing()       # (x, y, z)
limits = [-1024, 1694]

viewer = napari.Viewer(title=f"{PATH}  {array.shape}  spacing=({sx},{sy},{sz})")

# Single layer. napari shares ONE global dims across all layers, so three
# transposed layers each interpret the same slider differently and show
# inconsistent slices. With one layer, dims (0,1,2) == (z,y,x) and the
# canvas always renders the slice that current_step says it does.
layer = viewer.add_image(
    array,
    name="ct (HU)",
    scale=(sz, sy, sx),
    contrast_limits=limits,
    colormap="gray",
)

viewer.dims.axis_labels = ("z", "y", "x")
viewer.dims.ndisplay = 2


def _fmt(v):
    return v.start if isinstance(v, slice) else v


def describe():
    step = viewer.dims.current_step
    labels = viewer.dims.axis_labels
    disp = viewer.dims.displayed
    scrub = viewer.dims.not_displayed
    plane = "+".join(labels[d] for d in disp)
    parts = "  ".join(f"{labels[i]}={_fmt(step[i])}" for i in range(len(step)))
    scrub_s = ",".join(labels[a] for a in scrub)
    return f"plane {plane}  |  {parts}  |  scrub {scrub_s}"


# On-canvas readout (bright, distinct from the grayscale CT) so the current
# z/y/x slices are visible right in the viewer, next to the image.
overlay = viewer.canvas.overlays.text
overlay.visible = True
overlay.position = "top_left"
overlay.color = "yellow"
overlay.font_size = 12


def update(event=None):
    line = describe()
    overlay.text = line
    print(line, flush=True)


for name in ("current_step", "displayed", "order", "axis_labels"):
    getattr(viewer.dims.events, name).connect(update)

# quick plane presets. napari's default image shortcuts already own x/y/z/c
# (orient-plane / auto-contrast), so bind on the layer instance keymap, which
# sits above the Image class keymap in the lookup chain. key = scrubbed axis.
def _plane(order):
    def _apply(*_):
        viewer.dims.order = order
    return _apply


layer.bind_key("z", overwrite=True)(_plane((0, 1, 2)))  # axial
layer.bind_key("y", overwrite=True)(_plane((1, 0, 2)))  # coronal
layer.bind_key("x", overwrite=True)(_plane((2, 0, 1)))  # sagittal

update()
napari.run()
