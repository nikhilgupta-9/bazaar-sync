import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Fixed dev port (5174) — deliberately different from client/'s 5173 so
// both apps can run side by side. See CLAUDE.md Phase 10 for why this is a
// fully separate app/deployment, not a route inside client/.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5174,
    strictPort: true,
  },
})
