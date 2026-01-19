<script setup>
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../../stores/authStore';
import { LayoutDashboard, Users, Settings, LogOut, Menu, X, BarChart2 } from 'lucide-vue-next';
import CustomModal from '../../components/CustomModal.vue';

const sidebarOpen = ref(false);
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const showLogoutModal = ref(false);

const isActive = (path) => route.path.includes(path);

const confirmLogout = () => {
    auth.logout();
    router.push('/admin/login');
};
</script>

<template>
    <div class="flex h-screen bg-[#020202] text-white overflow-hidden font-sans">
        <div v-if="sidebarOpen" @click="sidebarOpen = false" class="fixed inset-0 bg-black/80 z-40 md:hidden backdrop-blur-sm"></div>

        <aside :class="['fixed inset-y-0 left-0 z-50 w-72 bg-[#050505] border-r border-white/5 flex flex-col transition-transform duration-300 md:relative md:translate-x-0', sidebarOpen ? 'translate-x-0' : '-translate-x-full']">
            <div class="p-8 border-b border-white/5 flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg">
                        <BarChart2 class="text-white w-5 h-5" />
                    </div>
                    <h1 class="font-bold text-lg font-khmer">Staff Hub</h1>
                </div>
                <button @click="sidebarOpen = false" class="md:hidden text-slate-400"><X class="w-6 h-6"/></button>
            </div>

            <nav class="flex-1 p-6 space-y-2 overflow-y-auto">
                <div class="text-[11px] font-bold text-slate-600 uppercase tracking-wider px-4 mb-3">Menu</div>
                
                <router-link to="/admin/dashboard" class="flex items-center gap-3 px-4 py-3 rounded-xl transition-all" 
                    :class="isActive('dashboard') ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'text-slate-400 hover:text-white hover:bg-white/5'">
                    <LayoutDashboard class="w-5 h-5" /> Dashboard
                </router-link>

                <router-link to="/admin/attendance" class="flex items-center gap-3 px-4 py-3 rounded-xl transition-all" 
                    :class="isActive('attendance') ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'text-slate-400 hover:text-white hover:bg-white/5'">
                    <Users class="w-5 h-5" /> Attendance
                </router-link>

                <router-link to="/admin/settings" class="flex items-center gap-3 px-4 py-3 rounded-xl transition-all" 
                    :class="isActive('settings') ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'text-slate-400 hover:text-white hover:bg-white/5'">
                    <Settings class="w-5 h-5" /> Settings
                </router-link>
            </nav>

            <div class="p-6 border-t border-white/5">
                <button @click="showLogoutModal = true" class="flex items-center gap-3 px-4 py-3 w-full text-rose-500 hover:bg-rose-500/10 rounded-xl transition-colors">
                    <LogOut class="w-5 h-5" /> Logout
                </button>
            </div>
        </aside>

        <div class="flex-1 flex flex-col h-full overflow-hidden">
            <header class="md:hidden h-16 bg-[#050505]/90 border-b border-white/5 flex items-center justify-between px-4 shrink-0">
                <div class="font-bold">Admin Panel</div>
                <button @click="sidebarOpen = true" class="p-2 bg-white/5 rounded-lg"><Menu class="w-6 h-6 text-slate-300" /></button>
            </header>

            <main class="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
                <router-view v-slot="{ Component }">
                    <transition name="fade" mode="out-in">
                        <component :is="Component" />
                    </transition>
                </router-view>
            </main>
        </div>

        <CustomModal 
            :show="showLogoutModal" 
            type="confirm" 
            title="Logout?" 
            message="Are you sure you want to end your session?" 
            confirmText="Logout"
            confirmColor="bg-rose-500 text-white"
            @close="showLogoutModal = false"
            @confirm="confirmLogout"
        />
    </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar { width: 6px; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>