(function () {
  "use strict";

  var VERSION = "2026-10-28";
  var STORAGE_KEY = "dk-store-manager-picks.draft.v1";
  // 字數上限，要和 Code.gs 的 LIMITS 一致。
  var LIMITS = { managerName: 20, quote: 40, productName: 40, reason: 40, staffName: 20, idea: 200 };
  var LABELS = { managerName: "店長稱呼", quote: "店長的一句話", productName: "推薦商品名稱", reason: "推薦理由", staffName: "你的稱呼", idea: "你的點子" };
  var REQUIRED = { quote: true, productName: true, reason: true, idea: true };
  var FIELDS = {
    manager: ["storeId", "managerName", "quote", "productName", "productUrl", "reason"],
    staff: ["staffName", "relatedStoreId", "idea"]
  };
  // 規則要和 Code.gs 的 SALE_PAGE_PATTERN 一致。
  var SALE_PAGE_PATTERN = /dk-shoes\.com\.tw\/(?:[^\s?#]*?\/)?SalePage\/Index\/(\d{1,12})/i;

  var endpoint = typeof window.DK_PICKS_ENDPOINT === "string" ? window.DK_PICKS_ENDPOINT.trim() : "";
  var stores = Array.isArray(window.DK_STORES) ? window.DK_STORES : [];
  var storeById = {};
  stores.forEach(function (store) { storeById[store.id] = store; });

  var form = document.getElementById("picks-form");
  var submitButton = document.getElementById("submit-button");
  var statusBox = document.getElementById("status");
  var draftNote = document.getElementById("draft-note");
  var existingNote = document.getElementById("existing-note");
  var urlStatus = document.getElementById("url-status");
  var state = { ready: false, busy: false, submissionId: "", signature: "", latest: null };
  var draftTimer = 0;

  /* ---------- 小工具 ---------- */

  function field(name) { return form.elements.namedItem(name); }
  function value(name) { var el = field(name); return el && typeof el.value === "string" ? el.value : ""; }
  function role() { var checked = form.querySelector('input[name="role"]:checked'); return checked ? checked.value : ""; }
  function shortName(store) { return store.name.replace(/^DK-/, ""); }

  // 規則要和 Code.gs 的 cleanText_ 一致：換行變空白、連續空白縮成一個、去頭尾空白。
  function normalizeText(text) {
    return String(text || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s{2,}/g, " ").trim();
  }

  function parseSalePage(text) {
    var match = SALE_PAGE_PATTERN.exec(text || "");
    return match ? { id: match[1], url: "https://www.dk-shoes.com.tw/SalePage/Index/" + match[1] } : null;
  }

  // "2026-10-28T09:05:33+08:00" → "10/28 09:05"（直接取台灣時間字串，不經時區換算）
  function formatTime(iso) {
    var m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(iso || "");
    return m ? Number(m[1]) + "/" + Number(m[2]) + " " + m[3] : "";
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.prototype.map.call(bytes, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }

  function fillStoreSelect(select) {
    var groups = {};
    stores.forEach(function (store) {
      if (!groups[store.city]) {
        groups[store.city] = document.createElement("optgroup");
        groups[store.city].label = store.city;
        select.appendChild(groups[store.city]);
      }
      var option = document.createElement("option");
      option.value = store.id;
      option.textContent = shortName(store);
      groups[store.city].appendChild(option);
    });
  }

  /* ---------- 畫面更新 ---------- */

  function applyRole() {
    var current = role();
    ["manager", "staff"].forEach(function (name) {
      var panel = document.getElementById(name + "-fields");
      panel.hidden = current !== name;
      panel.disabled = current !== name;
    });
    document.getElementById("submit-card").hidden = !current;
    document.getElementById("submit-note").textContent = current === "staff"
      ? "點子只有內部看得到。想到別的，可以再送一則。"
      : "稱呼、一句話與推薦會公開顯示在官網。同一間店可以重送，以最後一次為準。";
    updateSubmit();
    updateAll();
  }

  function updateCounters() {
    Array.prototype.forEach.call(form.querySelectorAll("[data-count-for]"), function (counter) {
      var name = counter.getAttribute("data-count-for");
      var left = LIMITS[name] - normalizeText(value(name)).length;
      counter.textContent = left >= 0 ? "還可以寫 " + left + " 字" : "超過 " + (-left) + " 字，請再精簡一點";
      counter.classList.toggle("is-over", left < 0);
    });
  }

  function updateUrlStatus() {
    var raw = normalizeText(value("productUrl"));
    var sale = parseSalePage(raw);
    urlStatus.replaceChildren();
    if (!raw) {
      urlStatus.textContent = "從官網商品頁複製網址貼上即可；沒有可以留空。";
      urlStatus.dataset.kind = "hint";
    } else if (!sale) {
      urlStatus.textContent = "看不出是官網商品頁網址：網址裡應該要有 SalePage/Index/數字。";
      urlStatus.dataset.kind = "error";
    } else {
      var link = document.createElement("a");
      link.href = sale.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "打開確認";
      urlStatus.append("✓ 已辨識官網商品頁 #" + sale.id + "　", link);
      urlStatus.dataset.kind = "ok";
    }
  }

  function setPreview(id, text, placeholder) {
    var el = document.getElementById(id);
    el.textContent = text || placeholder;
    el.classList.toggle("is-placeholder", !text);
  }

  function updatePreview() {
    var store = storeById[value("storeId")];
    var name = normalizeText(value("managerName"));
    setPreview("preview-store", store ? shortName(store) : "", "你的門市");
    setPreview("preview-quote", normalizeText(value("quote")), "這裡會出現你的一句話");
    setPreview("preview-manager", name ? "— " + name : "", "— 店長");
    setPreview("preview-product", normalizeText(value("productName")), "推薦商品");
    setPreview("preview-reason", normalizeText(value("reason")), "推薦理由");
  }

  function updateExisting() {
    var record = state.latest && state.latest[value("storeId")];
    var store = storeById[value("storeId")];
    if (role() !== "manager" || !store || !record || !record.filled) {
      existingNote.hidden = true;
      return;
    }
    document.getElementById("existing-text").textContent = shortName(store) + "已經在 " + formatTime(record.submittedAt) + " 填過"
      + (record.managerName ? "（" + record.managerName + "）" : "") + "，再送一次會以新的為準。";
    existingNote.hidden = false;
  }

  function updateAll() {
    updateCounters();
    updateUrlStatus();
    updatePreview();
    updateExisting();
  }

  function updateSubmit() {
    submitButton.disabled = !state.ready || state.busy || !role();
    submitButton.textContent = state.busy ? "正在送出，請稍候…" : role() === "staff" ? "送出點子" : "送出";
    form.setAttribute("aria-busy", String(state.busy));
  }

  function setStatus(message, kind) {
    statusBox.textContent = message;
    statusBox.dataset.kind = kind || "info";
    statusBox.focus({ preventScroll: true });
    window.requestAnimationFrame(function () {
      var rect = statusBox.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) statusBox.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  /* ---------- 檢查與送出 ---------- */

  function checkFields() {
    var current = role();
    var firstRole = form.querySelector('input[name="role"]');
    firstRole.setCustomValidity(current ? "" : "請先選擇你的身分。");
    if (!current) return form.reportValidity();
    FIELDS[current].forEach(function (name) {
      var el = field(name);
      var message = "";
      if (name === "storeId") {
        if (!storeById[el.value]) message = "請選擇你的門市。";
      } else if (name === "relatedStoreId") {
        if (el.value && !storeById[el.value]) message = "請重新選擇門市。";
      } else if (name === "productUrl") {
        if (normalizeText(el.value) && !parseSalePage(el.value)) message = "請貼 DK 官網的商品頁網址（網址裡會有 SalePage/Index/數字），沒有可以留空。";
      } else {
        var text = normalizeText(el.value);
        if (REQUIRED[name] && !text) message = "請填寫「" + LABELS[name] + "」。";
        else if (text.length > LIMITS[name]) message = "「" + LABELS[name] + "」最多 " + LIMITS[name] + " 字，目前 " + text.length + " 字。";
      }
      el.setCustomValidity(message);
    });
    return form.reportValidity();
  }

  function collect() {
    if (role() === "staff") {
      return {
        role: "staff",
        staffName: normalizeText(value("staffName")),
        storeId: value("relatedStoreId"),
        idea: normalizeText(value("idea")),
        version: VERSION
      };
    }
    var sale = parseSalePage(value("productUrl"));
    return {
      role: "manager",
      storeId: value("storeId"),
      managerName: normalizeText(value("managerName")),
      quote: normalizeText(value("quote")),
      productName: normalizeText(value("productName")),
      productUrl: sale ? sale.url : "",
      reason: normalizeText(value("reason")),
      version: VERSION
    };
  }

  async function submit(event) {
    event.preventDefault();
    if (state.busy) return;
    saveDraft();
    if (!checkFields()) return;
    var data = collect();
    var signature = JSON.stringify(data);
    // 內容沒改就沿用同一個提交編號：網路不穩重按時，Sheet 不會多出重複的列。
    if (!state.submissionId || state.signature !== signature) {
      state.submissionId = uuid();
      state.signature = signature;
    }
    saveDraft();
    if (!endpoint) {
      setStatus("預覽模式：格式檢查都通過了！目前還沒設定收件網址，所以這次沒有真的送出。", "info");
      return;
    }

    state.busy = true;
    updateSubmit();
    statusBox.textContent = "";
    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, 20000);
    try {
      var response = await window.fetch(endpoint, {
        method: "POST",
        // 用 text/plain 送 JSON，瀏覽器就不會先發 CORS 預檢請求（Apps Script 不支援預檢）。
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(Object.assign({ submissionId: state.submissionId, website: value("website") }, data)),
        credentials: "omit",
        redirect: "follow",
        signal: controller.signal
      });
      var result = await response.json();
      if (!response.ok || !result || result.ok !== true) {
        throw new Error(result && typeof result.message === "string" ? result.message.slice(0, 200) : "資料尚未成功送出。");
      }
      if (data.role === "manager") {
        var store = storeById[data.storeId];
        if (state.latest && result.submittedAt) {
          state.latest[data.storeId] = {
            id: data.storeId, filled: true, submittedAt: result.submittedAt, managerName: data.managerName, quote: data.quote,
            product: { name: data.productName, url: data.productUrl, reason: data.reason }
          };
        }
        setStatus("送出成功！" + shortName(store) + "的資料" + (result.submittedAt ? "已在 " + formatTime(result.submittedAt) + " " : "已經") + "收到，謝謝店長。之後想修改，直接改完再按一次「送出」，以最新一次為準。", "success");
      } else {
        field("idea").value = "";
        state.submissionId = "";
        state.signature = "";
        setStatus("收到你的點子了，謝謝！還有別的想法，可以直接再寫一則送出。", "success");
      }
      saveDraft();
      updateAll();
    } catch (error) {
      var message;
      if (error && error.name === "AbortError") message = "連線等了 20 秒還沒回應，不確定有沒有送到。內容都還在，請再按一次；同一份資料不會重複新增。";
      else if (error instanceof TypeError) message = "目前連不上網路，內容都還在，請確認網路後再按一次送出。";
      else if (error instanceof SyntaxError) message = "伺服器沒有回傳確認，內容都還在，請稍後再按一次送出。";
      else message = (error && error.message ? error.message : "資料尚未成功送出。") + " 內容都還在，修正後可以再送一次。";
      setStatus(message, "error");
    } finally {
      window.clearTimeout(timeout);
      state.busy = false;
      updateSubmit();
    }
  }

  /* ---------- 草稿（存在這支手機的瀏覽器） ---------- */

  function allFields() { return FIELDS.manager.concat(FIELDS.staff); }

  function saveDraft() {
    window.clearTimeout(draftTimer);
    try {
      var values = {};
      allFields().forEach(function (name) { values[name] = value(name); });
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: VERSION, role: role(), values: values, submissionId: state.submissionId, signature: state.signature
      }));
      draftNote.textContent = "填到一半的內容會自動存在這支手機，關掉再打開也還在。";
    } catch (error) {
      draftNote.textContent = "這個瀏覽器無法暫存草稿，送出前請不要關閉頁面。";
    }
  }

  function setRole(name) {
    var radio = form.querySelector('input[name="role"][value="' + name + '"]');
    if (radio) radio.checked = true;
  }

  function setSelect(name, id) {
    if (id === "" || storeById[id]) field(name).value = id;
  }

  function restoreDraft() {
    try {
      var draft = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
      if (!draft || draft.version !== VERSION || !draft.values) return;
      setRole(draft.role);
      allFields().forEach(function (name) {
        var saved = draft.values[name];
        if (typeof saved !== "string") return;
        if (name === "storeId" || name === "relatedStoreId") setSelect(name, saved);
        else field(name).value = saved.slice(0, 1000);
      });
      if (typeof draft.submissionId === "string" && /^[a-f0-9-]{36}$/i.test(draft.submissionId)) {
        state.submissionId = draft.submissionId;
        state.signature = typeof draft.signature === "string" ? draft.signature : "";
      }
      draftNote.textContent = "已帶回你上次在這支手機填到一半的內容。";
    } catch (error) {
      draftNote.textContent = "草稿讀取失敗，請直接重新填寫。";
    }
  }

  // 連結可以帶參數：index.html?store=頂好（直接選好門市）、index.html?role=staff（同事留點子）
  function applyQuery() {
    var params = new URLSearchParams(window.location.search);
    var storeId = params.get("store");
    if (storeId && storeById[storeId]) {
      setRole("manager");
      setSelect("storeId", storeId);
    } else if (params.get("role") === "staff" || params.get("role") === "manager") {
      setRole(params.get("role"));
    }
  }

  /* ---------- 讀取各店目前資料（顯示「已經填過」提示用） ---------- */

  function loadLatest() {
    if (!endpoint) return;
    window.fetch(endpoint, { credentials: "omit" })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (!data || data.ok !== true || !data.stores || typeof data.stores !== "object") return;
        state.latest = data.stores;
        updateExisting();
      })
      .catch(function () { /* 讀不到不影響填寫 */ });
  }

  function loadExisting() {
    var record = state.latest && state.latest[value("storeId")];
    if (!record || !record.filled) return;
    field("managerName").value = record.managerName || "";
    field("quote").value = record.quote || "";
    field("productName").value = record.product ? record.product.name || "" : "";
    field("productUrl").value = record.product ? record.product.url || "" : "";
    field("reason").value = record.product ? record.product.reason || "" : "";
    updateAll();
    saveDraft();
    field("quote").focus();
  }

  /* ---------- 啟動 ---------- */

  fillStoreSelect(field("storeId"));
  fillStoreSelect(field("relatedStoreId"));
  if (!endpoint) {
    var modeNote = document.getElementById("mode-note");
    modeNote.textContent = "預覽模式：還沒設定收件網址（config.js），可以試填和檢查格式，但不會真的送出。";
    modeNote.hidden = false;
  }
  if (!stores.length) setStatus("門市清單讀取失敗，請重新整理頁面。", "error");
  restoreDraft();
  applyQuery();
  applyRole();
  loadLatest();

  form.addEventListener("submit", submit);
  form.addEventListener("change", function (event) {
    if (event.target.name === "role") {
      event.target.setCustomValidity("");
      applyRole();
    }
    if (event.target.tagName === "SELECT") {
      event.target.setCustomValidity("");
      updateAll();
    }
    saveDraft();
  });
  form.addEventListener("input", function (event) {
    if (event.target.setCustomValidity) event.target.setCustomValidity("");
    updateAll();
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(saveDraft, 300);
  });
  // 一句話只要一行：擋掉 Enter 換行（選字中的 Enter 不擋）。
  field("quote").addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229) event.preventDefault();
  });
  document.getElementById("load-existing").addEventListener("click", loadExisting);
  window.addEventListener("pagehide", saveDraft);

  state.ready = !!stores.length;
  updateSubmit();
}());
