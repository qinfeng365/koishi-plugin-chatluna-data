# koishi-plugin-chatluna-data

ChatLuna 1.4 数据管理台。它在 Koishi Console 中提供一个独立页面，用来查看和维护 ChatLuna 的会话、消息、配置、模型引用、归档和授权数据。

当前版本：`0.7.4`

## 适合谁

这个插件适合已经在使用 ChatLuna 1.4，并且需要处理下面问题的 Koishi 管理员：

- 查看某个用户在私聊、群聊、不同 `bindingKey` 下有哪些会话。
- 修改旧会话使用的模型、preset 或 chatMode。
- 检查消息链是否断裂，必要时手动编辑聊天记录。
- 在可视化界面里管理 Koishi 用户权限、频道权限和 ChatLuna 会话授权。
- 查看 provider / adapter、模型、工具、preset、向量库等运行时信息。
- 在执行批量模型迁移、状态变更、归档清理前先预览影响范围。

## 安装

```sh
npm install koishi-plugin-chatluna-data
```

在 Koishi Console 中启用插件后，打开左侧的 **ChatLuna 数据** 页面。

必需服务：

- `database`
- `console`

可选服务：

- `chatluna`

没有 `chatluna` 服务时，插件仍然可以浏览和维护数据库；实时模型、provider、preset、工具和配置写回能力会不可用。

## 快速上手

### 1. 先只读检查

生产环境建议先在插件配置里开启：

```text
readonly = true
```

只读模式下，前端会禁用写按钮，后端也会拒绝所有写入 RPC。确认数据展示正常后，再关闭只读执行维护操作。

### 2. 找用户和会话

进入 **用户** 页，搜索 Koishi 平台用户 ID。用户详情会显示：

- ChatLuna 会话数量和模型分布
- 相关 `bindingKey`
- Koishi 账号绑定
- Koishi 用户与频道信息
- ChatLuna ACL 和规则引用

如果 ChatLuna 原生命令 `list` 只能看到一个会话，而这里能看到多个，通常是因为这些会话属于不同路由。例如：

```text
personal:<platform>:<selfId>:direct:<userId>
personal:<platform>:<selfId>:<guildId>:<userId>
```

前者是私聊个人会话，后者是群内个人会话。ChatLuna `list` 默认按当前上下文的 `bindingKey` 列表，不是按 `createdBy` 全量列出。

### 3. 分配会话给用户

打开会话详情，点击 **分配会话**：

- 填写用户 ID 或群 ID，写入 ChatLuna ACL。
- 选择 `bindingKey`，可把指定上下文的 `activeConversationId` / `lastConversationId` 指向这个会话。

ACL 解决“用户是否能跨路由按 ID 使用会话”的问题；binding 解决“某个上下文默认继续使用哪个会话”的问题。

### 4. 管理 Koishi 权限

进入 **权限** 页：

- **Koishi 用户权限**：编辑 `user.authority` 和 `user.permissions`。
- **平台账号绑定**：查看 Koishi 用户与平台账号的映射。
- **频道权限**：编辑 `channel.assignee` 和 `channel.permissions`。
- **ChatLuna 会话授权**：管理 `chatluna_acl`，只影响 ChatLuna 会话访问。

Koishi 权限和 ChatLuna ACL 是两套概念。Koishi 权限决定用户在 Koishi 中能做什么；ChatLuna ACL 决定用户或群能否查看、管理某个 ChatLuna 会话。

### 5. 修改会话和聊天记录

进入 **会话** 页可以编辑：

- 标题
- 模型
- preset
- chatMode
- 状态
- latestMessageId

进入 **消息** 页可以查看和编辑聊天记录。会话详情会按 `latestMessageId -> parentId` 展示消息链，并标记断链、循环和孤儿消息。

### 6. 修改 ChatLuna 配置

进入 **配置** 页可以查看和修改 ChatLuna core 常用配置。保存时插件会尝试通过 Koishi loader 找到 `chatluna` fork 并调用 `update()`。

如果配置文件只读、没有 loader、找不到 ChatLuna fork，或本插件开启了 `readonly`，保存会被拒绝。

## 页面说明

- **概览**：统计、最近会话、模型分布、健康问题和审计摘要。
- **配置**：编辑 ChatLuna core 常用配置。
- **用户**：按 ChatLuna 用户口径聚合会话、绑定、ACL 和规则。
- **会话**：搜索、编辑、新建、删除会话。
- **消息**：查看消息链，编辑聊天记录。
- **权限**：管理 Koishi 用户/频道权限和 ChatLuna 会话 ACL。
- **规则**：管理 `chatluna_constraint` 路由和限制。
- **高级**：provider、资源、上下文、归档、健康检查和批量操作。

## 配置项

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `pageSize` | `40` | 默认分页大小 |
| `readonly` | `false` | 只读模式，前端隐藏或禁用写按钮，后端拒绝写 RPC |
| `maxPreviewRows` | `200` | 预览操作最多返回的对象数量 |
| `enableArchiveFileOps` | `false` | 允许检查归档文件状态和清理缺失文件记录 |
| `enableMessageRepair` | `false` | 允许执行消息链 `parentId/latestMessageId` 修复 |

## 数据范围

ChatLuna 表：

- `chatluna_conversation`
- `chatluna_message`
- `chatluna_binding`
- `chatluna_acl`
- `chatluna_constraint`
- `chatluna_archive`
- `chatluna_meta`
- `chatluna_data_audit`

Koishi 表：

- `user`
- `binding`
- `channel`

provider API Key 不会在页面中展示。adapter/provider 的密钥仍应在对应 ChatLuna adapter 插件中管理。

## 构建

```sh
yarn install
yarn build
npm pack --dry-run
```

## 发布

```sh
npm publish --access public
```

如果 npm 发布失败，先检查：

- `npm whoami`
- `npm config get registry`
- 当前版本号是否已经发布过
- npm token 是否有发布公开包权限
