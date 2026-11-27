/**
 * 404 Not Found page
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui';

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-center h-screen bg-bg-base">
      <div className="text-center">
        <h1 className="text-6xl font-bold mb-4 text-text-primary">404</h1>
        <p className="text-text-secondary mb-6">页面未找到</p>
        <Button variant="primary" onClick={() => navigate('/')}>
          返回首页
        </Button>
      </div>
    </div>
  );
}
