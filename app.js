// ---- formatting helpers (imperial) ----
const M_PER_MI = 1609.344;

const fmtDate = (d) => {
  // d is "YYYY-MM-DD"
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).toLowerCase();
};

const fmtDistance = (m) => (m / M_PER_MI).toFixed(2) + ' mi';

const fmtTime = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
};

// For runs: pace as min/mi (mm:ss)
const fmtPace = (mps) => {
  if (!mps) return '—';
  const secPerMile = M_PER_MI / mps;
  const m = Math.floor(secPerMile / 60);
  const s = Math.round(secPerMile % 60);
  return `${m}:${String(s).padStart(2, '0')} /mi`;
};

// For rides: speed as mph
const fmtSpeed = (mps) => {
  if (!mps) return '—';
  return (mps * 2.23694).toFixed(1) + ' mph';
};

const fmtElevation = (m) => (m == null ? '—' : Math.round(m * 3.28084).toLocaleString() + ' ft');

const fmtHr = (bpm) => Math.round(bpm) + ' bpm';

// Swim helpers: yards distance and pace per 100 yards.
const M_PER_YD = 0.9144;
const fmtDistanceYds = (m) => Math.round(m / M_PER_YD).toLocaleString() + ' yds';
const fmtSwimPace = (mps) => {
  if (!mps) return '—';
  const secPer100Yd = (100 * M_PER_YD) / mps;
  const min = Math.floor(secPer100Yd / 60);
  const sec = Math.round(secPer100Yd % 60);
  return `${min}:${String(sec).padStart(2, '0')} /100yd`;
};

// Strava activity types — group into "run-like" vs "ride-like" for unit selection.
const RUN_LIKE = new Set(['Run', 'TrailRun', 'VirtualRun', 'Walk', 'Hike']);
const RIDE_LIKE = new Set([
  'Ride', 'VirtualRide', 'EBikeRide', 'EMountainBikeRide', 'GravelRide', 'MountainBikeRide',
]);

const labelForType = (type) => {
  // Lowercase, drop "Virtual" prefix etc. for cleanliness.
  return type.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
};

// ---- polyline overlay (must use the same Web Mercator math as sync.js) ----
const D2R = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));

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

const SVG_W = 600, SVG_H = 360;

function project(lat, lng, bbox) {
  // bbox = [west, south, east, north]
  const mxw = bbox[0] * D2R, mxe = bbox[2] * D2R;
  const myn = mercY(bbox[3]), mys = mercY(bbox[1]);
  const x = ((lng * D2R) - mxw) / (mxe - mxw) * SVG_W;
  const y = (myn - mercY(lat)) / (myn - mys) * SVG_H;
  return [x, y];
}

function polylineSvg(a) {
  if (!a.polyline || !a.bbox) return '';
  const points = decodePolyline(a.polyline);
  if (points.length < 2) return '';
  const d = points.map(([lat, lng], i) => {
    const [x, y] = project(lat, lng, a.bbox);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="map-svg" viewBox="0 0 ${SVG_W} ${SVG_H}" preserveAspectRatio="none">
    <path d="${d}" fill="none" stroke="#fc4c02" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
  </svg>`;
}

// ---- render ----
function statsFor(a) {
  if (a.type === 'Swim') {
    return [
      ['yards', fmtDistanceYds(a.distance_m)],
      ['miles', fmtDistance(a.distance_m)],
      ['time', fmtTime(a.moving_time_s)],
      ['pace', fmtSwimPace(a.average_speed)],
    ];
  }
  const isRun = RUN_LIKE.has(a.type);
  const speedOrPace = isRun
    ? ['pace', fmtPace(a.average_speed)]
    : ['avg speed', fmtSpeed(a.average_speed)];
  const hasHr = a.average_heartrate != null && a.average_heartrate > 0;
  const lastStat = hasHr
    ? ['avg hr', fmtHr(a.average_heartrate)]
    : ['elevation', fmtElevation(a.elevation_gain_m)];
  return [
    ['distance', fmtDistance(a.distance_m)],
    ['time', fmtTime(a.moving_time_s)],
    speedOrPace,
    lastStat,
  ];
}

function renderCard(a) {
  const card = document.createElement('a');
  card.className = a.is_race ? 'card race' : 'card';
  card.href = `https://www.strava.com/activities/${a.id}`;
  card.target = '_blank';
  card.rel = 'noopener';

  const map = a.has_map
    ? `<div class="map-wrap">
         <img class="map" src="./maps/${a.id}.png" alt="" loading="lazy" />
         ${polylineSvg(a)}
       </div>`
    : `<div class="map empty">no gps</div>`;

  const statHtml = statsFor(a)
    .map(([label, value]) => `
        <div>
          <p class="stat-label">${label}</p>
          <p class="stat-value">${value}</p>
        </div>`)
    .join('');

  const safeName = (a.name ?? '').replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  })[c]);

  card.innerHTML = `
    ${map}
    <div class="body">
      <p class="title">${safeName}${a.is_race ? ' <span class="race-badge">race</span>' : ''}</p>
      <p class="meta">${fmtDate(a.date)} · ${labelForType(a.type)}</p>
      <div class="stats">${statHtml}
      </div>
    </div>
  `;
  return card;
}

async function load() {
  const grid = document.getElementById('grid');
  try {
    const res = await fetch('./activities.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    const activities = await res.json();
    if (activities.length === 0) {
      grid.innerHTML = '<p class="empty-state">no activities synced yet</p>';
      return;
    }
    for (const a of activities) {
      grid.appendChild(renderCard(a));
    }
  } catch (e) {
    grid.innerHTML = '<p class="empty-state">no activities synced yet</p>';
  }
}

load();
