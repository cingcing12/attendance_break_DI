<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Search, ArrowLeft, Clock, ScanSearch, Coffee } from 'lucide-vue-next';
import StaffCard from '../components/StaffCard.vue';
import BreakCard from '../components/BreakCard.vue';
import CustomModal from '../components/CustomModal.vue'; 
import CustomToast from '../components/CustomToast.vue'; 
import { useStaffStore } from '../stores/staffStore';

const route = useRoute();
const router = useRouter();
const currentArea = route.params.area;
const store = useStaffStore();

const searchTerm = ref("");
const searchInputRef = ref(null);
const currentTab = ref('staff');
const now = ref(new Date()); 
const timerInterval = ref(null);

const modal = ref({
    show: false,
    type: 'confirm',
    title: '',
    message: '',
    icon: '',
    confirmText: 'Confirm',
    confirmColor: '',
    loading: false, 
    onConfirm: async () => {}
});

const toast = ref({ show: false, type: 'success', title: '', message: '' });

const openConfirmModal = (config) => {
    modal.value = { ...modal.value, show: true, type: 'confirm', loading: false, ...config };
};

// Helper to show/update Toast
const triggerToast = (type, title, message) => {
    toast.value = { show: true, type, title, message };
};

const closeModal = () => { if(!modal.value.loading) modal.value.show = false; };
const closeToast = () => { toast.value.show = false; };

const handleConfirm = async () => {
    if (modal.value.onConfirm) {
        // 🚀 OPTIMISTIC: Trigger action immediately without waiting
        modal.value.onConfirm(); 
    }
    closeModal();
};

const filteredStaff = computed(() => {
    if (!searchTerm.value || searchTerm.value.trim() === '') return [];
    const lower = searchTerm.value.toLowerCase().trim();
    return store.allStaff.filter(p => 
        (p.name_kh && p.name_kh.toLowerCase().includes(lower)) || 
        (p.name_en && p.name_en.toLowerCase().includes(lower)) || 
        (p.id && p.id.toString().includes(lower))
    );
});

const filteredBreaks = computed(() => {
    let list = store.activeBreaks.filter(b => String(b.area) === String(currentArea));
    if (searchTerm.value) {
        const lower = searchTerm.value.toLowerCase();
        list = list.filter(b => b.name.toLowerCase().includes(lower) || String(b.id).includes(lower));
    }
    return list.sort((a, b) => {
        const numA = parseInt(String(a.card).replace(/\D/g, '')) || 0;
        const numB = parseInt(String(b.card).replace(/\D/g, '')) || 0;
        return numA - numB;
    });
});

// 🚀 UPDATED HANDLER: Instant Modal Close + Card Number Update
const handleStartBreak = (person) => {
    openConfirmModal({
        title: 'Start Break?',
        message: `${person.name_kh || person.name_en}`,
        icon: 'coffee',
        confirmText: 'Yes, Start',
        confirmColor: 'bg-white text-black hover:bg-slate-200',
        onConfirm: async () => {
            // 1. Clear UI immediately
            searchTerm.value = "";
            
            // 2. Show "Loading" Toast immediately
            triggerToast('success', 'Processing...', 'Allocating card number...');

            // 3. Send Request & Wait for Card
            try {
                const cardNum = await store.apiStartBreak(person, currentArea);
                
                // 4. UPDATE the toast with the REAL Card Number
                triggerToast('success', 'Break Started', `Please take Card: ${cardNum}`);
            } catch(e) { 
                triggerToast('error', 'Failed', 'Could not start break. Try again.');
            }
            
            nextTick(() => searchInputRef.value?.focus());
        }
    });
};

const handleTimeIn = (id, name) => {
    openConfirmModal({
        title: 'Back to Work?',
        message: `Welcome back, ${name}`,
        icon: 'login',
        confirmText: 'Yes, Work',
        confirmColor: 'bg-cyan-500 text-black hover:bg-cyan-400',
        onConfirm: async () => {
            // Instant feedback
            triggerToast('success', 'Welcome Back!', 'Processing time in...');
            try {
                await store.apiTimeIn(id);
                // Update feedback
                triggerToast('success', 'Welcome Back!', 'Time in recorded successfully.');
            } catch (e) {
                triggerToast('error', 'Error', 'Connection failed.');
            }
        }
    });
};

onMounted(() => {
    store.fetchData();
    store.setupSocket();
    timerInterval.value = setInterval(() => { now.value = new Date(); }, 1000);
});

onUnmounted(() => {
    store.disconnectSocket();
    clearInterval(timerInterval.value);
});
</script>

<template>
  <div class="flex flex-col min-h-screen pb-32 md:pb-12 bg-[#050505]">
    <header class="sticky top-4 z-50 w-full px-4 mb-8">
        <div class="glass-panel rounded-2xl px-6 py-3 max-w-[1600px] mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <div class="flex items-center gap-6 w-full md:w-auto">
                <button @click="router.push('/')" class="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all text-slate-400">
                    <ArrowLeft class="w-5 h-5" />
                </button>
                <div class="flex flex-col">
                    <h1 class="font-bold text-lg text-white leading-none">Staff Hub</h1>
                    <span class="text-[10px] font-bold tracking-widest uppercase mt-0.5" :class="currentArea === 'A' ? 'text-cyan-400' : 'text-rose-400'">AREA {{ currentArea }}</span>
                </div>
            </div>
            <div class="hidden md:flex bg-black/40 p-1 rounded-xl border border-white/10 relative w-96 shadow-inner shrink-0 h-12">
                <div class="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-lg transition-all duration-300 shadow-md z-0" :style="{ left: currentTab === 'staff' ? '4px' : 'calc(50%)' }"></div>
                <button @click="currentTab = 'staff'" class="relative z-10 w-1/2 h-full text-sm font-bold flex items-center justify-center gap-2 transition-colors duration-300" :class="currentTab === 'staff' ? 'text-black' : 'text-slate-400 hover:text-white'">
                    <Search class="w-4 h-4" /> ស្វែងរក
                </button>
                <button @click="currentTab = 'active'" class="relative z-10 w-1/2 h-full text-sm font-bold flex items-center justify-center gap-2 transition-colors duration-300" :class="currentTab === 'active' ? 'text-black' : 'text-slate-400 hover:text-white'">
                    <Clock class="w-4 h-4" /> កំពុងសម្រាក
                </button>
            </div>
            <div class="w-full md:w-80">
                <div class="flex items-center w-full bg-surface/50 border border-white/10 rounded-xl px-4 py-2.5 focus-within:border-cyan-500/50 focus-within:bg-surface transition-all">
                    <Search class="w-5 h-5 text-slate-400 mr-3 shrink-0" />
                    <input ref="searchInputRef" v-model="searchTerm" type="text" class="w-full bg-transparent border-none outline-none text-white font-khmer text-sm placeholder-slate-500 h-full py-1" placeholder="Search ID or Name...">
                </div>
            </div>
        </div>
    </header>

    <main class="flex-grow px-4 max-w-[1600px] mx-auto w-full animate-fade-in">
        <div v-if="currentTab === 'staff'">
            <div v-if="!searchTerm" class="flex flex-col items-center justify-center py-32 opacity-40">
                <ScanSearch class="w-20 h-20 text-slate-600 mb-4 stroke-1"/>
                <p class="text-slate-400 font-khmer text-xl">សូមបញ្ចូលអត្តលេខ ឬឈ្មោះ</p>
                <p class="text-slate-600 text-sm mt-1">Please enter ID or Name to search</p>
            </div>
            <div v-else-if="filteredStaff.length === 0" class="text-center py-20 text-slate-500">No Staff Found</div>
            <div v-else class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
                <StaffCard v-for="person in filteredStaff" :key="person.id" :person="person" :currentArea="currentArea" :isOnBreak="store.activeBreaks.some(b => b.id == person.id && !b.timeIn)" :breakData="store.activeBreaks.find(b => b.id == person.id)" @startBreak="handleStartBreak"/>
            </div>
        </div>

        <div v-if="currentTab === 'active'">
             <div class="flex items-center justify-between mb-8 px-2">
                <h2 class="text-xl font-bold text-white font-khmer">Active Breaks</h2>
                <span class="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-xs font-mono font-bold">{{ filteredBreaks.length }} ACTIVE</span>
            </div>
            <div v-if="filteredBreaks.length === 0" class="flex flex-col items-center justify-center py-32 opacity-40 animate-fade-in">
                <Coffee class="w-24 h-24 text-slate-700 mb-6 stroke-1"/>
                <p class="text-slate-400 font-khmer text-xl font-medium">មិនមានបុគ្គលិកកំពុងសម្រាក</p>
                <p class="text-slate-600 text-sm mt-2 font-medium tracking-wide">No active breaks at the moment</p>
            </div>
            <div v-else class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
                <BreakCard v-for="item in filteredBreaks" :key="item.id" :item="item" :now="now" :staffInfo="store.allStaff.find(s => s.id == item.id)" @timeIn="handleTimeIn"/>
            </div>
        </div>
    </main>

    <nav class="md:hidden fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#18181b]/95 backdrop-blur-xl border border-white/10 rounded-full px-2 py-2 flex gap-2 z-[100] shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
        <button @click="currentTab = 'staff'" class="flex items-center gap-2 px-6 py-3 rounded-full transition-all duration-300" :class="currentTab === 'staff' ? 'bg-white text-black' : 'text-slate-500 hover:text-slate-300'">
            <Search class="w-5 h-5" /> <span v-if="currentTab === 'staff'" class="text-xs font-bold uppercase tracking-widest animate-fade-in">Search</span>
        </button>
        <button @click="currentTab = 'active'" class="flex items-center gap-2 px-6 py-3 rounded-full transition-all duration-300" :class="currentTab === 'active' ? 'bg-white text-black' : 'text-slate-500 hover:text-slate-300'">
            <Clock class="w-5 h-5" /> <span v-if="currentTab === 'active'" class="text-xs font-bold uppercase tracking-widest animate-fade-in">Active</span>
        </button>
    </nav>

    <CustomModal 
        :show="modal.show" :type="modal.type" :title="modal.title" :message="modal.message"
        :confirmText="modal.confirmText" :confirmColor="modal.confirmColor" :icon="modal.icon"
        :loading="modal.loading"
        @close="closeModal" @confirm="handleConfirm"
    />

    <CustomToast :show="toast.show" :type="toast.type" :title="toast.title" :message="toast.message" @close="closeToast" />
  </div>
</template>