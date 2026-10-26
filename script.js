// Page tabs are independent of the map data loading.
(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function activate(tab) {
    tabs.forEach(item => {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
    });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault(); activate(tabs[next]); tabs[next].focus();
    });
  });
})();

/* Local D3 v7 choropleth. Source rows are deduplicated across all CSV columns. */
(async function () {
  const $ = s => document.querySelector(s);
  const colors = ['#fbe4c5', '#efb88c', '#d9836e', '#b65361', '#75364e'];
  const color = d3.scaleThreshold([3, 12, 35, 90], colors);
  const number = d3.format(',');
  const svg = d3.select('#map');
  const stage = $('#stage');
  let selected = null, filtered, stats, shapes, projection, path;
  function textElement(tag, text, parent) {
    const el = document.createElement(tag); el.textContent = text; parent.append(el); return el;
  }
  try {
    const [raw, geo, streets] = await Promise.all([
      d3.csv('Film_Locations_in_San_Francisco_20261026.csv'),
      d3.json('neighborhoods.geojson'), d3.json('streets.geojson')
    ]);
    const features = geo.features.map(f => {
      // D3 uses clockwise exterior rings for small spherical polygons.
      if (d3.geoArea(f) > 2 * Math.PI) {
        const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        polygons.forEach(p => p.forEach(r => r.reverse()));
      }
      return f;
    });
    const names = new Set(features.map(f => f.properties.name));
    const seen = new Set();
    const records = raw.filter(r => {
      const key = JSON.stringify(raw.columns.map(c => r[c]));
      if (seen.has(key)) return false; seen.add(key); return true;
    }).map(r => {
      const year = /^\d{4}$/.test(r['Release Year']) ? +r['Release Year'] : null;
      let neighborhood = r['Analysis Neighborhood'].trim();
      if (!names.has(neighborhood) && r.Longitude && r.Latitude) {
        const point = [+r.Longitude, +r.Latitude];
        if (point.every(Number.isFinite)) {
          const hits = features.filter(f => d3.geoContains(f, point));
          if (hits.length === 1) neighborhood = hits[0].properties.name;
        }
      }
      return {...r, year, neighborhood, workKey: r.Title.trim().replace(/\s+/g, ' ').toLowerCase() + '|' + year};
    });
    window.renderAssignments({records, features, originalColors: colors});
    const years = records.map(r => r.year).filter(y => y !== null);
    for (let decade = Math.floor(d3.min(years) / 10) * 10; decade <= d3.max(years); decade += 10) {
      const option = new Option(`${decade}–${decade + 9}`, decade); $('#years').add(option);
    }
    const labels = ['>0 – <3', '3 – <12', '12 – <35', '35 – <90', '90+', '0 records'];
    [...colors, '#e8e2df'].forEach((c, i) => {
      const key = textElement('div', '', $('#legend')); key.className = 'key';
      const swatch = textElement('i', '', key); swatch.style.background = c; textElement('span', labels[i], key);
    });
    const group = svg.append('g');
    const neighborhoodLayer = group.append('g');
    const roadLayer = group.append('path').datum(streets).attr('class', 'roads');
    const labelLayer = group.append('g');
    const zoom = d3.zoom().scaleExtent([1, 7]).on('zoom', e => {
      group.attr('transform', e.transform); $('#tooltip').hidden = true;
    });
    svg.call(zoom).on('dblclick.zoom', null);
    $('#plus').onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1.4);
    $('#minus').onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.4);
    $('#reset').onclick = () => svg.transition().duration(250).call(zoom.transform, d3.zoomIdentity);
    $('#texture').onchange = e => roadLayer.attr('display', e.target.checked ? null : 'none');
    $('#clear').onclick = () => { selected = null; updateSelection(); };
    $('#years').onchange = update;
    function select(name) { selected = name; updateSelection(); }
    function tooltip(event, feature) {
      const s = stats.get(feature.properties.name), tip = $('#tooltip');
      tip.replaceChildren(); textElement('strong', s.name, tip);
      textElement('div', `${number(s.count)} records · ${s.works} titles`, tip);
      textElement('div', `${s.density.toFixed(1)} records / km²`, tip);
      tip.hidden = false;
      const box = stage.getBoundingClientRect();
      const p = event.type === 'focus' ? path.centroid(feature) : [event.clientX - box.left, event.clientY - box.top];
      tip.style.left = Math.max(8, Math.min(box.width - tip.offsetWidth - 8, p[0] + 14)) + 'px';
      tip.style.top = Math.max(8, Math.min(box.height - tip.offsetHeight - 8, p[1] + 14)) + 'px';
    }
    function draw() {
      const w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      svg.attr('viewBox', `0 0 ${w} ${h}`);
      projection = d3.geoMercator().fitExtent([[35, 28], [w - 35, h - 40]], {type: 'FeatureCollection', features});
      path = d3.geoPath(projection);
      shapes = neighborhoodLayer.selectAll('path').data(features).join('path')
        .attr('class', 'neighborhood').attr('d', path).attr('tabindex', 0).attr('role', 'button')
        .on('pointerenter pointermove focus', tooltip)
        .on('pointerleave blur', () => { $('#tooltip').hidden = true; })
        .on('click', (e, f) => select(f.properties.name))
        .on('keydown', (e, f) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(f.properties.name); } });
      roadLayer.attr('d', path);
      const labelNames = new Set(['Presidio', 'Golden Gate Park', 'Sunset/Parkside', 'Mission', 'Bayview Hunters Point', 'North Beach', 'Treasure Island', 'Twin Peaks']);
      labelLayer.selectAll('text').data(features.filter(f => labelNames.has(f.properties.name))).join('text')
        .attr('class', 'map-label').attr('transform', f => `translate(${projection([f.properties.label_lon, f.properties.label_lat])})`)
        .text(f => f.properties.name);
      svg.call(zoom.transform, d3.zoomIdentity); update();
    }
    function update() {
      const decade = $('#years').value;
      filtered = records.filter(r => decade === 'all' || (r.year !== null && r.year >= +decade && r.year <= +decade + 9));
      const groups = d3.group(filtered, r => r.neighborhood);
      stats = new Map(features.map(f => {
        const name = f.properties.name, rows = groups.get(name) || [], area = f.properties.area_km2;
        return [name, {name, rows, area, count: rows.length, works: new Set(rows.map(r => r.workKey)).size, density: rows.length / area}];
      }));
      shapes.attr('fill', f => { const s = stats.get(f.properties.name); return s.count ? color(s.density) : '#e8e2df'; })
        .attr('aria-label', f => {const s = stats.get(f.properties.name); return `${s.name}: ${s.count} records, ${s.density.toFixed(1)} records per square kilometre`;});
      const assigned = d3.sum([...stats.values()], s => s.count);
      $('#coverage').textContent = `${number(assigned)} of ${number(filtered.length)} records assigned · ${number(filtered.length - assigned)} unassigned · ${raw.length - records.length} exact duplicate rows removed from source.`;
      $('#tooltip').hidden = true; updateSelection();
    }
    function updateSelection() {
      shapes.classed('selected', f => f.properties.name === selected).attr('aria-pressed', f => String(f.properties.name === selected));
      $('#stats').replaceChildren(); $('#details').replaceChildren();
      const entries = [...stats.values()];
      const s = selected ? stats.get(selected) : {count: d3.sum(entries, d => d.count), works: new Set(filtered.filter(r => names.has(r.neighborhood)).map(r => r.workKey)).size};
      $('#selection').textContent = selected || 'A city of stories.';
      $('#hint').textContent = selected ? `${s.area.toFixed(2)} km² · ${s.density.toFixed(1)} records per km²` : 'Select a neighborhood to discover its film locations.';
      [[number(s.count), 'LOCATION RECORDS'], [number(s.works), 'DISTINCT TITLES']].forEach(([value, label]) => {
        const el = textElement('div', '', $('#stats')); textElement('b', value, el); textElement('span', label, el);
      });
      textElement('div', selected ? 'FILMS & LOCATIONS' : 'HIGHEST RECORD DENSITY', $('#details')).className = 'section-label';
      if (!selected) {
        entries.sort((a, b) => b.density - a.density).slice(0, 10).forEach(s => {
          const b = textElement('button', '', $('#details')); b.className = 'rank';
          textElement('span', s.name, b); textElement('b', s.density.toFixed(1), b); b.onclick = () => select(s.name);
        });
      } else {
        const films = [...d3.group(s.rows, r => r.workKey).values()].sort((a,b) => (b[0].year || 0) - (a[0].year || 0));
        if (!films.length) textElement('p', 'No records for this release-year range.', $('#details'));
        films.forEach(rows => {
          const el = textElement('article', '', $('#details')); el.className = 'film';
          textElement('b', rows[0].Title, el); textElement('p', `${rows[0].year || 'Unknown year'} · ${rows.length} location record${rows.length === 1 ? '' : 's'}`, el);
          textElement('p', [...new Set(rows.map(r => r.Locations).filter(Boolean))].join(' · ') || 'Location not specified', el);
        });
      }
    }
    new ResizeObserver(draw).observe(stage);
  } catch (error) {
    console.error(error);
    document.querySelectorAll('#recolor-summary, #time-summary').forEach(el => { el.textContent = 'Could not load data. Open the project through a local HTTP server and refresh.'; });
    $('#coverage').textContent = 'Could not load local data. Open this project using a local HTTP server (for example VS Code Live Server), then refresh.';
  }
})();
