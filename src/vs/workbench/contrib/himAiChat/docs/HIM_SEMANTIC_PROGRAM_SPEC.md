# HIM 语义程序模式 — 实现说明书（硬规则）

本文档给 **Runtime（宿主）**、**Author / Compiler / Codegen 提示词维护者** 共用，用于避免实现与设计在边界上反复扯皮。下列三条为 **硬规则**：实现与评审以本文为准。

---

## 三条硬规则

### （1）指针（`current_pointer`）与指令状态（`status`）仅由 Runtime 落盘

- **磁盘上的权威数据**：写入 `.him-code/agents/<session>/agent_program.him` 时，**`current_pointer` 与各 `instructions[id].status` 以 Runtime 为准**。
- **Author**：在 phase 1 中可输出占位 `session_id`、初始图结构、`status: "PENDING"` 等；**不得**假定自己对指针或状态的写入会原样成为磁盘真值 —— 宿主可在规范化、合并 Compiler 结果、步进执行前后 **覆盖或修正** 这些字段。
- **Compiler**：只产出 **审计决策** 与可选的 **`updated_instructions` / `next_current_pointer` 建议**；**是否**、**如何** 合并进磁盘文档、何时推进指针、何时把某步标为 `RUNNING` / `SUCCEEDED` / `FAILED`，均由 **Runtime** 执行并写回。
- **Codegen**：执行工具调用；**不**负责在聊天里“宣布”指针已移动；指针与状态变更只在 **Runtime 写文件** 时生效。

**目的**：避免多角色同时自称“真源”，导致磁盘与内存不一致。

---

### （2）Compiler 与 Codegen 输出 schema 固定

实现侧 **只接受约定形状**；超出字段可忽略或整段判失败，**不得**靠模型自由发挥 JSON 来驱动状态机。

#### Compiler（仅 JSON，无工具）

- **系统角色**：`HIM_SEMANTIC_COMPILER_SYSTEM`（见 `himSemanticProgramPrompts.ts`）。
- **输出**：**唯一一个 JSON 对象**，顶层字段固定为：

| 字段 | 类型 | 说明 |
|------|------|------|
| `decision` | `"AUDIT_PASS" \| "REFACTOR_PLAN" \| "REJECT"` | 必填 |
| `reason` | `string` | 必填 |
| `updated_instructions` | `object \| null` | `REFACTOR_PLAN` 时携带完整替换用的 `instructions` 映射 |
| `next_current_pointer` | `string \| null` | 可选，由 Runtime 决定是否采用 |
| `notes_for_runtime` | `string \| null` | 可选 |

- **解析**：`parseCompilerResult`（`himSemanticProgramOrchestrator.ts`）**仅校验上述契约**；未在类型中的字段不得作为协议扩展依赖（若需扩展，先改类型与校验再发布）。

#### Author（phase 1）

- **输出**：**唯一**一对标签 `<him-semantic-program>...</him-semantic-program>`，内层为 **JSON**，字段以 `validateSemanticProgramDocument`（`himSemanticProgramFileSupport.ts`）与 `HimSemanticProgramDocument`（`himSemanticProgramTypes.ts`）为准。

#### Codegen（每步执行）

- **输出**：自然语言 + 可选 `<him-python>` / `<him-shell>` / `<him-search>`；**必须以单独一行** `HIM_SEMANTIC_STEP_DONE` 结束本步（与 `buildSemanticStepUserMessage` 一致）。
- **不得**把 Compiler 的 JSON 混进 Codegen 正文中作为“第二协议通道”；审计与执行分层保持清晰。

**目的**：解析路径唯一、可测试、可版本化。

---

### （3）原子规则以事后 diff 为最终判据

- 文案中的 “≤100 行改动”“单文件写入”等 **原子规则**，其 **最终判定** 不是模型自述，而是 **Runtime 在工具执行完成后**，基于 **工作区实际变更**（例如按文件的 line diff / 写入次数）做核验。
- **是否** 使用 **git** 做上述核验由 **Author** 写入 `program_metadata.atomic_verify`（`none` / `git_numstat`）；宿主 **不** 根据仓库是否像 Git 仓库自动打开 git。
- Compiler 可做 **静态** 可行性判断；**是否违规** 以 **事后 diff 结果** 为准（可标记失败步、触发重试或 `REFACTOR` 等策略 —— 具体策略由产品定义，但 **判据** 固定为 diff）。

**目的**：避免“口头遵守、实际超大改”无法收敛。

**实现分期**：规范上 **必须** 以 diff 为最终判据；宿主可在后续迭代中接入具体 diff 统计与失败处理（标记步失败、触发重试等），但 **不得** 长期仅以模型自述作为合规依据。

**当前实现（Codegen 步）**：宿主 **默认不调用 git**。是否在语义程序里启用基于 git 的核验，由 **Author** 写入 `program_metadata.atomic_verify`：  
- 省略或 `"none"`：不做自动 numstat 核验。  
- `"git_numstat"`：每步 Codegen 前后各执行一次 `git diff HEAD --numstat`（需为可用 git 仓库），对 **非排除路径**（见 `himSemanticAtomicRuntime.ts` 的 `isExcludedAtomicPath`）计算增量：变更文件数 ≤ 1，且 `|Δadded|+|Δdeleted|` 之和 ≤ 100。  
不满足或已请求 `git_numstat` 但无法读取 numstat 时，将该步标为 `FAILED`，追加 `[Runtime] …`，并终止编排。  

事后 **diff 作为原子规则判据** 的规范仍成立；未启用 `git_numstat` 时由后续策略（或其它数据源）补充，不由宿主隐式探测 git。

---

## 与代码索引

| 概念 | 主要位置 |
|------|----------|
| 程序文档类型 | `himSemanticProgramTypes.ts` |
| 磁盘读写 / 校验 | `himSemanticProgramFileSupport.ts` |
| Compiler JSON 解析 | `himSemanticProgramOrchestrator.ts` — `parseCompilerResult` |
| Author / Compiler 系统提示 | `himSemanticProgramPrompts.ts` |
| 主流程 | `himAiChatPane.ts` — `runSemanticProgramPipeline`（需已打开**文件夹工作区**，否则无法写入 `agent_program.him`） |
| 可选 git numstat 原子核验 | `himSemanticAtomicRuntime.ts`；`program_metadata.atomic_verify === "git_numstat"` 时 `himAiChatPane.ts` 调用 `tryGitNumstatVsHead` |

---

## 版本

- 文档版本与 `HimSemanticProgramDocument.version`（当前为 `1`）独立；协议变更时请同步更新 **本文档**、**类型**、**校验函数** 与 **三处提示词**。
