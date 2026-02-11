require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const http = require('http');
const { Server } = require("socket.io");

// === FIREBASE SETUP ===
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT;
const serviceAccount = JSON.parse(serviceAccountString);

initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();

// === APP SETUP ===
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

app.use(cors());
app.use(express.json());

// === CONFIGURATION ===
const READ_SPREADSHEET_ID = '1h6pqlcoUSKPWsk7it4jFLtg5Oc_w7gXGnKCXSIduK7E';
const READ_SHEET_NAME = 'DB_DUC_BKU';

// === AUTH ===
const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// === MEMORY ===
const MEMORY = {
    staffCache: { data: [], idMap: {}, nameMap: {} },
    cardSettings: [],
    // 🆕 DEFAULT ZONE SETTINGS (Open by default)
    zoneSettings: { zoneA: true, zoneB: true } 
};

// 🔒 RACE CONDITION LOCKS
const processingUsers = new Set(); 
const processingCards = new Set(); 

// ... [KEEP YOUR DATE HELPERS & STAFF CACHE FUNCTIONS HERE] ...
// (getCambodiaDate, getTodayDateString, refreshStaffCache, etc.) - No changes needed there.

function getCambodiaDate() {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Phnom_Penh" }));
}
function getTodayDateString() {
    const d = getCambodiaDate();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`; 
}
function getTodayCollectionName() { return `breaks_${getTodayDateString()}`; }
function getCollectionName(dateStr) { return `breaks_${dateStr}`; }
function getCurrentTimeString() {
    const d = getCambodiaDate();
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function safeKey(str) { return str ? String(str).trim().toUpperCase() : ''; }
function getDirectImageLink(url) {
    if (!url) return '';
    const str = String(url).trim();
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
async function refreshStaffCache() {
    console.log("🔄 Refreshing Staff Cache...");
    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const mainRes = await sheets.spreadsheets.values.get({ spreadsheetId: READ_SPREADSHEET_ID, range: `'${READ_SHEET_NAME}'!A13:AK` });
        const imgRes = await sheets.spreadsheets.values.get({ spreadsheetId: READ_SPREADSHEET_ID, range: `'${READ_SHEET_NAME}'!AJ13:AJ`, valueRenderOption: 'FORMULA' });
        const rows = mainRes.data.values || [];
        const imgRows = imgRes.data.values || [];
        const staffList = rows.map((r, i) => {
            if ((r[24] ? String(r[24]).trim() : '') !== 'Scan') return null;
            let finalID = r[36] ? String(r[36]).trim() : (r[1] ? String(r[1]).trim() : null);
            const nameEN = r[4];
            if (!finalID && !nameEN) return null;
            let rawImg = imgRows[i] ? imgRows[i][0] : (r[35] || '');
            return { id: finalID, name_en: nameEN, name_kh: r[3] || nameEN, group: r[26] ? String(r[26]).trim() : 'Staff', image: getDirectImageLink(rawImg) };
        }).filter(item => item !== null && item.id !== null);
        const idMap = {}; const nameMap = {};
        staffList.forEach(s => {
            if (s.id) idMap[s.id] = s.image;
            if (s.name_en) nameMap[safeKey(s.name_en)] = s.image;
            if (s.name_kh) nameMap[safeKey(s.name_kh)] = s.image;
        });
        MEMORY.staffCache = { data: staffList, idMap, nameMap };
        console.log(`✅ Staff Cache Updated: ${staffList.length} staff loaded.`);
    } catch (e) { console.error("❌ Staff fetch error:", e.message); }
}

// ==========================
// 🆕 ZONE SETTINGS LOGIC (THE FIX)
// ==========================
async function loadZoneSettings() {
    console.log("🔄 Loading Zone Settings...");
    try {
        const docRef = db.collection('settings').doc('zones'); // Use 'zones' document
        const doc = await docRef.get();
        
        if (doc.exists) {
            MEMORY.zoneSettings = doc.data();
            console.log("✅ Zone Settings Loaded from DB:", MEMORY.zoneSettings);
        } else {
            console.log("⚠️ 'zones' document missing. Creating default...");
            const defaultSettings = { zoneA: true, zoneB: true };
            await docRef.set(defaultSettings);
            MEMORY.zoneSettings = defaultSettings;
            console.log("✅ Default Zone Settings Created.");
        }
    } catch (e) {
        console.error("❌ Error loading zone settings:", e);
    }
}

async function getNextAvailableCard(zone) {
    const todayCollection = getTodayCollectionName(); 
    const snapshot = await db.collection(todayCollection).where('status', '==', 'ON_BREAK').where('area', '==', zone).get();
    const usedCards = new Set();
    snapshot.forEach(doc => { if (doc.data().card) usedCards.add(doc.data().card); });
    let availableInZone = MEMORY.cardSettings.filter(c => c.zone === zone);
    if(availableInZone.length === 0) {
        const start = zone === 'B' ? 1 : 51;
        const end = zone === 'B' ? 50 : 150;
        for(let i=start; i<=end; i++) availableInZone.push({ cardId: `DD_${String(i).padStart(2,'0')}` });
    }
    for (const card of availableInZone) {
        if (!usedCards.has(card.cardId) && !processingCards.has(card.cardId)) {
            return card.cardId;
        }
    }
    return null;
}

async function loadCardSettings() {
    try {
        const doc = await db.collection('settings').doc('cards').get();
        if (doc.exists) MEMORY.cardSettings = doc.data().list || [];
        else {
            const defaults = [];
            for(let i=1; i<=50; i++) defaults.push({ cardId: `DD_${String(i).padStart(2,'0')}`, zone: 'B' });
            for(let i=51; i<=150; i++) defaults.push({ cardId: `DD_${String(i).padStart(2,'0')}`, zone: 'A' });
            await db.collection('settings').doc('cards').set({ list: defaults });
            MEMORY.cardSettings = defaults;
        }
    } catch (e) { console.error("Error loading card settings:", e); }
}

// ==========================
// ROUTES
// ==========================

app.get('/', (req, res) => res.send('Staff Hub API - Locked & Loaded 🔒'));

app.get('/available-sheets', async (req, res) => {
    try {
        const collections = await db.listCollections();
        const dates = collections.map(c => c.id).filter(id => id.startsWith('breaks_')).map(id => id.replace('breaks_', ''));
        const today = getTodayDateString();
        if (!dates.includes(today)) dates.push(today);
        res.json(dates);
    } catch (error) { res.json([getTodayDateString()]); }
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) res.json({ success: true, token: 'admin_secret' });
    else res.status(401).json({ success: false, message: 'Invalid Credentials' });
});

app.get('/staff', (req, res) => res.json(MEMORY.staffCache.data));

app.get('/active-breaks', async (req, res) => {
    try {
        const todayCollection = getTodayCollectionName();
        const snapshot = await db.collection(todayCollection).where('status', '==', 'ON_BREAK').get();
        const activeList = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            let imgUrl = '';
            if (data.id && MEMORY.staffCache.idMap[data.id]) imgUrl = MEMORY.staffCache.idMap[data.id];
            else if (data.name && MEMORY.staffCache.nameMap[safeKey(data.name)]) imgUrl = MEMORY.staffCache.nameMap[safeKey(data.name)];
            activeList.push({ ...data, image: imgUrl, docId: doc.id });
        });
        res.json(activeList);
    } catch (error) { res.json([]); }
});

// === 🆕 SETTINGS ROUTES ===

// Get current zone status
app.get('/settings', (req, res) => {
    res.json(MEMORY.zoneSettings);
});

// Update zone status
app.post('/settings/update', async (req, res) => {
    console.log("📥 Received Settings Update:", req.body);
    const { zoneA, zoneB } = req.body;
    
    // Update Memory
    MEMORY.zoneSettings = { zoneA, zoneB };
    
    // Update Firestore
    try {
        await db.collection('settings').doc('zones').set(MEMORY.zoneSettings);
        console.log("💾 Saved settings to DB:", MEMORY.zoneSettings);
        
        // Notify all clients
        io.emit('database_updated', { type: 'settings_updated', settings: MEMORY.zoneSettings });
        
        res.json({ status: 'success', settings: MEMORY.zoneSettings });
    } catch (e) {
        console.error("❌ Failed to save settings:", e);
        res.status(500).json({ error: e.message });
    }
});

// === 🚀 START BREAK (WITH LOCK CHECK) ===
app.post('/break', async (req, res) => {
    const { id, name, group, area } = req.body;
    if (!id || !name || !area) return res.status(400).json({ error: 'Missing data' });
    const targetId = String(id).trim();

    // 🔒 0. ZONE LOCK CHECK
    if (area === 'A' && !MEMORY.zoneSettings.zoneA) {
        return res.json({ status: 'error', message: 'Zone A is currently closed.', card: 'CLOSED' });
    }
    if (area === 'B' && !MEMORY.zoneSettings.zoneB) {
        return res.json({ status: 'error', message: 'Zone B is currently closed.', card: 'CLOSED' });
    }

    if (processingUsers.has(targetId)) return res.json({ status: 'success', message: 'Request already in progress', card: 'PROCESSING' });
    processingUsers.add(targetId);

    let assignedCard = null;
    try {
        const todayCollection = getTodayCollectionName();
        const existing = await db.collection(todayCollection).where('id', '==', targetId).where('status', '==', 'ON_BREAK').get();

        if (!existing.empty) return res.json({ status: 'success', message: 'User already on break', card: 'ALREADY_OUT' });

        assignedCard = await getNextAvailableCard(area);
        if (!assignedCard) return res.status(400).json({ error: 'No available card in this zone' });

        processingCards.add(assignedCard);
        const timeStr = getCurrentTimeString();
        const dateStr = getTodayDateString();

        const newDoc = {
            id: targetId, name, group: group || '', timeOut: timeStr, timeOutDate: Timestamp.now(), area, dateString: dateStr, card: assignedCard, status: 'ON_BREAK', overtime: '0', timeIn: ''
        };

        await db.collection(todayCollection).add(newDoc);
        res.json({ status: 'success', timeOut: timeStr, card: assignedCard });
        io.emit('database_updated', { type: 'break', id: targetId });

    } catch (e) {
        console.error("Break Error:", e);
        res.status(500).json({ error: e.message });
    } finally {
        processingUsers.delete(targetId);
        if (assignedCard) processingCards.delete(assignedCard);
    }
});

// ... [KEEP TIMEIN, STATS, CARD SETTINGS, REPORT, ETC.] ...
// (No changes needed for timein, stats, etc.)

app.post('/timein', async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID required' });
    const targetId = String(id).trim();

    if (processingUsers.has(targetId)) return res.json({ status: 'success', message: 'Processing...' });
    processingUsers.add(targetId);

    try {
        const todayCollection = getTodayCollectionName();
        const snapshot = await db.collection(todayCollection).where('id', '==', targetId).where('status', '==', 'ON_BREAK').limit(1).get();

        if (snapshot.empty) return res.json({ status: 'success', message: 'Already timed in' });

        const doc = snapshot.docs[0];
        const data = doc.data();

        const now = new Date();
        const timeOutDate = data.timeOutDate.toDate();
        const diffMins = Math.floor((now - timeOutDate) / 60000);
        const overtime = diffMins > 15 ? `${diffMins - 15} mins` : '0';
        const timeInStr = getCurrentTimeString();

        await db.collection(todayCollection).doc(doc.id).update({
            timeIn: timeInStr,
            timeInDate: Timestamp.now(),
            overtime: overtime,
            status: 'FINISHED'
        });

        res.json({ status: 'success', timeIn: timeInStr });
        io.emit('database_updated', { type: 'timein', id: targetId });

    } catch (e) {
        console.error("Timein Error:", e);
        res.status(500).json({ error: e.message });
    } finally {
        processingUsers.delete(targetId);
    }
});

app.get('/stats/today', async (req, res) => {
    try {
        const todayCollection = getTodayCollectionName();
        const snapshot = await db.collection(todayCollection).get();
        const uniqueIds = new Set();
        let totalRecords = 0;
        let totalOT = 0;
        snapshot.forEach(doc => {
            const data = doc.data();
            totalRecords++;
            uniqueIds.add(data.id);
            if (data.overtime && data.overtime !== '0') totalOT++;
        });
        res.json({ staff_today: uniqueIds.size, total_records: totalRecords, total_ot: totalOT });
    } catch (error) { res.json({ staff_today: 0, total_records: 0, total_ot: 0 }); }
});

app.get('/cards', (req, res) => res.json(MEMORY.cardSettings));

app.post('/cards/update', async (req, res) => {
    const { cardId, zone } = req.body;
    const existing = MEMORY.cardSettings.find(s => s.cardId === cardId);
    if (existing) existing.zone = zone;
    else MEMORY.cardSettings.push({ cardId, zone });
    await db.collection('settings').doc('cards').set({ list: MEMORY.cardSettings });
    res.json({ status: 'success' });
});

app.post('/cards/delete', async (req, res) => {
    const { cardId } = req.body;
    const idx = MEMORY.cardSettings.findIndex(s => s.cardId === cardId);
    if (idx > -1) {
        MEMORY.cardSettings.splice(idx, 1);
        await db.collection('settings').doc('cards').set({ list: MEMORY.cardSettings });
    }
    res.json({ status: 'success' });
});

app.get('/report', async (req, res) => {
    const { filter } = req.query; 
    if(!filter) return res.json({ raw: [] });
    try {
        const targetCollection = getCollectionName(filter);
        const snapshot = await db.collection(targetCollection).get();
        const rows = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            let imgUrl = '';
            if (data.id && MEMORY.staffCache.idMap[data.id]) imgUrl = MEMORY.staffCache.idMap[data.id];
            rows.push({ ...data, image: imgUrl, docId: doc.id });
        });
        res.json({ raw: rows });
    } catch (e) { res.json({ raw: [] }); }
});

app.post('/delete-specific-rows', async (req, res) => {
    const { date, docId } = req.body; 
    try {
        const collectionName = getCollectionName(date);
        await db.collection(collectionName).doc(docId).delete();
        res.json({ status: 'success' });
        io.emit('database_updated', { type: 'delete' }); 
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/delete-sheets', async (req, res) => {
    const { sheetNames } = req.body;
    try {
        for (const dateStr of sheetNames) {
            const collectionRef = db.collection(`breaks_${dateStr}`);
            const snapshot = await collectionRef.get();
            if (snapshot.size === 0) continue;
            const batch = db.batch();
            snapshot.docs.forEach((doc) => batch.delete(doc.ref));
            await batch.commit();
        }
        res.json({ status: 'success' });
        io.emit('database_updated', { type: 'delete_sheets' });
    } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

server.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Firebase Server (Secure) running on port ${PORT}`);
    await loadCardSettings();
    await loadZoneSettings(); // <--- THIS WILL CREATE THE DOC FOR YOU!
    await refreshStaffCache();
    setInterval(refreshStaffCache, 10 * 60 * 1000);
});