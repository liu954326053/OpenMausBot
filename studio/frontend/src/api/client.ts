/**
 * HTTP client for API communication
 */

import type { ApiResult, ApiError } from '../types/api';

class ApiClient {
  private baseUrl = '/api/v1';

  async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, string | number | boolean>;
      headers?: Record<string, string>;
    }
  ): Promise<ApiResult<T>> {
    const url = new URL(this.baseUrl + path, window.location.origin);

    if (options?.query) {
      Object.entries(options.query).forEach(([key, value]) => {
        url.searchParams.append(key, String(value));
      });
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        ok: false,
        error: data.error || {
          code: 'UNKNOWN_ERROR',
          message: response.statusText,
        },
      } as ApiError;
    }

    return data;
  }

  get<T>(path: string, options?: Omit<Parameters<typeof this.request>[2], 'body'>) {
    return this.request<T>('GET', path, options);
  }

  post<T>(
    path: string,
    body?: unknown,
    options?: Omit<Parameters<typeof this.request>[2], 'body'>
  ) {
    return this.request<T>('POST', path, { ...options, body });
  }

  patch<T>(
    path: string,
    body?: unknown,
    options?: Omit<Parameters<typeof this.request>[2], 'body'>
  ) {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  delete<T>(path: string, options?: Omit<Parameters<typeof this.request>[2], 'body'>) {
    return this.request<T>('DELETE', path, options);
  }
}

export const apiClient = new ApiClient();
