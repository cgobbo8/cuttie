import { defineConfig } from '@adonisjs/transmit'

export default defineConfig({
  pingInterval: '30s',
  // Single local process: in-memory transport, no Redis needed
  transport: null,
})
