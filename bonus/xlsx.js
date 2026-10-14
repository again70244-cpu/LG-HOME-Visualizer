/* 最小的 .xlsx 讀取器：只把第一個工作表讀成二維陣列。
   不用外部函式庫（頁面 CSP 只允許本站的 script），解壓縮交給瀏覽器內建的
   DecompressionStream("deflate-raw")。檔案從頭到尾都在手機裡處理，不會送出去。 */
window.readXlsx = (() => {
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

  // 讀 zip 的中央目錄，回傳 { 檔名: 取得內容的函式 }
  function unzip(buf) {
    const b = new Uint8Array(buf);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
      if (u32(b, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("not_zip");
    const count = u16(b, eocd + 10);
    let p = u32(b, eocd + 16);
    const files = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (u32(b, p) !== 0x02014b50) throw new Error("bad_zip");
      const method = u16(b, p + 10), csize = u32(b, p + 20);
      const nameLen = u16(b, p + 28), extraLen = u16(b, p + 30), commentLen = u16(b, p + 32);
      const local = u32(b, p + 42);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
      files[name] = async () => {
        const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
        const raw = b.subarray(start, start + csize);
        if (method === 0) return dec.decode(raw);
        if (method !== 8) throw new Error("unsupported_zip");
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return await new Response(stream).text();
      };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  const xml = (text) => new DOMParser().parseFromString(text, "application/xml");
  // A → 0, Z → 25, AA → 26 …
  const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  // 只取正文 <t>，略過注音標示 <rPh> 裡的文字
  const textOf = (node) => [...node.getElementsByTagName("t")].filter((t) => t.parentNode.nodeName !== "rPh").map((t) => t.textContent).join("");

  async function firstSheetPath(files) {
    try {
      const wb = xml(await files["xl/workbook.xml"]());
      const rid = wb.getElementsByTagName("sheet")[0].getAttribute("r:id");
      const rels = xml(await files["xl/_rels/workbook.xml.rels"]());
      const rel = [...rels.getElementsByTagName("Relationship")].find((r) => r.getAttribute("Id") === rid);
      const target = rel.getAttribute("Target").replace(/^\/?(xl\/)?/, "");
      if (files["xl/" + target]) return "xl/" + target;
    } catch {}
    return Object.keys(files).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  }

  return async function readXlsx(arrayBuffer) {
    if (typeof DecompressionStream === "undefined") throw new Error("no_decompress");
    const files = unzip(arrayBuffer);
    const shared = files["xl/sharedStrings.xml"] ? [...xml(await files["xl/sharedStrings.xml"]()).getElementsByTagName("si")].map(textOf) : [];
    const path = await firstSheetPath(files);
    if (!path) throw new Error("no_sheet");
    const sheet = xml(await files[path]());
    const rows = [];
    for (const row of sheet.getElementsByTagName("row")) {
      const r = row.hasAttribute("r") ? +row.getAttribute("r") - 1 : rows.length;
      const out = [];
      for (const c of row.getElementsByTagName("c")) {
        const t = c.getAttribute("t");
        const v = c.getElementsByTagName("v")[0]?.textContent;
        let val = null;
        if (t === "s") val = shared[+v] ?? null;
        else if (t === "inlineStr") val = textOf(c);
        else if (t === "str" || t === "e") val = v ?? null;
        else if (t === "b") val = v === "1";
        else if (v != null && v !== "") val = Number(v);
        out[c.hasAttribute("r") ? colIndex(c.getAttribute("r")) : out.length] = val;
      }
      rows[r] = out;
    }
    return rows;
  };
})();
