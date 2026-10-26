/* Assignment settings: edit these values to choose a palette, year, or mode. */
const assignmentSettings = {
  palette: ['#eff3ff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c'],
  year: 2020,
  mode: 'exact' // 'exact': only this release year; 'since': this year and later.
};

window.renderAssignments = function ({records, features, originalColors}) {
  const thresholds = [3, 12, 35, 90];
  const zeroColor = '#e8e2df';
  const labels = ['>0 – <3', '3 – <12', '12 – <35', '35 – <90', '90+', '0 records'];
  const $ = selector => document.querySelector(selector);
  const fmt = d3.format(',');
  const names = new Set(features.map(f => f.properties.name));
  const totalArea = d3.sum(features, f => f.properties.area_km2);
  function aggregate(rows) {
    const grouped = d3.group(rows, r => r.neighborhood);
    return new Map(features.map(f => {
      const name = f.properties.name, count = (grouped.get(name) || []).length;
      return [name, {name, count, density: count / f.properties.area_km2}];
    }));
  }
  const baseline = aggregate(records);
  const baselineCount = d3.sum([...baseline.values()], s => s.count);
  const projection = d3.geoMercator().fitExtent([[18, 15], [582, 515]], {type: 'FeatureCollection', features});
  const path = d3.geoPath(projection);
  const yearSelect = $('#task-year'), modeSelect = $('#task-mode');
  const years = [...new Set(records.map(r => r.year).filter(y => y !== null))].sort((a, b) => b - a);
  years.forEach(year => yearSelect.add(new Option(String(year), String(year))));
  yearSelect.value = String(years.includes(assignmentSettings.year) ? assignmentSettings.year : years[0]);
  modeSelect.value = assignmentSettings.mode;

  function legend(id, palette) {
    d3.select(id).selectAll('div').data([...palette, zeroColor]).join('div').attr('class', 'key')
      .each(function (color, i) {
        this.replaceChildren();
        const swatch = document.createElement('i'); swatch.style.background = color;
        const label = document.createElement('span'); label.textContent = labels[i];
        this.append(swatch, label);
      });
  }
  legend('#recolor-legend', assignmentSettings.palette);
  legend('#time-legend', originalColors);
  d3.select('#recolor-swatches').selectAll('div').data(assignmentSettings.palette).join('div').each(function (color) {
    this.replaceChildren(); const swatch = document.createElement('i'); swatch.style.background = color;
    const label = document.createElement('code'); label.textContent = color; this.append(swatch, label);
  });
  function createMap(id, palette, tipId, compare) {
    const svg = d3.select(id).attr('viewBox', '0 0 600 540').attr('role', 'group');
    const scale = d3.scaleThreshold(thresholds, palette);
    const paths = svg.selectAll('path').data(features, f => f.properties.name).join('path')
      .attr('d', path).attr('class', 'neighborhood').attr('tabindex', 0).attr('role', 'button');
    const label = svg.append('text').attr('class', 'variation-map-label').attr('x', 20).attr('y', 526).text('SAN FRANCISCO · 41 NEIGHBORHOODS');
    return function paint(stats) {
      function inspect(event, f) {
        const s = stats.get(f.properties.name), base = baseline.get(s.name);
        $(tipId).textContent = `${s.name}: ${fmt(s.count)} records, ${s.density.toFixed(2)} records / km².` +
          (compare ? ` All years: ${fmt(base.count)} records, ${base.density.toFixed(2)} records / km².` : ' Values match the original all-year map.');
        paths.classed('inspected', item => item === f);
      }
      paths.attr('fill', f => {const s = stats.get(f.properties.name); return s.count === 0 ? zeroColor : scale(s.density);})
        .attr('aria-label', f => { const s = stats.get(f.properties.name); return `${s.name}: ${s.count} records, ${s.density.toFixed(2)} records per square kilometre`; })
        .on('pointerenter focus click', inspect)
        .on('keydown', (event, f) => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); inspect(event, f);}});
      paths.classed('inspected', false);
      // Keep a native SVG tooltip as an additional pointer aid.
      paths.selectAll('title').data(f => [stats.get(f.properties.name)]).join('title')
        .text(s => `${s.name}\n${s.count} records\n${s.density.toFixed(2)} records / km²`);
      label.raise();
    };
  }
  const paintRecolor = createMap('#recolor-map', assignmentSettings.palette, '#recolor-tip', false);
  const paintTime = createMap('#time-map', originalColors, '#time-tip', true);
  paintRecolor(baseline);
  $('#recolor-summary').textContent = `All years: ${fmt(records.length)} records; ${fmt(baselineCount)} assigned to neighborhoods, ${fmt(records.length - baselineCount)} unassigned.`;
  $('#recolor-observation').textContent = `Same records, different colors: the neighborhood total remains ${fmt(baselineCount)}. Areas, densities, and thresholds are unchanged. The map and legend share the five-class blue palette. Filters on the original map do not affect this all-year baseline.`;
  function updateTime() {
    const year = +yearSelect.value, mode = modeSelect.value;
    const rows = records.filter(r => r.year !== null && (mode === 'exact' ? r.year === year : r.year >= year));
    const stats = aggregate(rows), assigned = d3.sum([...stats.values()], s => s.count);
    const active = [...stats.values()].filter(s => s.count > 0).length;
    const range = mode === 'exact' ? `${year} only` : `${year} and later`;
    paintTime(stats);
    $('#time-tip').textContent = 'Hover, focus, or click a neighborhood to compare original and filtered values.';
    $('#time-summary').textContent = `${range}: ${fmt(rows.length)} records; ${fmt(assigned)} assigned, ${fmt(rows.length - assigned)} unassigned. ${active} of 41 neighborhoods have records.`;
    const highest = [...stats.values()].sort((a, b) => b.density - a.density)[0];
    $('#time-observation').textContent = `All years: ${fmt(baselineCount)} neighborhood records → ${range}: ${fmt(assigned)}. Overall density changes from ${(baselineCount / totalArea).toFixed(2)} to ${(assigned / totalArea).toFixed(2)} records / km² (total records ÷ total area).` +
      (assigned ? ` The highest filtered density is in ${highest.name}: ${highest.density.toFixed(2)} records / km².` : ' No records can be assigned to neighborhoods for this filter.') +
      ' The original palette, neighborhood areas, and class thresholds are retained for direct color comparison.';
    $('#comparison-caption').textContent = `All years vs. ${range} · Density: records / km²`;
    d3.select('#comparison-body').selectAll('tr').data([...stats.values()].sort((a, b) => b.density - a.density || a.name.localeCompare(b.name)), s => s.name)
      .join('tr').each(function (s) {
        this.replaceChildren();
        const base = baseline.get(s.name);
        [s.name, fmt(base.count), base.density.toFixed(2), fmt(s.count), s.density.toFixed(2)].forEach((value, i) => {
          const cell = document.createElement(i ? 'td' : 'th');
          if (!i) cell.scope = 'row'; cell.textContent = value; this.append(cell);
        });
      });
  }
  yearSelect.addEventListener('change', updateTime);
  modeSelect.addEventListener('change', updateTime);
  updateTime();
};
