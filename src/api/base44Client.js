import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

export const DEMO_USER = {
  id: "local-demo-user",
  name: "Local Operator",
  role: "GP",
  email: "demo@local"
};

export const isBase44Configured = Boolean(
  appId && functionsVersion && appBaseUrl
);

const base44Stub = {
  auth: {
    me: async () => DEMO_USER,
    logout: () => {},
    redirectToLogin: () => {}
  },
  appLogs: {
    logUserInApp: async () => {}
  }
};

// Create a client only when configured
export const base44 = isBase44Configured
  ? createClient({
      appId,
      token,
      functionsVersion,
      serverUrl: '',
      requiresAuth: false,
      appBaseUrl
    })
  : base44Stub;
