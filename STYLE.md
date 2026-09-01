# Peacesign Style

This project follows the virtues in `../garden/STYLE.md`.

- Be locally precise and globally playful.
- Prefer mutually exclusive, collectively exhaustive domain boundaries.
- Keep the smallest correct structure; do not add architecture in anticipation.
- If smallest correct structure includes using existing tools, then go ahead
- Compare existing tools by features, complexity, community size and date published
- Use `pnpm add` for TypeScript dependencies and `uv add` for Python dependencies.
- Use oxlint and Prettier for TypeScript and Ruff for future Python research.
- Run Python through `uv run`, never bare `python` or `python3`.
- Observability: Track model-fitting runs in Weights & Biases; use Cloudflare observability for runtime operations.
- Place run instructions in `README.md`.
- Do not remove user comments in any scripts
- Put representative visual output in `examples`; keep scratch output untracked.
- Never commit plaintext secrets. Use committed `.env.op` references after the
  1Password CLI is installed and the relevant vault items exist.
- Pause after a stage and update the README with minimal edits.
- Do not automatically commit or deploy after a stage.

The 1Password CLI is not currently installed on this machine, so secret-bearing
deployment work must wait until that prerequisite is available. Do not replace
the intended `op://` flow with plaintext environment files.
