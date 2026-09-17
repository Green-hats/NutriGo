import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { rmSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
if (args.some((arg) => !['--preview', '--ci'].includes(arg))) {
  console.error('Usage: npm run android:compact -- [--preview] [--ci]')
  process.exit(1)
}

const root = fileURLToPath(new URL('..', import.meta.url))
// Keep the existing Android debug package and signing identity for in-place
// updates, while optimizing Rust only for this distributable build.
const env = {
  ...process.env,
  CARGO_PROFILE_DEV_OPT_LEVEL: 's',
  CARGO_PROFILE_DEV_DEBUG: '0',
  CARGO_PROFILE_DEV_STRIP: 'symbols',
  CARGO_PROFILE_DEV_LTO: 'thin',
  CARGO_PROFILE_DEV_CODEGEN_UNITS: '1',
  CARGO_PROFILE_DEV_INCREMENTAL: 'false',
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

const tauriArgs = ['android', 'build', '--debug', '--target', 'aarch64', '--apk']
if (args.includes('--preview')) tauriArgs.push('--config', 'src-tauri/tauri.preview.conf.json')
if (args.includes('--ci')) tauriArgs.push('--ci')
run(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', ...tauriArgs])

const apk = resolve(root, 'src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk')
const bytes = statSync(apk).size
const maxBytes = 20 * 1024 * 1024
console.log(`Android ARM64 APK: ${(bytes / 1024 / 1024).toFixed(2)} MiB`)
if (bytes > maxBytes) {
  console.error('APK exceeds the 20 MiB budget. Inspect native symbols and ZIP padding before publishing.')
  process.exit(1)
}
