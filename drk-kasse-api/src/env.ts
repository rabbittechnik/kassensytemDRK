import path from 'node:path'

/** z.B. `api` oder `/api`; leer = Routen wie bisher an der Wurzel `/` */
export function normalizeApiMountPath(raw?: string): string {
  const s = raw?.trim()
  if (!s) return ''
  const noSlashes = s.replace(/^\/+|\/+$/g, '')
  if (!noSlashes) return ''
  return `/${noSlashes.replace(/\/+/g, '/')}`
}

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (v === undefined) throw new Error(`Missing env ${name}`)
  return v
}

export function loadEnv() {
  const dataRoot = path.resolve(process.env.DATA_ROOT ?? './.data')
  return {
    port: parseInt(process.env.PORT ?? '8787', 10),
    dataRoot,
    apiMountPath: normalizeApiMountPath(process.env.API_MOUNT_PATH),
    jwtSecret: req('JWT_SECRET', 'dev-insecure-change-me'),
    corsOrigin:
      process.env.CORS_ORIGIN === '*'
        ? true
        : (process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? true),
    initialAdminPin: process.env.INITIAL_ADMIN_PIN ?? '1234',
    cashierPin: process.env.CASHIER_PIN ?? process.env.INITIAL_ADMIN_PIN ?? '1234',
    smtpHost: process.env.SMTP_HOST ?? '',
    smtpPort: parseInt(process.env.SMTP_PORT ?? '587', 10),
    smtpSecure: process.env.SMTP_SECURE === '1',
    smtpUser: process.env.SMTP_USER ?? '',
    smtpPass: process.env.SMTP_PASS ?? '',
    smtpFrom: process.env.SMTP_FROM ?? '',
  }
}
