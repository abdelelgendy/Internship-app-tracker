# Privacy

Shortlist handles a job search: your contact details, work authorization, salary answers, every application and how it went. This repo is public, so the rules are simple: **real data lives in one folder on your machine that git ignores, and the public demo only ever sees fictional data.**

## Where your data lives

Everything real lives in the data folder:

- `COPILOT_DATA_DIR` sets it, from the shell or from `.env.local` (`COPILOT_DATA_DIR=/path/to/folder`). A relative path starts at the repo.
- The default is `.private/` in this repo. `.gitignore` lists it, and the folder gets its own `.gitignore` containing `*`, so it stays ignored even if you move it into another repo.
- The dev server refuses to use a folder inside the repo that git would commit, and tells you why.

The layout follows the data contract in [src/engine/types.ts](../src/engine/types.ts):

| Path | Holds |
| --- | --- |
| `profile.json` | Your profile, canned answers and approved facts |
| `jobs.jsonl`, `applications.jsonl` | One posting or application per line |
| `companies.json` | The watchlist for the board scanner |
| `practice/decks/*.json`, `practice/exercises.json`, `practice/stories.json`, `practice/progress.json` | Interview practice |
| `covers/<applicationId>.md` | Cover letter drafts |
| `denylist.txt` | Strings that must never be committed (see below) |

The first time `npm run dev` opens a folder it creates this layout with empty files, readable only by you (folders `700`, files `600`). It never overwrites a file that exists and never invents a profile.

Saves are safe to interrupt: each file is written beside the old one and renamed over it. In the JSONL files the last line for an id is the current one, and a save keeps any line it cannot read, so a script and the app can share a file without losing rows. They do not lose each other's changes either: the scripts and the dev server take the same lock file (`<file>.lock`) for every write, a script builds its change from the rows as they are at write time and changes only its own fields (`npm run score` the score and, with `--set-status`, the status; `npm run prefill` the answers it filled), and the app refuses to save over a row that changed after it loaded it, then reloads it.

## What stays on your machine

- **The app reads your data only through the dev server on your own computer.** In `npm run dev` the app talks to `/__local/*`, a small API inside the Vite dev server. It answers only requests from this computer (loopback address), under a localhost host name (which stops DNS rebinding), from the app's own origin, carrying a custom header that other websites cannot send. Another site open in the same browser cannot read or change the folder.
- **The production build has no access to it.** The API exists only in the dev server: `npm run build` leaves it out and `vite preview` does not serve it.
- **Nothing is uploaded.** The data layer makes no requests except to that local API. Any feature that sends text to an outside service, such as an AI draft, has to say so before it sends and stay off until you turn it on.
- **No credentials.** Shortlist never stores ATS passwords, never logs into anything and never automates LinkedIn. It prepares applications; you submit every one yourself.

## How the public demo works

The demo is the same app with fictional data: **Sam Rivera**, a made-up new grad, with fictional companies and postings ([sample-data/README.md](../sample-data/README.md)).

- The sample data is bundled into the build. On the first visit it is copied into the visitor's own browser (IndexedDB). Changes stay in that browser and go nowhere else.
- The banner always says which data you are looking at. In the demo it has a **Reset sample data** button that puts everything back.
- If a browser refuses IndexedDB (some private windows), the demo keeps changes in memory until the page reloads.
- Dates in the sample data move forward to the day you visit, so the demo always looks current.
- On the dev server you can view the demo instead of your folder with `?data=sample` in the address, and go back with `?data=local`.

## The commit guard

A pre-commit hook stops a commit that would publish personal data. Turn it on once per clone:

```sh
git config core.hooksPath .githooks
```

On every commit it runs [scripts/check-private.mjs](../scripts/check-private.mjs) on the **staged** copy of each file (what the commit will contain) and refuses the commit if it finds:

- any entry from `denylist.txt` in the data folder, ignoring case;
- a phone number, an email address outside the reserved `example.com` domains, or a demographic answer (a key such as gender or ethnicity with a value);
- a file inside the data folder, or a `.env` file other than `.env.example`.

It prints the file, line and reason with the match masked, so the check never shows the private value, even in a CI log. To audit everything already committed:

```sh
node scripts/check-private.mjs --all
```

If a generic pattern flags code by mistake, add `privacy-check: allow` to that line. That exempts the line from the generic patterns, never from the denylist. Do not skip the hook with `git commit --no-verify`.

### What to put in denylist.txt

One string per line. Lines starting with `#` are comments, and blank lines are ignored. List what identifies you, for example:

- your full name and its variants, and your personal email;
- your phone number (one entry is enough: phone-like entries match in any format, with or without `+1`);
- your street address and postal code (entries of 4 characters or fewer match only as a whole word);
- employers and schools you have not made public, and companies from your application log;
- your answers to demographic questions.

The denylist is private too: it lives in the data folder and is never committed.

## If something leaks

1. Treat it as public from the moment it was pushed. Change anything that can be changed (a password, a phone number used for sign-in).
2. Remove it from the files and commit the removal.
3. Removing it from history needs a history rewrite and a force push; ask for help before doing that on a shared branch.
4. Turn on GitHub secret scanning and push protection for the repo as a second net.
