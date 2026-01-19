<script setup>
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-vue-next';
import { onMounted, onUnmounted, watch } from 'vue';

const props = defineProps({
  show: Boolean,
  type: { type: String, default: 'success' }, // 'success' | 'error' | 'warning'
  title: String,
  message: String,
});

const emit = defineEmits(['close']);

// Auto-close after 4 seconds
let timer;
watch(() => props.show, (newVal) => {
  if (newVal) {
    clearTimeout(timer);
    timer = setTimeout(() => emit('close'), 4000);
  }
});
</script>

<template>
  <Transition
    enter-active-class="transform ease-out duration-300 transition"
    enter-from-class="translate-y-2 opacity-0 sm:translate-y-0 sm:translate-x-2"
    enter-to-class="translate-y-0 opacity-100 sm:translate-x-0"
    leave-active-class="transition ease-in duration-100"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div v-if="show" class="fixed bottom-6 right-6 z-[200] max-w-sm w-full pointer-events-auto">
        <div class="bg-[#18181b] border rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.8)] p-4 flex items-start gap-4 relative overflow-hidden"
             :class="type === 'error' ? 'border-rose-500/30' : 'border-emerald-500/30'">
            
            <div class="absolute inset-0 opacity-20 pointer-events-none bg-gradient-to-r"
                 :class="type === 'error' ? 'from-rose-500/20 to-transparent' : 'from-emerald-500/20 to-transparent'">
            </div>

            <div class="shrink-0 relative z-10">
                <CheckCircle v-if="type === 'success'" class="w-6 h-6 text-emerald-400" />
                <XCircle v-else-if="type === 'error'" class="w-6 h-6 text-rose-400" />
                <AlertTriangle v-else class="w-6 h-6 text-amber-400" />
            </div>

            <div class="flex-1 pt-0.5 relative z-10">
                <h3 class="text-sm font-bold text-white font-khmer leading-none mb-1">{{ title }}</h3>
                <p class="text-xs text-slate-400 font-khmer leading-relaxed">{{ message }}</p>
            </div>

            <button @click="$emit('close')" class="shrink-0 text-slate-500 hover:text-white transition-colors relative z-10">
                <span class="text-lg">×</span>
            </button>
        </div>
    </div>
  </Transition>
</template>