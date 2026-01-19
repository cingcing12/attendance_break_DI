<script setup>
import { Layers } from 'lucide-vue-next';
import { useRouter } from 'vue-router';

const router = useRouter();

const enterArea = (area) => {
  router.push(`/dashboard/${area}`);
};
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
            <button @click="enterArea('A')" class="card-onyx hover:border-cyan-500/50 group p-1 h-52 text-left relative transition-all">
                 <div class="relative z-10 p-8 flex flex-col justify-between h-full">
                    <div class="w-14 h-14 rounded-2xl border border-cyan-500/20 flex items-center justify-center text-2xl font-black text-cyan-400 bg-cyan-500/5 group-hover:bg-cyan-500 group-hover:text-black transition-all duration-300">A</div>
                    <div>
                        <h2 class="text-3xl font-bold text-white font-khmer mb-1">តំបន់ A</h2>
                        <p class="text-cyan-400 text-xs font-bold tracking-widest uppercase opacity-60">Canteen Area</p>
                    </div>
                 </div>
            </button>

            <button @click="enterArea('B')" class="card-onyx hover:border-rose-500/50 group p-1 h-52 text-left relative transition-all">
                 <div class="relative z-10 p-8 flex flex-col justify-between h-full">
                    <div class="w-14 h-14 rounded-2xl border border-rose-500/20 flex items-center justify-center text-2xl font-black text-rose-400 bg-rose-500/5 group-hover:bg-rose-500 group-hover:text-black transition-all duration-300">B</div>
                    <div>
                        <h2 class="text-3xl font-bold text-white font-khmer mb-1">តំបន់ B</h2>
                        <p class="text-rose-400 text-xs font-bold tracking-widest uppercase opacity-60">Garden Area</p>
                    </div>
                 </div>
            </button>
        </div>
    </div>
  </div>
</template>