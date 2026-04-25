# Minimalist Strava

Made this minimal personal training log that syncs your activities from Strava every 6 hours, generates a static map PNG and shows stats of your run/ride. Each card links to the full activity on Strava.

No backend, no database, no framework. Just a static site hosted on GitHub Pages, with a GitHub Actions cron job doing the syncing.

## About

- A grid of activity cards, newest first
- Each card shows the route map, date, distance, time, pace (or speed), and avg heart rate
- Runs and rides handled with appropriate units (pace for runs, speed for rides)
- Auto-syncs every 6 hours
- Free to host (GitHub Pages + Mapbox free tier)

## Stack

- **Strava API** — activity data
- **Mapbox Static Images API** — route map PNGs
- **GitHub Actions** — runs the sync on a cron, deploys to Pages
- **GitHub Pages** — hosts the static site
- **Plain HTML/CSS/JS** — no framework, no build step

---

## Setup

This takes about 20 minutes start to finish. You'll need a GitHub account, a Strava account, and a Mapbox account (all free).

### 1. Fork or clone the repo

Click "Fork" at the top of this repo, or clone it and push to your own. If you name it `strava`, your site will be at `https://YOUR_USERNAME.github.io/strava/`.

### 2. Create a Strava API app

Go to <https://www.strava.com/settings/api> and create an application:

- **Application Name** — anything (e.g. "personal training log")
- **Category** — "Data Importer"
- **Website** — any URL (your eventual site URL works)
- **Authorization Callback Domain** — `localhost`

After creating it, note the **Client ID** and **Client Secret** — you'll need both shortly.

### 3. Get a Strava refresh token

Strava uses OAuth, so you need to do a one-time authorization to get a long-lived refresh token. The sync script uses this token to mint short-lived access tokens whenever it runs.

**Step 3a — Authorize.** Replace `YOUR_CLIENT_ID` and visit this URL in your browser:

```
https://www.strava.com/oauth/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=read,activity:read_all
```

Click "Authorize." Your browser will redirect to a broken `localhost` page — that's expected. The URL bar will look like:

```
http://localhost/?state=&code=abc123def456...&scope=read,activity:read_all
```

**Copy the value of `code`** from the URL.

**Step 3b — Exchange for tokens.** Within ~10 minutes (the code expires fast), run this in your terminal as a **single line**, replacing the placeholders:

```
curl -X POST https://www.strava.com/oauth/token -F client_id=YOUR_CLIENT_ID -F client_secret=YOUR_CLIENT_SECRET -F code=YOUR_CODE -F grant_type=authorization_code
```

You'll get back JSON. Copy the `refresh_token` value — that's what you need.

> If you get an "Authorization Error," your code likely expired or the client ID/secret don't match. Get a fresh code by re-visiting the authorize URL.

### 4. Get a Mapbox token

Sign up at <https://account.mapbox.com>. On the "Access tokens" page, copy the **Default public token** (starts with `pk.`). The free tier allows 50,000 static map requests/month — way more than you'll ever need.

### 5. Add secrets to your repo

In your forked repo: **Settings → Secrets and variables → Actions → New repository secret**. Add four:

- `STRAVA_CLIENT_ID` — from step 2
- `STRAVA_CLIENT_SECRET` — from step 2
- `STRAVA_REFRESH_TOKEN` — from step 3b
- `MAPBOX_TOKEN` — from step 4

### 6. Configure repo permissions

Two settings need to be flipped:

**Workflow permissions.** Settings → Actions → General → scroll to "Workflow permissions" → select **"Read and write permissions"** → Save. This lets the sync workflow commit new activities back to the repo.

**Pages source.** Settings → Pages → under "Build and deployment," set Source to **"GitHub Actions"** (not "Deploy from a branch").

### 7. Run the first sync

Go to the **Actions** tab → click **sync** in the left sidebar → "Run workflow" button → "Run workflow." This backfills all your historical activities. With a lot of activities it might take a couple minutes — the script paginates through all of them and downloads a map PNG for each.

When the sync finishes, it commits `activities.json` and the `maps/` folder to the repo. That commit triggers the **deploy** workflow automatically. When deploy goes green, your site is live at:

```
https://YOUR_USERNAME.github.io/REPO_NAME/
```

From now on, sync runs every 6 hours automatically. New activities show up within ~6 hours, or you can trigger a manual sync any time from the Actions tab.

---

## Customization

### Units

The site uses imperial units by default (miles, mph, min/mi). To switch to metric, edit `index.html` — the formatting helpers near the top of the script section (`fmtDistance`, `fmtPace`, `fmtSpeed`) handle conversion. Change them like this:

```js
const fmtDistance = (m) => (m / 1000).toFixed(2) + ' km';
const fmtPace = (mps) => {
  const secPerKm = 1000 / mps;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
};
const fmtSpeed = (mps) => (mps * 3.6).toFixed(1) + ' km/h';
```

### Map style

The map style is set in `scripts/sync.js`. Look for `mapbox/light-v11` and swap it for any [Mapbox style URL](https://docs.mapbox.com/api/maps/styles/). Some good ones:

- `mapbox/light-v11` — clean light (default)
- `mapbox/dark-v11` — dark mode
- `mapbox/outdoors-v12` — topographic, good for trails
- `mapbox/satellite-streets-v12` — satellite

The route polyline color is also in `sync.js` — `path-3+f44-1(...)` means stroke width 3, color `#ff4444`, opacity 1. Change `f44` to any 3- or 6-char hex.

### Sync frequency

In `.github/workflows/sync.yml`, the cron line `'0 */6 * * *'` means "every 6 hours, on the hour, UTC." Some alternatives:

- `'0 */3 * * *'` — every 3 hours
- `'0 12 * * *'` — once a day at noon UTC
- `'*/30 * * * *'` — every 30 minutes (overkill — also note GitHub may delay scheduled runs during high load)

### Card design

All styling is in the `<style>` block at the top of `index.html`. Card layout, colors, and typography are easy to change. The grid uses `repeat(auto-fill, minmax(280px, 1fr))` — increase `280px` for fewer/wider cards, decrease for more/narrower ones.

---

## Privacy

Your `activities.json` and map PNGs are committed to your repo. **If your repo is public, your activity data is public** — anyone who finds the URL can see your routes, times, and HR.

To keep it private:
- Make the repo private (requires GitHub Pro for Pages on private repos), **or**
- Host on Vercel or Netlify with password protection instead of GitHub Pages

Note that Strava itself defaults activities to a privacy setting you control — privacy zones you've configured on Strava are reflected in the polylines you get back from the API, so private start/end points stay private.

---

## Troubleshooting

**"sync" workflow fails with 401 Unauthorized**
The Strava refresh token is wrong, or your app doesn't have the `activity:read_all` scope. Re-do step 3 making sure the scope is in the authorize URL.

**Sync succeeds but no maps appear**
Check the Mapbox token. It must start with `pk.` (public token). Watch the sync logs — Mapbox errors are printed per-activity.

**"Commit changes" step fails with "Permission denied"**
Workflow permissions weren't set to read/write. Step 6, first half.

**Deploy workflow doesn't run, or site shows 404**
Pages source isn't set to "GitHub Actions." Step 6, second half.

**Activities aren't appearing on the site**
Open `https://YOUR_USERNAME.github.io/REPO_NAME/activities.json` directly in your browser. If you see your activities there, it's a frontend issue (open the browser console). If you don't see them, the sync didn't commit — check the Actions tab logs.

**"sync" doesn't appear in the Actions sidebar**
The `.github/workflows/` folder didn't get pushed. Some upload methods skip dotfolders. Verify with `ls -la .github/workflows/` locally and `git log` to confirm those files were committed and pushed.

---

## File layout

```
.
├── .github/workflows/
│   ├── sync.yml          # cron job: runs sync.js every 6h
│   └── deploy.yml        # deploys to Pages on every push
├── scripts/
│   └── sync.js           # fetches Strava activities, generates maps
├── maps/                 # generated PNGs, one per activity (auto)
├── index.html            # the site
├── activities.json       # generated manifest (auto)
└── package.json
```

Files marked `(auto)` are generated by the sync workflow — don't edit them by hand.

---

## How it works

The sync script:
1. Loads `activities.json` to find the most recent activity timestamp
2. Refreshes the Strava access token using the long-lived refresh token
3. Fetches activities newer than the last sync, paginated
4. For each new activity with GPS, downloads a Mapbox static image of the polyline to `maps/{id}.png`
5. Appends shaped activity records to `activities.json`, sorted newest-first

The frontend just `fetch`es `activities.json`, sorts by date, and renders cards. Pace, speed, and HR formatting all happens client-side, so you can change display without re-syncing.

The deploy workflow uploads the entire repo as the Pages artifact and deploys it. No build step.

---

## License

MIT. Do whatever.

## Credits

Built on:
- [Strava API](https://developers.strava.com/)
- [Mapbox Static Images API](https://docs.mapbox.com/api/maps/static-images/)
- [GitHub Actions](https://docs.github.com/actions) and [Pages](https://docs.github.com/pages)