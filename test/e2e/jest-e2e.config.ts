import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '../..',
  testRegex: 'test/e2e/.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@timeoff/(.*)$': '<rootDir>/apps/timeoff/src/$1',
  },
  testTimeout: 30000,
  setupFiles: ['<rootDir>/test/jest.setup.ts'],
};

export default config;
