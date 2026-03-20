import cron, { type ScheduledTask } from 'node-cron';
import { loadConfig } from './config.node';
import logger from './logger';

const log = logger.child({ module: 'scheduler' });

const globalForScheduler = globalThis as unknown as {
  __schedulerRunning?: boolean;
  __schedulerTasks?: ScheduledTask[];
};

async function triggerPoll(path: string, method: 'GET' | 'POST' = 'POST'): Promise<void> {
  const port = process.env.PORT || '3000';
  const url = `http://localhost:${port}${path}`;

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Pepper-Internal': '1',
      },
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log.error({ path, status: res.status, body: body.slice(0, 200) }, 'Poll trigger failed');
    } else {
      const data = await res.json().catch(() => ({}));
      log.info({ path, data }, 'Poll completed');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ path, err: msg }, 'Poll trigger error');
  }
}

function intervalToCron(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes === 1) return '* * * * *';
  return `*/${minutes} * * * *`;
}

export function startScheduler(): void {
  if (globalForScheduler.__schedulerRunning) {
    log.debug('Scheduler already running — skipping init');
    return;
  }

  const config = loadConfig();
  const emailInterval = config.polling.emailIntervalSeconds || 300;
  const teamsInterval = config.polling.teamsIntervalSeconds || 300;

  const tasks: ScheduledTask[] = [];

  // Email polling
  const emailCron = intervalToCron(emailInterval);
  tasks.push(cron.schedule(emailCron, () => { triggerPoll('/api/poll/email'); }));
  log.info({ cron: emailCron, intervalSec: emailInterval }, 'Scheduled email polling');

  // Teams polling
  const teamsCron = intervalToCron(teamsInterval);
  tasks.push(cron.schedule(teamsCron, () => { triggerPoll('/api/poll/teams'); }));
  log.info({ cron: teamsCron, intervalSec: teamsInterval }, 'Scheduled Teams polling');

  // Edge history sync — every 30 minutes
  tasks.push(cron.schedule('*/30 * * * *', () => { triggerPoll('/api/import/edge-history'); }));
  log.info('Scheduled Edge history sync every 30 minutes');

  // Ingestion analysis — every 10 minutes
  tasks.push(cron.schedule('*/10 * * * *', () => { triggerPoll('/api/ingest/analyze'); }));
  log.info('Scheduled ingestion analysis every 10 minutes');

  // Morning digest — daily at 7:00 AM
  tasks.push(cron.schedule('0 7 * * *', () => { triggerPoll('/api/digest?days=1&auto=1', 'GET'); }));
  log.info('Scheduled morning digest daily at 7:00 AM');

  // Follow-up detection — every 15 minutes
  tasks.push(cron.schedule('*/15 * * * *', () => { triggerPoll('/api/follow-ups'); }));
  log.info('Scheduled follow-up detection every 15 minutes');

  // Todo extraction — every 15 minutes
  tasks.push(cron.schedule('*/15 * * * *', () => { triggerPoll('/api/todos/extract'); }));
  log.info('Scheduled todo extraction every 15 minutes');

  globalForScheduler.__schedulerRunning = true;
  globalForScheduler.__schedulerTasks = tasks;
  log.info('Background scheduler started');
}

export function stopScheduler(): void {
  if (globalForScheduler.__schedulerTasks) {
    for (const task of globalForScheduler.__schedulerTasks) {
      task.stop();
    }
    globalForScheduler.__schedulerTasks = [];
  }
  globalForScheduler.__schedulerRunning = false;
  log.info('Background scheduler stopped');
}
