/* ========== 饮食记录本 - 核心逻辑 ========== */

const STORAGE_KEY = "canteen_records_v1";

/* ========== 本地同步服务器配置 ========== */
const SYNC_SERVER_URL = "http://localhost:18923";

/* ========== 状态管理 ========== */
const state = {
  data: {
    canteens: [], // { id, name, floors, note, createdAt }
    // floors: [{ id, canteenId, name, createdAt }]
    // windows: [{ id, floorId, name, createdAt }]
    // records: [{ id, windowId, dishName, date, price, rating, images[], review, createdAt }]
    floors: [],
    windows: [],
    records: [],
  },
  nav: {
    level: "root", // root | canteen | floor | window
    canteenId: null,
    floorId: null,
    windowId: null,
  },
  temp: {
    images: [], // 上传临时图片
    rating: 0,
  },
  pendingDelete: null, // { type, id }
  pendingEdit: null,   // { type, id } for edit-mode form fills
};

/* ========== 存储工具 ========== */
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state.data = JSON.parse(raw);
    }
  } catch (e) {
    console.error("加载数据失败:", e);
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  } catch (e) {
    console.error("保存数据失败:", e);
    alert("保存数据失败：" + e.message);
  }
  // 异步同步到本地服务器（失败静默忽略）
  syncToServer();
}

// 同步数据到本地服务器（用于自动备份）
let syncTimer = null;
function syncToServer() {
  // 防抖：500ms 内多次调用只发一次请求
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      await fetch(SYNC_SERVER_URL + "/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state.data),
      });
      console.log("[同步] 数据已同步到本地服务器");
    } catch (e) {
      // 服务器没开或连接失败，静默忽略
      console.log("[同步] 本地服务器未运行，跳过同步");
    }
  }, 500);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ========== 工具函数 ========== */
function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return formatDate(new Date());
}

function getStars(count) {
  const n = Math.max(0, Math.min(5, Number(count) || 0));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function getCanteen(id) {
  return state.data.canteens.find((c) => c.id === id);
}
function getFloor(id) {
  return state.data.floors.find((f) => f.id === id);
}
function getWindow(id) {
  return state.data.windows.find((w) => w.id === id);
}
function getRecord(id) {
  return state.data.records.find((r) => r.id === id);
}

function getFloorsByCanteen(canteenId) {
  return state.data.floors.filter((f) => f.canteenId === canteenId);
}
function getWindowsByFloor(floorId) {
  return state.data.windows.filter((w) => w.floorId === floorId);
}
function getRecordsByWindow(windowId) {
  return state.data.records
    .filter((r) => r.windowId === windowId)
    .sort((a, b) => new Date(b.date) - new Date(a.date) || b.createdAt - a.createdAt);
}
function countRecordsByWindow(windowId) {
  return state.data.records.filter((r) => r.windowId === windowId).length;
}
function countRecordsByFloor(floorId) {
  const windows = getWindowsByFloor(floorId);
  return windows.reduce((sum, w) => sum + countRecordsByWindow(w.id), 0);
}
function countRecordsByCanteen(canteenId) {
  const floors = getFloorsByCanteen(canteenId);
  return floors.reduce((sum, f) => sum + countRecordsByFloor(f.id), 0);
}

/* ========== 弹窗控制 ========== */
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove("hidden");
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add("hidden");
}
function closeAllModals() {
  document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden"));
}

/* ========== 视图导航 ========== */
function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  const target = document.getElementById(name + "View");
  if (target) target.classList.add("active");
}

function updateBreadcrumb() {
  const bc = document.getElementById("breadcrumb");
  const items = [
    { level: "root", label: "全部食堂", id: null },
  ];

  if (state.nav.canteenId) {
    const c = getCanteen(state.nav.canteenId);
    if (c) items.push({ level: "canteen", label: c.name, id: c.id });
  }
  if (state.nav.floorId) {
    const f = getFloor(state.nav.floorId);
    if (f) items.push({ level: "floor", label: f.name, id: f.id });
  }
  if (state.nav.windowId) {
    const w = getWindow(state.nav.windowId);
    if (w) items.push({ level: "window", label: w.name, id: w.id });
  }

  let html = "";
  items.forEach((it, idx) => {
    const active = idx === items.length - 1 ? "active" : "";
    html += `<span class="crumb ${active}" data-level="${it.level}" data-id="${it.id || ""}">${it.label}</span>`;
    if (idx < items.length - 1) {
      html += `<span class="crumb-separator">›</span>`;
    }
  });
  bc.innerHTML = html;

  bc.querySelectorAll(".crumb").forEach((el) => {
    el.addEventListener("click", () => {
      const level = el.dataset.level;
      const id = el.dataset.id;
      navigateTo(level, id || null);
    });
  });
}

function navigateTo(level, id = null) {
  state.nav.level = level;

  if (level === "root") {
    state.nav.canteenId = null;
    state.nav.floorId = null;
    state.nav.windowId = null;
    showView("canteen");
    renderCanteens();
  } else if (level === "canteen") {
    state.nav.canteenId = id;
    state.nav.floorId = null;
    state.nav.windowId = null;
    showView("floor");
    renderFloors();
  } else if (level === "floor") {
    state.nav.floorId = id;
    const f = getFloor(id);
    if (f) state.nav.canteenId = f.canteenId;
    state.nav.windowId = null;
    showView("window");
    renderWindows();
  } else if (level === "window") {
    state.nav.windowId = id;
    const w = getWindow(id);
    if (w) {
      state.nav.floorId = w.floorId;
      const f = getFloor(w.floorId);
      if (f) state.nav.canteenId = f.canteenId;
    }
    showView("record");
    renderRecords();
  }

  updateBreadcrumb();
}

/* ========== 渲染 - 食堂列表 ========== */
function renderCanteens() {
  const grid = document.getElementById("canteenGrid");
  const empty = document.getElementById("canteenEmpty");
  const list = state.data.canteens;

  if (list.length === 0) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  let html = "";
  list.forEach((c) => {
    const floors = getFloorsByCanteen(c.id);
    const recCount = countRecordsByCanteen(c.id);
    html += `
      <div class="card" data-id="${c.id}">
        <div class="card-actions">
          <button class="btn-icon edit" data-action="edit-canteen" data-id="${c.id}" title="编辑">✏️</button>
          <button class="btn-icon delete" data-action="delete-canteen" data-id="${c.id}" title="删除">🗑️</button>
        </div>
        <div class="card-icon">🏫</div>
        <div class="card-title">${escapeHtml(c.name)}</div>
        <div class="card-desc">${escapeHtml(c.note || (c.floorMode === "custom" ? (c.floorLabel || "自定义") : "共 " + c.floors + " 层楼"))}</div>
        <div class="card-meta">
          <div class="meta-item">🏢 ${floors.length} 层</div>
          <div class="meta-item">📝 ${recCount} 条记录</div>
        </div>
      </div>
    `;
  });

  // 快速新建楼层卡片
  html += `
    <div class="card add-card" data-action="add-floor-quick">
      <div class="add-card-icon">+</div>
      <div class="add-card-text">新建</div>
    </div>
  `;

  grid.innerHTML = html;

  grid.querySelectorAll(".card").forEach((card) => {
    if (card.dataset.action === "add-floor-quick") {
      card.onclick = () => openCanteenModal();
    } else if (card.dataset.action === "delete-canteen") {
      // handled by delegation below
    } else {
      card.onclick = (e) => {
        if (e.target.closest("[data-action]")) return;
        navigateTo("canteen", card.dataset.id);
      };
    }
  });

  grid.querySelectorAll("[data-action='delete-canteen']").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      confirmDelete("canteen", btn.dataset.id);
    };
  });
  grid.querySelectorAll("[data-action='edit-canteen']").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openCanteenModal(btn.dataset.id);
    };
  });
}

/* ========== 渲染 - 楼层列表 ========== */
function renderFloors() {
  const grid = document.getElementById("floorGrid");
  const canteenId = state.nav.canteenId;
  const c = getCanteen(canteenId);
  if (!c) return;

  const floors = getFloorsByCanteen(canteenId);
  // 如果还没有楼层，按食堂设定的楼层数生成
  if (floors.length === 0 && c.floorMode !== "custom" && c.floors > 0) {
    for (let i = 1; i <= c.floors; i++) {
      const floor = {
        id: uid(),
        canteenId: c.id,
        name: `${i}楼`,
        createdAt: Date.now(),
      };
      state.data.floors.push(floor);
    }
    saveData();
    return renderFloors();
  }

  let html = "";
  floors.forEach((f) => {
    const windows = getWindowsByFloor(f.id);
    const recCount = countRecordsByFloor(f.id);
    html += `
      <div class="card" data-id="${f.id}">
        <div class="card-actions">
          <button class="btn-icon edit" data-action="edit-floor" data-id="${f.id}" title="编辑">✏️</button>
          <button class="btn-icon delete" data-action="delete-floor" data-id="${f.id}" title="删除">🗑️</button>
        </div>
        <div class="card-icon">🪜</div>
        <div class="card-title">${escapeHtml(f.name)}</div>
        <div class="card-desc">${c.name}</div>
        <div class="card-meta">
          <div class="meta-item">🪟 ${windows.length} 个窗口</div>
          <div class="meta-item">📝 ${recCount} 条记录</div>
        </div>
      </div>
    `;
  });

  html += `
    <div class="card add-card" data-action="add-floor">
      <div class="add-card-icon">+</div>
      <div class="add-card-text">添加楼层</div>
    </div>
  `;

  grid.innerHTML = html;

  grid.querySelectorAll(".card").forEach((card) => {
    if (card.dataset.action === "add-floor") {
      card.onclick = () => openAddItemModal("floor", "新建楼层", "楼层名称（如：3楼）");
    } else if (card.dataset.action === "delete-floor") {
      // handled below
    } else {
      card.onclick = (e) => {
        if (e.target.closest("[data-action]")) return;
        navigateTo("floor", card.dataset.id);
      };
    }
  });

  grid.querySelectorAll("[data-action='delete-floor']").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      confirmDelete("floor", btn.dataset.id);
    };
  });
  grid.querySelectorAll("[data-action='edit-floor']").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openAddItemModal("floor", "编辑楼层", "楼层名称", btn.dataset.id);
    };
  });
}

/* ========== 渲染 - 窗口列表 ========== */
function renderWindows() {
  const grid = document.getElementById("windowGrid");
  const floorId = state.nav.floorId;
  const f = getFloor(floorId);
  if (!f) return;

  const windows = getWindowsByFloor(floorId);

  let html = "";
  windows.forEach((w) => {
    const recCount = countRecordsByWindow(w.id);
    const records = getRecordsByWindow(w.id);
    const lastRecord = records[0];
    const lastDate = lastRecord ? formatDate(lastRecord.date) : "暂无记录";

    html += `
      <div class="card" data-id="${w.id}">
        <div class="card-actions">
          <button class="btn-icon edit" data-action="edit-window" data-id="${w.id}" title="编辑">✏️</button>
          <button class="btn-icon delete" data-action="delete-window" data-id="${w.id}" title="删除">🗑️</button>
        </div>
        <div class="card-icon">🪟</div>
        <div class="card-title">${escapeHtml(w.name)}</div>
        <div class="card-desc">最近：${lastDate}</div>
        <div class="card-meta">
          <div class="meta-item">📝 ${recCount} 条记录</div>
        </div>
      </div>
    `;
  });

  html += `
    <div class="card add-card" data-action="add-window">
      <div class="add-card-icon">+</div>
      <div class="add-card-text">添加窗口</div>
    </div>
  `;

  grid.innerHTML = html;

  grid.querySelectorAll(".card").forEach((card) => {
    if (card.dataset.action === "add-window") {
      card.onclick = () => openAddItemModal("window", "新建窗口", "窗口名称（如：黄焖鸡窗口）");
    } else if (card.dataset.action === "delete-window") {
      // handled below
    } else {
      card.onclick = (e) => {
        if (e.target.closest("[data-action]")) return;
        navigateTo("window", card.dataset.id);
      };
    }
  });

  grid.querySelectorAll("[data-action='delete-window']").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      confirmDelete("window", btn.dataset.id);
    };
  });
  grid.querySelectorAll("[data-action='edit-window']").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openAddItemModal("window", "编辑窗口", "窗口名称", btn.dataset.id);
    };
  });
}

/* ========== 渲染 - 记录列表 ========== */
function renderRecords() {
  const windowId = state.nav.windowId;
  const w = getWindow(windowId);
  if (!w) return;
  const f = getFloor(w.floorId);
  const c = f ? getCanteen(f.canteenId) : null;

  const title = document.getElementById("recordTitle");
  title.textContent = `${c ? c.name + " · " : ""}${f ? f.name + " · " : ""}${w.name}`;

  const list = document.getElementById("recordList");
  const empty = document.getElementById("recordEmpty");
  const records = getRecordsByWindow(windowId);

  if (records.length === 0) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  let html = "";
  records.forEach((r) => {
    const hasImg = r.images && r.images.length > 0;
    let imgHtml = "";
    if (hasImg) {
      const first = r.images[0];
      imgHtml = `
        <div class="record-images">
          <img src="${first}" alt="" />
          ${r.images.length > 1 ? `<div class="multi-images">+${r.images.length - 1}</div>` : ""}
        </div>
      `;
    } else {
      imgHtml = `<div class="record-no-image">🍽️</div>`;
    }

    const priceHtml = r.price ? `<div class="record-price">¥${Number(r.price).toFixed(2)}</div>` : "";
    const reviewHtml = r.review ? `<div class="record-review">${escapeHtml(r.review)}</div>` : "";
    const ratingHtml = r.rating > 0 ? `<div class="record-stars">${getStars(r.rating)}</div>` : "";

    html += `
      <div class="record-card" data-id="${r.id}">
        <div class="record-card-actions">
          <button class="btn-icon edit" title="编辑" onclick="event.stopPropagation();window.__editRecord('${r.id}')">✏️</button>
          <button class="btn-icon delete" title="删除" onclick="event.stopPropagation();window.__deleteRecordQuick('${r.id}')">🗑️</button>
        </div>
        ${imgHtml}
        <div class="record-info">
          <div class="record-title-row">
            <div class="record-dish-name">${escapeHtml(r.dishName)}</div>
            ${priceHtml}
          </div>
          <div class="record-meta-row">
            <div>📅 ${formatDate(r.date)}</div>
            ${ratingHtml}
          </div>
          ${reviewHtml}
        </div>
      </div>
    `;
  });

  list.innerHTML = html;

  list.querySelectorAll(".record-card").forEach((card) => {
    card.onclick = () => openRecordDetail(card.dataset.id);
  });
}

/* ========== 新建食堂 ========== */
function updateFloorTabActive() {
  document.querySelectorAll(".floor-tab").forEach((tab) => {
    const radio = tab.querySelector("input");
    tab.classList.toggle("active", radio.checked);
  });
}

function openCanteenModal(editId = null) {
  const form = document.getElementById("canteenForm");
  form.reset();
  state.pendingEdit = editId ? { type: "canteen", id: editId } : null;
  const titleEl = document.getElementById("canteenModalTitle");
  const numberInput = document.getElementById("canteenFloors");
  const customInput = document.getElementById("canteenFloorsCustom");

  if (editId) {
    const c = getCanteen(editId);
    if (!c) return;
    document.getElementById("canteenName").value = c.name;
    document.getElementById("canteenNote").value = c.note || "";
    if (c.floorMode === "custom") {
      document.querySelector('input[name="floorMode"][value="custom"]').checked = true;
      customInput.value = c.floorLabel || "";
      numberInput.classList.add("hidden");
      customInput.classList.remove("hidden");
    } else {
      document.querySelector('input[name="floorMode"][value="number"]').checked = true;
      numberInput.value = c.floors || 1;
      numberInput.classList.remove("hidden");
      customInput.classList.add("hidden");
    }
    updateFloorTabActive();
    if (titleEl) titleEl.textContent = "编辑";
  } else {
    document.querySelector('input[name="floorMode"][value="number"]').checked = true;
    numberInput.value = 1;
    numberInput.classList.remove("hidden");
    customInput.classList.add("hidden");
    updateFloorTabActive();
    if (titleEl) titleEl.textContent = "新建";
  }
  openModal("canteenModal");
}

document.querySelectorAll('input[name="floorMode"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const numberInput = document.getElementById("canteenFloors");
    const customInput = document.getElementById("canteenFloorsCustom");
    if (radio.value === "number" && radio.checked) {
      numberInput.classList.remove("hidden");
      customInput.classList.add("hidden");
    } else if (radio.value === "custom" && radio.checked) {
      numberInput.classList.add("hidden");
      customInput.classList.remove("hidden");
    }
    updateFloorTabActive();
  });
});

document.getElementById("canteenForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("canteenName").value.trim();
  const note = document.getElementById("canteenNote").value.trim();
  const floorMode = document.querySelector('input[name="floorMode"]:checked').value;

  let floors = 0;
  let floorLabel = "";
  if (floorMode === "number") {
    floors = parseInt(document.getElementById("canteenFloors").value) || 1;
  } else {
    floorLabel = document.getElementById("canteenFloorsCustom").value.trim();
  }

  if (!name) return;

  if (state.pendingEdit && state.pendingEdit.type === "canteen") {
    const idx = state.data.canteens.findIndex((x) => x.id === state.pendingEdit.id);
    if (idx >= 0) {
      state.data.canteens[idx].name = name;
      state.data.canteens[idx].note = note;
      state.data.canteens[idx].floorMode = floorMode;
      state.data.canteens[idx].floors = floors;
      state.data.canteens[idx].floorLabel = floorLabel;
      if (floorMode === "number") {
        const existing = getFloorsByCanteen(state.pendingEdit.id);
        for (let i = existing.length + 1; i <= floors; i++) {
          state.data.floors.push({ id: uid(), canteenId: state.pendingEdit.id, name: i + "楼", createdAt: Date.now() });
        }
      }
    }
  } else {
    state.data.canteens.push({ id: uid(), name, floors, floorMode, floorLabel, note, createdAt: Date.now() });
  }
  state.pendingEdit = null;
  saveData();
  closeModal("canteenModal");

  if (state.nav.level === "root") renderCanteens();
  else if (state.nav.level === "canteen") { renderFloors(); updateBreadcrumb(); }
});

/* ========== 新建楼层/窗口 ========== */
let addItemType = null;
function openAddItemModal(type, title, label, editId = null) {
  addItemType = type;
  state.pendingEdit = editId ? { type, id: editId } : null;
  document.getElementById("addItemTitle").textContent = title;
  document.getElementById("addItemLabel").innerHTML = label + ' <span class="required">*</span>';
  const input = document.getElementById("addItemName");
  input.placeholder = label;
  if (editId) {
    if (type === "floor") { const fl = getFloor(editId); input.value = fl ? fl.name : ""; }
    else if (type === "window") { const wn = getWindow(editId); input.value = wn ? wn.name : ""; }
  } else {
    input.value = "";
  }
  openModal("addItemModal");
  setTimeout(() => input.focus(), 100);
}

document.getElementById("addItemForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("addItemName").value.trim();
  if (!name || !addItemType) return;

  const editing = state.pendingEdit && state.pendingEdit.type === addItemType;

  if (addItemType === "floor") {
    if (editing) {
      const idx = state.data.floors.findIndex((fl) => fl.id === state.pendingEdit.id);
      if (idx >= 0) state.data.floors[idx].name = name;
    } else {
      state.data.floors.push({ id: uid(), canteenId: state.nav.canteenId, name, createdAt: Date.now() });
    }
    state.pendingEdit = null;
    saveData();
    closeModal("addItemModal");
    renderFloors();
    updateBreadcrumb();
  } else if (addItemType === "window") {
    if (editing) {
      const idx = state.data.windows.findIndex((wn) => wn.id === state.pendingEdit.id);
      if (idx >= 0) state.data.windows[idx].name = name;
    } else {
      state.data.windows.push({ id: uid(), floorId: state.nav.floorId, name, createdAt: Date.now() });
    }
    state.pendingEdit = null;
    saveData();
    closeModal("addItemModal");
    renderWindows();
    updateBreadcrumb();
  }
});

/* ========== 新建记录 ========== */
document.getElementById("addRecordBtn").addEventListener("click", () => {
  openRecordModal(false);
});
document.getElementById("addRecordAtWindowBtn").addEventListener("click", () => {
  openRecordModal(true);
});

function openRecordModal(useCurrentWindow, editId = null) {
  state.temp.images = [];
  state.temp.rating = 0;
  document.getElementById("recordForm").reset();
  document.getElementById("recordDate").value = todayStr();

  const titleEl = document.getElementById("recordModalTitle");
  const submitBtn = document.getElementById("recordSubmitBtn");
  const hierarchy = document.getElementById("recordHierarchy");

  if (editId) {
    state.pendingEdit = { type: "record", id: editId };
    const r = getRecord(editId);
    if (!r) return;
    document.getElementById("recordDishName").value = r.dishName;
    document.getElementById("recordDate").value = r.date || todayStr();
    document.getElementById("recordPrice").value = r.price ? r.price : "";
    document.getElementById("recordReview").value = r.review || "";
    state.temp.rating = r.rating || 0;
    state.temp.images = (r.images || []).slice();
    updateStarsUI(state.temp.rating);
    if (titleEl) titleEl.textContent = "编辑饭菜记录";
    if (submitBtn) submitBtn.textContent = "保存修改";
    hierarchy.classList.remove("hidden");
    populateRecordHierarchy();
    const w = getWindow(r.windowId);
    if (w) {
      const fl = getFloor(w.floorId);
      if (fl) document.getElementById("recordCanteenSelect").value = fl.canteenId;
      document.getElementById("recordCanteenSelect").dispatchEvent(new Event("change"));
      setTimeout(() => {
        document.getElementById("recordFloorSelect").value = w.floorId || "";
        document.getElementById("recordFloorSelect").dispatchEvent(new Event("change"));
        setTimeout(() => {
          document.getElementById("recordWindowSelect").value = r.windowId;
        }, 0);
      }, 0);
    }
  } else {
    state.pendingEdit = null;
    updateStarsUI(0);
    if (titleEl) titleEl.textContent = "新建饭菜记录";
    if (submitBtn) submitBtn.textContent = "保存记录";
    if (useCurrentWindow && state.nav.windowId) {
      hierarchy.classList.add("hidden");
    } else {
      hierarchy.classList.remove("hidden");
      populateRecordHierarchy();
    }
  }

  renderImagePreview();
  openModal("recordModal");
}

function populateRecordHierarchy() {
  const cSel = document.getElementById("recordCanteenSelect");
  const fSel = document.getElementById("recordFloorSelect");
  const wSel = document.getElementById("recordWindowSelect");

  // 食堂
  let cHtml = '<option value="">请选择食堂</option>';
  state.data.canteens.forEach((c) => {
    const sel = state.nav.canteenId === c.id ? "selected" : "";
    cHtml += `<option value="${c.id}" ${sel}>${escapeHtml(c.name)}</option>`;
  });
  cSel.innerHTML = cHtml;

  const updateFloors = () => {
    const cid = cSel.value;
    let fHtml = '<option value="">请选择楼层</option>';
    if (cid) {
      getFloorsByCanteen(cid).forEach((f) => {
        const sel = state.nav.floorId === f.id ? "selected" : "";
        fHtml += `<option value="${f.id}" ${sel}>${escapeHtml(f.name)}</option>`;
      });
    }
    fSel.innerHTML = fHtml;
    updateWindows();
  };

  const updateWindows = () => {
    const fid = fSel.value;
    let wHtml = '<option value="">请选择窗口</option>';
    if (fid) {
      getWindowsByFloor(fid).forEach((w) => {
        const sel = state.nav.windowId === w.id ? "selected" : "";
        wHtml += `<option value="${w.id}" ${sel}>${escapeHtml(w.name)}</option>`;
      });
    }
    wSel.innerHTML = wHtml;
  };

  cSel.onchange = updateFloors;
  fSel.onchange = updateWindows;
  updateFloors();
}

/* ---------- 星级评分 ---------- */
function updateStarsUI(value) {
  state.temp.rating = value;
  document.getElementById("recordRating").value = value;
  const stars = document.querySelectorAll("#starRating span");
  stars.forEach((s) => {
    const v = Number(s.dataset.value);
    s.classList.toggle("active", v <= value);
  });
}

document.querySelectorAll("#starRating span").forEach((s) => {
  s.addEventListener("click", () => {
    const v = Number(s.dataset.value);
    updateStarsUI(state.temp.rating === v ? 0 : v);
  });
});

/* ---------- 图片上传 ---------- */
document.getElementById("recordImage").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  for (const file of files) {
    try {
      const dataUrl = await readFileAsDataURL(file);
      // 压缩图片防止 localStorage 溢出
      const compressed = await compressImage(dataUrl, 1280, 0.85);
      state.temp.images.push(compressed);
    } catch (err) {
      console.error("图片处理失败:", err);
    }
  }
  renderImagePreview();
  e.target.value = ""; // 重置以便再次选择同一文件
});

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function compressImage(dataUrl, maxWidth = 1280, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > maxWidth) {
        h = Math.round((h * maxWidth) / w);
        w = maxWidth;
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function renderImagePreview() {
  const box = document.getElementById("imagePreview");
  if (state.temp.images.length === 0) {
    box.innerHTML = "";
    return;
  }
  let html = "";
  state.temp.images.forEach((src, idx) => {
    html += `
      <div class="image-preview-item">
        <img src="${src}" alt="" />
        <button type="button" class="image-preview-remove" data-idx="${idx}">&times;</button>
      </div>
    `;
  });
  box.innerHTML = html;
  box.querySelectorAll(".image-preview-remove").forEach((b) => {
    b.onclick = () => {
      state.temp.images.splice(Number(b.dataset.idx), 1);
      renderImagePreview();
    };
  });
}

/* ---------- 记录表单提交 ---------- */
document.getElementById("recordForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const useCurrent = document.getElementById("recordHierarchy").classList.contains("hidden");

  let windowId;
  if (useCurrent) {
    windowId = state.nav.windowId;
  } else {
    windowId = document.getElementById("recordWindowSelect").value;
    if (!windowId) {
      alert("请选择食堂、楼层和窗口");
      return;
    }
  }

  const dishName = document.getElementById("recordDishName").value.trim();
  if (!dishName) return;

  const date = document.getElementById("recordDate").value || todayStr();
  const price = document.getElementById("recordPrice").value;
  const rating = Number(document.getElementById("recordRating").value) || 0;
  const review = document.getElementById("recordReview").value.trim();

  if (state.pendingEdit && state.pendingEdit.type === "record") {
    const idx = state.data.records.findIndex((r) => r.id === state.pendingEdit.id);
    if (idx >= 0) {
      state.data.records[idx].windowId = windowId;
      state.data.records[idx].dishName = dishName;
      state.data.records[idx].date = date;
      state.data.records[idx].price = price ? Number(price) : null;
      state.data.records[idx].rating = rating;
      state.data.records[idx].images = [...state.temp.images];
      state.data.records[idx].review = review;
    }
    state.pendingEdit = null;
    saveData();
    closeModal("recordModal");
    if (state.nav.level === "window") renderRecords();
    if (state.nav.windowId !== windowId) {
      const w = getWindow(windowId);
      if (w) navigateTo("window", windowId);
    }
  } else {
    const record = {
      id: uid(),
      windowId,
      dishName,
      date,
      price: price ? Number(price) : null,
      rating,
      images: [...state.temp.images],
      review,
      createdAt: Date.now(),
    };
    state.data.records.push(record);
    saveData();
    closeModal("recordModal");
    const w = getWindow(windowId);
    if (w) navigateTo("window", windowId);
  }
});

/* ========== 记录详情 ========== */
function openRecordDetail(recordId) {
  const r = getRecord(recordId);
  if (!r) return;
  const w = getWindow(r.windowId);
  const f = w ? getFloor(w.floorId) : null;
  const c = f ? getCanteen(f.canteenId) : null;

  let imgHtml = "";
  if (r.images && r.images.length > 0) {
    imgHtml = `<div class="detail-section"><div class="detail-label">图片</div><div class="detail-images">`;
    r.images.forEach((src) => {
      imgHtml += `<img src="${src}" alt="" onclick="window.open('${src}','_blank')" />`;
    });
    imgHtml += `</div></div>`;
  }

  const priceHtml = r.price ? `<div class="detail-price">¥${Number(r.price).toFixed(2)}</div>` : "";
  const ratingHtml = r.rating > 0 ? `<div class="detail-stars">${getStars(r.rating)}</div>` : `<div class="detail-label" style="color:#cbd5e1">暂无评分</div>`;
  const reviewHtml = r.review ? escapeHtml(r.review).replace(/\n/g, "<br/>") : '<span style="color:#cbd5e1">暂无评价</span>';

  const path = [c?.name, f?.name, w?.name].filter(Boolean).join(" · ");

  const body = document.getElementById("recordDetailBody");
  document.getElementById("detailTitle").textContent = r.dishName;
  body.innerHTML = `
    <div class="detail-title">
      <div>
        ${escapeHtml(r.dishName)}
        ${priceHtml}
      </div>
    </div>
    <div class="detail-meta">
      <div class="detail-meta-item">
        <span class="detail-meta-label">📍</span>
        <span>${escapeHtml(path || "未知")}</span>
      </div>
      <div class="detail-meta-item">
        <span class="detail-meta-label">📅</span>
        <span>${formatDate(r.date)}</span>
      </div>
      <div class="detail-meta-item">
        <span class="detail-meta-label">⭐</span>
        <span>${ratingHtml}</span>
      </div>
    </div>
    ${imgHtml}
    <div class="detail-section">
      <div class="detail-label">文字评价</div>
      <div class="detail-value">${reviewHtml}</div>
    </div>
    <div class="detail-actions">
      <button class="btn btn-ghost" data-close="recordDetailModal">关闭</button>
      <button class="btn btn-primary" id="editRecordBtn" style="background:#2563eb">✏️ 编辑记录</button>
      <button class="btn btn-danger" id="deleteRecordBtn">删除记录</button>
    </div>
  `;

  document.getElementById("deleteRecordBtn").onclick = () => {
    closeModal("recordDetailModal");
    confirmDelete("record", recordId);
  };
  document.getElementById("editRecordBtn").onclick = () => {
    closeModal("recordDetailModal");
    openRecordModal(false, recordId);
  };

  openModal("recordDetailModal");
}

/* ========== 删除确认 ========== */
function confirmDelete(type, id) {
  state.pendingDelete = { type, id };
  const msg = document.getElementById("confirmMessage");
  let text = "确定要删除吗？此操作不可撤销。";
  if (type === "canteen") {
    const c = getCanteen(id);
    text = `确定要删除食堂「${c?.name || ""}」吗？该食堂下的所有楼层、窗口和饭菜记录都会被删除，此操作不可撤销！`;
  } else if (type === "floor") {
    const f = getFloor(id);
    text = `确定要删除楼层「${f?.name || ""}」吗？该楼层下的所有窗口和记录都会被删除！`;
  } else if (type === "window") {
    const w = getWindow(id);
    text = `确定要删除窗口「${w?.name || ""}」吗？该窗口下所有饭菜记录都会被删除！`;
  } else if (type === "record") {
    const r = getRecord(id);
    text = `确定要删除饭菜记录「${r?.dishName || ""}」吗？`;
  }
  msg.textContent = text;
  openModal("confirmModal");
}

document.getElementById("confirmDeleteBtn").addEventListener("click", () => {
  const { type, id } = state.pendingDelete || {};
  if (!type || !id) return;
  doDelete(type, id);
  state.pendingDelete = null;
  closeModal("confirmModal");
});

function doDelete(type, id) {
  if (type === "canteen") {
    state.data.canteens = state.data.canteens.filter((c) => c.id !== id);
    // 关联删除
    const floors = getFloorsByCanteen(id);
    floors.forEach((f) => {
      doDelete("floor", f.id);
    });
  } else if (type === "floor") {
    state.data.floors = state.data.floors.filter((f) => f.id !== id);
    const windows = getWindowsByFloor(id);
    windows.forEach((w) => doDelete("window", w.id));
  } else if (type === "window") {
    state.data.windows = state.data.windows.filter((w) => w.id !== id);
    state.data.records = state.data.records.filter((r) => r.windowId !== id);
  } else if (type === "record") {
    state.data.records = state.data.records.filter((r) => r.id !== id);
  }
  saveData();

  // 刷新当前视图
  const lv = state.nav.level;
  if (lv === "root") renderCanteens();
  else if (lv === "canteen") renderFloors();
  else if (lv === "floor") renderWindows();
  else if (lv === "window") renderRecords();

  // 如果删除了当前层级的对象，回退
  if (type === "window" && state.nav.windowId === id) navigateTo("floor", state.nav.floorId);
  if (type === "floor" && state.nav.floorId === id) navigateTo("canteen", state.nav.canteenId);
  if (type === "canteen" && state.nav.canteenId === id) navigateTo("root");
}

/* ========== HTML 转义 ========== */
function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ========== 数据导入/导出（可提交到 Git 做完整备份） ========== */
const DATA_FILE_VERSION = 1;

function exportData() {
  const payload = {
    version: DATA_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    app: "canteen_records",
    storageKey: STORAGE_KEY,
    stats: {
      canteens: state.data.canteens.length,
      floors: state.data.floors.length,
      windows: state.data.windows.length,
      records: state.data.records.length,
    },
    data: state.data,
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const stamp = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const fname = `canteen-records-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(
    stamp.getDate()
  )}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.json`;

  const a = document.createElement("a");
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);

  alert(
    `✅ 已导出为：${fname}\n\n` +
      `包含：${payload.stats.canteens} 个食堂 / ${payload.stats.floors} 层 / ${payload.stats.windows} 个窗口 / ${payload.stats.records} 条饭菜记录\n\n` +
      `建议把这个 JSON 文件放到项目目录下，然后 git add + git commit 一起提交，误删就能从 Git 历史里恢复。`
  );
}

async function importData(file) {
  if (!file) return;
  try {
    const text = await file.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      alert("❌ 文件不是合法的 JSON，无法导入。");
      return;
    }

    // 兼容：直接是 data 对象，或者是带 version + data 的包装
    let incomingData = null;
    if (payload && payload.data && Array.isArray(payload.data.canteens)) {
      incomingData = payload.data;
    } else if (payload && Array.isArray(payload.canteens)) {
      incomingData = payload;
    } else {
      alert("❌ JSON 结构不匹配，不是本应用导出的备份文件。");
      return;
    }

    const incomingCounts = {
      canteens: incomingData.canteens?.length || 0,
      floors: incomingData.floors?.length || 0,
      windows: incomingData.windows?.length || 0,
      records: incomingData.records?.length || 0,
    };
    const currentCounts = {
      canteens: state.data.canteens.length,
      floors: state.data.floors.length,
      windows: state.data.windows.length,
      records: state.data.records.length,
    };

    const summary =
      `📦 导入文件中包含：\n` +
      `   食堂 ${incomingCounts.canteens} / 楼层 ${incomingCounts.floors} / 窗口 ${incomingCounts.windows} / 饭菜记录 ${incomingCounts.records}\n\n` +
      `📂 当前数据：\n` +
      `   食堂 ${currentCounts.canteens} / 楼层 ${currentCounts.floors} / 窗口 ${currentCounts.windows} / 饭菜记录 ${currentCounts.records}\n\n` +
      `请选择导入方式：\n\n` +
      `【覆盖】清空当前所有数据，用导入文件完全替换（推荐用于恢复备份）\n` +
      `【合并】保留现有数据，把导入内容追加进来（相同 id 的项目以导入文件为准）`;

    const modeRaw = prompt(summary, "覆盖");
    if (!modeRaw) return;
    const mode = modeRaw.trim() === "合并" ? "merge" : "overwrite";

    if (mode === "overwrite") {
      state.data = {
        canteens: [],
        floors: [],
        windows: [],
        records: [],
        ...incomingData,
      };
    } else {
      // merge by id
      const mergeById = (curList, newList, keyField = "id") => {
        const map = new Map();
        curList.forEach((it) => map.set(it[keyField], it));
        (newList || []).forEach((it) => map.set(it[keyField], it));
        return Array.from(map.values());
      };
      state.data.canteens = mergeById(state.data.canteens, incomingData.canteens);
      state.data.floors = mergeById(state.data.floors, incomingData.floors);
      state.data.windows = mergeById(state.data.windows, incomingData.windows);
      state.data.records = mergeById(state.data.records, incomingData.records);
    }

    saveData();
    // 回退到根视图并刷新
    state.nav = { level: "root", canteenId: null, floorId: null, windowId: null };
    navigateTo("root");

    alert(
      mode === "overwrite"
        ? `✅ 已覆盖导入完成！\n现在共有：${state.data.canteens.length} 食堂 / ${state.data.floors.length} 楼层 / ${state.data.windows.length} 窗口 / ${state.data.records.length} 记录`
        : `✅ 已合并导入完成！\n现在共有：${state.data.canteens.length} 食堂 / ${state.data.floors.length} 楼层 / ${state.data.windows.length} 窗口 / ${state.data.records.length} 记录`
    );
  } catch (e) {
    console.error("导入失败:", e);
    alert("❌ 导入失败：" + (e.message || e));
  }
}

/* ========== 全局事件绑定 ========== */
document.addEventListener("click", (e) => {
  // 关闭弹窗按钮
  const closeBtn = e.target.closest("[data-close]");
  if (closeBtn) {
    closeModal(closeBtn.dataset.close);
  }
  // 点击遮罩关闭
  if (e.target.classList && e.target.classList.contains("modal")) {
    closeAllModals();
  }
});

document.getElementById("addCanteenBtn").addEventListener("click", openCanteenModal);

// 数据导入/导出按钮
document.getElementById("exportDataBtn").addEventListener("click", exportData);
document.getElementById("importDataBtn").addEventListener("click", () => {
  document.getElementById("importFileInput").click();
});
document.getElementById("importFileInput").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) importData(file);
  e.target.value = ""; // 允许重复选择同一文件
});

// ESC 关闭弹窗
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllModals();
});

/* ========== 记录卡片快捷操作 ========== */
window.__editRecord = function (recordId) {
  openRecordModal(false, recordId);
};
window.__deleteRecordQuick = function (recordId) {
  confirmDelete("record", recordId);
};

/* ========== 初始化 ========== */
function init() {
  loadData();
  navigateTo("root");
}

init();
