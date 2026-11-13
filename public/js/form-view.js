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

export function createFormView({ selection }) {
  const search = document.getElementById('county-search');
  const options = document.getElementById('county-options');
  const zipText = document.getElementById('zip-text');
  const rejectedEl = document.getElementById('zip-rejected');
  let byLabel = new Map(); // "Missoula, MT" -> {geoid, label}

  search.addEventListener('input', () => {
    const hit = byLabel.get(search.value.trim());
    if (!hit) return;
    if (!selection.has('county', hit.geoid)) selection.toggle('county', hit.geoid, hit.label);
    search.value = '';
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
      byLabel = new Map(counties.map((c) => [`${c.name}, ${c.state}`, { geoid: c.geoid, label: `${c.name}, ${c.state}` }]));
      options.replaceChildren(
        ...[...byLabel.keys()].map((label) => {
          const o = document.createElement('option');
          o.value = label;
          return o;
        }),
      );
      search.disabled = counties.length === 0;
      search.placeholder = counties.length ? 'Type to search counties…' : 'Pick a state first';
    },
  };
}
