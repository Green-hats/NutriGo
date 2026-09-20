import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
if (args.some((arg) => !['--preview', '--ci'].includes(arg))) {
  console.error('Usage: npm run android:compact -- [--preview] [--ci]')
  process.exit(1)
}

const root = fileURLToPath(new URL('..', import.meta.url))
const preview = args.includes('--preview')
// The online distributable is a real release variant. The offline preview stays
// a debug build because it is a short-lived CI artifact for UI evaluation.
const env = {
  ...process.env,
  [`CARGO_PROFILE_${preview ? 'DEV' : 'RELEASE'}_OPT_LEVEL`]: 's',
  [`CARGO_PROFILE_${preview ? 'DEV' : 'RELEASE'}_DEBUG`]: '0',
  [`CARGO_PROFILE_${preview ? 'DEV' : 'RELEASE'}_STRIP`]: 'symbols',
  [`CARGO_PROFILE_${preview ? 'DEV' : 'RELEASE'}_LTO`]: 'thin',
  [`CARGO_PROFILE_${preview ? 'DEV' : 'RELEASE'}_CODEGEN_UNITS`]: '1',
  [`CARGO_PROFILE_${preview ? 'DEV' : 'RELEASE'}_INCREMENTAL`]: 'false',
  CARGO_INCREMENTAL: '0',
}

function run(command, parameters) {
  const result = spawnSync(command, parameters, { cwd: root, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// Android's incremental ZIP writer can retain large deleted regions. A clean
// app package also prevents stale online/preview assets from being distributed.
// Remove only generated app output. Running Gradle :app:clean before Tauri on a
// fresh checkout fails because tauri.build.gradle.kts has not been generated yet.
rmSync(resolve(root, 'src-tauri/gen/android/app/build'), { recursive: true, force: true })

const tauriArgs = ['android', 'build', '--target', 'aarch64', '--apk']
if (preview) tauriArgs.push('--debug', '--config', 'src-tauri/tauri.preview.conf.json')
if (args.includes('--ci')) tauriArgs.push('--ci')
run(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', ...tauriArgs])

const profile = preview ? 'debug' : 'release'
const output = resolve(root, `src-tauri/gen/android/app/build/outputs/apk/universal/${profile}`)
const candidates = readdirSync(output).filter((name) => name.endsWith('.apk'))
if (candidates.length !== 1) {
  console.error(`Expected one ${profile} APK, found ${candidates.length}`)
  process.exit(1)
}
const apk = resolve(output, candidates[0])
const bytes = statSync(apk).size
const maxBytes = 20 * 1024 * 1024
mkdirSync(resolve(root, 'artifacts'), { recursive: true })
const artifact = resolve(root, 'artifacts', preview
  ? 'NutriGo-preview-arm64.apk'
  : 'NutriGo-online-arm64-unsigned.apk')
copyFileSync(apk, artifact)
console.log(`Android ARM64 ${profile} APK: ${(bytes / 1024 / 1024).toFixed(2)} MiB`)
if (bytes > maxBytes) {
  console.error('APK exceeds the 20 MiB budget. Inspect native symbols and ZIP padding before publishing.')
  process.exit(1)
}
