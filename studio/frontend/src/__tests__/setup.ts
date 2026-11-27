import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock window.studio API
Object.defineProperty(window, 'studio', {
  value: {
    rpc: {
      call: vi.fn(),
    },
  },
  writable: true,
});
