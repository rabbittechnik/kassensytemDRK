import fs from 'node:fs'
import path from 'node:path'

import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

/** SPA-Fallback nicht fuer API, Health, Webhooks, Bundles oder DATA-Mount */
export function isSpaBypassPath(urlPath: string): boolean {
  const p = (urlPath.split('?')[0] ?? '/').replace(/\/+$/, '') || '/'
  if (p === '/health') return true
  if (p === '/healthz') return true
  if (p === '/api' || p.startsWith('/api/')) return true
  if (p === '/webhook' || p.startsWith('/webhook/')) return true
  if (p === '/assets' || p.startsWith('/assets/')) return true
  if (p === '/DATA' || p.startsWith('/DATA/')) return true
  return false
}

export async function registerSpaAssetsAndFallback(
  app: FastifyInstance,
  spaRoot: string,
): Promise<void> {
  const root = path.resolve(spaRoot)
  const indexPath = path.join(root, 'index.html')
  if (!fs.existsSync(indexPath))
    throw new Error(`SPA_ROOT: index.html fehlt unter ${root}`)

  await app.register(fastifyStatic, {
    root,
    prefix: '/',
    decorateReply: true,
    list: false,
    index: false,
  })

  app.setNotFoundHandler((req, reply) => {
    if (reply.sent) return
    const method = req.raw.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      reply.code(404).send({ error: 'NOT_FOUND' })
      return
    }
    const urlPath = req.url.split('?')[0] ?? '/'
    if (isSpaBypassPath(urlPath)) {
      reply.code(404).send({ error: 'NOT_FOUND' })
      return
    }
    reply.type('text/html').send(fs.readFileSync(indexPath, 'utf8'))
  })
}
