# koishi-plugin-chatluna-data

ChatLuna 1.4 数据库优先的 Koishi 生产管理台。

当前版本：`0.7.3`

这个插件提供一个独立的 Koishi Console 页面，用来集中查看和维护
ChatLuna 1.4 的配置、用户、会话、聊天记录、权限、约束规则、归档、provider、资源，
并把 ChatLuna 的 `bindingKey` 与 Koishi 的平台、机器人、用户、频道关系聚合到同一套后台里。

## 定位

ChatLuna 的会话数据主要保存在数据库表中，adapter/provider、模型、工具、链、向量库等信息主要保存在运行时服务中。
本插件采用数据库优先策略：

- 直接读取和维护 ChatLuna 1.4 数据库表。
- 存在 `ctx.chatluna` 时读取运行时 provider、模型、工具、链、向量库、preset、默认配置。
- 通过 Koishi loader 管理的 `chatluna` fork 读取和保存 ChatLuna 主插件配置。
- 写入会话、模型、状态、聊天记录后尝试清理对应运行时会话缓存。
- 不修改 Koishi `user.authority`，只做聚合展示和关联诊断。

## 功能

### 概览

- 会话、消息、用户、上下文、ACL、规则、归档数量统计。
- 模型使用分布。
- ChatLuna 运行时连接状态。
- provider、实时模型、工具、链、向量库数量。
- preset 数量与 ChatLuna 默认模型、默认 preset、默认聊天链、默认嵌入、默认向量库。
- 最近会话。
- 消息链异常概览。
- 系统健康评分入口。

### 提供商 / Adapter

- 聚合 ChatLuna 运行时 provider。
- 展示 adapter 状态：已加载、已注册、仅数据库引用。
- 展示 LLM、embeddings、reranker 模型数量。
- 展示模型能力：文本、工具调用、图像输入、思考、图像生成、音频、视频、文件。
- 展示配置数量和可用配置数量，不泄露 API Key。
- 展示文件处理能力和 MIME 支持。
- 关联统计使用该 provider 的会话。
- 手动刷新 provider 模型。

提供商列表不会自动请求外部模型接口。只有点击“刷新模型”时才调用 ChatLuna platform 刷新逻辑。

### ChatLuna 配置

- 新增独立的“配置”基础页，不放在高级页里。
- 读取 ChatLuna 1.4 core 主插件配置，覆盖常用配置组：
  - Bot 名称与昵称触发。
  - 私聊、@、引用、随机回复、合并转发上下文等触发行为。
  - 等待消息、冷却、消息队列、思考过程显示。
  - 输出模式、拆分消息、审核、流式响应。
  - 无限上下文、自动归档、归档自动清理。
  - 默认模型、默认 preset、默认 chatMode、默认嵌入、默认向量库、群聊路由模式。
  - 合并消息、回复引用、代理、日志、vits 发音人等杂项。
- 模型、preset、chatMode、embeddings、vector store 会尽量使用 ChatLuna 运行时列表作为可选项。
- 保存配置时调用 Koishi loader 中的 `chatluna` fork `update()`，由 Koishi 负责写回配置文件和重载插件。
- 当 Koishi 配置文件只读、未启用 loader、未找到 ChatLuna fork 或本插件 `readonly=true` 时，后端拒绝保存。
- 不在此页编辑 adapter/provider 的 API Key；provider 配置仍应由对应 ChatLuna adapter 插件管理。

### 资源

- 聚合 ChatLuna 运行时工具。
- 聚合聊天链 `chatMode`。
- 聚合向量库 provider。
- 聚合已加载 preset。
- 展示 ChatLuna 默认配置：
  - `defaultModel`
  - `defaultPreset`
  - `defaultChatMode`
  - `defaultEmbeddings`
  - `defaultVectorStore`
  - `defaultGroupRouteMode`
- 统计资源被会话和规则引用的数量。
- 展示工具来源、分组、标签、MCP 信息、默认可用性。
- 展示 preset 文件路径、触发关键词、消息数量、preset 目录。

### Koishi 上下文

- 解析 ChatLuna `bindingKey`：
  - `shared:<platform>:<selfId>:<guildId>`
  - `personal:<platform>:<selfId>:direct:<userId>`
  - `personal:<platform>:<selfId>:<guildId>:<userId>`
  - `custom:<routeKey>`
  - `:preset:<lane>`
- 聚合 Koishi 平台、bot selfId、群、用户、preset lane。
- 关联 Koishi `user`、`binding`、`channel` 表。
- 展示 Koishi 用户名、authority、permissions、频道 assignee、频道 permissions。
- 关联 ChatLuna 规则、ACL、活跃会话、最近会话、模型分布。

### 用户

- 从 `chatluna_conversation.createdBy`、`bindingKey`、`chatluna_acl`、`chatluna_constraint.users/excludeUsers` 聚合用户。
- 展示用户会话数量、活跃/归档数量、ACL 数、规则引用数。
- 用户详情抽屉聚合关联会话、上下文、Koishi binding、Koishi user、Koishi channel、ACL、规则。
- 支持直接从用户详情打开关联会话。
- 支持从用户一键过滤关联会话与聊天记录。
- 只读展示 Koishi 用户 authority 与 permissions，不直接修改 Koishi 用户权限。

### 会话

- 搜索、状态筛选、模型筛选。
- 新建会话，可自动生成 id。
- 查看和编辑标题、模型、preset、chatMode、status、latestMessageId。
- 删除会话，可同步删除消息与 ACL，并清理 binding 中指向该会话的 active/last 引用。
- 展示 createdBy、bindingKey、archiveId。
- 保存后清理运行时会话缓存。

### 绑定

- 查看会话关联的 `chatluna_binding`。
- 维护 `bindingKey`、`activeConversationId`、`lastConversationId`。
- 支持删除无效 binding。
- 会话创建时可同步设为 binding 的 active/last 会话。
- 会话删除时自动清理 binding 中失效的 active/last 指针。

### 消息

- 全局聊天记录表，支持按文本、消息 id、会话 id、role、createdBy 搜索。
- 消息列表关联显示会话标题、模型、createdBy、bindingKey。
- 可从任意消息跳转到对应会话链。
- 按 `latestMessageId -> parentId` 展示消息链。
- 对齐展示 `conversationId / id / parentId / rawId`。
- 解码 gzip/binary 内容并尽量展示文本。
- 支持新增、编辑、删除 `chatluna_message`。
- 可维护 `role`、`text`、`parentId`、`rawId`、`name`、`tool_call_id`。
- 新增或编辑消息时可选择是否同步设为会话 `latestMessageId`。
- 保存或删除消息后清理对应会话运行时缓存，并写入审计日志。
- 标记缺失 latestMessageId、断链、循环、孤儿消息。
- 可选执行消息链修复。

### 权限

- 管理 `chatluna_acl`：
  - `principalType`: `user` / `guild`
  - `permission`: `view` / `manage`
- 支持新增、编辑、删除。

### 规则

- 管理 `chatluna_constraint`。
- 支持路由、优先级、用户包含/排除、默认模型、固定模型、默认 preset、固定 preset。
- 支持锁定会话、允许新建、允许切换、允许归档、允许导出。
- `users` 和 `excludeUsers` 支持 JSON 数组或逗号分隔输入，保存为 ChatLuna 1.4 使用的 JSON 字符串。

### 归档

- 查看 `chatluna_archive`。
- 可选检查归档文件是否存在和文件大小。
- 可选清理缺失文件对应的 archive 表记录。

### 健康检查

- 检查消息链异常。
- 检查会话模型是否存在于运行时模型列表。
- 检查会话 `chatMode` 是否存在于运行时聊天链。
- 检查会话 preset 是否已加载。
- 检查 `chatluna_binding` 是否指向缺失会话。
- 检查 `chatluna_acl` 是否指向缺失会话。
- 检查规则引用的模型、preset、chatMode 是否有效。
- 开启 `enableArchiveFileOps` 后检查归档文件缺失。
- 提供健康评分、严重/警告/提示统计和处理建议。

### 批量操作

所有批量或危险操作必须先 preview，再 apply。

- 批量模型迁移。
- 批量状态变更。
- 归档缺失文件记录清理。
- 消息链修复预览和执行。

### 审计

- 记录运行期内存审计日志。
- 写入 `chatluna_data_audit` 持久化审计表。
- 展示操作时间、动作、目标、影响数量。

## 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `pageSize` | `40` | 默认分页大小 |
| `readonly` | `false` | 只读模式，前端禁用写按钮，后端拒绝写 RPC |
| `maxPreviewRows` | `200` | 危险操作预览最多返回对象数量 |
| `enableArchiveFileOps` | `false` | 允许检查归档文件状态和清理缺失文件记录 |
| `enableMessageRepair` | `false` | 允许执行消息链 `parentId/latestMessageId` 修复 |

生产环境建议先开启 `readonly` 检查数据，再按需关闭执行维护操作。

## 数据表

插件声明并使用以下 ChatLuna 1.4 表：

- `chatluna_conversation`
- `chatluna_message`
- `chatluna_binding`
- `chatluna_acl`
- `chatluna_constraint`
- `chatluna_archive`
- `chatluna_meta`
- `chatluna_data_audit`

同时只读聚合以下 Koishi 表：

- `user`
- `binding`
- `channel`

## RPC

Console RPC：

- `chatluna-data/getOverview`
- `chatluna-data/getConfig`
- `chatluna-data/saveConfig`
- `chatluna-data/listProviders`
- `chatluna-data/getProviderDetail`
- `chatluna-data/refreshProvider`
- `chatluna-data/listContexts`
- `chatluna-data/listResources`
- `chatluna-data/getHealth`
- `chatluna-data/listUsers`
- `chatluna-data/getUserDetail`
- `chatluna-data/listConversations`
- `chatluna-data/getConversationDetail`
- `chatluna-data/listMessages`
- `chatluna-data/saveConversationPatch`
- `chatluna-data/createConversation`
- `chatluna-data/removeConversation`
- `chatluna-data/saveBinding`
- `chatluna-data/saveMessage`
- `chatluna-data/removeMessage`
- `chatluna-data/listAcl`
- `chatluna-data/saveAcl`
- `chatluna-data/listConstraints`
- `chatluna-data/saveConstraint`
- `chatluna-data/listArchives`
- `chatluna-data/previewOperation`
- `chatluna-data/applyOperation`
- `chatluna-data/summary`

所有写 RPC 在 `readonly=true` 时都会被后端拒绝。

## 安全策略

- 不展示 provider 配置里的 API Key。
- ChatLuna 配置保存依赖 Koishi loader；配置文件只读时只展示不写入。
- 资源页只读取工具、链、向量库、preset 和默认配置摘要，不执行工具调用。
- provider 模型刷新必须手动触发。
- 批量操作必须先预览。
- 归档文件操作默认关闭。
- 消息链修复默认关闭。
- 聊天记录新增、编辑、删除受 `readonly` 控制，生产环境建议先只读审查。
- 会话删除会清理 binding 指针；是否删除消息和 ACL 由调用参数控制。
- 不直接编辑 Koishi 用户 authority。
- 审计日志持久化保存，但只记录动作、目标、对象 ID 和摘要，不记录 provider API Key。

## 安装

```sh
npm install koishi-plugin-chatluna-data
```

在 Koishi Console 中启用插件后，打开左侧页面：

```text
ChatLuna 数据
```

## 构建

```sh
yarn install
yarn build
npm pack --dry-run
```

构建产物：

- `lib/index.mjs`
- `lib/index.cjs`
- `lib/index.d.ts`
- `dist/`

## 服务

必需服务：

- `database`
- `console`

可选服务：

- `chatluna`

没有 `chatluna` 服务时，插件仍可浏览和维护数据库；provider、实时模型、工具、链、向量库、preset、默认配置等运行时信息会为空或仅显示数据库引用。配置页也会退回默认结构，但无法保存到 ChatLuna fork。

## 发布

```sh
yarn build
npm pack --dry-run
npm publish --access public
```

如果 `npm publish` 返回 `404 Not Found - PUT https://registry.npmjs.org/<name>`，通常需要检查：

- 当前 npm registry 是否为 `https://registry.npmjs.org/`。
- 是否已登录 npm。
- 包名是否被策略限制或需要换名。
- npm token 是否有发布公开包权限。
