import { StringDecoder } from 'node:string_decoder';

async function* splitLines(stream) {
  const decoder = new StringDecoder('latin1');
  let rest = '';
  for await (const chunk of stream) {
    rest += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    let nl;
    while ((nl = rest.indexOf('\n')) !== -1) {
      yield rest.slice(0, nl);
      rest = rest.slice(nl + 1);
    }
  }
  rest += decoder.end();
  if (rest) yield rest;
}

/**
 * Streams a FCC .dat file as arrays of fields. FCC files occasionally break a
 * record across lines, so a line that does not start with `<prefix>|` is
 * appended to the previous record.
 */
export async function* readDatLines(stream, prefix) {
  const start = `${prefix}|`;
  let pending = null;
  for await (const raw of splitLines(stream)) {
    const line = raw.replace(/\r/g, '');
    if (line === '') continue;
    if (line.startsWith(start)) {
      if (pending !== null) yield pending.split('|');
      pending = line;
    } else if (pending !== null) {
      pending += line;
    }
  }
  if (pending !== null) yield pending.split('|');
}

export function fccDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((s ?? '').trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

export function normalizeZip5(zip) {
  const digits = (zip ?? '').replace(/\D/g, '');
  return digits.length >= 5 ? digits.slice(0, 5) : '';
}

export function parseEN(f) {
  if (f[5] !== 'L') return null;
  return {
    usid: Number(f[1]),
    entityName: f[7],
    first: f[8],
    mi: f[9],
    last: f[10],
    suffix: f[11],
    street: f[15],
    city: f[16],
    state: f[17],
    zip: f[18],
    zip5: normalizeZip5(f[18]),
    poBox: f[19],
    frn: f[22],
    applicantType: f[23],
  };
}

export function parseHD(f) {
  return {
    usid: Number(f[1]),
    call: f[4],
    status: f[5],
    service: f[6],
    grantDate: fccDate(f[7]),
    expiredDate: fccDate(f[8]),
    cancelDate: fccDate(f[9]),
    lastActionDate: fccDate(f[43]),
  };
}

export function parseAM(f) {
  return {
    usid: Number(f[1]),
    opClass: f[5],
    trusteeCall: f[8],
    prevCall: f[15],
    prevClass: f[16],
  };
}

export function parseHS(f) {
  return { usid: Number(f[1]), date: fccDate(f[4]), code: f[5] };
}
