import { defineStore } from 'pinia'
import { ref } from 'vue'
import { io } from 'socket.io-client'

export const useStaffStore = defineStore('staff', () => {
    const API_URL = "https://attendance-break-di-vsc6.onrender.com";
    
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
        socket.value = io(API_URL);
        socket.value.on('data_updated', () => {
            console.log("Socket Sync Triggered");
            fetchData();
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
            await fetchData(); // Refresh data immediately
            return data.card;  // Return card number for the UI to show
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