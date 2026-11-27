/**
 * Tasks management page
 */

import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Badge, Spinner } from '../components/ui';
import { useAppStore } from '../stores/app';
import { apiClient } from '../api/client';
import { getStatusColor, getStatusLabel, formatDateTime } from '../lib/utils';

export function TasksPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { tasks, setTasks, isLoading, setLoading, setError } = useAppStore();

  useEffect(() => {
    if (!projectId) return;
    loadTasks();

    // Refresh tasks every 5 seconds
    const interval = setInterval(loadTasks, 5000);
    return () => clearInterval(interval);
  }, [projectId]);

  const loadTasks = async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);

    const result = await apiClient.get(`/projects/${projectId}/tasks`, {
      query: { limit: 100 },
    });
    setLoading(false);

    if (result.ok) {
      setTasks(result.data.items);
    } else {
      setError(result.error.message);
    }
  };

  const handleStartTasks = async () => {
    if (!projectId) return;
    const result = await apiClient.post(`/projects/${projectId}/tasks:start`, {
      nodeIds: [],
      maxConcurrent: 4,
    });

    if (result.ok) {
      loadTasks();
    }
  };

  const handleCancelAll = async () => {
    if (!projectId || !confirm('确定要取消所有运行中的任务吗？')) return;

    const result = await apiClient.post(`/projects/${projectId}/tasks:cancel`, {
      taskIds: tasks.filter((t) => t.status === 'running').map((t) => t.id),
      reason: '用户手动取消',
    });

    if (result.ok) {
      loadTasks();
    }
  };

  if (isLoading && tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-text-primary">任务</h2>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={loadTasks}>
            刷新
          </Button>
          <Button variant="primary" size="sm" onClick={handleStartTasks}>
            启动任务
          </Button>
          <Button variant="danger" size="sm" onClick={handleCancelAll}>
            全部取消
          </Button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="text-center text-text-secondary py-12">
          <p>暂无任务</p>
        </div>
      ) : (
        <div className="space-y-2 overflow-auto flex-1">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-4 p-4 bg-bg-card border border-border rounded-lg hover:bg-bg-panel transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-text-primary truncate">{task.nodeId}</span>
                  <span className="text-sm text-text-secondary">集数 {task.episode}</span>
                  <span className="text-sm text-text-secondary">尝试 {task.attempt}</span>
                </div>
                <p className="text-xs text-text-tertiary">
                  {formatDateTime(task.queuedAt)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={getStatusColor(task.status)}>
                  {getStatusLabel(task.status)}
                </Badge>
                {task.gate !== 'none' && (
                  <Badge variant="warning">
                    门: {task.gate}
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
