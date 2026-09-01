## propagate-yourself
run acoustic simulations on human skulls with less compute and latency using better feature representation


## setup
install [uv](https://docs.astral.sh/uv/), then:
```
uv sync
```


## run


## tools
1) a simple ct viewer to sanity check downloaded ct\
`uv run python acoustics/view_ct.py`\
keys: `z` axial, `y` coronal, `x` sagittal (key = scrubbed axis)

2) a meter that tracks the amount of compute and latency spent by autoresearch when running an experiment

3) a graph ingestor, differentiator and evaluator

## to stop a script
`pkill -f view_ct.py`


## where's your head at??? 
for `1HNA013/ct.mha` from synrad2025 sCT dataset,\
x: 180 - 380\
y: 20 - 320\
z: 55 - 130
