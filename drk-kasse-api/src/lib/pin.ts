import crypto from 'node:crypto'

/** Same as frontend: SHA-256 of UTF-8 pin string → hex */
export function sha256Hex(pin: string): string {
  return crypto.createHash('sha256').update(pin, 'utf8').digest('hex')
}
