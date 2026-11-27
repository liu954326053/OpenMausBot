/**
 * Hooks for custom state and side effects
 */

import { useEffect, useRef } from 'react';

/**
 * Hook to handle auto-save with debounce
 */
export function useAutoSave<T>(
  value: T,
  onSave: (value: T) => Promise<void>,
  delayMs: number = 2000
) {
  const timeoutRef = useRef<NodeJS.Timeout>();
  const isSavingRef = useRef(false);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(async () => {
      if (isSavingRef.current) return;
      isSavingRef.current = true;

      try {
        await onSave(value);
      } finally {
        isSavingRef.current = false;
      }
    }, delayMs);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [value, onSave, delayMs]);
}

/**
 * Hook to subscribe to real-time events (SSE)
 */
export function useEventStream(url: string, onEvent: (event: any) => void) {
  useEffect(() => {
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onEvent(data);
      } catch (error) {
        console.error('Failed to parse event:', error);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [url, onEvent]);
}
