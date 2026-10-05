// Line icons from the design, 24×24 grid.
const I = ({ size = 24, sw = 1.7, children, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" {...p}>{children}</svg>
);
export const Phone = (p) => <I size={18} sw={1.8} {...p}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z" /></I>;
export const Check = (p) => <I size={14} sw={2.5} {...p}><path d="M5 12l5 5 9-10" /></I>;
export const Pin = (p) => <I size={18} sw={1.8} {...p}><path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></I>;
export const Car = (p) => <I {...p}><rect x="3" y="10" width="18" height="7" rx="2" /><path d="M6 10l2-4h8l2 4" /><circle cx="7.5" cy="17" r="1.6" /><circle cx="16.5" cy="17" r="1.6" /></I>;
export const Shield = (p) => <I {...p}><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></I>;
export const Doc = (p) => <I {...p}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></I>;
export const CalCheck = (p) => <I {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4" /></I>;
export const Chat = (p) => <I {...p}><path d="M4 5h16v11H9l-5 4z" /></I>;
export const Rupee = (p) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M9 8h6M9 11.5h6M12.5 11.5c0 2-1.6 3-3.5 3l4 3.5" /></I>;
export const WhatsApp = (p) => <I size={22} sw={1.9} {...p}><path d="M12 3a9 9 0 00-7.8 13.5L3 21l4.6-1.2A9 9 0 1012 3z" /></I>;
export const Close = (p) => <I size={16} sw={2.2} {...p}><path d="M6 6l12 12M18 6L6 18" /></I>;
export const Warn = (p) => <I size={22} sw={1.9} {...p}><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></I>;
