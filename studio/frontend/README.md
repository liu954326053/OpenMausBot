# 漫剧工作室 - UI 框架

## 概述

从零设计的现代化 React UI 框架，为漫剧创作工作流搭建完整的用户交互界面。

**设计原则：**
- 完全新建实现，不直接复用旧代码
- 参考已有设计规范但独立构建
- 组件化、可扩展、易维护
- 深色/浅色主题支持
- 本地化文本支持（中文）

## 目录结构

```
studio/frontend/
├── src/
│   ├── pages/                 # 页面组件
│   │   ├── HomePage.tsx       # 首页 - 项目列表
│   │   ├── ProjectPage.tsx    # 项目详情页
│   │   ├── WorkflowPage.tsx   # 工作流编辑
│   │   ├── TasksPage.tsx      # 任务管理
│   │   ├── ArtifactsPage.tsx  # 产物管理
│   │   ├── ConversationPage.tsx
│   │   └── NotFoundPage.tsx
│   ├── components/            # UI 组件库
│   │   ├── ui.tsx             # 基础组件（按钮、表单、对话框等）
│   │   ├── ProjectTabs.tsx    # 项目标签切换
│   │   └── ProjectHeader.tsx  # 项目头部
│   ├── stores/                # 状态管理（Zustand）
│   │   └── app.ts             # 应用状态存储
│   ├── api/                   # API 客户端
│   │   └── client.ts          # HTTP 客户端
│   ├── types/                 # TypeScript 类型定义
│   │   └── api.ts             # API 契约类型
│   ├── lib/                   # 工具函数
│   │   └── utils.ts           # 时间、状态等工具
│   ├── App.tsx                # 路由配置
│   ├── main.tsx               # 入口文件
│   └── index.css              # 全局样式 + 设计令牌
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
└── package.json
```

## 核心特性

### 1. 设计系统

**颜色令牌** (`index.css`)
- 浅色主题（Daylight）和深色主题（Midnight）
- 自动响应系统偏好 `prefers-color-scheme`
- 文本、背景、边框、状态颜色一应俱全

**排版**
- 系统字体栈（-apple-system, Segoe UI 等）
- 统一的尺寸、行高、权重规范
- 表格数字支持（tabular-nums）

**间距与尺寸**
- 4px 网格系统
- 统一的圆角、阴影、过渡时间

### 2. 组件库

#### 基础组件 (`components/ui.tsx`)

```typescript
<Button variant="primary|secondary|danger|ghost" size="sm|md|lg">
  操作
</Button>

<Input label="标签" error="错误信息" />

<Dialog isOpen={true} title="标题" onClose={() => {}}>
  内容
</Dialog>

<Spinner size="sm|md|lg" />
<Badge variant="default|success|warning|error">标签</Badge>
<Card>内容</Card>
```

#### 组合组件

- `ProjectHeader` - 项目头部导航
- `ProjectTabs` - 页面标签切换

### 3. 状态管理

使用 **Zustand** 进行轻量级状态管理（`stores/app.ts`）

```typescript
const { 
  projects, 
  setProjects, 
  currentProject, 
  setCurrentProject,
  tasks,
  artifacts,
  isLoading,
  error 
} = useAppStore();
```

### 4. API 通信

**ApiClient** (`api/client.ts`)
- 类型安全的 HTTP 方法
- 自动处理 JSON 序列化
- 支持查询参数和请求头

```typescript
// GET
const result = await apiClient.get('/projects', { 
  query: { limit: 50 } 
});

// POST
const result = await apiClient.post('/projects', { name: '...' });

// PATCH / DELETE
await apiClient.patch('/projects/id', { ... });
await apiClient.delete('/projects/id');
```

### 5. 页面与路由

**主要页面：**
- `HomePage` - 项目列表，新建项目
- `ProjectPage` - 项目中心枢纽
- `WorkflowPage` - 流程图编辑（DSL 预览）
- `TasksPage` - 任务监控
- `ArtifactsPage` - 产物版本管理
- `ConversationPage` - AI 对话聊天

**路由配置** (`App.tsx`)
```
/ → 首页
/project/:projectId → 项目
/project/:projectId/workflow → 工作流
/project/:projectId/tasks → 任务
/project/:projectId/artifacts → 产物
/project/:projectId/conversation/:conversationId → 对话
```

### 6. 类型系统

**API 类型契约** (`types/api.ts`)
- `Project`, `Task`, `Artifact`, `Graph`, `Conversation`, `Message`
- 请求/响应类型定义
- 状态枚举

## 开发工作流

### 安装依赖

```bash
cd studio/frontend
pnpm install
```

### 本地开发

```bash
pnpm dev
```

Vite 开发服务器启动在 `http://localhost:5173`，自动代理 `/api` 到后端 (`http://localhost:3000`)

### 构建

```bash
pnpm build
```

输出到 `dist/` 目录

### 类型检查

```bash
pnpm type-check
```

### 代码检查

```bash
pnpm lint
```

## 设计决策

### 1. 为什么不复用旧代码？

- **清晰的起点**：从新需求出发，避免历史技术债
- **现代栈**：React 18 + TypeScript + Vite
- **一致的架构**：统一的组件组织、命名、风格
- **易于维护**：新团队成员快速上手

### 2. 为什么选择 Zustand？

- 轻量级（<2KB），学习曲线平缓
- 支持中间件和持久化
- TypeScript 友好
- 无需 Context 提供者嵌套

### 3. 为什么选择 Tailwind CSS？

- 实用优先，快速原型
- 与设计令牌无缝集成
- 更小的最终包大小
- 强大的响应式和状态变体

## 可扩展性

### 添加新页面

1. 在 `src/pages/` 创建新页面组件
2. 在 `App.tsx` 添加路由
3. 更新导航菜单

### 添加新 API 端点

1. 在 `types/api.ts` 定义类型
2. 在 `api/client.ts` 添加方法（如需）
3. 在组件中使用 `apiClient.get/post/...`

### 创建新组件

1. 在 `components/` 创建文件
2. 导出 React 组件
3. 在需要的地方导入使用

### 添加全局状态

在 `stores/app.ts` 的 `AppState` 中扩展

## 无障碍性

- 所有交互元素都能通过键盘访问
- 焦点指示器清晰可见
- 按钮和标签正确关联
- 色彩对比度达到 WCAG AA 标准（深色/浅色主题）

## 性能优化

- 代码分割（路由级别）
- 图片懒加载
- 防抖/节流防止频繁 API 调用
- 状态更新最小化

## 国际化准备

所有文本已使用中文。未来扩展时：
- 创建 `src/locales/` 目录
- 使用 `i18next` 或类似库
- 支持多语言切换

## 下一步

- [ ] 实现流程图画布（使用 ReactFlow）
- [ ] 添加文件上传功能
- [ ] 实现实时协作（WebSocket）
- [ ] 添加用户认证
- [ ] 完善错误处理与重试逻辑
- [ ] 添加单元测试和集成测试
- [ ] 性能监测与分析

## 贡献指南

编写新代码时遵循：
- **TypeScript strict 模式**
- **函数式组件 + Hooks**
- **设计令牌优先**（不用 Tailwind 颜色类）
- **清晰的命名和文档注释**
- **避免单一职责原则违反**
