# Day one

These two files are the first version of this repo: Abdel's first hand-written TypeScript app, built with React and Vite on February 1 and 2, 2026. Shortlist grew out of it. They are kept exactly as written, so they are not built, type-checked or linted with the rest of the app.

## What it did

One page titled "Internship tracker":

- `Components/Header.tsx` is a component with typed props (`title: string`) that renders the page heading.
- `App.tsx` keeps a list of applications (`id`, `company`, `role`) in `useState`, seeded with two example rows.
- Two controlled inputs collect a company and a role. The Add Application button trims both, ignores the click if either is empty, appends the new row with `Date.now()` as its id, and clears the inputs.
- The list renders each application as "Company - Role".

## Notes

- `App.tsx` imports `./App.css`, which was the stylesheet from the Vite template. It was not kept.
- Today's React lint rules flag one line: the two example rows are set inside a `useEffect` (`react-hooks/set-state-in-effect`), which renders the empty list first and then the seeded one. Passing the rows to `useState` as its initial value does the same in one render.

## Commits

| Date | Commit |
| --- | --- |
| 2026-02-01 | Initial commit |
| 2026-02-01 | installing react with vite |
| 2026-02-01 | feat: initial App component rendering |
| 2026-02-01 | feat: add Header component with typed props |
| 2026-02-01 | feat: application list with state and add action |
| 2026-02-02 | Update App.tsx |
