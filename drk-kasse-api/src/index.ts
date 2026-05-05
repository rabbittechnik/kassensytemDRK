  if (env.spaRoot) await registerSpaAssetsAndFallback(app, env.spaRoot)

  await app.listen({ port: env.port, host: '0.0.0.0' })

  console.log(`drk-kasse-api listening ${env.port}`)