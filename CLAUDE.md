# Canonical Deal OS - Developer Commands

## Quick Start
```bash
npm run start         # Start all services (BFF + Kernel + Vite)
npm run health        # Check if all services are running
```

## Development Servers
```bash
npm run dev           # Vite dev server (frontend) - port 5173
npm run bff           # BFF server (API proxy) - port 8787
```

## Testing

### E2E Tests (Playwright)
```bash
npm run e2e           # Run all E2E tests
npm run e2e:ui        # Interactive UI mode (recommended for debugging)
npm run e2e:headed    # See browser while running
npm run e2e:debug     # Debug mode with step-through
npm run e2e:report    # View HTML test report
```

### Endpoint Tests
```bash
npm run test:endpoints  # Smoke test all API endpoints
```

### Unit Tests
```bash
npm run test          # Run Jest unit tests
npm run test:watch    # Watch mode
```

## Database
```bash
npm run db:generate   # Generate Prisma client
npm run db:push       # Push schema to database
npm run db:migrate    # Run migrations
npm run db:seed       # Seed sample deal data
npm run db:seed:auth  # Seed auth test users (admin, GP, analyst)
```

## Validation
```bash
npm run lint          # ESLint
npm run lint:fix      # Auto-fix lint issues
npm run validate:all  # Run all validations
```

## Architecture
- **Frontend**: React + Vite at localhost:5173
- **BFF**: Node.js proxy at localhost:8787
- **Kernel**: Fastify API at localhost:3001
- **Database**: PostgreSQL (Kernel) + SQLite (BFF LLM cache)

## Key Directories
- `src/pages/` - Main page components
- `src/components/` - Reusable UI components
- `server/` - BFF server code
- `server/routes/` - API route handlers
- `e2e/` - Playwright E2E tests
- `src/lib/permissions.js` - Role-based permissions

## Authentication
Test accounts (after running `npm run db:seed:auth`):
- **Admin**: admin@canonical.com / admin123
- **GP**: gp@canonical.com / gp123
- **Analyst** (pending): analyst@canonical.com / analyst123

Auth pages:
- `/Login` - Login page
- `/Signup` - Create account
- `/PendingVerification` - Waiting for approval
- `/AdminDashboard` - User management (admin only)

Roles: GP, GP Analyst, Lender, Counsel, Regulator, Auditor, LP, Admin
