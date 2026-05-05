import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import Database from 'better-sqlite3'
import { z } from 'zod'
import { loadEnv } from './env.js'
import { ensureDataDirs } from './paths.js'
import { migrate } from './db/migrate.js'
import { seedIfNeeded } from './seed.js'
import { sha256Hex } from './lib/pin.js'
import type { JwtUser } from './types.js'
import { appendAudit } from './audit.js'
import {
  createManualDepositRedemption,
  createHelperConsumption,
  createSale,
  getDepositVoucherByNumber,
  redeemDepositVoucher,
} from './services/sales.js'
import {
  createBackup,
  createDailyClosing,
  exportRecords,
  listBackups,
  reprintReceipt,
  stornoSale,
} from './services/compliance.js'
import {
  createCollectiveInvoice,
  deriveInvoiceFrontendStatus,
  listOpenInvoicePosts,
  listOpenSalesDetail,
  recordInvoicePayment,
  sendInvoiceEmail,
  stornoInvoice,
} from './services/invoices.js'
import { getSaleAvailability } from './services/saleAvailability.js'
import { registerSpaAssetsAndFallback } from './spaStatic.js'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: JwtUser
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    sqlite: Database.Database
    dataRoot: string
    dbPath: string
    smtpCfg: {
      host: string
      port: number
      secure: boolean
      user: string
      pass: string
      from: string
    }
  }
}

function isAdmin(role: JwtUser['role']) {
  return role === 'admin'
}

/** Methode hat Schreib-Semantik (sales, invoices, teams, ...). */
function isWriteMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

/** Wahr, wenn der Client per Header X-Demo-Mode: true sendet. */
function hasDemoHeader(headerVal: unknown): boolean {
  if (typeof headerVal === 'string') return headerVal.toLowerCase() === 'true'
  if (Array.isArray(headerVal))
    return headerVal.some((h) => String(h).toLowerCase() === 'true')
  return false
}

async function guardedRoutes(app: FastifyInstance) {
  /** Protect everything registered in this encapsulation */
  app.addHook('preHandler', async (req, reply) => {
    try {
      await req.jwtVerify()
    } catch {
      return reply.code(401).send({ error: 'AUTH' })
    }
  })

  /**
   * Demo-Schutz: Wenn der Client per Header `X-Demo-Mode: true` signalisiert,
   * dass die UI im Demo-Modus laeuft, lehnt das Backend JEDE Schreiboperation
   * ab. Lese-Endpunkte (Catalog, Events, Settings, Teams-Liste) bleiben frei
   * fuer eine sinnvolle Vorfuehrung. Audit-Endpunkt /audit/demo-mode ist
   * explizit ausgenommen, damit Demo-Aktivierung/-Verlassen geloggt werden
   * kann.
   */
  app.addHook('preHandler', async (req, reply) => {
    if (!hasDemoHeader(req.headers['x-demo-mode'])) return
    if (!isWriteMethod(req.method)) return
    const url = String(req.url ?? '')
    const path = url.split('?')[0] ?? url
    if (path.endsWith('/audit/demo-mode')) return
    return reply.code(403).send({ error: 'DEMO_REJECTED' })
  })

  app.get('/auth/me', async (req) => ({ user: req.user }))

  /**
   * Audit-Endpunkt fuer Demo-Modus-Aktivierung/-Verlassen.
   * Schreibt NUR ins existierende Audit-Log; niemals in Sales/Teams/etc.
   * Bewusst ausgenommen vom Demo-Guard, sodass dieser Eintrag selbst im
   * Demo-Modus verbucht werden darf.
   */
  app.post('/audit/demo-mode', async (req, reply) => {
    const b = z
      .object({ event: z.enum(['enter', 'leave']) })
      .parse(req.body ?? {})
    appendAudit({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      type: `demo_mode_${b.event}`,
      userId: req.user.sub,
      payload: { at: Date.now() },
    })
    return reply.send({ ok: true })
  })

  app.get('/catalog/categories', async (req) => {
    return req.server.sqlite
      .prepare(
        `SELECT id, name, sort_order as sortOrder FROM categories ORDER BY sort_order`,
      )
      .all()
  })

  app.get('/catalog/products', async (req) => {
    return req.server.sqlite
      .prepare(
        `SELECT id, category_id as categoryId, name,
         price_cents as priceCents, active, sort_order as sortOrder,
         vat_rate_percent as vatRatePercent,
         stock_tracking as stockTracking,
         stock_qty as stockQty,
         stock_min as stockMin,
         deposit_enabled as depositEnabled,
         deposit_amount as depositAmount,
         deposit_name as depositName,
         deposit_type as depositType
       FROM products ORDER BY category_id, sort_order`,
      )
      .all()
  })

  app.patch('/catalog/products/:id', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const id = String((req.params as { id: string }).id)
    const b = z
      .object({
        name: z.string().optional(),
        priceCents: z.number().int().nonnegative().optional(),
        active: z.boolean().optional(),
        stockTracking: z.boolean().optional(),
        stockQty: z.number().int().nullable().optional(),
        stockMin: z.number().int().nullable().optional(),
        depositEnabled: z.boolean().optional(),
        depositAmount: z.number().int().nonnegative().optional(),
        depositName: z.string().nullable().optional(),
        depositType: z.string().nullable().optional(),
      })
      .parse(req.body ?? {})
    const exists = app.sqlite.prepare(`SELECT id FROM products WHERE id = ?`).get(id)
    if (!exists) return reply.code(404).send({ error: 'NOT_FOUND' })
    app.sqlite
      .prepare(
        `UPDATE products SET
          name = COALESCE(?, name),
          price_cents = COALESCE(?, price_cents),
          active = COALESCE(?, active),
          stock_tracking = COALESCE(?, stock_tracking),
          stock_qty = COALESCE(?, stock_qty),
          stock_min = COALESCE(?, stock_min),
          deposit_enabled = COALESCE(?, deposit_enabled),
          deposit_amount = COALESCE(?, deposit_amount),
          deposit_name = COALESCE(?, deposit_name),
          deposit_type = COALESCE(?, deposit_type)
        WHERE id = ?`,
      )
      .run(
        b.name ?? null,
        b.priceCents ?? null,
        b.active == null ? null : b.active ? 1 : 0,
        b.stockTracking == null ? null : b.stockTracking ? 1 : 0,
        b.stockQty ?? null,
        b.stockMin ?? null,
        b.depositEnabled == null ? null : b.depositEnabled ? 1 : 0,
        b.depositAmount ?? null,
        b.depositName ?? null,
        b.depositType ?? null,
        id,
      )
    appendAudit({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      type: 'product_changed',
      userId: req.user.sub,
      payload: { id, keys: Object.keys(b) },
    })
    return { ok: true }
  })

  app.get('/settings', async (_req) => {
    const keys = [
      'org_name',
      'tax_mode',
      'tax_notice',
      'issuer_snapshot',
      'receipt_footer',
      'active_event_id',
      'allow_sales_without_event',
      'deposit_feature_enabled',
      'deposit_default_amount',
      'deposit_auto_print_voucher',
      'deposit_print_redemption_receipt',
      'deposit_show_on_output_bons',
      'helpers_deposit_enabled',
    ]
    const out: Record<string, string> = {}
    const st = app.sqlite.prepare(`SELECT value FROM settings WHERE key = ?`)
    for (const k of keys) {
      const r = st.get(k) as { value: string } | undefined
      out[k] = r?.value ?? ''
    }
    return out
  })

  app.patch('/settings', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const b = z
      .object({
        orgName: z.string().optional(),
        taxMode: z.string().optional(),
        taxNotice: z.string().optional(),
        issuerSnapshot: z.record(z.string(), z.unknown()).optional(),
        receiptFooter: z.string().optional(),
        activeEventId: z.string().nullable().optional(),
        allowSalesWithoutEvent: z.boolean().optional(),
        depositFeatureEnabled: z.boolean().optional(),
        depositDefaultAmount: z.number().int().nonnegative().optional(),
        depositAutoPrintVoucher: z.boolean().optional(),
        depositPrintRedemptionReceipt: z.boolean().optional(),
        depositShowOnOutputBons: z.boolean().optional(),
        helpersDepositEnabled: z.boolean().optional(),
      })
      .parse(req.body ?? {})

    const stmt = app.sqlite.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)`)

    const jsonify = <T extends object>(obj: T) => JSON.stringify(obj)

    if (b.orgName !== undefined) stmt.run('org_name', b.orgName)
    if (b.taxMode !== undefined) stmt.run('tax_mode', b.taxMode)
    if (b.taxNotice !== undefined) stmt.run('tax_notice', b.taxNotice)
    if (b.issuerSnapshot !== undefined) stmt.run('issuer_snapshot', jsonify(b.issuerSnapshot))
    if (b.receiptFooter !== undefined) stmt.run('receipt_footer', b.receiptFooter)
    if (b.activeEventId !== undefined) stmt.run('active_event_id', b.activeEventId ?? '')
    if (b.allowSalesWithoutEvent !== undefined)
      stmt.run('allow_sales_without_event', b.allowSalesWithoutEvent ? '1' : '0')
    if (b.depositFeatureEnabled !== undefined)
      stmt.run('deposit_feature_enabled', b.depositFeatureEnabled ? '1' : '0')
    if (b.depositDefaultAmount !== undefined)
      stmt.run('deposit_default_amount', String(b.depositDefaultAmount))
    if (b.depositAutoPrintVoucher !== undefined)
      stmt.run('deposit_auto_print_voucher', b.depositAutoPrintVoucher ? '1' : '0')
    if (b.depositPrintRedemptionReceipt !== undefined)
      stmt.run(
        'deposit_print_redemption_receipt',
        b.depositPrintRedemptionReceipt ? '1' : '0',
      )
    if (b.depositShowOnOutputBons !== undefined)
      stmt.run('deposit_show_on_output_bons', b.depositShowOnOutputBons ? '1' : '0')
    if (b.helpersDepositEnabled !== undefined)
      stmt.run('helpers_deposit_enabled', b.helpersDepositEnabled ? '1' : '0')

    appendAudit({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      type: 'settings_changed',
      userId: req.user.sub,
      payload: { keys: Object.keys(b) },
    })

    return { ok: true }
  })

  app.get('/teams', async (req, reply) => {
    const qRaw = typeof (req.query as { q?: unknown }).q
    const q = typeof qRaw === 'string' ? qRaw.trim() : ''

    if (!(isAdmin(req.user.role) || req.user.role === 'cashier')) {
      return reply.code(403).send({ error: 'FORBIDDEN' })
    }

    return q.trim()
      ? app.sqlite
          .prepare(
            `SELECT * FROM teams WHERE active = 1 AND name LIKE '%'||?||'%' ORDER BY name COLLATE NOCASE`,
          )
          .all(q.trim())
      : app.sqlite.prepare(`SELECT * FROM teams WHERE active = 1 ORDER BY name COLLATE NOCASE`).all()
  })

  app.get('/teams/all', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    return app.sqlite.prepare(`SELECT * FROM teams ORDER BY name COLLATE NOCASE`).all()
  })

  app.post('/teams/seed-demo', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const n = (app.sqlite.prepare(`SELECT COUNT(*) as c FROM teams`).get() as { c: number }).c
    if (n > 0) return reply.code(409).send({ error: 'TEAMS_EXIST' })
    const now = Date.now()
    const demo = [
      { name: 'DLRG Mössingen', short: 'Mössingen' },
      { name: 'DLRG Tübingen', short: 'Tübingen' },
      { name: 'DLRG Rottenburg', short: 'Rottenburg' },
    ]
    const ins = app.sqlite.prepare(
      `INSERT INTO teams (
        id, name, short_name, contact_name, invoice_email, phone, billing_address,
        customer_no, internal_note, active, default_payment_days,
        cost_center, department, local_group, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    for (const d of demo) {
      ins.run(
        crypto.randomUUID(),
        d.name,
        d.short,
        '',
        '',
        '',
        '',
        null,
        '',
        1,
        14,
        null,
        null,
        null,
        now,
        now,
      )
    }
    appendAudit({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      type: 'team_seed_demo',
      userId: req.user.sub,
      payload: { count: demo.length },
    })
    return { ok: true, created: demo.length }
  })

  app.get('/teams/:id', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const tid = String((req.params as { id: string }).id)
    const row = app.sqlite.prepare(`SELECT * FROM teams WHERE id = ?`).get(tid)
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND' })
    return row
  })

  app.post('/teams', async (req, reply) => {
    const canCreateTeam =
      isAdmin(req.user.role) || req.user.role === 'cashier'
    if (!canCreateTeam) return reply.code(403).send({ error: 'FORBIDDEN' })
    const b = z
      .object({
        name: z.string(),
        shortName: z.string().optional(),
        contactName: z.string().optional(),
        invoiceEmail: z.string().optional(),
        phone: z.string().optional(),
        billingAddress: z.string().optional().default(''),
        customerNo: z.string().optional(),
        internalNote: z.string().optional(),
        defaultPaymentDays: z.number().int().optional(),
        active: z.boolean().optional(),
        costCenter: z.string().optional(),
        department: z.string().optional(),
        localGroup: z.string().optional(),
      })
      .parse(req.body ?? {})

    const id = crypto.randomUUID()
    const now = Date.now()
    app.sqlite
      .prepare(
        `INSERT INTO teams (
          id, name, short_name, contact_name, invoice_email, phone, billing_address,
          customer_no, internal_note, active, default_payment_days,
          cost_center, department, local_group, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        b.name,
        b.shortName ?? null,
        b.contactName ?? '',
        b.invoiceEmail ?? '',
        b.phone ?? '',
        b.billingAddress ?? '',
        b.customerNo ?? null,
        b.internalNote ?? '',
        b.active === false ? 0 : 1,
        b.defaultPaymentDays ?? 14,
        b.costCenter ?? null,
        b.department ?? null,
        b.localGroup ?? null,
        now,
        now,
      )

    appendAudit({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      type: 'team_upsert',
      userId: req.user.sub,
      payload: { id },
    })

    return { id }
  })

  app.patch('/teams/:id', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const tid = String((req.params as { id: string }).id)

    const b = z
      .object({
        name: z.string().optional(),
        shortName: z.string().nullable().optional(),
        contactName: z.string().optional(),
        invoiceEmail: z.string().optional(),
        phone: z.string().optional(),
        billingAddress: z.string().optional(),
        customerNo: z.string().nullable().optional(),
        internalNote: z.string().optional(),
        defaultPaymentDays: z.number().int().optional(),
        active: z.boolean().optional(),
        costCenter: z.string().nullable().optional(),
        department: z.string().nullable().optional(),
        localGroup: z.string().nullable().optional(),
      })
      .parse(req.body ?? {})

    const prev = app.sqlite.prepare(`SELECT id FROM teams WHERE id=?`).get(tid)
    if (!prev) return reply.code(404).send({ error: 'NOT_FOUND' })

    const activeVal =
      b.active === undefined
        ? null
        : b.active
          ? 1
          : 0

    app.sqlite
      .prepare(
        `UPDATE teams SET
           name = COALESCE(?, name),
           short_name = COALESCE(?, short_name),
           contact_name = COALESCE(?, contact_name),
           invoice_email = COALESCE(?, invoice_email),
           phone = COALESCE(?, phone),
           billing_address = COALESCE(?, billing_address),
           customer_no = COALESCE(?, customer_no),
           internal_note = COALESCE(?, internal_note),
           default_payment_days = COALESCE(?, default_payment_days),
           active = COALESCE(?, active),
           cost_center = COALESCE(?, cost_center),
           department = COALESCE(?, department),
           local_group = COALESCE(?, local_group),
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        b.name ?? null,
        b.shortName === undefined ? null : b.shortName,
        b.contactName ?? null,
        b.invoiceEmail ?? null,
        b.phone ?? null,
        b.billingAddress ?? null,
        b.customerNo ?? null,
        b.internalNote ?? null,
        b.defaultPaymentDays ?? null,
        activeVal,
        b.costCenter ?? null,
        b.department ?? null,
        b.localGroup ?? null,
        Date.now(),
        tid,
      )

    appendAudit({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      type: 'team_upsert',
      userId: req.user.sub,
      payload: { id: tid },
    })

    return { ok: true }
  })

  app.put('/teams/:id', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const tid = String((req.params as { id: string }).id)
    const b = z
      .object({
        name: z.string().optional(),
        shortName: z.string().nullable().optional(),
        contactName: z.string().optional(),
        invoiceEmail: z.string().optional(),
        phone: z.string().optional(),
        billingAddress: z.string().optional(),
        customerNo: z.string().nullable().optional(),
        internalNote: z.string().optional(),
        defaultPaymentDays: z.number().int().optional(),
        active: z.boolean().optional(),
        costCenter: z.string().nullable().optional(),
        department: z.string().nullable().optional(),
        localGroup: z.string().nullable().optional(),
      })
      .parse(req.body ?? {})
    const prev = app.sqlite.prepare(`SELECT id FROM teams WHERE id=?`).get(tid)
    if (!prev) return reply.code(404).send({ error: 'NOT_FOUND' })
    const activeVal = b.active === undefined ? null : b.active ? 1 : 0
    app.sqlite
      .prepare(
        `UPDATE teams SET
           name = COALESCE(?, name),
           short_name = COALESCE(?, short_name),
           contact_name = COALESCE(?, contact_name),
           invoice_email = COALESCE(?, invoice_email),
           phone = COALESCE(?, phone),
           billing_address = COALESCE(?, billing_address),
           customer_no = COALESCE(?, customer_no),
           internal_note = COALESCE(?, internal_note),
           default_payment_days = COALESCE(?, default_payment_days),
           active = COALESCE(?, active),
           cost_center = COALESCE(?, cost_center),
           department = COALESCE(?, department),
           local_group = COALESCE(?, local_group),
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        b.name ?? null,
        b.shortName === undefined ? null : b.shortName,
        b.contactName ?? null,
        b.invoiceEmail ?? null,
        b.phone ?? null,
        b.billingAddress ?? null,
        b.customerNo ?? null,
        b.internalNote ?? null,
        b.defaultPaymentDays ?? null,
        activeVal,
        b.costCenter ?? null,
        b.department ?? null,
        b.localGroup ?? null,
        Date.now(),
        tid,
      )
    appendAudit({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      type: 'team_upsert',
      userId: req.user.sub,
      payload: { id: tid, method: 'PUT' },
    })
    return { ok: true }
  })

  app.patch('/teams/:id/status', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const tid = String((req.params as { id: string }).id)
    const b = z.object({ active: z.boolean() }).parse(req.body ?? {})
    const prev = app.sqlite.prepare(`SELECT id FROM teams WHERE id=?`).get(tid)
    if (!prev) return reply.code(404).send({ error: 'NOT_FOUND' })
    app.sqlite
      .prepare(`UPDATE teams SET active = ?, updated_at = ? WHERE id = ?`)
      .run(b.active ? 1 : 0, Date.now(), tid)
    appendAudit({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      type: 'team_status',
      userId: req.user.sub,
      payload: { id: tid, active: b.active },
    })
    return { ok: true }
  })

  app.delete('/teams/:id', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const tid = String((req.params as { id: string }).id)
    const prev = app.sqlite.prepare(`SELECT id FROM teams WHERE id=?`).get(tid)
    if (!prev) return reply.code(404).send({ error: 'NOT_FOUND' })
    app.sqlite.prepare(`UPDATE teams SET active = 0, updated_at = ? WHERE id = ?`).run(Date.now(), tid)
    appendAudit({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      type: 'team_archived',
      userId: req.user.sub,
      payload: { id: tid },
    })
    return { ok: true, archived: true }
  })

  app.get('/events', async () =>
    app.sqlite
      .prepare(
        `SELECT id, name,
           start_date AS startDate, end_date AS endDate,
           start_time AS startTime, end_time AS endTime,
           location, description,
           status, created_at AS createdAt, updated_at AS updatedAt, closed_at AS closedAt
         FROM events ORDER BY start_date DESC`,
      )
      .all(),
  )

  app.get('/events/active', async () => {
    const availability = getSaleAvailability({ db: app.sqlite })
    if (availability.mode !== 'event' || !availability.activeEvent) return null
    const ev = app.sqlite
      .prepare(
        `SELECT id, name,
           start_date AS startDate, end_date AS endDate,
           start_time AS startTime, end_time AS endTime,
           location, description,
           status, created_at AS createdAt, updated_at AS updatedAt, closed_at AS closedAt
         FROM events WHERE id = ?`,
      )
      .get(availability.activeEvent.id) as Record<string, unknown> | undefined
    return ev ?? null
  })

  app.get('/sales/availability', async () => {
    const a = getSaleAvailability({ db: app.sqlite })
    return {
      canSell: a.canSell,
      mode: a.mode,
      reason: a.reason,
      allowStandardSale: a.allowStandardSale,
      activeEvent:
        a.activeEvent ?
          {
            id: a.activeEvent.id,
            name: a.activeEvent.name,
            status: a.activeEvent.status,
            startDate: a.activeEvent.start_date,
            endDate: a.activeEvent.end_date,
            startTime: a.activeEvent.start_time,
            endTime: a.activeEvent.end_time,
          }
        : null,
    }
  })

  app.post('/events', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })

    const b = z
      .object({
        name: z.string().min(1),
        startDate: z.string(),
        endDate: z.string(),
        startTime: z.string().optional().nullable(),
        endTime: z.string().optional().nullable(),
        location: z.string().optional().nullable(),
        description: z.string().optional().nullable(),
        status: z.enum(['planned', 'active', 'completed', 'archived']).optional(),
      })
      .parse(req.body ?? {})

    const id = crypto.randomUUID()
    const now = Date.now()
    const status = b.status ?? 'planned'
    app.sqlite
      .prepare(
        `INSERT INTO events (
          id, name, start_date, end_date, start_time, end_time, location, description,
          status, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        b.name.trim(),
        b.startDate.slice(0, 10),
        b.endDate.slice(0, 10),
        b.startTime?.trim() || null,
        b.endTime?.trim() || null,
        b.location?.trim() || null,
        b.description?.trim() || null,
        status,
        now,
        now,
      )

    appendAudit({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      type: 'event_upsert',
      userId: req.user.sub,
      payload: { id },
    })
    return { id }
  })

  app.patch('/events/:id', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const eid = String((req.params as { id: string }).id)
    const exists = app.sqlite.prepare(`SELECT id, status FROM events WHERE id = ?`).get(eid) as
      | { id: string; status: string }
      | undefined
    if (!exists) return reply.code(404).send({ error: 'NOT_FOUND' })
    if (exists.status === 'completed' || exists.status === 'archived') {
      return reply.code(400).send({ error: 'EVENT_LOCKED' })
    }

    const b = z
      .object({
        name: z.string().min(1).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        startTime: z.string().nullable().optional(),
        endTime: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
      })
      .parse(req.body ?? {})

    const cur = app.sqlite
      .prepare(
        `SELECT name, start_date, end_date, start_time, end_time, location, description
         FROM events WHERE id = ?`,
      )
      .get(eid) as
      | {
          name: string
          start_date: string
          end_date: string
          start_time: string | null
          end_time: string | null
          location: string | null
          description: string | null
        }
      | undefined
    if (!cur) return reply.code(404).send({ error: 'NOT_FOUND' })

    const name = b.name !== undefined ? b.name.trim() : cur.name
    const startDate = b.startDate !== undefined ? b.startDate.slice(0, 10) : cur.start_date
    const endDate = b.endDate !== undefined ? b.endDate.slice(0, 10) : cur.end_date
    const startTime =
      b.startTime === undefined ? cur.start_time
      : b.startTime ? b.startTime.trim()
      : null
    const endTime =
      b.endTime === undefined ? cur.end_time
      : b.endTime ? b.endTime.trim()
      : null
    const location =
      b.location === undefined ? cur.location
      : b.location ? b.location.trim()
      : null
    const description =
      b.description === undefined ? cur.description
      : b.description ? b.description.trim()
      : null

    const now = Date.now()
    app.sqlite
      .prepare(
        `UPDATE events SET
          name = ?, start_date = ?, end_date = ?, start_time = ?, end_time = ?,
          location = ?, description = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(name, startDate, endDate, startTime, endTime, location, description, now, eid)

    appendAudit({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      type: 'event_updated',
      userId: req.user.sub,
      payload: { id: eid },
    })
    return { ok: true }
  })

  app.post('/events/:id/activate', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const eid = String((req.params as { id: string }).id)
    const ev = app.sqlite.prepare(`SELECT id, status FROM events WHERE id = ?`).get(eid) as
      | { id: string; status: string }
      | undefined
    if (!ev) return reply.code(404).send({ error: 'NOT_FOUND' })
    if (ev.status === 'completed' || ev.status === 'archived') {
      return reply.code(400).send({ error: 'EVENT_NOT_ACTIVATABLE' })
    }
    const now = Date.now()
    app.sqlite.prepare(`UPDATE events SET status = 'planned', updated_at = ? WHERE status = 'active'`).run(now)
    app.sqlite.prepare(`UPDATE events SET status = 'active', updated_at = ? WHERE id = ?`).run(now, eid)
    app.sqlite
      .prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('active_event_id', ?)`)
      .run(eid)

    appendAudit({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      type: 'event_activated',
      userId: req.user.sub,
      payload: { id: eid },
    })
    return { ok: true }
  })

  app.post('/events/:id/complete', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const eid = String((req.params as { id: string }).id)
    const ev = app.sqlite.prepare(`SELECT id FROM events WHERE id = ?`).get(eid) as { id: string } | undefined
    if (!ev) return reply.code(404).send({ error: 'NOT_FOUND' })
    const now = Date.now()
    app.sqlite
      .prepare(
        `UPDATE events SET status = 'completed', closed_at = COALESCE(closed_at, ?), updated_at = ? WHERE id = ?`,
      )
      .run(now, now, eid)
    app.sqlite
      .prepare(`UPDATE settings SET value = '' WHERE key = 'active_event_id' AND value = ?`)
      .run(eid)

    appendAudit({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      type: 'event_completed',
      userId: req.user.sub,
      payload: { id: eid },
    })
    return { ok: true }
  })

  app.post('/events/:id/archive', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const eid = String((req.params as { id: string }).id)
    const ev = app.sqlite.prepare(`SELECT id FROM events WHERE id = ?`).get(eid) as { id: string } | undefined
    if (!ev) return reply.code(404).send({ error: 'NOT_FOUND' })
    const now = Date.now()
    app.sqlite.prepare(`UPDATE events SET status = 'archived', updated_at = ? WHERE id = ?`).run(now, eid)
    app.sqlite
      .prepare(`UPDATE settings SET value = '' WHERE key = 'active_event_id' AND value = ?`)
      .run(eid)

    appendAudit({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      type: 'event_archived',
      userId: req.user.sub,
      payload: { id: eid },
    })
    return { ok: true }
  })

  /** @deprecated Nutzt POST /events/:id/complete */
  app.post('/events/:id/close', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const eid = String((req.params as { id: string }).id)
    const ev = app.sqlite.prepare(`SELECT id FROM events WHERE id = ?`).get(eid) as { id: string } | undefined
    if (!ev) return reply.code(404).send({ error: 'NOT_FOUND' })
    const now = Date.now()
    app.sqlite
      .prepare(
        `UPDATE events SET status = 'completed', closed_at = COALESCE(closed_at, ?), updated_at = ? WHERE id = ?`,
      )
      .run(now, now, eid)
    app.sqlite
      .prepare(`UPDATE settings SET value = '' WHERE key = 'active_event_id' AND value = ?`)
      .run(eid)

    appendAudit({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      type: 'event_closed',
      userId: req.user.sub,
      payload: { id: eid },
    })
    return { ok: true }
  })

  const paymentSchema = z.discriminatedUnion('method', [
    z.object({ method: z.literal('cash'), amountTenderedCents: z.number().int().nonnegative() }),
    z.object({ method: z.literal('card') }),
    z.object({
      method: z.literal('invoice'),
      teamId: z.string(),
      eventId: z.string(),
      contactName: z.string().optional(),
      note: z.string().optional(),
    }),
  ])

  app.post('/sales', async (req, reply) => {
    try {
      const body = z
        .object({
          lines: z.array(
            z.object({
              productId: z.string(),
              qty: z.number().int().positive(),
              unitPriceCents: z.number().int().optional(),
              name: z.string().optional(),
            }),
          ),
          payment: paymentSchema,
          clientUuid: z.string().optional(),
          eventId: z.string().nullable().optional(),
        })
        .parse(req.body ?? {})

      return await createSale({
        db: app.sqlite,
        dataRoot: app.dataRoot,
        user: req.user,
        lines: body.lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          unitPriceCents: l.unitPriceCents ?? -1,
          name: l.name,
        })),
        payment: body.payment,
        clientUuid: body.clientUuid,
        saleEventId: body.eventId,
      })
    } catch (e) {
      const msg = String((e as Error).message)
      req.server.log.warn(e as Error)

      const known = new Set([
        'EMPTY_CART',
        'INSUFFICIENT_CASH',
        'OUT_OF_STOCK',
        'INVALID_TEAM',
        'INVALID_EVENT',
        'NO_EVENT',
        'EVENT_NOT_ACTIVE',
        'EVENT_NOT_STARTED',
        'EVENT_ENDED',
      ])

      if (msg === 'NO_SALE_PERMISSION') {
        return reply.code(403).send({
          error: msg,
          message:
            'Verkauf nicht erlaubt: Keine aktive Veranstaltung und Standardverkauf deaktiviert.',
        })
      }
      return known.has(msg)
        ? reply.code(400).send({ error: msg })
        : reply.code(500).send({ error: 'INTERNAL' })
    }
  })

  app.get('/deposit-vouchers/:voucherNumber', async (req, reply) => {
    const voucherNumber = String((req.params as { voucherNumber: string }).voucherNumber)
    const row = getDepositVoucherByNumber({ db: app.sqlite, voucherNumber })
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND' })
    return row
  })

  app.post('/deposit-vouchers/redeem', async (req, reply) => {
    try {
      const body = z
        .object({
          voucherNumber: z.string().min(3),
          note: z.string().optional(),
        })
        .parse(req.body ?? {})
      return redeemDepositVoucher({
        db: app.sqlite,
        dataRoot: app.dataRoot,
        user: req.user,
        voucherNumber: body.voucherNumber,
        note: body.note,
      })
    } catch (e) {
      const msg = String((e as Error).message)
      const known = new Set([
        'DEPOSIT_VOUCHER_NOT_FOUND',
        'DEPOSIT_VOUCHER_ALREADY_REDEEMED',
        'DEPOSIT_VOUCHER_CANCELLED',
      ])
      return known.has(msg)
        ? reply.code(400).send({ error: msg })
        : reply.code(500).send({ error: 'INTERNAL' })
    }
  })

  app.post('/deposit-redemptions/manual', async (req, reply) => {
    try {
      const body = z
        .object({
          eventId: z.string().nullable().optional(),
          quantity: z.number().int().positive(),
          amountCents: z.number().int().positive(),
          depositName: z.string().optional(),
          depositType: z.string().nullable().optional(),
          note: z.string().optional(),
        })
        .parse(req.body ?? {})
      return createManualDepositRedemption({
        db: app.sqlite,
        dataRoot: app.dataRoot,
        user: req.user,
        eventId: body.eventId ?? null,
        quantity: body.quantity,
        amountCents: body.amountCents,
        depositName: body.depositName,
        depositType: body.depositType ?? null,
        note: body.note,
      })
    } catch (e) {
      const msg = String((e as Error).message)
      const known = new Set(['INVALID_QUANTITY', 'INVALID_AMOUNT'])
      return known.has(msg)
        ? reply.code(400).send({ error: msg })
        : reply.code(500).send({ error: 'INTERNAL' })
    }
  })

  app.post('/helper-consumptions', async (req, reply) => {
    try {
      const body = z
        .object({
          eventId: z.string().nullable().optional(),
          note: z.string().optional(),
          lines: z.array(
            z.object({
              productId: z.string(),
              qty: z.number().int().positive(),
              unitPriceCents: z.number().int().nonnegative().optional(),
              name: z.string().optional(),
            }),
          ),
        })
        .parse(req.body ?? {})
      return createHelperConsumption({
        db: app.sqlite,
        dataRoot: app.dataRoot,
        user: req.user,
        eventId: body.eventId ?? null,
        note: body.note,
        lines: body.lines,
      })
    } catch (e) {
      const msg = String((e as Error).message)
      const known = new Set(['EMPTY_CART', 'OUT_OF_STOCK'])
      return known.has(msg)
        ? reply.code(400).send({ error: msg })
        : reply.code(500).send({ error: 'INTERNAL' })
    }
  })

  app.post('/sales/:id/storno', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const saleId = String((req.params as { id: string }).id)
    const body = z.object({ reason: z.string().optional() }).parse(req.body ?? {})
    try {
      return stornoSale({
        db: app.sqlite,
        dataRoot: app.dataRoot,
        user: req.user,
        saleId,
        reason: body.reason,
      })
    } catch (e) {
      const m = String((e as Error).message)
      if (['NOT_FOUND', 'ALREADY_STORNOED', 'DAY_CLOSED'].includes(m)) {
        return reply.code(400).send({ error: m })
      }
      return reply.code(500).send({ error: 'INTERNAL' })
    }
  })

  app.post('/receipts/:saleId/reprint', async (req, reply) => {
    if (!(isAdmin(req.user.role) || req.user.role === 'cashier')) {
      return reply.code(403).send({ error: 'FORBIDDEN' })
    }
    const saleId = String((req.params as { saleId: string }).saleId)
    const body = z.object({ reason: z.string().optional() }).parse(req.body ?? {})
    try {
      return reprintReceipt({
        db: app.sqlite,
        dataRoot: app.dataRoot,
        user: req.user,
        saleId,
        reason: body.reason,
      })
    } catch {
      return reply.code(404).send({ error: 'NOT_FOUND' })
    }
  })

  app.get('/receipts/:saleId/pdf', async (req, reply) => {
    const saleId = String((req.params as { saleId: string }).saleId)
    const row = app.sqlite
      .prepare(`SELECT receipt_pdf_rel_path FROM sales WHERE id = ?`)
      .get(saleId) as { receipt_pdf_rel_path: string } | undefined
    if (!row?.receipt_pdf_rel_path) return reply.code(404).send({ error: 'NOT_FOUND' })
    const abs = path.join(app.dataRoot, row.receipt_pdf_rel_path.replace(/\//g, path.sep))
    if (!fs.existsSync(abs)) return reply.code(404).send({ error: 'NOT_FOUND' })
    reply.type('application/pdf')
    reply.header('Content-Disposition', `inline; filename="${path.basename(abs)}"`)
    return reply.send(Buffer.from(fs.readFileSync(abs)))
  })

  app.post('/daily-closings/create', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const b = z
      .object({
        dayKey: z.string().optional(),
        actualCashDrawerCents: z.number().int().optional(),
        eventId: z.string().nullable().optional(),
      })
      .parse(req.body ?? {})
    try {
      const activeRow = app.sqlite
        .prepare(`SELECT value FROM settings WHERE key = 'active_event_id'`)
        .get() as { value: string } | undefined
      const eventId =
        b.eventId !== undefined && b.eventId !== null ? b.eventId.trim() || null : activeRow?.value?.trim() || null

      const backupRel = createBackup({
        dbPath: app.dbPath,
        dataRoot: app.dataRoot,
        reason: 'pre-day-closing',
      })
      const closing = await createDailyClosing({
        db: app.sqlite,
        dataRoot: app.dataRoot,
        user: req.user,
        day: b.dayKey ?? new Date().toISOString().slice(0, 10),
        actualCashDrawerCents: b.actualCashDrawerCents,
        eventId,
      })
      return { ...closing, backupRel }
    } catch (e) {
      const m = String((e as Error).message)
      return reply.code(400).send({ error: m })
    }
  })

  app.get('/daily-closings', async () =>
    app.sqlite
      .prepare(
        `SELECT id, closing_number as closingNumber, day_key as dayKey,
          event_id as eventId,
          period_start as periodStart, period_end as periodEnd, gross_total_cents as grossTotalCents,
          deposit_collected_cents as depositCollectedCents,
          deposit_paid_out_cents as depositPaidOutCents,
          deposit_balance_cents as depositBalanceCents,
          created_at as createdAt
         FROM day_closings ORDER BY created_at DESC LIMIT 180`,
      )
      .all(),
  )

  app.get('/daily-closings/:id/file', async (req, reply) => {
    const id = String((req.params as { id: string }).id)
    const kindRaw = (req.query as { kind?: unknown }).kind
    const kind = kindRaw === 'csv' ? 'csv' : 'pdf'
    const row = app.sqlite
      .prepare(`SELECT csv_rel_path, pdf_rel_path FROM day_closings WHERE id = ?`)
      .get(id) as { csv_rel_path: string; pdf_rel_path: string } | undefined
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND' })
    const rel = kind === 'csv' ? row.csv_rel_path : row.pdf_rel_path
    const abs = path.join(app.dataRoot, rel.replace(/\//g, path.sep))
    if (!fs.existsSync(abs)) return reply.code(404).send({ error: 'NOT_FOUND' })
    reply.type(kind === 'csv' ? 'text/csv' : 'application/pdf')
    reply.header('Content-Disposition', `attachment; filename="${path.basename(abs)}"`)
    return reply.send(Buffer.from(fs.readFileSync(abs)))
  })

  app.post('/exports/records', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const b = z
      .object({
        fromTs: z.number().int(),
        toTs: z.number().int(),
      })
      .parse(req.body ?? {})
    const out = exportRecords({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      user: req.user,
      fromTs: b.fromTs,
      toTs: b.toTs,
    })
    return out
  })

  app.get('/exports/file', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const rel = String((req.query as { rel: string }).rel ?? '')
    if (!rel.startsWith('exports/')) return reply.code(400).send({ error: 'BAD_PATH' })
    const abs = path.join(app.dataRoot, rel.replace(/\//g, path.sep))
    if (!fs.existsSync(abs)) return reply.code(404).send({ error: 'NOT_FOUND' })
    reply.type('application/zip')
    reply.header('Content-Disposition', `attachment; filename="${path.basename(abs)}"`)
    return reply.send(Buffer.from(fs.readFileSync(abs)))
  })

  app.post('/backups/create', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const b = z.object({ reason: z.string().optional() }).parse(req.body ?? {})
    const relPath = createBackup({
      dbPath: app.dbPath,
      dataRoot: app.dataRoot,
      reason: (b.reason ?? 'manual').replace(/[^\w\-]+/g, '_'),
    })
    appendAudit({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      type: 'backup_created',
      userId: req.user.sub,
      payload: { relPath },
    })
    return { relPath }
  })

  app.get('/backups', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    return listBackups(app.dataRoot)
  })

  app.get('/backups/file', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const name = String((req.query as { name: string }).name ?? '')
    if (!name.endsWith('.sqlite')) return reply.code(400).send({ error: 'BAD_FILE' })
    const abs = path.join(app.dataRoot, 'backups', name)
    if (!fs.existsSync(abs)) return reply.code(404).send({ error: 'NOT_FOUND' })
    reply.type('application/octet-stream')
    reply.header('Content-Disposition', `attachment; filename="${path.basename(name)}"`)
    return reply.send(Buffer.from(fs.readFileSync(abs)))
  })

  app.get('/invoice-open-posts', async (req, reply) => {
    if (!(isAdmin(req.user.role) || req.user.role === 'cashier'))
      return reply.code(403).send({ error: 'FORBIDDEN' })

    const eidRaw = typeof (req.query as { eventId?: unknown }).eventId

    const eid =
      typeof eidRaw === 'string' && eidRaw.trim() ? eidRaw.trim() : undefined

    return listOpenInvoicePosts(app.sqlite, eid)
  })

  app.get('/teams/:id/open-sales', async (req, reply) => {
    if (!(isAdmin(req.user.role) || req.user.role === 'cashier'))
      return reply.code(403).send({ error: 'FORBIDDEN' })

    const teamId = String((req.params as { id: string }).id)

    const eidRaw = typeof (req.query as { eventId?: unknown }).eventId

    if (typeof eidRaw !== 'string' || !eidRaw.trim()) {
      return reply.code(400).send({ error: 'MISSING_EVENT' })
    }

    return listOpenSalesDetail(app.sqlite, teamId, eidRaw.trim())
  })

  app.post('/invoices/collective', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })

    const body = z
      .object({
        teamId: z.string(),
        eventId: z.string(),
        attachReceiptDetails: z.boolean().optional(),
      })
      .parse(req.body ?? {})

    try {
      return await createCollectiveInvoice({
        db: app.sqlite,
        dataRoot: app.dataRoot,
        user: req.user,
        teamId: body.teamId,
        eventId: body.eventId,
        attachReceiptDetails: body.attachReceiptDetails,
      })
    } catch (e) {
      req.server.log.error(e as Error)
      return reply.code(400).send({ error: 'COLLECT_FAILED' })
    }
  })

  app.get('/invoices/list', async (req, reply) => {
    if (!(isAdmin(req.user.role) || req.user.role === 'cashier')) {
      return reply.code(403).send({ error: 'FORBIDDEN' })
    }

    let sql = `SELECT * FROM invoices WHERE 1=1`
    const args: unknown[] = []

    const teamIdRaw = typeof (req.query as { teamId?: unknown }).teamId
    if (typeof teamIdRaw === 'string' && teamIdRaw.trim()) {
      sql += ` AND team_id = ?`
      args.push(teamIdRaw.trim())
    }

    const eventIdRaw = typeof (req.query as { eventId?: unknown }).eventId

    if (typeof eventIdRaw === 'string' && eventIdRaw.trim()) {
      sql += ` AND event_id = ?`
      args.push(eventIdRaw.trim())
    }

    const statusRaw = typeof (req.query as { status?: unknown }).status

    if (typeof statusRaw === 'string' && statusRaw.trim()) {
      sql += ` AND status = ?`
      args.push(statusRaw.trim())
    }

    const numRaw = typeof (req.query as { invoiceNo?: unknown }).invoiceNo

    if (typeof numRaw === 'string' && numRaw.trim()) {
      sql += ` AND invoice_no LIKE '%'||?||'%'`
      args.push(numRaw.trim())
    }

    sql += ` ORDER BY created_at DESC LIMIT 400`

    const rows = app.sqlite.prepare(sql).all(...args) as Record<string, unknown>[]

    return rows.map((r) => ({
      ...r,
      invoiceNo: r.invoice_no,
      derivedStatus: deriveInvoiceFrontendStatus({
        status: r.status as string,
        due_date: String(r.due_date ?? ''),
        total_cents: Number(r.total_cents ?? 0),
      }),
    }))
  })

  app.get('/invoices/:invoiceId/pdf', async (req, reply) => {
    if (!(isAdmin(req.user.role) || req.user.role === 'cashier')) {
      return reply.code(403).send({ error: 'FORBIDDEN' })
    }
    const id = String((req.params as { invoiceId: string }).invoiceId)

    const inv = app.sqlite.prepare(`SELECT pdf_rel_path FROM invoices WHERE id = ?`).get(id) as
      | { pdf_rel_path: string }
      | undefined

    if (!inv?.pdf_rel_path) return reply.code(404).send({ error: 'NOT_FOUND' })

    appendAudit({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      type: 'invoice_downloaded',
      userId: req.user.sub,
      payload: { invoiceId: id },
    })

    const absPath = path.join(app.dataRoot, inv.pdf_rel_path.replace(/\//g, path.sep))
    reply.type('application/pdf')
    reply.header(
      'Content-Disposition',
      `attachment; filename="${path.basename(inv.pdf_rel_path)}"`,
    )

    return reply.send(Buffer.from(fs.readFileSync(absPath)))
  })

  app.post('/invoices/:invoiceId/email', async (req, reply) => {
    if (!isAdmin(req.user.role))
      /** */

      return reply.code(403).send({ error: 'FORBIDDEN' })

    const id = String((req.params as { invoiceId: string }).invoiceId)
    try {
      await sendInvoiceEmail({
        db: app.sqlite,
        dataRoot: app.dataRoot,
        user: req.user,
        invoiceId: id,
        mailer: {
          smtpHost: app.smtpCfg.host,
          smtpPort: app.smtpCfg.port,
          smtpSecure: app.smtpCfg.secure,
          smtpUser: app.smtpCfg.user,
          smtpPass: app.smtpCfg.pass,
          smtpFrom: app.smtpCfg.from,
        },
      })

      return { ok: true }
    } catch (e) {
      req.server.log.error(e as Error)
      return reply
        .code(400)
        .send({ error: 'EMAIL_FAILED', detail: String((e as Error).message) })
    }
  })

  app.post('/invoices/:invoiceId/payments', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const id = String((req.params as { invoiceId: string }).invoiceId)

    const body = z
      .object({
        amountCents: z.number().int().positive(),
        paidAt: z.number().int().optional(),
        note: z.string().optional(),
        bankReference: z.string().optional(),
      })
      .parse(req.body ?? {})

    try {
      recordInvoicePayment({
        db: app.sqlite,
        dataRoot: app.dataRoot,
        user: req.user,
        invoiceId: id,
        amountCents: body.amountCents,
        paidAt: body.paidAt ?? Date.now(),
        note: body.note,
        bankReference: body.bankReference,
      })
      return { ok: true }
    } catch {
      return reply.code(400).send({ error: 'PAYMENT_FAILED' })
    }
  })

  app.post('/invoices/:invoiceId/mark-paid-full', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })

    const id = String((req.params as { invoiceId: string }).invoiceId)

    const invRow = app.sqlite.prepare(`SELECT total_cents, paid_cents FROM invoices WHERE id=?`).get(id) as
      | { total_cents: number | null; paid_cents: number | null }
      | undefined

    if (!invRow) return reply.code(404).send({ error: 'NOT_FOUND' })

    const owed = Number(invRow.total_cents ?? 0) - Number(invRow.paid_cents ?? 0)

    if (owed <= 0) return reply.send({ ok: true })

    recordInvoicePayment({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      user: req.user,
      invoiceId: id,
      amountCents: owed,
      paidAt: Date.now(),
      note: 'Markiert bezahlt (Restbetrag)',
      bankReference: undefined,
    })
    return { ok: true }
  })

  app.post('/invoices/:invoiceId/storno', async (req, reply) => {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'FORBIDDEN' })

    const id = String((req.params as { invoiceId: string }).invoiceId)

    const b = z.object({ reason: z.string().min(1) }).parse(req.body ?? {})

    try {
      return await stornoInvoice({
        db: app.sqlite,
        dataRoot: app.dataRoot,
        user: req.user,
        invoiceId: id,
        reason: b.reason,
      })
    } catch {
      return reply.code(400).send({ error: 'STORNO_FAILED' })
    }
  })

  app.get('/invoices/:invoiceId/structured-export', async (req, reply) => {
    if (!isAdmin(req.user.role))
      /** */

      return reply.code(403).send({ error: 'FORBIDDEN' })

    const id = String((req.params as { invoiceId: string }).invoiceId)

    const inv = app.sqlite
      .prepare(`SELECT structured_payload_json, invoice_no FROM invoices WHERE id=?`)
      .get(id) as { structured_payload_json: string; invoice_no: string } | undefined

    if (!inv) return reply.code(404).send({ error: 'NOT_FOUND' })

    const exportsDir = path.join(app.dataRoot, 'invoices', 'exports')
    fs.mkdirSync(exportsDir, { recursive: true })
    const outFile = `${inv.invoice_no.replace(/[^\w\-]+/g, '_')}-structured.json`
    fs.writeFileSync(path.join(exportsDir, outFile), inv.structured_payload_json, 'utf8')

    appendAudit({
      db: app.sqlite,
      dataRoot: app.dataRoot,
      type: 'invoice_export_json',
      userId: req.user.sub,
      payload: { invoiceId: id },
    })

    return reply.type('application/json').send(Buffer.from(inv.structured_payload_json, 'utf8'))
  })
}

async function mountPublicAndGuardedRoutes(instance: FastifyInstance) {
  instance.get('/health', async () => ({ ok: true }))

  instance.post('/auth/login', async (req, reply) => {
    const body = z.object({ username: z.string(), pin: z.string() }).parse(req.body ?? {})

    const row = instance.sqlite
      .prepare(`SELECT id, username, role, pin_hash FROM users WHERE username = ? COLLATE NOCASE`)
      .get(body.username) as
        | { id: string; username: string; role: JwtUser['role']; pin_hash: string }
        | undefined

    if (!row || row.pin_hash !== sha256Hex(body.pin))
      return reply.code(401).send({ error: 'LOGIN_FAILED' })

    const token = instance.jwt.sign({ sub: row.id, role: row.role, username: row.username })

    appendAudit({
      db: instance.sqlite,
      dataRoot: instance.dataRoot,
      type: 'login',
      userId: row.id,
      payload: { username: row.username },
    })

    return { token, role: row.role, username: row.username }
  })

  await instance.register(guardedRoutes)
}

async function bootstrap() {
  const env = loadEnv()
  const dbPath = ensureDataDirs(env.dataRoot)
  if (fs.existsSync(dbPath)) {
    createBackup({
      dbPath,
      dataRoot: env.dataRoot,
      reason: 'pre-migration',
    })
  }

  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')

  db.pragma('foreign_keys = ON')

  migrate(db)

  seedIfNeeded(db, {

    adminPinPlain: env.initialAdminPin,

    cashierPinPlain: env.cashierPin,
  })

  const app = Fastify({ logger: true })

  await app.register(cors, {

    origin: env.corsOrigin,

    credentials: true,

  })

  await app.register(jwt, {

    secret: env.jwtSecret,

  })

  app.decorate('sqlite', db)

  app.decorate('dataRoot', env.dataRoot)
  app.decorate('dbPath', dbPath)

  app.decorate('smtpCfg', {

    host: env.smtpHost,

    port: env.smtpPort,

    secure: env.smtpSecure,

    user: env.smtpUser,

    pass: env.smtpPass,

    from: env.smtpFrom,

  })

  // Health/API responses should never be served from intermediate caches.
  app.addHook('onSend', async (req, reply, payload) => {
    const urlPath = (req.url.split('?')[0] ?? '/').replace(/\/+$/, '') || '/'
    const isHealth = urlPath === '/health'
    const isApiPath =
      urlPath === '/api' ||
      urlPath.startsWith('/api/') ||
      (Boolean(env.apiMountPath) &&
        (urlPath === env.apiMountPath ||
          urlPath.startsWith(`${env.apiMountPath}/`)))
    if (isHealth || isApiPath) {
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
      reply.header('Pragma', 'no-cache')
      reply.header('Expires', '0')
    }
    return payload
  })

  if (env.apiMountPath) {
    await app.register(mountPublicAndGuardedRoutes, { prefix: env.apiMountPath })
    app.get('/health', async () => ({ ok: true }))
    console.log(`API routes prefixed: ${env.apiMountPath}`)
  } else {
    await app.register(mountPublicAndGuardedRoutes)
  }

  if (env.spaRoot) await registerSpaAssetsAndFallback(app, env.spaRoot)

  await app.listen({ port: env.port, host: '0.0.0.0' })

  console.log(`drk-kasse-api listening ${env.port}`)
}

bootstrap().catch((e) => {
  console.error(e)
  process.exit(1)
})
