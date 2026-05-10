/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  /** package.json version (Vite define). */
  readonly VITE_APP_VERSION: string
  /** ISO build timestamp (Vite define). */
  readonly VITE_APP_BUILD_AT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
