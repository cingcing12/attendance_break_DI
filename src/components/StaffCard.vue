<script setup>
import { Coffee, LogOut } from 'lucide-vue-next';

const props = defineProps(['person', 'isOnBreak', 'breakData', 'currentArea']);
const emit = defineEmits(['startBreak']);

const confirmStart = () => {
    emit('startBreak', props.person);
};

// Compute dynamic classes
const activeColorClass = props.currentArea === 'A' ? 'hover:border-cyan-500/50' : 'hover:border-rose-500/50';
const btnText = props.isOnBreak 
    ? (props.breakData.area !== props.currentArea ? `ZONE ${props.breakData.area}` : `កំពុងសម្រាក`)
    : "ចេញសម្រាក";
</script>

<template>
  <div :class="[`card-onyx p-4 flex flex-col items-center group animate-fade-in`, activeColorClass, isOnBreak ? 'opacity-60 grayscale border-white/5' : '']">
    <div class="w-full relative flex flex-col items-center">
      <div class="absolute top-0 right-0 z-20">
        <span class="bg-black/60 backdrop-blur-md border border-white/10 text-slate-300 text-[10px] font-mono font-bold px-2 py-1 rounded-lg">
          #{{ person.id }}
        </span>
      </div>

      <div class="relative mb-3 mt-4">
        <div class="absolute inset-0 bg-white/10 rounded-full blur-lg opacity-0 group-hover:opacity-50 transition-opacity"></div>
        <img :src="person.image || `https://ui-avatars.com/api/?background=random&color=fff&name=${person.name_en}`" 
             class="w-20 h-20 rounded-full object-cover border-2 border-white/10 bg-black relative z-10 shadow-xl group-hover:scale-105 transition-transform duration-300">
        <div v-if="!isOnBreak" class="absolute bottom-1 right-1 w-4 h-4 bg-emerald-500 border-2 border-black rounded-full z-20"></div>
      </div>

      <div class="text-center w-full mb-4 px-1">
        <h3 class="font-bold text-white text-sm truncate font-khmer leading-snug">{{ person.name_kh || person.name_en }}</h3>
        <p class="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">{{ person.group || 'Staff' }}</p>
      </div>

      <button :disabled="isOnBreak" @click="confirmStart"
        class="w-full py-3 rounded-xl font-bold text-xs transition-all active:scale-95 flex items-center justify-center gap-2 font-khmer border border-white/10 hover:bg-white hover:text-black hover:border-white text-slate-300 shadow-lg cursor-pointer disabled:cursor-not-allowed">
        <component :is="isOnBreak ? Coffee : LogOut" class="w-3.5 h-3.5" />
        {{ btnText }}
      </button>
    </div>
  </div>
</template>