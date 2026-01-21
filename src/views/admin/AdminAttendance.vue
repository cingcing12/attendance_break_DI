<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { Calendar, Search, RefreshCw, Printer, X, Download, FileText, MapPin, Trash2, Filter } from 'lucide-vue-next';
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import Swal from 'sweetalert2';
import { io } from "socket.io-client"; 
import CustomToast from '../../components/CustomToast.vue';

const API_URL = import.meta.env.DEV 
        ? "http://localhost:3000" 
        : "https://attendance-break-di-vsc6.onrender.com";

const reportData = ref([]);
const availableSheets = ref([]);

// State for Dashboard View
const viewMode = ref('daily');
const viewDate = ref('');
const viewZone = ref('all');
const viewStatus = ref('all'); // 🆕 NEW: Filter by Status
const searchTerm = ref('');
const toast = ref({ show: false, type: 'info', title: '', message: '' });

// State for Print Modal
const showPrintModal = ref(false);
const printConfig = ref({ 
    mode: 'daily', 
    zone: 'all', 
    date: '' 
});
const printStaging = ref(null);

// --- SOCKET STATE ---
const socket = ref(null);
const isConnected = ref(false); 
const isSyncing = ref(false);

// --- PROCESSING STATE ---
const processing = ref({
    active: false,
    message: '',
    progress: 0,
    canCancel: false
});
const abortController = ref(null);

// --- HELPERS ---
const triggerToast = (type, title, message) => {
    toast.value = { show: true, type, title, message };
};

const startProcessing = (msg, cancelable = false) => {
    if (abortController.value) abortController.value.abort();
    abortController.value = new AbortController();
    processing.value = { active: true, message: msg, progress: 0, canCancel: cancelable };
};

const stopProcessing = () => {
    processing.value = { active: false, message: '', progress: 0, canCancel: false };
    abortController.value = null;
};

// --- DATA FETCHING ---
const loadSheets = async () => {
    try {
        const res = await fetch(`${API_URL}/available-sheets`);
        let sheets = await res.json();
        
        if(sheets.length === 0) {
            const today = new Date();
            const d = String(today.getDate()).padStart(2, '0');
            const m = String(today.getMonth()+1).padStart(2, '0');
            const y = today.getFullYear();
            sheets = [`${d}-${m}-${y}`];
        }
        
        // Sort descending (newest first)
        sheets.sort((a, b) => {
            const [da, ma, ya] = a.split('-').map(Number);
            const [db, mb, yb] = b.split('-').map(Number);
            return new Date(yb, mb - 1, db) - new Date(ya, ma - 1, da);
        });
        availableSheets.value = sheets;
    } catch(e) { console.error(e); }
};

const getOptions = (mode) => {
    if(!availableSheets.value.length) return [];
    if(mode === 'daily') return [...availableSheets.value]; 
    
    // Extract unique MM-YYYY
    if(mode === 'monthly') {
        const months = availableSheets.value.map(s => {
            const parts = s.split('-'); // 20-01-2026
            return `${parts[1]}-${parts[2]}`; // 01-2026
        });
        return [...new Set(months)];
    }
    
    // Extract unique YYYY
    if(mode === 'yearly') {
        const years = availableSheets.value.map(s => s.split('-')[2]);
        return [...new Set(years)];
    }
    return [];
};

const viewDateOptions = computed(() => getOptions(viewMode.value));
const printDateOptions = computed(() => getOptions(printConfig.value.mode));

// --- ROBUST DATA LOADER (UPDATED FOR AGGREGATION) ---
const loadReport = async (silent = false) => {
    if (!viewDate.value) return;
    
    if (silent) isSyncing.value = true;
    if (!silent) startProcessing('Fetching Data...', false); 

    try {
        const signal = (!silent && abortController.value) ? abortController.value.signal : null;
        let fetchedData = [];

        // 🆕 NEW LOGIC: Handle Aggregation for Month/Year
        let targets = [];

        if (viewMode.value === 'daily') {
            targets = [viewDate.value];
        } else if (viewMode.value === 'monthly') {
            // viewDate is "01-2026", find all "DD-01-2026"
            targets = availableSheets.value.filter(sheet => sheet.endsWith(viewDate.value));
        } else if (viewMode.value === 'yearly') {
            // viewDate is "2026", find all "DD-MM-2026"
            targets = availableSheets.value.filter(sheet => sheet.endsWith(viewDate.value));
        }

        if (targets.length === 0) {
            reportData.value = [];
            return;
        }

        // Fetch all matching days concurrently
        const promises = targets.map(dateStr => 
            fetch(`${API_URL}/report?filter=${dateStr}`, { signal })
                .then(res => res.json())
                .then(json => json.raw || [])
                .catch(() => [])
        );

        const results = await Promise.all(promises);
        // Flatten array
        fetchedData = results.flat();

        // 2. FAST MERGE (Active Breaks) - Only relevant if today is involved
        if (viewMode.value === 'daily' && silent) {
            try {
                const todayStr = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
                if(viewDate.value === todayStr) {
                    const activeRes = await fetch(`${API_URL}/active-breaks`);
                    const activeData = await activeRes.json();
                    activeData.forEach(activeRow => {
                        const exists = fetchedData.some(r => r.docId === activeRow.docId);
                        if (!exists) {
                            fetchedData.unshift({ ...activeRow, timeIn: '', overtime: '0' });
                        }
                    });
                }
            } catch(err) { console.log("RAM fetch skipped"); }
        }

        reportData.value = fetchedData;

        if (!silent) {
            processing.value.progress = 100;
            await new Promise(r => setTimeout(r, 300));
        }
    } catch(e) { 
        if (e.name !== 'AbortError') {
            console.error("Fetch Error:", e);
            if (!silent) triggerToast('error', 'Connection Error', 'Failed to fetch data.');
        }
    } finally {
        if (!silent) stopProcessing();
        isSyncing.value = false;
    }
};

// --- WATCHERS ---
watch(availableSheets, (newSheets) => {
    if (newSheets.length > 0) {
        if (!viewDate.value) viewDate.value = newSheets[0];
        if (!printConfig.value.date) {
            printConfig.value.date = newSheets[0];
            if(!printConfig.value.mode) printConfig.value.mode = 'daily';
        }
    }
});

watch(viewDate, (newVal) => { if (newVal) loadReport(false); });

watch(viewMode, async () => {
    await nextTick();
    const opts = viewDateOptions.value;
    if (opts.length > 0) {
        // Only reset if current value is invalid for new mode
        if (!opts.includes(viewDate.value)) viewDate.value = opts[0];
        else loadReport(false);
    } else {
        viewDate.value = '';
        reportData.value = [];
    }
});

watch(() => printConfig.value.mode, () => {
    const opts = getOptions(printConfig.value.mode);
    if (opts.length > 0 && !opts.includes(printConfig.value.date)) printConfig.value.date = opts[0];
});

// --- SOCKET ---
onMounted(() => { 
    loadSheets().then(() => loadReport(false)); 
    socket.value = io(API_URL, { transports: ['websocket', 'polling'], reconnectionAttempts: 5 });
    socket.value.on("connect", () => { isConnected.value = true; triggerToast('success', 'Connected', 'Real-time connection established.'); });
    socket.value.on("disconnect", () => { isConnected.value = false; triggerToast('warning', 'Disconnected', 'Lost connection to server.'); });
    socket.value.on("database_updated", () => { isSyncing.value = true; loadReport(true); setTimeout(() => loadReport(true), 1000); });
});

onUnmounted(() => { if (socket.value) socket.value.disconnect(); });

// --- COMPUTED FILTERS (UPDATED) ---
const baseFilteredData = computed(() => {
    let data = reportData.value;
    
    // 1. Text Search
    if (searchTerm.value) {
        const lower = searchTerm.value.toLowerCase();
        data = data.filter(item => (item.name && item.name.toLowerCase().includes(lower)) || (item.id && String(item.id).toLowerCase().includes(lower)));
    }
    
    // 2. Zone Filter
    if (viewZone.value !== 'all') {
        const target = viewZone.value.toLowerCase().trim();
        data = data.filter(item => String(item.area || '').toLowerCase().trim() === target);
    }

    // 🆕 3. Status Filter (Active/Finished)
    if (viewStatus.value === 'active') {
        // Show rows where timeIn is missing or empty
        data = data.filter(item => !item.timeIn || item.timeIn === '');
    } else if (viewStatus.value === 'finished') {
        // Show rows where timeIn exists
        data = data.filter(item => item.timeIn && item.timeIn !== '');
    }

    return data;
});

const dailyGroupedData = computed(() => {
    // Only group by person for daily view
    if (viewMode.value !== 'daily') return [];
    
    const groups = {};
    baseFilteredData.value.forEach(row => {
        if (!groups[row.id]) groups[row.id] = { id: row.id, name: row.name, group: row.group, image: row.image, breaks: [] };
        groups[row.id].breaks.push(row);
    });
    
    // Sort by most recent break time
    return Object.values(groups).sort((a,b) => {
        const lastA = a.breaks[a.breaks.length-1].timeOut || '';
        const lastB = b.breaks[b.breaks.length-1].timeOut || '';
        return lastB.localeCompare(lastA);
    });
});

const summaryTableData = computed(() => {
    // For Monthly/Yearly OR if filtering, show table
    // If daily view but user applied status filter, simple table might be better? 
    // Keeping logic: Daily = Cards, Monthly/Yearly = Table.
    if (viewMode.value === 'daily') return [];
    
    const map = {};
    baseFilteredData.value.forEach(row => {
        if (!map[row.id]) map[row.id] = { ...row, breakCount: 0, otCount: 0 };
        map[row.id].breakCount++;
        if (row.overtime && row.overtime !== '0') map[row.id].otCount++;
    });
    return Object.values(map).sort((a,b) => b.breakCount - a.breakCount);
});

// --- ACTIONS ---
const confirmDeleteRow = (docId, dateString) => {
    if(!docId) return triggerToast('error', 'Error', 'Cannot delete: Missing Document ID');
    Swal.fire({
        title: 'Delete Record?', text: "This break entry will be removed permanently.", icon: 'warning',
        showCancelButton: true, confirmButtonColor: '#e11d48', cancelButtonColor: '#333', confirmButtonText: 'Yes, Delete',
        background: '#121212', color: '#fff', customClass: { popup: 'border border-white/10 rounded-2xl' }
    }).then((result) => { if (result.isConfirmed) deleteRow(docId, dateString); });
};

const deleteRow = async (docId, dateString) => {
    const originalData = [...reportData.value]; 
    reportData.value = reportData.value.filter(item => item.docId !== docId);
    triggerToast('success', 'Deleted', 'Record removed.');
    try {
        const res = await fetch(`${API_URL}/delete-specific-rows`, {
            method: 'POST', headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify({ date: dateString, docId: docId })
        });
        const data = await res.json();
        if(data.status !== 'success') throw new Error(data.message || 'Server error');
    } catch(e) { 
        reportData.value = originalData; 
        triggerToast('error', 'Error', e.message); 
    } 
};

// --- PDF EXPORT (Unchanged Logic, uses Aggregation) ---
const openPrintModal = () => { showPrintModal.value = true; };
const generatePDF = async () => {
    // ... (Keep existing PDF generation logic, ensuring aggregation works same as loadReport)
    if (!printConfig.value.date) return triggerToast('error', 'Error', 'Select a date.');
    showPrintModal.value = false;
    startProcessing('Preparing Data...', false);
    
    try {
        processing.value.progress = 5;
        
        // 🆕 AGGREGATION LOGIC FOR PDF
        let targets = [];
        if (printConfig.value.mode === 'daily') targets = [printConfig.value.date];
        else if (printConfig.value.mode === 'monthly') targets = availableSheets.value.filter(s => s.endsWith(printConfig.value.date));
        else targets = availableSheets.value.filter(s => s.endsWith(printConfig.value.date));

        const promises = targets.map(d => fetch(`${API_URL}/report?filter=${d}`).then(r=>r.json()).then(j=>j.raw||[]));
        const results = await Promise.all(promises);
        let data = results.flat();

        if (data.length === 0) throw new Error(`No data found`);
        if (printConfig.value.zone !== 'all') {
            const t = printConfig.value.zone.toLowerCase().trim();
            data = data.filter(i => String(i.area || '').toLowerCase().trim() === t);
        }

        processing.value.progress = 15;
        const staffRes = await fetch(`${API_URL}/staff`);
        const staffList = await staffRes.json();

        // Grouping
        const aggregation = {};
        data.forEach(log => {
            if (!aggregation[log.id]) {
                const s = staffList.find(x => x.id == log.id);
                aggregation[log.id] = {
                    id: log.id,
                    name: s ? (s.name_kh || s.name_en) : log.name,
                    group: s ? (s.group || log.group) : log.group,
                    breakCount: 0, otCount: 0 
                };
            }
            aggregation[log.id].breakCount++;
            if (log.overtime && log.overtime !== '0') aggregation[log.id].otCount++;
        });

        const allRows = Object.values(aggregation).sort((a, b) => b.breakCount - a.breakCount);
        // ... (PDF Rendering Logic same as before)
        const rowsPerPage = 26; 
        const pages = [];
        let remaining = [...allRows];
        let rowCounter = 1; 
        while(remaining.length > 0) {
            pages.push(remaining.slice(0, rowsPerPage).map(r => ({...r, index: rowCounter++})));
            remaining = remaining.slice(rowsPerPage);
        }

        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = 210;
        
        for (let i = 0; i < pages.length; i++) {
            printStaging.value.innerHTML = generatePageHTML(pages[i], i + 1, pages.length);
            await nextTick(); await new Promise(r => setTimeout(r, 50)); 
            const canvas = await html2canvas(printStaging.value.querySelector('.print-page'), { scale: 2, useCORS: true, logging: false, backgroundColor: "#ffffff" });
            const imgData = canvas.toDataURL('image/png');
            if (i > 0) pdf.addPage();
            const props = pdf.getImageProperties(imgData);
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, (props.height * pdfWidth) / props.width);
            processing.value.progress = 15 + Math.round(((i + 1) / pages.length) * 75);
        }

        processing.value.progress = 100;
        pdf.save(`Report_${printConfig.value.date}.pdf`);
        triggerToast('success', 'Success', 'PDF Downloaded.');
    } catch(e) {
        triggerToast('error', 'Failed', e.message);
    } finally {
        if(printStaging.value) printStaging.value.innerHTML = '';
        stopProcessing();
    }
};

const generatePageHTML = (rows, pageNum, totalPages) => {
    const dateStr = printConfig.value.date;
    const zoneStr = printConfig.value.zone === 'all' ? 'All Zones' : `Zone ${printConfig.value.zone}`;
    const timestamp = new Date().toLocaleString('en-US');
    const rowsHTML = rows.map((row, idx) => `
        <tr style="background-color: ${idx % 2 === 0 ? '#fff' : '#f8fafc'};">
            <td style="padding: 12px; text-align: center; border: 1px solid #e2e8f0; font-weight: bold; color: #64748b;">${row.index}</td>
            <td style="padding: 12px; border: 1px solid #e2e8f0; font-family: monospace; font-weight: bold; color: #0f172a;">${row.id}</td>
            <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: bold; color: #334155;">${row.name}</td>
            <td style="padding: 12px; border: 1px solid #e2e8f0; color: #475569;">${row.group}</td>
            <td style="padding: 12px; text-align: center; border: 1px solid #e2e8f0; font-weight: bold; color: #334155;">${row.breakCount > 0 ? row.breakCount + ' ដង' : '-'}</td>
            <td style="padding: 12px; text-align: center; border: 1px solid #e2e8f0; font-weight: bold; color: ${row.otCount > 0 ? '#e11d48' : '#94a3b8'};">${row.otCount > 0 ? row.otCount + ' ដង' : '-'}</td>
        </tr>
    `).join('');
    return `
        <div class="print-page" style="width: 1200px; height: 1697px; background: white; padding: 60px; font-family: 'Noto Sans Khmer', sans-serif; box-sizing: border-box;">
            <div style="display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #4f46e5; padding-bottom: 20px; margin-bottom: 30px;">
                <div>
                    <h1 style="font-size: 36px; font-weight: 800; color: #1e293b; margin: 0;">Staff Attendance Report</h1>
                    <div style="display: flex; gap: 20px; margin-top: 10px;">
                        <span style="font-size: 18px; color: #64748b;">Period: <b style="color: #4f46e5;">${dateStr}</b></span>
                        <span style="font-size: 18px; color: #64748b;">Zone: <b style="color: #4f46e5;">${zoneStr}</b></span>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 14px; color: #94a3b8;">Generated on</div>
                    <div style="font-size: 16px; font-weight: bold; color: #334155;">${timestamp}</div>
                </div>
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 16px; border: 2px solid #0f172a;">
                <thead>
                    <tr style="background-color: #0f172a; color: white;">
                        <th style="padding: 15px; border: 1px solid #334155;">លរ.</th>
                        <th style="padding: 15px; border: 1px solid #334155;">ID</th>
                        <th style="padding: 15px; border: 1px solid #334155; text-align: left;">ឈ្មោះ</th>
                        <th style="padding: 15px; border: 1px solid #334155; text-align: left;">ក្រុម</th>
                        <th style="padding: 15px; border: 1px solid #334155;">ចំនួនសម្រាក</th>
                        <th style="padding: 15px; border: 1px solid #334155;">ចំនួនលើសម៉ោង</th>
                    </tr>
                </thead>
                <tbody>${rowsHTML}</tbody>
            </table>
             <div style="margin-top: 20px; text-align: right; border-top: 1px solid #e2e8f0; padding-top: 10px; color: #94a3b8; font-size: 12px;">
                Page ${pageNum} of ${totalPages} • Staff Hub System
            </div>
        </div>
    `;
};

onMounted(() => { loadSheets().then(() => loadReport(false)); });
</script>

<template>
    <div class="pb-20"> 
        <div class="max-w-[1600px] mx-auto animate-fade-in">
            <header class="flex flex-col xl:flex-row justify-between xl:items-end mb-8 gap-4">
                <div>
                    <h2 class="text-3xl font-bold text-white font-khmer mb-2">បញ្ជីវត្តមាន (Attendance)</h2>
                    <div class="flex items-center gap-3">
                        <p class="text-slate-400 text-sm">View logs and generate reports</p>
                        <div class="flex items-center gap-1.5 px-2 py-1 rounded-full border transition-all"
                             :class="isConnected ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20'">
                            <span class="relative flex h-2 w-2">
                              <span v-if="isConnected" class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span class="relative inline-flex rounded-full h-2 w-2" :class="isConnected ? 'bg-emerald-500' : 'bg-rose-500'"></span>
                            </span>
                            <span class="text-[10px] font-bold uppercase tracking-wider" :class="isConnected ? 'text-emerald-400' : 'text-rose-400'">
                                {{ isConnected ? 'Real-Time' : 'Offline' }}
                            </span>
                        </div>
                        <div v-if="isSyncing" class="flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 animate-pulse">
                            <RefreshCw class="w-3 h-3 text-blue-400 animate-spin" />
                            <span class="text-[10px] font-bold text-blue-400 uppercase">Syncing</span>
                        </div>
                    </div>
                </div>
                
                <div class="w-full xl:w-auto bg-[#121212] p-1.5 rounded-2xl border border-white/10 flex flex-col md:flex-row md:items-center gap-2">
                    
                    <div class="flex bg-white/5 p-1 rounded-xl">
                        <button @click="viewMode='daily'" :class="['flex-1 px-4 py-1.5 rounded-lg text-xs font-bold transition-all h-9', viewMode==='daily' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white']">Day</button>
                        <button @click="viewMode='monthly'" :class="['flex-1 px-4 py-1.5 rounded-lg text-xs font-bold transition-all h-9', viewMode==='monthly' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white']">Month</button>
                        <button @click="viewMode='yearly'" :class="['flex-1 px-4 py-1.5 rounded-lg text-xs font-bold transition-all h-9', viewMode==='yearly' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white']">Year</button>
                    </div>

                    <div class="grid grid-cols-2 md:flex items-center gap-2">
                        <div class="relative group bg-black/30 border border-white/10 hover:border-white/20 rounded-xl px-0 flex items-center h-10 w-full md:w-36 transition-colors">
                            <select v-model="viewDate" class="bg-transparent text-white text-xs font-bold w-full h-full outline-none appearance-none font-mono cursor-pointer relative z-10 pl-3 pr-10">
                                <option v-for="opt in viewDateOptions" :key="opt" :value="opt">{{ opt }}</option>
                            </select>
                            <Calendar class="w-4 h-4 text-slate-500 absolute right-3 pointer-events-none group-hover:text-indigo-400 transition-colors" />
                        </div>

                        <div class="relative group bg-black/30 border border-white/10 hover:border-white/20 rounded-xl px-0 flex items-center h-10 w-full md:w-32 transition-colors">
                            <select v-model="viewZone" class="bg-transparent text-white text-xs font-bold w-full h-full outline-none appearance-none font-mono cursor-pointer relative z-10 pl-3 pr-10">
                                <option value="all">All Zones</option>
                                <option value="A">Zone A</option>
                                <option value="B">Zone B</option>
                            </select>
                            <MapPin class="w-4 h-4 text-slate-500 absolute right-3 pointer-events-none group-hover:text-indigo-400 transition-colors" />
                        </div>
                    </div>

                    <div class="relative group bg-black/30 border border-white/10 hover:border-white/20 rounded-xl px-0 flex items-center h-10 w-full md:w-32 transition-colors">
                        <select v-model="viewStatus" class="bg-transparent text-white text-xs font-bold w-full h-full outline-none appearance-none font-mono cursor-pointer relative z-10 pl-3 pr-10">
                            <option value="all">All Status</option>
                            <option value="active">On Break</option>
                            <option value="finished">Finished</option>
                        </select>
                        <Filter class="w-4 h-4 text-slate-500 absolute right-3 pointer-events-none group-hover:text-indigo-400 transition-colors" />
                    </div>

                    <div class="flex items-center gap-2 w-full md:w-auto">
                        <div class="relative group bg-black/30 border border-white/10 hover:border-white/20 rounded-xl px-3 flex items-center h-10 w-full md:w-48 transition-colors">
                            <Search class="w-4 h-4 text-slate-500 mr-2 group-hover:text-indigo-400 transition-colors" />
                            <input v-model="searchTerm" type="text" placeholder="Search..." class="bg-transparent text-white text-xs font-bold w-full h-full outline-none placeholder:text-slate-600">
                        </div>

                        <button @click="loadReport(false)" class="bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white rounded-xl h-10 w-10 flex items-center justify-center border border-white/10 transition-colors">
                            <RefreshCw class="w-4 h-4"/>
                        </button>
                        <button @click="openPrintModal" class="bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl h-10 w-10 flex items-center justify-center shadow-lg shadow-indigo-900/20 transition-colors">
                            <Printer class="w-4 h-4"/>
                        </button>
                    </div>
                </div>
            </header>

            <div v-if="viewMode === 'daily'">
                <div v-if="dailyGroupedData.length === 0 && !processing.active" class="p-20 text-center flex flex-col items-center justify-center text-slate-500 font-khmer bg-[#121212] rounded-3xl border border-white/5">
                    <div class="bg-white/5 p-4 rounded-full mb-4"><FileText class="w-8 h-8 opacity-50"/></div>
                    <span class="mb-4">មិនមានទិន្នន័យសម្រាប់កាលបរិច្ឆេទនេះទេ។</span>
                    <button @click="loadReport(false)" class="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-slate-300 font-bold transition-all border border-white/10">
                        ព្យាយាមម្តងទៀត (Retry)
                    </button>
                </div>
                
                <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
                    <div v-for="staff in dailyGroupedData" :key="staff.id" class="glass-panel p-5 rounded-3xl border border-white/5 hover:border-white/10 transition-all duration-300 group bg-[#121212] relative overflow-hidden">
                        <div class="flex items-center gap-4 mb-4 relative z-10">
                            <div class="relative shrink-0">
                                <img :src="staff.image || `https://ui-avatars.com/api/?background=random&color=fff&name=${encodeURIComponent(staff.name)}`" 
                                     class="w-14 h-14 rounded-full object-cover bg-slate-800 border-2 border-white/5 group-hover:border-indigo-500/50 transition-colors">
                            </div>
                            <div class="overflow-hidden">
                                <h4 class="text-white font-bold text-sm truncate font-khmer tracking-wide">{{ staff.name }}</h4>
                                <div class="flex items-center gap-2 mt-1">
                                    <span class="text-slate-400 text-[10px] font-bold font-mono bg-white/5 px-1.5 py-0.5 rounded border border-white/5">ID: {{ staff.id }}</span>
                                    <span class="text-slate-500 text-[10px] truncate uppercase tracking-wider">{{ staff.group }}</span>
                                </div>
                            </div>
                        </div>

                        <div class="bg-black/40 rounded-xl p-3 border border-white/5 space-y-3 relative z-10">
                            <div v-for="(b, i) in staff.breaks" :key="i" class="relative pl-3 border-l border-white/10 last:border-0 group/item">
                                <div class="absolute left-[-4px] top-1.5 w-2 h-2 rounded-full" 
                                     :class="b.timeIn ? 'bg-emerald-500' : 'bg-indigo-500 animate-pulse'"></div>
                                
                                <div class="flex justify-between items-start text-xs">
                                    <div class="flex flex-col gap-0.5">
                                        <div class="flex items-center gap-2">
                                            <span class="text-slate-300 font-mono font-bold">{{ b.timeOut }}</span>
                                            <span class="text-slate-600 text-[10px]">OUT</span>
                                        </div>
                                        <div class="flex items-center gap-2">
                                            <span class="font-mono font-bold" :class="b.timeIn ? 'text-emerald-400' : 'text-slate-600'">
                                                {{ b.timeIn || '--:--' }}
                                            </span>
                                            <span class="text-slate-600 text-[10px]">IN</span>
                                        </div>
                                    </div>

                                    <div class="text-right flex flex-col items-end gap-1">
                                        <span v-if="b.overtime && b.overtime !== '0'" class="text-[10px] text-rose-400 font-bold bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                                            +{{ b.overtime }}m
                                        </span>
                                        <button @click="confirmDeleteRow(b.docId, b.dateString)" 
                                                class="text-slate-600 hover:text-rose-500 transition-colors p-1 rounded hover:bg-rose-500/10" 
                                                title="Delete this break">
                                            <Trash2 class="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </div>

            <div v-else class="bg-[#121212] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
                <div v-if="summaryTableData.length === 0 && !processing.active" class="p-20 text-center text-slate-500 font-khmer">
                    <div class="mb-4">មិនមានទិន្នន័យសម្រាប់កាលបរិច្ឆេទនេះទេ។</div>
                    <button @click="loadReport(false)" class="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-slate-300 font-bold transition-all border border-white/10">
                        ព្យាយាមម្តងទៀត (Retry)
                    </button>
                </div>
                
                <div v-else class="overflow-x-auto">
                    <table class="w-full text-left text-sm text-slate-400">
                        <thead class="bg-white/5 text-xs uppercase font-bold text-slate-300 font-khmer">
                            <tr>
                                <th class="px-6 py-4">Name</th>
                                <th class="px-6 py-4">Group</th>
                                <th class="px-6 py-4 text-center">Breaks Count</th>
                                <th class="px-6 py-4 text-center">Overtime Count</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-white/5">
                            <tr v-for="(row, idx) in summaryTableData" :key="idx" class="hover:bg-white/5 transition-colors group">
                                <td class="px-6 py-4">
                                    <div class="font-bold text-white font-khmer">{{ row.name }}</div>
                                    <div class="text-xs text-slate-600 font-mono">ID: {{ row.id }}</div>
                                </td>
                                <td class="px-6 py-4"><span class="bg-white/10 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider">{{ row.group }}</span></td>
                                <td class="px-6 py-4 text-center font-bold text-white">{{ row.breakCount > 0 ? row.breakCount + ' ដង' : '-' }}</td>
                                <td class="px-6 py-4 text-center">
                                    <span v-if="row.otCount > 0" class="inline-flex items-center px-2 py-1 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs font-bold font-khmer">{{ row.otCount }} ដង</span>
                                    <span v-else class="text-slate-700">-</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <Transition enter-active-class="duration-300 ease-out" enter-from-class="opacity-0" enter-to-class="opacity-100" leave-active-class="duration-200 ease-in" leave-from-class="opacity-100" leave-to-class="opacity-0">
            <div v-if="processing.active" class="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/60 backdrop-blur-md">
                <div class="w-full max-w-sm bg-[#18181b] border border-white/10 rounded-3xl p-10 shadow-2xl relative flex flex-col items-center text-center animate-fade-in-up">
                    <div class="relative w-20 h-20 mb-8">
                        <div class="absolute inset-0 rounded-full border-4 border-white/5"></div>
                        <div class="absolute inset-0 rounded-full border-4 border-t-indigo-500 border-r-indigo-500 border-b-transparent border-l-transparent animate-spin"></div>
                        <div class="absolute inset-0 flex items-center justify-center font-bold text-white text-lg font-mono">{{ processing.progress }}%</div>
                    </div>
                    <h3 class="text-xl font-bold text-white mb-2">{{ processing.message }}</h3>
                    <p class="text-slate-400 text-xs mb-8 font-mono">Do not close this window...</p>
                    <div class="w-full h-1.5 bg-black/50 rounded-full overflow-hidden border border-white/5">
                        <div class="h-full bg-gradient-to-r from-indigo-600 to-purple-600 transition-all duration-300 ease-out" :style="{ width: `${processing.progress}%` }"></div>
                    </div>
                </div>
            </div>
        </Transition>

        <Transition enter-active-class="duration-200 ease-out" enter-from-class="opacity-0 scale-95" enter-to-class="opacity-100 scale-100" leave-active-class="duration-200 ease-in" leave-from-class="opacity-100 scale-100" leave-to-class="opacity-0 scale-95">
            <div v-if="showPrintModal" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" @click.self="showPrintModal = false">
                <div class="bg-[#18181b] border border-white/10 w-full max-w-sm rounded-3xl p-6 shadow-2xl relative">
                    <div class="flex justify-between items-center mb-6">
                        <h3 class="text-xl font-bold text-white flex items-center gap-2"><FileText class="w-5 h-5 text-indigo-400"/> Export PDF</h3>
                        <button @click="showPrintModal = false" class="text-slate-500 hover:text-white"><X class="w-5 h-5"/></button>
                    </div>
                    <div class="space-y-4">
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase mb-1 block">Report Type</label>
                            <div class="flex bg-black/40 p-1 rounded-lg border border-white/5">
                                <button @click="printConfig.mode='daily'" :class="['flex-1 py-2 rounded-md text-xs font-bold transition-all', printConfig.mode==='daily' ? 'bg-indigo-600 text-white' : 'text-slate-400']">Daily</button>
                                <button @click="printConfig.mode='monthly'" :class="['flex-1 py-2 rounded-md text-xs font-bold transition-all', printConfig.mode==='monthly' ? 'bg-indigo-600 text-white' : 'text-slate-400']">Monthly</button>
                                <button @click="printConfig.mode='yearly'" :class="['flex-1 py-2 rounded-md text-xs font-bold transition-all', printConfig.mode==='yearly' ? 'bg-indigo-600 text-white' : 'text-slate-400']">Yearly</button>
                            </div>
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase mb-1 block">Select Date</label>
                            <select v-model="printConfig.date" class="w-full bg-black/40 border border-white/10 text-white text-sm rounded-xl px-3 py-3 outline-none appearance-none font-mono cursor-pointer">
                                <option v-for="opt in printDateOptions" :key="opt" :value="opt">{{ opt }}</option>
                            </select>
                        </div>
                        <div>
                            <label class="text-xs font-bold text-slate-500 uppercase mb-1 block">Zone Filter</label>
                            <div class="grid grid-cols-3 gap-2">
                                <button @click="printConfig.zone='all'" :class="['py-2.5 rounded-xl text-xs font-bold border transition-all', printConfig.zone==='all' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-black/40 border-white/10 text-slate-400 hover:bg-white/5']">All</button>
                                <button @click="printConfig.zone='A'" :class="['py-2.5 rounded-xl text-xs font-bold border transition-all', printConfig.zone==='A' ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400' : 'bg-black/40 border-white/10 text-slate-400 hover:bg-white/5']">Zone A</button>
                                <button @click="printConfig.zone='B'" :class="['py-2.5 rounded-xl text-xs font-bold border transition-all', printConfig.zone==='B' ? 'bg-rose-500/20 border-rose-500 text-rose-400' : 'bg-black/40 border-white/10 text-slate-400 hover:bg-white/5']">Zone B</button>
                            </div>
                        </div>
                    </div>
                    <button @click="generatePDF" class="w-full mt-8 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/20 transition-all">
                        <Download class="w-4 h-4" /> Download Report
                    </button>
                </div>
            </div>
        </Transition>

        <div ref="printStaging" class="fixed top-0 left-[-9999px] pointer-events-none"></div>
        <CustomToast :show="toast.show" :type="toast.type" :title="toast.title" :message="toast.message" @close="toast.show = false" />
    </div>
</template>

<style scoped>
select option {
    background-color: #1f2937;
    color: white;
}
</style>