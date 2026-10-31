import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.js'],
        // Modules under src/lib throw at import time without these; tests
        // never reach a real Supabase project or Telegram.
        env: {
            SUPABASE_URL: 'http://localhost:54321',
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
            JWT_SECRET: 'test-jwt-secret',
            BOT_TOKEN: '123456:TEST',
        },
    },
});
