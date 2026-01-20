import { PrismaClient } from "@prisma/client";

// Structured logging helper
function log(level, category, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[${timestamp}] [${level}] [${category}] ${message}${metaStr}`);
}

let prismaClient = null;
let connectionChecked = false;

export function getPrisma() {
  if (prismaClient) {
    return prismaClient;
  }

  log('INFO', 'DB', 'Initializing Prisma client');

  prismaClient = new PrismaClient({
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' }
    ]
  });

  // Log Prisma errors
  prismaClient.$on('error', (e) => {
    log('ERROR', 'DB', 'Prisma error', { message: e.message });
  });

  prismaClient.$on('warn', (e) => {
    log('WARN', 'DB', 'Prisma warning', { message: e.message });
  });

  // Test connection on first access
  if (!connectionChecked) {
    connectionChecked = true;
    prismaClient.$connect()
      .then(() => {
        log('INFO', 'DB', 'Database connection established');
      })
      .catch((err) => {
        log('ERROR', 'DB', 'Database connection failed', { error: err.message });
      });
  }

  return prismaClient;
}
