/* 業務獎金
   所有資料存在這台裝置的 localStorage，沒有後端、沒有網路請求（CSP connect-src 'none'）。
   給同仁看的是「分享報表」產生的圖片 —— 他們拿到的是當下的快照，不能改。 */
(() => {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n || 0).toLocaleString("zh-TW");
  const fmtUnits = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString("zh-TW");
  const pct = (r) => (Math.round(r * 1000) / 10).toFixed(1) + "%";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const localDate = (d = new Date()) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
  const stamp = () => { const d = new Date(); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // acTiers：冷氣台數 → 發放比例；conditions：未達成就扣減的目標；people：每位業務的冷氣台數與各目標是否達成。
  // 三者都空的時候不套用任何折算，行為跟舊版相同。
  const EMPTY = { name: "", start: "", end: "", staff: [], mode: "full", tiers: [], cats: [], acTiers: [], conditions: [], people: {} };
  const KEY = "lg-bonus-v1";
  const TAB_KEY = "lg-bonus-tab";
  const BACKUP_NAG_DAYS = 7;

  /* ---------- 儲存 ---------- */
  // 舊版的指定品項用 keywords（包含比對），新版改成 models（型號開頭比對），讀進來時一併轉換
  function normalizeSettings(raw) {
    const s = { ...clone(EMPTY), ...(raw || {}) };
    s.cats = (s.cats || []).map(({ keywords, ...c }) => ({ ...c, models: c.models || keywords || [] }));
    s.people = s.people || {};
    return s;
  }
  let state = { settings: normalizeSettings(), sales: [], lastBackup: null };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw) state = { settings: normalizeSettings(raw.settings), sales: raw.sales || [], lastBackup: raw.lastBackup || null };
  } catch {}
  const S = () => state.settings;

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch { flash("backupMsg", "err", "儲存失敗：瀏覽器空間不足或被封鎖。請先下載備份檔。"); return false; }
  }
  function commit() { const ok = persist(); renderAll(); return ok; }

  // 要求瀏覽器把這個網站的資料標成「不要自動清除」。不保證一定成功，所以備份頁會顯示結果。
  let persisted = null;
  if (navigator.storage?.persist) navigator.storage.persist().then((v) => { persisted = v; renderBackup(); }, () => {});

  function flash(id, kind, text) { const el = $(id); el.className = "msg " + kind; el.textContent = text; }

  /* ---------- 計算 ---------- */
  const tiersSorted = () => [...(S().tiers || [])].filter((t) => t.threshold > 0).sort((a, b) => a.threshold - b.threshold);

  function personal(amount) {
    const tiers = tiersSorted();
    let rate = 0, bonus = 0;
    for (const t of tiers) if (amount >= t.threshold) rate = t.rate;
    if (S().mode === "progressive") {
      tiers.forEach((t, i) => {
        if (amount <= t.threshold) return;
        const upper = tiers[i + 1] ? Math.min(amount, tiers[i + 1].threshold) : amount;
        bonus += (upper - t.threshold) * t.rate;
      });
    } else bonus = amount * rate;
    const next = tiers.find((t) => amount < t.threshold) || null;
    return { rate, bonus, next };
  }

  // 型號比對時忽略大小寫、空白與連字號：AB-123CD 打成 ab123cd 也認得
  const normModel = (m) => String(m || "").toUpperCase().replace(/[\s\-_]/g, "");
  function catForModel(model) {
    const m = normModel(model);
    if (!m) return null;
    return (S().cats || []).find((c) => (c.models || []).some((k) => normModel(k) && m.startsWith(normModel(k)))) || null;
  }

  // 冷氣發放比例：取「台數 ≥ 下限」的最高一級，跟 Excel 的 LOOKUP 一樣。沒設定冷氣條件時回傳 null（不折算）。
  function acRate(units) {
    const t = [...(S().acTiers || [])].sort((a, b) => a.min - b.min);
    if (!t.length) return null;
    let r = 0;
    for (const x of t) if (units >= x.min) r = x.pct;
    return r;
  }
  const personOf = (name) => (S().people || {})[name] || {};

  function catState() {
    const map = {};
    for (const c of S().cats || []) {
      const units = (c.opening || 0) + state.sales.filter((s) => s.cat === c.id).reduce((a, s) => a + (s.qty || 0), 0);
      const levels = [...(c.levels || [])].filter((l) => l.units > 0).sort((a, b) => a.units - b.units);
      let cur = null;
      for (const l of levels) if (units >= l.units) cur = l;
      const next = levels.find((l) => units < l.units) || null;
      const perUnit = cur && typeof cur.perUnit === "number" ? cur.perUnit : 0;
      const unset = levels.some((l) => typeof l.perUnit !== "number");
      map[c.id] = { cat: c, units, levels, cur, next, perUnit, unset };
    }
    return map;
  }

  function staffStats(cs) {
    const names = [...(S().staff || [])];
    for (const s of state.sales) if (s.staff && !names.includes(s.staff)) names.push(s.staff);
    return names.map((name) => {
      const mine = state.sales.filter((s) => s.staff === name);
      const amount = mine.reduce((a, s) => a + (s.amount || 0), 0);
      const count = mine.reduce((a, s) => a + (s.count ?? 1), 0);
      const p = personal(amount);
      let dzBonus = 0;
      for (const s of mine) if (s.cat && cs[s.cat]) dzBonus += (s.qty || 0) * cs[s.cat].perUnit;
      const ratio = p.next ? Math.min(1, amount / p.next.threshold) : (tiersSorted().length ? 1 : 0);
      // 實領 = (個人獎金 + 台獎) × 冷氣比例 × (1 − 未達成目標的扣減合計)，對應 Excel 的 D → E → H 欄
      const subtotal = p.bonus + dzBonus;
      const who = personOf(name);
      const ac = Number(who.ac) || 0;
      const acPct = acRate(ac);
      const unmet = (S().conditions || []).filter((c) => !(who.met || {})[c.id]);
      const deduct = unmet.reduce((a, c) => a + (c.deduct || 0), 0);
      const total = subtotal * (acPct ?? 1) * Math.max(0, 1 - deduct);
      return { name, amount, count, ...p, ratio, dzBonus, subtotal, ac, acPct, unmet, deduct, total, active: S().staff.includes(name) };
    }).sort((a, b) => b.amount - a.amount);
  }

  /* ---------- 總覽 ---------- */
  function renderHeader() {
    $("campaignTitle").textContent = S().name || "業務獎金";
    document.title = S().name ? S().name + "｜業務獎金" : "業務獎金";
    $("campaignDates").textContent = S().start && S().end
      ? `${S().start.replaceAll("-", "/")} – ${S().end.replaceAll("-", "/")}`
      : "尚未設定檔期，請到「規則設定」填寫";

    const nag = $("backupNag");
    const days = state.lastBackup ? (Date.now() - state.lastBackup) / 864e5 : Infinity;
    nag.hidden = !state.sales.length || days < BACKUP_NAG_DAYS;
    if (!nag.hidden) nag.innerHTML = `<b>${state.lastBackup ? `已經 ${Math.floor(days)} 天沒有備份。` : "還沒有備份過。"}</b>資料只存在這台裝置，建議現在下載一份備份檔。<button class="btn small" type="button" data-goto="backup">去備份</button>`;
  }

  function renderOverview() {
    const cs = catState();
    const stats = staffStats(cs);
    $("kSales").textContent = fmt(stats.reduce((a, s) => a + s.amount, 0));
    $("kBonus").textContent = fmt(stats.reduce((a, s) => a + s.total, 0));
    $("kCount").textContent = fmt(stats.reduce((a, s) => a + s.count, 0));
    if (S().end) {
      const days = Math.ceil((new Date(S().end + "T23:59:59") - new Date()) / 864e5);
      $("kDaysLbl").textContent = days >= 0 ? "檔期剩餘" : "檔期已結束";
      $("kDays").textContent = days >= 0 ? days + " 天" : Math.abs(days) + " 天前";
    } else { $("kDaysLbl").textContent = "檔期剩餘"; $("kDays").textContent = "–"; }

    const issues = [];
    if (!tiersSorted().length) issues.push("個人獎金門檻");
    if (Object.values(cs).some((c) => c.unset)) issues.push("部分指定品項的每台獎金");
    if ((S().acTiers || []).length && (S().staff || []).some((n) => personOf(n).ac == null)) issues.push("部分業務的冷氣台數");
    $("ruleNotice").hidden = !issues.length;
    $("ruleNotice").innerHTML = issues.length ? `<b>規則尚未設定完整：</b>${issues.join("、")}還沒填，到「規則設定」補上後會自動重算。` : "";

    const hasTiers = tiersSorted().length > 0;
    $("staffGrid").innerHTML = !stats.length
      ? `<div class="card empty">還沒有業務。到「規則設定」新增業務名單，或到「備份」還原備份檔。</div>`
      : stats.map((s, i) => {
        const n = s.next;
        const chip = !hasTiers ? `<span class="chip">門檻未設定</span>`
          : n ? (s.rate > 0 ? `<span class="chip on">獎金率 ${pct(s.rate)}</span>` : `<span class="chip">尚未達標</span>`)
          : `<span class="chip done">最高級 ${pct(s.rate)}</span>`;
        const cap = !hasTiers ? `<span>請先設定門檻</span><span></span>`
          : n ? `<span>距 <b class="num">${fmt(n.threshold)}</b> 還差 <b class="num">${fmt(n.threshold - s.amount)}</b></span><span class="num">${pct(s.ratio)}</span>`
          : `<span>已達最高門檻</span><span class="num">100%</span>`;
        return `<article class="card">
          <div class="card-head"><h3>${esc(s.name)}${s.active ? "" : ' <span class="chip">已移出名單</span>'}</h3><span class="rank">#${i + 1}</span></div>
          <div class="sales-line"><span class="big">${fmt(s.amount)}</span>${chip}</div>
          <div class="meter"><div class="bar ${n || !hasTiers ? "" : "done"}"><i style="width:${(s.ratio * 100).toFixed(1)}%"></i></div><div class="meter-cap">${cap}</div></div>
          ${n ? `<div class="hint">達標後獎金率 ${pct(n.rate)}</div>` : ""}
          <dl class="ledger">
            <dt>成交筆數</dt><dd>${fmt(s.count)}</dd>
            <dt>個人業績獎金</dt><dd>${fmt(s.bonus)}</dd>
            <dt>指定品項台獎</dt><dd>${fmt(s.dzBonus)}</dd>
            ${s.acPct != null || (S().conditions || []).length ? `<dt>小計</dt><dd>${fmt(s.subtotal)}</dd>` : ""}
            ${s.acPct != null ? `<dt>冷氣 ${fmtUnits(s.ac)} 台</dt><dd>× ${Math.round(s.acPct * 100)}%</dd>` : ""}
            ${s.unmet.map((c) => `<dt>未達成：${esc(c.name)}</dt><dd>− ${Math.round(c.deduct * 100)}%</dd>`).join("")}
            <dt class="total">實領獎金</dt><dd class="total">${fmt(s.total)}</dd>
          </dl>
        </article>`;
      }).join("");

    const cats = Object.values(cs);
    $("dzList").innerHTML = !cats.length ? `<div class="dz empty">尚未設定指定品項。</div>` : cats.map((c) => {
      const steps = c.levels.map((l) => `<span class="${c.units >= l.units ? "hit" : ""}" title="${l.units} 台起${typeof l.perUnit === "number" ? " 每台 " + fmt(l.perUnit) : " 獎金待設定"}">${l.units}台</span>`).join("");
      const per = c.cur ? (typeof c.cur.perUnit === "number" ? fmt(c.cur.perUnit) + " 元/台" : "待設定") : "未達第一級";
      return `<div class="dz">
        <h3>${esc(c.cat.name)}</h3>
        <div class="units">${fmt(c.units)}<small>台累積</small></div>
        ${c.cat.opening ? `<div class="hint">含期初 ${fmt(c.cat.opening)} 台未分配給業務：算進全店級距，但沒有人領到這幾台的台獎。</div>` : ""}
        ${steps ? `<div class="steps">${steps}</div>` : `<div class="hint">尚未設定級距</div>`}
        <dl class="ledger">
          <dt>目前每台獎金</dt><dd>${per}</dd>
          <dt>距下一級距</dt><dd>${c.next ? (c.next.units - c.units) + " 台" : "已達最高"}</dd>
          <dt>目前全店台獎</dt><dd>${fmt(c.units * c.perUnit)}</dd>
        </dl>
      </div>`;
    }).join("");
  }

  /* ---------- 銷售登錄 ---------- */
  let selectedStaff = null;
  let editingId = null;
  let pendingDelete = null;

  function renderEntry() {
    const staff = S().staff || [];
    if (selectedStaff && !staff.includes(selectedStaff) && !editingId) selectedStaff = null;
    const segNames = selectedStaff && !staff.includes(selectedStaff) ? [...staff, selectedStaff] : staff;
    $("staffSeg").innerHTML = segNames.length
      ? segNames.map((n) => `<button type="button" aria-pressed="${n === selectedStaff}" data-staff="${esc(n)}">${esc(n)}</button>`).join("")
      : `<span class="hint">請先到「規則設定」新增業務名單</span>`;

    const catSel = $("fCat"), keep = catSel.value;
    catSel.innerHTML = `<option value="">一般商品（非指定品項）</option>` + (S().cats || []).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
    if ([...catSel.options].some((o) => o.value === keep)) catSel.value = keep;

    const models = [...new Set(state.sales.filter((s) => s.kind !== "opening").map((s) => s.model).filter(Boolean))].slice(-100);
    $("modelList").innerHTML = models.map((m) => `<option value="${esc(m)}"></option>`).join("");

    const fs = $("filterStaff"), fKeep = fs.value;
    const names = [...new Set([...staff, ...state.sales.map((s) => s.staff)])];
    fs.innerHTML = `<option value="">全部業務</option>` + names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
    fs.value = names.includes(fKeep) ? fKeep : "";

    const catName = Object.fromEntries((S().cats || []).map((c) => [c.id, c.name]));
    const rows = state.sales.filter((s) => !fs.value || s.staff === fs.value)
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));
    $("recBody").innerHTML = rows.length ? rows.map((s) => `<tr class="${s.id === editingId ? "editing" : ""}">
        <td class="num">${esc((s.date || "").slice(5).replace("-", "/"))}</td>
        <td>${esc(s.staff)}</td>
        <td>${esc(s.model)}${s.cat && catName[s.cat] ? `<span class="tag">${esc(catName[s.cat])}</span>` : ""}${s.kind === "opening" ? `<span class="tag open">期初 ${s.count} 筆</span>` : ""}</td>
        <td class="r num">${s.qty ? fmt(s.qty) : "–"}</td>
        <td class="r num">${fmt(s.amount)}</td>
        <td class="r">${pendingDelete === s.id
          ? `<span class="confirm"><button class="btn small" type="button" data-confirm="${esc(s.id)}">刪除</button><button class="btn ghost small" type="button" data-cancel>取消</button></span>`
          : `${s.kind === "opening" ? "" : `<button class="act" type="button" data-edit="${esc(s.id)}">編輯</button>`}<button class="act" type="button" data-del="${esc(s.id)}" aria-label="刪除這筆">刪除</button>`}</td>
      </tr>`).join("") : `<tr><td colspan="6" class="empty">還沒有銷售紀錄。在左邊登錄第一筆後會出現在這裡。</td></tr>`;
  }

  function resetForm() {
    editingId = null;
    $("formTitle").textContent = "新增一筆銷售";
    $("saveSale").textContent = "登錄這筆銷售";
    $("cancelEdit").hidden = true;
    $("fModel").value = ""; $("fAmount").value = ""; $("fQty").value = "1"; $("fCat").value = "";
    $("catHint").textContent = CAT_HINT;
  }

  function startEdit(id) {
    const s = state.sales.find((x) => x.id === id); if (!s) return;
    editingId = id; selectedStaff = s.staff; pendingDelete = null;
    renderEntry();
    $("fDate").value = s.date; $("fQty").value = s.qty; $("fModel").value = s.model;
    $("fCat").value = s.cat || ""; $("fAmount").value = s.amount;
    $("formTitle").textContent = "編輯銷售紀錄";
    $("saveSale").textContent = "儲存修改";
    $("cancelEdit").hidden = false;
    $("catHint").textContent = "可手動更改指定品項";
    $("saleForm").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $("staffSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-staff]"); if (!b) return;
    selectedStaff = b.dataset.staff; renderEntry();
  });

  const CAT_HINT = "輸入型號後會依活動型號清單自動判斷，可手動更改";
  $("fModel").addEventListener("input", () => {
    const hit = catForModel($("fModel").value);
    $("fCat").value = hit ? hit.id : "";
    $("catHint").textContent = hit ? `已自動歸類為「${hit.name}」，可手動更改` : CAT_HINT;
  });

  $("saleForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!selectedStaff) return flash("saleMsg", "err", "請先點選是哪位業務的銷售。");
    const amount = Number($("fAmount").value), qty = Number($("fQty").value);
    // 金額可以填 0：用來把期初的指定品項台數補登到個別業務名下，業績不會重複計算
    if (!(amount >= 0) || $("fAmount").value === "" || !(qty >= 1)) return flash("saleMsg", "err", "請填金額（補登台數可填 0），數量至少 1 台。");
    const fields = { date: $("fDate").value, staff: selectedStaff, model: $("fModel").value.trim(), cat: $("fCat").value || null, amount, qty };
    let text;
    if (editingId) {
      const i = state.sales.findIndex((s) => s.id === editingId);
      if (i >= 0) state.sales[i] = { ...state.sales[i], ...fields };
      text = `已修改：${fields.staff}　${fields.model}　${fmt(amount)} 元`;
    } else {
      state.sales.push({ id: uid(), ...fields, count: 1, kind: "sale", createdAt: Date.now() });
      text = `已登錄：${fields.staff}　${fields.model}　${fmt(amount)} 元`;
    }
    resetForm();
    if (commit()) flash("saleMsg", "ok", text);
    $("fModel").focus();
  });
  $("cancelEdit").addEventListener("click", () => { resetForm(); renderEntry(); $("saleMsg").textContent = ""; });

  $("filterStaff").addEventListener("change", renderEntry);
  $("recBody").addEventListener("click", (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.edit) startEdit(t.dataset.edit);
    else if (t.dataset.del) { pendingDelete = t.dataset.del; renderEntry(); }
    else if (t.hasAttribute("data-cancel")) { pendingDelete = null; renderEntry(); }
    else if (t.dataset.confirm) {
      const id = t.dataset.confirm;
      pendingDelete = null;
      if (id === editingId) resetForm();
      state.sales = state.sales.filter((s) => s.id !== id);
      if (commit()) flash("listMsg", "ok", "已刪除一筆。");
    }
  });

  /* ---------- 規則設定 ---------- */
  let draft = null;
  let dirty = false;

  function loadDraft() { draft = clone(S()); dirty = false; renderSettings(); $("setMsg").textContent = ""; }
  function markDirty() { dirty = true; flash("setMsg", "", "有尚未儲存的修改"); }

  function renderSettings() {
    if (!draft) draft = clone(S());
    $("sName").value = draft.name || "";
    $("sStart").value = draft.start || "";
    $("sEnd").value = draft.end || "";
    $("sMode").value = draft.mode || "full";
    $("staffEd").innerHTML = draft.staff.map((n, i) => `<div class="li staff"><input type="text" id="st-${i}" data-k="staff" data-i="${i}" value="${esc(n)}" aria-label="業務姓名" placeholder="姓名"><button class="x" type="button" data-rm="staff" data-i="${i}" aria-label="移除">✕</button></div>`).join("") || `<span class="hint">尚無業務</span>`;
    $("tierEd").innerHTML = draft.tiers.map((t, i) => `<div class="li tier">
        <input type="number" id="tt-${i}" min="0" step="1000" data-k="tier-th" data-i="${i}" value="${t.threshold || ""}" aria-label="門檻金額">
        <input type="number" id="tr-${i}" min="0" step="0.1" data-k="tier-rate" data-i="${i}" value="${t.rate != null ? +(t.rate * 100).toFixed(3) : ""}" aria-label="獎金率">
        <button class="x" type="button" data-rm="tier" data-i="${i}" aria-label="移除">✕</button></div>`).join("") || `<span class="hint">尚無門檻</span>`;
    $("catEd").innerHTML = draft.cats.map((c, ci) => `<div class="cat-box">
        <div class="cat-head"><input type="text" id="cn-${ci}" data-k="cat-name" data-ci="${ci}" value="${esc(c.name)}" aria-label="品項名稱" placeholder="品項名稱">
          <button class="x" type="button" data-rm="cat" data-ci="${ci}" aria-label="移除品項">✕</button></div>
        <div class="row2">
          <div class="field"><label for="ck-${ci}">活動型號（逗號分隔，可只填開頭）</label><input type="text" id="ck-${ci}" data-k="cat-kw" data-ci="${ci}" value="${esc((c.models || []).join(", "))}" placeholder="例如 AB-123CD, EF456"></div>
          <div class="field"><label for="co-${ci}">期初台數</label><input type="number" id="co-${ci}" min="0" step="1" data-k="cat-open" data-ci="${ci}" value="${c.opening || 0}"></div>
        </div>
        <div class="col-lbl level"><span>全店累積達（台）</span><span>每台獎金（元，空白＝待設定）</span><span></span></div>
        <div class="list-ed">${(c.levels || []).map((l, li) => `<div class="li level">
          <input type="number" id="lu-${ci}-${li}" min="1" step="1" data-k="lv-u" data-ci="${ci}" data-li="${li}" value="${l.units || ""}" aria-label="台數">
          <input type="number" id="lp-${ci}-${li}" min="0" step="1" data-k="lv-p" data-ci="${ci}" data-li="${li}" value="${typeof l.perUnit === "number" ? l.perUnit : ""}" aria-label="每台獎金" placeholder="待設定">
          <button class="x" type="button" data-rm="lv" data-ci="${ci}" data-li="${li}" aria-label="移除級距">✕</button></div>`).join("")}</div>
        <div><button class="btn ghost small" type="button" data-addlv="${ci}">＋ 新增級距</button></div>
      </div>`).join("") || `<span class="hint">尚無指定品項</span>`;
    $("acEd").innerHTML = (draft.acTiers || []).map((t, i) => `<div class="li tier">
        <input type="number" id="am-${i}" min="0" step="0.01" data-k="ac-min" data-i="${i}" value="${t.min ?? ""}" aria-label="冷氣台數下限">
        <input type="number" id="ap-${i}" min="0" max="100" step="1" data-k="ac-pct" data-i="${i}" value="${t.pct != null ? Math.round(t.pct * 100) : ""}" aria-label="發放比例">
        <button class="x" type="button" data-rm="ac" data-i="${i}" aria-label="移除">✕</button></div>`).join("") || `<span class="hint">未設定，獎金不依冷氣台數折算</span>`;
    $("condEd").innerHTML = (draft.conditions || []).map((c, i) => `<div class="li tier">
        <input type="text" id="cdn-${i}" data-k="cond-name" data-i="${i}" value="${esc(c.name)}" aria-label="目標名稱" placeholder="例如 門市銷貨目標">
        <input type="number" id="cdd-${i}" min="0" max="100" step="1" data-k="cond-ded" data-i="${i}" value="${c.deduct != null ? Math.round(c.deduct * 100) : ""}" aria-label="未達成扣減">
        <button class="x" type="button" data-rm="cond" data-i="${i}" aria-label="移除">✕</button></div>`).join("") || `<span class="hint">未設定</span>`;
    renderPeopleEditor();
  }

  const personDraft = (name) => ((draft.people ||= {})[name] ||= {});

  function renderPeopleEditor() {
    const conds = draft.conditions || [];
    const hasAc = (draft.acTiers || []).length > 0;
    const names = draft.staff.map((n) => n.trim()).filter(Boolean);
    $("peopleEd").innerHTML = !names.length ? `<span class="hint">先在上面新增業務名單</span>`
      : !hasAc && !conds.length ? `<span class="hint">還沒有設定冷氣條件或目標條件</span>`
      : `<div class="tbl-wrap"><table>
        <thead><tr><th>業務</th>${hasAc ? "<th>冷氣台數</th>" : ""}${conds.map((c) => `<th>${esc(c.name || "未命名")}已達成</th>`).join("")}</tr></thead>
        <tbody>${names.map((n, i) => {
          const p = (draft.people || {})[n] || {};
          return `<tr><td>${esc(n)}</td>
            ${hasAc ? `<td><input type="number" class="ac-in" id="pac-${i}" min="0" step="0.01" data-k="p-ac" data-name="${esc(n)}" value="${p.ac ?? ""}" aria-label="${esc(n)} 冷氣台數" placeholder="未填"></td>` : ""}
            ${conds.map((c, j) => `<td><input type="checkbox" class="met-in" id="pm-${i}-${j}" data-k="p-met" data-name="${esc(n)}" data-cond="${esc(c.id)}" ${(p.met || {})[c.id] ? "checked" : ""} aria-label="${esc(n)} ${esc(c.name)}已達成"></td>`).join("")}
          </tr>`;
        }).join("")}</tbody></table></div>`;
  }

  $("view-settings").addEventListener("input", (e) => {
    if (!draft) return;
    const t = e.target, k = t.dataset.k;
    const i = +t.dataset.i, ci = +t.dataset.ci, li = +t.dataset.li;
    const num = t.value === "" ? null : Number(t.value);
    if (t.id === "sName") draft.name = t.value;
    else if (t.id === "sStart") draft.start = t.value;
    else if (t.id === "sEnd") draft.end = t.value;
    else if (t.id === "sMode") draft.mode = t.value;
    else if (k === "staff") draft.staff[i] = t.value;
    else if (k === "tier-th") draft.tiers[i].threshold = num ?? 0;
    else if (k === "tier-rate") draft.tiers[i].rate = num == null ? 0 : num / 100;
    else if (k === "cat-name") draft.cats[ci].name = t.value;
    else if (k === "cat-kw") draft.cats[ci].models = t.value.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
    else if (k === "ac-min") draft.acTiers[i].min = num ?? 0;
    else if (k === "ac-pct") draft.acTiers[i].pct = num == null ? 0 : num / 100;
    else if (k === "cond-name") draft.conditions[i].name = t.value;
    else if (k === "cond-ded") draft.conditions[i].deduct = num == null ? 0 : num / 100;
    else if (k === "p-ac") personDraft(t.dataset.name).ac = num;
    else if (k === "p-met") (personDraft(t.dataset.name).met ||= {})[t.dataset.cond] = t.checked;
    else if (k === "cat-open") draft.cats[ci].opening = num ?? 0;
    else if (k === "lv-u") draft.cats[ci].levels[li].units = num ?? 0;
    else if (k === "lv-p") draft.cats[ci].levels[li].perUnit = num;
    else return;
    if (k === "staff" || k === "cond-name") renderPeopleEditor();
    markDirty();
  });
  $("view-settings").addEventListener("click", (e) => {
    const t = e.target.closest("button"); if (!t || !draft) return;
    if (t.id === "addStaff") draft.staff.push("");
    else if (t.id === "addTier") draft.tiers.push({ threshold: 0, rate: 0 });
    else if (t.id === "addCat") draft.cats.push({ id: "c" + uid(), name: "", models: [], opening: 0, levels: [] });
    else if (t.id === "addAc") draft.acTiers.push({ min: 0, pct: 0 });
    else if (t.id === "addCond") draft.conditions.push({ id: "k" + uid(), name: "", deduct: 0.1 });
    else if (t.dataset.rm === "ac") draft.acTiers.splice(+t.dataset.i, 1);
    else if (t.dataset.rm === "cond") draft.conditions.splice(+t.dataset.i, 1);
    else if (t.dataset.addlv != null) draft.cats[+t.dataset.addlv].levels.push({ units: 0, perUnit: null });
    else if (t.dataset.rm === "staff") draft.staff.splice(+t.dataset.i, 1);
    else if (t.dataset.rm === "tier") draft.tiers.splice(+t.dataset.i, 1);
    else if (t.dataset.rm === "cat") draft.cats.splice(+t.dataset.ci, 1);
    else if (t.dataset.rm === "lv") draft.cats[+t.dataset.ci].levels.splice(+t.dataset.li, 1);
    else return;
    renderSettings(); markDirty();
  });
  $("resetSettings").addEventListener("click", loadDraft);
  $("saveSettings").addEventListener("click", () => {
    const s = clone(draft);
    s.name = s.name.trim();
    s.staff = [...new Set(s.staff.map((n) => n.trim()).filter(Boolean))];
    s.tiers = s.tiers.filter((t) => t.threshold > 0).sort((a, b) => a.threshold - b.threshold);
    s.cats = s.cats.filter((c) => c.name.trim()).map((c) => ({ ...c, name: c.name.trim(), levels: c.levels.filter((l) => l.units > 0).sort((a, b) => a.units - b.units) }));
    s.acTiers = (s.acTiers || []).sort((a, b) => a.min - b.min);
    s.conditions = (s.conditions || []).filter((c) => c.name.trim()).map((c) => ({ ...c, name: c.name.trim() }));
    state.settings = s;
    if (commit()) { loadDraft(); flash("setMsg", "ok", "規則已儲存，總覽已重新計算。"); }
  });

  /* ---------- 檔案輸出 ----------
     手機上優先叫出系統分享選單（可以直接傳到 LINE 或存到檔案），
     不支援的瀏覽器才退回一般下載。 */
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  async function shareOrDownload(blob, filename, title) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title }); return "shared"; }
      catch (err) { if (err?.name === "AbortError") return "cancelled"; }
    }
    download(blob, filename);
    return "downloaded";
  }
  const fileStamp = () => localDate().replaceAll("-", "");

  /* ---------- 分享報表 ---------- */
  const reportOpts = () => ({ bonus: $("rBonus").checked, rate: $("rRate").checked, dz: $("rDz").checked });

  function drawReport() {
    const o = reportOpts();
    const cs = catState(), stats = staffStats(cs), cats = Object.values(cs);
    const hasTiers = tiersSorted().length > 0;
    const W = 1080, P = 56, ROW = 116, DZROW = 64;
    const H = P + 150 + 50 + Math.max(1, stats.length) * ROW + (o.dz && cats.length ? 90 + cats.length * DZROW : 0) + 90;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const F = (w, size) => `${w} ${size}px "Archivo","Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif`;
    const C = { bg: "#ffffff", ink: "#1d1a21", muted: "#6c6573", line: "#e4e0e8", accent: "#b80d42", track: "#ece8ef", good: "#17845a" };

    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    g.fillStyle = C.accent; g.fillRect(0, 0, W, 10);
    let y = P + 40;
    g.fillStyle = C.ink; g.font = F(900, 44); g.textBaseline = "alphabetic";
    g.fillText(S().name || "業績進度", P, y);
    y += 44;
    g.fillStyle = C.muted; g.font = F(500, 24);
    const dates = S().start && S().end ? `檔期 ${S().start.slice(5).replace("-", "/")}–${S().end.slice(5).replace("-", "/")}　` : "";
    g.fillText(`${dates}更新於 ${stamp()}`, P, y);
    y += 46;

    const total = stats.reduce((a, s) => a + s.amount, 0);
    g.fillStyle = C.ink; g.font = F(700, 26);
    g.fillText(`全店累計 ${fmt(total)}`, P, y);
    if (o.bonus) { g.textAlign = "right"; g.fillStyle = C.accent; g.fillText(`獎金合計 ${fmt(stats.reduce((a, s) => a + s.total, 0))}`, W - P, y); g.textAlign = "left"; }
    y += 30;
    g.fillStyle = C.line; g.fillRect(P, y, W - 2 * P, 2);
    y += 20;

    if (!stats.length) { g.fillStyle = C.muted; g.font = F(500, 26); g.fillText("尚無資料", P, y + 50); y += ROW; }
    stats.forEach((s, i) => {
      const top = y + i * ROW;
      g.fillStyle = C.muted; g.font = F(700, 26); g.fillText(String(i + 1), P, top + 40);
      g.fillStyle = C.ink; g.font = F(700, 30); g.fillText(s.name, P + 44, top + 40);
      g.font = F(700, 32); g.textAlign = "right";
      const rightX = W - P;
      if (o.bonus) {
        g.fillStyle = C.accent; g.fillText(fmt(s.total), rightX, top + 40);
        g.fillStyle = C.muted; g.font = F(500, 18); g.fillText("實領獎金", rightX, top + 66);
      }
      const salesX = o.bonus ? rightX - 220 : rightX;
      g.fillStyle = C.ink; g.font = F(700, 32); g.fillText(fmt(s.amount), salesX, top + 40);
      g.fillStyle = C.muted; g.font = F(500, 18); g.fillText("累計業績", salesX, top + 66);
      g.textAlign = "left";
      // 進度條在姓名下方，說明文字再下一行，避免跟右側數字欄位重疊
      const bx = P + 44, bw = 360, by = top + 58;
      if (hasTiers) {
        g.fillStyle = C.track; roundRect(g, bx, by, bw, 10, 5); g.fill();
        g.fillStyle = s.next ? C.accent : C.good; roundRect(g, bx, by, Math.max(10, bw * s.ratio), 10, 5); g.fill();
        const parts = [s.next ? `達成 ${pct(s.ratio)}` : "已達最高門檻"];
        if (o.rate && s.next) parts.push(`差 ${fmt(s.next.threshold - s.amount)}`);
        if (o.rate) parts.push(`獎金率 ${pct(s.rate)}`);
        g.fillStyle = C.muted; g.font = F(500, 18); g.fillText(parts.join("・"), bx, by + 36);
      }
      g.fillStyle = C.line; g.fillRect(P, top + ROW - 2, W - 2 * P, 1);
    });
    y += Math.max(1, stats.length) * ROW;

    if (o.dz && cats.length) {
      y += 54;
      g.fillStyle = C.ink; g.font = F(700, 28); g.fillText("門市指定品項累積", P, y);
      y += 20;
      cats.forEach((c, i) => {
        const top = y + i * DZROW;
        g.fillStyle = C.ink; g.font = F(500, 26); g.fillText(c.cat.name, P, top + 42);
        g.textAlign = "right";
        g.font = F(700, 28); g.fillText(`${fmt(c.units)} 台`, W - P - 300, top + 42);
        g.fillStyle = C.muted; g.font = F(500, 22);
        const nextTxt = c.next ? `差 ${c.next.units - c.units} 台到下一級` : "已達最高級";
        const perTxt = o.bonus && c.cur && typeof c.cur.perUnit === "number" ? `　每台 ${fmt(c.cur.perUnit)}` : "";
        g.fillText(nextTxt + perTxt, W - P, top + 42);
        g.textAlign = "left";
        g.fillStyle = C.line; g.fillRect(P, top + DZROW - 2, W - 2 * P, 1);
      });
      y += cats.length * DZROW;
    }
    g.fillStyle = C.muted; g.font = F(500, 18);
    g.fillText("本表為截至更新時間的統計，實際獎金以公司核發為準。", P, H - 40);
    return cv;
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  let previewUrl = null;
  async function renderReport() {
    await document.fonts?.ready;
    drawReport().toBlob((b) => {
      if (!b) return;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(b);
      $("reportImg").src = previewUrl;
    }, "image/png");
  }
  const reportBlob = () => new Promise((res) => drawReport().toBlob(res, "image/png"));

  function reportText() {
    const o = reportOpts();
    const cs = catState(), stats = staffStats(cs), hasTiers = tiersSorted().length > 0;
    const lines = [`【${S().name || "業績進度"}】${stamp()} 更新`];
    stats.forEach((s, i) => {
      let l = `${i + 1}. ${s.name}　${fmt(s.amount)}`;
      if (hasTiers) l += s.next ? `（${pct(s.ratio)}）` : "（已達最高門檻）";
      if (o.rate && hasTiers) l += `　獎金率 ${pct(s.rate)}`;
      if (o.bonus) l += `　獎金 ${fmt(s.total)}`;
      lines.push(l);
    });
    if (o.dz) {
      const cats = Object.values(cs);
      if (cats.length) lines.push("", "指定品項累積：");
      for (const c of cats) lines.push(`・${c.cat.name} ${fmt(c.units)} 台${c.next ? `，差 ${c.next.units - c.units} 台到下一級` : "，已達最高級"}`);
    }
    return lines.join("\n");
  }

  for (const id of ["rBonus", "rRate", "rDz"]) $(id).addEventListener("change", renderReport);
  $("shareImg").addEventListener("click", async () => {
    const r = await shareOrDownload(await reportBlob(), `業績進度-${fileStamp()}.png`, S().name || "業績進度");
    if (r === "downloaded") flash("reportMsg", "ok", "這個瀏覽器不支援直接分享，已改為下載圖片。");
    else if (r === "shared") flash("reportMsg", "ok", "已送出。");
  });
  $("saveImg").addEventListener("click", async () => { download(await reportBlob(), `業績進度-${fileStamp()}.png`); flash("reportMsg", "ok", "已下載圖片。"); });
  $("copyText").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(reportText()); flash("reportMsg", "ok", "已複製，可以直接貼到 LINE。"); }
    catch { flash("reportMsg", "err", "無法自動複製，這個瀏覽器不允許。請改用分享圖片。"); }
  });

  /* ---------- 備份 ---------- */
  function backupPayload() {
    return JSON.stringify({ app: "lg-bonus", version: 1, exportedAt: new Date().toISOString(), settings: S(), sales: state.sales }, null, 2);
  }
  function exportBackup() {
    download(new Blob([backupPayload()], { type: "application/json" }), `業務獎金備份-${fileStamp()}.json`);
    state.lastBackup = Date.now();
    commit();
  }
  function renderBackup() {
    $("bCount").textContent = fmt(state.sales.length) + " 筆";
    $("bLast").textContent = state.lastBackup ? new Date(state.lastBackup).toLocaleString("zh-TW", { dateStyle: "medium", timeStyle: "short" }) : "從未備份";
    $("bPersist").textContent = persisted === true ? "已開啟，瀏覽器不會自動清除" : persisted === false ? "未開啟，空間不足時可能被清除" : "這個瀏覽器不支援";
    $("clearN").textContent = fmt(state.sales.length);
  }
  $("exportJson").addEventListener("click", () => { exportBackup(); flash("backupMsg", "ok", "已下載備份檔。請存到電腦或雲端硬碟，不要只留在這台裝置。"); });

  let pendingImport = null;
  $("importJson").addEventListener("change", async (e) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== "lg-bonus" || !d.settings || !Array.isArray(d.sales)) throw new Error();
      pendingImport = d;
      $("importSummary").innerHTML = `備份檔「${esc(f.name)}」：${esc(d.settings.name || "未命名檔期")}，${fmt(d.sales.length)} 筆銷售紀錄、${(d.settings.staff || []).length} 位業務。<br>還原會<b>取代</b>這台裝置上目前的 ${fmt(state.sales.length)} 筆資料。`;
      $("importConfirm").hidden = false;
      $("backupMsg").textContent = "";
    } catch { flash("backupMsg", "err", "這不是業務獎金的備份檔，或檔案已損壞。"); }
  });
  $("importCancel").addEventListener("click", () => { pendingImport = null; $("importConfirm").hidden = true; });
  $("importGo").addEventListener("click", () => {
    if (!pendingImport) return;
    state.settings = normalizeSettings(pendingImport.settings);
    state.sales = pendingImport.sales;
    state.lastBackup = Date.now();   // 剛從備份檔還原，等於已有備份
    pendingImport = null; $("importConfirm").hidden = true;
    draft = null; resetForm();
    if (commit()) flash("backupMsg", "ok", "已還原。");
  });

  /* 活動規則檔：只換規則（檔期、門檻、指定品項、冷氣與目標條件），
     業務名單、每人條件、銷售紀錄都保留。品項依 id 對應，原本的期初台數會留著。 */
  $("importRules").addEventListener("change", async (e) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    let r;
    try {
      r = JSON.parse(await f.text());
      if (r.app !== "lg-bonus-rules" || !Array.isArray(r.tiers) || !Array.isArray(r.cats)) throw new Error();
    } catch { return flash("backupMsg", "err", "這不是活動規則檔，或檔案已損壞。"); }
    const old = S();
    const oldCats = Object.fromEntries((old.cats || []).map((c) => [c.id, c]));
    state.settings = normalizeSettings({
      ...old,
      name: r.name ?? old.name, start: r.start ?? old.start, end: r.end ?? old.end,
      mode: r.mode || "full", tiers: r.tiers,
      cats: r.cats.map((c) => ({ ...c, opening: oldCats[c.id]?.opening || 0 })),
      acTiers: r.acTiers || [],
      conditions: r.conditions || [],
    });
    // 已經登錄的銷售依新的型號清單重新歸類；清單裡找不到的保持原本的手動分類
    for (const s of state.sales) { if (s.kind === "opening") continue; const hit = catForModel(s.model); if (hit) s.cat = hit.id; }
    draft = null; dirty = false;
    if (commit()) flash("backupMsg", "ok", `已套用「${r.name || f.name}」的規則。請到「規則設定」填每位業務的冷氣台數與目標達成狀況。`);
  });

  $("exportCsv").addEventListener("click", () => {
    const catName = Object.fromEntries((S().cats || []).map((c) => [c.id, c.name]));
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["日期", "業務", "型號", "指定品項", "數量", "金額", "筆數"].join(",")];
    for (const s of [...state.sales].sort((a, b) => (a.date || "").localeCompare(b.date || "")))
      lines.push([s.date, s.staff, s.model, catName[s.cat] || "", s.qty, s.amount, s.count ?? 1].map(q).join(","));
    // BOM 讓 Excel 用 UTF-8 開啟，中文才不會變亂碼
    download(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" }), `業務獎金明細-${fileStamp()}.csv`);
    flash("backupMsg", "ok", "已匯出銷售明細。");
  });

  $("clearSales").addEventListener("click", () => { $("clearConfirm").hidden = false; renderBackup(); });
  $("clearCancel").addEventListener("click", () => { $("clearConfirm").hidden = true; });
  $("clearGo").addEventListener("click", () => {
    exportBackup();
    state.sales = [];
    for (const c of S().cats) c.opening = 0;
    $("clearConfirm").hidden = true;
    resetForm(); draft = null;
    if (commit()) flash("backupMsg", "ok", "已下載備份並清除銷售紀錄。");
  });

  /* ---------- 頁籤 ---------- */
  const VIEWS = ["overview", "entry", "report", "settings", "backup"];
  function showView(v) {
    if (!VIEWS.includes(v)) v = "overview";
    for (const b of document.querySelectorAll("nav.tabs button")) b.setAttribute("aria-selected", String(b.dataset.view === v));
    for (const id of VIEWS) $("view-" + id).hidden = id !== v;
    if (v === "settings" && !dirty) loadDraft();
    if (v === "report") renderReport();
    if (v === "backup") renderBackup();
    try { localStorage.setItem(TAB_KEY, v); } catch {}
  }
  document.querySelector("nav.tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (b) showView(b.dataset.view); });
  $("backupNag").addEventListener("click", (e) => { const b = e.target.closest("[data-goto]"); if (b) showView(b.dataset.goto); });

  // 另一個分頁改了資料時同步過來，避免兩個分頁互相覆蓋
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY || !e.newValue) return;
    try { const raw = JSON.parse(e.newValue); state = { settings: normalizeSettings(raw.settings), sales: raw.sales || [], lastBackup: raw.lastBackup || null }; } catch { return; }
    if (!dirty) draft = null;
    renderAll();
  });

  function renderAll() {
    renderHeader(); renderOverview(); renderEntry();
    if (!$("view-report").hidden) renderReport();
    if (!$("view-backup").hidden) renderBackup();
    if (!$("view-settings").hidden && !dirty) loadDraft();
  }

  $("fDate").value = localDate();
  renderAll();
  let startTab = "overview";
  try { startTab = localStorage.getItem(TAB_KEY) || "overview"; } catch {}
  showView(startTab);

  if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch((e) => console.warn("[SW] 註冊失敗：", e)));
  }
})();
