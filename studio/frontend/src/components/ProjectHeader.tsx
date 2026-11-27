/**
 * Project header component
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui';
import type { Project } from '../types/api';

interface ProjectHeaderProps {
  project: Project;
}

export function ProjectHeader({ project }: ProjectHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="border-b border-border bg-bg-panel sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={() => navigate('/')}
            className="text-sm"
          >
            ← 返回
          </Button>
          <div className="pl-3 border-l border-border">
            <h1 className="font-semibold text-text-primary">{project.name}</h1>
            <p className="text-xs text-text-secondary">{project.episodeCount} 集项目</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm">
            设置
          </Button>
        </div>
      </div>
    </header>
  );
}
