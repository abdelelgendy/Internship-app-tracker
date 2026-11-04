# Saved board responses (fictional)

Synthetic responses from the Greenhouse, Ashby and Lever job board APIs, for the scanner's
tests. The companies are the fictional ones in `sample-data/companies.json`; every posting is
invented. File names follow the scanner's saved-response layout, `<ats>-<slug>.json`, so you can
try the scanner offline:

```sh
cp -r sample-data /tmp/shortlist-demo
npm run scan -- --data /tmp/shortlist-demo --responses scripts/fixtures/boards --dry-run
```

Each posting covers one case the old job-hunter scanner got wrong (see `scripts/scan.test.ts`).
Dates assume the tests' clock, 2026-11-03 17:00 UTC.
