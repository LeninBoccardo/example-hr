import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  testTimeout: 30000,
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    'apps/timeoff/src/**/*.ts',
    '!apps/timeoff/src/**/*.module.ts',
    '!apps/timeoff/src/main.ts',
    '!apps/timeoff/src/**/*.dto.ts',
    '!apps/timeoff/src/**/*.entity.ts',
    '!apps/timeoff/src/**/migrations/**',
  ],
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@timeoff/(.*)$': '<rootDir>/apps/timeoff/src/$1',
  },
  coverageThreshold: {
    global: {
      statements: 88,
      branches: 70,
      functions: 80,
      lines: 88,
    },
  },
  setupFiles: ['<rootDir>/test/jest.setup.ts'],
};

export default config;
