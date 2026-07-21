#!/usr/bin/env python3
"""Deterministic metrics collector for the harness `metrics` skill.

Writes one snapshot per run to ~/.harness/metrics/snapshots/YYYY-MM-DD.json.
Standard library only: the harness installer assumes bash + python3 with no
package install step, so anything needing a signed JWT (App Store Connect,
Play Developer API) or an OAuth dance (Search Console) is deliberately left
to the skill's browser layer and recorded here as unavailable.

Usage:
  collect.py --init       discover repos and write a config skeleton
  collect.py              collect today's snapshot
  collect.py --backfill   also pull npm daily history and star dates
"""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(os.environ.get("HARNESS_METRICS_HOME", Path.home() / ".harness" / "metrics"))
CONFIG = ROOT / "config.json"
SNAPSHOTS = ROOT / "snapshots"
WORKSPACE = Path(os.environ.get("HARNESS_WORKSPACE", Path.home() / "workspace"))
UA = "harness-metrics/1.0"
TIMEOUT = 20


# --------------------------------------------------------------------------
# plumbing
# --------------------------------------------------------------------------

def gh(*args, paginate=False):
    """Run `gh` and parse JSON. Returns (data, error_reason)."""
    cmd = ["gh", *args]
    if paginate:
        cmd.append("--paginate")
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, f"gh failed: {exc}"
    if out.returncode != 0:
        return None, (out.stderr or "gh returned non-zero").strip().splitlines()[-1][:200]
    body = out.stdout.strip()
    if not body:
        return None, "gh returned empty output"
    if paginate:
        # --paginate concatenates JSON arrays; stitch them back together.
        chunks = re.sub(r"\]\s*\[", ",", body)
        body = chunks
    try:
        return json.loads(body), None
    except json.JSONDecodeError as exc:
        return None, f"unparseable gh output: {exc}"


def http(url, want="json", headers=None):
    """GET a URL. Returns (data, error_reason)."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read()
            status = resp.status
    except urllib.error.HTTPError as exc:
        return None, f"HTTP {exc.code}"
    except Exception as exc:  # noqa: BLE001 - network is allowed to fail any way it likes
        return None, f"request failed: {exc}"
    if want == "text":
        return raw.decode("utf-8", "ignore"), None
    try:
        return json.loads(raw.decode("utf-8", "ignore")), None
    except json.JSONDecodeError as exc:
        return None, f"unparseable response ({status}): {exc}"


def today():
    return date.today().isoformat()


# --------------------------------------------------------------------------
# config bootstrap
# --------------------------------------------------------------------------

def discover_repos():
    user, err = gh("api", "user")
    if err:
        sys.exit(f"cannot reach gh: {err}")
    login = user["login"]
    repos, err = gh(
        "repo", "list", login, "--limit", "1000",
        "--json", "nameWithOwner,name,isArchived,isPrivate,url,description,homepageUrl",
    )
    if err:
        sys.exit(f"cannot list repos: {err}")
    return login, [r for r in repos if not r["isArchived"]]


def npm_packages_by_maintainer(maintainer):
    """Authoritative package list, keyed by repo.

    Never infer npm ownership from a local package.json name: published names
    drift from local ones, monorepo workspaces are missed entirely, and a name
    you do not own may well exist. `tiza` on npm belongs to someone else.
    """
    data, err = http(
        f"https://registry.npmjs.org/-/v1/search?text=maintainer:{maintainer}&size=250"
    )
    if err:
        return {}, err
    by_repo = {}
    for obj in data.get("objects", []):
        pkg = obj.get("package", {})
        repo_url = (pkg.get("links") or {}).get("repository") or ""
        match = re.search(r"github\.com[/:]([\w.-]+)/([\w.-]+?)(?:\.git)?/?$", repo_url)
        if match and pkg.get("name"):
            by_repo.setdefault(match.group(2), []).append(pkg["name"])
    return {k: sorted(v) for k, v in by_repo.items()}, None


def infer_publications(repo_name):
    """Best-effort mapping from a local clone. Judgment calls are left to the model."""
    out = {"play": None, "appstore": None, "sites": [], "portfolio_page": None}
    clone = WORKSPACE / repo_name

    app = clone / "app.json"
    if app.is_file():
        try:
            expo = json.loads(app.read_text(encoding="utf-8")).get("expo", {})
            out["play"] = (expo.get("android") or {}).get("package")
            out["appstore"] = (expo.get("ios") or {}).get("bundleIdentifier")
        except (json.JSONDecodeError, OSError):
            pass

    # The portfolio routes project pages at the domain root as /<slug>, where the
    # slug is the content filename. Repo name and slug differ in case (SprayDeck
    # vs spraydeck.md), so match on disk rather than assuming.
    projects = WORKSPACE / "portfolio" / "src" / "content" / "projects"
    if projects.is_dir():
        for page in projects.glob("*.md"):
            if page.stem.lower() == repo_name.lower():
                out["portfolio_page"] = f"https://rubenglez.dev/{page.stem}"
                break

    return out


def cmd_init():
    login, repos = discover_repos()
    existing = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.is_file() else {}
    products = existing.get("products", {})
    maintainer = existing.get("npm_maintainer", login.lower())

    npm_by_repo, npm_err = npm_packages_by_maintainer(maintainer)
    if npm_err:
        print(f"warning: npm maintainer lookup failed ({npm_err}); npm mapping left as-is")

    for repo in repos:
        name = repo["name"]
        entry = products.get(name, {})
        inferred = infer_publications(name)
        homepage = (repo.get("homepageUrl") or "").strip()
        if homepage and "npmjs.com" not in homepage and "github.com" not in homepage:
            inferred["sites"] = [homepage]
        products[name] = {
            "repo": repo["nameWithOwner"],
            "private": repo["isPrivate"],
            # role is a judgment call: "product" or "support". Left null for the model.
            "role": entry.get("role"),
            "npm": entry.get("npm") or npm_by_repo.get(name, []),
            "play": entry.get("play") or inferred["play"],
            "appstore": entry.get("appstore") or inferred["appstore"],
            "sites": entry.get("sites") or inferred["sites"],
            "portfolio_page": entry.get("portfolio_page") or inferred["portfolio_page"],
            # Frozen once set. Changing them starts a new GEO series.
            "geo_queries": entry.get("geo_queries", []),
            "geo_queries_version": entry.get("geo_queries_version", 1),
        }

    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text(
        json.dumps({
            "version": 1,
            "owner": login,
            "npm_maintainer": maintainer,
            "skills_sh_handle": existing.get("skills_sh_handle", login.lower()),
            "storefronts": existing.get("storefronts", ["us", "gb", "es"]),
            "products": products,
        }, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    unresolved = [n for n, p in products.items() if p["role"] is None]
    print(f"wrote {CONFIG} with {len(products)} repos")
    if unresolved:
        print(f"role unset for {len(unresolved)}: {', '.join(sorted(unresolved))}")


# --------------------------------------------------------------------------
# collectors
# --------------------------------------------------------------------------

def collect_github(full_name, backfill):
    out, gaps = {}, []
    repo, err = gh("api", f"repos/{full_name}")
    if err:
        return {}, [{"source": "github", "reason": err}]
    out.update({
        "stars": repo.get("stargazers_count"),
        "forks": repo.get("forks_count"),
        "watchers": repo.get("subscribers_count"),
        "open_issues_and_prs": repo.get("open_issues_count"),
        "pushed_at": repo.get("pushed_at"),
        "created_at": repo.get("created_at"),
        "topics": repo.get("topics") or [],
        "description": repo.get("description"),
        "homepage": repo.get("homepage"),
        "archived": repo.get("archived"),
    })

    for kind in ("views", "clones"):
        data, err = gh("api", f"repos/{full_name}/traffic/{kind}")
        if err:
            gaps.append({"source": f"github.traffic.{kind}", "reason": err})
        else:
            out[f"traffic_{kind}_14d"] = data.get("count")
            out[f"traffic_{kind}_uniques_14d"] = data.get("uniques")
            # Store the daily breakdown, not just the total. Traffic is the only
            # source that expires: GitHub keeps a 14-day rolling window and
            # nothing can reconstruct it afterwards. Keeping the per-day rows
            # makes any collection cadence under 14 days lossless, and lets
            # overlapping snapshots be merged without double counting.
            out[f"traffic_{kind}_daily"] = [
                [row["timestamp"][:10], row["count"], row["uniques"]]
                for row in data.get(kind, [])
            ]

    releases, err = gh("api", f"repos/{full_name}/releases?per_page=100")
    if err:
        gaps.append({"source": "github.releases", "reason": err})
    else:
        assets = [a for r in releases for a in r.get("assets", [])]
        out["releases"] = len(releases)
        out["release_downloads_total"] = sum(a.get("download_count", 0) for a in assets)
        out["latest_release"] = releases[0]["tag_name"] if releases else None
        out["latest_release_at"] = releases[0]["published_at"] if releases else None

    if backfill:
        stars, err = gh(
            "api", "-H", "Accept: application/vnd.github.star+json",
            f"repos/{full_name}/stargazers?per_page=100", paginate=True,
        )
        if err:
            gaps.append({"source": "github.star_history", "reason": err})
        else:
            out["star_history"] = sorted(
                s["starred_at"] for s in stars if isinstance(s, dict) and s.get("starred_at")
            )
    return out, gaps


def collect_npm(package, backfill):
    out, gaps = {"package": package}, []
    point, err = http(f"https://api.npmjs.org/downloads/point/last-month/{package}")
    if err:
        return out, [{"source": f"npm:{package}", "reason": err}]
    out["downloads_last_month"] = point.get("downloads")

    if backfill:
        end = date.today()
        start = end - timedelta(days=540)  # npm serves ~18 months of daily data
        rng, err = http(
            f"https://api.npmjs.org/downloads/range/{start.isoformat()}:{end.isoformat()}/{package}"
        )
        if err:
            gaps.append({"source": f"npm:{package}.history", "reason": err})
        else:
            out["daily_history"] = [
                [d["day"], d["downloads"]] for d in rng.get("downloads", []) if d.get("downloads")
            ]

    meta, err = http(f"https://registry.npmjs.org/{package}")
    if err:
        gaps.append({"source": f"npm:{package}.registry", "reason": err})
    else:
        versions = meta.get("time", {})
        out["latest_version"] = meta.get("dist-tags", {}).get("latest")
        out["last_publish"] = versions.get(out["latest_version"])
        out["first_publish"] = versions.get("created")
    return out, gaps


def collect_play(app_id):
    """Public listing only. Download brackets are coarse by design ('10+', '1K+')."""
    url = f"https://play.google.com/store/apps/details?id={app_id}&hl=en&gl=US"
    html, err = http(url, want="text", headers={"User-Agent": "Mozilla/5.0"})
    if err:
        return {"app_id": app_id, "listed": False}, [{"source": f"play:{app_id}", "reason": err}]

    out = {"app_id": app_id, "listed": True, "url": url}
    # Anchor on the label, never the class name: Play's CSS classes rotate.
    dl = re.search(r">([^<>]{1,12})</div><div[^>]*>Downloads</div>", html)
    out["downloads_bracket"] = dl.group(1).strip() if dl else None
    rating = re.search(r">([\d.]{1,4})</div><div[^>]*>\s*star", html)
    out["rating"] = float(rating.group(1)) if rating else None
    reviews = re.search(r">([\d.,KMB]{1,10})\s*reviews</div>", html)
    out["reviews"] = reviews.group(1) if reviews else None
    ver = re.search(r"Current Version.{0,200}?>([\d.]+)<", html, re.S)
    out["version"] = ver.group(1) if ver else None
    gaps = []
    if out["downloads_bracket"] is None:
        gaps.append({"source": f"play:{app_id}.downloads", "reason": "bracket not found in listing HTML"})
    return out, gaps


def collect_appstore(bundle_id, storefronts):
    """Availability is per storefront, so a single lookup cannot answer "is it live".

    Ratings are per storefront too; they are reported per storefront rather than
    summed, because the same review never appears in two of them.
    """
    out = {"bundle_id": bundle_id, "storefronts": {}}
    gaps = []
    for country in storefronts:
        data, err = http(f"https://itunes.apple.com/lookup?bundleId={bundle_id}&country={country}")
        if err:
            gaps.append({"source": f"appstore:{bundle_id}:{country}", "reason": err})
            continue
        if not data.get("resultCount"):
            out["storefronts"][country] = {"listed": False}
            continue
        app = data["results"][0]
        out["storefronts"][country] = {
            "listed": True,
            "name": app.get("trackName"),
            "version": app.get("version"),
            "rating": app.get("averageUserRating"),
            "rating_count": app.get("userRatingCount"),
            "released_at": app.get("releaseDate"),
            "updated_at": app.get("currentVersionReleaseDate"),
            "url": app.get("trackViewUrl"),
        }
    listed = [c for c, v in out["storefronts"].items() if v.get("listed")]
    out["listed_in"] = sorted(listed)
    out["missing_from"] = sorted(set(out["storefronts"]) - set(listed))
    return out, gaps


def collect_site(url):
    """Reachability and agent-legibility signals. Ranking data comes from Search Console."""
    html, err = http(url, want="text")
    if err:
        return {"url": url, "reachable": False}, [{"source": f"site:{url}", "reason": err}]
    title = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
    desc = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)', html, re.I)
    out = {
        "url": url,
        "reachable": True,
        "bytes": len(html),
        "title": title.group(1).strip()[:200] if title else None,
        "meta_description": desc.group(1).strip()[:300] if desc else None,
        "has_schema_org": "application/ld+json" in html,
        "has_og_tags": 'property="og:' in html or "property='og:" in html,
        "h1_count": len(re.findall(r"<h1[\b >]", html, re.I)),
        # Rough proxy for "an agent can read this without executing JS".
        "text_ratio": round(len(re.sub(r"<[^>]+>", "", html)) / max(len(html), 1), 3),
    }
    base = url.rstrip("/")
    for probe, key in (("/llms.txt", "has_llms_txt"), ("/robots.txt", "has_robots_txt"),
                       ("/sitemap.xml", "has_sitemap")):
        out[key] = probe_static_file(base + probe)
    return out, []


def probe_static_file(url):
    """A 200 is not proof the file exists.

    Single-page apps serve their shell for every unmatched path, so a naive
    status check reports llms.txt on sites that have none. Require a non-HTML
    content type and a body that does not open with markup.
    """
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            ctype = (resp.headers.get("Content-Type") or "").lower()
            head = resp.read(400).decode("utf-8", "ignore").lstrip()
    except Exception:  # noqa: BLE001
        return False
    if "html" in ctype:
        return False
    return not head.lower().startswith(("<!doctype", "<html"))


def collect_mcp_registry(owner):
    """GitHub's MCP registry is curated and small, so absence is a real finding.

    Readmes are stripped: they dwarf everything else in the snapshot and the
    analysis never reads them from here.
    """
    servers, cursor, pages = [], None, 0
    while pages < 10:
        url = "https://api.mcp.github.com/v0/servers?limit=100"
        if cursor:
            url += f"&cursor={cursor}"
        data, err = http(url)
        if err:
            return None, [{"source": "mcp_registry", "reason": err}]
        for item in data.get("servers", []):
            server = item.get("server", {})
            servers.append({
                "name": server.get("name"),
                "repo_url": (server.get("repository") or {}).get("url", ""),
                "packages": [p.get("name") for p in server.get("packages", []) if p.get("name")],
            })
        cursor = (data.get("metadata") or {}).get("next_cursor")
        pages += 1
        if not cursor:
            break

    needle = f"github.com/{owner}".lower()
    mine = [s for s in servers if needle in (s["repo_url"] or "").lower()]
    return {"total_servers": len(servers), "listed": sorted(s["name"] for s in mine)}, []


def collect_skills_sh(handle):
    """skills.sh publishes install counts server-side; there is no JSON API.

    The catch-all route answers 200 with the app shell for any path, so parse
    the profile page and nothing else.
    """
    url = f"https://www.skills.sh/{handle}"
    html, err = http(url, want="text")
    if err:
        return None, [{"source": f"skills.sh:{handle}", "reason": err}]

    out = {"handle": handle, "url": url}
    # The published skill list is in JSON-LD, which is far more stable than markup.
    published = []
    for blob in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        try:
            data = json.loads(blob)
        except json.JSONDecodeError:
            continue
        if data.get("@type") == "CollectionPage":
            published = [
                {"name": part.get("name"), "url": part.get("url")}
                for part in data.get("hasPart", [])
            ]
    out["published_skills"] = sorted(published, key=lambda s: s["name"] or "")

    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>", "", html, flags=re.S)))
    for pattern, key in ((r"(\d+)\s+sources?", "sources"),
                         (r"(\d+)\s+skills?\b", "skills"),
                         (r"(\d+)\s+total installs?", "total_installs")):
        match = re.search(pattern, text)
        out[key] = int(match.group(1)) if match else None

    gaps = []
    if out["total_installs"] is None:
        gaps.append({"source": f"skills.sh:{handle}", "reason": "install total not found in profile HTML"})
    return out, gaps


def collect_cloudflare(site_tag, token, account_id):
    """Cloudflare Web Analytics via GraphQL. Bearer token only, so it fits the no-deps rule."""
    since = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    until = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    query = """
    query($accountTag:string!,$siteTag:string!,$since:Time!,$until:Time!){
      viewer{accounts(filter:{accountTag:$accountTag}){
        rumPageloadEventsAdaptiveGroups(limit:1,filter:{siteTag:$siteTag,datetime_geq:$since,datetime_leq:$until}){
          count sum{visits}
        }}}}
    """
    payload = json.dumps({
        "query": query,
        "variables": {"accountTag": account_id, "siteTag": site_tag, "since": since, "until": until},
    }).encode()
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/graphql",
        data=payload,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": UA},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8", "ignore"))
    except Exception as exc:  # noqa: BLE001
        return None, f"cloudflare request failed: {exc}"
    if data.get("errors"):
        return None, f"cloudflare error: {str(data['errors'])[:200]}"
    try:
        groups = data["data"]["viewer"]["accounts"][0]["rumPageloadEventsAdaptiveGroups"]
    except (KeyError, IndexError, TypeError):
        return None, "cloudflare response shape unexpected"
    if not groups:
        return {"site_tag": site_tag, "pageviews_30d": 0, "visits_30d": 0}, None
    return {
        "site_tag": site_tag,
        "pageviews_30d": groups[0].get("count"),
        "visits_30d": (groups[0].get("sum") or {}).get("visits"),
    }, None


# Sources that need a signed JWT or an OAuth dance. Adding them here would mean
# adding a crypto dependency, which the harness installer explicitly avoids.
BROWSER_LAYER = {
    "search_console": "OAuth required; collect via the skill's browser layer",
    "play_console": "service-account JWT required; collect via the skill's browser layer",
    "app_store_connect": "ES256 JWT required; collect via the skill's browser layer",
    "geo_probe": "non-deterministic; run in the on-demand analysis, not the daily snapshot",
}


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def cmd_collect(backfill):
    if not CONFIG.is_file():
        sys.exit(f"no config at {CONFIG}; run: collect.py --init")
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    products, gaps = {}, []

    cf_token = os.environ.get("CLOUDFLARE_API_TOKEN")
    cf_account = os.environ.get("CLOUDFLARE_ACCOUNT_ID")

    for name, spec in sorted(config.get("products", {}).items()):
        entry = {"role": spec.get("role")}

        gh_data, gh_gaps = collect_github(spec["repo"], backfill)
        entry["github"] = gh_data
        gaps += [{**g, "product": name} for g in gh_gaps]

        if spec.get("npm"):
            entry["npm"] = []
            for pkg in spec["npm"]:
                data, npm_gaps = collect_npm(pkg, backfill)
                entry["npm"].append(data)
                gaps += [{**g, "product": name} for g in npm_gaps]

        if spec.get("play"):
            entry["play"], play_gaps = collect_play(spec["play"])
            gaps += [{**g, "product": name} for g in play_gaps]

        if spec.get("appstore"):
            entry["appstore"], app_gaps = collect_appstore(
                spec["appstore"], config.get("storefronts", ["us", "gb", "es"])
            )
            gaps += [{**g, "product": name} for g in app_gaps]

        surfaces = list(spec.get("sites") or [])
        if spec.get("portfolio_page"):
            surfaces.append(spec["portfolio_page"])
        if surfaces:
            entry["sites"] = []
            for url in surfaces:
                data, site_gaps = collect_site(url)
                entry["sites"].append(data)
                gaps += [{**g, "product": name} for g in site_gaps]

        if spec.get("cloudflare_site_tag"):
            if cf_token and cf_account:
                data, err = collect_cloudflare(spec["cloudflare_site_tag"], cf_token, cf_account)
                if err:
                    gaps.append({"product": name, "source": "cloudflare", "reason": err})
                else:
                    entry["cloudflare"] = data
            else:
                gaps.append({
                    "product": name, "source": "cloudflare",
                    "reason": "CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID not set",
                })

        products[name] = entry

    # One profile spans several repos, so it is a fleet-level source, not a per-product one.
    skills_sh = None
    if config.get("skills_sh_handle"):
        skills_sh, sk_gaps = collect_skills_sh(config["skills_sh_handle"])
        gaps += sk_gaps

    mcp_registry, mcp_gaps = collect_mcp_registry(config.get("owner", ""))
    gaps += mcp_gaps

    snapshot = {
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "date": today(),
        "backfill": backfill,
        "mcp_registry": mcp_registry,
        "skills_sh": skills_sh,
        "products": products,
        "unavailable": gaps,
        "deferred_to_browser_layer": BROWSER_LAYER,
    }
    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    path = SNAPSHOTS / f"{today()}.json"
    path.write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {path} ({len(products)} products, {len(gaps)} gaps)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--init", action="store_true", help="discover repos and write config skeleton")
    parser.add_argument("--backfill", action="store_true", help="pull npm daily history and star dates")
    args = parser.parse_args()
    if args.init:
        cmd_init()
    else:
        cmd_collect(args.backfill)


if __name__ == "__main__":
    main()
