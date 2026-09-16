import { loadEnv } from 'vite'

const env = loadEnv('production', process.cwd(), 'VITE_')
const value = (env.VITE_API_BASE_URL ?? '').trim()
try {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('invalid URL')
  }
} catch {
  console.error('打包 App 前，请在 frontend/.env.production.local 设置 VITE_API_BASE_URL=https://你的API域名（不带路径）。')
  process.exit(1)
}
console.log(`App API: ${new URL(value).origin}`)
