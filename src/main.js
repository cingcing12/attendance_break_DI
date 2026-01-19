import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

// 👇 ADD THIS LINE! 
// (Make sure the path matches where you saved your Tailwind directives)
import './assets/main.css' 

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')