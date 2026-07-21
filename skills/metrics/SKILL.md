---
name: metrics
description: Measure traction and discoverability across all non-archived GitHub repos and their publications (npm, App Store, Play Store, web properties), judge each product against its own declared intent, score the previous run's recommendations, and issue a capped set of falsifiable new ones. Use when the user asks how their projects are doing, which repos have traction, what to double down on or kill, how their products rank in search or in AI assistants, or wants a periodic portfolio review across repos and stores.
---

# Metrics

A closed loop over the whole fleet: measure, judge, bet, then score the bet next time. Read [REFERENCE.md](REFERENCE.md) for data-source detail, the verdict rules, and the record schemas.

This is a standalone skill. It never ends with "run the next workflow skill"; it hands off per product.

## Operating contract

- **Read-only.** Never write to an analyzed repo, never open issues, never commit. All state lives in `~/.harness/metrics/`.
- **Judge each product against its own declared intent**, from its `.harness/product/product.md`, and against its own history. Never rank products against each other on a normalized traction score.
- **Ownership is verified, never assumed.** A package matching a repo name may belong to someone else.
- **A missing credential is "unknown", never "zero".** Every gap is reported with its reason.
- **At most one live bet per product, ten in total.** Product and discoverability bets compete in the same pool.

## Step 1: Collect

Run the collector. It is stdlib-only python3 and needs no install step:

```bash
python3 <skill>/scripts/collect.py --init      # first run only, writes config skeleton
python3 <skill>/scripts/collect.py --backfill  # first run only, pulls npm and star history
python3 <skill>/scripts/collect.py             # every run after that
```

State lives in `~/.harness/metrics/`: `config.json` (product mapping and frozen GEO queries), `snapshots/YYYY-MM-DD.json`, `recommendations.json`.

Read the snapshot. Do not re-fetch anything the collector already gathered.

## Step 2: Close the config gaps

`--init` leaves the judgment calls unset. Resolve them once, then persist to `config.json`:

- **`role`** — `product` or `support`. Support means infrastructure, assets or meta repos that exist to serve other work. They get no traction verdict, only an appendix line.
- **`sites`** — landing pages the collector could not infer.
- **`geo_queries`** — derive from the audience and problem in each product's `.harness/product/product.md`, present them for approval, then freeze. Changing a frozen set starts a new series: bump `geo_queries_version` and never compare across versions.

## Step 3: Score the open bets

Before measuring anything new, settle what was already predicted. For each open bet in `recommendations.json`:

1. **Was it applied?** Check its declared verification signal against observable state. Ask the user only about bets whose signal cannot be checked automatically, in one short list.
2. **Not applied and past its window twice** → `expired`, not `failed`. Ask whether to keep or drop it. A recommendation you keep not doing is itself a finding.
3. **Applied but before its evaluation date** → leave open. Judge nothing early.
4. **Applied and past its date** → compare against the written prediction. `won` or `lost`, nothing in between.
5. **Lost and reversible** → propose the reversal with the exact commit or command, and the skill to run. Never revert anything yourself.

Confounders matter: if an external event plausibly explains the movement, say so and downgrade the confidence. With one product and no control group, a met prediction is a met prediction, not proof the action caused it. Never write causal language the data cannot support.

## Step 4: Traction

For each `product` role, read its `.harness/product/product.md` for who it is for and what it is trying to be, then read its numbers from the snapshot against earlier snapshots.

Products whose declared purpose is a showcase are judged on audience signal, not on downloads. A product with no `product.md` is judged on intent inferred from its README, and every conclusion drawn from it is labelled low confidence with a suggestion to run `/product-plan`.

## Step 5: Discoverability

Three distinct measurements. Do not collapse them.

- **SEO** — real Search Console data per page: impressions, clicks, position, and which queries actually bring people. The collector's static page audit only explains a bad number; it never substitutes for one.
- **GEO** — run each product's frozen queries against engines with live retrieval, three times each, and record the appearance rate. Track *mentioned* and *described correctly* separately: being cited wrongly is a different failure from being ignored, and it is fixed differently.
- **ASO** — the store funnel (impressions, listing visits, installs) plus a listing audit.

Search Console, Play Console and App Store Connect need an OAuth or signed-JWT flow, so they are collected through the browser layer, not the script. See [REFERENCE.md](REFERENCE.md).

Label every GEO number as comparable to itself over time, never as a market position. Probing from a logged-in browser measures a personalized bubble.

## Step 6: Distribution gaps

Cross capability against presence, as its own section: a publishable package never published, an app live in one storefront but not another, a skill or MCP server absent from the registry that indexes its kind, a public repo with no release, a product whose only surface is its own README. These are usually the cheapest wins in the report, because the product already exists and only the channel is missing.

The snapshot carries two fleet-level channels for this: `skills_sh` (published agent skills and install counts) and `mcp_registry` (which of the owner's servers the curated GitHub registry lists). Both are channels where a capability the user already ships may simply be absent.

## Step 7: Verdicts and new bets

Every `product` gets exactly one label, with the numbers that justify it and a single next action: **DOUBLE DOWN / KEEP / PROMOTE / KILL / NO DATA**. No hedging. `NO DATA` must name what to start measuring.

`KILL` is unavailable for anything under 90 days from its first publication. A young product with no traction is young, not dead.

Then issue new bets, at most one per product and ten in total, chosen by expected impact across both product and discoverability work. A bet that cannot state a metric, a number and a date is not a bet; drop it or sharpen it. Findings that affect the portfolio, and therefore every product hosted on it, outrank single-product fixes.

## Step 8: Report

The portfolio has a dual role: it is a product with its own `product.md` and the distribution channel for every project page hosted on it. Give it its own section, and mark shared-surface findings as multiplier levers.

Publish an HTML dashboard as a private Artifact. `config.json` stores `dashboard.url` from the first run; pass it as `url` on every later publish so the panel stays at one address instead of minting a new one each month. Load the `artifact-design` and `dataviz` skills before building it. It must include the bet ledger and the skill's own hit rate, so a run that keeps recommending badly is visible as such.

In the chat, leave a summary of about five lines: what moved, what was settled, what is now live. Nothing else.
