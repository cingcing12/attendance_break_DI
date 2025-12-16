require('dotenv').config(); // ✅ ADD THIS AT VERY TOP

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000; // ✅ RENDER PORT


app.use(cors());
app.use(express.json());

// ==========================
// CONFIG
// ==========================
const READ_SPREADSHEET_ID = '1h6pqlcoUSKPWsk7it4jFLtg5Oc_w7gXGnKCXSIduK7E';
const READ_SHEET_NAME = 'DB_DUC_BKU';

const WRITE_SPREADSHEET_ID = '1pzOMgXkyAuLTcU-2P7nXryuELhP8f29nHvLXEErpYxw';
const DI_SHEET_NAME = 'Sheet3';
const TEMPLATE_SHEET_NAME = 'Sheet1';

// ==========================
// GOOGLE AUTH
// ==========================
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});


// ==========================
// HELPERS
// ==========================
function getTodaySheetName() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

async function ensureTodaySheet(sheets) {
  const today = getTodaySheetName();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: WRITE_SPREADSHEET_ID });
  const names = meta.data.sheets.map(s => s.properties.title);

  if (names.includes(today)) return today;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: WRITE_SPREADSHEET_ID,
    resource: { requests: [{ addSheet: { properties: { title: today } } }] }
  });

  const header = await sheets.spreadsheets.values.get({
    spreadsheetId: WRITE_SPREADSHEET_ID,
    range: `${TEMPLATE_SHEET_NAME}!A1:H1`
  });

  if (header.data.values) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: WRITE_SPREADSHEET_ID,
      range: `${today}!A1`,
      valueInputOption: 'RAW',
      resource: { values: header.data.values }
    });
  }

  return today;
}

function cleanImageLink(val) {
  if (!val) return '';
  if (val.startsWith('=IMAGE')) {
    const m = val.match(/"([^"]+)"/);
    return m ? m[1] : '';
  }
  return val;
}

function getDirectImageLink(url) {
  url = cleanImageLink(url);
  if (!url) return '';
  if (url.match(/\.(jpg|jpeg|png|gif)$/i)) return url;
  const id = url.match(/[-\w]{25,}/);
  if (id && url.includes('drive.google.com')) {
    return `https://drive.google.com/thumbnail?id=${id[0]}&sz=w500`;
  }
  return url;
}

function parseTimeStr(timeStr) {
  if (!timeStr) return new Date();
  const [time, mod] = timeStr.split(' ');
  let [h, m] = time.split(':');
  if (h === '12') h = '00';
  if (mod === 'PM') h = parseInt(h) + 12;
  const d = new Date();
  d.setHours(h, m, 0);
  return d;
}

// ==========================
// ROUTE: STAFF (SCAN ONLY)
// ==========================
app.get('/staff', async (req, res) => {
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const [mainRes, imgRes, diRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: READ_SPREADSHEET_ID,
        range: `'${READ_SHEET_NAME}'!A13:AI`,
        valueRenderOption: 'FORMATTED_VALUE'
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: READ_SPREADSHEET_ID,
        range: `'${READ_SHEET_NAME}'!AJ13:AJ`,
        valueRenderOption: 'FORMULA'
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: WRITE_SPREADSHEET_ID,
        range: `'${DI_SHEET_NAME}'!A9:M`,
        valueRenderOption: 'FORMATTED_VALUE'
      })
    ]);

    const mainRows = mainRes.data.values || [];
    const imgRows = imgRes.data.values || [];
    const diRows = diRes.data.values || [];

    // ==========================
    // MAP ONLY "វត្តមាន Scan"
    // ==========================
    const scanMap = {};
    diRows.forEach(r => {
      const status = r[5];   // Column F
      const nameEN = r[12];  // Column M
      if (status === 'Scan' && nameEN) {
        scanMap[nameEN.trim().toUpperCase()] = {
          id: r[4],     // Column E
          group: r[6]   // Column G
        };
      }
    });

    const staff = mainRows.map((r, i) => {
      const nameEN = r[4];
      if (!nameEN) return null;

      const scan = scanMap[nameEN.trim().toUpperCase()];
      if (!scan) return null;

      return {
        id: scan.id || r[1],
        name_kh: r[3] || '',
        name_en: nameEN,
        group: scan.group || r[26] || 'Staff',
        image: getDirectImageLink(imgRows[i]?.[0]),
        attendance: 'វត្តមាន Scan'
      };
    }).filter(Boolean);

    res.json(staff);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// ROUTE: ACTIVE BREAKS
// ==========================
app.get('/active-breaks', async (req, res) => {
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    const sheet = await ensureTodaySheet(sheets);

    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: WRITE_SPREADSHEET_ID,
      range: `'${sheet}'!A:H`
    });

    const rows = r.data.values || [];
    const active = rows.slice(1)
      .map((r, i) => ({
        rowIndex: i + 2,
        id: r[0],
        name: r[1],
        group: r[2],
        timeOut: r[3],
        timeIn: r[4],
        area: r[5]
      }))
      .filter(r => !r.timeIn);

    res.json(active);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================
// ROUTE: START BREAK
// ==========================
app.post('/break', async (req, res) => {
  const { id, name, group, area } = req.body;
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    const sheet = await ensureTodaySheet(sheets);

    const now = new Date();
    const values = [[
      id,
      name,
      group,
      now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      '',
      area,
      now.toLocaleDateString('en-GB'),
      ''
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: WRITE_SPREADSHEET_ID,
      range: `'${sheet}'!A:H`,
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    });

    res.json({ status: 'success' });
  } catch {
    res.status(500).json({ status: 'error' });
  }
});

// ==========================
// ROUTE: TIME IN
// ==========================
app.post('/timein', async (req, res) => {
  const { id } = req.body;
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    const sheet = await ensureTodaySheet(sheets);

    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: WRITE_SPREADSHEET_ID,
      range: `'${sheet}'!A:H`
    });

    const rows = r.data.values;
    let rowIndex = -1;
    let outTime = '';

    for (let i = rows.length - 1; i >= 1; i--) {
      if (rows[i][0] == id && !rows[i][4]) {
        rowIndex = i + 1;
        outTime = rows[i][3];
        break;
      }
    }

    if (rowIndex === -1) return res.status(404).json({ status: 'error' });

    const now = new Date();
    const diff = Math.floor((now - parseTimeStr(outTime)) / 60000);
    const overtime = diff > 15 ? `${diff - 15} mins` : '0';

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: WRITE_SPREADSHEET_ID,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: `'${sheet}'!E${rowIndex}`, values: [[now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })]] },
          { range: `'${sheet}'!H${rowIndex}`, values: [[overtime]] }
        ]
      }
    });

    res.json({ status: 'success' });
  } catch {
    res.status(500).json({ status: 'error' });
  }
});

// ==========================
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
