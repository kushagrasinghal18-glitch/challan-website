// Compare the vehicle owner's name read from Parivahan with the name the customer gave.
// Parivahan often hides part of the name, e.g. "RA*** KUMAR", so * and x stand for hidden letters.

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'shri', 'sri', 'smt', 'shrimati', 'dr', 'md', 'late', 'm/s', 'ms.']);

// "Mr. RA*** KUMAR " → ['ra***', 'kumar']
export function nameWords(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[xX]{2,}/g, (m) => '*'.repeat(m.length))
    .replace(/[^a-z0-9*\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !TITLES.has(w));
}

// One word against one word, with * as any run of letters and a bare letter as an initial.
function wordOk(a, b) {
  if (a === b) return true;
  if (a.length === 1 || b.length === 1) return a[0] === b[0];
  const star = (w) => w.includes('*');
  if (!star(a) && !star(b)) return false;
  const rx = (w) => new RegExp('^' + w.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return star(a) ? rx(a).test(b) : rx(b).test(a);
}

// 'match'    every word of the shorter name is found in the other
// 'partial'  some words line up (one name is initials, or a middle name is missing)
// 'mismatch' nothing lines up
// ''         not enough to judge
export function nameMatch(given, owner) {
  const a = nameWords(given), b = nameWords(owner);
  if (!a.length || !b.length) return '';
  const left = [...b];
  let hit = 0;
  for (const w of a) {
    const i = left.findIndex((x) => wordOk(w, x));
    if (i >= 0) { hit++; left.splice(i, 1); }
  }
  const need = Math.min(a.length, b.length);
  if (hit >= need) return 'match';
  if (hit === 0) return 'mismatch';
  // A single shared common word (often a surname) is not enough to call it a match.
  return hit >= need - 1 && hit > 0 ? 'partial' : 'mismatch';
}

export const matchLabel = { match: 'Name matches', partial: 'Name partly matches', mismatch: "Name doesn't match" };
