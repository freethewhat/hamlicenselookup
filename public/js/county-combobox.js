// County type-ahead built on the ARIA 1.2 "combobox with listbox popup" pattern.
// suggestCounties is pure so tests can import it; createCountyCombobox wires the DOM.

const strip = (n) => n.replace(/\s+(county|parish|borough)$/, '');

// Counties whose name starts with the text, then those whose name contains it.
// Same text rules as matchCounties: case and extra spaces ignored, optional ", ST",
// optional trailing County/Parish/Borough. Each group is sorted by name, then state.
export function suggestCounties(text, counties, limit = 20) {
  return rankCounties(text, counties).slice(0, limit);
}

// How many counties match in all, even past the limit suggestCounties shows.
export const countCounties = (text, counties) => rankCounties(text, counties).length;

// The text the live region speaks after each keystroke.
export function matchMessage(shown, total) {
  if (total === 0) return 'No counties match.';
  if (shown < total) return `Showing ${shown} of ${total} counties. Keep typing to narrow the list.`;
  return `${total} ${total === 1 ? 'county matches' : 'counties match'}.`;
}

function rankCounties(text, counties) {
  let t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  let st = null;
  const m = t.match(/^(.*?)\s*,\s*([a-z]{2})$/);
  if (m) {
    t = m[1];
    st = m[2];
  }
  t = strip(t);
  if (!t) return [];
  const starts = [];
  const contains = [];
  for (const c of counties) {
    if (st && c.state.toLowerCase() !== st) continue;
    const name = c.name.toLowerCase();
    if (name.startsWith(t)) starts.push(c);
    else if (name.includes(t)) contains.push(c);
  }
  const byName = (a, b) => a.name.localeCompare(b.name) || a.state.localeCompare(b.state);
  return [...starts.sort(byName), ...contains.sort(byName)];
}

const label = (c) => `${c.name}, ${c.state}`;

// input: the text box. listbox: the <ul> popup. status: a polite live region.
// onPick(county) runs when an option is chosen. onEnterText(text) runs on Enter with no option active.
export function createCountyCombobox({ input, listbox, status, onPick, onEnterText }) {
  let all = [];
  let items = [];
  let active = -1;

  function setActive(i) {
    active = i;
    [...listbox.children].forEach((li, n) => li.setAttribute('aria-selected', String(n === i)));
    const li = listbox.children[i];
    if (li) {
      input.setAttribute('aria-activedescendant', li.id);
      li.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function close() {
    listbox.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    setActive(-1);
  }

  function open() {
    if (items.length === 0) return close();
    listbox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function pick(c) {
    onPick(c);
    input.value = '';
    items = [];
    listbox.replaceChildren();
    close();
    status.textContent = `Added ${label(c)}.`;
  }

  function update() {
    items = suggestCounties(input.value, all);
    listbox.replaceChildren(
      ...items.map((c, n) => {
        const li = document.createElement('li');
        li.id = `county-opt-${c.geoid}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.textContent = label(c);
        li.addEventListener('click', () => pick(items[n]));
        return li;
      }),
    );
    setActive(-1);
    if (input.value.trim()) {
      status.textContent = matchMessage(items.length, countCounties(input.value, all));
      open();
    } else {
      status.textContent = '';
      close();
    }
  }

  // A mousedown anywhere in the list (an option, its padding, or its scrollbar) would blur the
  // input and close the list before the click lands.
  listbox.addEventListener('mousedown', (e) => e.preventDefault());
  input.addEventListener('input', update);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (e) => {
    const isOpen = !listbox.hidden;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        update();
        open();
      }
      if (items.length) setActive(Math.min(active + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (isOpen && items.length) setActive(Math.max(active - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen && active >= 0) pick(items[active]);
      else {
        close();
        onEnterText(input.value);
      }
    } else if (e.key === 'Escape') {
      if (isOpen) close();
      else input.value = '';
    } else if (e.key === 'Tab') {
      close();
    }
  });

  return {
    setCounties(counties) {
      all = counties;
      items = [];
      listbox.replaceChildren();
      close();
    },
  };
}
