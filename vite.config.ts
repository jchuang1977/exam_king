import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import hostingConfig from './.openai/hosting.json'
import { sites } from './build/sites-vite-plugin'

export default defineConfig(({ mode }) => {
  const { d1, r2 } = hostingConfig
  process.env.WRANGLER_WRITE_LOGS ??= 'false'
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs'
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry'
  const cloudflarePlugins = mode === 'test' ? [] : cloudflare({
      viteEnvironment: { name: 'server' },
      config: {
        main: './worker/index.ts',
        compatibility_date: '2026-05-22',
        compatibility_flags: ['nodejs_compat'],
          assets: {
            binding: 'ASSETS',
            not_found_handling: 'single-page-application',
            run_worker_first: true,
          },
        d1_databases: d1 ? [{ binding: d1, database_name: 'exam-king-d1', database_id: '00000000-0000-4000-8000-000000000000' }] : [],
        r2_buckets: r2 ? [{ binding: r2, bucket_name: 'exam-king-r2' }] : [],
      },
    })

  return {
    base: '/',
    plugins: [
      react(),
      sites(),
      cloudflarePlugins,
    ],
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }
})
