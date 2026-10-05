// Known offences: keyword match → stable key, Hindi label, and whether a
// Lok Adalat usually takes it up. Unknown offences default to "eligible"
// because most compoundable traffic offences are; the team confirms anyway.
export const OFFENCES = [
  { key: 'drunk', match: /drunk|alcohol|liquor|185\b/i, en: 'Drunk driving', hi: 'शराब पीकर ड्राइविंग', eligible: false },
  { key: 'accident', match: /accident|hit.?and.?run|death|injur/i, en: 'Accident-related offence', hi: 'दुर्घटना से जुड़ा अपराध', eligible: false },
  { key: 'speed', match: /speed/i, en: 'Over-speeding', hi: 'तेज़ गति', eligible: true },
  { key: 'redlight', match: /red.?light|signal/i, en: 'Red-light jumping', hi: 'रेड लाइट जंप', eligible: true },
  { key: 'seatbelt', match: /seat.?belt/i, en: 'Driving without seatbelt', hi: 'बिना सीटबेल्ट ड्राइविंग', eligible: true },
  { key: 'helmet', match: /helmet/i, en: 'Riding without helmet', hi: 'बिना हेलमेट', eligible: true },
  { key: 'wrongside', match: /wrong.?side/i, en: 'Wrong-side driving', hi: 'गलत दिशा में ड्राइविंग', eligible: true },
  { key: 'parking', match: /park/i, en: 'Parking in no-parking zone', hi: 'नो-पार्किंग ज़ोन में पार्किंग', eligible: true },
  { key: 'puc', match: /pollution|puc/i, en: 'Pollution certificate not carried', hi: 'प्रदूषण प्रमाणपत्र नहीं', eligible: true },
  { key: 'phone', match: /mobile|phone/i, en: 'Using mobile phone while driving', hi: 'ड्राइविंग के दौरान मोबाइल', eligible: true },
  { key: 'triple', match: /triple|pillion/i, en: 'Triple riding', hi: 'तीन सवारी', eligible: true },
  { key: 'documents', match: /licen[cs]e|insurance|registration|document|\brc\b/i, en: 'Documents not carried', hi: 'दस्तावेज़ साथ नहीं', eligible: true },
];

export function lookupOffence(text) {
  return OFFENCES.find((o) => o.match.test(text || '')) || null;
}

const PAID = /paid|dispos|settled|closed/i;
const COURT = /court|virtual|judicial|forwarded/i;

// → { eligibility: 'eligible' | 'not' | 'paid', reason: null | 'serious' | 'court' }
export function classify({ offence, status }) {
  if (PAID.test(status || '')) return { eligibility: 'paid', reason: null };
  const known = lookupOffence(offence);
  if (known && !known.eligible) return { eligibility: 'not', reason: 'serious' };
  if (COURT.test(status || '')) return { eligibility: 'not', reason: 'court' };
  return { eligibility: 'eligible', reason: null };
}
