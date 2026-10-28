"""從 DK門市清單.json 產生前端的 stores.js，並更新 Code.gs 裡的門市清單（STORES）。

門市有增減時：更新 DK門市清單.json → 執行這支程式 → 把新的 Code.gs 貼回 Apps Script、
重新部署新版本 → 回到 Sheet 執行一次 setupSheet（「每店最新」會依新清單重建）→ 推上 GitHub。

用法：
    python tools/build_stores.py                     # 預設讀上一層資料夾的 DK門市清單.json
    python tools/build_stores.py 路徑/DK門市清單.json
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT.parent / "DK門市清單.json"


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    data = json.loads(source.read_text(encoding="utf-8"))
    stores = [{"id": s["id"], "name": s["name"], "city": s["city"]} for s in data["stores"]]
    ids = [s["id"] for s in stores]
    if len(ids) != len(set(ids)):
        raise SystemExit("門市 id 有重複，請先修正 DK門市清單.json")

    lines = ",\n".join("  " + json.dumps(s, ensure_ascii=False) for s in stores)
    (ROOT / "stores.js").write_text(
        f"/* 由 tools/build_stores.py 從 DK門市清單.json 產生（清單抓取日 {data.get('fetchedAt', '')}），請勿手改。 */\n"
        f"window.DK_STORES = [\n{lines}\n];\n",
        encoding="utf-8",
    )

    code_path = ROOT / "Code.gs"
    code = code_path.read_text(encoding="utf-8")
    rows = ",\n".join(
        "  [" + ", ".join(json.dumps(s[k], ensure_ascii=False).replace('"', "'") for k in ("id", "name", "city")) + "]"
        for s in stores
    )
    block = re.compile(r"(// BEGIN STORES[^\n]*\n).*?(\n// END STORES)", re.S)
    if not block.search(code):
        raise SystemExit("Code.gs 裡找不到 BEGIN STORES / END STORES 標記")
    code = block.sub(lambda m: f"{m.group(1)}var STORES = [\n{rows}\n];{m.group(2)}", code)
    code_path.write_text(code, encoding="utf-8")
    print(f"已更新 stores.js 與 Code.gs，共 {len(stores)} 間門市。")


if __name__ == "__main__":
    main()
