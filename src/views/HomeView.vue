<script setup>
import { onMounted } from 'vue';
import { Layers, Lock } from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import Swal from 'sweetalert2';
import { useStaffStore } from '@/stores/staffStore';
import { storeToRefs } from 'pinia';

const router = useRouter();
const store = useStaffStore();
const { zoneSettings } = storeToRefs(store);

// Use Store Action to handle routing with lock check
const enterArea = (area) => {
  const isOpen = area === 'A' ? zoneSettings.value.zoneA : zoneSettings.value.zoneB;

  if (!isOpen) {
    Swal.fire({
        icon: 'error',
        title: 'Area Closed',
        text: `Zone ${area} is currently closed for maintenance or break time.`,
        background: '#121212', color: '#fff',
        confirmButtonColor: '#333'
    });
    return;
  }

  router.push(`/dashboard/${area}`);
};

onMounted(() => {
    // 1. Fetch latest data (including settings)
    store.fetchData();
    // 2. Enable Real-time listener for "Close Zone" events
    store.setupSocket();
});
</script>

<template>
  <div class="relative z-50 min-h-screen flex flex-col items-center justify-center p-6 animate-fade-in">
    <div class="w-full max-w-5xl flex flex-col items-center">
        <div class="mb-16 text-center">
            <div class="w-24 h-24 rounded-3xl bg-gradient-to-br from-gray-800 to-black border border-white/10 shadow-2xl flex items-center justify-center mb-8 mx-auto">
                <Layers class="w-12 h-12 text-white" />
            </div>
            <h1 class="text-6xl md:text-8xl font-black tracking-tight text-white mb-4">Staff Hub</h1>
            <p class="text-slate-400 font-khmer text-xl font-medium tracking-wide">Select Workspace</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl px-4">
            
            <button @click="enterArea('A')" 
                :disabled="!zoneSettings.zoneA"
                class="card-onyx group p-1 h-52 text-left relative transition-all duration-300"
                :class="zoneSettings.zoneA ? 'hover:border-cyan-500/50 cursor-pointer' : 'opacity-60 grayscale cursor-not-allowed border-red-500/20'">
                
                 <div class="relative z-10 p-8 flex flex-col justify-between h-full">
                    <div class="flex justify-between items-start">
                        <div class="w-14 h-14 rounded-2xl border flex items-center justify-center text-2xl font-black transition-all duration-300"
                            :class="zoneSettings.zoneA 
                                ? 'border-cyan-500/20 text-cyan-400 bg-cyan-500/5 group-hover:bg-cyan-500 group-hover:text-black' 
                                : 'border-red-500/20 text-red-500 bg-red-500/10'">
                            <span v-if="zoneSettings.zoneA">A</span>
                            <Lock v-else class="w-6 h-6" />
                        </div>
                        
                        <div v-if="!zoneSettings.zoneA" class="px-3 py-1 bg-red-500/20 border border-red-500/30 rounded-full">
                            <span class="text-xs font-bold text-red-400 uppercase tracking-wider">Closed</span>
                        </div>
                    </div>

                    <div>
                        <h2 class="text-3xl font-bold text-white font-khmer mb-1">តំបន់ A</h2>
                        <p class="text-xs font-bold tracking-widest uppercase"
                           :class="zoneSettings.zoneA ? 'text-cyan-400 opacity-60' : 'text-red-400 opacity-60'">
                           {{ zoneSettings.zoneA ? 'Canteen Area' : 'Access Denied' }}
                        </p>
                    </div>
                 </div>
            </button>

            <button @click="enterArea('B')" 
                :disabled="!zoneSettings.zoneB"
                class="card-onyx group p-1 h-52 text-left relative transition-all duration-300"
                :class="zoneSettings.zoneB ? 'hover:border-rose-500/50 cursor-pointer' : 'opacity-60 grayscale cursor-not-allowed border-red-500/20'">
                
                 <div class="relative z-10 p-8 flex flex-col justify-between h-full">
                    <div class="flex justify-between items-start">
                        <div class="w-14 h-14 rounded-2xl border flex items-center justify-center text-2xl font-black transition-all duration-300"
                            :class="zoneSettings.zoneB 
                                ? 'border-rose-500/20 text-rose-400 bg-rose-500/5 group-hover:bg-rose-500 group-hover:text-black' 
                                : 'border-red-500/20 text-red-500 bg-red-500/10'">
                            <span v-if="zoneSettings.zoneB">B</span>
                            <Lock v-else class="w-6 h-6" />
                        </div>

                        <div v-if="!zoneSettings.zoneB" class="px-3 py-1 bg-red-500/20 border border-red-500/30 rounded-full">
                            <span class="text-xs font-bold text-red-400 uppercase tracking-wider">Closed</span>
                        </div>
                    </div>

                    <div>
                        <h2 class="text-3xl font-bold text-white font-khmer mb-1">តំបន់ B</h2>
                        <p class="text-xs font-bold tracking-widest uppercase"
                           :class="zoneSettings.zoneB ? 'text-rose-400 opacity-60' : 'text-red-400 opacity-60'">
                           {{ zoneSettings.zoneB ? 'Garden Area' : 'Access Denied' }}
                        </p>
                    </div>
                 </div>
            </button>

        </div>
    </div>
  </div>
</template>