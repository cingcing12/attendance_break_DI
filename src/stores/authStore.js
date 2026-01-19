import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useRouter } from 'vue-router';

export const useAuthStore = defineStore('auth', () => {
    const token = ref(localStorage.getItem('admin_token') || null);
    const router = useRouter();
    const API_URL = "https://attendance-break-di-vsc6.onrender.com";

    const login = async (email, password) => {
        try {
            const res = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (data.success) {
                token.value = data.token;
                localStorage.setItem('admin_token', data.token);
                return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    };

    const logout = () => {
        token.value = null;
        localStorage.removeItem('admin_token');
        // We will handle redirect in the view or router
    };

    const isAuthenticated = () => !!token.value;

    return { token, login, logout, isAuthenticated };
});