/**
 * 食堂饭菜记录自动备份脚本
 * 每天 20:00 由 Windows 计划任务自动执行
 *
 * 前提：sync-server.js 在后台运行，前端数据已自动同步到 backups/latest.json
 *
 * 本脚本只需：检查 backups/latest.json 是否有变化 → git add + commit + push
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ========== 配置 ==========
const GIT_REPO_DIR = "D:\\trae\\work\\6a85a8c7728c7ab17b749665";
const LATEST_FILE = path.join(GIT_REPO_DIR, "backups", "latest.json");

function pad(n) {
  return String(n).padStart(2, "0");
}

function log(msg) {
  const now = new Date().toISOString();
  console.log(`[${now}] ${msg}`);
}

function main() {
  log("=== 食堂记录自动备份开始 ===");

  // 1. 检查 latest.json 是否存在
  if (!fs.existsSync(LATEST_FILE)) {
    log("⚠ backups/latest.json 不存在，可能同步服务器未启动或还没有数据");
    log("  请确认 sync-server.js 正在运行，且在网页中有过操作");
    return;
  }

  // 2. 读取数据统计
  let stats = { canteens: 0, floors: 0, windows: 0, records: 0 };
  try {
    const raw = fs.readFileSync(LATEST_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.stats) {
      stats = parsed.stats;
    } else if (parsed.data) {
      stats = {
        canteens: (parsed.data.canteens || []).length,
        floors: (parsed.data.floors || []).length,
        windows: (parsed.data.windows || []).length,
        records: (parsed.data.records || []).length,
      };
    }
    log(
      `数据统计: ${stats.canteens} 食堂 / ${stats.floors} 楼层 / ${stats.windows} 窗口 / ${stats.records} 条记录`
    );
  } catch (e) {
    log("⚠ 读取 latest.json 出错: " + e.message);
  }

  // 3. git add + commit + push
  log("开始 git 提交...");
  try {
    execSync("git add backups/latest.json", {
      cwd: GIT_REPO_DIR,
      stdio: "pipe",
    });

    // 检查是否有变更
    const status = execSync("git status --porcelain", {
      cwd: GIT_REPO_DIR,
      encoding: "utf-8",
    });

    if (status.trim() === "") {
      log("数据无变化，跳过提交");
    } else {
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

      // 推送到 GitHub
      execSync("git push", {
        cwd: GIT_REPO_DIR,
        stdio: "pipe",
        timeout: 60000,
      });
      log("已推送到 GitHub ✓");
    }
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : "";
    const stdout = e.stdout ? e.stdout.toString() : "";
    if (
      stderr.includes("nothing to commit") ||
      stderr.includes("no changes") ||
      stdout.includes("nothing to commit")
    ) {
      log("数据无变化，跳过提交");
    } else {
      log("⚠ git 操作出错: " + (e.message || stderr));
      // 尝试单独 push
      try {
        execSync("git push", {
          cwd: GIT_REPO_DIR,
          stdio: "pipe",
          timeout: 60000,
        });
        log("重试推送成功 ✓");
      } catch (e2) {
        log("⚠ 推送失败，下次执行时会自动重试");
      }
    }
  }

  log("=== 自动备份完成 ===\n");
}

main();
