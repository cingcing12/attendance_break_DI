<script setup>
import { Clock, LogIn, Check } from 'lucide-vue-next';
import { computed } from 'vue';

// Accept 'now' as a prop from the parent
const props = defineProps(['item', 'staffInfo', 'now']);
const emit = defineEmits(['timeIn']);

const khName = computed(() => props.staffInfo ? (props.staffInfo.name_kh || props.staffInfo.name_en) : props.item.name);
const imgUrl = computed(() => props.item.image || (props.staffInfo?.image) || `https://ui-avatars.com/api/?background=random&name=${props.item.name}`);

// 4. Reactive Duration Calculation
const durationStr = computed(() => {
    if (!props.item.timeOut || !props.now) return "00m";
    
    // Parse "9:40 AM"
    const [time, modifier] = props.item.timeOut.split(' ');
    let [hours, minutes] = time.split(':');
    hours = parseInt(hours);
    if (hours === 12 && modifier === 'AM') hours = 0;
    if (hours !== 12 && modifier === 'PM') hours += 12;

    const startTime = new Date(props.now);
    startTime.setHours(hours, parseInt(minutes), 0);
    
    // If break started "tomorrow" (data error) or long ago, adjust day
    if (startTime > props.now) startTime.setDate(startTime.getDate() - 1);

    const diffMs = props.now - startTime;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 0) return "00m";
    return `${diffMins}m`;
});

const isOvertime = computed(() => {
    return parseInt(durationStr.value) > 15;
});
</script>

<template>
  <div :class="[
        'card-onyx p-4 flex flex-col items-center relative animate-fade-in border-t-2',
        isOvertime ? 'border-rose-500/50 shadow-[0_0_20px_rgba(244,63,94,0.1)]' : 'border-t-transparent hover:border-t-cyan-400'
       ]">
      
       <div class="w-full relative">
            <div class="absolute -top-1 -right-1 z-20">
                <span class="bg-surface/90 border border-white/10 text-white text-[10px] font-mono font-bold px-2 py-1 rounded-lg">#{{ item.id }}</span>
            </div>
            
            <div class="flex items-center w-full gap-3 mb-4 mt-1">
                <img :src="imgUrl" class="w-14 h-14 rounded-full object-cover border border-white/10 bg-black">
                <div class="flex-1 min-w-0">
                    <h3 class="font-bold text-white text-sm truncate font-khmer">{{ khName }}</h3>
                    <div class="flex items-center gap-1.5 text-[10px] text-slate-400 mt-1">
                        <Clock class="w-3 h-3 text-cyan-400" />
                        <span>Out: {{ item.timeOut }}</span>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-2 w-full mb-4">
                 <div class="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-2.5 flex flex-col items-center justify-center">
                    <span class="text-[9px] text-cyan-400/70 font-bold uppercase">Card</span>
                    <span class="text-xl font-black text-cyan-400 font-mono truncate w-full text-center">{{ item.card || '--' }}</span>
                 </div>
                 <div class="bg-white/5 border border-white/10 rounded-xl p-2.5 flex flex-col items-center justify-center">
                    <span class="text-[9px] text-slate-500 font-bold uppercase">Duration</span>
                    <span class="text-xl font-black font-mono transition-colors duration-500"
                          :class="isOvertime ? 'text-rose-500' : 'text-white'">
                        {{ durationStr }}
                    </span>
                 </div>
            </div>

            <button @click="$emit('timeIn', item.id, khName)" 
                class="w-full bg-emerald-500/10 hover:bg-emerald-500 hover:text-black text-emerald-400 border border-emerald-500/30 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 group font-khmer transition-all">
                <span class="group-hover:hidden flex items-center gap-2"><LogIn class="w-3.5 h-3.5"/> ចូលធ្វើការ</span>
                <span class="hidden group-hover:flex items-center gap-2"><Check class="w-3.5 h-3.5"/> បញ្ជាក់</span>
            </button>
       </div>
  </div>
</template>