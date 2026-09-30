// Renders activities.json as a log that matches the main site: months in a
// gutter on the left, activities beside them, each one opening to its map and
// splits when pressed.
const M_PER_MI = 1609.344;
const M_PER_YD = 0.9144;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

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

// Rows are labelled by what the activity was, not by whatever it got called
// on Strava
const TYPE_NAMES = {
  Run: 'Run', TrailRun: 'Trail run', VirtualRun: 'Run', Treadmill: 'Run',
  Ride: 'Bike', VirtualRide: 'Bike', EBikeRide: 'Bike', GravelRide: 'Bike',
  MountainBikeRide: 'Bike', EMountainBikeRide: 'Bike',
  Swim: 'Swim', Hike: 'Hike', Walk: 'Walk', Rowing: 'Row', Canoeing: 'Canoe',
  WeightTraining: 'Lift', Workout: 'Workout', Elliptical: 'Elliptical',
  StairStepper: 'Stairs', Yoga: 'Yoga',
};

// Which of the three icons an activity answers to
function sportOf(type) {
  if (RUN_LIKE.has(type)) return 'run';
  if (RIDE_LIKE.has(type)) return 'bike';
  if (type === 'Swim') return 'swim';
  return 'other';
}

const labelForType = (type) =>
  TYPE_NAMES[type] || type.replace(/([A-Z])/g, ' $1').trim();

// What goes on the right of a collapsed row: the one number that says most
// about the activity
function headline(a) {
  if (a.type === 'Swim') return fmtDistanceYds(a.distance_m);
  if (a.distance_m > 0) return fmtDistance(a.distance_m);
  return fmtTime(a.moving_time_s);
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
  if (!a.distance_m) {
    const only = [['time', fmtTime(a.moving_time_s)]];
    if (a.average_heartrate > 0) only.push(['avg hr', fmtHr(a.average_heartrate)]);
    return only;
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

// Polyline overlay: must use the same Web Mercator math as sync.js so the SVG
// lines up with the PNG underneath it
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

// The route is drawn twice — a pale casing under a dark line — so it reads on
// a light map and a dimmed one alike
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
  const line = (stroke, width) =>
    `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />`;
  return `<svg class="map-svg" viewBox="0 0 ${SVG_W} ${SVG_H}" preserveAspectRatio="none">
      ${line('rgba(255,255,255,0.9)', 4)}${line('#15150f', 2)}
    </svg>`;
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function entryHtml(a) {
  const when = new Date(a.date + 'T00:00:00');
  const day = when.getDate();
  const mark = a.is_race ? '<span class="race-mark">race</span>' : '';
  const fullDate = when.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const map = a.has_map
    ? `<div class="map-wrap">
        <img class="map" src="./maps/${a.id}.png" alt="" loading="lazy" />
        ${polylineSvg(a)}
      </div>`
    : '<p class="no-map">no gps</p>';

  const stats = statsFor(a).map(([label, value]) => `
        <div>
          <p class="stat-label">${label}</p>
          <p class="stat-value">${value}</p>
        </div>`).join('');

  const where = a.location ? ` · ${escapeHtml(a.location)}` : '';
  // A race goes by its name; everything else by what it was and where
  const label = a.is_race ? escapeHtml(a.name ?? '') : labelForType(a.type) + where;
  // Races are the ones worth looking up; everything else stays on the page
  const strava = a.is_race
    ? ` · <a href="https://www.strava.com/activities/${a.id}" target="_blank" rel="noopener">on strava</a>`
    : '';

  return `<details class="entry${a.is_race ? ' is-race' : ''}">
      <summary>
        <span class="day">${day}</span>
        <span class="name">${label}${mark}</span>
        <span class="amount">${headline(a)}</span>
      </summary>
      <div class="detail">
        ${map}
        <p class="meta">${fullDate}${a.is_race ? where : ''}${strava}</p>
        <div class="stats">${stats}
        </div>
      </div>
    </details>`;
}

// Mileage over time: one line per sport on one chart. One axis, one unit —
// swim is converted from yards so the three can share it honestly. Pick a year
// and the buckets are its months; otherwise they are the years themselves.
//
// Colours are the red / green / blue slots of the data-viz reference palette,
// run through its validator against both surfaces. Red against green is the
// pair colour-blind readers struggle with, so each line also carries its own
// dash pattern, which the legend shows — identity never rests on colour alone.
const CHART_W = 600, CHART_H = 112, PAD_X = 2, PAD_T = 9, PAD_B = 16;

const SPORTS = ['run', 'bike', 'swim'];

const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                    'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function renderStats(activities, year) {
  const box = document.getElementById('stats');

  // Months of the chosen year, or every year the log covers
  const labels = year
    ? MONTH_ABBR
    : [...new Set(all.map((a) => a.date.slice(0, 4)))].sort();
  const slot = year
    ? (a) => +a.date.slice(5, 7) - 1
    : (a) => labels.indexOf(a.date.slice(0, 4));

  const miles = {};
  for (const a of activities) {
    const sp = sportOf(a.type);
    const i = slot(a);
    if (!SPORTS.includes(sp) || i < 0) continue;
    (miles[sp] = miles[sp] || new Array(labels.length).fill(0))[i] += a.distance_m / M_PER_MI;
  }

  const shown = SPORTS.filter((sp) => miles[sp] && miles[sp].some((v) => v > 0));
  if (!shown.length) { box.innerHTML = ''; return; }

  const last = labels.length - 1;
  const max = Math.max(...shown.flatMap((sp) => miles[sp]));
  const x = (i) => PAD_X + (last ? i / last : 0) * (CHART_W - PAD_X * 2);
  const y = (v) => CHART_H - PAD_B - (max ? v / max : 0) * (CHART_H - PAD_B - PAD_T);

  const lines = shown.map((sp) => {
    const d = miles[sp].map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    return `<path class="line line-${sp}" d="${d}" vector-effect="non-scaling-stroke" />`;
  }).join('');

  const dots = shown.map((sp) =>
    `<circle class="cursor-dot dot-${sp}" r="3.5" cx="-99" cy="-99" vector-effect="non-scaling-stroke" />`).join('');

  const legend = shown.map((sp) => {
    const total = Math.round(miles[sp].reduce((a, b) => a + b, 0)).toLocaleString();
    return `<span class="key key-${sp}" data-total="${total} mi">
        <svg class="key-line" width="16" height="8" aria-hidden="true"><path d="M0,4 H16" vector-effect="non-scaling-stroke" /></svg>${sp}
        <span class="key-value">${total} mi</span>
      </span>`;
  }).join('');

  // Every year fits along the axis; twelve months would crowd it, so those get
  // their ends labelled and the rest read out on hover
  const ticks = (year ? [labels[0], labels[last]] : labels)
    .map((t) => `<span>${t}</span>`).join('');

  box.innerHTML = `
    <div class="chart-keys">${legend}</div>
    <div class="chart-plot">
      <svg class="chart" viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none" aria-hidden="true">
        <path class="axis axis-top" d="M0,${y(max).toFixed(1)} H${CHART_W}" vector-effect="non-scaling-stroke" />
        <path class="axis" d="M0,${y(0).toFixed(1)} H${CHART_W}" vector-effect="non-scaling-stroke" />
        <path class="cursor" d="M0,${PAD_T} V${CHART_H - PAD_B}" vector-effect="non-scaling-stroke" />
        ${lines}${dots}
      </svg>
      <span class="chart-max">${Math.round(max).toLocaleString()} mi</span>
      <div class="chart-ticks">${ticks}</div>
    </div>`;

  wireChart(box, shown, miles, labels, x, y);
}

// Running the pointer across the chart marks a bucket and swaps every total in
// the legend for that bucket's figure
function wireChart(box, shown, miles, labels, x, y) {
  const plot = box.querySelector('.chart-plot');
  const svg = box.querySelector('.chart');
  const cursor = box.querySelector('.cursor');
  const last = labels.length - 1;

  plot.addEventListener('pointermove', (e) => {
    const rect = plot.getBoundingClientRect();
    const i = Math.max(0, Math.min(last, Math.round(((e.clientX - rect.left) / rect.width) * last)));
    cursor.setAttribute('d', `M${x(i).toFixed(1)},${PAD_T} V${CHART_H - PAD_B}`);
    shown.forEach((sp) => {
      const dot = svg.querySelector('.dot-' + sp);
      dot.setAttribute('cx', x(i).toFixed(1));
      dot.setAttribute('cy', y(miles[sp][i]).toFixed(1));
      box.querySelector(`.key-${sp} .key-value`).textContent =
        `${labels[i]} · ${Math.round(miles[sp][i]).toLocaleString()} mi`;
    });
    svg.classList.add('is-hovered');
  });

  plot.addEventListener('pointerleave', () => {
    svg.classList.remove('is-hovered');
    shown.forEach((sp) => {
      const key = box.querySelector('.key-' + sp);
      key.querySelector('.key-value').textContent = key.dataset.total;
    });
  });
}

function render(activities) {
  const log = document.getElementById('log');
  if (!activities.length) {
    log.innerHTML = '<p class="meta">nothing here yet</p>';
    log.classList.add('is-in');
    return;
  }

  const months = [];
  for (const a of activities) {
    const key = a.date.slice(0, 7);
    if (!months.length || months[months.length - 1].key !== key) {
      const [y, m] = key.split('-');
      months.push({ key, name: `${MONTHS[+m - 1]} ${y}`, items: [] });
    }
    months[months.length - 1].items.push(a);
  }

  log.innerHTML = months.map((month) => `<div class="month">
      <span class="month-name">${month.name}</span>
      <div class="month-entries">${month.items.map(entryHtml).join('')}</div>
    </div>`).join('');
  log.classList.add('is-in');
}

let all = [];
let scope = 'all';   // 'all' or 'races'
let year = null;     // null for every year
let sport = null;    // null for every sport

function apply() {
  const shown = all.filter((a) =>
    (scope === 'all' || a.is_race) &&
    (year === null || a.date.startsWith(year)) &&
    (sport === null || sportOf(a.type) === sport));
  renderStats(shown, year);
  render(shown);
}

// One button per year the log covers, newest first, beside the scope buttons
function buildFilters() {
  const bar = document.querySelector('.filters');
  const years = [...new Set(all.map((a) => a.date.slice(0, 4)))].sort().reverse();
  bar.insertAdjacentHTML('beforeend',
    '<span class="filter-gap" aria-hidden="true"></span>' +
    years.map((y) => `<button type="button" class="filter" data-year="${y}">${y}</button>`).join(''));

  bar.addEventListener('click', (e) => {
    const button = e.target.closest('.filter');
    if (!button) return;
    if (button.dataset.sport) {
      // pressing the sport that is already on clears it
      sport = button.classList.contains('is-on') ? null : button.dataset.sport;
      bar.querySelectorAll('[data-sport]').forEach((b) =>
        b.classList.toggle('is-on', b.dataset.sport === sport));
    } else if (button.dataset.year) {
      // pressing the year that is already on clears it
      year = button.classList.contains('is-on') ? null : button.dataset.year;
      bar.querySelectorAll('[data-year]').forEach((b) =>
        b.classList.toggle('is-on', b.dataset.year === year));
    } else {
      scope = button.dataset.filter;
      bar.querySelectorAll('[data-filter]').forEach((b) =>
        b.classList.toggle('is-on', b === button));
    }
    apply();
  });
}

async function load() {
  const log = document.getElementById('log');
  const footnote = document.getElementById('footnote');
  try {
    const res = await fetch('./activities.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    all = await res.json();
    all.sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
    apply();
    buildFilters();
    const day = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const latest = all[0] && day(new Date(all[0].date + 'T00:00:00'));
    footnote.textContent = `${all.length.toLocaleString()} activities, last on ${latest}`;
  } catch (e) {
    log.innerHTML = '<p class="meta">no activities synced yet</p>';
    log.classList.add('is-in');
  }
}

load();
