/**
 * Home page - Project list
 */

import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Spinner, Dialog, Input, Card } from '../components/ui';
import { useAppStore } from '../stores/app';
import { apiClient } from '../api/client';
import { formatDate } from '../lib/utils';
import type { CreateProjectRequest } from '../types/api';

export function HomePage() {
  const navigate = useNavigate();
  const { projects, setProjects, isLoading, setLoading, error, setError } = useAppStore();
  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = React.useState(false);
  const [formData, setFormData] = React.useState<CreateProjectRequest>({
    name: '',
    folder: '',
    episodeCount: 60,
    language: 'zh',
    teamPresetId: 'tpl_default',
  });

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    setError(null);
    const result = await apiClient.get('/projects', { query: { limit: 50 } });
    setLoading(false);
    if (result.ok) {
      setProjects(result.data.items);
    } else {
      setError(result.error.message);
    }
  };

  const handleCreateProject = async () => {
    setLoading(true);
    setError(null);
    const result = await apiClient.post('/projects', formData);
    setLoading(false);

    if (result.ok) {
      setProjects([result.data, ...projects]);
      setIsNewProjectDialogOpen(false);
      setFormData({
        name: '',
        folder: '',
        episodeCount: 60,
        language: 'zh',
        teamPresetId: 'tpl_default',
      });
      // Navigate to new project
      navigate(`/project/${result.data.id}`);
    } else {
      setError(result.error.message);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm('确定要删除这个项目吗？')) return;

    setLoading(true);
    setError(null);
    const result = await apiClient.delete(`/projects/${projectId}`);
    setLoading(false);

    if (result.ok) {
      setProjects(projects.filter((p) => p.id !== projectId));
    } else {
      setError(result.error.message);
    }
  };

  return (
    <div className="min-h-screen bg-bg-base">
      {/* Header */}
      <header className="border-b border-border bg-bg-panel sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎬</span>
            <h1 className="text-2xl font-bold text-text-primary">漫剧工作室</h1>
          </div>
          <Button
            variant="primary"
            onClick={() => setIsNewProjectDialogOpen(true)}
            disabled={isLoading}
          >
            + 新建项目
          </Button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-6 py-12">
        {error && (
          <div className="mb-6 p-4 bg-status-error/10 border border-status-error/20 rounded-lg">
            <p className="text-status-error text-sm">{error}</p>
            <Button variant="ghost" size="sm" onClick={loadProjects} className="mt-2">
              重试
            </Button>
          </div>
        )}

        {isLoading && projects.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <Spinner size="lg" />
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64">
            <div className="text-5xl mb-4">🎞️</div>
            <h2 className="text-xl font-semibold text-text-primary mb-2">还没有项目</h2>
            <p className="text-text-secondary mb-6">新建一个项目开始创作</p>
            <Button
              variant="primary"
              size="lg"
              onClick={() => setIsNewProjectDialogOpen(true)}
            >
              新建第一个项目
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <Card
                key={project.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/project/${project.id}`)}
              >
                <div className="mb-4 aspect-video bg-bg-panel rounded-lg flex items-center justify-center">
                  <span className="text-4xl">🎬</span>
                </div>
                <h3 className="font-semibold text-text-primary mb-1 line-clamp-2">
                  {project.name}
                </h3>
                <p className="text-sm text-text-secondary mb-4">
                  {project.episodeCount} 集 · {formatDate(project.createdAt)}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/project/${project.id}`);
                    }}
                  >
                    打开
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteProject(project.id);
                    }}
                  >
                    删除
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* New Project Dialog */}
      <Dialog
        isOpen={isNewProjectDialogOpen}
        onClose={() => setIsNewProjectDialogOpen(false)}
        title="新建项目"
        size="md"
        actions={
          <>
            <Button variant="ghost" onClick={() => setIsNewProjectDialogOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateProject}
              isLoading={isLoading}
            >
              创建
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="项目名称"
            placeholder="例如：《雾港灯语》"
            value={formData.name}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, name: e.target.value }))
            }
          />
          <Input
            label="项目文件夹"
            placeholder="/Users/user/projects/my-project"
            value={formData.folder}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, folder: e.target.value }))
            }
          />
          <Input
            label="集数"
            type="number"
            min="1"
            max="500"
            value={formData.episodeCount}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                episodeCount: parseInt(e.target.value, 10),
              }))
            }
          />
        </div>
      </Dialog>
    </div>
  );
}
