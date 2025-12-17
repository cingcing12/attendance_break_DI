require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ==========================
// CONFIGURATION
// ==========================
const READ_SPREADSHEET_ID = '1h6pqlcoUSKPWsk7it4jFLtg5Oc_w7gXGnKCXSIduK7E'; 
const READ_SHEET_NAME = 'DB_DUC_BKU';

const WRITE_SPREADSHEET_ID = '1pzOMgXkyAuLTcU-2P7nXryuELhP8f29nHvLXEErpYxw'; 
const DI_SHEET_NAME = 'Sheet3';
const TEMPLATE_SHEET_NAME = 'Sheet1';

// ==========================
// CACHE SYSTEM (Fixes Quota Issues)
// ==========================
let STAFF_CACHE = {
    data: null,
    imageMap: null,
    timestamp: 0,
    duration: 5 * 60 * 1000 // Cache Staff for 5 Minutes
};

let META_CACHE = {
    sheets: null,
    timestamp: 0,
    duration: 60 * 1000 // Cache Sheet List for 1 Minute
};

// Queue to prevent double-fetching
let fetchStaffPromise = null;

// ==========================
// AUTH
// ==========================
const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// ==========================
// HELPERS
// ==========================
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function getCambodiaDate() {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Phnom_Penh" }));
}

function getTodaySheetName() {
    const d = getCambodiaDate();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

function getCurrentTimeString() {
    const d = getCambodiaDate();
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function parseTimeStr(timeStr) {
    if (!timeStr) return new Date();
    const [time, modifier] = timeStr.trim().split(/\s+/);
    let [hours, minutes] = time.split(':');
    if (hours === '12') hours = '00';
    if (modifier === 'PM') hours = parseInt(hours, 10) + 12;
    const d = getCambodiaDate();
    d.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
    return d;
}

function chunkArray(array, size) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
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

// --- INTELLIGENT CACHING ---

async function getCachedStaffData(sheets) {
    const now = Date.now();
    
    // 1. Return Cache if valid
    if (STAFF_CACHE.data && (now - STAFF_CACHE.timestamp < STAFF_CACHE.duration)) {
        return STAFF_CACHE;
    }

    // 2. Wait if already fetching
    if (fetchStaffPromise) return fetchStaffPromise;

    // 3. Fetch Fresh
    console.log('🔄 Fetching Fresh Staff Data...');
    fetchStaffPromise = (async () => {
        try {
            const [mainRes, imgRes, diRes] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: READ_SPREADSHEET_ID, range: `'${READ_SHEET_NAME}'!A13:AI`, valueRenderOption: 'FORMATTED_VALUE' }),
                sheets.spreadsheets.values.get({ spreadsheetId: READ_SPREADSHEET_ID, range: `'${READ_SHEET_NAME}'!AJ13:AJ`, valueRenderOption: 'FORMULA' }),
                sheets.spreadsheets.values.get({ spreadsheetId: WRITE_SPREADSHEET_ID, range: `'${DI_SHEET_NAME}'!A9:M`, valueRenderOption: 'FORMATTED_VALUE' })
            ]);

            const mainRows = mainRes.data.values || [];
            const imgRows = imgRes.data.values || [];
            const diRows = diRes.data.values || [];

            const scanMap = {};
            diRows.forEach(r => {
                const status = r[5];
                const nameEN = r[12];
                if (status && status.includes('Scan') && nameEN) {
                    scanMap[nameEN.trim().toUpperCase()] = { id: r[4], group: r[6] };
                }
            });

            const imageMap = {};
            mainRows.forEach((row, i) => {
                const name = row[4];
                const imgFormula = imgRows[i] ? imgRows[i][0] : '';
                if (name) imageMap[name.trim().toUpperCase()] = getDirectImageLink(imgFormula);
            });

            const staffList = mainRows.map((r, i) => {
                const nameEN = r[4];
                if (!nameEN) return null;
                const scan = scanMap[nameEN.trim().toUpperCase()];
                if (!scan) return null;
                return {
                    id: scan.id || r[1],
                    name_en: nameEN,
                    group: scan.group || r[26] || 'Staff',
                    image: getDirectImageLink(imgRows[i]?.[0]),
                    training_place: r[24] || ''
                };
            }).filter(Boolean);

            STAFF_CACHE = {
                data: staffList,
                imageMap: imageMap,
                timestamp: Date.now(),
                duration: 5 * 60 * 1000
            };
            return STAFF_CACHE;
        } catch (e) {
            console.error("Staff fetch failed", e);
            throw e;
        } finally {
            fetchStaffPromise = null;
        }
    })();

    return fetchStaffPromise;
}

async function getCachedSheetsMeta(sheets) {
    const now = Date.now();
    if (META_CACHE.sheets && (now - META_CACHE.timestamp < META_CACHE.duration)) {
        return META_CACHE.sheets;
    }
    
    const meta = await sheets.spreadsheets.get({ spreadsheetId: WRITE_SPREADSHEET_ID });
    const titles = meta.data.sheets.map(s => s.properties.title);
    
    META_CACHE = {
        sheets: titles,
        timestamp: now,
        duration: 60 * 1000
    };
    return titles;
}

async function ensureTodaySheet(sheets) {
    const today = getTodaySheetName();
    try {
        const names = await getCachedSheetsMeta(sheets);
        if (names.includes(today)) return today;

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: WRITE_SPREADSHEET_ID,
            resource: { requests: [{ addSheet: { properties: { title: today } } }] }
        });
        META_CACHE.timestamp = 0; 

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
        return today;
    }
}

// ==========================
// ROUTES
// ==========================

app.get('/', (req, res) => res.send('API Online'));

app.get('/available-sheets', async (req, res) => {
    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const sheetNames = await getCachedSheetsMeta(sheets);
        const dateSheets = sheetNames.filter(title => /^\d{2}-\d{2}-\d{4}$/.test(title));
        res.json(dateSheets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/report', async (req, res) => {
    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const mode = req.query.mode || 'daily';
        const filter = req.query.filter; 

        // 1. USE CACHE (Critical for Speed/Quota)
        const staffCache = await getCachedStaffData(sheets);
        const allSheetNames = await getCachedSheetsMeta(sheets);
        
        // 2. Select Sheets
        let targetSheets = [];
        if (filter) {
            if (mode === 'daily') {
                if (allSheetNames.includes(filter)) targetSheets.push(filter);
            } else {
                const suffix = `-${filter}`;
                targetSheets = allSheetNames.filter(name => name.endsWith(suffix));
            }
        } else {
            const today = getTodaySheetName();
            if (allSheetNames.includes(today)) targetSheets.push(today);
        }

        // 3. BATCH FETCH (The Fix)
        const sheetChunks = chunkArray(targetSheets, 50); 
        let allRecords = [];

        for (const chunk of sheetChunks) {
            const ranges = chunk.map(name => `'${name}'!A2:H`);
            
            if (ranges.length > 0) {
                const batchRes = await sheets.spreadsheets.values.batchGet({
                    spreadsheetId: WRITE_SPREADSHEET_ID,
                    ranges: ranges
                });
                await sleep(150); // Throttle

                const valueRanges = batchRes.data.valueRanges || [];
                valueRanges.forEach((rangeData) => {
                    const rows = rangeData.values || [];
                    if (rows.length > 0) {
                        const parsed = rows.map(row => ({
                            id: row[0],
                            name: row[1],
                            group: row[2],
                            timeOut: row[3],
                            timeIn: row[4],
                            area: row[5],
                            date: row[6],
                            overtime: row[7] || "0",
                            image: staffCache.imageMap[row[1] ? row[1].trim().toUpperCase() : ''] || ''
                        }));
                        allRecords.push(...parsed);
                    }
                });
            }
        }

        res.json({
            mode: mode,
            filter: filter,
            count: allRecords.length,
            raw: allRecords
        });

    } catch (err) {
        console.error("Report Error:", err.message);
        if (err.code === 429) res.status(429).json({ error: "System busy. Please wait." });
        else res.status(500).json({ error: err.message });
    }
});

app.get('/staff', async (req, res) => {
    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const cache = await getCachedStaffData(sheets);
        res.json(cache.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/active-breaks', async (req, res) => {
    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const sheet = await ensureTodaySheet(sheets);
        const r = await sheets.spreadsheets.values.get({ spreadsheetId: WRITE_SPREADSHEET_ID, range: `'${sheet}'!A:H` });
        const rows = r.data.values || [];
        const active = rows.slice(1).map((r, i) => ({
            rowIndex: i + 2, id: r[0], name: r[1], group: r[2], timeOut: r[3], timeIn: r[4], area: r[5]
        })).filter(r => !r.timeIn); 
        res.json(active);
    } catch (e) { res.json([]); }
});

app.post('/break', async (req, res) => {
    const { id, name, group, area } = req.body;
    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const sheet = await ensureTodaySheet(sheets);
        const timeStr = getCurrentTimeString();
        const dateStr = getTodaySheetName();
        const values = [[id, name, group, timeStr, '', area, dateStr, '']];
        await sheets.spreadsheets.values.append({
            spreadsheetId: WRITE_SPREADSHEET_ID, range: `'${sheet}'!A:H`, valueInputOption: 'USER_ENTERED', resource: { values }
        });
        res.json({ status: 'success', timeOut: timeStr });
    } catch { res.status(500).json({ status: 'error' }); }
});

app.post('/timein', async (req, res) => {
    const { id } = req.body;
    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const sheet = await ensureTodaySheet(sheets);
        const r = await sheets.spreadsheets.values.get({ spreadsheetId: WRITE_SPREADSHEET_ID, range: `'${sheet}'!A:H` });
        const rows = r.data.values;
        let rowIndex = -1, outTime = '';
        for (let i = rows.length - 1; i >= 1; i--) {
            if (rows[i][0] == id && !rows[i][4]) {
                rowIndex = i + 1; outTime = rows[i][3]; break;
            }
        }
        if (rowIndex === -1) return res.status(404).json({ status: 'error' });
        const now = getCambodiaDate();
        const diff = Math.floor((now - parseTimeStr(outTime)) / 60000);
        const overtime = diff > 15 ? `${diff - 15} mins` : '0';
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
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server on port http://localhost:${PORT}`));