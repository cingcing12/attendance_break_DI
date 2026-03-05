import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import DashboardView from '../views/DashboardView.vue'
// Admin Components
import AdminLogin from '../views/admin/AdminLogin.vue'
import AdminLayout from '../views/admin/AdminLayout.vue'
import AdminDashboard from '../views/admin/AdminDashboard.vue'
import AdminAttendance from '../views/admin/AdminAttendance.vue'
import AdminSettings from '../views/admin/AdminSettings.vue'
import { useAuthStore } from '../stores/authStore'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/dashboard/:area', name: 'dashboard', component: DashboardView },
    
    // --- ADMIN ROUTES ---
    { path: '/admin/login', name: 'admin-login', component: AdminLogin },
    { 
      path: '/admin', 
      component: AdminLayout,
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: '/admin/dashboard' }, // Default
        { path: 'dashboard', name: 'admin-home', component: AdminDashboard },
        { path: 'attendance', name: 'admin-attendance', component: AdminAttendance },
        { path: 'settings', name: 'admin-settings', component: AdminSettings }
      ]
    }
  ]
})

// --- LOGIN GUARD ---
router.beforeEach((to, from, next) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.isAuthenticated()) {
    next('/admin/login');
  } else {
    next();
  }
});

export default router