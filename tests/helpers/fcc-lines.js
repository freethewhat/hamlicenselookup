// Builders for made-up FCC ULS pipe-delimited records.
function line(len, prefix, fields) {
  const f = new Array(len).fill('');
  f[0] = prefix;
  for (const [i, v] of Object.entries(fields)) f[i] = String(v);
  return f.join('|');
}
export const en = (usid, last, first, { state = 'MT', zip = '59801-1234', frn, type = 'I', cls = 'L' }) => line(24, 'EN', {
  1: usid, 5: cls, 7: `${last.toUpperCase()}, ${first.toUpperCase()}`, 8: first, 10: last,
  15: '1 Main St', 16: 'Town', 17: state, 18: zip, 22: frn, 23: type,
});
export const hd = (usid, call, grant) => line(59, 'HD', {
  1: usid, 4: call, 5: 'A', 6: 'HA', 7: grant, 8: '01/01/2036', 43: grant,
});
export const am = (usid, call, cls, prevCall = '', prevClass = '', trustee = '') => line(17, 'AM', {
  1: usid, 4: call, 5: cls, 8: trustee, 15: prevCall, 16: prevClass,
});
export const hs = (usid, call, date, code) => line(6, 'HS', { 1: usid, 3: call, 4: date, 5: code });
