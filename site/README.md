# mdflow.dev — the website

The landing page for [mdflow](https://github.com/johnlindquist/mdflow),
deployed to https://mdflow.dev via Vercel (Root Directory = `site/`).

Imported from the former `johnlindquist/mdflow.dev` repo so the CLI and its
site ship from one place. Site-only commits use the `chore(site):` /
`docs(site):` scopes so semantic-release never cuts a CLI release for a
visual tweak.

## Facts vs art

Factual copy (commands, flags, engines, version badge) renders from
[`src/facts.json`](src/facts.json), which is **generated — do not edit it by
hand**. Regenerate from the CLI source of truth at the repo root:

```bash
bun run facts          # rewrite site/src/facts.json
bun run facts:check    # CI drift gate (fails if stale)
```

Article pages live in [`content/`](content/) (e.g. the evolve deep dive) and
are rendered to `dist/<slug>/index.html` by `scripts/build-content.mjs`
during `npm run build` — never link site copy to external article hosts.

Everything else (headlines, shaders, easter eggs, audio) is hand-written art;
edit freely.

## Run locally

```bash
npm install
npm run dev        # via portless at http://mdflow.localhost:1355
npm run dev:raw    # plain vite on its default port
npm run build      # vite build to dist/, then renders content/*.md article pages
```
