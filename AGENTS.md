# MoBlockz Game Repository

Check edited JavaScript files before finishing:

```sh
node --check <changed-file.js>
```

Open `index.html` through a local static server (for example `npx serve .` or `python3 -m http.server`) and test the real gameplay change in a browser (desktop and touch/mobile controls). Report `Observed` vs. `Not run` honestly.

For scripted checks, open `index.html?debug` (add `&fx=high` to keep effects on in a slow headless browser). That exposes `window.ballCrash` with `state`, `platform(i)`, `setRot(r)`, `startLevel(n)`, `startEndless()`, `goHome()` and `settings(n)`, so a bot can steer through gaps, onto stars or into hazards.

## Rules

- **Kid-friendly & safe by default:** Zero ads, zero accounts/logins, zero tracking. Use private room codes only for multiplayer.
- **No unnecessary build bloat:** Keep browser games playable directly on GitHub Pages with static files unless a build step is clearly required.
- **Multi-agent Git safety:** Never run `git add -A`, `git stash`, `git reset --hard`, or force-push. Stage only the files you changed.
- **Choose good compromises & selective tests:** Keep code simple and readable; add automated tests only where silent regressions are costly (game rules, state sync, physics, or asset manifests).
- **Doc voice:** Keep explanations short, plain, and encouraging. Integrate doc edits instead of appending.
- **Local QA artifacts:** Keep screenshots and scratch captures inside gitignored `.audit/` or `.qa/`.
