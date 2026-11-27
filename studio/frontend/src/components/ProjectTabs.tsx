/**
 * Project tabs navigation
 */

import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';

interface ProjectTabsProps {
  projectId: string;
}

const tabs = [
  { id: 'workflow', label: '工作流' },
  { id: 'tasks', label: '任务' },
  { id: 'artifacts', label: '产物' },
  { id: 'chat', label: '对话' },
];

export function ProjectTabs({ projectId }: ProjectTabsProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const getActiveTab = () => {
    if (location.pathname.includes('/workflow')) return 'workflow';
    if (location.pathname.includes('/tasks')) return 'tasks';
    if (location.pathname.includes('/artifacts')) return 'artifacts';
    if (location.pathname.includes('/conversation')) return 'chat';
    return 'workflow';
  };

  const activeTab = getActiveTab();

  const handleTabChange = (tabId: string) => {
    const paths: Record<string, string> = {
      workflow: `/project/${projectId}/workflow`,
      tasks: `/project/${projectId}/tasks`,
      artifacts: `/project/${projectId}/artifacts`,
      chat: `/project/${projectId}/conversation/main`,
    };
    navigate(paths[tabId]);
  };

  return (
    <div className="flex border-b border-border bg-bg-panel">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => handleTabChange(tab.id)}
          className={clsx(
            'px-6 py-3 font-medium transition-colors border-b-2',
            activeTab === tab.id
              ? 'border-b-accent text-accent'
              : 'border-b-transparent text-text-secondary hover:text-text-primary'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
