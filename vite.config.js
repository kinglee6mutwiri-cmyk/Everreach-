import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
    server: {
        host: '0.0.0.0',
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:3000',
                changeOrigin: true
            }
        }
    },
    build: {
        rollupOptions: {
            input: {
                index: resolve(process.cwd(), 'index.html'),
                login: resolve(process.cwd(), 'login.html'),
                signup: resolve(process.cwd(), 'signup.html'),
                dashboard: resolve(process.cwd(), 'dashboard.html'),
                profile: resolve(process.cwd(), 'profile.html')
            }
        }
    }
});
