import type BetterSqlite3 from 'better-sqlite3'

export type AppCtx = {
  db: BetterSqlite3.Database
  dataRoot: string
  smtp: {
    smtpHost: string
    smtpPort: number
    smtpSecure: boolean
    smtpUser: string
    smtpPass: string
    smtpFrom: string
  }
}
