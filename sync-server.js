/**
 * 食堂记录数据同步服务器（v2 - 已修复自动备份失败问题）
 *
 * v2 修复：
 *   - 启动时自动从历史 JSON 备份初始化 backups/latest.json
 *   - git 备份不再只 add backups/latest.json，而是 add -A 包含根目录备份 JSON 和源码
 *   - latest.json 不存在时不跳过备份（会扫描仓库找最新备份拿记录数）
 *
 * 功能：
 *   - 监听 http://localhost:18923
 *   - POST /save   → 接收前端数据，保存为 JSON 文件
 *   - GET  /data   → 返回最新备份数据
 *   - GET  /ping   → 健康检查
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ========== 配置 ==========
const PORT = 18923;
const GIT_REPO_DIR = "D:\\trae\\work\\canteen-records";
const BACKUP_DIR = "D:\\trae\\work\\canteen-local-backups";
const LATEST_FILE = path.join(GIT_REPO_DIR, "backups", "latest.json");

// ========== 工具 ==========
function pad(n) { return String(n).padStart(2, "0"); }
function getDateString(date) {
  return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate());
}
function log(msg) {
  const now = new Date().toISOString();
  console.log(`[${now}] ${msg}`);
}

// ========== 启动时补全 latest.json ==========
function seedLatestFromBackups() {
  if (fs.existsSync(LATEST_FILE)) return;
  const candidates = [];
  const pushFiles = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.json') && f.includes('canteen-records-')) {
        const fp = path.join(dir, f);
        try { candidates.push({ p: fp, t: fs.statSync(fp).mtimeMs }); } catch (e) {}
      }
    }
  };
  pushFiles(BACKUP_DIR);
  pushFiles(GIT_REPO_DIR);
  candidates.sort((a, b) => b.t - a.t);
  for (const c of candidates) {
    try {
      const raw = fs.readFileSync(c.p, 'utf8');
      const p = JSON.parse(raw);
      let payload = null;
      if (p && p.data && Array.isArray(p.data.canteens)) payload = p;
      else if (p && Array.isArray(p.canteens)) {
        payload = {
          version: 1, exportedAt: new Date().toISOString(), app: 'canteen_records',
          stats: {
            canteens: p.canteens.length,
            floors: (p.floors || []).length,
            windows: (p.windows || []).length,
            records: (p.records || []).length,
          },
          data: p,
        };
      }
      if (payload) {
        const gitBackupDir = path.join(GIT_REPO_DIR, 'backups');
        if (!fs.existsSync(gitBackupDir)) fs.mkdirSync(gitBackupDir, { recursive: true });
        fs.writeFileSync(LATEST_FILE, JSON.stringify(payload, null, 2), 'utf8');
        log(`从 ${path.basename(c.p)} 初始化 latest.json（${payload.stats.records}条记录）`);
        return;
      }
    } catch (e) {
      log(`跳过 ${path.basename(c.p)}: ${e.message}`);
    }
  }
  log('暂无可导入的备份 JSON，等前端第一次保存数据时生成 latest.json');
}

// ========== HTTP 服务器 ==========
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && req.url === "/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "canteen-sync" }));
    return;
  }

  if (req.method === "GET" && req.url === "/data") {
    try {
      if (fs.existsSync(LATEST_FILE)) {
        const data = fs.readFileSync(LATEST_FILE, "utf8");
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(data);
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "暂无备份数据" }));
      }
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/save") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) { req.destroy(); res.writeHead(413); res.end("Body too large"); }
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        const now = new Date();
        const dateStr = getDateString(now);
        const timeStr = pad(now.getHours()) + pad(now.getMinutes());
        const stats = {
          canteens: (parsed.canteens || []).length,
          floors: (parsed.floors || []).length,
          windows: (parsed.windows || []).length,
          records: (parsed.records || []).length,
        };
        const payload = { version: 1, exportedAt: now.toISOString(), app: "canteen_records", stats, data: parsed };
        const jsonStr = JSON.stringify(payload, null, 2);

        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const backupFileName = `canteen-records-${dateStr}-${timeStr}.json`;
        fs.writeFileSync(path.join(BACKUP_DIR, backupFileName), jsonStr, "utf8");

        const gitBackupDir = path.join(GIT_REPO_DIR, "backups");
        if (!fs.existsSync(gitBackupDir)) fs.mkdirSync(gitBackupDir, { recursive: true });
        fs.writeFileSync(LATEST_FILE, jsonStr, "utf8");

        log(`数据已同步: ${stats.canteens}食堂/${stats.records}条记录 → ${backupFileName}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, stats }));
      } catch (e) {
        log("保存失败: " + e.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    req.on("error", (e) => { res.writeHead(400); res.end("Bad request"); });
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  log(`=== 食堂记录同步服务器已启动 (v2 修复版) ===`);
  log(`监听: http://localhost:${PORT}`);
  log(`- POST /save : 接收前端数据并保存`);
  log(`- GET  /data : 返回最新备份数据`);
  log(`- GET  /ping : 健康检查`);
  log(`- 每天 20:00 自动执行 git 备份`);
  seedLatestFromBackups();
  startDailyBackupTimer();
});

// ========== 每天 20:00 自动 git 备份 ==========
const BACKUP_HOUR = 20;
let lastBackupDate = null;

function startDailyBackupTimer() {
  setInterval(() => {
    const now = new Date();
    const todayStr = now.getFullYear() + "-" + now.getMonth() + "-" + now.getDate();
    if (now.getHours() >= BACKUP_HOUR && lastBackupDate !== todayStr) {
      lastBackupDate = todayStr;
      runGitBackup();
    }
  }, 60000);

  const now = new Date();
  const todayStr = now.getFullYear() + "-" + now.getMonth() + "-" + now.getDate();
  if (now.getHours() >= BACKUP_HOUR) {
    lastBackupDate = todayStr;
    setTimeout(() => { lastBackupDate = null; }, 10000);
  }
}

function runGitBackup() {
  log("=== 开始自动 git 备份 ===");

  // 取统计：从 latest.json 或仓库根目录最新备份文件
  let stats = { records: 0 };
  try {
    if (fs.existsSync(LATEST_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LATEST_FILE, "utf8"));
      stats = parsed.stats || { records: (parsed.data?.records || []).length };
    } else {
      const files = (fs.readdirSync(GIT_REPO_DIR) || [])
        .filter(f => f.startsWith("canteen-records-") && f.endsWith(".json"))
        .sort();
      if (files.length) {
        const last = JSON.parse(fs.readFileSync(path.join(GIT_REPO_DIR, files[files.length - 1]), "utf8"));
        if (last.stats) stats = last.stats;
        else if (last.data?.records) stats.records = last.data.records.length;
      }
    }
  } catch (e) { log("统计警告: " + e.message); }

  try {
    execSync("git add -A", { cwd: GIT_REPO_DIR, stdio: "pipe" });
    const status = execSync("git status --porcelain", { cwd: GIT_REPO_DIR, encoding: "utf8" });
    if (status.trim() === "") { log("数据无变化，跳过提交"); return; }

    const now = new Date();
    const dateStr = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate());
    const commitMsg = `auto-backup: ${dateStr} ${stats.records}条记录`;

    execSync(`git commit -m "${commitMsg}"`, { cwd: GIT_REPO_DIR, stdio: "pipe" });
    log(`已提交: ${commitMsg}`);

    const pushOut = execSync("git push", {
      cwd: GIT_REPO_DIR, encoding: "utf8", timeout: 60000,
    });
    log(`已推送到 GitHub ✓ ${pushOut.trim().slice(0, 120)}`);
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : "";
    if (stderr.includes("nothing to commit") || stderr.includes("no changes")) {
      log("数据无变化，跳过提交");
    } else {
      log(`⚠ git 备份出错: ${e.message} ${stderr.slice(0, 200)}`);
      try {
        execSync("git push", { cwd: GIT_REPO_DIR, stdio: "pipe", timeout: 60000 });
        log("重试推送成功 ✓");
      } catch (e2) { log("⚠ 推送失败，下次自动重试"); }
    }
  }
}

process.on("SIGINT", () => { log("服务器关闭"); server.close(); process.exit(0); });
process.on("SIGTERM", () => { server.close(); process.exit(0); });
