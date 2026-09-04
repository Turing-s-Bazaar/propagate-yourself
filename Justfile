set shell := ["bash", "-uc"]

# Show available tasks
default:
    @just --list

# Install Python dependencies
sync:
    uv sync

# Install graph deps (SPECTER2 + scikit-learn)
sync-graph:
    uv sync --group graph

# Resolve graphs/corpus/paper-dump.md into Postgres (needs DATABASE_URL)
ingest:
    uv run corpus-ingest graphs/corpus/paper-dump.md

# Select top-k papers and read/write/execute urges
policy problem:
    uv run rwx-policy "{{problem}}"

# Ingest, then run the policy
run problem: ingest
    uv run rwx-policy "{{problem}}"

# Run corpus tests
test:
    uv run python -m unittest discover -s tests

# Lint and format check
lint:
    uv run ruff check graphs tools tests
    uv run ruff format --check graphs tools tests