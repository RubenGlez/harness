# Metrics Reference

Use this only after `metrics` is triggered and the snapshot has been read.

## Record schemas

### `~/.harness/metrics/recommendations.json`

```json
{
  "id": "langdrift-2026-07-21-1",
  "product": "langdrift",
  "kind": "product | seo | geo | aso | distribution",
  "action": "What to do, in one sentence",
  "rationale": "Why this, given the declared intent and current numbers",
  "metric": "npm.downloads_last_month",
  "baseline": 392,
  "prediction": "> 900 by 2026-09-20",
  "evaluate_after": "2026-09-20",
  "verification": {
    "kind": "auto | ask",
    "signal": "release tagged, or path touched, or URL starts resolving, or storefront starts listing"
  },
  "status": "proposed | applied | won | lost | expired | dropped | reverted | superseded",
  "issued": "2026-07-21",
  "history": [{"date": "2026-08-01", "event": "applied", "evidence": "v0.5.0 released"}],
  "reversible": true,
  "revert_hint": "git revert <sha>"
}
```

A bet without `metric`, a number in `prediction`, and `evaluate_after` is not a bet. Do not store it.

### Verdict record

Each product gets `verdict`, `evidence` (the specific numbers), `next_action`, and `confidence` (`high` when intent is declared and history exists, `low` when intent was inferred from a README or only one snapshot exists).

## Traction signals by product kind

| Kind | Primary signal | Secondary | Trap |
|---|---|---|---|
| npm library | downloads trend, dependents | stars, release cadence | Registry mirrors and CI inflate downloads |
| CLI via own Homebrew tap | GitHub release asset downloads | tap clones | No download analytics exist for custom taps |
| Mobile app | store installs, funnel conversion | ratings, retention | Install brackets are coarse under 1000 |
| Content site | Search Console clicks, returning visitors | time on page | Bot traffic |
| Showcase | referral traffic, inbound mentions | stars | Downloads are the wrong axis entirely |

### Reading npm downloads honestly

**Report the median day, not the monthly sum.** Download series are spiky: a publish event, a scanner sweep or a single CI matrix produces days one to two orders of magnitude above the baseline, and the sum is then mostly those days. A package can show five figures a month while its typical day is single digits. The median times the period is the robust baseline; use it for verdicts and for bet baselines, and quote the raw sum only alongside the share of volume the top five days account for.

When that share is above about 60%, the headline number is an event, not an install base. Say so in those terms.

Cross-check the shape before concluding:

- **Spiky, high coefficient of variation** — releases and automation. Robust baseline is the real signal.
- **Flat, near-identical across sibling packages of a monorepo** — mirror or registry scanning. Adoption is uneven by nature; the entry package outpaces its adapters.
- **Weekday-heavy, weekend dips** — humans. Machines do not care what day it is.

Synchronized spike dates across every package of a workspace confirm a shared publish pipeline rather than independent user demand.

`downloads_last_month` for a package published weeks ago includes its own release-day CI. Prefer the daily history in the snapshot over the point figure.

### Ownership verification

The collector resolves npm packages through `registry.npmjs.org/-/v1/search?text=maintainer:<user>` and maps them to repos via each package's repository link. Never map a package by name: `tiza` on npm belongs to an unrelated maintainer while the user has a repo of the same name. If a package needs a manual mapping, set it in `config.json` and confirm the maintainer first.

### Directory channels

Two channels are indexed per owner rather than per repo, so the collector gathers them once at fleet level.

**skills.sh** publishes agent skills with install counts, rendered server-side; there is no JSON API and the catch-all route answers 200 with the app shell for any path, including `/api/...`. Read `published_skills` from the page's JSON-LD `CollectionPage`, which is far stabler than the markup, and the totals from the rendered text. A repo that ships many skills while the profile lists a couple of them is a distribution gap, not a traction problem.

**The MCP registry** means two different things, and confusing them produces a recommendation the user cannot act on.

- `registry.modelcontextprotocol.io` is the **open** registry. Anyone can publish, so presence is actionable and absence is a real distribution gap. This is the one the collector tracks.
- `api.mcp.github.com` is a **curated GitHub selection** of a few hundred servers. You cannot submit to it. Absence is not a gap, carries no signal about your product, and must never become a bet.

Match on the owner's repository URLs rather than package names, and strip readmes before storing; they are larger than the rest of the snapshot combined.

Both are cases where the same trap applies as everywhere else: a 200 response is not evidence a resource exists. `probe_static_file` in the collector requires a non-HTML content type before reporting `llms.txt`, `robots.txt` or `sitemap.xml` as present, because single-page apps otherwise fake all three.

### Homebrew

Formula download counts exist only for `homebrew-core`. Tools distributed through a personal tap have no adoption metric beyond GitHub release asset downloads. Say this plainly rather than reporting an absence as a decline.

## Sources needing the browser layer

These need OAuth or a signed JWT, which would mean a crypto dependency the harness installer deliberately avoids. Drive them through Claude in Chrome, in the user's session, and record what was read into the snapshot alongside the script's output.

| Source | Where | What to read |
|---|---|---|
| Search Console | `search.google.com/search-console` | Per-page impressions, clicks, average position, top queries, last 28 days and the previous 28 |
| Play Console | `play.google.com/console` | Store listing acquisition funnel: impressions, listing visits, installs, conversion rate |
| App Store Connect | `appstoreconnect.apple.com` | Impressions, product page views, downloads, conversion, per storefront |
| PostHog | project dashboard | Active users, retention, the activation event that matters for that product |

Cloudflare Web Analytics is a bearer-token GraphQL API, so the collector handles it when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are in the environment. Load them from lokalite with `get_secret` and `source`, never into a file.

Browser collection is attended by definition. The daily cron runs the script only; anything from this table carries the date it was last read, and the dashboard shows that age.

## GEO probing

Run only against engines with live retrieval: Google including AI Overviews, Perplexity, and an assistant with web search enabled. Probing a model without retrieval measures its training data, which no amount of page work will move this quarter.

Three runs per query. Record the appearance rate, not a boolean. Record separately whether the description was accurate, and capture the wrong description verbatim when it is not, since that is the thing to fix.

Use a fresh incognito context and unbranded queries. State in the dashboard that the figure is a personalized measurement, comparable to its own history and not to the market.

A product whose GEO appearance rate is zero and whose only surface is a README does not have a GEO problem. It has a distribution gap; report it in that section instead.

## Static page audit

The collector records `has_schema_org`, `has_og_tags`, `h1_count`, `text_ratio`, `has_llms_txt`, `has_robots_txt` and `has_sitemap` per surface. `text_ratio` is a rough proxy for whether an agent can read the page without executing JavaScript; a low ratio on a client-rendered page explains a bad GEO result but is not itself a finding worth a bet.

These are explanations for measured outcomes. Never issue a bet on a checklist item that no measured number connects to.

## Verdict rules

- **DOUBLE DOWN** — the declared audience is reachable and the trend is rising on the signal that matters for that product kind.
- **KEEP** — serving its purpose without growth, and its purpose does not require growth.
- **PROMOTE** — usage signals are healthy relative to reach, and reach is the constraint. This is the "good product, invisible" case, and it is why SEO, GEO and ASO share the bet pool with product work.
- **KILL** — the declared audience did not materialize after a fair window and no channel is untried. Blocked entirely for anything under 90 days from first publication.
- **NO DATA** — must name the specific measurement to start and how.

`support` role repos get no verdict.

## Cadence

The cron runs `collect.py` only: no model, no browser, no analysis. The full analysis is on demand, because the browser layer and the GEO probe both need the user present.

Weekly collection is enough, and the reason is worth keeping straight. Almost every source is reconstructable after the fact: npm serves 18 months of daily downloads, stargazers carry dates, Cloudflare is queried over a window. Cumulative counters like release asset downloads and skills.sh installs lose only resolution, never data, and bets are evaluated over 30 to 90 days anyway.

**GitHub traffic is the sole exception.** It is a 14-day rolling window and expires unrecoverably. The collector stores the per-day rows rather than the total, so any cadence under 14 days captures everything and overlapping snapshots merge on the date key without double counting. Push collection past 14 days and traffic history develops permanent holes.

If snapshots are missing for a stretch, say so. Interpolating a gap produces a trend that never happened.
