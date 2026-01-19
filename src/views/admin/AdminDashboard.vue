<script setup>
import { ref, onMounted } from 'vue';
import { Users, FileText, Clock } from 'lucide-vue-next';

const stats = ref({ staff: 0, breaks: 0, ot: 0 });
const API_URL = "https://attendance-break-di-vsc6.onrender.com";

const fetchStats = async () => {
    // In a real app, you might make a specific endpoint for summary stats
    // For now, we simulate by fetching raw data like the HTML did
    try {
        const [resStaff, resBreaks] = await Promise.all([
            fetch(`${API_URL}/staff`),
            fetch(`${API_URL}/report?mode=daily`) // Fetches today's report
        ]);
        const staff = await resStaff.json();
        const breaks = await resBreaks.json();
        
        stats.value.staff = staff.length;
        stats.value.breaks = breaks.raw.length;
        stats.value.ot = breaks.raw.filter(b => b.overtime && b.overtime !== "0").length;
    } catch(e) { console.error(e); }
};

onMounted(() => fetchStats());
</script>

<template>
    <div class="max-w-[1600px] mx-auto animate-fade-in">
        <h2 class="text-3xl font-bold text-white font-khmer mb-2">ផ្ទាំងគ្រប់គ្រង (Dashboard)</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
            <div class="bg-[#121212] border border-white/10 p-6 rounded-3xl relative overflow-hidden group">
                <div class="absolute -right-6 -top-6 text-indigo-500/5"><Users class="w-40 h-40" /></div>
                <div class="relative z-10">
                    <div class="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center mb-4 text-indigo-400"><Users class="w-6 h-6" /></div>
                    <p class="text-slate-500 text-xs font-bold uppercase font-khmer">បុគ្គលិកសរុប</p>
                    <h3 class="text-5xl font-bold text-white">{{ stats.staff }}</h3>
                </div>
            </div>
            
            <div class="bg-[#121212] border border-white/10 p-6 rounded-3xl relative overflow-hidden group">
                <div class="absolute -right-6 -top-6 text-emerald-500/5"><FileText class="w-40 h-40" /></div>
                <div class="relative z-10">
                    <div class="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-4 text-emerald-400"><FileText class="w-6 h-6" /></div>
                    <p class="text-slate-500 text-xs font-bold uppercase font-khmer">កំណត់ត្រាថ្ងៃនេះ</p>
                    <h3 class="text-5xl font-bold text-white">{{ stats.breaks }}</h3>
                </div>
            </div>

            <div class="bg-[#121212] border border-white/10 p-6 rounded-3xl relative overflow-hidden group">
                <div class="absolute -right-6 -top-6 text-rose-500/5"><Clock class="w-40 h-40" /></div>
                <div class="relative z-10">
                    <div class="w-12 h-12 rounded-2xl bg-rose-500/10 flex items-center justify-center mb-4 text-rose-400"><Clock class="w-6 h-6" /></div>
                    <p class="text-slate-500 text-xs font-bold uppercase font-khmer">លើសម៉ោង</p>
                    <h3 class="text-5xl font-bold text-white">{{ stats.ot }}</h3>
                </div>
            </div>
        </div>
    </div>
</template>