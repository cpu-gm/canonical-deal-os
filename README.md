**Welcome to your Base44 project** 

**About**

View and Edit  your app on [Base44.com](http://Base44.com) 

This project contains everything you need to run your app locally.

**Edit the code in your local development environment**

Any change pushed to the repo will also be reflected in the Base44 Builder.

**Prerequisites:** 

1. Clone the repository using the project's Git URL 
2. Navigate to the project directory
3. Install dependencies: `npm install`
4. Create an `.env.local` file and set the right environment variables

```
VITE_BASE44_APP_ID=your_app_id
VITE_BASE44_APP_BASE_URL=your_backend_url

e.g.
VITE_BASE44_APP_ID=cbef744a8545c389ef439ea6
VITE_BASE44_APP_BASE_URL=https://my-to-do-list-81bfaad7.base44.app
```

Run the app: `npm run dev`

**Publish your changes**

Open [Base44.com](http://Base44.com) and click on Publish.

**Docs & Support**

Documentation: [https://docs.base44.com/Integrations/Using-GitHub](https://docs.base44.com/Integrations/Using-GitHub)

Support: [https://app.base44.com/support](https://app.base44.com/support)

**Kernel Integration (Local Dev)**

This repo now includes a Canonical BFF that proxies Kernel APIs and serves the GP-first surfaces.

**Ports**
- Kernel API: `http://localhost:3001` (from `cre-kernel-phase1/apps/kernel-api/src/config.ts`)
- Canonical BFF: `http://localhost:8787`
- Vite UI: `http://localhost:5173`

**Run (3 terminals)**
1. Kernel API (in `cre-kernel-phase1`):
   - `npm install`
   - `npm run dev:api`
2. Canonical BFF (in `canonical-deal-os`):
   - `npm install`
   - `npm run dev:bff`
3. Canonical UI (in `canonical-deal-os`):
   - `npm run dev`

**BFF Env Vars (optional)**
- Copy `.env.example` values into your shell environment (BFF reads `process.env`).
- `KERNEL_API_URL` (default `http://localhost:3001`)
- `BFF_PORT` (default `8787`)

**Base44 (optional)**
- Base44 SDK initializes only when `VITE_BASE44_APP_ID`, `VITE_BASE44_APP_BASE_URL`, and `VITE_BASE44_FUNCTIONS_VERSION` are set.
- When unset, the app runs in Kernel/BFF mode with a local demo user (role `GP`) and no Base44 network calls.

**OpenAI LLM (optional, BFF)**
- Set `BFF_OPENAI_API_KEY` to enable `/api/llm/parse-deal` via OpenAI.
- Optional overrides: `BFF_OPENAI_MODEL`, `BFF_OPENAI_BASE_URL`, `BFF_OPENAI_ORG`, `BFF_OPENAI_PROJECT`, `BFF_OPENAI_TEMPERATURE`.
