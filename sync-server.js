/**
 * 食堂记录数据同步服务器
 *
 * 功能：
 *   - 监听 http://localhost:18923
 *   - POST /save   → 接收前端数据，保存为 JSON 文件
 *   - GET  /data   → 返回最新备份数据（用于跨浏览器导入）
 *   - GET  /ping   → 健康检查
 *
 * 用法：
 *   node sync-server.js          前台运行
 *   或注册为 Windows 计划任务在登录时自启动
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

// ========== 配置 ==========
const PORT = 18923;
const GIT_REPO_DIR = "D:\\trae\\work\\6a85a8c7728c7ab17b749665";
const BACKUP_DIR = "D:\\trae\\work\\canteen-records";
const LATEST_FILE = path.join(GIT_REPO_DIR, "backups", "latest.json");

// ========== 工具 ==========
function pad(n) {
  return String(n).padStart(2, "0");
}

function getDateString(date) {
  return (
    date.getFullYear() +
    pad(date.getMonth() + 1) +
    pad(date.getDate())
  );
}

function log(msg) {
  const now = new Date().toISOString();
  console.log(`[${now}] ${msg}`);
}

// ========== HTTP 服务器 ==========
const server = http.createServer((req, res) => {
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

  // GET /ping → 健康检查
  if (req.method === "GET" && req.url === "/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "canteen-sync" }));
    return;
  }

  // GET /data → 返回最新备份数据
  if (req.method === "GET" && req.url === "/data") {
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

  // POST /save → 接收并保存数据
  if (req.method === "POST" && req.url === "/save") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      // 防止过大请求（10MB 限制）
      if (body.length > 10 * 1024 * 1024) {
        req.destroy();
        res.writeHead(413);
        res.end("Body too large");
      }
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

        const payload = {
          version: 1,
          exportedAt: now.toISOString(),
          app: "canteen_records",
          stats: stats,
          data: parsed,
        };
        const jsonStr = JSON.stringify(payload, null, 2);

        // 保存到备份目录（带日期时间戳）
        if (!fs.existsSync(BACKUP_DIR)) {
          fs.mkdirSync(BACKUP_DIR, { recursive: true });
        }
        const backupFileName = `canteen-records-${dateStr}-${timeStr}.json`;
        fs.writeFileSync(path.join(BACKUP_DIR, backupFileName), jsonStr, "utf-8");

        // 保存到 git 仓库的 latest.json
        const gitBackupDir = path.join(GIT_REPO_DIR, "backups");
        if (!fs.existsSync(gitBackupDir)) {
          fs.mkdirSync(gitBackupDir, { recursive: true });
        }
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
    });

    req.on("error", (e) => {
      res.writeHead(400);
      res.end("Bad request");
    });
    return;
  }

  // 其他请求 → 404
  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  log(`=== 食堂记录同步服务器已启动 ===`);
  log(`监听: http://localhost:${PORT}`);
  log(`- POST /save : 接收前端数据并保存`);
  log(`- GET  /data : 返回最新备份数据`);
  log(`- GET  /ping : 健康检查`);
  log(`- 每天 20:00 自动执行 git 备份`);
  startDailyBackupTimer();
});

/* ========== 每天 20:00 自动 git 备份 ========== */
const BACKUP_HOUR = 20; // 晚上8点
let lastBackupDate = null; // 记录上次备份日期，避免重复

function startDailyBackupTimer() {
  // 每分钟检查一次是否到了备份时间
  setInterval(() => {
    const now = new Date();
    const todayStr = now.getFullYear() + "-" + now.getMonth() + "-" + now.getDate();

    // 到了20点且今天还没备份过
    if (now.getHours() >= BACKUP_HOUR && lastBackupDate !== todayStr) {
      lastBackupDate = todayStr;
      runGitBackup();
    }
  }, 60000); // 每分钟检查

  // 启动时如果已过20点，也检查一次
  const now = new Date();
  const todayStr = now.getFullYear() + "-" + now.getMonth() + "-" + now.getDate();
  if (now.getHours() >= BACKUP_HOUR) {
    lastBackupDate = todayStr; // 标记今天，等下一次（如果当天重启服务器，10秒后补备一次）
    setTimeout(() => {
      lastBackupDate = null; // 重置让它能执行
    }, 10000);
  }
}

const { execSync } = require("child_process");

function runGitBackup() {
  log("=== 开始自动 git 备份 ===");

  if (!fs.existsSync(LATEST_FILE)) {
    log("⚠ latest.json 不存在，跳过 git 备份");
    return;
  }

  // 读取数据统计
  let stats = { records: 0 };
  try {
    const raw = fs.readFileSync(LATEST_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    stats = parsed.stats || { records: (parsed.data?.records || []).length };
  } catch (e) {}

  try {
    execSync("git add backups/latest.json", {
      cwd: GIT_REPO_DIR,
      stdio: "pipe",
    });

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
      now.getFullYear() +
      pad(now.getMonth() + 1) +
      pad(now.getDate());
    const commitMsg = `auto-backup: ${dateStr} ${stats.records}条记录`;

    execSync(`git commit -m "${commitMsg}"`, {
      cwd: GIT_REPO_DIR,
      stdio: "pipe",
    });
    log(`已提交: ${commitMsg}`);

    execSync("git push", {
      cwd: GIT_REPO_DIR,
      stdio: "pipe",
      timeout: 60000,
    });
    log("已推送到 GitHub ✓");
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : "";
    if (stderr.includes("nothing to commit") || stderr.includes("no changes")) {
      log("数据无变化，跳过提交");
    } else {
      log("⚠ git 备份出错: " + (e.message || stderr));
      try {
        execSync("git push", {
          cwd: GIT_REPO_DIR,
          stdio: "pipe",
          timeout: 60000,
        });
        log("重试推送成功 ✓");
      } catch (e2) {
        log("⚠ 推送失败，下次会自动重试");
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
