/**
 * Workflow canvas page
 */

import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAppStore } from '../stores/app';
import { apiClient } from '../api/client';
import { Spinner } from '../components/ui';

export function WorkflowPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { graph, setGraph, isLoading, setLoading, setError } = useAppStore();

  useEffect(() => {
    if (!projectId) return;
    loadGraph();
  }, [projectId]);

  const loadGraph = async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);

    const result = await apiClient.get(`/projects/${projectId}/graph`);
    setLoading(false);

    if (result.ok) {
      setGraph(result.data);
    } else {
      setError(result.error.message);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <h2 className="text-xl font-semibold mb-6 text-text-primary">工作流</h2>

      {graph ? (
        <div className="bg-bg-panel border border-border rounded-lg p-6 flex-1">
          <div className="text-text-secondary text-center">
            <p>工作流画布（版本：{graph.version.version}）</p>
            <p className="mt-2 text-sm">{graph.nodes.length} 个节点，{graph.edges.length} 个连接</p>
          </div>

          {/* Canvas placeholder - would use a canvas library like ReactFlow */}
          <div className="mt-6 h-96 bg-bg-base rounded border border-border border-dashed flex items-center justify-center">
            <p className="text-text-tertiary">流程图画布（待实现）</p>
          </div>

          {graph.dsl && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold mb-2 text-text-primary">DSL 源码</h3>
              <pre className="bg-bg-base p-4 rounded border border-border overflow-auto text-xs font-mono text-text-secondary">
                {graph.dsl}
              </pre>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center text-text-secondary">
          <p>无法加载工作流</p>
        </div>
      )}
    </div>
  );
}
