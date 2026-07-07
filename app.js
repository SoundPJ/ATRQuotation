/* ════════════════════════════════════════════════════════════════════════
   ATIRUJ Quotation Generator — 100% client-side
   - Password Gate with Client-Side Hashing Protection
   - Default 3 Companies + Custom DBD Issuer Autofill
   - Thai Text Normalization to fix decomposed "สระอำ" (ตำบล -> ตำาบล) when copying
   ════════════════════════════════════════════════════════════════════════ */

const DBD_API_BASE   = 'https://openapi.dbd.go.th/api/v1/juristic_person/';
const GOOGLE_FONTS_CSS_URL = 'fonts/THSarabunNew.ttf';

let itemCounter = 0;
const itemImages  = {}; // itemId -> { dataUrl, naturalW, naturalH }

// ข้อมูล 3 บริษัทเริ่มต้น (Default Issuers)
const DEFAULT_ISSUERS = [
  {
    name: "บริษัท อติรุจ จำกัด",
    address: "สำนักงานใหญ่: 1486 หมู่7 ถ.เทพารักษ์ ต.เทพารักษ์ อ.เมืองสมุทรปราการ จ.สมุทรปราการ 10270",
    taxId: "0115538001694",
    phone: "02-759-6861, 087-689-4080",
    email: "atiruj.co@gmail.com | Line ID: atiruj.co",
    logo: "data/ATRlogo.png"
  },
  {
    name: "บริษัท เซฟแมสก์ จำกัด",
    address: "สำนักงานใหญ่: 1486 หมู่7 ถ.เทพารักษ์ ต.เทพารักษ์ อ.เมืองสมุทรปราการ จ.สมุทรปราการ 10270",
    taxId: "0115563015407",
    phone: "02-759-6861, 087-689-4080",
    email: "safemask.corp@gmail.com | Line ID: atiruj.co",
    logo: "data/SMlogo.png"
  },
  {
    name: "บริษัท อติรุจ อินโนเวชั่น จำกัด",
    address: "สำนักงานใหญ่: 1486 หมู่7 ถ.เทพารักษ์ ต.เทพารักษ์ อ.เมืองสมุทรปราการ จ.สมุทรปราการ 10270",
    taxId: "0115561023941",
    phone: "02-759-6861, 087-689-4080",
    email: "atiruj.innovation@gmail.com",
    logo: "data/AIlogo.png"
  }
];

// ── Password Gate Verification ───────────────────────────────────────────────
// แฮช SHA-256 ของรหัสผ่าน "000999" (คำนวณไว้ล่วงหน้าเพื่อใช้ตรวจเช็กโดยไม่ต้องโชว์รหัสดิบ)
const TARGET_PASS_HASH = "7a6a7bdfdc75d493c1893ae45b8e74a6f1ef5fad27e63e01e142fc75cc2bbcd5";

function checkGatePassword() {
  const input = document.getElementById('gatePassInput').value;
  const errEl = document.getElementById('gateErr');
  
  // แปลงค่าที่กรอกเป็น SHA-256 Hash เพื่อนำไปตรวจสอบความถูกต้อง
  const inputHash = CryptoJS.SHA256(input).toString(CryptoJS.enc.Hex);
  
  if (inputHash === TARGET_PASS_HASH) {
  document.getElementById('passGate').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';
  // รันกระบวนการตั้งค่าเริ่มต้นของแอปพลิเคชัน
  initAppLogic();
  } else {
  errEl.textContent = "❌ รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง";
  document.getElementById('gatePassInput').value = '';
  document.getElementById('gatePassInput').focus();
  }
}

// ── Init App ─────────────────────────────────────────────────────────────────
function initAppLogic() {
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
  if (document.getElementById('itemsBody').children.length === 0) addItemRow();
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

// ── Handle Issuer Selection Change ───────────────────────────────────────────
function handleIssuerChange() {
  const selectedRadio = document.querySelector('input[name="issuerSelect"]:checked').value;
  const sellerDbdBox = document.getElementById('sellerDbdBox');
  
  if (selectedRadio === 'custom') {
    sellerDbdBox.classList.add('show');
    // เคลียร์ค่าผู้ขายชั่วคราวให้กรอกใหม่
    document.getElementById('sellerName').value = '';
    document.getElementById('sellerAddress').value = '';
    document.getElementById('sellerTaxId').value = '';
    document.getElementById('sellerPhone').value = '';
    document.getElementById('sellerEmail').value = '';
  } else {
    sellerDbdBox.classList.remove('show');
    const idx = parseInt(selectedRadio, 10);
    const data = DEFAULT_ISSUERS[idx];
    if (data) {
      document.getElementById('sellerName').value = data.name;
      document.getElementById('sellerAddress').value = data.address;
      document.getElementById('sellerTaxId').value = data.taxId;
      document.getElementById('sellerPhone').value = data.phone;
      document.getElementById('sellerEmail').value = data.email;
    }
  }
}

// ── Fetch DBD for Custom Seller ──────────────────────────────────────────────
async function fetchDBDForSeller() {
  const jid = document.getElementById('sellerJuristicId').value.trim();
  const statusEl = document.getElementById('sellerDbdStatus');
  const btn = document.getElementById('sellerDbdBtn');

  if (jid.length !== 13) {
    statusEl.className = 'dbd-status err';
    statusEl.textContent = '❌ กรุณากรอกเลขผู้ขายให้ครบ 13 หลัก';
    return;
  }

  statusEl.className = 'dbd-status wait';
  statusEl.textContent = '⏳ กำลังดึงข้อมูลผู้ขายจาก DBD...';
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
    throw fetchErr;
  }

  const info = parseDbdResponse(raw);
  if (info.error) throw new Error(info.error);

  // document.getElementById('sellerName').value  = info.nameTh || info.nameEn || '';
  document.getElementById('sellerName').value = info.nameTh+' (สำนักงานใหญ่)';
  document.getElementById('sellerAddress').value = info.address || '';
  document.getElementById('sellerTaxId').value   = jid;

  statusEl.className = 'dbd-status ok';
  statusEl.textContent = `✅ ดึงข้อมูลสำเร็จ: ${info.nameTh || info.nameEn}`;

  } catch (err) {
    statusEl.className = 'dbd-status err';
    if (String(err.message).includes('Failed to fetch') || err.name === 'TypeError') {
      statusEl.textContent = '❌ ติด CORS Policy ลองเปิด "ตั้งค่า CORS Proxy" ด้านล่าง';
    } else {
      statusEl.textContent = '❌ ' + err.message;
    }
  } finally {
    btn.disabled = false;
  }
}

// ── Quote number sequence generator ──────────────────────────────────────────
function updateQuoteNo() {
  const dateVal = document.getElementById('quoteDate').value;
  const seqRaw  = document.getElementById('seqInput').value.trim();
  if (!dateVal || !seqRaw) {
  document.getElementById('quoteNo').value = '';
  return;
  }
  const d = new Date(dateVal + 'T00:00:00');
  const yy = String((d.getFullYear() + 543) % 100).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const seq = String(parseInt(seqRaw, 10) || 0).padStart(2, '0');
  document.getElementById('quoteNo').value = `Q${yy}${mm}-${seq}`;
}

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

// ── DBD Customer Lookup ──────────────────────────────────────────────────────
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
    throw fetchErr;
  }

  const info = parseDbdResponse(raw);
  if (info.error) throw new Error(info.error);

  // document.getElementById('buyerName').value = info.nameTh || info.nameEn || '';
  document.getElementById('buyerName').value  = info.nameTh+' (สำนักงานใหญ่)';
  document.getElementById('buyerAddress').value = info.address || '';
  document.getElementById('buyerTaxId').value   = jid;

  statusEl.className = 'dbd-status ok';
  const cap = info.capital ? `  |  ทุนจดทะเบียน: ${Number(info.capital).toLocaleString()} บาท` : '';
  const sta = info.status  ? `  |  สถานะ: ${info.status}` : '';
  statusEl.textContent = `✅ ${info.nameTh || info.nameEn}${sta}${cap}`;

  } catch (err) {
  statusEl.className = 'dbd-status err';
  if (String(err.message).includes('Failed to fetch') || err.name === 'TypeError') {
    statusEl.textContent = '❌ เชื่อมต่อ DBD ไม่ได้ — อาจติด CORS Policy ลองเปิด "ตั้งค่า CORS Proxy" ด้านบน';
  } else {
    statusEl.textContent = '❌ ' + err.message;
  }
  } finally {
  btn.disabled = false;
  }
}

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

  if (!nameTh && !nameEn) return { error: 'พบข้อมูลแต่ไม่มีชื่อบริษัท' };

  return { nameTh, nameEn, address, status, capital: String(capital) };
}

function buildDbdAddress(row) {
  const addrWrap = row['cd:OrganizationJuristicAddress'];
  const a = addrWrap && addrWrap['cr:AddressType'];
  if (!a) return '';
  let province = a['cd:CountrySubDivision']['cr:CountrySubDivisionTextTH'];
  let subdistrict, district;
  if (province == "กรุงเทพมหานคร") {
  subdistrict = 'แขวง'+a['cd:CitySubDivision']['cr:CitySubDivisionTextTH'];
  district = a['cd:City']['cr:CityTextTH'];
  }
  else {
  province = 'จังหวัด'+province;
  subdistrict = 'ตำบล'+a['cd:CitySubDivision']['cr:CitySubDivisionTextTH'];
  district = 'อำเภอ'+a['cd:City']['cr:CityTextTH'];
  }
  return a["cd:Address"]+' '+subdistrict+' '+district+' '+province;
}

// ── Items Table Operations ───────────────────────────────────────────────────
function addItemRow(data = {}) {
  itemCounter++;
  const id = itemCounter;
  const tbody = document.getElementById('itemsBody');
  const tr = document.createElement('tr');
  tr.className = 'irow';
  tr.dataset.itemId = id;

  // <td><input type="text" placeholder="ชื่อสินค้า / รายละเอียด" value="${esc(data.desc || '')}" style="min-width:180px"></td>
  tr.innerHTML = `
  <td style="text-align:center;color:var(--gray);font-size:12.5px;">${tbody.children.length + 1}</td>
  <td class="img-cell">
    <div class="img-thumb-wrap" onclick="document.getElementById('file${id}').click()" id="thumb${id}">
    <span class="placeholder">🖼</span>
    </div>
    <input type="file" id="file${id}" accept="image/*" onchange="handleImageSelect(${id}, this)">
  </td>
  <td><textarea placeholder="ชื่อสินค้า / รายละเอียด" style="font-family: 'Sarabun', sans-serif; min-width:350px; resize:vertical;">${esc(data.desc || '')}</textarea></td>
  <td><input type="text" class="num" placeholder="1" value="1" min="0" step="any" oninput="formatInputComma(this)" style="width:55px background:#fff;"></td>
  <td><input type="text" placeholder="ชิ้น" value="ชิ้น" style="width:55px;text-align:center"></td>
  
  <td><input type="text" class="num" placeholder="0.00" value="${data.price ? fmtNum(data.price) : ''}" oninput="formatInputComma(this)"></td>
  
  <td class="line-total" id="lt${id}">0.00</td>
  <td><button class="del-btn" onclick="deleteRow(this)" title="ลบรายการ">✕</button></td>
  `;
  tbody.appendChild(tr);
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
  const nums = tr.querySelectorAll('input');
  const qtyRaw = nums[1].value.replace(/,/g, '');
  const qty = parseFloat(qtyRaw) || 0;
  const priceRaw = nums[3].value.replace(/,/g, '');
  const price = parseFloat(priceRaw) || 0;
  
  const amt = qty * price;
  tr.querySelector('[id^=lt]').textContent = fmtNum(amt);
  recalcTotals();
}

function recalcTotals() {
  let sub = 0;
  document.querySelectorAll('[id^=lt]').forEach(el => { sub += parseFloat(el.textContent.replace(/,/g, '')) || 0; });
  const vat   = sub * 0.07;
  const total = sub + vat;
  document.getElementById('subtotal').textContent   = fmtNum(sub);
  document.getElementById('vatAmt').textContent   = fmtNum(vat);
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
  ['seqInput','buyerName','buyerAddress','buyerTaxId','buyerCredit','buyerEmail','buyerPhone','juristicId','notes','sellerJuristicId']
  .forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  document.getElementById('dbdStatus').className = 'dbd-status wait';
  document.getElementById('dbdStatus').textContent = 'กรอกเลขนิติบุคคล 13 หลักแล้วกด ดึงข้อมูล';
  document.getElementById('sellerDbdStatus').className = 'dbd-status wait';
  document.getElementById('sellerDbdStatus').textContent = 'กรอกเลข 13 หลักแล้วกดดึงข้อมูล';
  document.getElementById('itemsBody').innerHTML = '';
  Object.keys(itemImages).forEach(k => delete itemImages[k]);
  itemCounter = 0;
  addItemRow();
  recalcTotals();
  document.getElementById('quoteDate').value = isoDate(new Date());
  
  // รีเซ็ตตัวเลือกผู้ขายกลับไปเป็นบริษัทแรก
  document.getElementsByName('issuerSelect')[0].checked = true;
  handleIssuerChange();
  
  updateQuoteNo();
  recalcValidUntil(15);
}

// ── UI Helpers ───────────────────────────────────────────────────────────────
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
// PDF GENERATION — Thai Text Normalization & pdf-lib Core Engine
// ════════════════════════════════════════════════════════════════════════════
function normalizeThaiText(str) {
  if (!str) return '';
  // 1. จัดการกรณีมีวรรณยุกต์ตามด้วยสระอำ ให้เปลี่ยนเป็น: นฤคหิต + วรรณยุกต์ + สระอา
  // [\u0E48-\u0E4B] คือ วรรณยุกต์ เอก โท ตรี จัตวา
  str = str.replace(/([\u0E48-\u0E4B])\u0E33/g, '\u0E4D$1\u0E32');
  // 2. จัดการกรณีสระอำเดี่ยวๆ ที่ไม่มีวรรณยุกต์ ให้เปลี่ยนเป็น: นฤคหิต + สระอา
  str = str.replace(/\u0E33/g, '\u0E4D\u0E32');
  return str;
}

let cachedFonts = null;
// const FONT_URL_REGULAR_FALLBACK = 'https://fonts.gstatic.com/s/sarabun/v17/DtVjJx26TKEr37c9WBI.ttf';

async function resolveFontUrls() {
  let regular = 'fonts/THSarabunNew.ttf';
  let bold = 'fonts/THSarabunNew Bold.ttf';
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

function formatInputComma(input) {
  let pasteValue = input.value.replace(/[^0-9.]/g, '');
  const points = pasteValue.split('.');
  if (points.length > 2) {
    pasteValue = points[0] + '.' + points.slice(1).join('');
  }
  let parts = pasteValue.split('.');
  let partInt = parts[0];
  let partDec = parts.length > 1 ? '.' + parts[1] : '';
  if (partInt !== '') {
    partInt = Number(partInt).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  input.value = partInt + partDec;
  calcRow(input);
}

function collectItems() {
  const rows = document.querySelectorAll('#itemsBody tr');
  const items = [];
  
  rows.forEach(tr => {
    const id = Number(tr.dataset.itemId);
    
    const descEl = tr.querySelector('textarea');
    const description = descEl ? descEl.value.trim() : '';

    const inputs = tr.querySelectorAll('input[type=text], input[type=number]');
    const qtyRaw = inputs[0] ? inputs[0].value.replace(/,/g, '') : '0';
    const qty    = parseFloat(qtyRaw) || 0;
    
    const unit   = inputs[1] ? inputs[1].value.trim() : 'ชิ้น';
    
    const priceRaw = inputs[2] ? inputs[2].value.replace(/,/g, '') : '0';
    const price    = parseFloat(priceRaw) || 0;

    if (!description && qty === 0 && price === 0) return;
    
    items.push({ description, unit, qty, price, image: itemImages[id] || null });
  });
  return items;
}

async function buildPdf(fonts, items) {
  const { PDFDocument, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fontRegular = await pdfDoc.embedFont(fonts.regular, { subset: true });
  const fontBold   = await pdfDoc.embedFont(fonts.bold, { subset: true });

  const fkRegular = fontkit.create(new Uint8Array(fonts.regular));
  const fkBold  = fontkit.create(new Uint8Array(fonts.bold));

  const PAGE_W = 595.28; 
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

  function shapedWidth(str, fkFont, size) {
    if (!str) return 0;
    const cleanStr = normalizeThaiText(str); // Clean text before calculation
    const run = fkFont.layout(cleanStr);
    const unitsPerEm = fkFont.unitsPerEm || 1000;
    const scale = size / unitsPerEm;
    return run.positions.reduce((sum, p) => sum + p.xAdvance, 0) * scale;
  }

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

  function vline(x, yTop, h) {
  page.drawLine({ start: { x, y: yTop }, end: { x, y: yTop - h }, thickness: 0.75, color: LINEC });
  }

  function wrapText(str, font, size, maxWidth) {
    if (!str) return [''];
    const paragraphs = str.split('\n');
    const lines = [];

    for (const paragraph of paragraphs) {
      if (paragraph.trim() === '') {
        lines.push('');
        continue;
      }

      const words = paragraph.split(/(\s+)/);
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
    }
    
    return lines.length ? lines : [''];
  }

  // ── Letterhead Logo ──
  const seller = collectSeller();
  const logoX = MARGIN, logoY = y;
  if (seller.logo == "") {
    page.drawRectangle({ x: logoX, y: logoY - 34, width: 64, height: 8, color: NAVY });
    for (let i = 0; i < 5; i++) {
      const bw = 8, gap = 3.5, bx = logoX + 4 + i * (bw + gap);
      const bh = 14 + (i % 2 === 0 ? 8 : 4);
      page.drawRectangle({ x: bx, y: logoY - 34 + 8, width: bw, height: bh, color: NAVY });
    }
  }
  else {
    //Insert default logo from data folder
    const logoUrl = seller.logo;
    const pngImageBytes = await fetch(logoUrl).then((res) => res.arrayBuffer());
    const pngImage = await pdfDoc.embedPng(pngImageBytes);
    const pngDims = pngImage.scale(0.11);
    page.drawImage(pngImage, {
      x: logoX,
      y: logoY - 50,
      width: pngDims.width,
      height: pngDims.height,
    });
  }

  let hx = MARGIN + 100;
  text(seller.name, hx, y - 10, { size: 14, font: fontBold, color: NAVY });

  const lineInfo = [
    seller.address,
    `TAX ID: ${seller.taxId}  โทร: ${seller.phone}`,
    seller.email,
  ];
  let infoY = y - 22;
  text(lineInfo[0], hx, infoY, { size: 12, color: GRAY });
  infoY -= 12;
  text(lineInfo[1], hx, infoY, { size: 12, color: GRAY });
  infoY -= 12;
  text(lineInfo[2], hx, infoY, { size: 12, color: GRAY });

  y -= 55;
  line(MARGIN, y, PAGE_W - MARGIN);
  y -= 25;

  // ── Title ──
  text('ใบเสนอราคา', MARGIN, y, { size: 26, font: fontBold, color: NAVY, align: 'center', maxWidth: CONTENT_W });
  y -= 22;
  text('QUOTATION', MARGIN, y, { size: 22, font: fontRegular, color: GRAY, align: 'center', maxWidth: CONTENT_W });
  y -= 10;

  // ── Customer / Doc-info two-box row ──
  const boxH = 105;
  const leftW = CONTENT_W * 0.7;
  const rightW = CONTENT_W - leftW - 8;
  const rightX = MARGIN + leftW + 8;

  rect(MARGIN, y, leftW, boxH, { border: LINEC, borderWidth: 1 });
  rect(rightX, y, rightW, boxH, { border: LINEC, borderWidth: 1 });

  const buyer = collectBuyer();
  let cy = y - 16;
  const sameRow = (label, val) => {
    text(label , MARGIN + 8, cy, { size: 14, font: fontBold, color: INK });
    text(val || '-', MARGIN + 12 + Math.floor(fontBold.widthOfTextAtSize(label, 14)), cy, { size: 14, font: fontRegular, color: GRAY });
    cy -= 16;
  }
  // sameRow('ชื่อลูกค้า / Customer', buyer.name);
  text('ลูกค้า / Customer', MARGIN + 8, cy, { size: 14, font: fontBold, color: INK });
  wrapText(buyer.name || '-', fontRegular, 14, leftW - 100).slice(0, 2).forEach(ln => {
    text(ln, MARGIN + 87, cy, { size: 14, color: GRAY }); cy -= 16;
  });
  text('ที่อยู่ / Address', MARGIN + 8, cy, { size: 14, font: fontBold, color: INK });
  wrapText(buyer.address || '-', fontRegular, 14, leftW - 100).slice(0, 2).forEach(ln => {
    text(ln, MARGIN + 78, cy, { size: 14, color: GRAY }); cy -= 16;
  });
  sameRow('เลขประจำตัวผู้เสียภาษี / Tax ID', buyer.taxId);
  sameRow('อีเมล / email', buyer.email);
  sameRow('โทร / Tel.', buyer.phone);

  let ry = y - 14;
  const metaRow = (label, val) => {
    text(label, rightX + 8, ry, { size: 14, font: fontBold, color: INK });
    text(val || '-', rightX + 8, ry - 10, { size: 14, color: GRAY });
    ry -= 28;
  };
  metaRow('เลขที่ / No.', document.getElementById('quoteNo').value);
  metaRow('วันที่ / Date', formatDateThai(document.getElementById('quoteDate').value));
  metaRow('ยืนราคาถึง / Valid Until', formatDateThai(document.getElementById('validUntil').value));

  y -= boxH + 16;

  // ── Items table ──
  const hasImg = items.some(it => it.image);
  const cols = hasImg
  ? [
    { key: 'no',  label: 'ลำดับ', w: 26,  align: 'center' },
    { key: 'img',   label: 'รูป',     w: 75,  align: 'center' },
    { key: 'desc',  label: 'รายละเอียด', w: CONTENT_W - 26 - 75 - 50 - 40 - 50 - 80, align: 'center'   },
    { key: 'qty',   label: 'จำนวน',   w: 50,  align: 'center' },
    { key: 'unit',  label: 'หน่วย',   w: 40,  align: 'center' },
    { key: 'price', label: 'ราคา/หน่วย', w: 50,  align: 'center'  },
    { key: 'amt',   label: 'จำนวนเงิน', w: 80,  align: 'center'  },
    ]
  : [
    { key: 'no',  label: 'ลำดับ', w: 30,  align: 'center' },
    { key: 'desc',  label: 'รายละเอียด', w: CONTENT_W - 30 - 50 - 50 - 50 - 90, align: 'center'   },
    { key: 'qty',   label: 'จำนวน',   w: 50,  align: 'center' },
    { key: 'unit',  label: 'หน่วย',   w: 50,  align: 'center' },
    { key: 'price', label: 'ราคา/หน่วย', w: 50,  align: 'center'  },
    { key: 'amt',   label: 'จำนวนเงิน', w: 90,  align: 'center'  },
    ];

  function colX(idx) { return MARGIN + cols.slice(0, idx).reduce((s, c) => s + c.w, 0); }

  rect(MARGIN, y, CONTENT_W, headerH = 22, {fill: LINEC});
  cols.forEach((c, i) => {
  text(c.label, colX(i) + 5, y - 15, { size: 12, font: fontBold, color: NAVY, align: c.align, maxWidth: c.w - 10 });
  });
  y -= headerH;

  let subtotal = 0;
  for (const item of items) {
    const amt = item.qty * item.price;
    subtotal += amt;
    const descLines = wrapText(item.description || '-', fontRegular, 12, cols.find(c => c.key === 'desc').w - 10);
    let rowH = Math.max(22, descLines.length * 11 + 8);

    let imgDrawH = 0, imgDrawW = 0;
    if (hasImg && item.image) {
      const maxBox = 70;
      const ratio = item.image.naturalW / item.image.naturalH;
      if (ratio >= 1) { imgDrawW = maxBox; imgDrawH = maxBox / ratio; }
      else      { imgDrawH = maxBox; imgDrawW = maxBox * ratio; }
      rowH = Math.max(rowH, imgDrawH + 8);
  }

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
    text(String(items.indexOf(item) + 1), colX(i), rowTop - rowH / 2 - 3, { size: 12, align: 'center', maxWidth: c.w });
    } else if (c.key === 'desc') {
    let dy = rowTop - 12;
    descLines.forEach(ln => { text(ln, cx, dy, { size: 12, maxWidth: cw }); dy -= 11; });
    } else if (c.key === 'qty') {
    text(fmtNum(item.qty).replace(/\.00$/, ''), colX(i), rowTop - rowH / 2 - 3, { size: 12, align: 'center', maxWidth: c.w });
    } else if (c.key === 'unit') {
    text(item.unit || '-', colX(i), rowTop - rowH / 2 - 3, { size: 12, align: 'center', maxWidth: c.w });
    } else if (c.key === 'price') {
    text(fmtNum(item.price), colX(i), rowTop - rowH / 2 - 3, { size: 12, align: 'right', maxWidth: c.w - 5 });
    } else if (c.key === 'amt') {
    text(fmtNum(amt), colX(i), rowTop - rowH / 2 - 3, { size: 12, font: fontBold, color: BLUE, align: 'right', maxWidth: c.w - 5 });
    }
  });

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
    console.warn('Image embed failed', e);
    }
  }
  y -= rowH;
  }

  y -= 6;

  // ── Totals ──
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
    text(row.label, totalsX + 8, y - 13.5, { size: isLast ? 12.5 : 12, font: isLast ? fontBold : fontRegular, color: isLast ? BLUE : GRAY });
    text(row.val, totalsX, y - 13.5, { size: isLast ? 12.5 : 12, font: isLast ? fontBold : fontRegular, color: isLast ? BLUE : INK, align: 'right', maxWidth: totalsW - 8 });
    y -= trH;
  });

  y -= 18;

  // ── Notes ──
  const notes = document.getElementById('notes').value.trim();
  if (notes) {
  text('หมายเหตุ / Remark', MARGIN, y, { size: 12.5, font: fontBold, color: NAVY });
  y -= 13;
  wrapText(notes, fontRegular, 12, CONTENT_W).forEach(ln => { text(ln, MARGIN, y, { size: 12, color: GRAY }); y -= 11; });
  y -= 6;
  }

  if (y < MARGIN + 90) {
  page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  y = PAGE_H - MARGIN;
  }

  // ── Signature block ──
  const sigW = (CONTENT_W - 16) / 2;
  const sigH = 100;
  [MARGIN, MARGIN + sigW + 16].forEach((sx, idx) => {
  rect(sx, y, sigW, sigH, { border: LINEC, borderWidth: 1 });
  text('.'.repeat(40), sx, y - 36, { size: 14, color: GRAY, align: 'center', maxWidth: sigW });
  const nameLabel = idx === 0 ? `(${buyer.name || '...........................'})` : `(${seller.name})`;
  text(nameLabel, sx, y - 53, { size: 13, color: INK, align: 'center', maxWidth: sigW });
  const roleLabel = idx === 0 ? 'ผู้อนุมัติสั่งซื้อ / Customer Signature' : 'ผู้มีอำนาจลงนาม / Authorized Signature';
  text(roleLabel, sx, y - 67, { size: 13.5, font: fontBold, color: INK, align: 'center', maxWidth: sigW });
  text('วันที่/Date .........................................', sx, y - 85, { size: 13, color: GRAY, align: 'center', maxWidth: sigW });
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
  const selectedRadio = document.querySelector('input[name="issuerSelect"]:checked').value;
  let logo = "";
  if (selectedRadio != "custom") logo = DEFAULT_ISSUERS[parseInt(selectedRadio, 10)].logo;
  return {
    name: document.getElementById('sellerName').value.trim(),
    address: document.getElementById('sellerAddress').value.trim(),
    taxId: document.getElementById('sellerTaxId').value.trim(),
    phone: document.getElementById('sellerPhone').value.trim(),
    email: document.getElementById('sellerEmail').value.trim(),
    logo: logo
  };
}

function collectBuyer() {
  return {
    name: document.getElementById('buyerName').value.trim(),
    address: document.getElementById('buyerAddress').value.trim(),
    taxId:   document.getElementById('buyerTaxId').value.trim(),
    email:   document.getElementById('buyerEmail').value.trim(),
    phone:   document.getElementById('buyerPhone').value.trim(),
  };
}

function formatDateThai(isoStr) {
  if (!isoStr) return '-';
  const [y, m, d] = isoStr.split('-').map(Number);
  const months = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${d} ${months[m]} ${y + 543}`;
}