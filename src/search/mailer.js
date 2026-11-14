// "Prepare for mailer": one CSV row per mailing address, with a combined Addressee.
// Spec: docs/superpowers/specs/2026-11-14-prepare-for-mailer-design.md
import { csvZip } from './csv.js';

const squash = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- Text cleanup (output only; the database keeps the FCC text as is)

// Collapses spaces (including non-breaking ones), drops the "Â" left by a UTF-8 non-breaking space
// read as Latin-1, and trims stray commas, semicolons, and dashes from the ends.
export function cleanText(value) {
  return String(value ?? '')
    .replace(/\u00C2(?=\u00A0)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;-]+|[\s,;-]+$/g, '');
}

// ---- Street and PO Box

// "PO Box 486", "P.O. Box # 486", "BOX 486", "POB 486" at the start of a street line.
const PO_BOX_IN_STREET = /^(?:P\.?\s*O\.?\s*)?(?:BOX|POB)\s*(?:#|NO\.?)?\s*(\d+)\b[\s,.;-]*/i;

// Street line and PO Box ready to print. Fixes these FCC data-entry slips:
// - the PO Box field holds the ZIP code (dropped),
// - the PO Box was typed in the street field (moved to PO Box, or dropped when it repeats the box),
// - city, state, and ZIP typed at the end of the street line (dropped).
export function mailingAddress(row) {
  let street = cleanText(row.street);
  let poBox = cleanText(row.po_box);
  const zip5 = row.zip5 ?? '';
  if (poBox && poBox === zip5) poBox = '';

  const city = cleanText(row.city);
  if (street && city) {
    const tail = new RegExp(`[\\s,]*${escapeRegExp(city)}[\\s,]+${escapeRegExp(row.state ?? '')}[\\s,]*${zip5}(?:-?\\d{4})?$`, 'i');
    street = street.replace(tail, '');
  }

  const box = PO_BOX_IN_STREET.exec(street);
  if (box && (!poBox || poBox === box[1])) {
    poBox = box[1];
    street = street.slice(box[0].length);
    // "PO Box 790 Eureka": what is left is just the city.
    if (squash(street) === squash(city)) street = '';
    street = cleanText(street);
  }
  return { street, poBox };
}

// USPS Publication 28 abbreviations for the words that differ most in this data.
const STREET_TYPES = {
  ALLEY: 'ALY', ALY: 'ALY',
  AV: 'AVE', AVE: 'AVE', AVEN: 'AVE', AVENUE: 'AVE', AVN: 'AVE',
  BEND: 'BND', BND: 'BND',
  BLVD: 'BLVD', BOUL: 'BLVD', BOULEVARD: 'BLVD', BOULV: 'BLVD',
  CANYON: 'CYN', CYN: 'CYN',
  CIR: 'CIR', CIRC: 'CIR', CIRCLE: 'CIR', CRCL: 'CIR', CRCLE: 'CIR',
  CK: 'CRK', CREEK: 'CRK', CRK: 'CRK',
  COURT: 'CT', CRT: 'CT', CT: 'CT',
  COVE: 'CV', CV: 'CV',
  CRES: 'CRES', CRESCENT: 'CRES',
  DR: 'DR', DRIV: 'DR', DRIVE: 'DR', DRV: 'DR',
  GLCH: 'GLCH', GULCH: 'GLCH',
  HEIGHTS: 'HTS', HTS: 'HTS',
  HIGHWAY: 'HWY', HIGHWY: 'HWY', HIWAY: 'HWY', HIWY: 'HWY', HWAY: 'HWY', HWY: 'HWY',
  HOLLOW: 'HOLW', HOLW: 'HOLW',
  LANE: 'LN', LN: 'LN',
  LOOP: 'LOOP', LP: 'LOOP',
  MDW: 'MDW', MEADOW: 'MDW',
  PARKWAY: 'PKWY', PARKWY: 'PKWY', PKWY: 'PKWY', PKY: 'PKWY',
  PL: 'PL', PLACE: 'PL',
  POINT: 'PT', PT: 'PT',
  RANCH: 'RNCH', RNCH: 'RNCH',
  RDG: 'RDG', RIDGE: 'RDG',
  RD: 'RD', ROAD: 'RD',
  ROUTE: 'RTE', RTE: 'RTE',
  SQ: 'SQ', SQUARE: 'SQ',
  ST: 'ST', STR: 'ST', STREET: 'ST', STRT: 'ST',
  TER: 'TER', TERRACE: 'TER',
  TRAIL: 'TRL', TRAILS: 'TRL', TRL: 'TRL', TRLS: 'TRL',
  VALLEY: 'VLY', VLY: 'VLY',
  VIEW: 'VW', VW: 'VW',
  WAY: 'WAY', WY: 'WAY',
};
const OTHER_WORDS = {
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
  NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW',
  SAINT: 'ST', MOUNT: 'MT', MNT: 'MT', MOUNTAIN: 'MTN', MNTN: 'MTN', MOUNTIN: 'MTN',
  // Unit words are dropped so "Apt 209", "#209", and "Unit 209" match. The unit number stays.
  APARTMENT: '', APT: '', SUITE: '', STE: '', UNIT: '',
};
const STREET_TYPE_ABBREVIATIONS = new Set(Object.values(STREET_TYPES));

// Street line in a comparable form: upper case, no apostrophes or punctuation,
// USPS abbreviations, and ordinals as plain numbers ("5TH" becomes "5").
export function standardStreet(street) {
  return String(street ?? '')
    .toUpperCase()
    .replace(/['’]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => STREET_TYPES[word] ?? OTHER_WORDS[word] ?? word.replace(/^(\d+)(?:ST|ND|RD|TH)$/, '$1'))
    .filter(Boolean)
    .join(' ');
}

// Rows match when street (or PO Box when there is no street), city, and 5-digit ZIP match after
// cleanup and standardStreet. Returns null when the row has no street or PO Box.
export function addressKey(row) {
  const { street, poBox } = mailingAddress(row);
  const standard = standardStreet(street);
  const line = standard ? `S ${standard}` : poBox ? `P ${squash(poBox)}` : '';
  if (!line) return null;
  return `${row.zip5 ?? ''}|${squash(row.city)}|${line}`;
}

// ---- Addressee

// "A", "A and B", "A, B, and C".
export function joinList(items) {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

// The FCC suffix field also holds stray numbers and titles ("899", "Mr."). Only these are kept.
const NAME_SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V', 'VI']);
export const nameSuffix = (row) => (NAME_SUFFIXES.has(squash(row.suffix)) ? cleanText(row.suffix) : '');

const personKey = (row) => (row.frn
  ? `F ${row.frn}`
  : `N ${squash(row.first)}|${squash(row.last)}|${squash(nameSuffix(row))}|${squash(row.entity_name)}`);

// Addressee for the rows at one address. People who share a last name (and suffix) are combined:
// "John and Jane Doe". Different last names are listed: "John Doe and Jane Smith". Clubs use
// their entity name. The same person twice (same FRN, or same name) is named once.
export function addressee(rows) {
  const seen = new Set();
  const families = new Map();
  for (const row of rows) {
    const key = personKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    const first = cleanText(row.first);
    const last = cleanText(row.last);
    const suffix = nameSuffix(row);
    if (!first && !last) {
      const entity = cleanText(row.entity_name);
      if (entity) families.set(`E ${families.size}`, { surname: entity, firsts: [] });
      continue;
    }
    const familyKey = `L ${squash(last)}|${squash(suffix)}`;
    if (!families.has(familyKey)) families.set(familyKey, { surname: [last, suffix].filter(Boolean).join(' '), firsts: [] });
    if (first) families.get(familyKey).firsts.push(first);
  }
  const parts = [...families.values()].map(({ surname, firsts }) =>
    (firsts.length ? `${joinList(firsts)} ${surname}`.trim() : surname));
  return joinList(parts);
}

// ---- Grouping

// A street line with no street type ("1880 NUTHATCH") joins the one address in the same ZIP and city
// that is the same line plus a street type ("1880 NUTHATCH DR"). With two or more candidates
// ("... DR" and "... CT"), it stays on its own.
function mergeMissingStreetTypes(groups) {
  const byKey = new Map([...groups].map(([key]) => [key, key]));
  const candidates = new Map();
  for (const key of groups.keys()) {
    const match = /^(.*\|S .+) (\S+)$/.exec(key);
    if (!match || !STREET_TYPE_ABBREVIATIONS.has(match[2])) continue;
    const list = candidates.get(match[1]) ?? [];
    list.push(key);
    candidates.set(match[1], list);
  }
  for (const key of groups.keys()) {
    const lastWord = key.slice(key.lastIndexOf(' ') + 1);
    if (!key.includes('|S ') || STREET_TYPE_ABBREVIATIONS.has(lastWord)) continue;
    const found = candidates.get(key) ?? [];
    if (found.length === 1) byKey.set(key, found[0]);
  }
  const merged = new Map();
  for (const [key, rows] of groups) {
    const target = byKey.get(key);
    if (!merged.has(target)) merged.set(target, []);
    if (target === key) merged.get(target).unshift(...rows);
    else merged.get(target).push(...rows);
  }
  return merged.values();
}

// Groups license rows by mailing address. Rows must arrive ordered by zip5 (iterateLicenses and
// iterateAddresses do this), so only one ZIP is held in memory at a time. The first row of a group
// is the one whose address is printed. Closing this generator early closes `rows` too, which
// releases the SQLite read.
export function* groupByAddress(rows) {
  let zip5 = null;
  let groups = new Map();
  let loose = 0;
  for (const row of rows) {
    if (row.zip5 !== zip5) {
      yield* mergeMissingStreetTypes(groups);
      groups = new Map();
      zip5 = row.zip5;
    }
    const key = addressKey(row) ?? `none ${loose++}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  yield* mergeMissingStreetTypes(groups);
}

// Number of mailing addresses among the rows (ordered by zip5), counted the same way as the export.
export function countAddresses(rows) {
  let total = 0;
  const groups = groupByAddress(rows);
  while (!groups.next().done) total++;
  return total;
}

// ---- CSV

const printed = (group) => mailingAddress(group[0]);

export const MAILER_COLUMNS = [
  ['Addressee', (group) => addressee(group)],
  ['Street Address', (group) => printed(group).street],
  ['PO Box', (group) => printed(group).poBox],
  ['City', (group) => cleanText(group[0].city)],
  ['State', (group) => group[0].state],
  ['ZIP', (group) => csvZip(group[0].zip)],
  ['County', (group) => group[0].county_name || 'Unassigned'],
  ['Call Signs', (group) => group.map((row) => row.call).join(', ')],
  ['Count', (group) => group.length],
];
