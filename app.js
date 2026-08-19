/* ========== 食堂饭菜记录本 - 核心逻辑 ========== */

const STORAGE_KEY = "canteen_records_v1";

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
          <button class="btn-icon delete" data-action="delete-canteen" data-id="${c.id}" title="删除">🗑️</button>
        </div>
        <div class="card-icon">🏫</div>
        <div class="card-title">${escapeHtml(c.name)}</div>
        <div class="card-desc">${escapeHtml(c.note || "共 " + c.floors + " 层楼")}</div>
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
      <div class="add-card-text">新建食堂</div>
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
}

/* ========== 渲染 - 楼层列表 ========== */
function renderFloors() {
  const grid = document.getElementById("floorGrid");
  const canteenId = state.nav.canteenId;
  const c = getCanteen(canteenId);
  if (!c) return;

  const floors = getFloorsByCanteen(canteenId);
  // 如果还没有楼层，按食堂设定的楼层数生成
  if (floors.length === 0 && c.floors > 0) {
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
function openCanteenModal() {
  document.getElementById("canteenForm").reset();
  document.getElementById("canteenFloors").value = 1;
  openModal("canteenModal");
}

document.getElementById("canteenForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("canteenName").value.trim();
  const floors = parseInt(document.getElementById("canteenFloors").value) || 1;
  const note = document.getElementById("canteenNote").value.trim();

  if (!name) return;

  const canteen = {
    id: uid(),
    name,
    floors,
    note,
    createdAt: Date.now(),
  };
  state.data.canteens.push(canteen);
  saveData();
  closeModal("canteenModal");

  // 如果在根视图，刷新
  if (state.nav.level === "root") {
    renderCanteens();
  }
});

/* ========== 新建楼层/窗口 ========== */
let addItemType = null;
function openAddItemModal(type, title, label) {
  addItemType = type;
  document.getElementById("addItemTitle").textContent = title;
  document.getElementById("addItemLabel").innerHTML = label + ' <span class="required">*</span>';
  document.getElementById("addItemName").value = "";
  document.getElementById("addItemName").placeholder = label;
  openModal("addItemModal");
  setTimeout(() => document.getElementById("addItemName").focus(), 100);
}

document.getElementById("addItemForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("addItemName").value.trim();
  if (!name || !addItemType) return;

  if (addItemType === "floor") {
    state.data.floors.push({
      id: uid(),
      canteenId: state.nav.canteenId,
      name,
      createdAt: Date.now(),
    });
    saveData();
    closeModal("addItemModal");
    renderFloors();
  } else if (addItemType === "window") {
    state.data.windows.push({
      id: uid(),
      floorId: state.nav.floorId,
      name,
      createdAt: Date.now(),
    });
    saveData();
    closeModal("addItemModal");
    renderWindows();
  }
});

/* ========== 新建记录 ========== */
document.getElementById("addRecordBtn").addEventListener("click", () => {
  openRecordModal(false);
});
document.getElementById("addRecordAtWindowBtn").addEventListener("click", () => {
  openRecordModal(true);
});

function openRecordModal(useCurrentWindow) {
  state.temp.images = [];
  state.temp.rating = 0;
  document.getElementById("recordForm").reset();
  document.getElementById("recordDate").value = todayStr();
  updateStarsUI(0);
  renderImagePreview();

  const hierarchy = document.getElementById("recordHierarchy");
  if (useCurrentWindow && state.nav.windowId) {
    hierarchy.classList.add("hidden");
  } else {
    hierarchy.classList.remove("hidden");
    populateRecordHierarchy();
  }

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

  // 导航到对应的窗口视图
  const w = getWindow(windowId);
  if (w) {
    navigateTo("window", windowId);
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
      <button class="btn btn-danger" id="deleteRecordBtn">删除记录</button>
    </div>
  `;

  document.getElementById("deleteRecordBtn").onclick = () => {
    closeModal("recordDetailModal");
    confirmDelete("record", recordId);
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

// ESC 关闭弹窗
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllModals();
});

/* ========== 初始化 ========== */
function init() {
  loadData();
  navigateTo("root");
}

init();
