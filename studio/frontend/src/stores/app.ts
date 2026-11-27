/**
 * State management with Zustand
 */

import { create } from 'zustand';
import type { Project, Task, Artifact, Conversation, Graph } from '../types/api';

interface AppState {
  /* Current project */
  currentProjectId: string | null;
  currentProject: Project | null;
  setCurrentProject: (project: Project | null) => void;

  /* Project list */
  projects: Project[];
  setProjects: (projects: Project[]) => void;

  /* Tasks */
  tasks: Task[];
  setTasks: (tasks: Task[]) => void;
  updateTask: (task: Task) => void;

  /* Artifacts */
  artifacts: Artifact[];
  setArtifacts: (artifacts: Artifact[]) => void;

  /* Conversations */
  currentConversationId: string | null;
  conversations: Conversation[];
  setConversations: (conversations: Conversation[]) => void;

  /* Graph / Workflow */
  graph: Graph | null;
  setGraph: (graph: Graph) => void;

  /* UI state */
  isLoading: boolean;
  error: string | null;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentProjectId: null,
  currentProject: null,
  setCurrentProject: (project) =>
    set({
      currentProject: project,
      currentProjectId: project?.id ?? null,
    }),

  projects: [],
  setProjects: (projects) => set({ projects }),

  tasks: [],
  setTasks: (tasks) => set({ tasks }),
  updateTask: (task) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === task.id ? task : t)),
    })),

  artifacts: [],
  setArtifacts: (artifacts) => set({ artifacts }),

  currentConversationId: null,
  conversations: [],
  setConversations: (conversations) => set({ conversations }),

  graph: null,
  setGraph: (graph) => set({ graph }),

  isLoading: false,
  error: null,
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
}));
