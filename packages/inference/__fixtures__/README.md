# inference fixtures

`interaction.sample.json` is written by `scripts/spike/antigravity.mjs` — a **real**
Antigravity Interactions API response containing `steps` with screenshots. The
engine agent's `extractScreenshots()` and its loop tests build against this real
shape (do not hand-fake it). Committed so feature agents have a ground-truth sample.
