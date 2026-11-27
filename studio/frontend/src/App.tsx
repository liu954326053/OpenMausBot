/**
 * Root App component with routing
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';
import { WorkflowPage } from './pages/WorkflowPage';
import { TasksPage } from './pages/TasksPage';
import { ConversationPage } from './pages/ConversationPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/project/:projectId" element={<ProjectPage />} />
        <Route path="/project/:projectId/workflow" element={<WorkflowPage />} />
        <Route path="/project/:projectId/tasks" element={<TasksPage />} />
        <Route path="/project/:projectId/conversation/:conversationId" element={<ConversationPage />} />
        <Route path="/404" element={<NotFoundPage />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
