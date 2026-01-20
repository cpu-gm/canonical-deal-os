const fs = require('fs');
const path = require('path');

const bffPath = path.join(__dirname, '..', 'src', 'api', 'bffClient.js');
let content = fs.readFileSync(bffPath, 'utf8');

// Check if already patched
if (content.includes('reportApiError')) {
  console.log('bffClient.js already patched');
  process.exit(0);
}

// Find the position after API_BASE declaration
const apiBaseLine = 'const API_BASE = "/api";';
const apiBaseEnd = content.indexOf(apiBaseLine) + apiBaseLine.length;

const insertCode = `

// Error reporting for dev overlay
let reportApiError = null;
if (import.meta.env.DEV) {
  import('@/components/dev/ApiErrorOverlay').then(module => {
    reportApiError = module.reportApiError;
  }).catch(() => {});
}`;

// Insert the error reporting setup
content = content.slice(0, apiBaseEnd) + insertCode + content.slice(apiBaseEnd);

// Update requestJson to report errors
const oldErrorHandling = `if (!response.ok) {
    const error = new Error(data?.message || \`Request failed (\${response.status})\`);
    error.status = response.status;
    error.data = data;
    throw error;
  }`;

const newErrorHandling = `if (!response.ok) {
    const errorMessage = data?.message || data?.error || \`Request failed (\${response.status})\`;
    const error = new Error(errorMessage);
    error.status = response.status;
    error.data = data;

    // Report to dev overlay
    if (reportApiError) {
      reportApiError({
        method: options.method || 'GET',
        path,
        status: response.status,
        message: errorMessage,
        details: data?.details || null,
      });
    }

    throw error;
  }`;

content = content.replace(oldErrorHandling, newErrorHandling);

fs.writeFileSync(bffPath, content);
console.log('Patched bffClient.js with error reporting');
