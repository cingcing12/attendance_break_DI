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

// === ADMIN CREDENTIALS ===
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

app.use(cors());
app.use(express.json());

// ==========================
// CONFIGURATION
// ==========================
const READ_SPREADSHEET_ID = '1h6pqlcoUSKPWsk7it4jFLtg5Oc_w7gXGnKCXSIduK7E'; 
const READ_SHEET_NAME = 'DB_DUC_BKU';

const WRITE_SPREADSHEET_ID = '1pzOMgXkyAuLTcU-2P7nXryuELhP8f29nHvLXEErpYxw'; 
const DI_SHEET_NAME = 'Sheet3';
const SETTINGS_SHEET_NAME = 'CardSettings'; 

// ==========================
// AUTH
// ==========================
const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// ==========================
// 🚀 HIGH PERFORMANCE MEMORY STORE
// ==========================
const MEMORY = {
    activeBreaks: [], 
    usedCards: new Set(), 
    settings: [],     
    staffCache: null, 
    isReady: false    
};

// ==========================
// ⚡ SEQUENTIAL WRITE QUEUE
// ==========================
let sheetWriteQueue = Promise.resolve();

function queueSheetTask(task) {
    sheetWriteQueue = sheetWriteQueue.then(() => task()).catch(err => {
        console.error("❌ Background Sync Error:", err.message);
    });
}

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

// 🛡️ FIXED FUNCTION: Converts input to String to prevent crashes
function getDirectImageLink(url) {
    if (!url) return '';
    const str = String(url).trim(); // Force string

    if (str.startsWith('=IMAGE')) {
        const m = str.match(/"([^"]+)"/);
        if (m) return m[1];
    }
    if (str.match(/\.(jpg|jpeg|png|gif)$/i)) return str;
    
    const id = str.match(/[-\w]{25,}/);
    if (id && str.includes('drive.google.com')) {
        return `https://drive.google.com/thumbnail?id=${id[0]}&sz=w500`;
    }
    return str;
}

function safeKey(str) {
    return str ? String(str).trim().toUpperCase() : '';
}

// === FAST CARD ASSIGNMENT (MEMORY) ===
function getNextAvailableCardInMemory(area) {
    const availableInZone = MEMORY.settings.filter(c => c.zone === area);
    
    availableInZone.sort((a, b) => {
        const numA = parseInt(a.cardId.replace(/\D/g, '')) || 0;
        const numB = parseInt(b.cardId.replace(/\D/g, '')) || 0;
        return numA - numB;
    });

    for (const card of availableInZone) {
        if (!MEMORY.usedCards.has(card.cardId)) {
            return card.cardId;
        }
    }
    return null;
}

// ==========================
// SHEET OPERATIONS (BACKGROUND)
// ==========================

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

async function ensureCardSettingsSheet(sheets) {
    try {
        const metadata = await sheets.spreadsheets.get({ spreadsheetId: WRITE_SPREADSHEET_ID });
        const sheetExists = metadata.data.sheets.some(s => s.properties.title === SETTINGS_SHEET_NAME);

        if (!sheetExists) {
            console.log(`🛠️ Creating '${SETTINGS_SHEET_NAME}'...`);
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: WRITE_SPREADSHEET_ID,
                resource: { requests: [{ addSheet: { properties: { title: SETTINGS_SHEET_NAME } } }] }
            });
            const header = [['CardID', 'Zone']];
            const rows = [];
            for(let i=1; i<=50; i++) rows.push([`DD_${String(i).padStart(2,'0')}`, 'B']);
            for(let i=51; i<=150; i++) rows.push([`DD_${String(i).padStart(2,'0')}`, 'A']);
            await sheets.spreadsheets.values.update({
                spreadsheetId: WRITE_SPREADSHEET_ID,
                range: `'${SETTINGS_SHEET_NAME}'!A1`,
                valueInputOption: 'RAW',
                resource: { values: [...header, ...rows] }
            });
        }
    } catch (e) { console.error("Error ensuring settings sheet:", e); }
}

// ==========================
// 🔄 SYNC & DATA LOADING (DB_DUC_BKU ONLY)
// ==========================

async function refreshStaffCache(sheets) {
    try {
        // 1. Fetch Text Data (A13 to AK)
        const mainRes = await sheets.spreadsheets.values.get({ 
            spreadsheetId: READ_SPREADSHEET_ID, 
            range: `'${READ_SHEET_NAME}'!A13:AK` 
        });

        // 2. Fetch Image Formulas (Column AJ - Index 35)
        const imgRes = await sheets.spreadsheets.values.get({ 
            spreadsheetId: READ_SPREADSHEET_ID, 
            range: `'${READ_SHEET_NAME}'!AJ13:AJ`, 
            valueRenderOption: 'FORMULA' 
        });

        const rows = mainRes.data.values || [];
        const imgRows = imgRes.data.values || [];

        // 3. Map Data
        const staffList = rows.map((r, i) => {
            // === FILTER: ONLY ALLOW "Scan" ===
            // Column Y (Index 24) is "កន្លែងហាត់ការ"
            const internshipStatus = r[24] ? String(r[24]).trim() : '';
            
            // 🛑 STRICT FILTER: If not "Scan", skip this person
            if (internshipStatus !== 'Scan') return null;

            // Priority: Column AK (Index 36) -> ID_DI
            // Fallback: Column B (Index 1) -> Student ID
            let finalID = r[36] ? String(r[36]).trim() : null; 
            if (!finalID) finalID = r[1] ? String(r[1]).trim() : null;

            const nameEN = r[4]; // Col E (Index 4)
            const nameKH = r[3]; // Col D (Index 3)

            if (!finalID && !nameEN) return null;

            // Column AA (Index 26) -> Group_DI
            const group = r[26] ? String(r[26]).trim() : 'Staff'; 

            // Column AJ (Index 35) -> Image
            let rawImg = imgRows[i] ? imgRows[i][0] : '';
            if (!rawImg) rawImg = r[35]; 
            
            // Pass to fixed function
            const image = getDirectImageLink(rawImg);

            return {
                id: finalID,
                name_en: nameEN,
                name_kh: nameKH || nameEN,
                group: group,
                image: image
            };
        }).filter(item => item !== null && item.id !== null);

        // 4. Build Cache Maps
        const idMap = {};
        const nameMap = {};
        
        staffList.forEach(s => {
            if (s.id) idMap[s.id] = s.image;
            if (s.name_en) nameMap[safeKey(s.name_en)] = s.image;
            if (s.name_kh) nameMap[safeKey(s.name_kh)] = s.image;
        });

        MEMORY.staffCache = { data: staffList, idMap, nameMap };
        console.log(`✅ Staff Cache Updated: Loaded ${staffList.length} staff (Filtered: Scan Only)`);

    } catch (e) {
        console.error("❌ Staff fetch error:", e);
    }
}

async function loadInitialData() {
    console.log("🔄 Syncing Data from Google Sheets...");
    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        // 1. Load Settings
        await ensureCardSettingsSheet(sheets);
        const settingsRes = await sheets.spreadsheets.values.get({
            spreadsheetId: WRITE_SPREADSHEET_ID, range: `'${SETTINGS_SHEET_NAME}'!A:B`
        });
        const settingsRows = settingsRes.data.values || [];
        MEMORY.settings = settingsRows.slice(1).map(r => ({ cardId: r[0], zone: r[1] })).filter(s => s.cardId && s.zone);

        // 2. Load Active Breaks (Today)
        const today = await ensureTodaySheet(sheets);
        const breaksRes = await sheets.spreadsheets.values.get({
            spreadsheetId: WRITE_SPREADSHEET_ID, range: `'${today}'!A:I`
        });
        const breakRows = breaksRes.data.values || [];
        
        // Reset Memory
        MEMORY.activeBreaks = [];
        MEMORY.usedCards.clear();

        breakRows.slice(1).forEach((row, i) => {
            if (row[3] && !row[4]) {
                const b = {
                    id: row[0] ? String(row[0]).trim() : null,
                    name: row[1],
                    group: row[2],
                    timeOut: row[3],
                    area: row[5],
                    date: row[6],
                    card: row[8],
                    rowIndex: i + 2, 
                    sheetName: today
                };
                MEMORY.activeBreaks.push(b);
                if (row[8]) MEMORY.usedCards.add(row[8]);
            }
        });

        // 3. Load Staff Data
        await refreshStaffCache(sheets);

        MEMORY.isReady = true;
        console.log(`✅ System Ready! Active Breaks: ${MEMORY.activeBreaks.length}, Used Cards: ${MEMORY.usedCards.size}`);

    } catch (e) {
        console.error("❌ CRITICAL INIT ERROR:", e);
        setTimeout(loadInitialData, 5000);
    }
}

// ==========================
// ROUTES
// ==========================

app.get('/', (req, res) => res.send('Staff Hub API - Fast & Robust'));

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    if(email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
        res.json({ success: true, token: 'admin_secret_token_123' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid Credentials' });
    }
});

app.get('/available-sheets', async (req, res) => {
    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const response = await sheets.spreadsheets.get({ spreadsheetId: WRITE_SPREADSHEET_ID });
        const sheetsList = response.data.sheets;
        const dateSheets = sheetsList.map(s => s.properties.title).filter(title => /^\d{2}-\d{2}-\d{4}$/.test(title));
        res.json(dateSheets);
    } catch (error) { res.status(500).json([]); }
});

app.get('/staff', (req, res) => {
    if (MEMORY.staffCache) res.json(MEMORY.staffCache.data);
    else res.json([]);
});

app.get('/active-breaks', (req, res) => {
    const enrichedBreaks = MEMORY.activeBreaks.map(b => {
        let imgUrl = '';
        if (MEMORY.staffCache) {
            if (b.id && MEMORY.staffCache.idMap[b.id]) imgUrl = MEMORY.staffCache.idMap[b.id];
            else if (b.name && MEMORY.staffCache.nameMap[safeKey(b.name)]) imgUrl = MEMORY.staffCache.nameMap[safeKey(b.name)];
        }
        return { ...b, image: imgUrl };
    });
    res.json(enrichedBreaks);
});

app.get('/cards', (req, res) => {
    res.json(MEMORY.settings);
});

// === REPORT ROUTE ===
app.get('/report', async (req, res) => {
    const { filter } = req.query; 
    if(!filter || filter === 'undefined') return res.json({ raw: [] });
    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        
        const staffCache = MEMORY.staffCache || { idMap: {}, nameMap: {} };

        const metaData = await sheets.spreadsheets.get({ spreadsheetId: WRITE_SPREADSHEET_ID });
        const allSheetNames = metaData.data.sheets.map(s => s.properties.title);
        const sheetsToFetch = allSheetNames.filter(name => name.endsWith(filter));
        
        if(sheetsToFetch.length === 0) return res.json({ raw: [] });
        
        const fetchPromises = sheetsToFetch.map(sheetName => 
            sheets.spreadsheets.values.get({ 
                spreadsheetId: WRITE_SPREADSHEET_ID, 
                range: `'${sheetName}'!A:I` 
            }).then(res => ({ name: sheetName, rows: res.data.values || [] }))
        );
        
        const results = await Promise.all(fetchPromises);
        let aggregatedRows = [];
        
        results.forEach(sheetData => { 
            const sheetRows = sheetData.rows.slice(1).map((r, idx) => ({ ...r, _sheetName: sheetData.name, _rowIndex: idx + 2 }));
            const mappedRows = sheetRows.map(row => {
                const id = row[0] ? String(row[0]).trim() : null;
                const name = row[1];
                let imgUrl = '';
                if (id && staffCache.idMap[id]) imgUrl = staffCache.idMap[id];
                else if (name && staffCache.nameMap[safeKey(name)]) imgUrl = staffCache.nameMap[safeKey(name)];
                return {
                    id: id || 'Unknown', 
                    name: name || 'Unknown', 
                    group: row[2],
                    timeOut: row[3], timeIn: row[4], area: row[5], date: row[6], overtime: row[7],
                    image: imgUrl, _sheetName: row._sheetName, _rowIndex: row._rowIndex    
                };
            });
            aggregatedRows = aggregatedRows.concat(mappedRows);
        });
        res.json({ raw: aggregatedRows });
    } catch (error) { res.json({ raw: [] }); }
});

// === DESTRUCTIVE ADMIN ROUTES ===
app.post('/delete-sheets', async (req, res) => {
    const { sheetNames } = req.body;
    if (!sheetNames || !Array.isArray(sheetNames) || sheetNames.length === 0) return res.status(400).json({ error: 'Missing sheet names' });
    
    queueSheetTask(async () => {
        try {
            const client = await auth.getClient();
            const sheets = google.sheets({ version: 'v4', auth: client });
            const response = await sheets.spreadsheets.get({ spreadsheetId: WRITE_SPREADSHEET_ID });
            const allSheets = response.data.sheets;
            const sheetsToDelete = allSheets.filter(s => sheetNames.includes(s.properties.title));
            
            if (sheetsToDelete.length > 0) {
                if (sheetsToDelete.length === allSheets.length) {
                     await sheets.spreadsheets.batchUpdate({
                        spreadsheetId: WRITE_SPREADSHEET_ID,
                        resource: { requests: [{ addSheet: { properties: { title: `New Sheet ${Date.now()}` } } }] }
                    });
                }
                const deleteRequests = sheetsToDelete.map(s => ({ deleteSheet: { sheetId: s.properties.sheetId } }));
                await sheets.spreadsheets.batchUpdate({ spreadsheetId: WRITE_SPREADSHEET_ID, resource: { requests: deleteRequests } });
            }
            
            await loadInitialData(); 
            // FIX 1: Correct event name
            io.emit('database_updated', { type: 'delete_sheets' });
            res.json({ status: 'success', deletedCount: sheetsToDelete.length });
        } catch (err) {
            res.status(500).json({ status: 'error', message: err.message });
        }
    });
});

app.post('/delete-specific-rows', async (req, res) => {
    const { itemsToDelete } = req.body;
    if (!itemsToDelete || !Array.isArray(itemsToDelete)) return res.status(400).json({ error: 'Missing items' });

    queueSheetTask(async () => {
        try {
            const client = await auth.getClient();
            const sheets = google.sheets({ version: 'v4', auth: client });
            const sheetsMap = {};
            const spreadsheetMeta = await sheets.spreadsheets.get({ spreadsheetId: WRITE_SPREADSHEET_ID });
            const titleToId = {};
            spreadsheetMeta.data.sheets.forEach(s => { titleToId[s.properties.title] = s.properties.sheetId; });
            
            itemsToDelete.forEach(item => {
                const sheetId = titleToId[item.sheetName];
                if (sheetId && item.rowIndex > 1) {
                    if (!sheetsMap[sheetId]) sheetsMap[sheetId] = [];
                    sheetsMap[sheetId].push(item.rowIndex - 1); 
                }
            });
            const requests = [];
            for (const [sheetId, indices] of Object.entries(sheetsMap)) {
                indices.sort((a, b) => b - a);
                indices.forEach(idx => {
                    requests.push({ deleteDimension: { range: { sheetId: parseInt(sheetId), dimension: "ROWS", startIndex: idx, endIndex: idx + 1 } } });
                });
            }
            if (requests.length > 0) await sheets.spreadsheets.batchUpdate({ spreadsheetId: WRITE_SPREADSHEET_ID, resource: { requests } });
            
            await loadInitialData();
            // FIX 2: Correct event name
            io.emit('database_updated', { type: 'delete_rows' });
            res.json({ status: 'success' });
        } catch (err) {
            res.status(500).json({ status: 'error', message: err.message });
        }
    });
});


// ==========================
// ⚡ FAST WRITE ENDPOINTS (RAM + QUEUE)
// ==========================

app.post('/break', async (req, res) => {
    if (!MEMORY.isReady) return res.status(503).json({ error: 'Server starting up...' });

    const { id, name, group, area } = req.body;
    if (!id || !name || !area) return res.status(400).json({ error: 'Missing data' });

    const targetId = String(id).trim();

    const alreadyOut = MEMORY.activeBreaks.find(b => b.id === targetId);
    if (alreadyOut) {
        return res.json({ status: 'success', message: 'User already on break', card: 'ALREADY_OUT' });
    }

    const card = getNextAvailableCardInMemory(area);
    if (!card) {
        return res.status(400).json({ error: 'No available card in this zone' });
    }

    const timeStr = getCurrentTimeString();
    const dateStr = getTodaySheetName();
    
    MEMORY.usedCards.add(card);
    const tempBreakObj = {
        id: targetId,
        name,
        group,
        timeOut: timeStr,
        area,
        date: dateStr,
        card,
        pending: true 
    };
    MEMORY.activeBreaks.push(tempBreakObj);

    res.json({ status: 'success', timeOut: timeStr, card: card });
    
    // FIX 3: Correct event name
    io.emit('database_updated', { type: 'break', id: targetId }); 

    queueSheetTask(async () => {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        
        await ensureTodaySheet(sheets);

        const values = [[
            targetId, name, group || '', timeStr, '', area, dateStr, '', card
        ]];

        const appendRes = await sheets.spreadsheets.values.append({
            spreadsheetId: WRITE_SPREADSHEET_ID,
            range: `'${dateStr}'!A:I`,
            valueInputOption: 'USER_ENTERED',
            resource: { values }
        });

        const updatedRange = appendRes.data.updates.updatedRange; 
        const rowMatch = updatedRange.match(/!A(\d+)/);
        if (rowMatch) {
            const rowIndex = parseInt(rowMatch[1]);
            const memObj = MEMORY.activeBreaks.find(b => b.id === targetId && b.pending === true);
            if (memObj) {
                memObj.rowIndex = rowIndex;
                memObj.sheetName = dateStr;
                delete memObj.pending;
            }
        }
    });
});

app.post('/timein', async (req, res) => {
    if (!MEMORY.isReady) return res.status(503).json({ error: 'Server starting up...' });

    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID required' });
    const targetId = String(id).trim();

    const breakIndex = MEMORY.activeBreaks.findIndex(b => b.id === targetId);
    if (breakIndex === -1) {
        return res.json({ status: 'success', message: 'Already timed in or not found' });
    }

    const breakRecord = MEMORY.activeBreaks[breakIndex];

    const now = getCambodiaDate();
    const diff = Math.floor((now - parseTimeStr(breakRecord.timeOut)) / 60000);
    const overtime = diff > 15 ? `${diff - 15} mins` : '0';
    const timeInStr = getCurrentTimeString();

    if (breakRecord.card) {
        MEMORY.usedCards.delete(breakRecord.card);
    }
    MEMORY.activeBreaks.splice(breakIndex, 1);

    res.json({ status: 'success', timeIn: timeInStr });

    // FIX 4: Correct event name
    io.emit('database_updated', { type: 'timein', id: targetId });

    queueSheetTask(async () => {
        if (!breakRecord.rowIndex || !breakRecord.sheetName) {
            console.log("⚠️ Missing row info for timein, attempting reload...");
            await loadInitialData(); 
            return; 
        }

        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: WRITE_SPREADSHEET_ID,
            resource: { 
                valueInputOption: 'USER_ENTERED', 
                data: [ 
                    { range: `'${breakRecord.sheetName}'!E${breakRecord.rowIndex}`, values: [[timeInStr]] }, 
                    { range: `'${breakRecord.sheetName}'!H${breakRecord.rowIndex}`, values: [[overtime]] } 
                ] 
            }
        });
    });
});

// === SETTINGS MANAGEMENT (RAM + Queue) ===

app.post('/cards/update', async (req, res) => {
    const { cardId, zone } = req.body;
    if (!cardId || !zone) return res.status(400).json({ error: 'Missing Data' });

    const existing = MEMORY.settings.find(s => s.cardId === cardId);
    if (existing) existing.zone = zone;
    else MEMORY.settings.push({ cardId, zone });
    
    res.json({ status: 'success' });

    queueSheetTask(async () => {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        await ensureCardSettingsSheet(sheets);
        
        const r = await sheets.spreadsheets.values.get({ 
             spreadsheetId: WRITE_SPREADSHEET_ID, range: `'${SETTINGS_SHEET_NAME}'!A:B` 
        });
        const rows = r.data.values || [];
        let rowIndex = -1;
        for(let i=0; i<rows.length; i++) {
            if(rows[i][0] === cardId) { rowIndex = i + 1; break; }
        }

        if (rowIndex > -1) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: WRITE_SPREADSHEET_ID,
                range: `'${SETTINGS_SHEET_NAME}'!B${rowIndex}`,
                valueInputOption: 'RAW',
                resource: { values: [[zone]] }
            });
        } else {
            await sheets.spreadsheets.values.append({
                spreadsheetId: WRITE_SPREADSHEET_ID,
                range: `'${SETTINGS_SHEET_NAME}'!A:B`,
                valueInputOption: 'RAW',
                resource: { values: [[cardId, zone]] }
            });
        }
    });
});

app.post('/cards/delete', async (req, res) => {
    const { cardId } = req.body;
    if (!cardId) return res.status(400).json({ error: 'Missing Card ID' });

    const idx = MEMORY.settings.findIndex(s => s.cardId === cardId);
    if (idx > -1) MEMORY.settings.splice(idx, 1);
    
    res.json({ status: 'success' });

    queueSheetTask(async () => {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const r = await sheets.spreadsheets.values.get({ 
            spreadsheetId: WRITE_SPREADSHEET_ID, range: `'${SETTINGS_SHEET_NAME}'!A:A` 
        });
        const rows = r.data.values || [];
        let rowIndex = -1;
        for(let i=0; i<rows.length; i++) {
            if(rows[i][0] === cardId) { rowIndex = i; break; }
        }

        if (rowIndex > -1) {
            const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: WRITE_SPREADSHEET_ID });
            const sheetId = sheetMeta.data.sheets.find(s => s.properties.title === SETTINGS_SHEET_NAME).properties.sheetId;
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: WRITE_SPREADSHEET_ID,
                resource: { requests: [{ deleteDimension: { range: { sheetId: sheetId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1 } } }] }
            });
        }
    });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'alive',
    time: new Date().toISOString()
  });
});

// SOCKET LOGGING
io.on('connection', (socket) => {
    console.log('Device connected:', socket.id);
});

// START SERVER & LOAD DATA
server.listen(PORT, '0.0.0.0', async () => {
    // await syncDIDataToMainDB();
    console.log(`🚀 Server running on port http://localhost:${PORT}`);
    loadInitialData(); // Load all data into RAM once on startup
    
    // Refresh Staff Data every 10 mins in background
    setInterval(async () => {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        refreshStaffCache(sheets);
    }, 10 * 60 * 1000);
});