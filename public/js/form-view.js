// Form alternative to the map: county type-ahead and a ZIP code textarea.
const ZIP_RE = /^\d{5}$/;

// Split free text on commas, spaces, newlines, semicolons. Returns unique valid ZIPs and rejected entries.
export function parseZips(text) {
  const valid = new Set();
  const rejected = [];
  for (const tok of text.split(/[\s,;]+/).filter(Boolean)) {
    if (ZIP_RE.test(tok)) valid.add(tok);
    else if (!rejected.includes(tok)) rejected.push(tok);
  }
  return { valid: [...valid], rejected };
}

// Find counties matching free text: case-insensitive, ignoring a trailing county-type word
// and an optional ", ST". counties: [{geoid, name, state}]. Returns the matching counties.
export function matchCounties(text, counties) {
  let t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  let st = null;
  const m = t.match(/^(.*?)\s*,\s*([a-z]{2})$/);
  if (m) {
    t = m[1];
    st = m[2];
  }
  const strip = (n) => n.toLowerCase().replace(/\s+(county|parish|borough)$/, '');
  t = strip(t);
  if (!t) return [];
  return counties.filter((c) => (!st || c.state.toLowerCase() === st) && (c.name.toLowerCase() === t || strip(c.name) === t));
}

export function createFormView({ selection }) {
  const search = document.getElementById('county-search');
  const options = document.getElementById('county-options');
  const zipText = document.getElementById('zip-text');
  const rejectedEl = document.getElementById('zip-rejected');
  let all = [];

  function addCounty() {
    const text = search.value.trim();
    if (!text) return;
    const hits = matchCounties(text, all);
    if (hits.length === 1) {
      const c = hits[0];
      if (!selection.has('county', c.geoid)) selection.toggle('county', c.geoid, `${c.name}, ${c.state}`);
      search.value = '';
      rejectedEl.textContent = '';
    } else if (hits.length > 1) {
      rejectedEl.textContent = `Several counties match '${text}': ${hits.map((c) => `${c.name}, ${c.state}`).join('; ')}. Add the state, like "${hits[0].name}, ${hits[0].state}".`;
    } else {
      rejectedEl.textContent = `No county named '${text}' in the picked states.`;
    }
  }

  // Picking from the datalist fires 'input' with an exact label; Enter covers typed text.
  search.addEventListener('input', () => {
    const t = search.value.trim();
    if (all.some((c) => `${c.name}, ${c.state}` === t)) addCounty();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCounty();
    }
  });

  document.getElementById('zip-add').addEventListener('click', () => {
    const { valid, rejected } = parseZips(zipText.value);
    for (const z of valid) selection.toggle('zip', z, z);
    zipText.value = rejected.join(' ');
    rejectedEl.textContent = rejected.length ? `Not valid 5-digit ZIP codes: ${rejected.join(', ')}` : '';
  });

  return {
    // counties: [{geoid, name, state}] for all picked states
    setCounties(counties) {
      all = counties;
      options.replaceChildren(
        ...counties.map((c) => {
          const o = document.createElement('option');
          o.value = `${c.name}, ${c.state}`;
          return o;
        }),
      );
      search.disabled = counties.length === 0;
      search.placeholder = counties.length ? 'Type to search counties…' : 'Pick a state first';
    },
  };
}
