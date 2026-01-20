const isBrowser = typeof window !== "undefined";

export function debugLog(scope, message, data) {
  if (!import.meta.env.DEV || !isBrowser) return;

  let enabled = false;
  try {
    enabled =
      window.localStorage?.getItem(`debug_${scope}`) === "true" ||
      window.localStorage?.getItem("debug_all") === "true";
  } catch {
    enabled = false;
  }

  if (!enabled) return;

  const timestamp = new Date().toISOString();
  const prefix = `[${scope.toUpperCase()} ${timestamp}]`;

  if (data !== undefined) {
    console.log(`${prefix} ${message}`, data);
    return;
  }

  console.log(`${prefix} ${message}`);
}

export function isDebugEnabled(scope) {
  if (!import.meta.env.DEV || !isBrowser) return false;
  try {
    return (
      window.localStorage?.getItem(`debug_${scope}`) === "true" ||
      window.localStorage?.getItem("debug_all") === "true"
    );
  } catch {
    return false;
  }
}
