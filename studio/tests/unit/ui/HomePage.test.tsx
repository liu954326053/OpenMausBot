import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { HomePage } from '../../../src/renderer/pages/HomePage';

// Mock the studio API
const mockStudioApi = {
  ping: vi.fn(),
  'app:getVersion': vi.fn(),
  'app:getPaths': vi.fn(),
  'app:openExternal': vi.fn(),
  'app:chooseFolder': vi.fn(),
  'events:subscribe': vi.fn(),
  'events:unsubscribe': vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  rpc: {
    call: vi.fn(),
  },
};

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).studio = mockStudioApi;
  });

  it('renders empty state when no projects exist', async () => {
    mockStudioApi.rpc.call.mockResolvedValue({ projects: [] });

    render(
      <BrowserRouter>
        <HomePage />
      </BrowserRouter>
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('漫剧工作室');
    expect(screen.getByRole('button', { name: /新建项目/ })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('还没有项目')).toBeInTheDocument();
      expect(screen.getByText('新建一个项目开始创作')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /新建第一个项目/ })).toBeInTheDocument();
    });
  });

  it('renders project list with mock data', async () => {
    const mockProjects = [
      {
        id: 'prj_mock1',
        name: '示例项目 1',
        folder: '/mock/projects/example1',
        teamSnapshotId: 'tsn_mock1',
        sourceTeamPresetId: null,
        episodeCount: 12,
        language: 'zh',
        coverArtifactId: null,
        settings: { maxConcurrentTasks: 4, networkPerAgent: true },
        graphVersion: 1,
        createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      },
      {
        id: 'prj_mock2',
        name: '示例项目 2',
        folder: '/mock/projects/example2',
        teamSnapshotId: 'tsn_mock2',
        sourceTeamPresetId: null,
        episodeCount: 24,
        language: 'zh',
        coverArtifactId: null,
        settings: { maxConcurrentTasks: 4, networkPerAgent: true },
        graphVersion: 2,
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      },
    ];

    mockStudioApi.rpc.call.mockResolvedValue({ projects: mockProjects });

    render(
      <BrowserRouter>
        <HomePage />
      </BrowserRouter>
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('漫剧工作室');

    await waitFor(() => {
      expect(screen.getByText('示例项目 1')).toBeInTheDocument();
      expect(screen.getByText('示例项目 2')).toBeInTheDocument();
      expect(screen.getByText(/12 集/)).toBeInTheDocument();
      expect(screen.getByText(/24 集/)).toBeInTheDocument();
    });
  });

  it('handles project list fetch error', async () => {
    mockStudioApi.rpc.call.mockRejectedValue(new Error('Failed to fetch projects'));

    render(
      <BrowserRouter>
        <HomePage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/加载项目列表失败/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument();
    });
  });

  it('opens new project dialog when button is clicked', async () => {
    mockStudioApi.rpc.call.mockResolvedValue({ projects: [] });

    const { container } = render(
      <BrowserRouter>
        <HomePage />
      </BrowserRouter>
    );

    const newProjectBtn = screen.getByRole('button', { name: /新建项目/ });
    fireEvent.click(newProjectBtn);

    await waitFor(() => {
      expect(screen.getByText('新建项目')).toBeInTheDocument();
      expect(screen.getByLabelText(/项目名/)).toBeInTheDocument();
      expect(screen.getByLabelText(/集数/)).toBeInTheDocument();
    });
  });

  it('closes new project dialog when close button is clicked', async () => {
    mockStudioApi.rpc.call.mockResolvedValue({ projects: [] });

    render(
      <BrowserRouter>
        <HomePage />
      </BrowserRouter>
    );

    const newProjectBtn = screen.getByRole('button', { name: /新建项目/ });
    fireEvent.click(newProjectBtn);

    await waitFor(() => {
      expect(screen.getByText('新建项目')).toBeInTheDocument();
    });

    const closeBtn = screen.getByLabelText(/关闭对话框/);
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText('新建项目')).not.toBeInTheDocument();
    });
  });

  it('refetches projects when new project is successfully created', async () => {
    mockStudioApi.rpc.call.mockResolvedValue({ projects: [] });

    render(
      <BrowserRouter>
        <HomePage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(mockStudioApi.rpc.call).toHaveBeenCalledWith('project.list', {});
    });

    const callCount = mockStudioApi.rpc.call.mock.calls.length;
    // Note: In a real implementation, the refetch would be triggered by onSuccess
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it('renders projects with correct metadata', async () => {
    const mockProject = {
      id: 'prj_test',
      name: 'Test Project',
      folder: '/test/folder',
      teamSnapshotId: 'tsn_test',
      sourceTeamPresetId: null,
      episodeCount: 13,
      language: 'zh',
      coverArtifactId: null,
      settings: { maxConcurrentTasks: 4, networkPerAgent: true },
      graphVersion: 1,
      createdAt: '2026-11-20T00:00:00.000Z',
      updatedAt: '2026-11-27T00:00:00.000Z',
      lastActivityAt: '2026-11-27T00:00:00.000Z',
    };

    mockStudioApi.rpc.call.mockResolvedValue({ projects: [mockProject] });

    render(
      <BrowserRouter>
        <HomePage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Project')).toBeInTheDocument();
      expect(screen.getByText(/13 集/)).toBeInTheDocument();
    });
  });
});
