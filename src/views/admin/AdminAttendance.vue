<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { Calendar, Search, RefreshCw, Printer, X, Download, FileText } from 'lucide-vue-next';
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import CustomToast from '../../components/CustomToast.vue';

// --- STATE ---
const API_URL = "https://attendance-break-di-vsc6.onrender.com";
const reportData = ref([]);
const availableSheets = ref([]);
const viewMode = ref('daily');
const viewDate = ref('');
const searchTerm = ref('');
const loading = ref(false);
const toast = ref({ show: false, type: 'info', title: '', message: '' });

// --- PRINT MODAL STATE ---
const showPrintModal = ref(false);
const printConfig = ref({
    mode: 'daily',
    zone: 'all',
    date: ''
});
const isGenerating = ref(false);
const printStaging = ref(null);

// --- HELPERS ---
const triggerToast = (type, title, message) => {
    toast.value = { show: true, type, title, message };
};

// --- DATA FETCHING ---
const loadSheets = async () => {
    try {
        const res = await fetch(`${API_URL}/available-sheets`);
        let sheets = await res.json();
        
        // Sort: Newest First (Descending)
        sheets.sort((a, b) => {
            const [da, ma, ya] = a.split('-').map(Number);
            const [db, mb, yb] = b.split('-').map(Number);
            return new Date(yb, mb - 1, db) - new Date(ya, ma - 1, da);
        });

        availableSheets.value = sheets;
        
        // Select newest date by default
        if(availableSheets.value.length > 0) {
            viewDate.value = availableSheets.value[0];
        }
    } catch(e) { console.error(e); }
};

// Computed Options
const getOptions = (mode) => {
    if(!availableSheets.value.length) return [];
    if(mode === 'daily') return [...availableSheets.value]; 
    if(mode === 'monthly') return [...new Set(availableSheets.value.map(s => s.substring(3)))];
    return [...new Set(availableSheets.value.map(s => s.substring(6)))]; 
};

const viewDateOptions = computed(() => getOptions(viewMode.value));
const printDateOptions = computed(() => getOptions(printConfig.value.mode));

const loadReport = async () => {
    if(!viewDate.value) return;
    loading.value = true;
    try {
        const res = await fetch(`${API_URL}/report?mode=${viewMode.value}&filter=${viewDate.value}`);
        const data = await res.json();
        reportData.value = data.raw || [];
    } catch(e) { console.error(e); }
    loading.value = false;
};

// --- WATCHERS ---
watch([viewMode, viewDate], loadReport);

// Update dropdown when switching print modes
watch(() => printConfig.value.mode, () => {
    const opts = getOptions(printConfig.value.mode);
    if (opts.length > 0) printConfig.value.date = opts[0];
});

// --- PDF GENERATION ---

const openPrintModal = () => {
    printConfig.value.mode = 'daily';
    printConfig.value.date = viewDate.value;
    printConfig.value.zone = 'all';
    showPrintModal.value = true;
};

const generatePDF = async () => {
    if (!printConfig.value.date) {
        triggerToast('error', 'Missing Date', 'Please select a date.');
        return;
    }

    isGenerating.value = true;
    showPrintModal.value = false;
    triggerToast('info', 'Generating...', `Fetching data...`);

    try {
        const res = await fetch(`${API_URL}/report?mode=${printConfig.value.mode}&filter=${printConfig.value.date}`);
        const json = await res.json();
        let data = json.raw || [];

        if (data.length === 0) throw new Error(`No data exists for ${printConfig.value.date}`);

        // SMART FILTERING (Ignore Case)
        if (printConfig.value.zone !== 'all') {
            const targetZone = printConfig.value.zone.toLowerCase().trim();
            const filtered = data.filter(item => {
                const itemArea = String(item.area || '').toLowerCase().trim();
                return itemArea === targetZone;
            });

            if (filtered.length === 0) {
                const actualZones = [...new Set(data.map(i => i.area))].join(', ');
                throw new Error(`Found 0 records in Zone ${printConfig.value.zone}. (Available: ${actualZones})`);
            }
            data = filtered;
        }

        const staffRes = await fetch(`${API_URL}/staff`);
        const staffList = await staffRes.json();

        const aggregation = {};
        data.forEach(log => {
            if (!aggregation[log.id]) {
                const staff = staffList.find(s => s.id == log.id);
                aggregation[log.id] = {
                    id: log.id,
                    name: staff ? (staff.name_kh || staff.name_en) : log.name,
                    group: staff ? (staff.group || log.group) : log.group,
                    breakCount: 0,
                    otCount: 0 
                };
            }
            aggregation[log.id].breakCount++;
            if (log.overtime && log.overtime !== '0') aggregation[log.id].otCount++;
        });

        const allRows = Object.values(aggregation).sort((a, b) => b.breakCount - a.breakCount);
        const rowsPerPage = 26; 
        const pages = [];
        let remaining = [...allRows];
        let rowCounter = 1; 

        while(remaining.length > 0) {
            const batch = remaining.slice(0, rowsPerPage);
            const batchWithIndex = batch.map(row => ({ ...row, index: rowCounter++ }));
            pages.push(batchWithIndex);
            remaining = remaining.slice(rowsPerPage);
        }

        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = 210; 

        for (let i = 0; i < pages.length; i++) {
            printStaging.value.innerHTML = generatePageHTML(pages[i], i + 1, pages.length);
            await new Promise(r => setTimeout(r, 200)); 

            const canvas = await html2canvas(printStaging.value.querySelector('.print-page'), {
                scale: 2, useCORS: true, logging: false
            });

            const imgData = canvas.toDataURL('image/png');
            if (i > 0) pdf.addPage();
            
            const imgProps = pdf.getImageProperties(imgData);
            const pdfImgHeight = (imgProps.height * pdfWidth) / imgProps.width;
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfImgHeight);
        }

        pdf.save(`Report_${printConfig.value.date}_Zone${printConfig.value.zone}.pdf`);
        triggerToast('success', 'Done', 'PDF downloaded.');

    } catch (e) {
        console.error(e);
        triggerToast('error', 'Failed', e.message);
        showPrintModal.value = true; 
    } finally {
        isGenerating.value = false;
        if(printStaging.value) printStaging.value.innerHTML = ''; 
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
            <td style="padding: 12px; text-align: center; border: 1px solid #e2e8f0; font-weight: bold;">${row.breakCount}</td>
            <td style="padding: 12px; text-align: center; border: 1px solid #e2e8f0; font-weight: bold; color: ${row.otCount > 0 ? '#e11d48' : '#94a3b8'};">
                ${row.otCount > 0 ? row.otCount + ' times' : '-'}
            </td>
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
                        <th style="padding: 15px; border: 1px solid #334155;">No.</th>
                        <th style="padding: 15px; border: 1px solid #334155;">ID</th>
                        <th style="padding: 15px; border: 1px solid #334155; text-align: left;">Name</th>
                        <th style="padding: 15px; border: 1px solid #334155; text-align: left;">Group</th>
                        <th style="padding: 15px; border: 1px solid #334155;">Breaks</th>
                        <th style="padding: 15px; border: 1px solid #334155;">Overtime</th>
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

const filteredData = computed(() => {
    if(!searchTerm.value) return reportData.value;
    const lower = searchTerm.value.toLowerCase();
    return reportData.value.filter(item => 
        item.name.toLowerCase().includes(lower) || 
        String(item.id).includes(lower)
    );
});

onMounted(() => {
    loadSheets().then(() => loadReport());
});
</script>

<template>
    <div class="max-w-[1600px] mx-auto animate-fade-in pb-20">
        <header class="flex flex-col xl:flex-row justify-between xl:items-end mb-8 gap-4">
            <div>
                <h2 class="text-3xl font-bold text-white font-khmer mb-2">បញ្ជីវត្តមាន (Attendance)</h2>
                <p class="text-slate-400 text-sm">View logs and generate reports</p>
            </div>
            
            <div class="flex flex-col md:flex-row gap-3 w-full xl:w-auto bg-[#121212] p-2 rounded-2xl border border-white/10">
                <div class="flex bg-white/5 p-1 rounded-lg">
                    <button @click="viewMode='daily'" :class="['px-4 py-2 rounded-md text-xs font-bold transition-all', viewMode==='daily' ? 'bg-indigo-600 text-white' : 'text-slate-400']">Day</button>
                    <button @click="viewMode='monthly'" :class="['px-4 py-2 rounded-md text-xs font-bold transition-all', viewMode==='monthly' ? 'bg-indigo-600 text-white' : 'text-slate-400']">Month</button>
                </div>

                <div class="relative">
                    <select v-model="viewDate" class="w-full md:w-40 bg-black/30 border border-white/10 text-white text-sm rounded-xl px-3 py-2 outline-none appearance-none font-mono cursor-pointer">
                        <option v-for="opt in viewDateOptions" :key="opt" :value="opt">{{ opt }}</option>
                    </select>
                    <Calendar class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                </div>

                <div class="relative">
                    <Search class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input v-model="searchTerm" type="text" placeholder="Search ID or Name..." class="w-full md:w-48 bg-black/30 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-white text-sm outline-none">
                </div>

                <button @click="loadReport" class="p-2 bg-white/5 rounded-xl text-slate-400 hover:text-white transition-colors" title="Refresh"><RefreshCw class="w-5 h-5"/></button>
                <button @click="openPrintModal" class="p-2 bg-indigo-600 rounded-xl text-white hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-900/20" title="Print PDF"><Printer class="w-5 h-5"/></button>
            </div>
        </header>

        <div class="bg-[#121212] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
            <div v-if="loading" class="p-20 text-center flex flex-col items-center justify-center text-slate-500">
                <RefreshCw class="w-8 h-8 animate-spin mb-4 text-indigo-500" />
                <span class="font-khmer">កំពុងផ្ទុកទិន្នន័យ...</span>
            </div>
            <div v-else-if="filteredData.length === 0" class="p-20 text-center text-slate-500 font-khmer">មិនមានទិន្នន័យសម្រាប់កាលបរិច្ឆេទនេះទេ។</div>
            
            <div v-else class="overflow-x-auto">
                <table class="w-full text-left text-sm text-slate-400">
                    <thead class="bg-white/5 text-xs uppercase font-bold text-slate-300 font-khmer">
                        <tr>
                            <th class="px-6 py-4">Name</th>
                            <th class="px-6 py-4">Group</th>
                            <th class="px-6 py-4 text-center font-mono">OUT</th>
                            <th class="px-6 py-4 text-center font-mono">IN</th>
                            <th class="px-6 py-4 text-center">Overtime</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-white/5">
                        <tr v-for="(row, idx) in filteredData" :key="idx" class="hover:bg-white/5 transition-colors group">
                            <td class="px-6 py-4">
                                <div class="font-bold text-white font-khmer">{{ row.name }}</div>
                                <div class="text-xs text-slate-600 font-mono">ID: {{ row.id }}</div>
                            </td>
                            <td class="px-6 py-4"><span class="bg-white/10 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider">{{ row.group }}</span></td>
                            <td class="px-6 py-4 text-center font-mono text-slate-300">{{ row.timeOut }}</td>
                            <td class="px-6 py-4 text-center font-mono" :class="row.timeIn ? 'text-emerald-400' : 'text-slate-600'">{{ row.timeIn || '--:--' }}</td>
                            <td class="px-6 py-4 text-center">
                                <span v-if="row.overtime && row.overtime !== '0'" class="inline-flex items-center px-2 py-1 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs font-bold">+{{ row.overtime }}m</span>
                                <span v-else class="text-slate-700">-</span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <Transition enter-active-class="duration-200 ease-out" enter-from-class="opacity-0 scale-95" enter-to-class="opacity-100 scale-100" leave-active-class="duration-200 ease-in" leave-from-class="opacity-100 scale-100" leave-to-class="opacity-0 scale-95">
            <div v-if="showPrintModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" @click.self="showPrintModal = false">
                <div class="bg-[#18181b] border border-white/10 w-full max-w-sm rounded-3xl p-6 shadow-2xl">
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

                    <button @click="generatePDF" :disabled="isGenerating" class="w-full mt-8 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/20 transition-all disabled:opacity-50">
                        <Download v-if="!isGenerating" class="w-4 h-4" /> 
                        <RefreshCw v-else class="w-4 h-4 animate-spin" />
                        {{ isGenerating ? 'Generating...' : 'Download Report' }}
                    </button>
                </div>
            </div>
        </Transition>

        <div ref="printStaging" class="fixed top-0 left-[-9999px] pointer-events-none"></div>

        <CustomToast :show="toast.show" :type="toast.type" :title="toast.title" :message="toast.message" @close="toast.show = false" />
    </div>
</template>