<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/authStore';
import { ShieldCheck, ArrowRight, Loader2 } from 'lucide-vue-next';
import CustomToast from '../../components/CustomToast.vue'; // Reuse your toast

const email = ref('');
const password = ref('');
const isLoading = ref(false);
const auth = useAuthStore();
const router = useRouter();
const showToast = ref(false);

const handleLogin = async () => {
    isLoading.value = true;
    const success = await auth.login(email.value, password.value);
    isLoading.value = false;

    if (success) {
        router.push('/admin/dashboard');
    } else {
        showToast.value = true;
    }
};
</script>

<template>
    <div class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black">
        <div class="bg-[#121212]/90 backdrop-blur-xl border border-white/10 w-full max-w-md p-8 rounded-3xl shadow-2xl animate-fade-in">
            <div class="text-center mb-10">
                <div class="w-16 h-16 bg-gradient-to-tr from-indigo-600 to-purple-600 rounded-2xl mx-auto flex items-center justify-center shadow-lg shadow-indigo-500/30 mb-5">
                    <ShieldCheck class="text-white w-8 h-8" />
                </div>
                <h2 class="text-3xl font-bold text-white font-khmer tracking-tight">ចូលប្រើប្រាស់ប្រព័ន្ធ</h2>
                <p class="text-slate-400 text-sm mt-2">Admin Dashboard Login</p>
            </div>
            
            <form @submit.prevent="handleLogin" class="space-y-6">
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Email</label>
                    <input v-model="email" type="email" class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3.5 text-white outline-none focus:border-indigo-500 transition-colors" required>
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Password</label>
                    <input v-model="password" type="password" class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3.5 text-white outline-none focus:border-indigo-500 transition-colors" required>
                </div>
                <button :disabled="isLoading" type="submit" class="w-full py-3.5 rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-xl shadow-indigo-900/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                    <Loader2 v-if="isLoading" class="w-4 h-4 animate-spin" />
                    <span v-else>Login Access</span>
                    <ArrowRight v-if="!isLoading" class="w-4 h-4" />
                </button>
            </form>
        </div>
        <CustomToast :show="showToast" type="error" title="Login Failed" message="Invalid credentials" @close="showToast=false" />
    </div>
</template>