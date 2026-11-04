# Scripts

Command-line tools that work on the data folder (`COPILOT_DATA_DIR`, default `.private/`, never committed). They run TypeScript directly with Node's type stripping and import the same engine as the app, so a score in the terminal matches the score on the page. Every command takes `--data <folder>` and `--help`.

None of them submits an application, logs in anywhere or touches LinkedIn.

| Command | What it does |
| --- | --- |
| `npm run import:jobhunter -- [--from ../job-hunter] [--dry-run] [--replace-profile]` | Copies the old job-hunter tool's queue, applications and `copilot-data/` into the data folder. It only reads job-hunter. Running it again adds nothing new. It uses the same planner as the Import page (`src/jobhunter/`), so both show and write the same thing. If `copilot-data/profile.json` is missing it falls back to `config/profile.yaml`, imports every job as unverified and every saved answer as "answer it yourself", leaves project bullets out, and prints the full list to check. |
| `npm run scan -- [--company <name>] [--dry-run] [--responses <folder>]` | Reads the public Greenhouse, Ashby and Lever boards of the companies on your watchlist, keeps postings whose title and location fit, scores them and saves the new ones. `--responses` reads saved API responses (`<ats>-<slug>.json`) instead of the network. |
| `npm run score -- [--set-status] [--dry-run]` | Scores every saved job again with the current rubric and clock. With `--set-status` it also moves queued and rule-skipped jobs to the status the rules give now; jobs you shortlisted, archived or applied to keep theirs. |
| `npm run digest -- [--stdout] [--tz <zone>]` | Writes today's page as Markdown to `digest.md` in the data folder: interviews, follow-ups with a draft note, applications waiting on you, the jobs worth applying to and practice. |
| `npm run export:csv -- [--out <file>] [--stdout]` | Writes your applications as `applications.csv` for a spreadsheet. A file git would commit is refused. |
| `npm run prefill -- <application URL> [--inspect]` | The optional form assistant, below. |

## The form assistant

`npm run prefill` opens one Greenhouse, Lever or Ashby application page in a visible browser and fills only what it is sure of: your name, email and links from the profile (never into fields about a referrer, a reference or another person), and the questions your saved answers cover exactly. A dropdown or radio is chosen only when your answer is exactly one of its options. Files, passwords, checkboxes, your phone number, self-identification questions and anything it is unsure about are left for you, outlined in amber and listed in a panel on the page and in the terminal. It records the answers it filled on the application's draft, then waits while you check every field and submit the form yourself.

It refuses any other site, and LinkedIn by name. It cannot submit: it presses no keys and calls no submit, its only click is selecting a radio on the radio itself, every field it touches is checked first and a button or submit control throws, and `scripts/prefill.test.ts` proves this against a synthetic form. The browser keeps its own profile in `<data folder>/browser-profile`, so a login you do there by hand is remembered; the assistant never types a password.

## Tests

`npm test` runs every script's tests: the pure parts with fixtures, and each command end to end on a temporary copy of the fictional `sample-data/`. The scanner's tests use the synthetic board responses in `fixtures/boards/`, the importer's a fictional `fixtures/jobhunter/config/profile.yaml`, and the form assistant's `fixtures/forms/application.html` served to a real headless Chromium. No test uses the network.
