(function () {
  "use strict";

  var endpoint = typeof window.DK_PICKS_ENDPOINT === "string" ? window.DK_PICKS_ENDPOINT.trim() : "";
  var stores = Array.isArray(window.DK_STORES) ? window.DK_STORES : [];
  var SALE_PAGE_URL = /^https:\/\/www\.dk-shoes\.com\.tw\/SalePage\/Index\/\d{1,12}$/;
  var state = { records: {}, filter: "all", loading: false, generatedAt: "", suggestionCount: null };

  var board = document.getElementById("board");
  var pageNote = document.getElementById("page-note");
  var refreshButton = document.getElementById("refresh");
  var copyButton = document.getElementById("copy-missing");

  function shortName(store) { return store.name.replace(/^DK-/, ""); }
  function isFilled(store) { var record = state.records[store.id]; return !!(record && record.filled); }

  // "2026-10-28T09:05:33+08:00" → "10/28 09:05"（直接取台灣時間字串，不經時區換算）
  function formatTime(iso) {
    var m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(iso || "");
    return m ? Number(m[1]) + "/" + Number(m[2]) + " " + m[3] : "";
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showNote(message, kind) {
    pageNote.textContent = message;
    pageNote.className = "notice notice-" + kind;
    pageNote.hidden = !message;
  }

  function groupByCity(list) {
    var groups = [];
    var byCity = {};
    list.forEach(function (store) {
      if (!byCity[store.city]) {
        byCity[store.city] = { city: store.city, stores: [] };
        groups.push(byCity[store.city]);
      }
      byCity[store.city].stores.push(store);
    });
    return groups;
  }

  /* ---------- 畫面 ---------- */

  function storeCard(store) {
    var record = state.records[store.id];
    var filled = isFilled(store);
    var card = el("article", "store-card " + (filled ? "is-filled" : "is-missing"));
    var head = el("div", "store-card-head");
    head.append(el("h3", "", shortName(store)), el("span", "badge", filled ? "已填" : "未填"));
    card.appendChild(head);

    if (!filled) {
      var link = el("a", "card-link", "開啟這間店的填寫頁 →");
      link.href = "index.html?store=" + encodeURIComponent(store.id);
      card.appendChild(link);
      return card;
    }

    card.appendChild(el("p", "card-quote", "「" + record.quote + "」"));
    var meta = [record.managerName, formatTime(record.submittedAt)].filter(Boolean);
    if (record.submissionCount > 1) meta.push("共送出 " + record.submissionCount + " 次");
    card.appendChild(el("p", "card-meta", "— " + meta.join("・")));

    var product = record.product || {};
    var pick = el("p", "card-pick");
    pick.appendChild(el("b", "", "推薦 "));
    if (product.url && SALE_PAGE_URL.test(product.url)) {
      var productLink = el("a", "", product.name);
      productLink.href = product.url;
      productLink.target = "_blank";
      productLink.rel = "noopener";
      pick.appendChild(productLink);
    } else {
      pick.append(product.name || "");
    }
    if (product.reason) pick.append("｜" + product.reason);
    card.appendChild(pick);
    return card;
  }

  function render() {
    var filledCount = stores.filter(isFilled).length;
    var total = stores.length;
    var percent = total ? Math.round(filledCount / total * 100) : 0;
    document.getElementById("summary-count").textContent = String(filledCount);
    document.getElementById("summary-total").textContent = "/ " + total + " 間已填";
    document.getElementById("summary-percent").textContent = percent + "%";
    document.getElementById("bar-fill").style.width = percent + "%";
    document.getElementById("bar").setAttribute("aria-valuenow", String(percent));

    var meta = [];
    if (state.generatedAt) meta.push("資料時間 " + formatTime(state.generatedAt));
    if (state.suggestionCount !== null) meta.push("同事點子 " + state.suggestionCount + " 則（內容在試算表「同仁建議」分頁）");
    if (!endpoint) meta.push("預覽模式");
    document.getElementById("summary-meta").textContent = state.loading ? "讀取中…" : meta.join("　");

    var counts = { all: total, missing: total - filledCount, filled: filledCount };
    var names = { all: "全部", missing: "未填", filled: "已填" };
    Array.prototype.forEach.call(document.querySelectorAll(".filter"), function (button) {
      var key = button.getAttribute("data-filter");
      button.textContent = names[key] + " " + counts[key];
      button.setAttribute("aria-pressed", String(key === state.filter));
    });

    var visible = stores.filter(function (store) {
      if (state.filter === "missing") return !isFilled(store);
      if (state.filter === "filled") return isFilled(store);
      return true;
    });
    board.replaceChildren();
    groupByCity(visible).forEach(function (group) {
      var all = stores.filter(function (store) { return store.city === group.city; });
      var section = el("section", "city");
      var title = el("h2", "city-title", group.city);
      title.appendChild(el("span", "city-count", "已填 " + all.filter(isFilled).length + " / " + all.length));
      var grid = el("div", "store-grid");
      group.stores.forEach(function (store) { grid.appendChild(storeCard(store)); });
      section.append(title, grid);
      board.appendChild(section);
    });
    if (!visible.length) {
      board.appendChild(el("p", "empty", state.filter === "missing" ? "全部門市都填好了，辛苦了！" : "目前還沒有門市填寫。"));
    }
    copyButton.disabled = !counts.missing;
  }

  /* ---------- 讀取 ---------- */

  async function load() {
    if (!endpoint) {
      showNote("預覽模式：還沒設定收件網址（config.js），先全部顯示為未填。", "warn");
      render();
      return;
    }
    state.loading = true;
    refreshButton.disabled = true;
    render();
    try {
      var response = await window.fetch(endpoint, { credentials: "omit", cache: "no-store" });
      var data = await response.json();
      if (!data || data.ok !== true || !data.stores || typeof data.stores !== "object") {
        throw new Error(data && data.message ? data.message : "資料格式不正確");
      }
      state.records = data.stores;
      state.generatedAt = typeof data.generatedAt === "string" ? data.generatedAt : "";
      state.suggestionCount = typeof data.suggestionCount === "number" ? data.suggestionCount : null;
      showNote("", "info");
    } catch (error) {
      showNote("讀取失敗：" + (error && error.message ? error.message : "請確認網路") + "。可以按「重新整理」再試一次。", "error");
    } finally {
      state.loading = false;
      refreshButton.disabled = false;
      render();
    }
  }

  /* ---------- 複製未填名單（貼到 LINE 群組催填用） ---------- */

  function missingText() {
    var missing = stores.filter(function (store) { return !isFilled(store); });
    var lines = ["【店長的一句話】還沒填的門市（" + missing.length + " 間）"];
    groupByCity(missing).forEach(function (group) {
      lines.push(group.city + "：" + group.stores.map(shortName).join("、"));
    });
    lines.push("", "填寫連結：" + new URL("index.html", window.location.href).href);
    return lines.join("\n");
  }

  async function copyMissing() {
    var text = missingText();
    var original = copyButton.textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      var area = el("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    copyButton.textContent = "已複製！可以貼到 LINE";
    window.setTimeout(function () { copyButton.textContent = original; }, 2500);
  }

  document.querySelector(".filters").addEventListener("click", function (event) {
    var key = event.target.getAttribute && event.target.getAttribute("data-filter");
    if (!key) return;
    state.filter = key;
    render();
  });
  refreshButton.addEventListener("click", load);
  copyButton.addEventListener("click", copyMissing);
  load();
}());
