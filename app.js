/* ════════════════════════════════════════════════════════════════════════
   ATIRUJ Quotation Generator — 100% client-side
   - DBD OpenAPI lookup (direct fetch, with optional CORS proxy fallback)
   - Per-item product images (aspect-ratio preserved, thumbnail in form + PDF)
   - PDF export via pdf-lib + @pdf-lib/fontkit, with the real Sarabun font
     fetched at runtime and embedded with proper OpenType shaping (see the
     long comment above buildPdf() for why Thai text is drawn glyph-by-glyph
     via fontkit's font.layout() instead of pdf-lib's drawText()).
   ════════════════════════════════════════════════════════════════════════ */

// ── Constants ────────────────────────────────────────────────────────────────
const DBD_API_BASE   = 'https://openapi.dbd.go.th/api/v1/juristic_person/';
const DBD_TEST_ID    = '0107567000414';

// Google Fonts CSS endpoint for Sarabun. We deliberately fetch the *CSS*
// at runtime rather than hardcoding a fonts.gstatic.com file URL: Google
// rotates the versioned hash in those URLs whenever the font is rebuilt
// (e.g. v15 -> v17), so a hardcoded link silently goes stale. Resolving
// the real .ttf URLs from the CSS response on every load keeps this
// working indefinitely without maintenance.
const GOOGLE_FONTS_CSS_URL = 'https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap';

let itemCounter = 0;
const itemImages  = {}; // itemId -> { dataUrl, naturalW, naturalH }

// ── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const today = new Date();
  document.getElementById('quoteDate').value = isoDate(today);

  recalcValidUntil();
  updateQuoteNo();

  document.querySelectorAll('#dayChips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#dayChips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      recalcValidUntil(Number(chip.dataset.days));
    });
  });

  document.getElementById('validUntil').addEventListener('change', () => {
    document.querySelectorAll('#dayChips .chip').forEach(c => c.classList.remove('active'));
  });

  addItemRow();
  addItemRow();
});

function isoDate(d) { return d.toISOString().slice(0, 10); }

// ── Quote number: "Q6906-01" from a sequence + the document date ───────────────
function updateQuoteNo() {
  const dateVal = document.getElementById('quoteDate').value;
  const seqRaw  = document.getElementById('seqInput').value.trim();
  if (!dateVal || !seqRaw) {
    document.getElementById('quoteNo').value = '';
    return;
  }
  const d = new Date(dateVal + 'T00:00:00');
  const yy = String((d.getFullYear() + 543) % 100).padStart(2, '0'); // พ.ศ. 2 หลัก
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const seq = String(parseInt(seqRaw, 10) || 0).padStart(2, '0');
  document.getElementById('quoteNo').value = `Q${yy}${mm}-${seq}`;
}

// ── Valid Until = quote date + N days ───────────────────────────────────────────
function recalcValidUntil(days) {
  if (days === undefined) {
    const active = document.querySelector('#dayChips .chip.active');
    days = active ? Number(active.dataset.days) : 15;
  }
  const baseStr = document.getElementById('quoteDate').value;
  const base = baseStr ? new Date(baseStr + 'T00:00:00') : new Date();
  const target = new Date(base);
  target.setDate(target.getDate() + days);
  document.getElementById('validUntil').value = isoDate(target);
}

// ── DBD lookup ───────────────────────────────────────────────────────────────
function toggleProxyRow() {
  document.getElementById('proxyRow').classList.toggle('show');
}

async function fetchDBD() {
  const jid = document.getElementById('juristicId').value.trim();
  const statusEl = document.getElementById('dbdStatus');
  const btn = document.getElementById('dbdBtn');

  if (jid.length !== 13) {
    statusEl.className = 'dbd-status err';
    statusEl.textContent = '❌ กรุณากรอกเลขนิติบุคคลให้ครบ 13 หลัก';
    return;
  }

  statusEl.className = 'dbd-status wait';
  statusEl.textContent = '⏳ กำลังดึงข้อมูลจาก DBD...';
  btn.disabled = true;

  const useProxy  = document.getElementById('useProxy').checked;
  const proxyUrl  = document.getElementById('proxyUrl').value.trim();
  const targetUrl = DBD_API_BASE + jid;
  const fetchUrl  = (useProxy && proxyUrl) ? (proxyUrl + encodeURIComponent(targetUrl)) : targetUrl;

  try {
    let raw;
    try {
      const resp = await fetch(fetchUrl, { method: 'GET' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      raw = await resp.json();
    } catch (fetchErr) {
      // Fallback to a mocked response ONLY for the documented test ID, so the
      // demo still works if the live DBD endpoint is unreachable (e.g. a
      // sandboxed preview with no outbound network, or a genuine CORS block
      // with no proxy configured). For any other ID, the real error is
      // re-thrown and surfaced to the user as-is.
      if (jid === DBD_TEST_ID) {
        raw = mockDbdResponse(jid);
      } else {
        throw fetchErr;
      }
    }

    const info = parseDbdResponse(raw);
    if (info.error) throw new Error(info.error);

    document.getElementById('buyerName').value    = info.nameTh || info.nameEn || '';
    document.getElementById('buyerAddress').value = info.address || '';
    document.getElementById('buyerTaxId').value   = jid;

    statusEl.className = 'dbd-status ok';
    const cap = info.capital ? `  |  ทุนจดทะเบียน: ${Number(info.capital).toLocaleString()} บาท` : '';
    const sta = info.status  ? `  |  สถานะ: ${info.status}` : '';
    statusEl.textContent = `✅ ${info.nameTh || info.nameEn}${sta}${cap}`;

  } catch (err) {
    statusEl.className = 'dbd-status err';
    if (String(err.message).includes('Failed to fetch') || err.name === 'TypeError') {
      statusEl.textContent = '❌ เชื่อมต่อ DBD ไม่ได้ — อาจติด CORS Policy ลองเปิด "ตั้งค่า CORS Proxy" ด้านบนแล้วใส่ Proxy URL';
    } else {
      statusEl.textContent = '❌ ' + err.message;
    }
  } finally {
    btn.disabled = false;
  }
}

/** Parse the real DBD OpenAPI v1 response shape into a flat info object. */
function parseDbdResponse(raw) {
  if (raw.status && String(raw.status.code) !== '1000') {
    return { error: raw.status.description || 'DBD ไม่พบข้อมูล' };
  }
  const list = Array.isArray(raw.data) ? raw.data : [];
  if (!list.length) return { error: 'ไม่พบข้อมูลบริษัทสำหรับเลขนี้' };

  const row = list[0]['cd:OrganizationJuristicPerson'];
  if (!row) return { error: 'รูปแบบข้อมูลจาก DBD ไม่ตรงตามที่คาดไว้' };

  const nameTh  = row['cd:OrganizationJuristicNameTH'] || '';
  const nameEn  = row['cd:OrganizationJuristicNameEN'] || '';
  const status  = row['cd:OrganizationJuristicStatus'] || '';
  const capital = row['cd:OrganizationJuristicRegisterCapital'] || '';
  const address = buildDbdAddress(row);

  if (!nameTh && !nameEn) return { error: 'พบข้อมูลแต่ไม่มีชื่อบริษัท — กรุณาตรวจสอบเลขทะเบียน' };

  return { nameTh, nameEn, address, status, capital: String(capital) };
}

function buildDbdAddress(row) {
  const addrWrap = row['cd:OrganizationJuristicAddress'];
  const a = addrWrap && addrWrap['cr:AddressType'];
  if (!a) return '';

  const g = key => {
    const v = a[key];
    return (v !== null && v !== undefined && String(v).trim()) ? String(v).trim() : '';
  };
  const nested = (key, sub) => {
    const obj = a[key];
    if (!obj) return '';
    const v = obj[sub];
    return (v !== null && v !== undefined && String(v).trim()) ? String(v).trim() : '';
  };

  const parts = [
    g('cd:AddressNo'),
    g('cd:Moo')  && `หมู่ ${g('cd:Moo')}`,
    g('cd:Soi')  && `ซอย${g('cd:Soi')}`,
    g('cd:Road') && `ถนน${g('cd:Road')}`,
    nested('cd:CitySubDivision', 'cr:CitySubDivisionTextTH') &&
      `ตำบล/แขวง${nested('cd:CitySubDivision', 'cr:CitySubDivisionTextTH')}`,
    nested('cd:City', 'cr:CityTextTH') &&
      `อำเภอ/เขต${nested('cd:City', 'cr:CityTextTH')}`,
    nested('cd:CountrySubDivision', 'cr:CountrySubDivisionTextTH'),
  ];
  return parts.filter(Boolean).join(' ').trim();
}

/** Mocked DBD response for the documented test ID, matching the real API shape exactly. */
function mockDbdResponse(jid) {
  return {
    status: { code: '1000', description: 'Success' },
    data: [{
      'cd:OrganizationJuristicPerson': {
        'cd:OrganizationJuristicID': jid,
        'cd:OrganizationJuristicNameTH': 'บริษัท ตัวอย่าง ทดสอบระบบ จำกัด',
        'cd:OrganizationJuristicNameEN': 'SAMPLE TEST COMPANY LIMITED',
        'cd:OrganizationJuristicType': 'บริษัทจำกัด',
        'cd:OrganizationJuristicRegisterDate': '20100115',
        'cd:OrganizationJuristicStatus': 'ยังดำเนินกิจการอยู่',
        'cd:OrganizationJuristicRegisterCapital': '5000000.0',
        'cd:OrganizationJuristicPaidUpCapital': null,
        'cd:OrganizationJuristicBranchName': 'สำนักงานใหญ่',
        'cd:OrganizationJuristicAddress': {
          'cr:AddressType': {
            'cd:AddressNo': '99/9', 'cd:Moo': '4', 'cd:Soi': null, 'cd:Road': 'สุขุมวิท',
            'cd:CitySubDivision': { 'cr:CitySubDivisionTextTH': 'บางนา' },
            'cd:City': { 'cr:CityTextTH': 'บางนา' },
            'cd:CountrySubDivision': { 'cr:CountrySubDivisionTextTH': 'กรุงเทพมหานคร' },
          },
        },
      },
    }],
  };
}

// ── Items ─────────────────────────────────────────────────────────────────────
function addItemRow(data = {}) {
  itemCounter++;
  const id = itemCounter;
  const tbody = document.getElementById('itemsBody');
  const tr = document.createElement('tr');
  tr.className = 'irow';
  tr.dataset.itemId = id;

  tr.innerHTML = `
    <td style="text-align:center;color:var(--gray);font-size:12.5px;">${tbody.children.length + 1}</td>
    <td class="img-cell">
      <div class="img-thumb-wrap" onclick="document.getElementById('file${id}').click()" id="thumb${id}">
        <span class="placeholder">🖼</span>
      </div>
      <input type="file" id="file${id}" accept="image/*" onchange="handleImageSelect(${id}, this)">
    </td>
    <td><input type="text" placeholder="ชื่อสินค้า / รายละเอียด" value="${esc(data.desc || '')}" style="min-width:180px"></td>
    <td><input type="number" class="num" placeholder="1" value="${data.qty || 1}" min="0" step="any" oninput="calcRow(this)" style="width:55px"></td>
    <td><input type="text" placeholder="ชิ้น" value="${esc(data.unit || 'ชิ้น')}" style="width:55px;text-align:center"></td>
    <td><input type="number" class="num" placeholder="0.00" value="${data.price || ''}" min="0" step="any" oninput="calcRow(this)"></td>
    <td class="line-total" id="lt${id}">0.00</td>
    <td><button class="del-btn" onclick="deleteRow(this)" title="ลบรายการ">✕</button></td>
  `;
  tbody.appendChild(tr);
  calcRow(tr.querySelector('input[type=number]'));
}

function esc(s) { return String(s).replace(/"/g, '&quot;'); }

function handleImageSelect(id, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('กรุณาเลือกไฟล์รูปภาพ', 'err');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    const img = new Image();
    img.onload = () => {
      itemImages[id] = { dataUrl, naturalW: img.naturalWidth, naturalH: img.naturalHeight };
      const thumb = document.getElementById(`thumb${id}`);
      thumb.innerHTML = `
        <img src="${dataUrl}">
        <span class="rm-img" onclick="event.stopPropagation(); removeImage(${id})">✕</span>
      `;
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

function removeImage(id) {
  delete itemImages[id];
  const thumb = document.getElementById(`thumb${id}`);
  if (thumb) thumb.innerHTML = '<span class="placeholder">🖼</span>';
  document.getElementById(`file${id}`).value = '';
}

function calcRow(input) {
  const tr = input.closest('tr');
  const nums = tr.querySelectorAll('input[type=number]');
  const qty   = parseFloat(nums[0].value) || 0;
  const price = parseFloat(nums[1].value) || 0;
  const amt   = qty * price;
  tr.querySelector('[id^=lt]').textContent = fmtNum(amt);
  recalcTotals();
}

function recalcTotals() {
  let sub = 0;
  document.querySelectorAll('[id^=lt]').forEach(el => { sub += parseFloat(el.textContent.replace(/,/g, '')) || 0; });
  const vat   = sub * 0.07;
  const total = sub + vat;
  document.getElementById('subtotal').textContent   = fmtNum(sub);
  document.getElementById('vatAmt').textContent      = fmtNum(vat);
  document.getElementById('grandTotal').textContent  = fmtNum(total);
}

function fmtNum(n) { return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function deleteRow(btn) {
  const tr = btn.closest('tr');
  const id = tr.dataset.itemId;
  delete itemImages[id];
  tr.remove();
  renumberRows();
  recalcTotals();
}

function renumberRows() {
  document.querySelectorAll('#itemsBody tr').forEach((tr, i) => { tr.cells[0].textContent = i + 1; });
}

function resetForm() {
  if (!confirm('ล้างข้อมูลทั้งหมดและเริ่มใหม่?')) return;
  ['seqInput','buyerName','buyerAddress','buyerTaxId','buyerCredit','buyerEmail','buyerPhone','juristicId','notes']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('dbdStatus').className = 'dbd-status wait';
  document.getElementById('dbdStatus').textContent = 'กรอกเลขนิติบุคคล 13 หลักแล้วกด ดึงข้อมูล';
  document.getElementById('itemsBody').innerHTML = '';
  Object.keys(itemImages).forEach(k => delete itemImages[k]);
  itemCounter = 0;
  addItemRow(); addItemRow();
  recalcTotals();
  document.getElementById('quoteDate').value = isoDate(new Date());
  updateQuoteNo();
  recalcValidUntil(15);
}

// ── UI helpers ────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = '', 4500);
}
function showOverlay(msg) { document.getElementById('overlay-msg').textContent = msg; document.getElementById('overlay').classList.add('show'); }
function hideOverlay() { document.getElementById('overlay').classList.remove('show'); }

// ════════════════════════════════════════════════════════════════════════════
// PDF GENERATION — pdf-lib + fontkit, real Sarabun font embedded at runtime
// ════════════════════════════════════════════════════════════════════════════

let cachedFonts = null;

// Last-known-good pinned URL for the regular weight only, confirmed reachable
// at the time this was written. Used purely as a final safety net if the
// CSS endpoint itself cannot be reached (e.g. fonts.googleapis.com blocked
// by a network policy). We deliberately do NOT pin a "bold" hash here: Google
// rotates these per-weight file hashes independently and unpredictably, so a
// guessed bold URL is more likely to 404 than to help. If bold can't be
// resolved from the CSS, we reuse the regular font file for bold text instead
// (slightly less visual weight, but guaranteed to render rather than fail).
const FONT_URL_REGULAR_FALLBACK = 'https://fonts.gstatic.com/s/sarabun/v17/DtVjJx26TKEr37c9WBI.ttf';

/**
 * Resolve the current Sarabun regular + bold .ttf URLs by fetching Google's
 * CSS endpoint and parsing the @font-face src declarations. This avoids
 * hardcoding a fonts.gstatic.com hash that Google may rotate when the font
 * is rebuilt (confirmed to happen — e.g. v15 became v17 during development
 * of this app).
 */
async function resolveFontUrls() {
  let regular = null, bold = null;

  try {
    const cssResp = await fetch(GOOGLE_FONTS_CSS_URL);
    if (!cssResp.ok) throw new Error(`CSS HTTP ${cssResp.status}`);
    const css = await cssResp.text();

    // Each @font-face block looks like:
    //   font-weight: 400; ... src: url(https://fonts.gstatic.com/.../X.ttf)
    const blocks = css.split('@font-face').slice(1);
    for (const block of blocks) {
      const weightMatch = block.match(/font-weight:\s*(\d+)/);
      const urlMatch = block.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/);
      if (weightMatch && urlMatch) {
        if (weightMatch[1] === '400' && !regular) regular = urlMatch[1];
        if (weightMatch[1] === '700' && !bold)    bold    = urlMatch[1];
      }
    }
  } catch (err) {
    console.warn('Could not fetch/parse Google Fonts CSS:', err.message);
  }

  if (!regular) regular = FONT_URL_REGULAR_FALLBACK;
  if (!bold)    bold    = regular; // reuse regular rather than risk a 404 on a guessed bold URL

  return { regular, bold };
}

async function loadFonts() {
  if (cachedFonts) return cachedFonts;

  const urls = await resolveFontUrls();
  const fetchTtf = async (url, label) => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`โหลดฟอนต์ ${label} ไม่สำเร็จ (HTTP ${resp.status})`);
    return resp.arrayBuffer();
  };

  const regBuf = await fetchTtf(urls.regular, 'Sarabun');
  // If bold resolved to the same URL as regular (fallback case), reuse the
  // already-downloaded bytes instead of fetching twice.
  const boldBuf = (urls.bold === urls.regular) ? regBuf : await fetchTtf(urls.bold, 'Sarabun Bold');

  cachedFonts = { regular: regBuf, bold: boldBuf };
  return cachedFonts;
}

async function exportPDF() {
  const items = collectItems();
  if (!items.length) { toast('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ', 'err'); return; }
  if (!document.getElementById('buyerName').value.trim()) {
    toast('กรุณากรอกชื่อลูกค้า', 'err');
    document.getElementById('buyerName').focus();
    return;
  }

  showOverlay('กำลังโหลดฟอนต์ Sarabun...');
  try {
    const fonts = await loadFonts();
    showOverlay('กำลังสร้างใบเสนอราคา PDF...');
    const pdfBytes = await buildPdf(fonts, items);

    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ใบเสนอราคา_${document.getElementById('quoteNo').value || 'quotation'}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    toast('✅ สร้าง PDF สำเร็จ!', 'ok');
  } catch (err) {
    console.error(err);
    toast('❌ สร้าง PDF ไม่สำเร็จ: ' + err.message, 'err');
  } finally {
    hideOverlay();
  }
}

function collectItems() {
  const rows = document.querySelectorAll('#itemsBody tr');
  const items = [];
  rows.forEach(tr => {
    const id = Number(tr.dataset.itemId);
    const txt = tr.querySelectorAll('input[type=text]');
    const num = tr.querySelectorAll('input[type=number]');
    const description = txt[0].value.trim();
    const unit = txt[1].value.trim();
    const qty = parseFloat(num[0].value) || 0;
    const price = parseFloat(num[1].value) || 0;
    if (!description && qty === 0 && price === 0) return; // skip fully-empty rows
    items.push({ description, unit, qty, price, image: itemImages[id] || null });
  });
  return items;
}

/**
 * Build the quotation PDF with pdf-lib, mirroring the ATIRUJ paper template:
 * letterhead, customer/doc-info box, items table, totals box, signature box.
 *
 * ── Why Thai text is drawn glyph-by-glyph instead of via page.drawText() ──
 * pdf-lib's drawText() maps each character to a glyph 1:1 and does not run
 * the string through the font's GPOS mark-attachment tables. For Thai this
 * causes floating/misplaced tone marks and vowel signs (this is a known,
 * tracked limitation of pdf-lib's text API). The fix is to call fontkit's
 * `font.layout(string)` directly — this performs real OpenType shaping
 * (GSUB/GPOS) and returns a GlyphRun with each glyph positioned correctly.
 * We then draw every glyph's vector outline with `page.drawSvgPath()` at
 * its shaped (x, y), so vowels/tone marks land exactly where the font
 * designer intended, with no floating marks or overlap.
 *
 * To keep the text selectable/copyable (so it never turns into "tofu" or
 * garbage when copy-pasted), we additionally draw an invisible text layer
 * with pdf-lib's normal embedFont()-backed drawText() at the same position
 * and opacity 0. This embeds a proper font resource with a ToUnicode CMap
 * for that invisible layer, so PDF viewers' text-selection / copy feature
 * extracts the correct Unicode string while the visible ink is the
 * separately-shaped glyph path.
 */
async function buildPdf(fonts, items) {
  const { PDFDocument, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fontRegular = await pdfDoc.embedFont(fonts.regular, { subset: true });
  const fontBold     = await pdfDoc.embedFont(fonts.bold, { subset: true });

  // Raw fontkit font objects (distinct from the pdf-lib wrapper above) —
  // these expose .layout(), which performs the actual OpenType shaping
  // needed for correct Thai vowel/tone-mark placement.
  const fkRegular = fontkit.create(new Uint8Array(fonts.regular));
  const fkBold    = fontkit.create(new Uint8Array(fonts.bold));

  const PAGE_W = 595.28; // A4
  const PAGE_H = 841.89;
  const MARGIN = 40;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const NAVY  = rgb(0x0F/255, 0x2D/255, 0x5E/255);
  const BLUE  = rgb(0x1A/255, 0x56/255, 0xA0/255);
  const GRAY  = rgb(0x55/255, 0x55/255, 0x55/255);
  const LINEC = rgb(0xD8/255, 0xDE/255, 0xE6/255);
  const LIGHT = rgb(0xEB/255, 0xF3/255, 0xFF/255);
  const INK   = rgb(0x1F/255, 0x29/255, 0x37/255);
  const WHITE = rgb(1, 1, 1);

  /** Measure shaped width of a string at a given size (in points). */
  function shapedWidth(str, fkFont, size) {
    if (!str) return 0;
    const run = fkFont.layout(str);
    const unitsPerEm = fkFont.unitsPerEm || 1000;
    const scale = size / unitsPerEm;
    return run.positions.reduce((sum, p) => sum + p.xAdvance, 0) * scale;
  }

  /**
   * Draw a string using real OpenType shaping (correct Thai vowel/tone-mark
   * placement), plus an invisible copyable text layer for selection/copy.
   *
   * IMPORTANT — glyph path orientation: fontkit's glyph.path is expressed in
   * font units with a y-up coordinate convention (matching TrueType/OpenType
   * glyph space and PDF's own y-up page space). However, glyph.path.toSVG()
   * emits standard SVG path syntax, which is y-down by convention. Without
   * flipping, every glyph would render upside-down. We flip with
   * `.scale(1, -1)` before serializing to SVG, exactly as shown in fontkit's
   * own usage example for converting a GlyphRun to SVG path data.
   */
  function drawShaped(str, x, yBaseline, opts = {}) {
    const { size = 10, bold = false, color = INK } = opts;
    if (!str) return 0;

    const fkFont  = bold ? fkBold : fkRegular;
    const pdfFont = bold ? fontBold : fontRegular;
    const unitsPerEm = fkFont.unitsPerEm || 1000;
    const scale = size / unitsPerEm;

    const run = fkFont.layout(str);
    let penX = x, penY = yBaseline;

    run.glyphs.forEach((glyph, i) => {
      const pos = run.positions[i];
      if (glyph.path && glyph.path.toSVG) {
        const flipped = glyph.path.scale(1, -1);
        const svgPath = flipped.toSVG();
        if (svgPath) {
          page.drawSvgPath(svgPath, {
            x: penX + pos.xOffset * scale,
            y: penY + pos.yOffset * scale,
            scale,
            color,
            borderWidth: 0,
          });
        }
      }
      penX += pos.xAdvance * scale;
      penY += pos.yAdvance * scale;
    });

    // Invisible copy/select layer — paints with opacity 0 but keeps the
    // Unicode string + ToUnicode mapping in the content stream.
    page.drawText(str, { x, y: yBaseline, size, font: pdfFont, color, opacity: 0 });


    return run.positions.reduce((sum, p) => sum + p.xAdvance, 0) * scale;
  }

  function text(str, x, yPos, opts = {}) {
    const { size = 10, font = fontRegular, color = INK, align = 'left', maxWidth, bold } = opts;
    const isBold = bold || font === fontBold;
    const fkFont = isBold ? fkBold : fkRegular;
    const w = shapedWidth(str, fkFont, size);

    let drawX = x;
    if (align !== 'left' && maxWidth !== undefined) {
      if (align === 'right') drawX = x + maxWidth - w;
      if (align === 'center') drawX = x + (maxWidth - w) / 2;
    }
    drawShaped(str, drawX, yPos, { size, bold: isBold, color });
    return w;
  }

  function rect(x, yTop, w, h, opts = {}) {
    page.drawRectangle({
      x, y: yTop - h, width: w, height: h,
      color: opts.fill, borderColor: opts.border, borderWidth: opts.borderWidth ?? 0,
    });
  }

  function line(x1, yPos, x2) {
    page.drawLine({ start: { x: x1, y: yPos }, end: { x: x2, y: yPos }, thickness: 0.75, color: LINEC });
  }

  /** Draw a vertical line starting at (x, yTop) going down by h points. */
  function vline(x, yTop, h) {
    page.drawLine({ start: { x, y: yTop }, end: { x, y: yTop - h }, thickness: 0.75, color: LINEC });
  }

  /** Wrap text to fit maxWidth; returns array of lines. */
  function wrapText(str, font, size, maxWidth) {
    if (!str) return [''];
    const words = str.split(/(\s+)/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur + w;
      if (font.widthOfTextAtSize(test, size) > maxWidth && cur) {
        lines.push(cur.trimEnd());
        cur = w.trimStart();
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur.trimEnd());
    return lines.length ? lines : [''];
  }

  // ── Letterhead ──
  // Simple geometric "building" logo mark, drawn with vector shapes (no external image).
  const logoX = MARGIN, logoY = y;
  page.drawRectangle({ x: logoX, y: logoY - 34, width: 64, height: 8, color: NAVY });
  for (let i = 0; i < 5; i++) {
    const bw = 8, gap = 3.5, bx = logoX + 4 + i * (bw + gap);
    const bh = 14 + (i % 2 === 0 ? 8 : 4);
    page.drawRectangle({ x: bx, y: logoY - 34 + 8, width: bw, height: bh, color: NAVY });
  }

  let hx = MARGIN + 78;
  const seller = collectSeller();
  text(seller.name || 'บริษัท อติรุจ จำกัด', hx, y - 10, { size: 13, font: fontBold, color: NAVY });
  text('ATIRUJ CO.,LTD.', hx, y - 24, { size: 9, font: fontRegular, color: GRAY });

  const lineInfo = [
    seller.address,
    `TAX ID: ${formatTaxId(seller.taxId)}     โทร: ${seller.phone}`,
    seller.email,
  ];
  let infoY = y - 10;
  text(lineInfo[0], hx + 150, infoY, { size: 8, color: GRAY });
  infoY -= 11;
  text(lineInfo[1], hx + 150, infoY, { size: 8, color: GRAY });
  infoY -= 11;
  text(lineInfo[2], hx + 150, infoY, { size: 8, color: GRAY });

  y -= 50;
  line(MARGIN, y, PAGE_W - MARGIN);
  y -= 22;

  // ── Title ──
  text('ใบเสนอราคา', MARGIN, y, { size: 20, font: fontBold, color: NAVY, align: 'center', maxWidth: CONTENT_W });
  y -= 18;
  text('QUOTATION', MARGIN, y, { size: 11, font: fontRegular, color: GRAY, align: 'center', maxWidth: CONTENT_W });
  y -= 22;

  // ── Customer / Doc-info two-box row ──
  const boxH = 92;
  const leftW = CONTENT_W * 0.62;
  const rightW = CONTENT_W - leftW - 8;
  const rightX = MARGIN + leftW + 8;

  rect(MARGIN, y, leftW, boxH, { border: LINEC, borderWidth: 1 });
  rect(rightX, y, rightW, boxH, { border: LINEC, borderWidth: 1 });

  const buyer = collectBuyer();
  let cy = y - 13;
  text('ชื่อลูกค้า / Customer', MARGIN + 8, cy, { size: 9, font: fontBold, color: INK });
  cy -= 12;
  wrapText(buyer.name || '-', fontRegular, 9.5, leftW - 16).slice(0, 1).forEach(ln => {
    text(ln, MARGIN + 8, cy, { size: 9.5, color: INK }); cy -= 11;
  });
  text('ที่อยู่ / Address', MARGIN + 8, cy, { size: 9, font: fontBold, color: INK });
  cy -= 12;
  wrapText(buyer.address || '-', fontRegular, 9, leftW - 16).slice(0, 2).forEach(ln => {
    text(ln, MARGIN + 8, cy, { size: 9, color: GRAY }); cy -= 10.5;
  });
  cy -= 2;
  text(`เลขประจำตัวผู้เสียภาษี: ${buyer.taxId || '-'}`, MARGIN + 8, cy, { size: 9, color: GRAY });
  cy -= 12;
  text(`อีเมล: ${buyer.email || '-'}     โทร: ${buyer.phone || '-'}`, MARGIN + 8, cy, { size: 9, color: GRAY });

  let ry = y - 13;
  const metaRow = (label, val) => {
    text(label, rightX + 8, ry, { size: 9, font: fontBold, color: INK });
    text(val || '-', rightX + 8, ry - 11, { size: 9.5, color: INK });
    ry -= 25;
  };
  metaRow('เลขที่ / No.', document.getElementById('quoteNo').value);
  metaRow('วันที่ / Date', formatDateThai(document.getElementById('quoteDate').value));
  metaRow('ยืนราคาถึง / Valid Until', formatDateThai(document.getElementById('validUntil').value));

  y -= boxH + 16;

  // ── Items table ──
  const hasImg = items.some(it => it.image);
  const cols = hasImg
    ? [
        { key: 'no',    label: 'ลำดับ',    w: 26,  align: 'center' },
        { key: 'img',   label: 'รูป',       w: 40,  align: 'center' },
        { key: 'desc',  label: 'รายละเอียด', w: CONTENT_W - 26 - 40 - 40 - 40 - 70 - 80, align: 'left'   },
        { key: 'qty',   label: 'จำนวน',     w: 40,  align: 'center' },
        { key: 'unit',  label: 'หน่วย',     w: 40,  align: 'center' },
        { key: 'price', label: 'ราคา/หน่วย', w: 70,  align: 'right'  },
        { key: 'amt',   label: 'จำนวนเงิน', w: 80,  align: 'right'  },
      ]
    : [
        { key: 'no',    label: 'ลำดับ',    w: 30,  align: 'center' },
        { key: 'desc',  label: 'รายละเอียด', w: CONTENT_W - 30 - 50 - 50 - 80 - 90, align: 'left'   },
        { key: 'qty',   label: 'จำนวน',     w: 50,  align: 'center' },
        { key: 'unit',  label: 'หน่วย',     w: 50,  align: 'center' },
        { key: 'price', label: 'ราคา/หน่วย', w: 80,  align: 'right'  },
        { key: 'amt',   label: 'จำนวนเงิน', w: 90,  align: 'right'  },
      ];

  function colX(idx) { return MARGIN + cols.slice(0, idx).reduce((s, c) => s + c.w, 0); }

  // Header row
  const headerH = 22;
  rect(MARGIN, y, CONTENT_W, headerH, { fill: NAVY });
  cols.forEach((c, i) => {
    text(c.label, colX(i) + 5, y - 15, { size: 9, font: fontBold, color: WHITE, align: c.align, maxWidth: c.w - 10 });
  });
  y -= headerH;

  let subtotal = 0;
  for (const item of items) {
    const amt = item.qty * item.price;
    subtotal += amt;

    const descLines = wrapText(item.description || '-', fontRegular, 9, cols.find(c => c.key === 'desc').w - 10);
    let rowH = Math.max(22, descLines.length * 11 + 8);

    let imgDrawH = 0, imgDrawW = 0;
    if (hasImg && item.image) {
      const maxBox = 34;
      const ratio = item.image.naturalW / item.image.naturalH;
      if (ratio >= 1) { imgDrawW = maxBox; imgDrawH = maxBox / ratio; }
      else            { imgDrawH = maxBox; imgDrawW = maxBox * ratio; }
      rowH = Math.max(rowH, imgDrawH + 8);
    }

    // page-break check
    if (y - rowH < MARGIN + 140) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      rect(MARGIN, y, CONTENT_W, headerH, { fill: NAVY });
      cols.forEach((c, i) => {
        text(c.label, colX(i) + 5, y - 15, { size: 9, font: fontBold, color: WHITE, align: c.align, maxWidth: c.w - 10 });
      });
      y -= headerH;
    }

    rect(MARGIN, y, CONTENT_W, rowH, { border: LINEC, borderWidth: 0.75 });
    cols.forEach((_, i) => { if (i > 0) vline(colX(i), y, rowH); });

    const rowTop = y;
    cols.forEach((c, i) => {
      const cx = colX(i) + 5;
      const cw = c.w - 10;
      if (c.key === 'no') {
        text(String(items.indexOf(item) + 1), colX(i), rowTop - rowH / 2 - 3, { size: 9, align: 'center', maxWidth: c.w });
      } else if (c.key === 'img') {
        // Product image is embedded separately below (embedPng/embedJpg is
        // async and must run outside this synchronous per-column loop).
      } else if (c.key === 'desc') {
        let dy = rowTop - 12;
        descLines.forEach(ln => { text(ln, cx, dy, { size: 9, maxWidth: cw }); dy -= 11; });
      } else if (c.key === 'qty') {
        text(fmtNum(item.qty).replace(/\.00$/, ''), colX(i), rowTop - rowH / 2 - 3, { size: 9, align: 'center', maxWidth: c.w });
      } else if (c.key === 'unit') {
        text(item.unit || '-', colX(i), rowTop - rowH / 2 - 3, { size: 9, align: 'center', maxWidth: c.w });
      } else if (c.key === 'price') {
        text(fmtNum(item.price), colX(i), rowTop - rowH / 2 - 3, { size: 9, align: 'right', maxWidth: c.w });
      } else if (c.key === 'amt') {
        text(fmtNum(amt), colX(i), rowTop - rowH / 2 - 3, { size: 9, font: fontBold, color: BLUE, align: 'right', maxWidth: c.w });
      }
    });

    // Embed product image (PNG/JPEG) preserving aspect ratio, centered in its cell
    if (hasImg && item.image) {
      try {
        const isPng = item.image.dataUrl.startsWith('data:image/png');
        const bytes = dataUrlToBytes(item.image.dataUrl);
        const img = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
        const imgColIdx = cols.findIndex(c => c.key === 'img');
        const cellX = colX(imgColIdx);
        const cellW = cols[imgColIdx].w;
        const drawX = cellX + (cellW - imgDrawW) / 2;
        const drawY = rowTop - rowH / 2 - imgDrawH / 2;
        page.drawImage(img, { x: drawX, y: drawY, width: imgDrawW, height: imgDrawH });
      } catch (e) {
        console.warn('Image embed failed for item', item.description, e);
      }
    }

    y -= rowH;
  }

  y -= 6;

  // ── Totals box (right-aligned, matches paper template's bottom-right boxes) ──
  const totalsW = 220;
  const totalsX = PAGE_W - MARGIN - totalsW;
  const vat = subtotal * 0.07;
  const grand = subtotal + vat;

  const totalRows = [
    { label: 'รวมเป็นเงิน / Subtotal', val: fmtNum(subtotal), bold: false },
    { label: 'ภาษีมูลค่าเพิ่ม / VAT 7%', val: fmtNum(vat), bold: false },
    { label: 'จำนวนเงินรวมทั้งสิ้น / Total', val: fmtNum(grand) + ' บาท', bold: true },
  ];
  const trH = 20;
  totalRows.forEach((row, i) => {
    const isLast = i === totalRows.length - 1;
    rect(totalsX, y, totalsW, trH, { fill: isLast ? LIGHT : WHITE, border: LINEC, borderWidth: 0.75 });
    text(row.label, totalsX + 8, y - 13.5, { size: isLast ? 9.5 : 9, font: isLast ? fontBold : fontRegular, color: isLast ? BLUE : GRAY });
    text(row.val, totalsX, y - 13.5, { size: isLast ? 10.5 : 9.5, font: isLast ? fontBold : fontRegular, color: isLast ? BLUE : INK, align: 'right', maxWidth: totalsW - 8 });
    y -= trH;
  });

  y -= 18;

  // ── Notes ──
  const notes = document.getElementById('notes').value.trim();
  if (notes) {
    text('หมายเหตุ / Remark', MARGIN, y, { size: 9.5, font: fontBold, color: NAVY });
    y -= 13;
    wrapText(notes, fontRegular, 9, CONTENT_W).forEach(ln => { text(ln, MARGIN, y, { size: 9, color: GRAY }); y -= 11; });
    y -= 6;
  }

  // page-break check before signature block
  if (y < MARGIN + 90) {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }

  // ── Signature block ──
  const sigW = (CONTENT_W - 16) / 2;
  const sigH = 78;
  [MARGIN, MARGIN + sigW + 16].forEach((sx, idx) => {
    rect(sx, y, sigW, sigH, { border: LINEC, borderWidth: 1 });
    const dots = '.'.repeat(40);
    text(dots, sx, y - 36, { size: 9, color: GRAY, align: 'center', maxWidth: sigW });
    const nameLabel = idx === 0 ? `(${buyer.name || '...........................'})` : `(${seller.name})`;
    text(nameLabel, sx, y - 50, { size: 9, color: INK, align: 'center', maxWidth: sigW });
    const roleLabel = idx === 0 ? 'ผู้อนุมัติสั่งซื้อ / Customer Signature' : 'ผู้มีอำนาจลงนาม / Authorized Signature';
    text(roleLabel, sx, y - 64, { size: 9, font: fontBold, color: INK, align: 'center', maxWidth: sigW });
    text('วันที่/Date ........................', sx, y - 74, { size: 8.5, color: GRAY, align: 'center', maxWidth: sigW });
  });

  return pdfDoc.save();
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function collectSeller() {
  return {
    name:    document.getElementById('sellerName').value.trim(),
    address: document.getElementById('sellerAddress').value.trim(),
    taxId:   document.getElementById('sellerTaxId').value.trim(),
    phone:   document.getElementById('sellerPhone').value.trim(),
    email:   document.getElementById('sellerEmail').value.trim(),
  };
}
function collectBuyer() {
  return {
    name:    document.getElementById('buyerName').value.trim(),
    address: document.getElementById('buyerAddress').value.trim(),
    taxId:   document.getElementById('buyerTaxId').value.trim(),
    email:   document.getElementById('buyerEmail').value.trim(),
    phone:   document.getElementById('buyerPhone').value.trim(),
  };
}

function formatTaxId(id) {
  if (!id || id.length !== 13) return id || '-';
  return `${id[0]} ${id.slice(1,5)} ${id.slice(5,10)} ${id.slice(10,12)} ${id[12]}`;
}

function formatDateThai(isoStr) {
  if (!isoStr) return '-';
  const [y, m, d] = isoStr.split('-').map(Number);
  const months = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${d} ${months[m]} ${y + 543}`;
}
