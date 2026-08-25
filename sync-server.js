/**
 * 食堂记录数据同步服务器（v3）
 *
 * v3 新增：
 *   - 主数据存储 data.json：GET /api/data、POST /api/save
 *   - 图片上传与静态服务：POST /api/upload、GET /images/:filename
 *
 * 保留 v2：
 *   - 每天 20:00 自动 git 备份（git add -A → commit → push）
 *   - 启动时 seedLatestFromBackups 自动补全 backups/latest.json
 *   - GET /ping、GET /data、POST /save（向后兼容）
 *
 * 仅使用 Node.js 内置模块：http、fs、path、child_process
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ========== 配置 ==========
const PORT = 18923;
const GIT_REPO_DIR = "D:\\trae\\work\\canteen-records";
const BACKUP_DIR = "D:\\trae\\work\\canteen-local-backups";
const DATA_FILE = path.join(GIT_REPO_DIR, "data.json");
const IMAGES_DIR = path.join(GIT_REPO_DIR, "images");
const LATEST_FILE = path.join(GIT_REPO_DIR, "backups", "latest.json");

const EMPTY_DATA = { canteens: [], floors: [], windows: [], records: [] };

// ========== 工具 ==========
function pad(n) {
  return String(n).padStart(2, "0");
}
function getDateString(date) {
  return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate());
}
function log(msg) {
  const now = new Date().toISOString();
  console.log(`[${now}] ${msg}`);
}

// 读取请求体（带大小限制，返回 Promise<string>）
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on("data", (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > limit) {
        aborted = true;
        req.destroy();
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", (e) => {
      if (!aborted) reject(e);
    });
  });
}

// 启动时确保 data.json 存在
function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(EMPTY_DATA, null, 2), "utf-8");
    log("已创建空 data.json");
  }
}

// 启动时确保 images 目录存在
function ensureImagesDir() {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    log("已创建 images 目录");
  }
}

// 根据扩展名返回 Content-Type
function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return map[ext] || "application/octet-stream";
}

// ========== 启动时补全 latest.json（v2 保留） ==========
function seedLatestFromBackups() {
  if (fs.existsSync(LATEST_FILE)) return;
  const candidates = [];
  const pushFiles = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".json") && f.includes("canteen-records-")) {
        const fp = path.join(dir, f);
        try {
          candidates.push({ p: fp, t: fs.statSync(fp).mtimeMs });
        } catch (e) {}
      }
    }
  };
  pushFiles(BACKUP_DIR);
  pushFiles(GIT_REPO_DIR);
  candidates.sort((a, b) => b.t - a.t);
  for (const c of candidates) {
    try {
      const raw = fs.readFileSync(c.p, "utf-8");
      const p = JSON.parse(raw);
      let payload = null;
      if (p && p.data && Array.isArray(p.data.canteens)) payload = p;
      else if (p && Array.isArray(p.canteens)) {
        payload = {
          version: 1,
          exportedAt: new Date().toISOString(),
          app: "canteen_records",
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
        const gitBackupDir = path.join(GIT_REPO_DIR, "backups");
        if (!fs.existsSync(gitBackupDir))
          fs.mkdirSync(gitBackupDir, { recursive: true });
        fs.writeFileSync(LATEST_FILE, JSON.stringify(payload, null, 2), "utf-8");
        log(
          `seedLatestFromBackups: ${path.basename(c.p)} → latest.json（${payload.stats.records}条）`
        );
        return;
      }
    } catch (e) {
      log(`跳过 ${path.basename(c.p)}: ${e.message}`);
    }
  }
  log("seedLatestFromBackups: 暂无可导入的 JSON，等待前端首次 /save");
}

// 将 data.json 的内容同步写入 backups/latest.json（保持 git 备份兼容）
function syncDataToLatest(parsed) {
  try {
    const now = new Date();
    const stats = {
      canteens: (parsed.canteens || []).length,
      floors: (parsed.floors || []).length,
      windows: (parsed.windows || []).length,
      records: (parsed.records || []).length,
    };
    const payload = {
      version: 1,
      exportedAt: now.toISOString(),
      app: "canteen_records",
      stats,
      data: parsed,
    };
    const gitBackupDir = path.join(GIT_REPO_DIR, "backups");
    if (!fs.existsSync(gitBackupDir))
      fs.mkdirSync(gitBackupDir, { recursive: true });
    fs.writeFileSync(LATEST_FILE, JSON.stringify(payload, null, 2), "utf-8");
  } catch (e) {
    log("同步 latest.json 失败: " + e.message);
  }
}

// ========== HTTP 服务器 ==========
const server = http.createServer(async (req, res) => {
  // CORS 头（允许 file:// 和 http://localhost 访问）
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // 处理预检请求
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // 解析 pathname（去掉 query）
  let pathname = req.url || "/";
  const qIdx = pathname.indexOf("?");
  if (qIdx >= 0) pathname = pathname.slice(0, qIdx);

  // GET /ping → 健康检查（向后兼容）
  if (req.method === "GET" && pathname === "/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "canteen-sync" }));
    return;
  }

  // GET /data → 返回 latest.json（向后兼容，保持原行为）
  if (req.method === "GET" && pathname === "/data") {
    try {
      if (fs.existsSync(LATEST_FILE)) {
        const data = fs.readFileSync(LATEST_FILE, "utf-8");
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

  // POST /save → 旧接口：保存到备份目录 + latest.json（向后兼容）
  if (req.method === "POST" && pathname === "/save") {
    try {
      const body = await readBody(req, 10 * 1024 * 1024);
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
      const payload = {
        version: 1,
        exportedAt: now.toISOString(),
        app: "canteen_records",
        stats,
        data: parsed,
      };
      const jsonStr = JSON.stringify(payload, null, 2);

      if (!fs.existsSync(BACKUP_DIR))
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const backupFileName = `canteen-records-${dateStr}-${timeStr}.json`;
      fs.writeFileSync(path.join(BACKUP_DIR, backupFileName), jsonStr, "utf-8");

      const gitBackupDir = path.join(GIT_REPO_DIR, "backups");
      if (!fs.existsSync(gitBackupDir))
        fs.mkdirSync(gitBackupDir, { recursive: true });
      fs.writeFileSync(LATEST_FILE, jsonStr, "utf-8");

      log(
        `数据已同步: ${stats.canteens}食堂/${stats.records}条记录 → ${backupFileName}`
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, stats }));
    } catch (e) {
      log("保存失败: " + e.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /api/data → 返回 data.json 主数据
  if (req.method === "GET" && pathname === "/api/data") {
    try {
      ensureDataFile();
      const data = fs.readFileSync(DATA_FILE, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(data);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/save → 保存到 data.json，并同步 latest.json
  if (req.method === "POST" && pathname === "/api/save") {
    try {
      const body = await readBody(req, 10 * 1024 * 1024);
      const parsed = JSON.parse(body);
      fs.writeFileSync(DATA_FILE, JSON.stringify(parsed, null, 2), "utf-8");
      syncDataToLatest(parsed);
      const stats = {
        canteens: (parsed.canteens || []).length,
        floors: (parsed.floors || []).length,
        windows: (parsed.windows || []).length,
        records: (parsed.records || []).length,
      };
      log(
        `api/save: 已写入 data.json（${stats.canteens}食堂/${stats.records}条记录）`
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, stats }));
    } catch (e) {
      log("api/save 失败: " + e.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/upload → 接收 base64 图片并保存
  if (req.method === "POST" && pathname === "/api/upload") {
    try {
      const body = await readBody(req, 50 * 1024 * 1024);
      const parsed = JSON.parse(body);
      const imageField = parsed.image;
      if (!imageField || typeof imageField !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "缺少 image 字段" }));
        return;
      }
      // 解析 data URL：data:<mime>;base64,<...>
      const match = imageField.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "image 字段格式错误，需为 data URL" })
        );
        return;
      }
      const mime = match[1];
      const base64Data = match[2];
      const buffer = Buffer.from(base64Data, "base64");

      // 按实际 MIME 选择扩展名（jpeg → .jpg，默认 .jpg）
      let ext = ".jpg";
      if (mime === "image/png") ext = ".png";
      else if (mime === "image/webp") ext = ".webp";
      else if (mime === "image/gif") ext = ".gif";

      ensureImagesDir();
      const filename = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}${ext}`;
      fs.writeFileSync(path.join(IMAGES_DIR, filename), buffer);

      const url = `http://localhost:${PORT}/images/${filename}`;
      log(
        `图片已上传: ${filename} (${Math.round(buffer.length / 1024)}KB)`
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, url, filename }));
    } catch (e) {
      log("api/upload 失败: " + e.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /images/:filename → 静态图片服务
  if (req.method === "GET" && pathname.startsWith("/images/")) {
    try {
      const filename = decodeURIComponent(pathname.slice("/images/".length));
      // 防止路径穿越
      if (
        filename.includes("..") ||
        filename.includes("/") ||
        filename.includes("\\")
      ) {
        res.writeHead(400);
        res.end("Bad request");
        return;
      }
      const filePath = path.join(IMAGES_DIR, filename);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "图片不存在" }));
        return;
      }
      const buffer = fs.readFileSync(filePath);
      res.writeHead(200, {
        "Content-Type": getContentType(filename),
        "Cache-Control": "public, max-age=86400",
      });
      res.end(buffer);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 其他请求 → 404
  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  log(`=== 食堂记录同步服务器已启动 (v3) ===`);
  log(`监听: http://localhost:${PORT}`);
  log(`- GET  /ping       : 健康检查`);
  log(`- GET  /data       : 返回 latest.json（向后兼容）`);
  log(`- POST /save       : 旧保存接口（向后兼容）`);
  log(`- GET  /api/data   : 返回 data.json 主数据`);
  log(`- POST /api/save   : 保存到 data.json`);
  log(`- POST /api/upload : 上传图片（base64）`);
  log(`- GET  /images/:f  : 静态图片服务`);
  log(`- 每天 20:00 自动执行 git 备份`);
  ensureDataFile();
  ensureImagesDir();
  seedLatestFromBackups();
  startDailyBackupTimer();
});

/* ========== 每天 20:00 自动 git 备份 ========== */
const BACKUP_HOUR = 20; // 晚上8点
let lastBackupDate = null; // 记录上次备份日期，避免重复

function startDailyBackupTimer() {
  // 每分钟检查一次是否到了备份时间
  setInterval(() => {
    const now = new Date();
    const todayStr =
      now.getFullYear() + "-" + now.getMonth() + "-" + now.getDate();
    if (now.getHours() >= BACKUP_HOUR && lastBackupDate !== todayStr) {
      lastBackupDate = todayStr;
      runGitBackup();
    }
  }, 60000);

  // 启动时如果已过20点，10秒后补备一次
  const now = new Date();
  const todayStr = now.getFullYear() + "-" + now.getMonth() + "-" + now.getDate();
  if (now.getHours() >= BACKUP_HOUR) {
    lastBackupDate = todayStr;
    setTimeout(() => {
      lastBackupDate = null;
    }, 10000);
  }
}

function runGitBackup() {
  log("=== 开始自动 git 备份 ===");

  // 取统计：从 latest.json 或仓库根目录最新备份文件
  let stats = { records: 0 };
  try {
    if (fs.existsSync(LATEST_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LATEST_FILE, "utf-8"));
      stats =
        parsed.stats || { records: (parsed.data?.records || []).length };
    } else {
      const files = (fs.readdirSync(GIT_REPO_DIR) || [])
        .filter((f) => f.startsWith("canteen-records-") && f.endsWith(".json"))
        .sort();
      if (files.length) {
        const last = JSON.parse(
          fs.readFileSync(path.join(GIT_REPO_DIR, files[files.length - 1]), "utf-8")
        );
        if (last.stats) stats = last.stats;
        else if (last.data?.records) stats.records = last.data.records.length;
      }
    }
  } catch (e) {
    log("统计警告: " + e.message);
  }

  try {
    execSync("git add -A", { cwd: GIT_REPO_DIR, stdio: "pipe" });

    const status = execSync("git status --porcelain", {
      cwd: GIT_REPO_DIR,
      encoding: "utf-8",
    });
    if (status.trim() === "") {
      log("数据无变化，跳过提交");
      return;
    }

    const now = new Date();
    const dateStr =
      now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate());
    const commitMsg = `auto-backup: ${dateStr} ${stats.records}条记录`;

    execSync(`git commit -m "${commitMsg}"`, {
      cwd: GIT_REPO_DIR,
      stdio: "pipe",
    });
    log(`已提交: ${commitMsg}`);

    const pushOut = execSync("git push", {
      cwd: GIT_REPO_DIR,
      encoding: "utf-8",
      timeout: 60000,
    });
    log(`已推送到 GitHub ✓ ${pushOut.trim().slice(0, 120)}`);
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : "";
    if (stderr.includes("nothing to commit") || stderr.includes("no changes")) {
      log("数据无变化，跳过提交");
    } else {
      log(`⚠ git 备份出错: ${e.message} ${stderr.slice(0, 200)}`);
      try {
        execSync("git push", {
          cwd: GIT_REPO_DIR,
          stdio: "pipe",
          timeout: 60000,
        });
        log("重试推送成功 ✓");
      } catch (e2) {
        log("⚠ 推送失败，下次自动重试");
      }
    }
  }
}

// 优雅退出
process.on("SIGINT", () => {
  log("服务器关闭");
  server.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
