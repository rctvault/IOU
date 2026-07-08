// Small helpers for generating ids, share codes, and member colours.

export function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Human-friendly share code: 6 chars, no ambiguous 0/O/1/I/L.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function shareCode(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

// Member avatar palette. Built from the brand palette (bleu canard, coral,
// bordeaux, aqua) plus three earthy tones — ochre, sage, plum — added to blend
// with it and give ~8 distinct colors (groups run up to 6). Snow / vert d'eau
// are the app background, so they aren't used as avatars. Ordered so the first
// six are maximally distinct.
export const MEMBER_COLORS = [
  "#FF6038", // orange corail
  "#A0C9CB", // aqua
  "#733635", // bordeaux
  "#C99A46", // ochre
  "#7C9885", // sage
  "#7E5D6E", // plum
  "#361E1C", // bordeaux profond
];

export function nextColor(usedCount: number): string {
  return MEMBER_COLORS[usedCount % MEMBER_COLORS.length];
}
