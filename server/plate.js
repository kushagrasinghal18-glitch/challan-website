// Indian registration numbers: state(2) + RTO(1-2 digits) + series(0-3 letters) + number(4)
export const PLATE_RE = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/;
export const normalizePlate = (raw) => String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
