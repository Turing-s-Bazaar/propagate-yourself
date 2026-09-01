## propagate-yourself
run acoustic simulations on human skulls with less compute and latency using better feature representation

![](via-egnatia.png)

## setup
install [uv](https://docs.astral.sh/uv/), then:
```
uv sync
```


## quickstart


## tools
1) a simple ct viewer to sanity check downloaded ct in `acoustics/`

`uv run python acoustics/view_ct.py`

keys: `z` axial, `y` coronal, `x` sagittal (key = scrubbed axis)

2) an evaluation tool for feynman research runs. it uses the [stanford helm](https://github.com/stanford-crfm/helm/blob/main/docs/code.md) design. time and token usage are tracked. [more information](tools/helm_mirror/design.md)

`uv run helm-mirror run`

under the `tools/` directory, the problem set lives in `instructions`. you can configure runs in `run_specs.yaml`, evaluation results land in `outputs/`. the extensive feynman artifacts are in its own directory under `autoresearch/runs/`

3) a graph ingestor, differentiator and evaluator

## to stop a script
`pkill -f view_ct.py`


## where's your head at??? 
for `1HNA013/ct.mha` from synrad2025 sCT dataset,\
x: 180 - 380\
y: 20 - 320\
z: 55 - 130
