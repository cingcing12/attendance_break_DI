<script setup>
import { Check, AlertCircle, X, Coffee, LogIn } from 'lucide-vue-next';
import { onMounted, onUnmounted } from 'vue';

const props = defineProps({
  show: Boolean,
  type: { type: String, default: 'confirm' }, // 'confirm' or 'success'
  title: String,
  message: String,
  subMessage: String, // For things like "Card: DD_01"
  confirmText: { type: String, default: 'Confirm' },
  confirmColor: { type: String, default: 'bg-white text-black' },
  icon: String // 'coffee', 'login', 'success'
});

const emit = defineEmits(['close', 'confirm']);

// Close on Escape key
const handleKey = (e) => { if (e.key === 'Escape' && props.show) emit('close'); };
onMounted(() => window.addEventListener('keydown', handleKey));
onUnmounted(() => window.removeEventListener('keydown', handleKey));
</script>

<template>
  <Transition 
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div v-if="show" class="fixed inset-0 z-[150] flex items-center justify-center p-4">
        
        <div @click="$emit('close')" class="absolute inset-0 bg-black/80 backdrop-blur-sm"></div>

        <Transition
            enter-active-class="transition duration-300 cubic-bezier(0.34, 1.56, 0.64, 1)"
            enter-from-class="opacity-0 scale-90 translate-y-8"
            enter-to-class="opacity-100 scale-100 translate-y-0"
            leave-active-class="transition duration-200 ease-in"
            leave-from-class="opacity-100 scale-100"
            leave-to-class="opacity-0 scale-95 translate-y-4"
        >
            <div v-if="show" class="relative w-full max-w-sm bg-[#18181b] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col items-center text-center p-6">
                
                <div class="absolute top-0 left-1/2 -translate-x-1/2 w-full h-32 bg-gradient-to-b from-white/5 to-transparent pointer-events-none"></div>

                <div class="relative w-16 h-16 rounded-2xl flex items-center justify-center mb-5 shadow-lg border border-white/10"
                     :class="type === 'success' ? 'bg-emerald-500/10' : 'bg-white/5'">
                    
                    <Coffee v-if="icon === 'coffee'" class="w-8 h-8 text-rose-400" />
                    <LogIn v-else-if="icon === 'login'" class="w-8 h-8 text-cyan-400" />
                    <Check v-else class="w-8 h-8 text-emerald-400" />
                </div>

                <h3 class="text-2xl font-bold text-white font-khmer mb-2">{{ title }}</h3>
                <p class="text-slate-400 font-khmer text-sm leading-relaxed px-2">{{ message }}</p>
                
                <div v-if="subMessage" class="mt-4 py-2 px-4 bg-white/5 rounded-xl border border-white/5">
                    <span class="text-xl font-black font-mono text-cyan-400">{{ subMessage }}</span>
                </div>

                <div class="grid grid-cols-2 gap-3 w-full mt-8">
                    <button v-if="type === 'confirm'" @click="$emit('close')" 
                        class="py-3 rounded-xl font-bold text-sm bg-white/5 hover:bg-white/10 text-slate-400 transition-colors">
                        Cancel
                    </button>
                    
                    <button @click="$emit('confirm')" 
                        :class="[
                            'py-3 rounded-xl font-bold text-sm transition-transform active:scale-95 shadow-lg',
                            confirmColor,
                            type === 'success' ? 'col-span-2' : ''
                        ]">
                        {{ confirmText }}
                    </button>
                </div>

            </div>
        </Transition>
    </div>
  </Transition>
</template>