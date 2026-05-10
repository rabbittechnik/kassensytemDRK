import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'

export function appendAudit(params: {
  db: BetterSqlite3.Database
  dataRoot: string
  type: string
  userId?: string | null
  payload?: Record<string, unknown>
}) {
  const id = crypto.randomUUID()
  const createdAt = Date.now()
  const payloadJson = JSON.stringify(params.payload ?? {})
  params.db
    .prepare(
      `INSERT INTO audit_events (id, created_at, type, user_id, payload_json) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, createdAt, params.type, params.userId ?? null, payloadJson)

  const dir = path.join(params.dataRoot, 'logs')
  fs.mkdirSync(dir, { recursive: true })
  const day = new Date(createdAt).toISOString().slice(0, 10)
  const line =
    JSON.stringify({
      id,
      created_at: createdAt,
      type: params.type,
      user_id: params.userId ?? null,
      payload: params.payload ?? {},
    }) + '\n'
  fs.appendFileSync(path.join(dir, `audit-${day}.log`), line, 'utf8')
}
