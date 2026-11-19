// Search key for last names: upper case, letters and digits only.
// "MC CARTHY", "McCarthy" and "Mc-Carthy" all become "MCCARTHY".
export function nameKey(text) {
  return String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Makes nameKey callable from SQL as name_key(text), for the loaders' INSERT ... SELECT.
export function registerNameKey(db) {
  db.function('name_key', { deterministic: true }, nameKey);
}
