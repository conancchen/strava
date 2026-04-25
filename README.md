# training log

Personal Strava activity log. Static site, syncs from the Strava API every 6 hours via GitHub Actions, deploys to GitHub Pages.

Live at: https://conancchen.github.io/strava/

## Stack
- Strava API for activity data
- Mapbox Static Images API for map PNGs
- Plain HTML/CSS/JS, no framework
- GitHub Actions for sync + deploy
- GitHub Pages for hosting

## Required secrets
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `STRAVA_REFRESH_TOKEN`
- `MAPBOX_TOKEN`

## Manual sync
Go to the Actions tab and run the "sync" workflow.
