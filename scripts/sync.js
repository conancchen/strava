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

// Decode Google's encoded-polyline format (used by Strava + Mapbox) into [lat, lng] points.
function decodePolyline(str) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    let shift = 0, result = 0, b;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push([lat * 1e-5, lng * 1e-5]);
  }
  return points;
}

// Web Mercator helpers; mercY is the standard projection of latitude.
const D2R = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
const invMercY = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D2R;

// Compute a bbox that contains all points, expanded to match the image's aspect ratio
// (so Mapbox renders exactly the area we project against, with no auto-fit padding mismatch).
function computeBbox(points, width, height, padFrac = 0.08) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  // Convert to mercator units so padding/aspect math is in the same projection as the rendered image.
  let mxw = minLng * D2R, mxe = maxLng * D2R;
  let mys = mercY(minLat), myn = mercY(maxLat);
  // Pad equally on all 4 sides (in mercator units).
  const xExt = mxe - mxw, yExt = myn - mys;
  const xPad = Math.max(xExt * padFrac, 1e-5);
  const yPad = Math.max(yExt * padFrac, 1e-5);
  mxw -= xPad; mxe += xPad; mys -= yPad; myn += yPad;
  // Adjust to image aspect ratio so mapbox renders the bbox exactly without extra fit.
  const targetAspect = width / height;
  const curAspect = (mxe - mxw) / (myn - mys);
  if (curAspect > targetAspect) {
    const newY = (mxe - mxw) / targetAspect;
    const cy = (mys + myn) / 2;
    mys = cy - newY / 2; myn = cy + newY / 2;
  } else {
    const newX = (myn - mys) * targetAspect;
    const cx = (mxw + mxe) / 2;
    mxw = cx - newX / 2; mxe = cx + newX / 2;
  }
  return [mxw / D2R, invMercY(mys), mxe / D2R, invMercY(myn)];
}

// Download a static map PNG for the given bbox — no polyline overlay; the browser draws that on top.
async function downloadMapPng(bbox, outPath) {
  const [w, s, e, n] = bbox;
  const url = `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/[${w},${s},${e},${n}]/${MAP_WIDTH}x${MAP_HEIGHT}@2x?access_token=${MAPBOX_TOKEN}`;
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
    elevation_gain_m: a.total_elevation_gain ?? 0, // meters
    // Strava workout_type: 1 = race (run), 11 = race (ride). All others are non-race.
    is_race: a.workout_type === 1 || a.workout_type === 11,
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

  // Filter out any duplicates (in case `after` boundary overlaps), and skip private activities.
  const deduped = fresh.filter((a) => !existingIds.has(a.id));
  const publicOnly = deduped.filter((a) => !a.private && a.visibility !== 'only_me');
  const skippedPrivate = deduped.length - publicOnly.length;
  if (skippedPrivate > 0) console.log(`Skipped ${skippedPrivate} private activities`);
  const newOnes = publicOnly.map(shapeActivity);
  console.log(`${newOnes.length} new activities after dedup`);

  // Download a map PNG for each new activity that has GPS, and save the bbox so the
  // browser can project the polyline as an SVG overlay using the same extent.
  for (const a of newOnes) {
    if (!a.has_map) {
      console.log(`  skip map for ${a.id} (no GPS)`);
      continue;
    }
    const points = decodePolyline(a.polyline);
    if (points.length < 2) {
      a.has_map = false;
      continue;
    }
    a.bbox = computeBbox(points, MAP_WIDTH, MAP_HEIGHT);
    const outPath = path.join(MAPS_DIR, `${a.id}.png`);
    try {
      await downloadMapPng(a.bbox, outPath);
      console.log(`  saved map ${outPath}`);
    } catch (e) {
      console.error(`  failed map for ${a.id}: ${e.message}`);
      a.has_map = false;
    }
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
