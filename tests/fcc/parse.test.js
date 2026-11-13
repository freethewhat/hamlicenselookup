import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  readDatLines, parseEN, parseHD, parseAM, parseHS, normalizeZip5, fccDate,
} from '../../src/fcc/parse.js';

const EN_LINE = 'EN|1|||K7AAA|L|L1|TESTER, ALPHA|Alpha|Q|Tester|Jr||||1 Main St|Missoula|MT|59801-1234|PO 5||000|0000000001|I||||||';

test('readDatLines joins split records and decodes latin1', async () => {
  const buf = Buffer.concat([
    Buffer.from('EN|1|||K7AAA|L|L1|TESTER, ALPHA|Alpha||Tester|||||1 Main St|Missoula|MT|59801|||000|0000000001|I||||||\r\n'),
    Buffer.from('EN|2|||K7BBB|L|L2|TESTER, BETA|Beta||Te'), Buffer.from('\r\n'),
    Buffer.from('ster|||||2 Oak|Hamilton|MT|59840|||000|0000000002|I||||||\r\n'),
    Buffer.from([0x45, 0x4e, 0x7c, 0x33, 0x7c, 0x7c, 0x7c, 0x4b, 0x7c, 0x4c, 0x7c, 0x7c, 0x4a, 0x6f, 0x73, 0xe9, 0x0a]),
  ]);
  const rows = [];
  for await (const f of readDatLines(Readable.from([buf]), 'EN')) rows.push(f);
  assert.equal(rows.length, 3);
  assert.equal(rows[1][10], 'Tester');
  assert.equal(rows[2][7], 'José');
});

test('readDatLines skips blank lines', async () => {
  const text = 'HS|1||K7AAA|01/02/2020|LIISS\r\n\r\n\r\nHS|2||K7BBB|01/03/2020|LIISS\r\n';
  const rows = [];
  for await (const f of readDatLines(Readable.from([Buffer.from(text)]), 'HS')) rows.push(f);
  assert.equal(rows.length, 2);
});

test('parseEN maps fields and skips non-licensee entities', () => {
  const f = EN_LINE.split('|');
  assert.deepEqual(parseEN(f), {
    usid: 1, entityName: 'TESTER, ALPHA', first: 'Alpha', mi: 'Q', last: 'Tester', suffix: 'Jr',
    street: '1 Main St', city: 'Missoula', state: 'MT', zip: '59801-1234', zip5: '59801',
    poBox: 'PO 5', frn: '0000000001', applicantType: 'I',
  });
  const other = [...f];
  other[5] = 'CL';
  assert.equal(parseEN(other), null);
});

test('parseHD converts dates', () => {
  const f = new Array(59).fill('');
  Object.assign(f, { 1: '7', 4: 'K7AAA', 5: 'A', 6: 'HA', 7: '09/26/2026', 8: '09/26/2036', 9: '', 43: '10/01/2026' });
  assert.deepEqual(parseHD(f), {
    usid: 7, call: 'K7AAA', status: 'A', service: 'HA', grantDate: '2026-09-26',
    expiredDate: '2036-09-26', cancelDate: null, lastActionDate: '2026-10-01',
  });
});

test('parseAM reads previous call and class', () => {
  const f = 'AM|5385194|||KJ5SJL|G|D|5||||||||KJ5SIE|T|'.split('|');
  assert.deepEqual(parseAM(f), {
    usid: 5385194, opClass: 'G', trusteeCall: '', prevCall: 'KJ5SIE', prevClass: 'T',
  });
});

test('parseHS reads history rows', () => {
  assert.deepEqual(parseHS('HS|9||K7AAA|09/26/2026|LIISS'.split('|')), { usid: 9, date: '2026-09-26', code: 'LIISS' });
});

test('fccDate', () => {
  assert.equal(fccDate('09/26/2026'), '2026-09-26');
  assert.equal(fccDate(''), null);
});

test('normalizeZip5', () => {
  assert.equal(normalizeZip5('59801-1234'), '59801');
  assert.equal(normalizeZip5('598011234'), '59801');
  assert.equal(normalizeZip5('01003'), '01003');
  assert.equal(normalizeZip5('5980'), '');
  assert.equal(normalizeZip5(''), '');
});
