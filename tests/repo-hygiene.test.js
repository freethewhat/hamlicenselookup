// The site is for any ham club, so no specific club's call sign may appear in the repo.
// The call sign is stored base64-encoded so this test does not itself contain it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BANNED = ['dzdweA=='].map((b) => Buffer.from(b, 'base64').toString('utf8').toLowerCase());

test('no club call sign in any tracked file', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const hits = [];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(f, 'utf8').toLowerCase();
    } catch {
      continue; // deleted in the working tree
    }
    for (const word of BANNED) if (text.includes(word)) hits.push(f);
  }
  assert.deepEqual(hits, []);
});
