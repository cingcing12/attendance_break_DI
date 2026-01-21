<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import Swal from 'sweetalert2';
import { Database, Trash2, CheckSquare, Plus, XSquare, X, ArrowRightLeft } from 'lucide-vue-next';

// ⚠️ CHECK API URL
const API_URL = import.meta.env.DEV 
        ? "http://localhost:3000" 
        : "https://attendance-break-di-vsc6.onrender.com";

const cards = ref([]);
const loading = ref(false);
const isSelectMode = ref(false);
const selectedCards = ref(new Set());

// Manage Data Modal State
const showManageModal = ref(false);
const availableSheets = ref([]);
const manageMode = ref('date'); 
const selectedSheets = ref(new Set());

// 🔒 BODY SCROLL LOCK
watch(showManageModal, (isOpen) => {
    if (isOpen) {
        document.body.style.overflow = 'hidden';
    } else {
        document.body.style.overflow = '';
    }
});

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

// --- DATA MANAGEMENT ---
const openManageData = async () => {
    showManageModal.value = true;
    try {
        const res = await fetch(`${API_URL}/available-sheets`);
        availableSheets.value = await res.json();
        if(availableSheets.value.length === 0) availableSheets.value = []; 
    } catch (e) {
        availableSheets.value = [];
    }
    selectedSheets.value.clear();
};

const groupedSheets = computed(() => {
    if (manageMode.value === 'date') {
        return [...availableSheets.value].reverse().map(s => ({ key: s, display: s }));
    }
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
        const children = availableSheets.value.filter(s => s.endsWith(key));
        const allSelected = children.every(s => selectedSheets.value.has(s));
        children.forEach(s => {
            if (allSelected) selectedSheets.value.delete(s);
            else selectedSheets.value.add(s);
        });
    }
};

const deleteSheets = async () => {
    const list = Array.from(selectedSheets.value);
    if(list.length === 0) return;

    Swal.fire({
        title: 'Deleting Data...',
        text: 'Please wait while we clean up the database.',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
        background: '#121212', color: '#fff'
    });

    try {
        const res = await fetch(`${API_URL}/delete-sheets`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ sheetNames: list })
        });

        const data = await res.json();
        
        if (data.status === 'success') {
            availableSheets.value = availableSheets.value.filter(sheetName => !selectedSheets.value.has(sheetName));
            selectedSheets.value.clear();
            Swal.fire({ 
                icon: 'success', title: 'Data Deleted', text: 'Records removed.',
                background: '#121212', color: '#fff', timer: 1500, showConfirmButton: false 
            });
        } else {
            throw new Error(data.message || 'Failed');
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: e.message, background: '#121212', color: '#fff' });
    }
};

onMounted(() => loadCards());
</script>

<template>
    <div class="max-w-[1600px] mx-auto animate-fade-in pb-20">
        <header class="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-10 gap-4">
            <div>
                <h2 class="text-3xl font-bold text-white font-khmer mb-2">ការកំណត់ (Settings)</h2>
                <p class="text-slate-400 text-sm">Manage cards and system data</p>
            </div>
            <div class="flex gap-3">
                <button @click="openManageData" class="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold text-sm transition-all">
                    <Database class="w-4 h-4 text-purple-400"/> Manage Data
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

        <Teleport to="body">
            <div v-if="isSelectMode" 
                 class="fixed bottom-8 right-8 z-[100] animate-fade-in-up">
                <div class="bg-[#18181b] border border-white/10 p-2 rounded-2xl shadow-2xl flex items-center gap-2">
                    
                    <div class="px-4 text-white font-bold text-sm border-r border-white/10 mr-1 min-w-[80px] text-center">
                        {{ selectedCards.size }} Selected
                    </div>
                    
                    <button @click="performBatchMove('A')" 
                        class="px-4 py-2.5 rounded-xl bg-cyan-900/30 text-cyan-400 hover:bg-cyan-900/50 text-xs font-bold transition-all border border-cyan-500/20">
                        To A
                    </button>
                    
                    <button @click="performBatchMove('B')" 
                        class="px-4 py-2.5 rounded-xl bg-rose-900/30 text-rose-400 hover:bg-rose-900/50 text-xs font-bold transition-all border border-rose-500/20">
                        To B
                    </button>
                    
                    <div class="w-px h-6 bg-white/10 mx-1"></div>
                    
                    <button @click="performBatchDelete" 
                        class="px-5 py-2.5 rounded-xl bg-[#dc2626] hover:bg-[#b91c1c] text-white text-xs font-bold transition-all shadow-lg shadow-red-900/30">
                        Delete
                    </button>
                </div>
            </div>
        </Teleport>

        <Teleport to="body">
            <div v-if="showManageModal" 
                 class="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm" 
                 @click.self="showManageModal = false">
                
                <div class="bg-[#18181b] border border-white/10 w-full max-w-sm rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-zoom-in max-h-[85vh]">
                    
                    <div class="p-6 pb-2 shrink-0">
                        <div class="flex justify-between items-center mb-6">
                            <h3 class="text-xl font-bold text-white flex items-center gap-2 font-khmer">
                                <Database class="w-5 h-5 text-indigo-400"/> គ្រប់គ្រងទិន្នន័យ
                            </h3>
                            <button @click="showManageModal = false" class="text-slate-500 hover:text-white transition-colors bg-white/5 p-1 rounded-full"><X class="w-5 h-5"/></button>
                        </div>
                        
                        <div class="flex bg-[#27272a] p-1 rounded-xl mb-2">
                            <button @click="manageMode='date'" 
                                :class="['flex-1 py-2 rounded-lg text-xs font-bold transition-all', manageMode==='date' ? 'bg-[#6366f1] text-white shadow-lg' : 'text-slate-400 hover:text-white']">
                                Date
                            </button>
                            <button @click="manageMode='month'" 
                                :class="['flex-1 py-2 rounded-lg text-xs font-bold transition-all', manageMode==='month' ? 'bg-[#6366f1] text-white shadow-lg' : 'text-slate-400 hover:text-white']">
                                Month
                            </button>
                            <button @click="manageMode='year'" 
                                :class="['flex-1 py-2 rounded-lg text-xs font-bold transition-all', manageMode==='year' ? 'bg-[#6366f1] text-white shadow-lg' : 'text-slate-400 hover:text-white']">
                                Year
                            </button>
                        </div>
                    </div>

                    <div class="overflow-y-auto h-[320px] custom-scrollbar px-6 space-y-2">
                        <div v-if="groupedSheets.length === 0" class="flex flex-col items-center justify-center h-full text-slate-500 text-xs font-mono">
                            <Database class="w-8 h-8 opacity-20 mb-2"/>
                            No data available
                        </div>
                        
                        <div v-for="item in groupedSheets" :key="item.key" 
                             @click="toggleSheetSelection(item.key)"
                             class="flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all duration-200 select-none group"
                             :class="selectedSheets.has(item.key) || (manageMode !== 'date' && availableSheets.filter(s=>s.endsWith(item.key)).every(s=>selectedSheets.has(s)) && selectedSheets.size > 0) 
                                ? 'bg-[#27272a] border-[#6366f1] ring-1 ring-[#6366f1]' 
                                : 'bg-[#27272a]/50 border-white/5 hover:border-white/10 hover:bg-[#27272a]'">
                            
                            <span class="text-sm font-bold text-white font-mono tracking-wide">{{ item.display }}</span>
                            
                            <div class="flex items-center gap-3">
                                <span v-if="manageMode !== 'date'" class="text-[10px] font-bold text-slate-400 bg-black/40 px-2 py-1 rounded border border-white/5">
                                    {{ item.count }} Sheets
                                </span>
                                
                                <div class="w-5 h-5 rounded border flex items-center justify-center transition-colors"
                                    :class="selectedSheets.has(item.key) ? 'bg-[#6366f1] border-[#6366f1]' : 'border-white/20 group-hover:border-white/40'">
                                    <CheckSquare v-if="selectedSheets.has(item.key)" class="w-3.5 h-3.5 text-white" />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="p-6 pt-4 border-t border-white/5 bg-[#18181b] shrink-0 mt-auto">
                        <button @click="deleteSheets" :disabled="selectedSheets.size === 0" 
                            class="w-full py-3.5 rounded-xl text-sm font-bold text-white bg-[#be123c] hover:bg-[#9f1239] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors shadow-lg shadow-rose-900/20 active:scale-95">
                            <Trash2 class="w-4 h-4"/> Delete Selected
                        </button>
                    </div>
                </div>
            </div>
        </Teleport>

    </div>
</template>

<style scoped>
@keyframes zoomIn {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
}
.animate-zoom-in {
    animation: zoomIn 0.15s ease-out forwards;
}

@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in-up {
    animation: fadeInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

/* Custom Scrollbar */
.custom-scrollbar::-webkit-scrollbar {
    width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
    background: transparent; 
}
.custom-scrollbar::-webkit-scrollbar-thumb {
    background: #3f3f46; 
    border-radius: 2px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #52525b; 
}
</style>