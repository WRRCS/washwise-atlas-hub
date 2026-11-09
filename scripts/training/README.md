# Cleaner training assets

Regenerates the screenshots and printable PDFs used by `/training`.
Text lives only in `src/lib/cleaner-training.json` (English + Ukrainian).

1. `bun seed.ts` — creates an isolated "WRRCS Training Demo" workspace with made-up people/clients (never the real tenant). Writes `/tmp/training/demo.json`.
2. `bun reset.ts` before each capture run, then `python3 shots.py maria:en` and `python3 shots.py oksana:uk` (needs `/tmp/training/sample_photo.jpg`).
3. Convert the PNGs into `src/assets/training/{en,uk}-*.jpg` (600px wide JPEG).
4. `python3 make_pdf.py src/assets/training/WRRCS-Cleaner-Training-EN.pdf src/assets/training/WRRCS-Cleaner-Training-UK.pdf`
5. `bun cleanup.ts --go` — deletes the demo workspace and its accounts.

Scripts use `/tmp/training` as their scratch folder; run them from there with `NODE_PATH=/dev-server/node_modules`.
