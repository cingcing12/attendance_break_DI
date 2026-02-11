import { defineStore } from 'pinia'
import { ref } from 'vue'
import { io } from 'socket.io-client'

export const useStaffStore = defineStore('staff', () => {
    
    // 🛠️ CONFIGURATION
    const API_URL = import.meta.env.DEV 
        ? "http://localhost:3000" 
        : "https://attendance-break-di-vsc6.onrender.com";

    // --- STATE ---
    const allStaff = ref([]);
    const activeBreaks = ref([]);
    const zoneSettings = ref({ zoneA: true, zoneB: true }); // Default Open
    const socket = ref(null);

    // --- ACTIONS ---
    const fetchData = async () => {
        try {
            const [resStaff, resBreaks, resSettings] = await Promise.all([
                fetch(`${API_URL}/staff`),
                fetch(`${API_URL}/active-breaks`),
                fetch(`${API_URL}/settings`)
            ]);
            
            if(resStaff.ok) allStaff.value = await resStaff.json();
            if(resBreaks.ok) activeBreaks.value = await resBreaks.json();
            if(resSettings.ok) zoneSettings.value = await resSettings.json();
            
        } catch (e) { console.error("Fetch Error", e); }
    };

    const setupSocket = () => {
        if(socket.value) return; 
        
        socket.value = io(API_URL, { transports: ['websocket', 'polling'] });
        
        socket.value.on("connect", () => {
            console.log(`🟢 Connected to Socket (${API_URL})`);
        });

        socket.value.on('database_updated', (payload) => {
            console.log("🔥 Store received update:", payload);
            
            // If it's a settings update, update state directly
            if (payload.type === 'settings_updated') {
                zoneSettings.value = payload.settings;
            } else {
                // Otherwise refresh data (breaks/timeins)
                fetchData(); 
            }
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
        // Optimistic check: prevent call if we know it's closed
        if (area === 'A' && !zoneSettings.value.zoneA) throw new Error('Zone A is Closed');
        if (area === 'B' && !zoneSettings.value.zoneB) throw new Error('Zone B is Closed');

        const res = await fetch(`${API_URL}/break`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                id: person.id, name: person.name_kh || person.name_en, 
                group: person.group, area: area 
            })
        });
        const data = await res.json();
        
        if (data.status === 'error') {
             throw new Error(data.message);
        }

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
        zoneSettings,
        fetchData, 
        setupSocket, 
        disconnectSocket, 
        apiStartBreak, 
        apiTimeIn 
    }
})