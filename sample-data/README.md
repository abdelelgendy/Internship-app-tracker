# Sample data

Everything in this folder is fictional. It powers the public demo and the tests, and it follows the same layout and types as a real data folder (see [src/engine/types.ts](../src/engine/types.ts) and [docs/PRIVACY.md](../docs/PRIVACY.md)).

**Sam Rivera** is a made-up new grad (BSc Computer Science, "Lakeshore University", 2026) living in Hamilton, Ontario. Every company, person, school, email address and link here is invented. Postings use the URL shapes of real job boards (Greenhouse, Ashby, Lever, Workday) with company slugs ending in `-sample`; every other address is on `example.com`.

| File | What it holds |
| --- | --- |
| `profile.json` | Sam's profile: skills with levels, targeting, canned answers, approved facts |
| `jobs.jsonl` | 40 postings from 5 sources and of every age, including duplicates, ghost postings, dealbreakers and postings with no date |
| `applications.jsonl` | 14 applications, at least one in every status, with history, follow-ups, contacts and interviews |
| `companies.json` | The scanner watchlist: 8 fictional companies |
| `practice/decks/` | Two decks: how Shortlist works, and behavioral basics |
| `practice/exercises.json`, `stories.json`, `progress.json` | 4 exercises, 3 STAR stories, and some review history |
| `covers/` | Cover letter drafts for three applications |

Postings carry no `facts` or `score`. The app computes them with the engine, so the demo always shows what the current rubric says. Statuses on postings with an application, and `expired`, are decisions a person made; the rest match what the engine decides at the anchor time.

## Dates

The data was written for `2026-11-03T17:00:00Z` (`SAMPLE_ANCHOR` in [src/data/sampleRepo.ts](../src/data/sampleRepo.ts)). When the demo loads it, every timestamp moves forward by the time since then, so a posting from "3 hours ago" is always 3 hours old.

## Changing it

Keep it fictional: reserved `example.com` addresses, no phone numbers, no real people. `src/data/sampleRepo.test.ts` checks the counts, links between files, allowed hosts and state transitions, and the privacy guard (`scripts/check-private.mjs`) rejects real emails and phone numbers at commit time.
