/**
 * Artifacts (products) management page
 */

import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Badge, Spinner } from '../components/ui';
import { useAppStore } from '../stores/app';
import { apiClient } from '../api/client';
import { formatDateTime } from '../lib/utils';
import type { Artifact } from '../types/api';

export function ArtifactsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { artifacts, setArtifacts, isLoading, setLoading, setError } = useAppStore();
  const [selectedArtifact, setSelectedArtifact] = React.useState<Artifact | null>(null);

  useEffect(() => {
    if (!projectId) return;
    loadArtifacts();
  }, [projectId]);

  const loadArtifacts = async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);

    const result = await apiClient.get(`/projects/${projectId}/artifacts`, {
      query: { limit: 100 },
    });
    setLoading(false);

    if (result.ok) {
      setArtifacts(result.data.items);
    } else {
      setError(result.error.message);
    }
  };

  const getArtifactTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      script: '剧本',
      storyboard: '分镜',
      design: '设计',
      video: '视频',
      audio: '音频',
    };
    return labels[type] || type;
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, any> = {
      draft: 'default',
      ready: 'success',
      published: 'success',
    };
    return colors[status] || 'default';
  };

  if (isLoading && artifacts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex gap-6 p-6 overflow-hidden h-full">
      {/* Artifacts list */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <h2 className="text-xl font-semibold mb-4 text-text-primary">产物</h2>
        <div className="flex-1 overflow-auto space-y-2">
          {artifacts.length === 0 ? (
            <div className="text-center text-text-secondary py-12">
              <p>暂无产物</p>
            </div>
          ) : (
            artifacts.map((artifact) => (
              <button
                key={artifact.id}
                onClick={() => setSelectedArtifact(artifact)}
                className={clsx(
                  'w-full p-4 text-left border rounded-lg transition-colors',
                  selectedArtifact?.id === artifact.id
                    ? 'bg-accent/10 border-accent'
                    : 'bg-bg-card border-border hover:bg-bg-panel'
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-text-primary">{artifact.title}</span>
                  <Badge variant={getStatusColor(artifact.status)}>
                    {artifact.status}
                  </Badge>
                </div>
                <div className="flex gap-2 text-xs text-text-secondary">
                  <span>{getArtifactTypeLabel(artifact.type)}</span>
                  <span>·</span>
                  <span>第 {artifact.episode + 1} 集</span>
                  <span>·</span>
                  <span>v{artifact.currentVersion}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Artifact details */}
      {selectedArtifact && (
        <div className="w-80 flex flex-col bg-bg-panel border border-border rounded-lg p-4 gap-4">
          <div>
            <h3 className="font-semibold text-text-primary mb-2">{selectedArtifact.title}</h3>
            <div className="space-y-1 text-sm text-text-secondary">
              <p>类型：{getArtifactTypeLabel(selectedArtifact.type)}</p>
              <p>集数：第 {selectedArtifact.episode + 1} 集</p>
              <p>状态：{selectedArtifact.status}</p>
              <p>当前版本：{selectedArtifact.currentVersion}</p>
              <p>创建时间：{formatDateTime(selectedArtifact.createdAt)}</p>
            </div>
          </div>
          <Button variant="primary" size="sm" fullWidth>
            查看版本
          </Button>
        </div>
      )}
    </div>
  );
}

import clsx from 'clsx';
