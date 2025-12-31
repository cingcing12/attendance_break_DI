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
// We store today's state in RAM for instant access.
const MEMORY = {
    activeBreaks: [], // Array of objects { id, name, card, startTime... }
    usedCards: new Set(), // Set of Strings "DD_01" for O(1) lookup
    settings: [],     // Array of { cardId, zone }
    staffCache: null, // Full staff data
    isReady: false    // Prevents requests before initial load
};

// ==========================
// ⚡ SEQUENTIAL WRITE QUEUE
// ==========================
// Replaces the old "Lock" system. This ensures Google Sheets writes happen 
// one by one in the background, while the user gets an instant response.
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

// === FAST CARD ASSIGNMENT (MEMORY) ===
function getNextAvailableCardInMemory(area) {
    // 1. Get cards for zone
    const availableInZone = MEMORY.settings.filter(c => c.zone === area);
    
    // 2. Sort numeric
    availableInZone.sort((a, b) => {
        const numA = parseInt(a.cardId.replace(/\D/g, '')) || 0;
        const numB = parseInt(b.cardId.replace(/\D/g, '')) || 0;
        return numA - numB;
    });

    // 3. Check against In-Memory Used Set (Instant)
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
// SYNC & DATA LOADING
// ==========================

async function refreshStaffCache(sheets) {
    // This preserves your exact logic for fetching staff, groups, and images
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
            if (r[5] && r[5].includes('Scan') && r[12]) {
                const id = r[4] ? String(r[4]).trim() : null;
                if (id) scanMap[safeKey(r[12])] = { id, group: r[6] };
            }
        });

        const idMap = {};
        const nameMap = {};
        
        mainRows.forEach((row, i) => {
            const id = row[1] ? String(row[1]).trim() : null;
            const nameEN = row[4];
            const nameKH = row[3];
            const imgUrl = getDirectImageLink(imgRows[i] ? imgRows[i][0] : '');
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
            
            let finalImg = '';
            if (finalID && idMap[finalID]) finalImg = idMap[finalID];
            else if (nameMap[safeKey(r[4])]) finalImg = nameMap[safeKey(r[4])];

            return {
                id: finalID,
                name_en: nameEN,
                name_kh: r[3] || nameEN,
                group: scan.group || r[26] || 'Staff',
                image: finalImg
            };
        }).filter(Boolean);

        MEMORY.staffCache = { data: staffList, idMap, nameMap };
    } catch(e) { console.error("Staff fetch error", e); }
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
            // Only care about people who haven't returned (TimeIn is empty)
            if (row[3] && !row[4]) {
                const b = {
                    id: row[0] ? String(row[0]).trim() : null,
                    name: row[1],
                    group: row[2],
                    timeOut: row[3],
                    area: row[5],
                    date: row[6],
                    card: row[8],
                    rowIndex: i + 2, // 1-based index, +1 for header
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
        // Retry in 5 seconds if failed
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
    // Serve directly from RAM
    if (MEMORY.staffCache) res.json(MEMORY.staffCache.data);
    else res.json([]);
});

app.get('/active-breaks', (req, res) => {
    // Serve directly from RAM (Enriched with images)
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

// === REPORT ROUTE (Preserved) ===
app.get('/report', async (req, res) => {
    const { filter } = req.query; 
    if(!filter || filter === 'undefined') return res.json({ raw: [] });
    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        
        // We still use MEMORY cache for images to make this faster
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

// === DESTRUCTIVE ADMIN ROUTES (Preserved but now update Memory) ===
app.post('/delete-sheets', async (req, res) => {
    const { sheetNames } = req.body;
    if (!sheetNames || !Array.isArray(sheetNames) || sheetNames.length === 0) return res.status(400).json({ error: 'Missing sheet names' });
    
    // Add to Queue to prevent conflict with active writes
    queueSheetTask(async () => {
        try {
            const client = await auth.getClient();
            const sheets = google.sheets({ version: 'v4', auth: client });
            const response = await sheets.spreadsheets.get({ spreadsheetId: WRITE_SPREADSHEET_ID });
            const allSheets = response.data.sheets;
            const sheetsToDelete = allSheets.filter(s => sheetNames.includes(s.properties.title));
            
            if (sheetsToDelete.length > 0) {
                 // Check if we need to add a default sheet
                if (sheetsToDelete.length === allSheets.length) {
                     await sheets.spreadsheets.batchUpdate({
                        spreadsheetId: WRITE_SPREADSHEET_ID,
                        resource: { requests: [{ addSheet: { properties: { title: `New Sheet ${Date.now()}` } } }] }
                    });
                }
                const deleteRequests = sheetsToDelete.map(s => ({ deleteSheet: { sheetId: s.properties.sheetId } }));
                await sheets.spreadsheets.batchUpdate({ spreadsheetId: WRITE_SPREADSHEET_ID, resource: { requests: deleteRequests } });
            }
            
            // Reload Memory because we might have deleted today's sheet
            await loadInitialData(); 
            io.emit('data_updated');
            res.json({ status: 'success', deletedCount: sheetsToDelete.length });
        } catch (err) {
            console.error(err);
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
            
            // Reload Memory
            await loadInitialData();
            io.emit('data_updated');
            res.json({ status: 'success' });
        } catch (err) {
            console.error(err);
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

    // 1. CHECK MEMORY (Instant) - Prevent Duplicate Users
    const alreadyOut = MEMORY.activeBreaks.find(b => b.id === targetId);
    if (alreadyOut) {
        return res.json({ status: 'success', message: 'User already on break', card: 'ALREADY_OUT' });
    }

    // 2. ASSIGN CARD (Instant) - Prevent Duplicate Cards
    const card = getNextAvailableCardInMemory(area);
    if (!card) {
        return res.status(400).json({ error: 'No available card in this zone' });
    }

    // 3. UPDATE MEMORY (Lock the state immediately)
    const timeStr = getCurrentTimeString();
    const dateStr = getTodaySheetName();
    
    // Reserve the card and user immediately so next request sees it
    MEMORY.usedCards.add(card);
    const tempBreakObj = {
        id: targetId,
        name,
        group,
        timeOut: timeStr,
        area,
        date: dateStr,
        card,
        pending: true // Mark as pending until write confirms
    };
    MEMORY.activeBreaks.push(tempBreakObj);

    // 4. RESPOND TO USER (Fastest possible response)
    res.json({ status: 'success', timeOut: timeStr, card: card });
    io.emit('data_updated'); 

    // 5. BACKGROUND SYNC TO SHEETS (Queue)
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

        // Update the object in memory with the real row index (so we can delete/edit it later)
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

    // 1. FIND IN MEMORY
    const breakIndex = MEMORY.activeBreaks.findIndex(b => b.id === targetId);
    if (breakIndex === -1) {
        return res.json({ status: 'success', message: 'Already timed in or not found' });
    }

    const breakRecord = MEMORY.activeBreaks[breakIndex];

    // 2. CALC OVERTIME
    const now = getCambodiaDate();
    const diff = Math.floor((now - parseTimeStr(breakRecord.timeOut)) / 60000);
    const overtime = diff > 15 ? `${diff - 15} mins` : '0';
    const timeInStr = getCurrentTimeString();

    // 3. UPDATE MEMORY (Release Card Immediately)
    if (breakRecord.card) {
        MEMORY.usedCards.delete(breakRecord.card);
    }
    // Remove from active breaks list
    MEMORY.activeBreaks.splice(breakIndex, 1);

    // 4. RESPOND TO USER
    res.json({ status: 'success', timeIn: timeInStr });
    io.emit('data_updated');

    // 5. BACKGROUND SYNC
    queueSheetTask(async () => {
        // Fallback if sheet info missing (rare)
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

    // Update Memory
    const existing = MEMORY.settings.find(s => s.cardId === cardId);
    if (existing) existing.zone = zone;
    else MEMORY.settings.push({ cardId, zone });
    
    res.json({ status: 'success' }); // Fast response

    // Background Persist
    queueSheetTask(async () => {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        await ensureCardSettingsSheet(sheets);
        
        // Basic strategy: Read all, find row, update/append. 
        // Since we are in the queue, this is safe.
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

    // Update Memory
    const idx = MEMORY.settings.findIndex(s => s.cardId === cardId);
    if (idx > -1) MEMORY.settings.splice(idx, 1);
    
    res.json({ status: 'success' });

    // Background Persist
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
    console.log(`🚀 Server running on port http://localhost:${PORT}`);
    loadInitialData(); // Load all data into RAM once on startup
    
    // Refresh Staff Data every 10 mins in background
    setInterval(async () => {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        refreshStaffCache(sheets);
    }, 10 * 60 * 1000);
});