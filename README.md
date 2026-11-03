# Shortlist

A local-first job-search copilot for a new-grad software developer. It finds and scores postings, explains each score, prepares applications, reminds you to follow up, and records what happened.

It never submits an application, never logs into anything, never automates LinkedIn and never stores a password. You review everything it prepares and you click submit yourself.

Status: being rebuilt from a first small tracker (see [docs/day-one](docs/day-one/README.md)). The app shell and shared UI are in place; the pages land feature by feature.

## Your data stays on your machine

- Real data lives in one folder, set by `COPILOT_DATA_DIR` (default `.private/` in this repo). That folder is gitignored.
- The public build and this repo only contain `sample-data/`: a fictional new grad, Sam Rivera, with sample postings and applications.
- The banner at the top of the app always says which one you are looking at.
- The data format is defined in [src/engine/types.ts](src/engine/types.ts).

## Run it

Requires Node 22.13 or newer (or Node 24).

```sh
npm install
npm run dev        # http://localhost:5173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the app with hot reload |
| `npm run build` | Type-check and build the static app into `dist/` |
| `npm run preview` | Serve the built app |
| `npm test` | Run the tests once (`npm run test:watch` to keep them running) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, all projects |

The command-line tools (`import:jobhunter`, `scan`, `score`, `digest`, `export:csv`, `prefill`, `check:private`) are wired in `package.json` and arrive with their features. They run with Node's built-in TypeScript support, no build step.

## Layout

```
src/
  engine/     pure TypeScript shared by the app and the scripts: types, scoring, states (no React, no Node APIs)
  app/        the shell: routes, navigation, theme, keyboard shortcuts, data-source banner
  ui/         shared components: Button, Dialog, Tabs, Badge, Toast and the rest
  features/   one folder per page
scripts/      Node command-line tools
sample-data/  the fictional demo data
docs/         notes, including the day-one app
```

Press `?` in the app for keyboard shortcuts.
