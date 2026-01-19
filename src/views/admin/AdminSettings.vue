<script setup>
import { ref, onMounted, computed } from 'vue';
import Swal from 'sweetalert2';
import { CreditCard, Database, Trash2, CheckSquare, Plus, XSquare, Save } from 'lucide-vue-next';
import { useStaffStore } from '../../stores/staffStore'; // Reuse store for API access
import CustomModal from '../../components/CustomModal.vue';
import CustomToast from '../../components/CustomToast.vue';

const API_URL = "https://attendance-break-di-vsc6.onrender.com";
const cards = ref([]);
const loading = ref(false);
const isSelectMode = ref(false);
const selectedCards = ref(new Set());

// Manage Data Modal State
const showManageModal = ref(false);
const availableSheets = ref([]);
const manageMode = ref('date'); // 'date', 'month', 'year'
const selectedSheets = ref(new Set());

// --- CARD LOGIC ---

const loadCards = async () => {
    loading.value = true;
    try {
        const res = await fetch(`${API_URL}/cards`);
        cards.value = await res.json();
    } catch(e) { console.error(e); }
    loading.value = false;
};

const zoneACards = computed(() => cards.value.filter(c => c.zone === 'A').sort((a,b) => a.cardId.localeCompare(b.cardId, undefined, {numeric: true})));
const zoneBCards = computed(() => cards.value.filter(c => c.zone === 'B').sort((a,b) => a.cardId.localeCompare(b.cardId, undefined, {numeric: true})));

const toggleSelection = (id) => {
    if (selectedCards.value.has(id)) selectedCards.value.delete(id);
    else selectedCards.value.add(id);
};

// Batch Actions
const performBatchMove = async (targetZone) => {
    if (selectedCards.value.size === 0) return;
    
    // Using SweetAlert for quick confirmation (or use CustomModal if you prefer)
    const result = await Swal.fire({
        title: `Move ${selectedCards.value.size} cards?`,
        text: `Move selected to Zone ${targetZone}?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#6366f1',
        confirmButtonText: 'Yes, Move',
        background: '#121212', color: '#fff'
    });

    if (result.isConfirmed) {
        loading.value = true;
        try {
            const promises = Array.from(selectedCards.value).map(id => 
                fetch(`${API_URL}/cards/update`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ cardId: id, zone: targetZone })
                })
            );
            await Promise.all(promises);
            isSelectMode.value = false;
            selectedCards.value.clear();
            await loadCards();
            Swal.fire({ icon: 'success', title: 'Moved!', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500, background: '#121212', color: '#fff' });
        } catch(e) { Swal.fire('Error', 'Batch move failed', 'error'); }
        loading.value = false;
    }
};

const performBatchDelete = async () => {
    if (selectedCards.value.size === 0) return;
    
    const result = await Swal.fire({
        title: 'Delete Selected?',
        text: `Permanently delete ${selectedCards.value.size} cards?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        confirmButtonText: 'Delete All',
        background: '#121212', color: '#fff'
    });

    if (result.isConfirmed) {
        loading.value = true;
        try {
            const promises = Array.from(selectedCards.value).map(id => 
                fetch(`${API_URL}/cards/delete`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ cardId: id })
                })
            );
            await Promise.all(promises);
            isSelectMode.value = false;
            selectedCards.value.clear();
            await loadCards();
            Swal.fire({ icon: 'success', title: 'Deleted!', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500, background: '#121212', color: '#fff' });
        } catch(e) { Swal.fire('Error', 'Batch delete failed', 'error'); }
        loading.value = false;
    }
};

// Add New Card
const openAddCardModal = async () => {
    const { value: formValues } = await Swal.fire({
        title: 'Add New Card',
        html: `
            <input id="swal-id" class="swal2-input bg-[#121212] border-white/20 text-white" placeholder="Card ID (e.g. DD_99)">
            <select id="swal-zone" class="swal2-input bg-[#121212] border-white/20 text-white">
                <option value="A">Zone A</option>
                <option value="B">Zone B</option>
            </select>
        `,
        focusConfirm: false,
        background: '#18181b', color: '#fff',
        preConfirm: () => {
            return [
                document.getElementById('swal-id').value,
                document.getElementById('swal-zone').value
            ]
        }
    });

    if (formValues) {
        const [id, zone] = formValues;
        if(!id) return;
        await fetch(`${API_URL}/cards/update`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ cardId: id, zone })
        });
        loadCards();
    }
};

// --- DATA MANAGEMENT (SHEETS) ---

const openManageData = async () => {
    showManageModal.value = true;
    const res = await fetch(`${API_URL}/available-sheets`);
    availableSheets.value = await res.json();
    selectedSheets.value.clear();
};

const groupedSheets = computed(() => {
    if (manageMode.value === 'date') return [...availableSheets.value].reverse().map(s => ({ key: s, display: s }));
    
    // Group logic for month/year
    const groups = {};
    availableSheets.value.forEach(s => {
        const key = manageMode.value === 'month' ? s.substring(3) : s.substring(6);
        if (!groups[key]) groups[key] = 0;
        groups[key]++;
    });
    return Object.keys(groups).map(k => ({ key: k, display: k, count: groups[k] }));
});

const toggleSheetSelection = (key) => {
    if (manageMode.value === 'date') {
        if(selectedSheets.value.has(key)) selectedSheets.value.delete(key);
        else selectedSheets.value.add(key);
    } else {
        // Select all children
        const children = availableSheets.value.filter(s => s.endsWith(key));
        const allSelected = children.every(s => selectedSheets.value.has(s));
        children.forEach(s => allSelected ? selectedSheets.value.delete(s) : selectedSheets.value.add(s));
    }
};

const deleteSheets = async () => {
    const list = Array.from(selectedSheets.value);
    if(list.length === 0) return;

    await fetch(`${API_URL}/delete-sheets`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ sheetNames: list })
    });
    
    showManageModal.value = false;
    Swal.fire({ icon: 'success', title: 'Data Deleted', background: '#121212', color: '#fff' });
};

onMounted(() => loadCards());
</script>

<template>
    <div class="max-w-[1600px] mx-auto animate-fade-in">
        <header class="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-10 gap-4">
            <div>
                <h2 class="text-3xl font-bold text-white font-khmer mb-2">ការកំណត់ (Settings)</h2>
                <p class="text-slate-400 text-sm">Manage cards and system data</p>
            </div>
            <div class="flex gap-3">
                <button @click="openManageData" class="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold text-sm">
                    <Database class="w-4 h-4"/> Manage Data
                </button>
                <button @click="isSelectMode = !isSelectMode" 
                    class="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-white/10 font-bold text-sm transition-all"
                    :class="isSelectMode ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-white/5 text-white'">
                    <component :is="isSelectMode ? XSquare : CheckSquare" class="w-4 h-4" />
                    {{ isSelectMode ? 'Cancel' : 'Select Cards' }}
                </button>
                <button @click="openAddCardModal" class="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-lg shadow-indigo-900/20">
                    <Plus class="w-4 h-4" /> Add Card
                </button>
            </div>
        </header>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-20">
            <div class="bg-[#121212] border border-cyan-500/20 rounded-3xl p-6">
                <div class="flex items-center justify-between mb-6">
                    <h3 class="text-xl font-bold text-cyan-400 font-khmer flex items-center gap-2">
                        <span class="w-3 h-3 rounded-full bg-cyan-400"></span> តំបន់ A (Zone A)
                    </h3>
                    <span class="text-xs text-slate-500 font-mono">{{ zoneACards.length }} Cards</span>
                </div>
                <div class="flex flex-wrap gap-2 content-start">
                    <div v-for="card in zoneACards" :key="card.cardId" 
                         @click="isSelectMode ? toggleSelection(card.cardId) : null"
                         :class="['px-3 py-1.5 rounded-lg text-xs font-mono font-bold cursor-pointer border transition-all', 
                                  isSelectMode && selectedCards.has(card.cardId) ? 'bg-indigo-600 border-indigo-500 text-white scale-105' : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/20']">
                        {{ card.cardId }}
                    </div>
                </div>
            </div>

            <div class="bg-[#121212] border border-rose-500/20 rounded-3xl p-6">
                <div class="flex items-center justify-between mb-6">
                    <h3 class="text-xl font-bold text-rose-400 font-khmer flex items-center gap-2">
                        <span class="w-3 h-3 rounded-full bg-rose-400"></span> តំបន់ B (Zone B)
                    </h3>
                    <span class="text-xs text-slate-500 font-mono">{{ zoneBCards.length }} Cards</span>
                </div>
                <div class="flex flex-wrap gap-2 content-start">
                    <div v-for="card in zoneBCards" :key="card.cardId" 
                         @click="isSelectMode ? toggleSelection(card.cardId) : null"
                         :class="['px-3 py-1.5 rounded-lg text-xs font-mono font-bold cursor-pointer border transition-all', 
                                  isSelectMode && selectedCards.has(card.cardId) ? 'bg-indigo-600 border-indigo-500 text-white scale-105' : 'bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20']">
                        {{ card.cardId }}
                    </div>
                </div>
            </div>
        </div>

        <div v-if="isSelectMode" class="fixed bottom-6 right-6 bg-[#1a1a1a] border border-white/10 p-2 rounded-2xl shadow-2xl flex items-center gap-2 z-[50] animate-fade-in">
            <div class="px-4 text-white font-bold text-sm border-r border-white/10 mr-2">
                {{ selectedCards.size }} Selected
            </div>
            <button @click="performBatchMove('A')" class="px-4 py-2 rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 text-xs font-bold transition-colors">To A</button>
            <button @click="performBatchMove('B')" class="px-4 py-2 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 text-xs font-bold transition-colors">To B</button>
            <div class="w-px h-6 bg-white/10 mx-1"></div>
            <button @click="performBatchDelete" class="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors">Delete</button>
        </div>

        <div v-if="showManageModal" class="fixed inset-0 bg-black/90 backdrop-blur-md z-[60] flex items-center justify-center p-4">
            <div class="bg-[#18181b] border border-white/10 w-full max-w-md p-6 rounded-3xl flex flex-col max-h-[85vh]">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-lg font-bold text-white flex items-center gap-2 font-khmer"><Database class="w-5 h-5 text-indigo-400"/> គ្រប់គ្រងទិន្នន័យ</h3>
                    <button @click="showManageModal = false" class="text-slate-500 hover:text-white"><XSquare class="w-6 h-6"/></button>
                </div>
                
                <div class="flex bg-white/5 p-1 rounded-lg mb-4">
                    <button @click="manageMode='date'" :class="['flex-1 py-2 rounded-md text-xs font-bold', manageMode==='date' ? 'bg-indigo-600 text-white' : 'text-slate-400']">Date</button>
                    <button @click="manageMode='month'" :class="['flex-1 py-2 rounded-md text-xs font-bold', manageMode==='month' ? 'bg-indigo-600 text-white' : 'text-slate-400']">Month</button>
                    <button @click="manageMode='year'" :class="['flex-1 py-2 rounded-md text-xs font-bold', manageMode==='year' ? 'bg-indigo-600 text-white' : 'text-slate-400']">Year</button>
                </div>

                <div class="flex-grow overflow-y-auto space-y-2 mb-6 pr-2">
                    <div v-for="item in groupedSheets" :key="item.key" 
                         @click="toggleSheetSelection(item.key)"
                         class="flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-colors"
                         :class="selectedSheets.has(item.key) || (manageMode !== 'date' && availableSheets.filter(s=>s.endsWith(item.key)).every(s=>selectedSheets.has(s)) && selectedSheets.size > 0) ? 'bg-indigo-600/20 border-indigo-500/50' : 'bg-white/5 border-white/5 hover:bg-white/10'">
                        <span class="text-sm font-mono font-bold text-white">{{ item.display }}</span>
                        <span v-if="manageMode !== 'date'" class="text-xs text-slate-400 bg-white/10 px-2 py-0.5 rounded">{{ item.count }} Sheets</span>
                    </div>
                </div>

                <button @click="deleteSheets" :disabled="selectedSheets.size === 0" class="w-full py-3.5 rounded-xl text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 flex items-center justify-center gap-2">
                    <Trash2 class="w-4 h-4"/> Delete Selected
                </button>
            </div>
        </div>

    </div>
</template>