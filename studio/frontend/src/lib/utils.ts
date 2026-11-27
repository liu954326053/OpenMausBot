/**
 * Common utility functions
 */

export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateTime(isoString: string): string {
  return `${formatDate(isoString)} ${formatTime(isoString)}`;
}

export function getStatusColor(
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'
): 'default' | 'success' | 'warning' | 'error' {
  const statusMap = {
    queued: 'default',
    running: 'default',
    completed: 'success',
    failed: 'error',
    cancelled: 'warning',
    paused: 'warning',
  } as const;
  return statusMap[status];
}

export function getStatusLabel(
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'
): string {
  const labels = {
    queued: '排队中',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    paused: '已暂停',
  };
  return labels[status];
}
