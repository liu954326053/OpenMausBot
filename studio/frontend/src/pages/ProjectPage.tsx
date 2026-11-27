/**
 * Project detail page - main hub for project
 */

import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Spinner } from '../components/ui';
import { useAppStore } from '../stores/app';
import { apiClient } from '../api/client';
import { ProjectHeader } from '../components/ProjectHeader';
import { ProjectTabs } from '../components/ProjectTabs';

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { currentProject, setCurrentProject, isLoading, setLoading, setError } =
    useAppStore();

  useEffect(() => {
    if (!projectId) return;
    loadProject();
  }, [projectId]);

  const loadProject = async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);

    const result = await apiClient.get(`/projects/${projectId}`);
    setLoading(false);

    if (result.ok) {
      setCurrentProject(result.data);
    } else {
      setError(result.error.message);
      navigate('/');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-text-secondary">项目未找到</p>
        <Button variant="primary" onClick={() => navigate('/')}>
          返回首页
        </Button>
      </div>
    );
  }

  return (
    <div className="h-screen bg-bg-base flex flex-col">
      <ProjectHeader project={currentProject} />
      <ProjectTabs projectId={projectId!} />
    </div>
  );
}
