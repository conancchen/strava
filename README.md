# minimalist personal training log

Pulls from Strava every 6 hours and displays in minimalist grid. 

Check it out at https://conancchen.github.io/strava/.

Features
- Shows activity map, distance, time, pace, and heart rate or elevation.
- Skips activities that are private on Strava
- Can filter races

## Setup if you want your own

1. Fork the repo.

2. Make a Strava API app at https://www.strava.com/settings/api. Callback domain `localhost`. Save the Client ID and Secret.

3. Get a refresh token. Open this in a browser, replacing the ID:

   ```
   https://www.strava.com/oauth/authorize?client_id=YOUR_ID&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=read,activity:read_all
   ```

   After approving, Strava redirects to a broken `localhost` URL. Copy the `code` query param, then within ~10 minutes:

   ```
   curl -X POST https://www.strava.com/oauth/token -F client_id=YOUR_ID -F client_secret=YOUR_SECRET -F code=YOUR_CODE -F grant_type=authorization_code
   ```

   The response JSON has a `refresh_token`. Save it.

4. Set up a free Mapbox account at https://account.mapbox.com. Grab the default public token (starts with `pk.`).

5. In your fork, Settings → Secrets and variables → Actions, add: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`, `MAPBOX_TOKEN`.

6. Settings → Actions → General → Workflow permissions → Read and write. Then Settings → Pages → Source → GitHub Actions.

7. Actions tab → sync → Run workflow. First run backfills everything; later runs are incremental.

If the sync 401s with `activity:read_permission missing`, the refresh token doesn't have the right scope. Redo step 3 with the URL above (it includes `activity:read_all`).

## Layout

- `index.html`, `style.css`, `app.js` — the page
- `scripts/sync.js` — Strava + Mapbox sync
- `.github/workflows/{sync,deploy}.yml` — cron + Pages deploy
- `activities.json`, `maps/*.png` — generated; don't edit

## Notes

GitHub Actions runs the sync (`scripts/sync.js`) and Pages serves the result. Maps come from Mapbox.

Shoutout Claude.

## License

MIT.
