# Cherry Backup — 2026-06-04

Snapshot taken before a full fresh redeploy (navigation regression investigation).

## Commit hashes at backup time
- main repo (D:\Works\Lampa, no remote): `0594cc2`
- cherry-plugin (plugin-release → GitHub Pages, branch main): `22a82fc`
- cherry-proxy (workers/cherry-proxy → CF Worker + Deno, branch main): `b5166ed`

## Contents
| Path | What |
|---|---|
| `github-pages/plugin.js` | LIVE file served from https://aawersom.github.io/cherry-plugin/plugin.js at backup time |
| `source/plugin.js` | Working-tree plugin.js (source of truth) |
| `source/plugin-release.plugin.js` | The committed plugin-release copy |
| `source/cherry-categories.json` | Autonomous category parse data (all 24 sites) |
| `cherry-proxy-worker/index.js` | CF Worker source (workers/cherry-proxy/src/index.js) |
| `cherry-proxy-worker/deno.js` | Deno Deploy proxy source |
| `git-bundles/cherry-plugin.bundle` | FULL git history of the cherry-plugin (GitHub Pages) repo — all branches |
| `git-bundles/cherry-proxy.bundle` | FULL git history of the cherry-proxy repo — all branches |

## Restore
- Plugin (GitHub Pages): `git clone git-bundles/cherry-plugin.bundle restored-plugin` → push to `aawersom/cherry-plugin`.
- Worker: `git clone git-bundles/cherry-proxy.bundle restored-proxy`; redeploy CF via `npx wrangler deploy`; Deno via push.
- Quick file restore: copy `source/plugin.js` over `plugin.js`, then redeploy.

## Live endpoints
- Plugin: https://aawersom.github.io/cherry-plugin/plugin.js
- CF Worker: https://cherry-proxy.aawersom.workers.dev
- Deno: https://cherry-proxy.aawersom.deno.net
