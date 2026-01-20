export default {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js', '**/?(*.)+(spec|test).js'],
  collectCoverageFrom: [
    'server/**/*.js',
    '!server/**/*.test.js',
    '!server/node_modules/**'
  ],
  testTimeout: 30000,
  verbose: true,
  // ESM support - use --experimental-vm-modules flag
  transform: {},
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  // Load environment variables before tests
  setupFilesAfterEnv: ['./jest.setup.js']
};
