export const PLATE_RE = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/;

// "up16ab1234" → "UP16 AB 1234" as the user types
export const fmtPlate = (raw) => {
  const s = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
  const m = s.match(/^([A-Z]{0,2})(\d{0,2})([A-Z]{0,3})(\d{0,4})(.*)$/);
  if (!m) return s;
  return [m[1] + m[2], m[3], m[4]].filter(Boolean).join(' ') + m[5];
};

export const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
export const pad = (n) => String(Math.max(0, n)).padStart(2, '0');

// Replaces {key} placeholders from vars.
export const fill = (str, vars) => str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
