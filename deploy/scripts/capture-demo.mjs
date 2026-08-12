#!/usr/bin/env node
/**
 * NutriGo 演示截图 / GIF 捕获脚本（Playwright + Firefox）
 *
 * 用途：为 README 生成 docs/screenshots/ 下的演示素材。
 *
 * 前置条件：
 *   1. 三端已启动：frontend :5173 / backend :3333 / agent :8000
 *   2. npm i -g playwright && npx playwright install firefox   # 或项目内安装
 *   3. ffmpeg（用于合成 GIF）
 *   4. 【思考链展示】agent/.env 的 LLM_MODEL 需为返回 reasoning_content 的模型
 *      （如 openai/qwen3.7-max），否则聊天截图不显示"🤔 思考过程"折叠面板。
 *
 * 用法：
 *   node deploy/scripts/capture-demo.mjs
 *
 * 可用环境变量覆盖：
 *   FRONTEND_URL=http://localhost:5173   API_URL=http://localhost:3333
 *   DEMO_USER=demo   DEMO_PASS=demo123456   OUT_DIR=docs/screenshots
 *
 * 输出：docs/screenshots/{login,chat,diary,chart,profile}.png + demo.gif
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5173'
const API = process.env.API_URL || 'http://localhost:3333'
const USER = process.env.DEMO_USER || 'demo'
const PASS = process.env.DEMO_PASS || 'demo123456'
const OUT_DIR = resolve(ROOT, process.env.OUT_DIR || 'docs/screenshots')
const FRAMES_DIR = join(OUT_DIR, '.frames')

const VIEWPORT = { width: 430, height: 900 }
const GIF_FPS = 5

const log = (...a) => console.log('\x1b[32m[capture]\x1b[0m', ...a)
const warn = (...a) => console.log('\x1b[33m[capture]\x1b[0m', ...a)

// ============================================================
// 1. API 辅助（注册/登录 + 预置数据）
// ============================================================

async function api(path, { method = 'GET', body, token } = {}) {
  const resp = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await resp.text()
  return { status: resp.status, data: text ? JSON.parse(text) : {} }
}

async function ensureUser() {
  let res = await api('/api/auth/register', { method: 'POST', body: { username: USER, password: PASS } })
  if (res.status === 409) {
    res = await api('/api/auth/login', { method: 'POST', body: { username: USER, password: PASS } })
  }
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`demo 用户准备失败: ${JSON.stringify(res.data)}`)
  }
  const { token, id } = res.data
  return { token, id }
}

async function seedProfile(token, id) {
  await api(`/api/users/${id}/profile`, {
    method: 'PUT',
    token,
    body: {
      height_cm: 175, weight_kg: 78, age: 32, gender: 'male', goal: 'lose_weight',
      allergies: ['peanut'], dietary_habits: [], chronic_diseases: ['hypertension'],
    },
  })
}

async function seedDiaries(token) {
  const today = new Date()
  const day = (n) => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10)
  // 先清掉 demo 用户已有记录，保证脚本可重复运行
  for (let n = 0; n <= 2; n++) {
    const res = await api(`/api/diet/logs?date=${day(n)}`, { token })
    const existing = Array.isArray(res.data) ? res.data : []
    for (const r of existing) {
      await api(`/api/diet/logs/${r.id}`, { method: 'DELETE', token })
    }
  }
  // 今天 + 前两天各一条饮食记录（diary 页面展示）
  const menu = [
    { date: day(0), food_name: '燕麦粥', calories: 350, protein_g: 12, fat_g: 6, carbs_g: 60, meal_type: 'breakfast' },
    { date: day(1), food_name: '宫保鸡丁', calories: 450, protein_g: 30, fat_g: 22, carbs_g: 35, meal_type: 'lunch' },
    { date: day(2), food_name: '清蒸鲈鱼', calories: 320, protein_g: 40, fat_g: 8, carbs_g: 5, meal_type: 'dinner' },
  ]
  for (const r of menu) {
    await api('/api/diet/logs', { method: 'POST', token, body: r })
  }
}

async function seedSummaries(id) {
  // 趋势图读取 daily_summaries 表（由后台聚合任务生成）。此处直接写入，
  // 需要 backend/data.db 未被占用写入（开发时短暂写入通常无碍）。
  let DatabaseSync
  try {
    ;({ DatabaseSync } = await import('node:sqlite'))
  } catch {
    warn('node:sqlite 不可用（需要 Node 22.5+），跳过汇总种子，chart.png 可能为空')
    return
  }
  const dbPath = join(ROOT, 'backend/data.db')
  if (!existsSync(dbPath)) {
    warn(`未找到 ${dbPath}，跳过汇总种子`)
    return
  }
  try {
    const db = new DatabaseSync(dbPath)
    const today = new Date()
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO daily_summaries (user_id, date, total_calories, total_protein_g, total_fat_g, total_carbs_g, meal_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10)
      stmt.run(id, d, 1500 + Math.round(Math.random() * 600), 60 + i * 3, 55, 200, 3)
    }
    db.close()
    log('已写入 7 天 daily_summaries')
  } catch (e) {
    warn(`汇总种子写入失败（数据库可能被占用）: ${e.message}`)
  }
}

// ============================================================
// 2. Playwright 捕获
// ============================================================

async function screenshot(page, name) {
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`), fullPage: false })
  log(`已保存 ${name}.png`)
}

async function run() {
  const { firefox } = await import('playwright')
  const { token, id } = await ensureUser()
  log(`demo 用户就绪 id=${id}`)
  await seedProfile(token, id)
  await seedDiaries(token)
  await seedSummaries(id)

  mkdirSync(OUT_DIR, { recursive: true })
  mkdirSync(FRAMES_DIR, { recursive: true })

  const browser = await firefox.launch({ headless: true })
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 })

  try {
    // ---- 登录页 ----
    await page.goto(`${FRONTEND}/login`, { waitUntil: 'networkidle' })
    await page.waitForSelector('input[placeholder="用户名"]')
    await screenshot(page, 'login')

    // ---- 登录 ----
    await page.fill('input[placeholder="用户名"]', USER)
    await page.fill('input[placeholder="密码"]', PASS)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/chat', { timeout: 15000 })

    // ---- 对话（流式 + 思考链折叠）----
    await page.waitForSelector('input[placeholder="输入消息..."]')
    await page.fill('input[placeholder="输入消息..."]', '我今天吃了燕麦粥和宫保鸡丁，帮我分析一下营养')
    await page.click('button[aria-label="发送"]')
    // 等待流结束（停止按钮消失），期间每 400ms 截一帧用于 GIF；上限 60s
    const deadline = Date.now() + 60000
    let frame = 0
    while (await page.locator('button[title="停止生成"]').count() && Date.now() < deadline) {
      await page.screenshot({ path: join(FRAMES_DIR, `f_${String(frame++).padStart(3, '0')}.png`) })
      await page.waitForTimeout(400)
    }
    await page.waitForTimeout(800)
    await screenshot(page, 'chat')

    // ---- 日记 ----
    await page.goto(`${FRONTEND}/diary`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    await screenshot(page, 'diary')

    // ---- 营养趋势图 ----
    await page.click('button[aria-label="查看营养趋势"]')
    await page.waitForTimeout(1200)
    await screenshot(page, 'chart')
    await page.click('button:has-text("✕")').catch(() => {})

    // ---- 健康档案 ----
    await page.goto(`${FRONTEND}/profile`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    await screenshot(page, 'profile')
  } finally {
    await browser.close()
  }

  // ---- GIF：用截图序列合成（调色板压缩 + 较小尺寸）----
  const frames = (await import('node:fs')).readdirSync(FRAMES_DIR).filter((f) => f.endsWith('.png'))
  if (frames.length >= 3) {
    const gif = join(OUT_DIR, 'demo.gif')
    const r = spawnSync('ffmpeg', [
      '-y', '-framerate', String(GIF_FPS),
      '-i', join(FRAMES_DIR, 'f_%03d.png'),
      '-vf', 'scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse',
      '-loop', '0', gif,
    ], { stdio: 'ignore' })
    if (r.status === 0) {
      log(`已保存 demo.gif（${frames.length} 帧）`)
    } else {
      warn('ffmpeg 合成 GIF 失败（请确认已安装 ffmpeg）')
    }
  } else {
    warn('聊天截图帧不足，跳过 GIF 生成')
  }
  rmSync(FRAMES_DIR, { recursive: true, force: true })
  log('完成 ✅  请检查 docs/screenshots/，并提交图片到 git')
}

run().catch((e) => { console.error('\x1b[31m[capture] 失败\x1b[0m', e); process.exit(1) })
