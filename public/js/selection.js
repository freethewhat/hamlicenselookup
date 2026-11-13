// Shared list of picked areas (ZIPs and counties). No browser APIs: testable under node.
export function createSelection() {
  const picked = new Map(); // key "type:id" -> {type, id, label}
  const listeners = new Set();
  const key = (type, id) => `${type}:${id}`;
  const emit = () => listeners.forEach((cb) => cb());

  const api = {
    toggle(type, id, label) {
      const k = key(type, id);
      if (picked.has(k)) picked.delete(k);
      else picked.set(k, { type, id, label });
      emit();
    },
    remove(type, id) {
      if (picked.delete(key(type, id))) emit();
    },
    clear() {
      if (picked.size === 0) return;
      picked.clear();
      emit();
    },
    // Replace all picks at once (saved picks on page load). One change event, not one per item.
    restore(items) {
      picked.clear();
      for (const i of items) {
        if (typeof i?.type !== 'string' || typeof i?.id !== 'string') continue;
        const k = key(i.type, i.id);
        if (!picked.has(k)) picked.set(k, { type: i.type, id: i.id, label: i.label });
      }
      emit();
    },
    has: (type, id) => picked.has(key(type, id)),
    items: () => [...picked.values()],
    toRequest() {
      const items = api.items();
      return {
        zips: items.filter((i) => i.type === 'zip').map((i) => i.id),
        counties: items.filter((i) => i.type === 'county').map((i) => i.id),
      };
    },
    // countyZips: Map<countyGeoid, zip[]>
    coveredZips(countyZips) {
      const out = new Set();
      for (const i of picked.values()) {
        if (i.type === 'zip') out.add(i.id);
        else for (const z of countyZips.get(i.id) ?? []) out.add(z);
      }
      return out;
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return api;
}
