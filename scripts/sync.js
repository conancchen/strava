// Syncs Strava activities to local JSON + map PNGs.
// Run via GitHub Actions on a cron, or manually with `npm run sync`.

import fs from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';

const {
  STRAVA_CLIENT_ID,
  STRAVA_CLIENT_SECRET,
  STRAVA_REFRESH_TOKEN,
  MAPBOX_TOKEN,
} = process.env;

if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET || !STRAVA_REFRESH_TOKEN || !MAPBOX_TOKEN) {
  console.error('Missing required env vars. Need: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN, MAPBOX_TOKEN');
  process.exit(1);
}

const ACTIVITIES_FILE = 'activities.json';
const MAPS_DIR = 'maps';
const MAP_WIDTH = 600;
const MAP_HEIGHT = 360;

// Step 1: refresh the Strava access token using the long-lived refresh token.
async function getAccessToken() {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: STRAVA_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

// Step 2: fetch activity summaries from Strava, paginated, only newer than `after`.
async function fetchActivities(accessToken, afterTimestamp) {
  const all = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const url = new URL('https://www.strava.com/api/v3/athlete/activities');
    url.searchParams.set('per_page', perPage);
    url.searchParams.set('page', page);
    if (afterTimestamp) url.searchParams.set('after', afterTimestamp);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Activities fetch failed: ${res.status} ${await res.text()}`);
    const batch = await res.json();
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < perPage) break;
    page++;
  }
  return all;
}

// Step 3: download a Mapbox static-image PNG for a polyline.
// Mapbox accepts encoded polylines via the `path` overlay.
async function downloadMapPng(polyline, outPath) {
  // The polyline contains characters that need URL-encoding (especially backslashes).
  const encoded = encodeURIComponent(polyline);
  // path-{stroke-width}+{stroke-color}-{stroke-opacity}({encoded-polyline})
  const overlay = `path-3+f44-1(${encoded})`;
  const url = `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/${overlay}/auto/${MAP_WIDTH}x${MAP_HEIGHT}@2x?access_token=${MAPBOX_TOKEN}&padding=30`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox failed: ${res.status} ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
}

// Strava `start_date` is ISO. Convert to "YYYY-MM-DD" for display, plus keep the full ISO.
function toDateOnly(iso) {
  return iso.slice(0, 10);
}

// Reduce a Strava activity to just the fields we render.
function shapeActivity(a) {
  return {
    id: a.id,
    name: a.name,
    type: a.type, // "Run", "Ride", "TrailRun", "VirtualRide", etc.
    date: toDateOnly(a.start_date_local),
    start_date: a.start_date,
    distance_m: a.distance, // meters
    moving_time_s: a.moving_time, // seconds
    average_speed: a.average_speed, // m/s
    average_heartrate: a.average_heartrate ?? null, // bpm, may be missing
    has_map: Boolean(a.map?.summary_polyline),
    polyline: a.map?.summary_polyline ?? null,
  };
}

async function main() {
  // Make sure output dirs exist.
  await fs.mkdir(MAPS_DIR, { recursive: true });

  // Load the existing manifest, if any.
  let existing = [];
  try {
    const raw = await fs.readFile(ACTIVITIES_FILE, 'utf-8');
    existing = JSON.parse(raw);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const existingIds = new Set(existing.map((a) => a.id));

  // Find the most recent activity we already have, so we only fetch newer ones.
  // Strava's `after` is a unix epoch in seconds.
  let afterTimestamp = 0;
  if (existing.length > 0) {
    const latest = existing.reduce((acc, a) =>
      new Date(a.start_date) > new Date(acc.start_date) ? a : acc
    );
    afterTimestamp = Math.floor(new Date(latest.start_date).getTime() / 1000);
    console.log(`Fetching activities after ${latest.start_date}`);
  } else {
    console.log('No existing manifest — fetching all activities');
  }

  // Pull from Strava.
  const accessToken = await getAccessToken();
  const fresh = await fetchActivities(accessToken, afterTimestamp);
  console.log(`Strava returned ${fresh.length} activities`);

  // Filter out any duplicates (in case `after` boundary overlaps).
  const newOnes = fresh.filter((a) => !existingIds.has(a.id)).map(shapeActivity);
  console.log(`${newOnes.length} new activities after dedup`);

  // Download a map PNG for each new activity that has GPS.
  for (const a of newOnes) {
    if (!a.has_map) {
      console.log(`  skip map for ${a.id} (no GPS)`);
      continue;
    }
    const outPath = path.join(MAPS_DIR, `${a.id}.png`);
    try {
      await downloadMapPng(a.polyline, outPath);
      console.log(`  saved map ${outPath}`);
    } catch (e) {
      console.error(`  failed map for ${a.id}: ${e.message}`);
      a.has_map = false;
    }
  }

  // Strip the polyline from the manifest — it's big and we already have the PNG.
  // Keep it ONLY for activities where the map download failed, in case we want to retry later.
  for (const a of newOnes) {
    if (a.has_map) delete a.polyline;
  }

  // Merge and sort newest-first.
  const merged = [...existing, ...newOnes].sort(
    (x, y) => new Date(y.start_date) - new Date(x.start_date)
  );

  await fs.writeFile(ACTIVITIES_FILE, JSON.stringify(merged, null, 2) + '\n');
  console.log(`Wrote ${ACTIVITIES_FILE} with ${merged.length} total activities`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
