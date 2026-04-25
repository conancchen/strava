const M_PER_MI = 1609.344;
const M_PER_YD = 0.9144;

const fmtDate = (d) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }).toLowerCase();

const fmtDistance = (m) => (m / M_PER_MI).toFixed(2) + ' mi';
const fmtDistanceYds = (m) => Math.round(m / M_PER_YD).toLocaleString() + ' yds';

const fmtTime = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
};

const fmtPace = (mps) => {
  if (!mps) return '—';
  const secPerMile = M_PER_MI / mps;
  return `${Math.floor(secPerMile / 60)}:${String(Math.round(secPerMile % 60)).padStart(2, '0')} /mi`;
};

const fmtSpeed = (mps) => (mps ? (mps * 2.23694).toFixed(1) + ' mph' : '—');

const fmtSwimPace = (mps) => {
  if (!mps) return '—';
  const secPer100Yd = (100 * M_PER_YD) / mps;
  return `${Math.floor(secPer100Yd / 60)}:${String(Math.round(secPer100Yd % 60)).padStart(2, '0')} /100yd`;
};

const fmtElevation = (m) => (m == null ? '—' : Math.round(m * 3.28084).toLocaleString() + ' ft');
const fmtHr = (bpm) => Math.round(bpm) + ' bpm';

const RUN_LIKE = new Set(['Run', 'TrailRun', 'VirtualRun', 'Walk', 'Hike']);
const RIDE_LIKE = new Set([
  'Ride', 'VirtualRide', 'EBikeRide', 'EMountainBikeRide', 'GravelRide', 'MountainBikeRide',
]);

function categoryOf(type) {
  if (RUN_LIKE.has(type)) return 'run';
  if (RIDE_LIKE.has(type)) return 'bike';
  if (type === 'Swim') return 'swim';
  return 'other';
}

const labelForType = (type) =>
  type.replace(/([A-Z])/g, ' $1').trim().toLowerCase();

// Polyline overlay: must use the same Web Mercator math as sync.js so the SVG aligns with the PNG.
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

function polylineSvg(a) {
  if (!a.polyline || !a.bbox) return '';
  const points = decodePolyline(a.polyline);
  if (points.length < 2) return '';
  const [w, s, e, n] = a.bbox;
  const mxw = w * D2R, mxe = e * D2R, myn = mercY(n), mys = mercY(s);
  const d = points.map(([lat, lng], i) => {
    const x = ((lng * D2R) - mxw) / (mxe - mxw) * SVG_W;
    const y = (myn - mercY(lat)) / (myn - mys) * SVG_H;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="map-svg" viewBox="0 0 ${SVG_W} ${SVG_H}" preserveAspectRatio="none">
    <path d="${d}" fill="none" stroke="#fc4c02" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
  </svg>`;
}

function statsFor(a) {
  if (a.type === 'Swim') {
    return [
      ['yards', fmtDistanceYds(a.distance_m)],
      ['miles', fmtDistance(a.distance_m)],
      ['time', fmtTime(a.moving_time_s)],
      ['pace', fmtSwimPace(a.average_speed)],
    ];
  }
  const speedOrPace = RUN_LIKE.has(a.type)
    ? ['pace', fmtPace(a.average_speed)]
    : ['avg speed', fmtSpeed(a.average_speed)];
  const lastStat = a.average_heartrate > 0
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
  const card = document.createElement(a.is_race ? 'a' : 'div');
  card.className = a.is_race ? 'card race' : 'card';
  card.style.viewTransitionName = `card-${a.id}`;
  if (a.is_race) {
    card.href = `https://www.strava.com/activities/${a.id}`;
    card.target = '_blank';
    card.rel = 'noopener';
  }

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

  const titleHtml = a.is_race
    ? `<p class="title">${escapeHtml(a.name ?? '')} <span class="race-badge">race</span></p>`
    : '';

  card.innerHTML = `
    ${map}
    <div class="body">
      ${titleHtml}
      <p class="meta">${fmtDate(a.date)} · ${labelForType(a.type)}${a.location ? ` · ${escapeHtml(a.location)}` : ''}</p>
      <div class="stats">${statHtml}
      </div>
    </div>
  `;
  return card;
}

function escapeHtml(s) {
  return s.replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

let allActivities = [];
let racesOnly = false;

function applyFilters() {
  const filtered = racesOnly ? allActivities.filter((a) => a.is_race) : allActivities;
  const grid = document.getElementById('grid');
  const update = () => {
    grid.innerHTML = '';
    if (filtered.length === 0) {
      grid.innerHTML = '<p class="empty-state">no races yet</p>';
      return;
    }
    const frag = document.createDocumentFragment();
    for (const a of filtered) frag.appendChild(renderCard(a));
    grid.appendChild(frag);
  };
  if (document.startViewTransition) {
    document.startViewTransition(update);
  } else {
    update();
  }
}

function wireControls() {
  const input = document.getElementById('races-toggle');
  input.addEventListener('change', () => {
    racesOnly = input.checked;
    applyFilters();
  });
}

async function load() {
  const grid = document.getElementById('grid');
  try {
    const res = await fetch('./activities.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    allActivities = await res.json();
    if (allActivities.length === 0) {
      grid.innerHTML = '<p class="empty-state">no activities synced yet</p>';
      return;
    }
    wireControls();
    applyFilters();
  } catch (e) {
    grid.innerHTML = '<p class="empty-state">no activities synced yet</p>';
  }
}

load();
