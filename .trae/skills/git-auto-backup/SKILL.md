---
name: "git-auto-backup"
description: "一键配置 Git 仓库+本地同步服务器+定时自动commit/push到GitHub/Gitee，防误删。在用户想要为某个程序开启每天自动备份、或手动触发git备份并上传时调用。"
---

# Git 自动备份 & GitHub 上传 Skill

本 Skill 固化了一套**经过踩坑验证**的备份方案：将代码 + 用户动态数据（JSON/图片等）同时纳入 Git，由本地 Node 服务器 24h 监听数据变动，每天到点自动 `git add -A` → `commit` → `push` 到远端仓库，误删后可完整恢复。

---

## 0. 何时使用本 Skill

当出现以下任一情况时调用：
1. 用户说"帮我把这个程序/项目/代码**每天自动备份**，怕误删"
2. 用户说"把当前改动**手动 Git 提交并上传 GitHub**"
3. 用户说"帮我加个**同步服务器**，我在页面里一修改数据就自动备份"
4. 用户说"以后我其它项目也要用这套备份上传流程"

**禁止**在未做 Git 三要素盘点（见 §1）的情况下直接宣称备份完成。

---

## 1. 前置检查（必须先做）

按顺序在目标项目根目录（记为 `<PROJECT_ROOT>`）执行：

```powershell
# 1) 三要素盘点：分支 / remote / 工作区是否干净
git -C "<PROJECT_ROOT>" status         # 当前分支、是否 ahead/behind、有没有未提交改动
git -C "<PROJECT_ROOT>" remote -v      # 远端列表（预期 origin = GitHub/Gitee URL）
git -C "<PROJECT_ROOT>" log --oneline -5  # 历史，防止出现 detached HEAD

# 2) 依赖版本
git --version   # >= 2.35
node --version  # >= 18

# 3) 锁文件：.git/index.lock 或数据库 *-wal/*-shm 有残留吗？
Get-ChildItem "<PROJECT_ROOT>\.git" -Filter "index.lock" -ErrorAction 0
# 如果存在 → 先关编辑器/后台进程 → 再删 lock → 才能继续
```

**发现以下任一问题时先处理，不要继续：**
- `ahead by N commits`：之前备份没 push，先手动 `git push` 一次
- `index.lock` 存在：先 `Remove-Item .git/index.lock -Force`
- 没有 `origin`：按 §2.2 配置远端
- Git 要求输入凭证：暂停自动化，让用户在 PowerShell 先手动 `git push` 完成登录授权

---

## 2. 两种备份模式

### Plan A：手动三步即时备份（轻量，不需要后台进程）

适合"偶尔备份、用户手动触发"的场景。

```powershell
cd "<PROJECT_ROOT>"
# （可选）用户先在应用里点一次"导出数据 JSON"，把文件拖进项目根
git add -A                                           # 永远不要 add 单个文件，必须 -A 覆盖代码+备份JSON+latest
$msg = "backup: $(Get-Date -Format 'yyyyMMdd') 简述内容（比如新增3条记录）"
git commit -m $msg
git push
```

**判断是否真的 push 成功，只能靠：**
```powershell
git status
# 必须出现：Your branch is up to date with 'origin/master'.
# 如果显示 ahead N = 没推上去，需要用户手动 git push（可能等凭证弹窗）
```

### Plan B：全自动定时备份（推荐，防误删的真正方案）

目标：在 `<PROJECT_ROOT>` 放一台常驻的本地 HTTP 同步服务器（Node），
应用每次数据变更时 `POST http://localhost:<PORT>/save` 发 JSON 给它；
服务器每天 `<BACKUP_HOUR>`（默认 20:00）自动做一次 `git add -A` + `commit` + `push`。

#### 2.1 第一次初始化仓库（如果项目还不是 git repo）

```powershell
cd "<PROJECT_ROOT>"
git init
git branch -M master
# 写 .gitignore（见下方模板）
git add -A
git commit -m "init: 首次提交（代码+初始数据）"
git remote add origin "<REMOTE_URL>"
git push -u origin master
```

**`.gitignore` 推荐模板：**
```gitignore
node_modules/
npm-debug.log
*.log
.DS_Store
Thumbs.db
.env
.env.*
# 注意：不要忽略 backups/、*.json，它们是要进仓库做备份的数据！
```

#### 2.2 生成 `sync-server.js`（**v2 修复版**）

在 `<PROJECT_ROOT>/sync-server.js` 写入下面的模板。**注意替换四个占位符：**
- `<SERVER_PORT>` ：推荐 18923（或其它未被占用端口）
- `<PROJECT_ROOT_ABS>` ：如 `D:\\trae\\work\\my-project`（**双反斜杠转义**）
- `<LOCAL_BACKUP_DIR_ABS>`：如 `D:\\trae\\work\\my-project-local-backups`（放本地滚动备份，仓库外更安全）
- `<BACKUP_HOUR>`：整数，默认 `20`，即每晚 20:00

```js
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PORT = <SERVER_PORT>;
const GIT_REPO_DIR = "<PROJECT_ROOT_ABS>";
const BACKUP_DIR = "<LOCAL_BACKUP_DIR_ABS>";
const BACKUP_HOUR = <BACKUP_HOUR>;
const LATEST_FILE = path.join(GIT_REPO_DIR, "backups", "latest.json");

function pad(n) { return String(n).padStart(2, "0"); }
function getDateString(d) {
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
}
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

/**
 * 【v2 修复 #1】启动时如果 backups/latest.json 不存在，
 * 自动从本地备份目录或项目根目录里最新的 *-YYYYMMDD-HHMM.json 导入，
 * 解决『项目路径改了 / 第一次启动 / 前端没调过 /save』导致 latest.json 缺失的问题。
 */
function seedLatestFromBackups() {
  if (fs.existsSync(LATEST_FILE)) return;
  const cand = [];
  const scan = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".json") && /-\d{8}-\d{4}\.json$/.test(f)) {
        const p = path.join(dir, f);
        try { cand.push({ p, t: fs.statSync(p).mtimeMs }); } catch (e) {}
      }
    }
  };
  scan(BACKUP_DIR);
  scan(GIT_REPO_DIR);
  cand.sort((a, b) => b.t - a.t);
  for (const c of cand) {
    try {
      const raw = fs.readFileSync(c.p, "utf8");
      const p = JSON.parse(raw);
      let payload;
      if (p?.data?.records) payload = p;
      else if (Array.isArray(p?.records)) {
        payload = {
          version: 1, exportedAt: new Date().toISOString(),
          app: "generic", stats: {
            canteens: (p.canteens || []).length,
            floors:   (p.floors   || []).length,
            windows:  (p.windows  || []).length,
            records:  (p.records  || []).length,
          }, data: p,
        };
      }
      if (payload) {
        const dir = path.dirname(LATEST_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(LATEST_FILE, JSON.stringify(payload, null, 2), "utf8");
        log(`seedLatestFromBackups: ${path.basename(c.p)} → latest.json（${payload.stats.records}条）`);
        return;
      }
    } catch (e) { log(`skip ${c.p}: ${e.message}`); }
  }
  log("seedLatestFromBackups: 暂无可导入的 JSON，等待前端首次 /save");
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && req.url === "/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "generic-sync" }));
    return;
  }

  if (req.method === "GET" && req.url === "/data") {
    if (fs.existsSync(LATEST_FILE)) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      fs.createReadStream(LATEST_FILE, "utf8").pipe(res);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "暂无备份" }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/save") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 10 * 1024 * 1024) { req.destroy(); res.writeHead(413); res.end(); }
    });
    req.on("end", () => {
      try {
        const d = JSON.parse(body);
        const now = new Date();
        const stats = {
          canteens: (d.canteens || []).length,
          floors:   (d.floors   || []).length,
          windows:  (d.windows  || []).length,
          records:  (d.records  || []).length,
        };
        const payload = {
          version: 1, exportedAt: now.toISOString(),
          app: "generic", stats, data: d,
        };
        const str = JSON.stringify(payload, null, 2);
        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const fname = `${path.basename(GIT_REPO_DIR)}-${getDateString(now)}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
        fs.writeFileSync(path.join(BACKUP_DIR, fname), str, "utf8");
        const gitDir = path.dirname(LATEST_FILE);
        if (!fs.existsSync(gitDir)) fs.mkdirSync(gitDir, { recursive: true });
        fs.writeFileSync(LATEST_FILE, str, "utf8");
        log(`/save ok: ${fname}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, stats }));
      } catch (e) {
        log(`/save error: ${e.message}`);
        res.writeHead(500); res.end(e.message);
      }
    });
    return;
  }
  res.writeHead(404); res.end("Not Found");
});

let lastBackupDate = null;
function startDailyBackupTimer() {
  setInterval(() => {
    const now = new Date();
    const key = now.getFullYear() + "-" + now.getMonth() + "-" + now.getDate();
    if (now.getHours() >= BACKUP_HOUR && lastBackupDate !== key) {
      lastBackupDate = key;
      runGitBackup();
    }
  }, 60 * 1000);
  // 如果启动时已过 BACKUP_HOUR，等 10s 后把锁放开，下一个分钟 tick 补跑一次
  const n = new Date();
  if (n.getHours() >= BACKUP_HOUR) {
    lastBackupDate = (n.getFullYear()+"-"+n.getMonth()+"-"+n.getDate());
    setTimeout(() => { lastBackupDate = null; }, 10 * 1000);
  }
}

/**
 * 【v2 修复 #2 & #3】
 *  - #2: 用 git add -A，覆盖代码/根目录JSON/backups/latest.json 所有改动
 *        （过去只 add backups/latest.json 导致导出的 JSON 和代码改动没进仓库）
 *  - #3: latest.json 不存在不再直接 return，尝试从仓库根最新 JSON 取记录数，
 *        至少保证代码改动也能被 commit（过去因 latest 缺失整个备份跳过）
 */
function runGitBackup() {
  log("=== 自动 git 备份开始 ===");
  let stats = { records: 0 };
  try {
    if (fs.existsSync(LATEST_FILE)) {
      const p = JSON.parse(fs.readFileSync(LATEST_FILE, "utf8"));
      stats = p.stats || { records: (p.data?.records || []).length };
    } else {
      const files = (fs.readdirSync(GIT_REPO_DIR) || [])
        .filter(f => /-\d{8}-\d{4}\.json$/.test(f)).sort();
      if (files.length) {
        const last = JSON.parse(fs.readFileSync(path.join(GIT_REPO_DIR, files.at(-1)), "utf8"));
        stats = last.stats || { records: (last.data?.records || last.records || []).length };
      }
    }
  } catch (e) { log(`stats warn: ${e.message}`); }

  try {
    execSync("git add -A", { cwd: GIT_REPO_DIR, stdio: "pipe" });
    const st = execSync("git status --porcelain", { cwd: GIT_REPO_DIR, encoding: "utf8" });
    if (st.trim() === "") { log("无变化，跳过"); return; }
    const now = new Date();
    const ds = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate());
    const msg = `auto-backup: ${ds} ${stats.records}条记录`;
    execSync(`git commit -m "${msg}"`, { cwd: GIT_REPO_DIR, stdio: "pipe" });
    log(`commit: ${msg}`);
    const r = execSync("git push", { cwd: GIT_REPO_DIR, encoding: "utf8", timeout: 60000 });
    log(`push ok: ${r.trim().slice(0, 120)}`);
  } catch (e) {
    const se = e.stderr ? e.stderr.toString() : "";
    if (se.includes("nothing to commit") || se.includes("no changes added")) log("无变化，跳过");
    else {
      log(`备份失败: ${e.message} ${se.slice(0, 200)}`);
      try {
        execSync("git push", { cwd: GIT_REPO_DIR, timeout: 60000, stdio: "pipe" });
        log("重试 push ok");
      } catch (_) { log("push 持续失败，写入日志等明天自动重试"); }
    }
  }
}

server.listen(PORT, () => {
  log(`=== 备份同步服务器 v2 已启动 ===`);
  log(`监听: http://localhost:${PORT}`);
  log(`定时: 每天 ${BACKUP_HOUR}:00 自动 git add → commit → push`);
  seedLatestFromBackups();
  startDailyBackupTimer();
});

process.on("SIGINT", () => { server.close(); process.exit(0); });
process.on("SIGTERM", () => { server.close(); process.exit(0); });
```

#### 2.3 应用侧接入（POST /save）

在应用的**每次数据保存函数**（比如 `saveData()` 写 localStorage 之后）调用：

```js
async function syncToServer(data) {
  try {
    await fetch("http://localhost:<SERVER_PORT>/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch (e) {
    // 服务器没启动也没关系，数据已经在 localStorage 了，下次启动服务器后会在下次变更时同步
  }
}
```

#### 2.4 启动后台服务器 + Windows 开机自启

**启动一次（当前 session）：**
```powershell
$p = New-Object System.Diagnostics.ProcessStartInfo
$p.FileName  = "node"
$p.Arguments = "sync-server.js"
$p.WorkingDirectory = "<PROJECT_ROOT_ABS>"
$p.UseShellExecute = $true
$p.WindowStyle     = "Hidden"
[System.Diagnostics.Process]::Start($p)
```

**开机自启（写快捷方式到启动文件夹）：**
```powershell
$startup = [Environment]::GetFolderPath("Startup")
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut("$startup\GitAutoBackup.lnk")
$sc.TargetPath   = "node.exe"
$sc.Arguments    = "sync-server.js"
$sc.WorkingDirectory = "<PROJECT_ROOT_ABS>"
$sc.WindowStyle  = 7  # 隐藏
$sc.Save()
```

#### 2.5 验证（必做 4 项）

```powershell
# 1. 进程 & 端口
Get-Process node | Select Id, StartTime
Invoke-WebRequest http://localhost:<SERVER_PORT>/ping -UseBasicParsing
# → 期望：{"ok":true,"service":"generic-sync"}

# 2. latest.json 是否存在（即使前端没调用也应该被 seed 成功）
Test-Path "<PROJECT_ROOT_ABS>\backups\latest.json"

# 3. 手动触发一次备份
#    先在应用里改一个数据（触发 POST /save）
cd "<PROJECT_ROOT>"
git add -A
git status --porcelain
git commit -m "auto-backup: $(Get-Date -Format 'yyyyMMdd') X条记录（手动验证）"
git push
git status   # → up to date with 'origin/master'

# 4. 等明天 <BACKUP_HOUR> 后，去 GitHub 仓库检查是否真的有新提交
```

---

## 3. 误删后恢复流程

### 3.1 整仓库误删 → 从 GitHub clone 回来
```powershell
git clone "<REMOTE_URL>" "<PROJECT_ROOT>"
cd "<PROJECT_ROOT>"
# 打开应用，点『📥 导入数据』选择 backups/latest.json 或任意历史 JSON 即可恢复
```

### 3.2 没误删，但想回到某天的版本
```powershell
cd "<PROJECT_ROOT>"
git log --oneline -20           # 找目标 commit hash
# 方式一：安全，只看 diff
git show <HASH>:backups/latest.json > .\restore-temp.json

# 方式二：整个仓库回到那个版本（不破坏当前，先建分支）
git checkout -b restore-<HASH> <HASH>

# 方式三：误删了某个文件单独恢复
git checkout <HASH> -- index.html app.js style.css
```

### 3.3 import 恢复时的兼容
- 导入的 JSON 如果是 `{version, exportedAt, app, stats, data}` 格式 → 取 `.data`
- 如果是老格式 `{canteens, floors, windows, records}` → 直接用

---

## 4. 常见坑 & 排错清单（⚠️ 失败经验固化）

| 现象 | 原因 | 正确处理 |
|---|---|---|
| `Your branch is ahead of 'origin/master' by N commits` | `git push` 没成功（可能在等凭证 / 网络重置） | **不要再说 push 成功**，先把这个现象明确告诉用户，让他在 PowerShell 手动执行一次 `git push`，通常会弹浏览器授权 |
| push 输出被截断看不见 | 终端 stdout 被清 / 工具输出限制 | **只能** 用 `git status` 看是否 `up to date`，不能凭空假设成功 |
| `Recv failure: Connection was reset` | Git over HTTPS 网络不稳 | ① 重试 push 1 次；② 改 remote 到 SSH 协议；③ `git config http.postBuffer 524288000` 加 buffer |
| `fatal: Unable to create '.git/index.lock'` | 另一个 git 进程在运行 / 上次 crash 残留 | `Get-Process git \| Stop-Process -Force`；然后 `Remove-Item .git\index.lock -Force`；**绝对不要强推** |
| backups/latest.json 不存在 → 备份跳过 | 旧版 sync-server 没 seed | 已在 v2 修复：启动时 `seedLatestFromBackups()` 自动找历史 JSON 生成 |
| 改了项目根路径（rename 文件夹）后，定时备份不跑 | 旧进程仍持有旧路径句柄 | ① `Get-Process node \| ? cmd -like '*sync-server*' \| Stop-Process -Force` 杀旧进程；② 改 sync-server.js 里的路径常量；③ 重新启动服务器；④ 重新建启动快捷方式 |
| 导出的数据 JSON 没进仓库 | 旧版只 `git add backups/latest.json` | **必须改成** `git add -A` |
| TRAE 沙箱报 `EPERM / PathNotAllowed` | 沙箱不允许在白名单外改 .git / 新建目录 | 把执行脚本交给用户在 PowerShell 手动跑，**绝对不要在沙箱报错后假装成功** |
| 工作区有一堆 `-wal/-shm` 占用导致 add 失败 | 数据库或编辑器打开着 | 先关编辑器/进程，再在 .gitignore 排除这类临时文件 |
| remote 混乱：origin 指向错误地址 | 上次 add remote 名字搞混 | 先 `git remote -v` 读现状，再 `git remote set-url origin <正确URL>`，不要盲目 add |
| 开机后服务器没起来 | 快捷方式指到旧路径 | 打开 `shell:startup`（启动文件夹），检查 `.lnk` 的 `Target` 和 `Start in` 是否正确 |
| 备份日志太长占空间 | 每次启动都追加 | 定期滚动 `Move-Item sync-server.log sync-server-$(Get-Date -Format yyyyMM).log` |

---

## 5. 输出模板（回复用户时套用）

```
✅ 备份状态确认：

| 项 | 结果 |
|---|---|
| git status | ✅ up to date with 'origin/master'（已上传 GitHub）|
| 本地 latest.json | ✅ <PROJECT_ROOT_ABS>\backups\latest.json |
| 同步服务器 | ✅ PID <ID>，启动时间 <TIME>，ping ok |
| 下次自动备份 | ⏰ 明天 20:00 |

最新 3 次提交：
  be9cf87 auto-backup: 20260820 6条记录
  1868720 feat: 编辑功能
  1ebe6fc fix: 路径更新

恢复指南：万一误删 → git clone <REMOTE_URL> → 打开应用导入 backups/latest.json
```
