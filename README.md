# HIM Code 功能蓝图 (Capability Map)

本文件详细记录了 HIM Code 的核心功能点。这些描述不仅是功能介绍，更被设计为可以直接喂给 AI 的 **"Prompt 指令"**，以便他人克隆或重现本项目的核心能力。

---

## 1. 原生 AI 侧边栏集成 (Native Chat Sidebar)

### 功能描述
将 AI 聊天面板深度集成到 VS Code 的原生辅助栏（Auxiliary Bar，默认在右侧）。这与传统的插件（Extension）不同，它通过修改 Workbench 源码实现，具有极高的性能和无缝的 UI 体验。

### 复制此功能的 Prompt
> "请在 VS Code 的全局工作区（Workbench）集成一个原生的 AI 聊天面板。要求：
> 1. 面板需注入到辅助栏（Auxiliary Bar）中。
> 2. 支持沉浸式 UI（Glassmorphism 或深色模式优化）。
> 3. 后端逻辑需通过 `ViewPane` 实现，并确保在不同工作区切换时状态持久化。
> 4. 实现自定义 CSS 令牌（Tokens），使用 HSL 调色系统以确保与 IDE 主题完美融合。"

---

## 2. 代理协同调度引擎 (Agentic Orchestration Engine)

### 功能描述
HIM Code 不仅仅是简单的对话机器人，它拥有一个协同调度引擎。通过 `org.json` 定义不同的代理（Agents）及其职责。主代理（Orchestrator）负责规划，并将任务分发给专门的 Worker（如 Executor、Refactorer）。

### 复制此功能的 Prompt
> "实现一个基于 JSON 配置的多代理（Multi-Agent）协同系统。核心组件包括：
> 1. **Orchestrator**: 负责解析用户需求，生成 `org.json` 组织结构图。
> 2. **Worker**: 具有特定‘使命’（Mandate）的独立执行单元。
> 3. **验证层**: 对 `org.json` 进行严格 Schema 校验，确保代理间的连接（Edges）类型正确（Delegate/Inform/Request）。
> 4. **归一化逻辑**: 对模型不稳定的 JSON 输出进行自动修复（如自动转换对象为数组，补全缺失字段）。"

---

## 3. 动态组织管理逻辑 (HIM Organization Logic)

### 功能描述
实时管理代理的状态、任务分配和工作范围。代理可以查看、创建、修改文件，并访问特定的工作空间（World Scope）。

### 复制此功能的 Prompt
> "开发一套代理组织状态管理系统。
> 1. 每个代理需定义 `capability`（能力集）和 `world`（作用域，如 filesystem 或 none）。
> 2. 支持 `assigned_tasks` 任务队列的动态更新。
> 3. 实现一个 UI 列表，能够过滤隐藏后台 Worker 代理，仅保留主调度者在全局导航中显示。
> 4. 确保工作流程透明，所有代理的变更操作必须经过用户的‘批准’环节点。"

---

## 4. 深度终端与文件交互 (Terminal & File Synergy)

### 功能描述
代理拥有执行 Shell 命令和直接操作文件的权限。

### 复制此功能的 Prompt
> "请为 AI 代理添加底层交互权限：
> 1. 实现一个执行 Shell 脚本的安全接口，并在 IDE 内置终端显示输出。
> 2. 支持代理读取当前工作区的文件树（File Tree），并根据需求提出文件修改方案（Diff）。
> 3. 集成 Git 自动提交与回滚机制，用于保护代码在代理执行失败时的安全。"

---

## 5.极致视觉与交互体验 (Premium Aesthetic UX)

### 功能描述
去除多余的 UI 干扰（如原生的 Quick Action 按钮），使用现代、优雅的排版。

### 复制此功能的 Prompt
> "优化 IDE 的 AI 交互界面：
> 1. 移除输入框旁多余的快速操作按钮（如 + 号），保持界面整洁。
> 2. 聊天窗口需支持 LaTeX 数学公式、Mermaid 流程图、富文本预览。
> 3. 使用 Google Fonts 等现代字体（如 Inter 或 Roboto）替换浏览器默认字体。
> 4. 按钮交互需增加微动画（Micro-animations）和悬停效果（Hover Effects）。"
