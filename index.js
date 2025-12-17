require('dotenv').config(); 

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000; 

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
  // Use environment variable for credentials on Render
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// ==========================
// HELPERS (TIMEZONE FIXED)
// ==========================

// 1. Get Current Time in Cambodia (GMT+7)
function getCambodiaDate() {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Phnom_Penh" }));
}

// 2. Get Sheet Name (DD-MM-YYYY) based on Cambodia Time
function getTodaySheetName() {
    const d = getCambodiaDate();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

// 3. Get Time String (hh:mm AM/PM) based on Cambodia Time
function getCurrentTimeString() {
    const d = getCambodiaDate();
    return d.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: true 
    });
}

// 4. Parse Time String for Calculation
function parseTimeStr(timeStr) {
    if (!timeStr) return new Date();
    
    // Clean string (remove potential extra spaces)
    const [time, modifier] = timeStr.trim().split(/\s+/);
    let [hours, minutes] = time.split(':');
    
    if (hours === '12') hours = '00';
    if (modifier === 'PM') hours = parseInt(hours, 10) + 12;
    
    // Create a date object for TODAY (Cambodia Time) with that time
    const d = getCambodiaDate();
    d.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
    return d;
}

async function ensureTodaySheet(sheets) {
  const today = getTodaySheetName();
  try {
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
  } catch (err) {
      console.error("Sheet Error:", err);
      return today; // Fallback
  }
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

// ==========================
// ROUTE: STAFF (SCAN ONLY)
// ==========================
app.get('/staff', async (req, res) => {
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    // Use single quotes for sheet names with spaces/special chars
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

    // Map "វត្តមាន" column from Sheet3 (Index 5 = Column F)
    const scanMap = {};
    diRows.forEach(r => {
      const status = r[5];   // Column F (Index 5)
      const nameEN = r[12];  // Column M (Index 12)
      
      // Strict check for "Scan"
      if (status && status.includes('Scan') && nameEN) {
        scanMap[nameEN.trim().toUpperCase()] = {
          id: r[4],    // Column E
          group: r[6]  // Column G
        };
      }
    });

    const staff = mainRows.map((r, i) => {
      const nameEN = r[4];
      if (!nameEN) return null;

      // Check if this person exists in our "Scan" map
      const scan = scanMap[nameEN.trim().toUpperCase()];
      if (!scan) return null; // If not in Scan map, skip

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
      .filter(r => !r.timeIn); // Only show if Time In is empty

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

    const now = getCambodiaDate(); // Use Cambodia Time
    const dateStr = getTodaySheetName();
    const timeStr = getCurrentTimeString();

    const values = [[
      id,
      name,
      group,
      timeStr, // Time Out
      '',      // Time In (Empty)
      area,
      dateStr,
      ''       // Overtime
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: WRITE_SPREADSHEET_ID,
      range: `'${sheet}'!A:H`,
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    });

    res.json({ status: 'success', timeOut: timeStr });
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

    // Find the row (Loop backwards to find latest)
    for (let i = rows.length - 1; i >= 1; i--) {
      if (rows[i][0] == id && !rows[i][4]) {
        rowIndex = i + 1;
        outTime = rows[i][3];
        break;
      }
    }

    if (rowIndex === -1) return res.status(404).json({ status: 'error' });

    // Calculate Diff using Cambodia Time
    const now = getCambodiaDate();
    const startTime = parseTimeStr(outTime); // Parses the "Time Out" string relative to today
    
    // Calculate difference in Minutes
    const diffMs = now - startTime;
    const diffMins = Math.floor(diffMs / 60000);
    
    const overtime = diffMins > 15 ? `${diffMins - 15} mins` : '0';
    const timeInStr = getCurrentTimeString();

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: WRITE_SPREADSHEET_ID,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: `'${sheet}'!E${rowIndex}`, values: [[timeInStr]] },
          { range: `'${sheet}'!H${rowIndex}`, values: [[overtime]] }
        ]
      }
    });

    res.json({ status: 'success', timeIn: timeInStr });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error' });
  }
});

// ==========================
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});