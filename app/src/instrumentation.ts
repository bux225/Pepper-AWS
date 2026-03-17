import { startScheduler } from './lib/scheduler';

/**
 * Next.js instrumentation hook — runs once on server startup.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only start the scheduler on the server (not during build or edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    startScheduler();
  }
}
