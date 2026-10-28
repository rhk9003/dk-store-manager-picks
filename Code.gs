/**
 * DK 店長的一句話＋店長推薦｜收件程式（Google Apps Script，綁在 Google Sheet 上）
 *
 *   doPost      填寫頁送出時呼叫。
 *               店長 → 在「填寫紀錄」新增一列（同店重送也新增一列，舊的保留，以最新一筆為準）。
 *               其他同事 → 在「同仁建議」新增一列（「可以放什麼」的點子，只給內部看）。
 *               DK 台灣島的客人留言（role: "message"）→ 在「門市留言」新增一列，先審再上牆。
 *   doGet       回傳每間門市「最新一筆有效資料」的 JSON，以門市 id 為鍵。
 *               填寫進度頁、之後的「DK 台灣島」網站都讀這裡。同仁建議的內容不會出現在這裡。
 *   setupSheet  第一次使用時，在編輯器上方選它再按「執行」一次：建立分頁、欄位標題與公式。
 *               之後重跑也安全，不會刪掉任何紀錄。
 *
 * 分頁
 *   每店最新    61 間門市各一列，公式自動帶出每店最新一筆，不用手動維護（請勿手改）。
 *   填寫紀錄    店長的所有送出紀錄。最後一欄「不採用」打勾 = 這筆不算數（遇到亂填時用，不用刪列）。
 *   同仁建議    其他同事的點子留言。最後一欄「已看過」給你自己打勾追蹤。
 *   門市留言    台灣島上客人的留言。最後一欄「上牆」打勾 = 審核通過，出現在該門市的留言牆。
 *
 * doPost 留言格式（台灣島送來，text/plain 的 JSON）：
 *   { role: "message", submissionId, storeId, nickname, text, deviceId, website, version }
 *   成功回 {ok:true, pending:true}；失敗回 {ok:false, message:"給客人看的說明"}。
 *
 * doGet 回傳格式（欄位名稱固定；之後只會增加欄位，不會改名或刪除）：
 *   {
 *     ok: true,
 *     schema: "dk-store-manager-picks/v1",
 *     generatedAt: "2026-10-28T10:00:00+08:00",
 *     total: 61,              // 門市總數
 *     filledCount: 12,        // 已有有效資料的門市數
 *     suggestionCount: 5,     // 同仁建議則數（只有數量，不含內容）
 *     stores: {
 *       "頂好": {
 *         id: "頂好", name: "DK-頂好店", city: "台北市",
 *         filled: true,                                   // 未填的店為 false，以下欄位為空字串／null／0
 *         submittedAt: "2026-10-28T09:12:33+08:00",
 *         managerName: "阿凱店長",                          // 選填，可能是空字串
 *         quote: "走一整天也不累，就是要穿空氣鞋！",
 *         product: {
 *           name: "…",
 *           url: "https://www.dk-shoes.com.tw/SalePage/Index/10737417",  // 選填，可能是空字串
 *           salePageId: "10737417",                                     // 同上
 *           reason: "…"
 *         },
 *         submissionCount: 2,                             // 這間店的有效送出次數
 *         messages: [                                     // 已上牆的留言，新到舊最多 12 則；沒有為 []
 *           { nickname: "小明", text: "…", at: "2026-10-28T10:00:00+08:00" }
 *         ]
 *       },
 *       …
 *     }
 *   }
 *
 * 門市清單（STORES）由 tools/build_stores.py 從 DK門市清單.json 產生，請勿手改。
 */

var SCHEMA = 'dk-store-manager-picks/v1';
var TIME_ZONE = 'Asia/Taipei';
var BRAND_COLOR = '#8B2332';
var LATEST_TAB = '每店最新';
var RECORD_TAB = '填寫紀錄';
var SUGGESTION_TAB = '同仁建議';
var MESSAGE_TAB = '門市留言';

// 從試算表「擴充功能 → Apps Script」建立的專案會自動找到那份試算表，這裡留空即可。
// 如果是另外建立的獨立 Apps Script 專案，請填試算表網址中 /d/ 和 /edit 之間的那串 ID。
var SPREADSHEET_ID = '';

// 網站讀取的 JSON 會快取 5 分鐘，減少每次都讀試算表；有人送出或手動改試算表時會立刻清掉。
// 單一快取值有 100KB 上限，留言多了會超過，所以切成多段存。
var CACHE_KEY = 'latest:' + SCHEMA;
var CACHE_SECONDS = 300;
var CACHE_CHUNK_CHARS = 30000;
var CACHE_MAX_CHUNKS = 20;

// 欄位順序 = 分頁的欄位順序。改欄位時要同步改 setupSheet 裡「每店最新」的公式。
var RECORD_HEADERS = ['提交編號','送出時間','門市ID','門市名稱','縣市','店長稱呼','店長的一句話','推薦商品','商品網址','推薦理由','版本','不採用'];
var RECORD = {submissionId:0, submittedAt:1, storeId:2, storeName:3, city:4, managerName:5, quote:6, productName:7, productUrl:8, reason:9, version:10, excluded:11};
var SUGGESTION_HEADERS = ['提交編號','送出時間','稱呼','相關門市ID','相關門市名稱','點子','版本','已看過'];
var SUGGESTION = {submissionId:0, submittedAt:1, name:2, storeId:3, storeName:4, idea:5, version:6, done:7};
var MESSAGE_HEADERS = ['提交編號','送出時間','門市ID','門市名稱','暱稱','留言','版本','上牆'];
var MESSAGE = {submissionId:0, submittedAt:1, storeId:2, storeName:3, nickname:4, text:5, version:6, approved:7};

// 字數上限，要和 form.js 的 LIMITS 一致（nickname、message 是台灣島的留言）。
var LIMITS = {managerName:20, quote:40, productName:40, reason:40, staffName:20, idea:200, nickname:12, message:60};
var MESSAGE_MIN_CHARS = 2;
var MESSAGE_WALL_SIZE = 12;          // 每間店最多回傳幾則上牆留言
var MESSAGE_COOLDOWN_SECONDS = 30;   // 同一台裝置多久能再留一則
var DEFAULT_NICKNAME = '路過的客人';
// 留言裡出現網址就擋掉（比對前先把全形字轉半形，避免「ｗｗｗ．」繞過）。
var LINK_PATTERN = /(https?:\/\/|www\.|\.(com|tw|net|org|io|me|cc|co|ly|gl|info|biz|xyz|app|shop|link|top|site|online)\b)/i;

// 從貼上的文字找出 DK 官網商品頁編號。規則要和 form.js 的 SALE_PAGE_PATTERN 一致。
var SALE_PAGE_PATTERN = /dk-shoes\.com\.tw\/(?:[^\s?#]*?\/)?SalePage\/Index\/(\d{1,12})/i;

// BEGIN STORES（由 tools/build_stores.py 產生：[門市ID, 門市名稱, 縣市]）
var STORES = [
  ['頂好', 'DK-頂好店', '台北市'],
  ['民生', 'DK-民生店', '台北市'],
  ['忠孝', 'DK-忠孝店', '台北市'],
  ['市民', 'DK-市民店', '台北市'],
  ['雙連', 'DK-雙連店', '台北市'],
  ['沅陵', 'DK-沅陵店', '台北市'],
  ['博愛', 'DK-博愛店', '台北市'],
  ['萬芳', 'DK-萬芳店', '台北市'],
  ['永和', 'DK-永和店', '新北市'],
  ['內湖', 'DK-內湖店', '台北市'],
  ['萬華', 'DK-萬華店', '台北市'],
  ['三重', 'DK-三重店', '新北市'],
  ['成功', 'DK-成功店', '台北市'],
  ['南勢角', 'DK-南勢角店', '新北市'],
  ['北新', 'DK-北新店', '新北市'],
  ['新光醫', 'DK-新光醫', '台北市'],
  ['新店', 'DK-新店店', '新北市'],
  ['埔墘', 'DK-埔墘店', '新北市'],
  ['石牌', 'DK-石牌店', '台北市'],
  ['府中', 'DK-府中店', '新北市'],
  ['蘆洲', 'DK-蘆洲店', '新北市'],
  ['新泰', 'DK-新泰店', '新北市'],
  ['裕民', 'DK-裕民店', '新北市'],
  ['樹林', 'DK-樹林店', '新北市'],
  ['淡水', 'DK-淡水店', '新北市'],
  ['林口', 'DK-林口店', '桃園市'],
  ['三峽', 'DK-三峽店', '新北市'],
  ['基隆', 'DK-基隆店', '基隆市'],
  ['桃園', 'DK-桃園店', '桃園市'],
  ['藝文', 'DK-藝文店', '桃園市'],
  ['八德', 'DK-八德店', '桃園市'],
  ['元化', 'DK-元化店', '桃園市'],
  ['新生', 'DK-新生店', '桃園市'],
  ['羅東', 'DK-羅東店', '宜蘭縣'],
  ['竹北', 'DK-竹北店', '新竹縣'],
  ['新竹', 'DK-新竹店', '新竹市'],
  ['苗栗', 'DK-苗栗店', '苗栗縣'],
  ['豐原', 'DK-豐原店', '台中市'],
  ['大甲', 'DK-大甲店', '台中市'],
  ['精武', 'DK-精武店', '台中市'],
  ['精明', 'DK-精明店', '台中市'],
  ['美村', 'DK-美村店', '台中市'],
  ['大里', 'DK-大里店', '台中市'],
  ['沙鹿', 'DK-沙鹿店', '台中市'],
  ['草屯', 'DK-草屯店', '南投縣'],
  ['彰化', 'DK-彰化店', '彰化縣'],
  ['員林', 'DK-員林店', '彰化縣'],
  ['鹿港', 'DK-鹿港店', '彰化縣'],
  ['斗六', 'DK-斗六店', '雲林縣'],
  ['虎尾', 'DK-虎尾店', '雲林縣'],
  ['嘉義', 'DK-嘉義店', '嘉義市'],
  ['垂楊', 'DK-垂楊店', '嘉義市'],
  ['新營', 'DK-新營店', '台南市'],
  ['麻豆', 'DK-麻豆店', '台南市'],
  ['台南', 'DK-台南店', '台南市'],
  ['屏東', 'DK-屏東店', '屏東縣'],
  ['裕誠', 'DK-裕誠店', '高雄市'],
  ['大樂', 'DK-大樂店', '高雄市'],
  ['鳳山', 'DK-鳳山店', '高雄市'],
  ['大連', 'DK-大連店', '高雄市'],
  ['三多', 'DK-三多店', '高雄市']
];
// END STORES


/* ---------- 網頁進入點 ---------- */

function doGet() {
  try {
    var json = readCache_();
    if (!json) {
      json = JSON.stringify(buildLatest_());
      writeCache_(json);
    }
    return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    console.error(error);
    return jsonResponse_({ok:false, message:'暫時讀不到資料，請稍後再試。'});
  }
}

function doPost(event) {
  var lock;
  try {
    var raw = event && event.postData && event.postData.contents;
    if (!raw || raw.length > 10000) publicError_('送出的內容不完整或過長。');
    var data;
    try { data = JSON.parse(raw); } catch (_) { publicError_('資料格式不正確，請重新整理後再試。'); }
    // 隱藏欄位被填 = 機器人，假裝成功但不寫入。
    if (data && typeof data.website === 'string' && data.website) {
      return jsonResponse_(data.role === 'message' ? {ok:true, pending:true} : {ok:true});
    }
    var valid = validatePayload_(data);
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) publicError_('目前送出的人比較多，請稍後再按一次。');
    var result = valid.role === 'message' ? appendMessage_(valid)
      : valid.role === 'staff' ? appendSuggestion_(valid) : appendRecord_(valid);
    return jsonResponse_(result);
  } catch (error) {
    if (!error.publicMessage) console.error(error);
    return jsonResponse_({ok:false, message:error.publicMessage || '暫時無法儲存，內容已保留在你的手機，請稍後再試。'});
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

// 在試算表裡手動修改（例如勾「不採用」「上牆」）時清掉快取，讓網站馬上讀到新資料。
// onEdit 只在「從試算表擴充功能建立」的專案有效；獨立專案改由 setupSheet 建立的觸發條件呼叫 clearCacheOnEdit。
function onEdit() {
  clearCache_();
}

function clearCacheOnEdit() {
  clearCache_();
}


/* ---------- 檢查送來的資料 ---------- */

function validatePayload_(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) publicError_('資料格式不正確，請重新整理後再試。');
  var submissionId = cleanText_(data.submissionId, 80, true, '提交編號');
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(submissionId)) publicError_('提交編號不正確，請重新整理後再試。');
  var version = cleanText_(data.version, 40, false, '版本');

  if (data.role === 'message') {
    var wallStore = findStore_(cleanText_(data.storeId, 20, true, '門市'));
    if (!wallStore) publicError_('找不到這間門市，請重新整理後再試。');
    var deviceId = cleanText_(data.deviceId, 40, true, '裝置識別碼');
    if (!/^[A-Za-z0-9_-]{16,40}$/.test(deviceId)) publicError_('裝置識別碼不正確，請重新整理後再試。');
    var nickname = cleanText_(data.nickname, LIMITS.nickname, false, '暱稱');
    var text = cleanText_(data.text, LIMITS.message, true, '留言');
    if (text.length < MESSAGE_MIN_CHARS) publicError_('留言至少要 ' + MESSAGE_MIN_CHARS + ' 個字喔！');
    if (LINK_PATTERN.test((nickname + ' ' + text).normalize('NFKC'))) publicError_('留言不能放網址喔，用文字分享你的心得吧！');
    return {
      role:'message',
      submissionId:submissionId,
      store:wallStore,
      deviceId:deviceId,
      nickname:nickname || DEFAULT_NICKNAME,
      text:text,
      version:version
    };
  }

  if (data.role === 'staff') {
    var storeId = cleanText_(data.storeId, 20, false, '相關門市');
    var related = storeId ? findStore_(storeId) : null;
    if (storeId && !related) publicError_('請從清單選擇門市，或選「不限門市」。');
    return {
      role:'staff',
      submissionId:submissionId,
      store:related,
      name:cleanText_(data.staffName, LIMITS.staffName, false, '你的稱呼'),
      idea:cleanText_(data.idea, LIMITS.idea, true, '你的點子'),
      version:version
    };
  }

  if (data.role !== 'manager') publicError_('請先選擇你的身分。');
  var store = findStore_(cleanText_(data.storeId, 20, true, '門市'));
  if (!store) publicError_('請從清單選擇門市。');
  return {
    role:'manager',
    submissionId:submissionId,
    store:store,
    managerName:cleanText_(data.managerName, LIMITS.managerName, false, '店長稱呼'),
    quote:cleanText_(data.quote, LIMITS.quote, true, '店長的一句話'),
    productName:cleanText_(data.productName, LIMITS.productName, true, '推薦商品名稱'),
    productUrl:parseSalePage_(cleanText_(data.productUrl, 500, false, '官網商品頁網址')).url,
    reason:cleanText_(data.reason, LIMITS.reason, true, '推薦理由'),
    version:version
  };
}

/** 換行、Tab 換成空白，連續空白縮成一個，再檢查必填與字數。規則要和 form.js 的 normalizeText 一致。 */
function cleanText_(value, maxLength, required, label) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') publicError_('請檢查「' + label + '」的格式。');
  var text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (required && !text) publicError_('請填寫「' + label + '」。');
  if (text.length > maxLength) publicError_('「' + label + '」最多 ' + maxLength + ' 字。');
  return text;
}

/** 不論貼的是手機版、帶追蹤參數或夾在分享文字裡的網址，都統一成官網商品頁的標準網址。 */
function parseSalePage_(text) {
  if (!text) return {url:'', salePageId:''};
  var match = SALE_PAGE_PATTERN.exec(text);
  if (!match) publicError_('「官網商品頁網址」請貼 DK 官網的商品頁網址（網址裡會有 SalePage/Index/數字）。');
  return {url:'https://www.dk-shoes.com.tw/SalePage/Index/' + match[1], salePageId:match[1]};
}

function findStore_(id) {
  for (var i = 0; i < STORES.length; i++) if (STORES[i][0] === id) return STORES[i];
  return null;
}


/* ---------- 寫入 ---------- */

function appendRecord_(data) {
  var sheet = openTab_(RECORD_TAB, RECORD_HEADERS);
  if (hasSubmission_(sheet, data.submissionId)) return {ok:true, duplicate:true, role:'manager', storeId:data.store[0]};
  var now = new Date();
  appendRow_(sheet, [data.submissionId, now, data.store[0], data.store[1], data.store[2],
    data.managerName, data.quote, data.productName, data.productUrl, data.reason, data.version]);
  clearCache_();
  return {ok:true, role:'manager', storeId:data.store[0], submittedAt:isoTime_(now)};
}

function appendSuggestion_(data) {
  var sheet = openTab_(SUGGESTION_TAB, SUGGESTION_HEADERS);
  if (hasSubmission_(sheet, data.submissionId)) return {ok:true, duplicate:true, role:'staff'};
  var now = new Date();
  appendRow_(sheet, [data.submissionId, now, data.name,
    data.store ? data.store[0] : '', data.store ? data.store[1] : '', data.idea, data.version]);
  clearCache_();
  return {ok:true, role:'staff', submittedAt:isoTime_(now)};
}

/** 客人留言先存著等審核（「上牆」預設不勾），所以不用清快取。 */
function appendMessage_(data) {
  var sheet = openTab_(MESSAGE_TAB, MESSAGE_HEADERS);
  if (hasSubmission_(sheet, data.submissionId)) return {ok:true, pending:true, duplicate:true};
  var cache = CacheService.getScriptCache();
  var cooldownKey = 'message-device:' + data.deviceId;
  if (cache.get(cooldownKey)) publicError_('留言太快了，休息一下再留吧！');
  appendRow_(sheet, [data.submissionId, new Date(), data.store[0], data.store[1], data.nickname, data.text, data.version]);
  cache.put(cooldownKey, '1', MESSAGE_COOLDOWN_SECONDS);
  return {ok:true, pending:true};
}

/** 同一個提交編號 = 手機網路不穩重送，不重複新增。 */
function hasSubmission_(sheet, submissionId) {
  var last = sheet.getLastRow();
  if (last < 2) return false;
  var ids = sheet.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (var i = ids.length - 1; i >= 0; i--) if (ids[i][0] === submissionId) return true;
  return false;
}

/** 在最後新增一列；最後一欄（不採用／已看過／上牆）放一個未勾選的核取方塊。 */
function appendRow_(sheet, row) {
  var target = sheet.getLastRow() + 1;
  if (target > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
  var range = sheet.getRange(target, 1, 1, row.length);
  // 先設成純文字格式，避免「10/28」「001」這類內容被試算表自動轉成日期或數字。
  range.setNumberFormats([row.map(function (value) { return value instanceof Date ? 'yyyy-mm-dd hh:mm:ss' : '@'; })]);
  range.setValues([row.map(safeCellText_)]);
  sheet.getRange(target, row.length + 1).insertCheckboxes();
  SpreadsheetApp.flush();
}

var openedBook_ = null;

/** 同一次執行只開一次試算表（openById 每次要花一點時間）。 */
function book_() {
  if (openedBook_) return openedBook_;
  openedBook_ = SpreadsheetApp.getActiveSpreadsheet();
  if (!openedBook_) {
    if (!SPREADSHEET_ID) throw new Error('找不到試算表：請在程式開頭的 SPREADSHEET_ID 填入試算表 ID。');
    openedBook_ = SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return openedBook_;
}

function openTab_(name, headers) {
  var sheet = book_().getSheetByName(name);
  if (!sheet) throw new Error('找不到「' + name + '」分頁，請先執行 setupSheet。');
  var header = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (header.join('\n') !== headers.join('\n')) throw new Error('「' + name + '」的欄位標題被改過，請還原或重新執行 setupSheet。');
  return sheet;
}

/** 避免留言內容被試算表當成公式執行。 */
function safeCellText_(value) {
  return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value;
}


/* ---------- 讀取（doGet） ---------- */

function buildLatest_() {
  var records = openTab_(RECORD_TAB, RECORD_HEADERS);
  var last = records.getLastRow();
  var rows = last > 1 ? records.getRange(2, 1, last - 1, RECORD_HEADERS.length).getValues() : [];
  var latest = {};
  var counts = {};
  rows.forEach(function (row) {
    var storeId = String(row[RECORD.storeId]);
    var time = row[RECORD.submittedAt];
    if (!storeId || !(time instanceof Date) || row[RECORD.excluded] === true) return;
    counts[storeId] = (counts[storeId] || 0) + 1;
    if (!latest[storeId] || time >= latest[storeId][RECORD.submittedAt]) latest[storeId] = row;
  });

  var walls = approvedMessages_();
  var stores = {};
  var filledCount = 0;
  STORES.forEach(function (store) {
    var row = latest[store[0]];
    if (row) filledCount++;
    var url = row ? cellText_(row[RECORD.productUrl]) : '';
    var saleMatch = SALE_PAGE_PATTERN.exec(url);
    stores[store[0]] = {
      id:store[0],
      name:store[1],
      city:store[2],
      filled:!!row,
      submittedAt:row ? isoTime_(row[RECORD.submittedAt]) : '',
      managerName:row ? cellText_(row[RECORD.managerName]) : '',
      quote:row ? cellText_(row[RECORD.quote]) : '',
      product:row ? {
        name:cellText_(row[RECORD.productName]),
        url:saleMatch ? url : '',
        salePageId:saleMatch ? saleMatch[1] : '',
        reason:cellText_(row[RECORD.reason])
      } : null,
      submissionCount:counts[store[0]] || 0,
      messages:walls[store[0]] || []
    };
  });

  var suggestions = book_().getSheetByName(SUGGESTION_TAB);
  return {
    ok:true,
    schema:SCHEMA,
    generatedAt:isoTime_(new Date()),
    total:STORES.length,
    filledCount:filledCount,
    suggestionCount:suggestions ? Math.max(suggestions.getLastRow() - 1, 0) : 0,
    stores:stores
  };
}

/** 各店「上牆」有勾的留言，新到舊、每店最多 MESSAGE_WALL_SIZE 則。還沒建「門市留言」分頁時全部是空的。 */
function approvedMessages_() {
  var walls = {};
  if (!book_().getSheetByName(MESSAGE_TAB)) return walls;
  var sheet = openTab_(MESSAGE_TAB, MESSAGE_HEADERS);
  var last = sheet.getLastRow();
  var rows = last > 1 ? sheet.getRange(2, 1, last - 1, MESSAGE_HEADERS.length).getValues() : [];
  // 從最後一列往回讀：同一秒送出的留言，排序後也是後送的在前。
  rows.reverse().forEach(function (row) {
    var time = row[MESSAGE.submittedAt];
    if (row[MESSAGE.approved] !== true || !(time instanceof Date)) return;
    var storeId = String(row[MESSAGE.storeId]);
    (walls[storeId] = walls[storeId] || []).push(row);
  });
  Object.keys(walls).forEach(function (storeId) {
    walls[storeId] = walls[storeId]
      .sort(function (a, b) { return b[MESSAGE.submittedAt] - a[MESSAGE.submittedAt]; })
      .slice(0, MESSAGE_WALL_SIZE)
      .map(function (row) {
        return {nickname:cellText_(row[MESSAGE.nickname]), text:cellText_(row[MESSAGE.text]), at:isoTime_(row[MESSAGE.submittedAt])};
      });
  });
  return walls;
}

/** 讀回儲存格文字；拿掉寫入時為了防公式而加的單引號。 */
function cellText_(value) {
  var text = value === null || value === undefined ? '' : String(value);
  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
}

function isoTime_(date) {
  return Utilities.formatDate(date, TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function publicError_(message) {
  var error = new Error(message);
  error.publicMessage = message;
  throw error;
}


/* ---------- 快取（分段存，超過 100KB 也能快取） ---------- */

function cacheKeys_() {
  var keys = [CACHE_KEY + ':n'];
  for (var i = 0; i < CACHE_MAX_CHUNKS; i++) keys.push(CACHE_KEY + ':' + i);
  return keys;
}

function readCache_() {
  var cache = CacheService.getScriptCache();
  var count = Number(cache.get(CACHE_KEY + ':n'));
  if (!count) return null;
  var keys = cacheKeys_().slice(1, count + 1);
  var parts = cache.getAll(keys);
  var json = '';
  for (var i = 0; i < keys.length; i++) {
    if (typeof parts[keys[i]] !== 'string') return null;  // 有一段過期就整份重算
    json += parts[keys[i]];
  }
  return json;
}

function writeCache_(json) {
  var count = Math.ceil(json.length / CACHE_CHUNK_CHARS);
  if (count > CACHE_MAX_CHUNKS) return;
  var values = {};
  values[CACHE_KEY + ':n'] = String(count);
  for (var i = 0; i < count; i++) values[CACHE_KEY + ':' + i] = json.slice(i * CACHE_CHUNK_CHARS, (i + 1) * CACHE_CHUNK_CHARS);
  try { CacheService.getScriptCache().putAll(values, CACHE_SECONDS); } catch (_) { /* 快取失敗就下次再讀試算表 */ }
}

function clearCache_() {
  CacheService.getScriptCache().removeAll(cacheKeys_());
}


/* ---------- 第一次設定：在編輯器選 setupSheet 再按「執行」 ---------- */

function setupSheet() {
  var book = book_();
  if (!STORES.length) throw new Error('門市清單是空的，請先執行 tools/build_stores.py。');
  book.setSpreadsheetTimeZone(TIME_ZONE);

  var logTabs = [
    [RECORD_TAB, RECORD_HEADERS, [150,150,70,110,70,100,300,200,280,260,90,60]],
    [SUGGESTION_TAB, SUGGESTION_HEADERS, [150,150,120,80,110,420,90,60]],
    [MESSAGE_TAB, MESSAGE_HEADERS, [150,150,70,110,110,380,90,60]]
  ];
  // 新試算表預設的空白分頁（工作表1）直接改名來用。
  var names = [LATEST_TAB].concat(logTabs.map(function (tab) { return tab[0]; }));
  var blank = book.getSheets().filter(function (sheet) {
    return sheet.getLastRow() === 0 && names.indexOf(sheet.getName()) === -1;
  })[0];
  logTabs.forEach(function (tab) {
    prepareLogTab_(book, tab[0], tab[1], tab[2], blank);
    // 空白分頁已經被拿去用了，就不能再改名給下一個分頁。
    if (blank && blank.getName() === tab[0]) blank = null;
  });
  prepareLatestTab_(book);
  ensureEditTrigger_(book);

  clearCache_();
  console.log('設定完成：「' + names.join('」「') + '」分頁都準備好了，共 ' + STORES.length + ' 間門市。');
}

/**
 * 獨立的 Apps Script 專案收不到 onEdit，改建一個「編輯試算表時」的觸發條件來清快取，
 * 這樣勾「上牆」「不採用」後網站下一次讀就看得到。第一次建立時 Google 會要求多一項授權。
 */
function ensureEditTrigger_(book) {
  if (SpreadsheetApp.getActiveSpreadsheet()) return;
  var exists = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === 'clearCacheOnEdit';
  });
  if (!exists) ScriptApp.newTrigger('clearCacheOnEdit').forSpreadsheet(book).onEdit().create();
}

/** 建立（或補齊）紀錄型分頁的標題列；已經有資料時只檢查，不動資料。 */
function prepareLogTab_(book, name, headers, widths, blank) {
  var sheet = book.getSheetByName(name) || (blank ? blank.setName(name) : book.insertSheet(name));
  var header = sheet.getRange(1, 1, 1, headers.length);
  if (sheet.getLastRow() > 1 && header.getDisplayValues()[0].join('\n') !== headers.join('\n')) {
    throw new Error('「' + name + '」已經有資料但欄位標題不同，為了避免弄亂資料先停下來，請檢查後再執行。');
  }
  header.setValues([headers]).setFontWeight('bold').setBackground(BRAND_COLOR).setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  widths.forEach(function (width, i) { sheet.setColumnWidth(i + 1, width); });
  // 既有資料列補上核取方塊驗證（不改變已勾選的值）。
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, headers.length, sheet.getLastRow() - 1, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
  return sheet;
}

/** 「每店最新」整頁重建：61 間門市各一列，用公式從「填寫紀錄」找出每店最新、未勾不採用的那筆。 */
function prepareLatestTab_(book) {
  var sheet = book.getSheetByName(LATEST_TAB) || book.insertSheet(LATEST_TAB, 0);
  sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
  sheet.clear();
  sheet.setConditionalFormatRules([]);

  var headers = ['門市ID','門市名稱','縣市','狀態','最新送出時間','店長稱呼','店長的一句話','推薦商品','商品網址','推薦理由','有效送出次數'];
  var src = "'" + RECORD_TAB + "'!";
  var notExcluded = src + '$L$2:$L<>TRUE';
  var rows = STORES.map(function (store, i) {
    var r = i + 2;
    var sameStore = src + '$C$2:$C=$A' + r;
    return [store[0], store[1], store[2],
      '=IF(E' + r + '="","未填","已填")',
      // 取「填寫紀錄」B 欄（時間）＋ F:J 欄，依時間新到舊排序後取第一列，會自動展開到 E:J。
      '=IFERROR(ARRAY_CONSTRAIN(SORT(FILTER({' + src + '$B$2:$B,' + src + '$F$2:$J},' + sameStore + ',' + notExcluded + '),1,FALSE),1,6),"")',
      '', '', '', '', '',
      '=SUMPRODUCT((' + sameStore + ')*(' + notExcluded + '))'];
  });
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground(BRAND_COLOR).setFontColor('#ffffff');
  sheet.getRange(2, 1, rows.length, 3).setNumberFormat('@');
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.getRange(2, 5, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');

  // 右上角小計：已填幾間。
  sheet.getRange('M1').setValue('已填店數').setFontWeight('bold');
  sheet.getRange('M2').setFormula('=COUNTIF(D2:D' + (rows.length + 1) + ',"已填")&" / ' + rows.length + '"');

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  [70,110,70,60,130,100,300,200,280,260,90].forEach(function (width, i) { sheet.setColumnWidth(i + 1, width); });
  var status = sheet.getRange(2, 4, rows.length, 1);
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('未填')
      .setBackground('#F6E4E7').setFontColor(BRAND_COLOR).setRanges([status]).build()
  ]);
  sheet.protect().setDescription('這一頁由公式自動產生，請勿手動修改').setWarningOnly(true);
  book.setActiveSheet(sheet);
  book.moveActiveSheet(1);
}
