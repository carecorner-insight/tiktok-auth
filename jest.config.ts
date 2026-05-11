import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/types/(.*)$': '<rootDir>/src/types/$1',
    '^@/config/(.*)$': '<rootDir>/src/config/$1',
    '^@/nodes/(.*)$': '<rootDir>/src/nodes/$1',
    '^@/services/(.*)$': '<rootDir>/src/services/$1',
    '^@/adapters/(.*)$': '<rootDir>/src/adapters/$1',
    '^@/graph/(.*)$': '<rootDir>/src/graph/$1',
    '^@/__tests__/(.*)$': '<rootDir>/src/__tests__/$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/__tests__/**',
    '!src/types/**',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
    },
  },
};

export default config;
