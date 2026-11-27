import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { HomePage } from '../../pages/HomePage';

// Mock the API client
vi.mock('../../api/client', () => {
  const mockGet = vi.fn();
  const mockPost = vi.fn();
  const mockDelete = vi.fn();

  return {
    apiClient: {
      get: mockGet,
      post: mockPost,
      delete: mockDelete,
    },
  };
});

// Import after mocking
import { apiClient } from '../../api/client';

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no projects exist', async () => {
    (apiClient.get as any).mockResolvedValue({
      ok: true,
      data: { items: [] },
    });

    render(
      <BrowserRouter>
        <HomePage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('漫剧工作室');
    });

    await waitFor(() => {
      expect(screen.getByText('还没有项目')).toBeInTheDocument();
      expect(screen.getByText('新建一个项目开始创作')).toBeInTheDocument();
    });
  });

  it('renders project list with mock data', async () => {
    const mockProjects = [
      {
        id: 'prj_mock1',
        name: '示例项目 1',
        folder: '/mock/projects/example1',
        episodeCount: 12,
        createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'prj_mock2',
        name: '示例项目 2',
        folder: '/mock/projects/example2',
        episodeCount: 24,
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];

    (apiClient.get as any).mockResolvedValue({
      ok: true,
      data: { items: mockProjects },
    });

    render(
      <BrowserRouter>
        <HomePage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('示例项目 1')).toBeInTheDocument();
      expect(screen.getByText('示例项目 2')).toBeInTheDocument();
    });
  });

  it('handles project list fetch error', async () => {
    (apiClient.get as any).mockResolvedValue({
      ok: false,
      error: { message: '加载项目列表失败' },
    });

    render(
      <BrowserRouter>
        <HomePage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('加载项目列表失败')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument();
    });
  });
});
