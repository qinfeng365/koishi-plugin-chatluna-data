# koishi-plugin-chatluna-data

ChatLuna 1.4 数据管理台。插件在 Koishi Console 中提供独立页面，用来维护 ChatLuna 会话、消息、配置、模型引用、归档、授权，以及 Koishi 原生用户权限。

当前版本：`0.8.16`

## 安装

```sh
npm install koishi-plugin-chatluna-data
```

启用插件后，打开 Koishi 左侧栏的 **ChatLuna 数据** 页面。

必需服务：

- `database`
- `console`

可选服务：

- `chatluna`

没有 `chatluna` 服务时仍可浏览数据库；实时 provider、模型、preset 和配置写回能力会受限。

## 建议先开只读

生产环境第一次使用建议先设置：

```text
readonly = true
```

只读模式下，前端会禁用写按钮，后端也会拒绝写入 RPC。确认页面展示正常后，再关闭只读执行维护。

## 常用功能

### 检查模型与 Provider

打开 **模型与 Provider** 页。这里会把 ChatLuna 运行时 provider、数据库里的模型引用、资源能力和健康问题放在一起看：

- **已加载**：provider 已经有运行时 client。
- **已注册**：adapter 已注册，但当前没有加载 client。
- **仅数据库**：数据库里还有 `platform/model` 引用，但运行时没有对应 provider。
- **可用配置**：adapter 配置池中可用配置数 / 总配置数。
- **缺失模型**：会话、规则或默认配置引用了运行时不存在的模型。

如果出现缺失模型，先在右侧选择“迁移到可用模型”，再点击对应引用的 **预览迁移**。插件会先显示影响对象，确认后才写入数据库或配置。只读模式下只能查看，不能执行迁移或刷新 provider。

### 找用户和会话

在 **用户** 页搜索平台用户 ID。用户详情会显示：

- ChatLuna 会话数量
- 相关 `bindingKey`
- Koishi 平台账号绑定
- Koishi 用户权限和频道权限
- ChatLuna ACL 和约束规则引用

ChatLuna 原生命令 `list` 只显示当前上下文路由下的会话。data 插件会跨路由聚合，所以可能看到更多会话。例如：

```text
personal:<platform>:<selfId>:direct:<userId>
personal:<platform>:<selfId>:<guildId>:<userId>
```

前者是私聊个人会话，后者是群内个人会话。

### 分配会话

打开会话详情，使用 **分配会话**：

- 写入 ChatLuna ACL，让用户或群可以查看/管理该会话。
- 选择 `bindingKey`，把指定上下文的 `activeConversationId` / `lastConversationId` 指向该会话。

ACL 解决“能不能访问这个会话”；binding 解决“这个上下文默认继续哪个会话”。

### 管理 Koishi 权限

进入 **权限** 页。新版权限页分为四块：

- **身份总览**：按 Koishi 用户聚合平台账号、显示名、活跃时间、ChatLuna 使用量和风险状态。
- **权限诊断**：输入用户、频道、指令，查看实际允许/拒绝原因。
- **自动分配**：批量设置 `authority`、用户 `permissions`、频道 `permissions`、频道 `assignee`。
- **维护清理**：查看高权限用户、长期未活跃用户、悬空 binding、无 assignee 频道等问题。

Koishi 权限和 ChatLuna ACL 是两套系统。Koishi 权限决定用户能不能执行 Koishi 指令；ChatLuna ACL 决定用户或群能不能访问某个 ChatLuna 会话。

用户显示名来源顺序：

1. Koishi `user.name`
2. 手动刷新的平台身份缓存
3. ChatLuna 人类消息里的 `name`
4. Koishi `binding.pid`
5. Koishi 用户 ID

平台身份不会在打开页面时自动全量刷新，需要手动点击刷新，避免卡顿和平台限流。

权限页会容忍 Koishi 表里异常的时间字段；坏时间只会显示为空，不会导致页面打不开。用户活跃度聚合有短时缓存，权限写入后会自动刷新。

### 平台指令

```text
chatluna-data.permission.who <用户ID或平台账号ID>
chatluna-data.permission.bindings <用户ID或平台账号ID>
chatluna-data.permission.check <用户ID或平台账号ID> [指令]
chatluna-data.permission.inactive [天数]
chatluna-data.permission.authority <用户ID或平台账号ID> <等级>
chatluna-data.permission.perm-add <用户ID或平台账号ID> <权限>
chatluna-data.permission.perm-remove <用户ID或平台账号ID> <权限>
chatluna-data.permission.channel <频道ID> [assignee] -a <权限>
chatluna-data.permission.channel <频道ID> -r <权限>
```

修改类指令会在 `readonly=true` 时被拒绝。

### 编辑会话和消息

**会话** 页可以编辑：

- 标题
- 模型
- preset
- chatMode
- 状态
- `latestMessageId`

**消息** 页可以查看和编辑聊天记录。会话详情会按 `latestMessageId -> parentId` 展示消息链，并标记断链、循环和孤儿消息。

### 修改 ChatLuna 配置

**配置** 页可以查看和修改 ChatLuna core 常用配置。保存时插件会尝试通过 Koishi loader 找到 `chatluna` fork 并调用 `update()`。

### 研判报错和修数据库

进入 **配置与维护 / 报错研判**。这个页面现在按三段式工作：先看 **报错记录**，再看 **诊断结论**，最后跳到 **完整性** 页处理源头数据。插件会自动捕获 ChatLuna、Minato、Provider 相关 error/warn，分析后写入历史记录；也可以把 Koishi 控制台里的完整报错手动粘进去补充分析。插件会识别常见问题并给出处置建议：

- `Unexpected end of JSON input` / `SQLiteBuilder.load`：数据库 JSON 字段为空或损坏。
- `toolCalls.map is not a function`：`chatluna_message.tool_calls` 不是 JSON 数组。
- `no available config`：Provider 没有可用配置或模型引用已经失效。
- `401` / `403` / `timeout`：上游模型服务鉴权或网络问题。
- 完整模型请求 JSON：识别请求体大小、内联图片数量、工具 schema 体积和上下文长度，用于排查超时、请求体过大和多模态负载问题。

数据库类错误会给出三种处置方式：

1. **保守修复**：打开完整性扫描，预览后把坏 JSON 字段安全置空为 `{}`、`[]` 或空字符串。
2. **隔离删除**：备份后删除坏消息、坏归档或无意义的悬空记录。
3. **手工恢复**：停止 Koishi，复制 SQLite 文件，用数据库工具把空字符串改成 `NULL`、`{}` 或 `[]`。

例如下面这种报错通常不是 ChatLuna 逻辑坏了，而是 SQLite 某行 JSON 字段被写成空字符串：

```text
SyntaxError: Unexpected end of JSON input
    at JSON.parse (<anonymous>)
    at Object.load (/koishi/node_modules/@minatojs/driver-sqlite/lib/index.cjs:338:80)
    at SQLiteBuilder.load (/koishi/node_modules/@minatojs/sql-utils/lib/index.cjs:516:41)
```

这时先用“报错研判”确认，再进 **完整性** 页扫描。清空报错记录只会清理 data 插件的诊断历史，不会删除真正的错误源头。执行修复前建议备份数据库；`readonly=true` 时不会允许写入。

`chatluna_data_identity.error` 是平台身份刷新失败的普通文本记录，不属于 JSON 源头错误；完整性扫描不会再把它当成坏 JSON 修复。

如果研判结果是“模型请求负载过大”，这不是数据库损坏。优先压缩图片、减少默认工具、裁剪群环境消息和历史上下文。

## 配置项

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `pageSize` | `40` | 默认分页大小 |
| `readonly` | `false` | 只读模式，后端拒绝写 RPC |
| `maxPreviewRows` | `200` | 预览操作最多返回的对象数量 |
| `enableArchiveFileOps` | `false` | 允许检查归档文件状态 |
| `enableMessageRepair` | `false` | 允许执行消息链修复 |
| `identityRefreshLimitPerBatch` | `30` | 单次批量刷新身份数量 |
| `identityRefreshInterval` | `800` | 身份刷新请求间隔，单位毫秒 |
| `inactiveWarningDays` | `180` | 长期未活跃提示阈值 |
| `enableIdentityLookup` | `true` | 允许手动刷新平台身份 |
| `enableKoishiPermissionCommands` | `true` | 注册权限治理指令 |

## 数据表

ChatLuna 表：

- `chatluna_conversation`
- `chatluna_message`
- `chatluna_binding`
- `chatluna_acl`
- `chatluna_constraint`
- `chatluna_archive`
- `chatluna_meta`
- `chatluna_data_audit`
- `chatluna_data_identity`

Koishi 表：

- `user`
- `binding`
- `channel`

provider API Key 不会在页面中展示。

## 构建

```sh
yarn install
yarn build
npm pack --dry-run
```
