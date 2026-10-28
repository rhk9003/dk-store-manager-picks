# 店長的一句話＋店長推薦｜資料蒐集工具

讓全台 61 間 DK 門市店長填「店長的一句話＋推薦商品」，其他同事也能留「DK 台灣島可以放什麼」的點子。
填寫頁放在 GitHub Pages，資料寫進 Google Sheet；「DK 台灣島」網站從同一個網址讀取每店最新資料，
島上客人的「門市留言」和「島民角色」也送到這裡，留言先審再上牆、島民的暱稱先審再顯示。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html`、`form.js` | 填寫頁（手機優先）。先選身分：店長／其他同事 |
| `progress.html`、`progress.js` | 填寫進度頁：已填幾間、各店內容、複製未填名單 |
| `styles.css` | 兩個頁面共用的樣式 |
| `config.js` | **收件網址設定**（部署 Apps Script 後要填） |
| `stores.js` | 門市清單（由程式產生，勿手改） |
| `Code.gs` | Google Apps Script 收件程式（貼到 Sheet 的 Apps Script 編輯器）；也負責台灣島的門市留言 |
| `tools/build_stores.py` | 門市有增減時，重新產生 `stores.js` 與 `Code.gs` 裡的門市清單 |

## 運作方式

```
店長／同事手機 ──送出──▶ Apps Script（doPost）──▶ Google Sheet
台灣島客人留言 ──送出──▶                            ├ 填寫紀錄（店長每次送出都留一列）
                                                   ├ 同仁建議（同事的點子，只在內部）
                                                   ├ 門市留言（客人留言，勾「上牆」才公開）
                                                   ├ 島民角色（訪客捏的氣球人，暱稱勾「暱稱通過」才顯示）
                                                   └ 每店最新（公式自動整理，每店一列）
進度頁／DK 台灣島 ──讀取──▶ Apps Script（doGet）──▶ 每店最新一筆＋已上牆留言＋島民的 JSON
```

- 同一間店可以重送，**以最新一筆為準**；舊紀錄都保留在「填寫紀錄」。
- 沒有通行碼，拿到連結的人都能送。遇到亂填：在「填寫紀錄」把那一列最後一欄 **「不採用」打勾** 即可，不用刪列，網站和「每店最新」會自動改用前一筆。
- 同事的點子只存在「同仁建議」分頁，**不會**出現在網站讀取的 JSON 裡（只回傳則數）。
- 島上客人的留言預設**不公開**，要你在「門市留言」勾「上牆」才會出現（見下方「門市留言怎麼審核」）。
- 島民角色**馬上公開**，但暱稱要你勾「暱稱通過」才顯示（見下方「島民角色怎麼審核」）。

---

## 部署步驟

> 第一次大約 15 分鐘。步驟 2～4 的「授權」與「部署」按鈕，必須由你本人按。

### 1. 建立 Google Sheet

1. 到 <https://sheets.google.com> 新增一份**空白試算表**。
2. 左上角命名，例如「DK 店長的一句話」。
3. 分頁和欄位標題不用自己建，步驟 3 會自動建立。

### 2. 貼上 Apps Script

1. 在試算表上方選單：**擴充功能 → Apps Script**，會開一個新分頁。
2. 左上角專案名稱改成「DK 店長的一句話 收件」（可省略）。
3. 把編輯器裡原本的 `function myFunction() {}` **全部刪掉**。
4. 打開本資料夾的 `Code.gs`，全選複製，貼進編輯器。
5. 按 💾（儲存專案）。

### 3. 執行一次 setupSheet（建立分頁＋授權）

1. 編輯器上方的函式下拉選單選 **`setupSheet`**，按 **▶ 執行**。
2. 第一次會跳出「需要授權」：
   - 按「審查權限」→ 選你的 Google 帳號。
   - 出現「Google 尚未驗證這個應用程式」時：按左下「進階」→「前往『DK 店長的一句話 收件』（不安全）」。
     （這是你自己寫的程式，只會存取這份試算表，所以會出現這個提醒。）
   - 按「允許」。
3. 下方執行紀錄出現「設定完成：…共 61 間門市」就成功了。
4. 回到試算表，會看到五個分頁：**每店最新**、**填寫紀錄**、**同仁建議**、**門市留言**、**島民角色**（原本的「工作表1」會被改名使用）。

### 4. 部署成網頁應用程式

1. 回到 Apps Script 編輯器，右上角 **部署 → 新增部署作業**。
2. 左邊齒輪「選取類型」→ **網頁應用程式**。
3. 設定：
   - 說明：`v1`
   - 執行身分：**我**
   - 誰可以存取：**任何人**
4. 按「部署」，複製畫面上的 **網頁應用程式網址**（`https://script.google.com/macros/s/……/exec`）。

> 如果「誰可以存取」沒有「任何人」可選：代表這個是公司 Google Workspace 帳號、管理員關掉了對外分享，請改用個人 Gmail 帳號建立試算表，或請 IT 開放。

### 5. 測試收件網址

把剛剛的網址直接貼到瀏覽器打開，應該看到一串文字，開頭像這樣：

```
{"ok":true,"schema":"dk-store-manager-picks/v1", ... "filledCount":0, ...
```

看到 `"ok":true` 就代表收件程式正常。

### 6. 把網址填進 config.js

打開本資料夾的 `config.js`，把網址貼進引號中間：

```js
window.DK_PICKS_ENDPOINT = "https://script.google.com/macros/s/……/exec";
```

存檔。這時在電腦上直接雙擊打開 `index.html`，填一筆測試資料按送出，再回 Sheet 看「填寫紀錄」有沒有出現一列。
（測試完把那一列「不採用」打勾，或直接刪掉該列。）

### 7. 推上 GitHub Pages

repo 名稱：`dk-store-manager-picks`（使用者 `rhk9003`）。

1. 在 Claude 裡說「用 dk-deploy 把店長的話蒐集推上 GitHub」，或自己用 GitHub Desktop 建 repo 推送整個資料夾。
2. 到 repo 的 **Settings → Pages**：Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾 `/ (root)`，按 Save。
3. 約 1～2 分鐘後網址生效：
   - 填寫頁：<https://rhk9003.github.io/dk-store-manager-picks/>
   - 進度頁：<https://rhk9003.github.io/dk-store-manager-picks/progress.html>

### 8. 發連結

| 給誰 | 連結 |
|---|---|
| 全體店長（LINE 群組） | `https://rhk9003.github.io/dk-store-manager-picks/` |
| 指定某間店（自動選好門市） | `https://rhk9003.github.io/dk-store-manager-picks/?store=頂好`（`store=` 後面是門市 ID，見「每店最新」A 欄） |
| 其他同事留點子 | `https://rhk9003.github.io/dk-store-manager-picks/?role=staff` |
| 看進度、催填 | `https://rhk9003.github.io/dk-store-manager-picks/progress.html` |

進度頁的「複製未填名單」會把還沒填的門市依縣市排好，連同填寫連結一起複製，直接貼到 LINE 群組催填。

---

## 日常管理

- **看資料**：「每店最新」一店一列（紅底＝未填），右上角有已填店數；「填寫紀錄」是全部歷史。
- **亂填／填錯店**：在「填寫紀錄」那一列的「不採用」打勾。
- **同事點子**：在「同仁建議」分頁，看過的可以把「已看過」打勾。
- **客人留言**：在「門市留言」分頁審核，見下一節。
- **島民角色**：在「島民角色」分頁審核暱稱，見「島民角色怎麼審核」。
- **網站多久更新**：有人送出時立即更新；在試算表手動修改（例如勾「不採用」「上牆」「暱稱通過」「隱藏」）也會立即更新。
- 「每店最新」是公式產生的，**不要手動改**；要重建就再執行一次 `setupSheet`（不會刪任何紀錄）。

## 門市留言怎麼審核

DK 台灣島上，客人可以在每間門市留言。留言**先審再上牆**：

1. 打開試算表的 **「門市留言」** 分頁，新留言會一列一列加在最下面（時間、門市、暱稱、留言）。
2. 內容沒問題的，把最後一欄 **「上牆」打勾** → 島上該門市的留言牆下一次讀取就會出現。
3. 不想公開的留言**不要勾**就好（不用刪），客人看不到。已上牆的想撤下，取消勾選即可。

- 每間店的留言牆只顯示「上牆」的最新 12 則。
- 系統已自動擋掉：含網址的留言、少於 2 字或超過 60 字、暱稱超過 12 字、同一台裝置 30 秒內連續留言、機器人。
- 暱稱沒填的會存成「路過的客人」。

## 島民角色怎麼審核

DK 台灣島的訪客可以捏一個氣球人放上島（造型和移動方式都是固定選項）。**角色馬上出現，暱稱先審再顯示**：

1. 打開試算表的 **「島民角色」** 分頁，一台裝置一列；同一個人重新捏會更新同一列（更新時間會變）。
2. 暱稱沒問題的，把 **「暱稱通過」打勾** → 島上這個氣球人頭上就會顯示暱稱。沒勾的只顯示角色、不顯示名字。
3. 角色本身不想出現在島上（例如暱稱很糟又一直改），把 **「隱藏」打勾** → 整個角色消失；取消勾選就回來。
4. 島民**改了暱稱**時，「暱稱通過」會自動取消，需要再審一次。「隱藏」則會維持，不會因為對方重新存檔而解除。

- 「裝置代號」欄只給你查用，不會出現在網站上（拿到它就能改掉別人的角色）。
- 系統已自動擋掉：不在清單內的造型或移動方式、含網址的暱稱、暱稱超過 10 字、同一台裝置 30 秒內連續存檔、機器人。
- 島上最多顯示最近更新的 300 個角色。

## 改了 Code.gs 之後

1. 把新的 `Code.gs` 全部貼回 Apps Script 編輯器，儲存。
2. **部署 → 管理部署作業** → 選原本那個部署 → 右上 ✏️ 編輯 → 版本選 **「新版本」** → 部署。
   這樣網址不變，`config.js` 不用改。（若按「新增部署作業」會產生新網址。）

## 門市有增減

1. 更新上一層的 `DK門市清單.json`。
2. 在本資料夾執行：`python tools/build_stores.py`
3. 依「改了 Code.gs 之後」重新部署，再到編輯器執行一次 `setupSheet`（「每店最新」會依新清單重建）。
4. 把更新後的 `stores.js` 推上 GitHub。

---

## 給「DK 台灣島」網站：讀取格式

`GET <收件網址>` 回傳 JSON（欄位名稱固定，之後只增不改）：

```json
{
  "ok": true,
  "schema": "dk-store-manager-picks/v1",
  "generatedAt": "2026-10-28T10:00:00+08:00",
  "total": 61,
  "filledCount": 12,
  "suggestionCount": 5,
  "stores": {
    "頂好": {
      "id": "頂好",
      "name": "DK-頂好店",
      "city": "台北市",
      "filled": true,
      "submittedAt": "2026-10-28T09:12:33+08:00",
      "managerName": "阿凱店長",
      "quote": "走一整天也不累，來店裡試穿就知道！",
      "product": {
        "name": "空氣鞋 運動休閒鞋 黑色",
        "url": "https://www.dk-shoes.com.tw/SalePage/Index/10737417",
        "salePageId": "10737417",
        "reason": "鞋墊超軟，久站的客人都回購"
      },
      "submissionCount": 2,
      "messages": [
        { "nickname": "小明", "text": "店員超親切，鞋子好穿！", "at": "2026-10-28T10:00:00+08:00" }
      ]
    },
    "民生": { "id": "民生", "name": "DK-民生店", "city": "台北市", "filled": false,
              "submittedAt": "", "managerName": "", "quote": "", "product": null, "submissionCount": 0,
              "messages": [] }
  },
  "residents": [
    { "id": "a1b2c3d4e5f6", "look": { "body": "k", "hat": "cap", "acc": "none", "shoe": "#2e2b2a" },
      "mode": "north", "nickname": "", "at": "2026-10-28T10:00:00+08:00" }
  ]
}
```

- `stores` 以門市 `id` 為鍵（與 `DK門市清單.json` 的 `id` 相同），61 間都會出現；未填的店 `filled: false`、`product: null`。
- `managerName`、`product.url`、`product.salePageId` 可能是空字串。
- 字數上限：`quote` 40、`product.name` 40、`product.reason` 40、`managerName` 20。
- `messages`：「上牆」有勾的留言，新到舊最多 12 則；沒有就是 `[]`。

### 送出門市留言

`POST <收件網址>`，`Content-Type: text/plain`，內容是 JSON：

```json
{ "role": "message", "submissionId": "36 字元 uuid", "storeId": "頂好", "nickname": "小明",
  "text": "留言內容", "deviceId": "16–40 字元 A-Z a-z 0-9 _ -", "website": "", "version": "island-1" }
```

- 成功回 `{"ok":true,"pending":true}`（同一個 `submissionId` 重送回 `{"ok":true,"pending":true,"duplicate":true}`，不會重複新增）。
- 失敗回 `{"ok":false,"message":"…"}`，`message` 可以直接顯示給客人，例如「留言太快了，休息一下再留吧！」「留言不能放網址喔…」。
- `nickname` 選填（≤12 字），`text` 必填 2–60 字；`website` 是防機器人的隱藏欄位，要送空字串。

### 島民角色

讀取：頂層 `residents` 是沒隱藏的島民，依更新時間新到舊最多 300 個；`nickname` 只有審核通過才有值，否則是空字串。不會回傳裝置代號。

送出（同樣是 `POST <收件網址>`、`text/plain` 的 JSON）：

```json
{ "role": "resident", "submissionId": "36 字元 uuid", "deviceId": "16–40 字元 A-Z a-z 0-9 _ -",
  "nickname": "選填，最多 10 字",
  "look": { "body": "d|k|e|c", "hat": "none|cap|beanie|straw|crown", "acc": "none|backpack|scarf|glasses",
            "shoe": "#2e2b2a|#f2efe8|#e2cba6|#8B2332|#9b9a98|#9a86c6|#5b80b8|#f1b6c4" },
  "mode": "loop|north|central|south|east|street|mountain", "website": "", "version": "island-1" }
```

- 成功回 `{"ok":true,"id":"角色ID","nicknamePending":true}`；`nicknamePending` 表示暱稱還在等審核（沒填暱稱或暱稱沒改且已通過時是 `false`）。
- 角色ID = `deviceId` 做 SHA-256 後十六進位的前 12 碼，網站可以用同樣算法認出「我的角色」。
- 一台裝置只有一個角色，再送一次就是更新；同一個 `submissionId` 6 小時內重送會拿到同樣的回應。
- 失敗回 `{"ok":false,"message":"…"}`，可以直接顯示給訪客。
- 用 `fetch(網址)` 直接讀即可（Apps Script 允許跨網域 GET）。伺服器端已快取 5 分鐘。
  Apps Script 有每日執行次數與同時連線上限，若台灣島正式上線流量大，建議改成定時把這份 JSON 存成靜態檔，網站讀靜態檔。

## 常見問題

- **店長說送出失敗**：內容會保留在他的手機，請他確認網路後再按一次；同一份內容重按不會重複新增。
- **送出後 Sheet 沒資料**：確認 `config.js` 的網址結尾是 `/exec`（不是 `/dev`），且部署時「誰可以存取」選「任何人」。
- **打開網址看到 Google 登入頁**：部署的存取權不是「任何人」，請在「管理部署作業」改設定後部署新版本。
- **執行 setupSheet 出現「找不到試算表：請在程式開頭的 SPREADSHEET_ID 填入試算表 ID」**：代表這個 Apps Script 專案不是從試算表的「擴充功能」開的（是獨立專案）。
  把試算表網址 `https://docs.google.com/spreadsheets/d/這一串/edit` 中間那串 ID 填進 `Code.gs` 開頭的 `SPREADSHEET_ID`，存檔後再執行一次。
  獨立專案收不到 `onEdit`，所以 `setupSheet` 會另外建立一個「編輯試算表時清快取」的觸發條件（`clearCacheOnEdit`），
  第一次執行時 Google 會多要一項授權（「管理觸發條件」），按允許即可。這樣勾「不採用」「上牆」後網站一樣會立刻更新。
