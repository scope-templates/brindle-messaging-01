/**
 * Public identifiers: a prefix saying what the object is, then a tail drawn from digits and
 * consonants, so an id cannot spell a word and cannot be misread from a screenshot. The seed
 * generator draws from the same alphabet and the same lengths through `mintId`.
 */
import { randomBytes } from 'node:crypto';

export const ALPHABET = '0123456789bfghjmnpqrstvwxz';

export type IdPrefix = 'acct' | 'key' | 'tmpl' | 'tv' | 'msg' | 'evt' | 'batch' | 'wh' | 'whd';

/** Accounts and endpoints are few and get quoted down the phone, so their tails are shorter. */
const LENGTHS: Record<IdPrefix, number> = {
  acct: 8,
  wh: 10,
  key: 12,
  tmpl: 12,
  tv: 12,
  msg: 12,
  evt: 12,
  batch: 12,
  whd: 12,
};

export const KEY_TAIL = 26;
export const SECRET_TAIL = 32;

/** A number in [0, 1): randomness in the API, the seeded dice in the generator. */
export type Roll = () => number;

const randomRoll: Roll = () => randomBytes(4).readUInt32BE(0) / 0x1_0000_0000;

export function draw(length: number, roll: Roll): string {
  let tail = '';
  for (let at = 0; at < length; at += 1) tail += ALPHABET[Math.floor(roll() * ALPHABET.length)];
  return tail;
}

export function mintId(prefix: IdPrefix, roll: Roll): string {
  return `${prefix}_${draw(LENGTHS[prefix], roll)}`;
}

export function mintKey(mode: 'live' | 'test', roll: Roll): string {
  return `bk_${mode}_${draw(KEY_TAIL, roll)}`;
}

export function mintSecret(roll: Roll): string {
  return `whsec_${draw(SECRET_TAIL, roll)}`;
}

export function newId(prefix: IdPrefix): string {
  return mintId(prefix, randomRoll);
}

export function newSecret(): string {
  return mintSecret(randomRoll);
}

/**
 * A stable number between 0 and 1 for an id. The simulated carrier uses it to decide what happens
 * to a message, so the same id always has the same fate however many times it is looked at.
 */
export function spread(value: string, salt = ''): number {
  let hash = 0x811c9dc5;
  const text = `${salt}${value}`;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x100000000;
}
