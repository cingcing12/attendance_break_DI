require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const http = require('http'); 
const { Server } = require("socket.io"); 

const app = express();
const server = http.createServer(app); 

// Allow all origins
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

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

// ==========================
// AUTH
// ==========================
const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// ==========================
// CACHING & CONCURRENCY
// ==========================
let STAFF_CACHE = { data: null, timestamp: 0, duration: 10 * 60 * 1000 };
let BREAKS_CACHE = { data: null, timestamp: 0, duration: 2 * 1000 }; 
let fetchStaffPromise = null;
let fetchBreaksPromise = null;

// WRITE LOCK SYSTEM
let isWriting = false; 
const waitForLock = () => {
    return new Promise(resolve => {
        const check = () => {
            if (!isWriting) {
                isWriting = true;
                resolve();
            } else {
                setTimeout(check, 50); // Check every 50ms
            }
        };
        check();
    });
};
const releaseLock = () => { isWriting = false; };

// ==========================
// HELPERS
// ==========================
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
    hours = parseInt(hours);
    if (hours === 12 && modifier === 'AM') hours = 0;
    if (modifier === 'PM' && hours !== 12) hours += 12;
    const d = getCambodiaDate();
    d.setHours(hours, parseInt(minutes), 0, 0);
    return d;
}

function getDirectImageLink(url) {
    if (!url) return '';
    if (url.startsWith('=IMAGE')) {
        const m = url.match(/"([^"]+)"/);
        if (m) url = m[1];
    }
    if (url.match(/\.(jpg|jpeg|png|gif)$/i)) return url;
    const id = url.match(/[-\w]{25,}/);
    if (id && url.includes('drive.google.com')) {
        return `https://drive.google.com/thumbnail?id=${id[0]}&sz=w500`;
    }
    return url;
}

function safeKey(str) {
    return str ? String(str).trim().toUpperCase() : '';
}

function getNextAvailableCard(activeBreaks, area) {
    const min = area === 'A' ? 51 : 1;
    const max = area === 'A' ? 150 : 50;
    const used = new Set();

    activeBreaks.forEach(b => {
        if (b.area === area && b.card) {
            try {
                const numStr = b.card.split('_')[1];
                const num = parseInt(numStr);
                if (!isNaN(num) && num >= min && num <= max) used.add(num);
            } catch(e) {}
        }
    });

    for (let i = min; i <= max; i++) {
        if (!used.has(i)) {
            const formatted = (area === 'B' && i < 10) ? '0' + i : i.toString();
            return `DD_${formatted}`;
        }
    }
    return null;
}

async function ensureTodaySheet(sheets) {
    const today = getTodaySheetName();
    try {
        await sheets.spreadsheets.values.get({ 
            spreadsheetId: WRITE_SPREADSHEET_ID, 
            range: `'${today}'!A1` 
        });
        return today;
    } catch (e) {
        try {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: WRITE_SPREADSHEET_ID,
                resource: { requests: [{ addSheet: { properties: { title: today } } }] }
            });
            const header = [['Id', 'Name', 'Group', 'timeOut', 'timeIn', 'area', 'date', 'overTime', 'card']];
            await sheets.spreadsheets.values.update({
                spreadsheetId: WRITE_SPREADSHEET_ID,
                range: `${today}!A1:I1`,
                valueInputOption: 'RAW',
                resource: { values: header }
            });
            return today;
        } catch (createErr) {
            return today; 
        }
    }
}

// ==========================
// CACHED FETCHERS
// ==========================

async function getCachedStaffData(sheets) {
    const now = Date.now();
    if (STAFF_CACHE.data && (now - STAFF_CACHE.timestamp < STAFF_CACHE.duration)) {
        return STAFF_CACHE;
    }
    if (fetchStaffPromise) return fetchStaffPromise;

    fetchStaffPromise = (async () => {
        try {
            const [mainRes, imgRes, diRes] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: READ_SPREADSHEET_ID, range: `'${READ_SHEET_NAME}'!A13:AI` }),
                sheets.spreadsheets.values.get({ spreadsheetId: READ_SPREADSHEET_ID, range: `'${READ_SHEET_NAME}'!AJ13:AJ`, valueRenderOption: 'FORMULA' }),
                sheets.spreadsheets.values.get({ spreadsheetId: WRITE_SPREADSHEET_ID, range: `'${DI_SHEET_NAME}'!A9:M` })
            ]);

            const mainRows = mainRes.data.values || [];
            const imgRows = imgRes.data.values || [];
            const diRows = diRes.data.values || [];

            const scanMap = {};
            diRows.forEach(r => {
                const status = r[5];
                const nameEN = r[12];
                if (status && status.includes('Scan') && nameEN) {
                    const id = r[4] ? String(r[4]).trim() : null;
                    if (id) scanMap[safeKey(nameEN)] = { id, group: r[6] };
                }
            });

            const idMap = {};
            const nameMap = {};

            mainRows.forEach((row, i) => {
                const id = row[1] ? String(row[1]).trim() : null;
                const nameEN = row[4];
                const nameKH = row[3];
                const imgFormula = imgRows[i] ? imgRows[i][0] : '';
                const imgUrl = getDirectImageLink(imgFormula);

                if (imgUrl) {
                    if (id) idMap[id] = imgUrl;
                    if (nameEN) nameMap[safeKey(nameEN)] = imgUrl;
                    if (nameKH) nameMap[safeKey(nameKH)] = imgUrl;
                }
            });

            const staffList = mainRows.map((r, i) => {
                const nameEN = r[4];
                if (!nameEN) return null;
                const scan = scanMap[safeKey(nameEN)];
                if (!scan) return null;

                const finalID = scan.id || r[1] ? String(scan.id || r[1]).trim() : null;
                const nameKH = r[3];
                let finalImg = '';
                
                if (finalID && idMap[finalID]) finalImg = idMap[finalID];
                else if (nameKH && nameMap[safeKey(nameKH)]) finalImg = nameMap[safeKey(nameKH)];
                else finalImg = getDirectImageLink(imgRows[i]?.[0]);

                return {
                    id: finalID,
                    name_en: nameEN,
                    name_kh: nameKH || nameEN,
                    group: scan.group || r[26] || 'Staff',
                    image: finalImg
                };
            }).filter(Boolean);

            STAFF_CACHE = { data: staffList, idMap, nameMap, timestamp: Date.now(), duration: STAFF_CACHE.duration };
            return STAFF_CACHE;
        } catch (e) {
            console.error("Staff fetch failed:", e);
            throw e;
        } finally {
            fetchStaffPromise = null;
        }
    })();
    return fetchStaffPromise;
}

// FORCE FETCH FRESH DATA (No Cache) - Used during writes
async function getFreshBreaks(sheets) {
    const sheet = await ensureTodaySheet(sheets);
    const r = await sheets.spreadsheets.values.get({ 
        spreadsheetId: WRITE_SPREADSHEET_ID, 
        range: `'${sheet}'!A:I` 
    });
    const rows = r.data.values || [];
    
    // Return objects to check easily
    return rows.slice(1).map((row) => ({
        id: row[0] ? String(row[0]).trim() : null,
        timeOut: row[3],
        timeIn: row[4],
        area: row[5],
        card: row[8]
    })).filter(r => r.timeOut && !r.timeIn); // Only return currently active breaks
}

// CACHED FETCH - Used for display
async function getCachedBreaks(sheets) {
    const now = Date.now();
    if (BREAKS_CACHE.data && (now - BREAKS_CACHE.timestamp < BREAKS_CACHE.duration)) {
        return BREAKS_CACHE.data;
    }
    if (fetchBreaksPromise) return fetchBreaksPromise;

    fetchBreaksPromise = (async () => {
        try {
            const sheet = await ensureTodaySheet(sheets);
            const r = await sheets.spreadsheets.values.get({ 
                spreadsheetId: WRITE_SPREADSHEET_ID, 
                range: `'${sheet}'!A:I` 
            });
            const rows = r.data.values || [];
            const staffCache = await getCachedStaffData(sheets);

            const active = rows.slice(1).map((row, i) => {
                const id = row[0] ? String(row[0]).trim() : null;
                const name = row[1];
                let imgUrl = '';
                if (id && staffCache.idMap[id]) imgUrl = staffCache.idMap[id];
                else if (name && staffCache.nameMap[safeKey(name)]) imgUrl = staffCache.nameMap[safeKey(name)];

                return {
                    rowIndex: i + 2,
                    id, name, group: row[2],
                    timeOut: row[3],
                    timeIn: row[4],
                    area: row[5],
                    date: row[6],
                    overtime: row[7],
                    card: row[8] || '', 
                    image: imgUrl
                };
            }).filter(r => r.timeOut && !r.timeIn);

            BREAKS_CACHE = { data: active, timestamp: Date.now(), duration: BREAKS_CACHE.duration };
            return active;
        } catch (e) {
            console.error("Breaks fetch failed:", e);
            return BREAKS_CACHE.data || [];
        } finally {
            fetchBreaksPromise = null;
        }
    })();
    return fetchBreaksPromise;
}

// ==========================
// ROUTES
// ==========================

app.get('/', (req, res) => res.send('Staff Hub API - Concurrency Safe v2'));

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    if(email === 'admin@company.com' && password === 'admin123') {
        res.json({ success: true, token: 'admin_secret_token_123' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid Credentials' });
    }
});

app.get('/available-sheets', async (req, res) => {
    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        
        const response = await sheets.spreadsheets.get({
            spreadsheetId: WRITE_SPREADSHEET_ID
        });

        const sheetsList = response.data.sheets;
        const dateSheets = sheetsList
            .map(s => s.properties.title)
            .filter(title => /^\d{2}-\d{2}-\d{4}$/.test(title));

        res.json(dateSheets);
    } catch (error) {
        console.error("Error fetching sheets:", error);
        res.status(500).json([]);
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
        const data = await getCachedBreaks(sheets);
        res.json(data);
    } catch (e) {
        res.status(500).json([]);
    }
});

app.get('/report', async (req, res) => {
    const { filter } = req.query; 
    
    if(!filter || filter === 'undefined') return res.json({ raw: [] });

    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const staffCache = await getCachedStaffData(sheets);
        const metaData = await sheets.spreadsheets.get({ spreadsheetId: WRITE_SPREADSHEET_ID });
        const allSheetNames = metaData.data.sheets.map(s => s.properties.title);
        const sheetsToFetch = allSheetNames.filter(name => name.endsWith(filter));

        if(sheetsToFetch.length === 0) return res.json({ raw: [] });

        const fetchPromises = sheetsToFetch.map(sheetName => 
            sheets.spreadsheets.values.get({ 
                spreadsheetId: WRITE_SPREADSHEET_ID, 
                range: `'${sheetName}'!A:I` 
            }).then(res => res.data.values || [])
        );

        const results = await Promise.all(fetchPromises);
        let aggregatedRows = [];
        results.forEach(sheetRows => { aggregatedRows = aggregatedRows.concat(sheetRows.slice(1)); });
        
        const allData = aggregatedRows.map((row) => {
            const id = row[0] ? String(row[0]).trim() : null;
            const name = row[1];
            let imgUrl = '';
            if (id && staffCache.idMap[id]) imgUrl = staffCache.idMap[id];
            else if (name && staffCache.nameMap[safeKey(name)]) imgUrl = staffCache.nameMap[safeKey(name)];

            return {
                id: id || 'Unknown', 
                name: name || 'Unknown', 
                group: row[2],
                timeOut: row[3],
                timeIn: row[4],
                area: row[5],
                date: row[6],
                overtime: row[7],
                image: imgUrl
            };
        });

        res.json({ raw: allData });
    } catch (error) {
        console.error("Report Error:", error);
        res.json({ raw: [] });
    }
});

// === WRITE ENDPOINTS (STRICT CONCURRENCY) ===

app.post('/break', async (req, res) => {
    const { id, name, group, area } = req.body;
    if (!id || !name || !area) return res.status(400).json({ error: 'Missing data' });

    try {
        await waitForLock(); // 1. Acquire Lock

        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        
        // 2. Fetch FRESH data (Guarantee latest state)
        // We force fetch from Google Sheets inside the lock.
        // This is slow (~500ms) but guarantees accuracy.
        const activeBreaks = await getFreshBreaks(sheets);
        
        // 3. CRITICAL: Check if user is ALREADY on break to prevent duplicates
        const isAlreadyOnBreak = activeBreaks.some(b => String(b.id) === String(id));

        if (isAlreadyOnBreak) {
            console.log(`Duplicate blocked for ID: ${id}`);
            releaseLock(); 
            // Return success so frontend stops spinning, but DO NOT WRITE.
            // Return existing break info if possible, or just success.
            return res.json({ status: 'success', message: 'User already on break', card: 'ALREADY_OUT' });
        }
        
        const card = getNextAvailableCard(activeBreaks, area);
        if (!card) {
            releaseLock();
            return res.status(400).json({ error: 'No available card in this zone' });
        }

        const timeStr = getCurrentTimeString();
        const dateStr = getTodaySheetName();
        const sheet = dateStr; 

        const values = [[
            String(id).trim(), name, group || '', timeStr, '', area, dateStr, '', card
        ]];

        await sheets.spreadsheets.values.append({
            spreadsheetId: WRITE_SPREADSHEET_ID,
            range: `'${sheet}'!A:I`,
            valueInputOption: 'USER_ENTERED',
            resource: { values }
        });

        BREAKS_CACHE.timestamp = 0; 
        io.emit('data_updated'); // Notify all devices
        
        // 4. RETURN THE ASSIGNED CARD IN RESPONSE
        res.json({ status: 'success', timeOut: timeStr, card: card });

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error' });
    } finally {
        releaseLock(); // Release Lock
    }
});

app.post('/timein', async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID required' });

    try {
        await waitForLock(); // Acquire Lock

        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const sheet = getTodaySheetName();

        const r = await sheets.spreadsheets.values.get({ 
            spreadsheetId: WRITE_SPREADSHEET_ID, 
            range: `'${sheet}'!A:I` 
        });
        const rows = r.data.values || [];
        
        let rowIndex = -1;
        let outTime = '';
        const targetId = String(id).trim();

        // Find the active row
        for (let i = rows.length - 1; i >= 1; i--) {
            const rowId = rows[i][0] ? String(rows[i][0]).trim() : '';
            // Must match ID and have NO timeIn
            if (rowId === targetId && !rows[i][4]) {
                rowIndex = i + 1;
                outTime = rows[i][3];
                break;
            }
        }

        if (rowIndex === -1) {
            releaseLock();
            // If already timed in, return success so frontend updates
            return res.json({ status: 'success', message: 'Already timed in' });
        }

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

        BREAKS_CACHE.timestamp = 0;
        io.emit('data_updated'); 
        res.json({ status: 'success', timeIn: timeInStr });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error' });
    } finally {
        releaseLock();
    }
});

// SOCKET LOGGING
io.on('connection', (socket) => {
    console.log('Device connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('Device disconnected:', socket.id);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port http://localhost:${PORT}`);
});