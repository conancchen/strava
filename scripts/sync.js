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
  console.error('Missing required env vars: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN, MAPBOX_TOKEN');
  process.exit(1);
}

const ACTIVITIES_FILE = 'activities.json';
const MAPS_DIR = 'maps';
const MAP_WIDTH = 600;
const MAP_HEIGHT = 360;

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
  return (await res.json()).access_token;
}

async function fetchActivities(accessToken, afterTimestamp) {
  const all = [];
  const perPage = 100;
  for (let page = 1; ; page++) {
    const url = new URL('https://www.strava.com/api/v3/athlete/activities');
    url.searchParams.set('per_page', perPage);
    url.searchParams.set('page', page);
    if (afterTimestamp) url.searchParams.set('after', afterTimestamp);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Activities fetch failed: ${res.status} ${await res.text()}`);
    const batch = await res.json();
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < perPage) break;
  }
  return all;
}

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

const D2R = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
const invMercY = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D2R;

// Compute a bbox containing all points, expanded to match the image aspect ratio so
// Mapbox renders exactly the area we project against (no auto-fit padding mismatch).
function computeBbox(points, width, height, padFrac = 0.08) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  let mxw = minLng * D2R, mxe = maxLng * D2R;
  let mys = mercY(minLat), myn = mercY(maxLat);
  const xPad = Math.max((mxe - mxw) * padFrac, 1e-5);
  const yPad = Math.max((myn - mys) * padFrac, 1e-5);
  mxw -= xPad; mxe += xPad; mys -= yPad; myn += yPad;
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

async function downloadMapPng(bbox, outPath) {
  const [w, s, e, n] = bbox;
  const url = `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/[${w},${s},${e},${n}]/${MAP_WIDTH}x${MAP_HEIGHT}@2x?access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox failed: ${res.status} ${await res.text()}`);
  await fs.writeFile(outPath, Buffer.from(await res.arrayBuffer()));
}

function shapeActivity(a) {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    date: a.start_date_local.slice(0, 10),
    start_date: a.start_date,
    distance_m: a.distance,
    moving_time_s: a.moving_time,
    average_speed: a.average_speed,
    average_heartrate: a.average_heartrate ?? null,
    elevation_gain_m: a.total_elevation_gain ?? 0,
    // workout_type 1 = race (run), 11 = race (ride).
    is_race: a.workout_type === 1 || a.workout_type === 11,
    has_map: Boolean(a.map?.summary_polyline),
    polyline: a.map?.summary_polyline ?? null,
  };
}

async function main() {
  await fs.mkdir(MAPS_DIR, { recursive: true });

  let existing = [];
  try {
    existing = JSON.parse(await fs.readFile(ACTIVITIES_FILE, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const existingIds = new Set(existing.map((a) => a.id));

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

  const accessToken = await getAccessToken();
  const fresh = await fetchActivities(accessToken, afterTimestamp);
  console.log(`Strava returned ${fresh.length} activities`);

  const deduped = fresh.filter((a) => !existingIds.has(a.id));
  const publicOnly = deduped.filter((a) => !a.private && a.visibility !== 'only_me');
  const skipped = deduped.length - publicOnly.length;
  if (skipped > 0) console.log(`Skipped ${skipped} private activities`);
  const newOnes = publicOnly.map(shapeActivity);
  console.log(`${newOnes.length} new activities after dedup`);

  for (const a of newOnes) {
    if (!a.has_map) continue;
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
