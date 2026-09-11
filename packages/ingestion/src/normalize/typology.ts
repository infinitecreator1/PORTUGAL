import type { Typology } from "@imovel/core";
import { stripDiacritics } from "@imovel/core";

/** Clamps a room count to the closed typology enum: 0 → T0, 6 or more → T6+. */
export function typologyFromRooms(rooms: number): Typology | null {
  if (!Number.isFinite(rooms)) return null;
  const n = Math.floor(rooms);
  if (n < 0) return null;
  if (n >= 6) return "T6+";
  return `T${n}` as Typology;
}

const STUDIO = /\b(est[uú]dio|studio|kitnet|kitchenette|quitinete|monoambiente)\b/;
const T_PATTERN = /\bt\s*(\d{1,2})(?:\s*\+\s*\d+)?\b/;
const ASSOALHADAS = /(\d{1,2})\s*(?:\+\s*\d+\s*)?assoalhadas?\b/;
const ROOMS = /(\d{1,2})\s*(?:\+\s*\d+\s*)?(?:quartos?|dormit[oó]rios?|bedrooms?|beds?|br|habitaci[oó]n(?:es)?|rooms?|hab\b|q\b)/;
const PLAIN_NUMBER = /^\d{1,2}$/;

/**
 * Parses a typology from portal strings or numbers.
 * "T3", "t3", "T3+1", "T 3", "3 quartos", "3 bedrooms", "3 dormitórios", "Estúdio" → T0,
 * "4 assoalhadas" → T3 (pt-PT: assoalhadas counts the living room), numbers ≥ 6 → T6+.
 */
export function parseTypology(input: unknown): Typology | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return typologyFromRooms(input);
  if (typeof input !== "string") return null;
  const s = stripDiacritics(input).toLowerCase().trim();
  if (!s) return null;

  const assoalhadas = ASSOALHADAS.exec(s);
  if (assoalhadas) return typologyFromRooms(Math.max(0, Number(assoalhadas[1]) - 1));

  const t = T_PATTERN.exec(s);
  if (t) return typologyFromRooms(Number(t[1]));

  if (STUDIO.test(s)) return "T0";

  const rooms = ROOMS.exec(s);
  if (rooms) return typologyFromRooms(Number(rooms[1]));

  if (PLAIN_NUMBER.test(s)) return typologyFromRooms(Number(s));

  return null;
}
