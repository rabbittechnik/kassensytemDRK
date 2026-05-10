import fs from 'node:fs'
import path from 'node:path'

export function ensureDataDirs(root: string) {
  const dirs = [
    path.join(root, 'db'),
    path.join(root, 'receipts'),
    path.join(root, 'product-images'),
    path.join(root, 'daily-closing'),
    path.join(root, 'exports'),
    path.join(root, 'logs'),
    path.join(root, 'backups'),
    path.join(root, 'teams'),
    path.join(root, 'invoices', 'pdf'),
    path.join(root, 'invoices', 'email-log'),
    path.join(root, 'invoices', 'exports'),
  ]
  for (const d of dirs) {
    fs.mkdirSync(d, { recursive: true })
  }
  return path.join(root, 'db', 'kasse.sqlite')
}
