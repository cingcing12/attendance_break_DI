import { defineStore } from 'pinia'
import { ref } from 'vue'
import { io } from 'socket.io-client'

export const useStaffStore = defineStore('staff', () => {
    
    // 🛠️ CONFIGURATION: AUTO-SWITCH URL
    // If you are running 'npm run dev', it uses localhost:3000
    // If you build for production, it uses your Render URL
    const API_URL = import.meta.env.DEV 
        ? "http://localhost:3000" 
        : "https://attendance-break-di-vsc6.onrender.com";

    // --- STATE ---
    const allStaff = ref([]);
    const activeBreaks = ref([]);
    const socket = ref(null);

    // --- ACTIONS ---
    const fetchData = async () => {
        try {
            const [resStaff, resBreaks] = await Promise.all([
                fetch(`${API_URL}/staff`),
                fetch(`${API_URL}/active-breaks`)
            ]);
            if(resStaff.ok) allStaff.value = await resStaff.json();
            if(resBreaks.ok) activeBreaks.value = await resBreaks.json();
        } catch (e) { console.error("Fetch Error", e); }
    };

    const setupSocket = () => {
        if(socket.value) return; // Prevent double connection
        
        // ⚡ Add transports for better connection stability
        socket.value = io(API_URL, { transports: ['websocket', 'polling'] });
        
        socket.value.on("connect", () => {
            console.log(`🟢 Connected to Socket (${API_URL})`);
        });

        // ⚡ FIX: Event name must match Backend ('database_updated')
        socket.value.on('database_updated', (payload) => {
            console.log("🔥 Store received update:", payload);
            fetchData(); // Refresh data instantly when ANY device acts
        });
    };

    const disconnectSocket = () => {
        if(socket.value) {
            socket.value.disconnect();
            socket.value = null;
        }
    };

    // API: Start Break
    const apiStartBreak = async (person, area) => {
        const res = await fetch(`${API_URL}/break`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                id: person.id, name: person.name_kh || person.name_en, 
                group: person.group, area: area 
            })
        });
        const data = await res.json();
        if(data.status === 'success') {
            await fetchData(); 
            return data.card;  
        }
        throw new Error('Failed to start break');
    };

    // API: Time In
    const apiTimeIn = async (id) => {
        await fetch(`${API_URL}/timein`, {
            method: 'POST', 
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ id })
        });
        await fetchData();
    };

    return { 
        allStaff, 
        activeBreaks, 
        fetchData, 
        setupSocket, 
        disconnectSocket, 
        apiStartBreak, 
        apiTimeIn 
    }
})