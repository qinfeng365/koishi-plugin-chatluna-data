# ChatLuna Data Engineering Standard

`koishi-plugin-chatluna-data` 是 ChatLuna / Koishi 的底层运维控制台。它不是普通后台、不是日志面板、也不是只读数据库浏览器。

本插件的目标是让管理员能够在生产环境中完成四件事：

1. 定位真实对象。
2. 判断影响范围。
3. 预览并执行修复。
4. 保留可追踪记录。

## Product Positioning

### Role

data 是 **operations console**。

它服务于：

- ChatLuna 数据库维护。
- Koishi 权限治理。
- Provider / model 健康检查。
- 运行时报错捕获与诊断。
- SQLite / Minato 级别的数据修复。

### Non-goals

data 不承担：

- 替代 ChatLuna 正常聊天流程。
- 替代 Koishi 核心权限系统。
- 自动删除历史数据。
- 用日志记录冒充修复结果。
- 在没有预览的情况下批量写库。

## Domain Vocabulary

UI、后端接口、README、审计日志必须统一使用以下概念。

### Error Record

报错记录是日志事实。

来源可以是：

- Koishi logger。
- data RPC wrapper。
- 用户手动粘贴。

报错记录只能说明“发生过什么”。删除报错记录只会删除历史，不会修复源头。

“重置工作台”只能清空当前输入、选择和诊断视图；“清空记录”只能删除 `chatluna_data_ops_error` 里的诊断台账。二者都不能被描述成修复。

### Diagnosis

诊断结论是对报错记录的解释。

诊断必须包含：

- 分类。
- 严重级别。
- 证据。
- 可能原因。
- 建议动作。

诊断不是修复动作。

模型请求转储也是诊断对象。它可以说明 request payload、内联图片、工具 schema、上下文注入是否过重，但它本身不是错误源头数据，不能进入完整性修复。

### Source Data

源头数据是实际导致故障的数据库对象。

它必须能落到：

- table
- record id / primary key
- field
- current value
- proposed value

只有源头数据才能被修复。

字段语义优先于字段名。`error`、`message`、`reason` 这类文本字段即使内容里包含堆栈或冒号，也不能因为不可 `JSON.parse()` 就标成 JSON 损坏。

### Operation

操作是对源头数据的写入、删除、迁移或恢复。

操作必须：

- preview。
- apply。
- audit。
- respect readonly。

## UI Requirements

### Error Analysis Page

报错研判页必须明确标注：

- 这里展示的是报错记录。
- 这里展示的是诊断结论。
- 删除记录不等于修复问题。
- 重置工作台不等于清空历史，清空历史不等于修复源头。
- 修复入口必须跳转到源头数据页面。

禁止：

- 把“删除报错记录”按钮写成“修复”。
- 把 diagnosis 当成 operation。
- 让用户误以为清理日志可以解决 306。

建议结构：

1. Banner：报错记录不是错误源头。
2. Record table：时间、来源、logger、诊断分类、原始报错。
3. Diagnosis panel：原因、影响、证据、处置建议。
4. Source action：跳转完整性页或具体源头对象。

### Integrity Page

完整性页处理源头数据。

页面必须显示：

- table
- record id
- field
- current value 或可读取状态
- issue kind
- risk level
- recommendation
- row action

如果只能捕获到 driver / RPC 级错误，不能把它伪装成可修复源头。必须标注为：

- failure source
- unresolved source data
- needs raw scan

### Manual Edit

手动修改必须读取真实字段值。

禁止：

- 用 snippet 填充编辑器。
- 用截断值作为原值。
- 在无法读取真实值时静默填默认值。

正确行为：

1. 打开编辑器。
2. 后端读取当前字段原值。
3. 成功后填入 current value。
4. 失败时显示失败原因，并给建议值。

## Data Repair Rules

### Use Minato When Safe

如果字段可以通过 `ctx.database` 正常读取和写入，优先使用 Koishi / Minato API。

### Use Raw SQLite When Minato Cannot Load

当错误发生在 Minato load 阶段时，必须绕开 Minato。

典型错误：

```text
ChatLunaError:306
Unexpected end of JSON input
SQLiteBuilder.load
@minatojs/driver-sqlite
```

这类错误说明 Minato 在把 SQLite 文本转换为 JSON 时已经崩溃。继续使用 `ctx.database.get()` 只会再次触发同一个错误。

必须使用 raw SQLite 扫描和修复。

### 306 Source Fields

优先扫描：

- `chatluna_message.tool_calls`
- `chatluna_docstore.metadata`

修复策略：

- `tool_calls` 为空或非法 JSON：写入 `NULL` 或 `[]`。
- `metadata` 为空或非法 JSON：写入 `{}`。
- 无法确认时：显示原值，允许手动编辑。

## Safety Rules

### Preview Before Apply

以下操作必须 preview：

- 批量模型迁移。
- 批量状态变更。
- 权限自动分配。
- 消息链修复。
- 完整性安全置空。
- 完整性删除行。
- raw SQLite 修复。

preview 必须包含：

- affected count
- target table / object
- primary key
- field
- current value summary
- next value summary
- warnings

### Readonly Enforcement

`readonly=true` 必须在后端强制。

包括：

- save RPC。
- apply RPC。
- command writes。
- raw SQLite writes。

### Audit

所有写操作必须写审计。

审计至少包含：

- action
- target
- ids
- count
- createdAt
- detail summary

## Permission Philosophy

data 可以治理 Koishi 权限，但不能重写 Koishi 权限系统。

权限页必须回答：

- 这个人是谁？
- 他绑定了哪些平台账号？
- 他实际有什么 authority / permissions？
- 某个指令为什么允许或拒绝？
- channel assignee 是否拦截？

批量权限变更必须 preview。

## Performance Requirements

生产数据库可能很大。

禁止：

- 首屏全量加载大表。
- 自动全量刷新平台身份。
- 无限制深度扫描消息体。
- 前端渲染完整长消息链。

必须：

- 服务端分页。
- 限制扫描上限。
- 显示截断状态。
- 提供筛选条件。
- 大操作先预览。

## UI Tone

使用运维语言，不使用营销语言。

推荐：

- 报错记录
- 诊断结论
- 源头数据
- 安全置空
- 删除行
- 手动修改
- raw SQLite 修复
- 预览后执行

避免：

- 一键修复全部
- 智能解决
- 未知错误
- 请稍后再试
- 已修复，实际上只是删日志

## Release Rules

每次可发布改动必须升级版本号。

发布前必须执行：

```sh
yarn build
npm pack --dry-run
```

检查点：

- `package.json` version 已更新。
- `README.md` 当前版本已更新。
- dry-run 输出的包名版本正确。
- 不复用已发布版本。

## Acceptance Checklist

一个功能只有同时满足以下条件，才算符合 data 的定位：

- 区分 record / diagnosis / source data / operation。
- 能定位真实对象。
- 不能定位时明确说明不能修复源头。
- 手动编辑读取真实原值。
- 危险操作有 preview。
- 写操作有 audit。
- readonly 后端拒绝。
- 大数据量下不阻塞 UI。
- 不把症状当成源头。
