export type JwtUser = {
  sub: string
  role: 'admin' | 'cashier' | 'auditor'
  username?: string
}
