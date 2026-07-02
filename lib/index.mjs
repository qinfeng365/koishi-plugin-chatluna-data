// src/index.ts
import { access, stat } from "fs/promises";
import { constants } from "fs";
import { randomUUID } from "crypto";
import { dirname, resolve } from "path";
import { gunzip } from "zlib";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { Schema, $, Logger } from "koishi";
var gunzipAsync = promisify(gunzip);
var root = typeof __dirname === "string" ? __dirname : dirname(fileURLToPath(import.meta.url));
var name = "chatluna-data";
var inject = {
  required: ["database", "console"],
  optional: ["chatluna"]
};
var Config = Schema.object({
  pageSize: Schema.number().min(10).max(200).default(40).description("\u9ED8\u8BA4\u5206\u9875\u5927\u5C0F\u3002"),
  readonly: Schema.boolean().default(false).description("\u53EA\u8BFB\u6A21\u5F0F\u4F1A\u9690\u85CF\u5199\u6309\u94AE\uFF0C\u5E76\u62D2\u7EDD\u6240\u6709\u5199 RPC\u3002"),
  maxPreviewRows: Schema.number().min(10).max(1e3).default(200).description("\u5371\u9669\u64CD\u4F5C\u9884\u89C8\u6700\u591A\u8FD4\u56DE\u7684\u5BF9\u8C61\u6570\u91CF\u3002"),
  enableArchiveFileOps: Schema.boolean().default(false).description("\u5141\u8BB8\u68C0\u67E5\u5F52\u6863\u6587\u4EF6\u662F\u5426\u5B58\u5728\u4E0E\u8BFB\u53D6\u6587\u4EF6\u5927\u5C0F\u3002"),
  enableMessageRepair: Schema.boolean().default(false).description("\u5141\u8BB8\u6267\u884C\u6D88\u606F\u94FE parentId/latestMessageId \u4FEE\u590D\u3002"),
  identityRefreshLimitPerBatch: Schema.number().min(1).max(200).default(30).description("\u6BCF\u6B21\u6279\u91CF\u5237\u65B0\u5E73\u53F0\u8EAB\u4EFD\u8D44\u6599\u7684\u6700\u5927\u6570\u91CF\u3002"),
  identityRefreshInterval: Schema.number().min(0).max(1e4).default(800).role("ms").description("\u6279\u91CF\u5237\u65B0\u5E73\u53F0\u8EAB\u4EFD\u8D44\u6599\u65F6\uFF0C\u6BCF\u4E2A\u8BF7\u6C42\u4E4B\u95F4\u7684\u7B49\u5F85\u65F6\u95F4\u3002"),
  inactiveWarningDays: Schema.number().min(1).max(3650).default(180).description("\u8D85\u8FC7\u591A\u5C11\u5929\u672A\u6D3B\u8DC3\u65F6\u5728\u6743\u9650\u9875\u63D0\u793A\u3002"),
  enableIdentityLookup: Schema.boolean().default(true).description("\u5141\u8BB8\u624B\u52A8\u8C03\u7528\u5E73\u53F0 API \u5237\u65B0\u7528\u6237\u6635\u79F0\u548C\u5934\u50CF\u3002"),
  enableKoishiPermissionCommands: Schema.boolean().default(true).description("\u6CE8\u518C Koishi \u6743\u9650\u6CBB\u7406\u6307\u4EE4\u3002")
});
var audits = [];
var opsErrors = [];
var rootCtx;
var permissionCache = { expiresAt: 0 };
function apply(ctx, cfg) {
  rootCtx = ctx;
  const app = ctx;
  const perm = cfg.enableKoishiPermissionCommands ? ctx.command("chatluna-data.permission", {
    authority: 4
  }) : null;
  perm?.subcommand(".who <target:string>").alias("chatluna-data.perm.who").action(async ({ session }, target) => {
    if (!target) return "\u8BF7\u8F93\u5165 Koishi \u7528\u6237 ID \u6216\u5E73\u53F0\u7528\u6237 ID\u3002";
    const user = await findKoishiUser(ctx, target);
    if (!user) return `\u627E\u4E0D\u5230\u7528\u6237\uFF1A${target}`;
    const bindings = await getRows(ctx, "binding", {
      aid: user.id
    });
    return [
      `Koishi \u7528\u6237\uFF1A${user.name || user.id}`,
      `id\uFF1A${user.id}`,
      `authority\uFF1A${user.authority}`,
      `permissions\uFF1A${(user.permissions ?? []).join(", ") || "-"}`,
      `bindings\uFF1A${bindings.map((row) => `${row.platform}:${row.pid}`).join(", ") || "-"}`
    ].join("\n");
  });
  perm?.subcommand(".authority <target:string> <value:number>").alias("chatluna-data.perm.authority").action(async ({ session }, target, value) => {
    if (cfg.readonly) return "readonly \u6A21\u5F0F\u5DF2\u542F\u7528\uFF0C\u62D2\u7EDD\u4FEE\u6539\u3002";
    if (!target || value == null) return "\u7528\u6CD5\uFF1Aauthority <\u7528\u6237> <\u7B49\u7EA7>";
    const user = await findKoishiUser(ctx, target);
    if (!user) return `\u627E\u4E0D\u5230\u7528\u6237\uFF1A${target}`;
    await ctx.database.upsert("user", [
      {
        id: user.id,
        authority: value
      }
    ]);
    pushAudit("command.koishi-user.authority", String(user.id), [], {
      operator: session.userId,
      value
    });
    return `\u5DF2\u8BBE\u7F6E ${user.name || user.id} \u7684 authority \u4E3A ${value}\u3002`;
  });
  perm?.subcommand(".perm-add <target:string> <permission:string>").alias("chatluna-data.perm.add").action(async ({ session }, target, permission) => {
    if (cfg.readonly) return "readonly \u6A21\u5F0F\u5DF2\u542F\u7528\uFF0C\u62D2\u7EDD\u4FEE\u6539\u3002";
    if (!target || !permission) {
      return "\u7528\u6CD5\uFF1Aperm-add <\u7528\u6237> <\u6743\u9650\u5B57\u7B26\u4E32>";
    }
    const user = await findKoishiUser(ctx, target);
    if (!user) return `\u627E\u4E0D\u5230\u7528\u6237\uFF1A${target}`;
    await ctx.database.upsert("user", [
      {
        id: user.id,
        permissions: Array.from(
          /* @__PURE__ */ new Set([...user.permissions ?? [], permission])
        )
      }
    ]);
    pushAudit("command.koishi-user.permission-add", String(user.id), [], {
      operator: session.userId,
      permission
    });
    return `\u5DF2\u4E3A ${user.name || user.id} \u6DFB\u52A0\u6743\u9650 ${permission}\u3002`;
  });
  perm?.subcommand(".perm-remove <target:string> <permission:string>").alias("chatluna-data.perm.remove").action(async ({ session }, target, permission) => {
    if (cfg.readonly) return "readonly \u6A21\u5F0F\u5DF2\u542F\u7528\uFF0C\u62D2\u7EDD\u4FEE\u6539\u3002";
    if (!target || !permission) {
      return "\u7528\u6CD5\uFF1Aperm-remove <\u7528\u6237> <\u6743\u9650\u5B57\u7B26\u4E32>";
    }
    const user = await findKoishiUser(ctx, target);
    if (!user) return `\u627E\u4E0D\u5230\u7528\u6237\uFF1A${target}`;
    await ctx.database.upsert("user", [
      {
        id: user.id,
        permissions: (user.permissions ?? []).filter(
          (item) => item !== permission
        )
      }
    ]);
    pushAudit(
      "command.koishi-user.permission-remove",
      String(user.id),
      [],
      {
        operator: session.userId,
        permission
      }
    );
    return `\u5DF2\u79FB\u9664 ${user.name || user.id} \u7684\u6743\u9650 ${permission}\u3002`;
  });
  perm?.subcommand(".channel <channel:string> [assignee:string]").alias("chatluna-data.perm.channel").option("add", "-a <permission:string>").option("remove", "-r <permission:string>").action(async ({ session, options }, channel, assignee) => {
    if (cfg.readonly) return "readonly \u6A21\u5F0F\u5DF2\u542F\u7528\uFF0C\u62D2\u7EDD\u4FEE\u6539\u3002";
    if (!channel) return "\u7528\u6CD5\uFF1Achannel <\u9891\u9053 ID> [assignee]";
    const [row] = await ctx.database.get("channel", { id: channel });
    if (!row) return `\u627E\u4E0D\u5230\u9891\u9053\uFF1A${channel}`;
    const current = row.permissions ?? [];
    const permissions = options.add ? Array.from(/* @__PURE__ */ new Set([...current, options.add])) : options.remove ? current.filter((item) => item !== options.remove) : current;
    await ctx.database.upsert("channel", [
      {
        id: row.id,
        platform: row.platform,
        assignee: assignee ?? row.assignee,
        permissions
      }
    ]);
    pushAudit("command.koishi-channel.permission", row.id, [], {
      operator: session.userId,
      assignee,
      add: options.add,
      remove: options.remove
    });
    return [
      `\u5DF2\u66F4\u65B0\u9891\u9053 ${row.platform}:${row.id}`,
      `assignee\uFF1A${(assignee ?? row.assignee) || "-"}`,
      `permissions\uFF1A${permissions.join(", ") || "-"}`
    ].join("\n");
  });
  perm?.subcommand(".bindings <target:string>").alias("chatluna-data.perm.bindings").action(async ({}, target) => {
    if (!target) return "\u8BF7\u8F93\u5165 Koishi \u7528\u6237 ID \u6216\u5E73\u53F0\u7528\u6237 ID\u3002";
    const user = await findKoishiUser(ctx, target);
    if (!user) return `\u627E\u4E0D\u5230\u7528\u6237\uFF1A${target}`;
    const rows = await getRows(ctx, "binding", {
      aid: user.id
    });
    if (!rows.length) return `\u7528\u6237 ${user.id} \u6CA1\u6709\u5E73\u53F0\u7ED1\u5B9A\u3002`;
    return rows.map((row) => `${row.platform}:${row.pid} -> aid=${row.aid}`).join("\n");
  });
  perm?.subcommand(".inactive [days:number]").alias("chatluna-data.perm.inactive").action(async ({}, days) => {
    const result = await getPermissionOverviewData(ctx, cfg, {
      page: 1,
      pageSize: cfg.maxPreviewRows,
      inactiveDays: days ?? cfg.inactiveWarningDays
    });
    if (!result.users.length) return "\u6CA1\u6709\u5339\u914D\u7684\u957F\u671F\u672A\u6D3B\u8DC3\u7528\u6237\u3002";
    return result.users.map(
      (row) => `${row.displayName} (${row.id}) authority=${row.authority} inactive=${row.inactiveDays ?? "-"}d`
    ).join("\n");
  });
  perm?.subcommand(".check <target:string> [command:string]").alias("chatluna-data.perm.check").option("channel", "-c <channel:string>").action(async ({ options }, target, command) => {
    if (!target) return "\u8BF7\u8F93\u5165 Koishi \u7528\u6237 ID \u6216\u5E73\u53F0\u7528\u6237 ID\u3002";
    const result = await diagnoseKoishiPermission(ctx, {
      target,
      command,
      channel: options.channel
    });
    return [
      `\u7ED3\u679C\uFF1A${result.allowed ? "\u5141\u8BB8" : "\u62D2\u7EDD"}`,
      `\u72B6\u6001\uFF1A${result.status}`,
      ...result.reasons.map((row) => `- ${row}`)
    ].join("\n");
  });
  perm?.subcommand(".auto <rule:string>").alias("chatluna-data.perm.auto").action(async ({ session }, rule) => {
    if (cfg.readonly) return "readonly \u6A21\u5F0F\u5DF2\u542F\u7528\uFF0C\u62D2\u7EDD\u4FEE\u6539\u3002";
    if (!rule) return "\u7528\u6CD5\uFF1Aauto <inactive-down|channels-assign>";
    const input = rule === "channels-assign" ? { type: "channels-assign", assignee: session.selfId } : {
      type: "inactive-down",
      days: cfg.inactiveWarningDays,
      authority: 0,
      permissions: []
    };
    const plan = await previewKoishiMaintenance(ctx, cfg, input);
    return [
      `\u89C4\u5219\uFF1A${rule}`,
      `\u5F71\u54CD\uFF1A${plan.count}`,
      "\u8BF7\u5728\u63A7\u5236\u53F0\u9884\u89C8\u540E\u5E94\u7528\u3002"
    ].join("\n");
  });
  ctx.model.extend(
    "chatluna_conversation",
    {
      id: "string",
      seq: "unsigned",
      bindingKey: "string",
      title: "text",
      model: "string",
      preset: "string",
      chatMode: "string",
      createdBy: "string",
      createdAt: "timestamp",
      updatedAt: "timestamp",
      lastChatAt: "timestamp",
      status: "string",
      latestMessageId: "string",
      additional_kwargs: "text",
      compression: "string",
      archivedAt: "timestamp",
      archiveId: "string",
      legacyRoomId: "unsigned",
      legacyMeta: "text",
      autoTitle: "boolean"
    },
    {
      primary: "id",
      indexes: [
        { keys: { bindingKey: "asc" } },
        { keys: { status: "asc" } },
        { keys: { model: "asc" } },
        { keys: { createdBy: "asc" } },
        { keys: { updatedAt: "desc" } }
      ]
    }
  );
  ctx.model.extend(
    "chatluna_message",
    {
      id: "string",
      conversationId: "string",
      parentId: "string",
      role: "string",
      text: "text",
      content: "binary",
      name: "string",
      tool_call_id: "string",
      tool_calls: "text",
      additional_kwargs_binary: "binary",
      response_metadata_binary: "binary",
      rawId: "string",
      createdAt: "timestamp"
    },
    {
      primary: "id",
      indexes: [
        { keys: { conversationId: "asc" } },
        { keys: { parentId: "asc" } }
      ]
    }
  );
  ctx.model.extend(
    "chatluna_binding",
    {
      bindingKey: "string",
      activeConversationId: "string",
      lastConversationId: "string",
      updatedAt: "timestamp"
    },
    {
      primary: "bindingKey",
      indexes: [
        { keys: { activeConversationId: "asc" } },
        { keys: { lastConversationId: "asc" } }
      ]
    }
  );
  ctx.model.extend(
    "chatluna_acl",
    {
      conversationId: "string",
      principalType: "string",
      principalId: "string",
      permission: "string"
    },
    {
      primary: ["conversationId", "principalType", "principalId"],
      indexes: [{ keys: { principalId: "asc" } }]
    }
  );
  ctx.model.extend(
    "chatluna_constraint",
    {
      id: "unsigned",
      name: "string",
      enabled: "boolean",
      priority: "integer",
      createdBy: "string",
      createdAt: "timestamp",
      updatedAt: "timestamp",
      platform: "string",
      selfId: "string",
      guildId: "string",
      channelId: "string",
      direct: "boolean",
      users: "text",
      excludeUsers: "text",
      routeMode: "string",
      routeKey: "string",
      activePresetLane: "string",
      defaultModel: "string",
      defaultPreset: "string",
      defaultChatMode: "string",
      fixedModel: "string",
      fixedPreset: "string",
      fixedChatMode: "string",
      lockConversation: "boolean",
      allowNew: "boolean",
      allowSwitch: "boolean",
      allowArchive: "boolean",
      allowExport: "boolean",
      manageMode: "string"
    },
    { primary: "id" }
  );
  ctx.model.extend(
    "chatluna_archive",
    {
      id: "string",
      conversationId: "string",
      path: "string",
      formatVersion: "integer",
      messageCount: "integer",
      checksum: "string",
      size: "unsigned",
      state: "string",
      createdAt: "timestamp",
      restoredAt: "timestamp"
    },
    {
      primary: "id",
      indexes: [{ keys: { conversationId: "asc" } }]
    }
  );
  ctx.model.extend(
    "chatluna_meta",
    {
      key: "string",
      value: "text",
      updatedAt: "timestamp"
    },
    { primary: "key" }
  );
  ctx.model.extend(
    "chatluna_data_audit",
    {
      id: "string",
      action: "string",
      target: "string",
      ids: "text",
      count: "integer",
      detail: "text",
      createdAt: "timestamp"
    },
    { primary: "id" }
  );
  ctx.model.extend(
    "chatluna_data_identity",
    {
      platform: "string",
      id: "string",
      name: "string",
      avatar: "text",
      source: "string",
      error: "text",
      updatedAt: "timestamp"
    },
    { primary: ["platform", "id"] }
  );
  ctx.model.extend(
    "chatluna_data_ops_error",
    {
      id: "string",
      source: "string",
      level: "string",
      logger: "string",
      message: "text",
      kind: "string",
      title: "text",
      severity: "string",
      analysis: "text",
      createdAt: "timestamp"
    },
    {
      primary: "id",
      indexes: [
        { keys: { createdAt: "desc" } },
        { keys: { kind: "asc" } }
      ]
    }
  );
  ctx.console.addEntry({
    dev: resolve(root, "../client/index.ts"),
    prod: resolve(root, "../dist")
  });
  const opsTarget = {
    levels: { base: Logger.WARN },
    record: (record) => {
      void recordOpsLog(ctx, cfg, record).catch(() => {
      });
    }
  };
  Logger.targets.push(opsTarget);
  ctx.on("dispose", () => {
    const idx = Logger.targets.indexOf(opsTarget);
    if (idx >= 0) Logger.targets.splice(idx, 1);
  });
  const originalAddListener = ctx.console.addListener.bind(ctx.console);
  ctx.console.addListener = ((path, callback, options) => {
    const wrapped = async (...args) => {
      try {
        return await callback(...args);
      } catch (err) {
        if (isMinatoLoadError(err)) {
          recordLoadError(path, err, args[0]);
          const message = err instanceof Error ? err.message : String(err);
          const result = await analyzeOpsError(ctx, cfg, {
            text: message
          });
          await pushOpsError(
            ctx,
            {
              source: "rpc",
              level: "error",
              logger: path,
              message
            },
            result
          );
          throw new Error(
            `\u6570\u636E\u5E93\u810F\u6570\u636E\u963B\u6B62\u4E86 ${path}: ${message}\u3002\u8BF7\u524D\u5F80\u300C\u9AD8\u7EA7 / \u5B8C\u6574\u6027\u300D\u9762\u677F\u67E5\u770B\u3002`
          );
        }
        throw err;
      }
    };
    return originalAddListener(path, wrapped, options);
  });
  ctx.console.addListener(
    "chatluna-data/getOverview",
    async () => overview(ctx, cfg, app),
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/getModelHealth",
    async (input = {}) => modelHealth(ctx, cfg, app, input),
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/listProviders",
    async (input = {}) => {
      const convs = await getRows(
        ctx,
        "chatluna_conversation"
      );
      return pageRows(
        buildProviders(app, convs),
        input,
        (row) => [
          row.platform,
          row.state,
          row.capabilities.join("\n"),
          row.models.map((model) => model.name).join("\n")
        ].join("\n"),
        (a, b) => a.platform.localeCompare(b.platform),
        cfg
      );
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/getProviderDetail",
    async (input) => {
      const convs = await getRows(
        ctx,
        "chatluna_conversation"
      );
      return buildProviderDetail(app, convs, input.platform);
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/refreshProvider",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      const platform = app.chatluna?.platform;
      const client = platform?._platformClients?.[input.platform] ?? await platform?.createClient?.(input.platform);
      if (!client) throw new Error(`provider ${input.platform} not found`);
      await platform?.refreshClient?.(client, input.platform);
      pushAudit("provider.refresh", input.platform, []);
      return { ok: true };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/listUsers",
    async (input = {}) => {
      const [convs, acls, rules] = await Promise.all([
        getRows(ctx, "chatluna_conversation"),
        getRows(ctx, "chatluna_acl"),
        getRows(ctx, "chatluna_constraint")
      ]);
      return pageRows(
        buildUsers(convs, acls, rules),
        input,
        (row) => `${row.userId}
${row.guildId}
${row.bindingKeys.join("\n")}`,
        (a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt),
        cfg
      );
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/listContexts",
    async (input = {}) => {
      const [convs, bindings, acls, rules, users, kBindings, channels] = await Promise.all([
        getRows(ctx, "chatluna_conversation"),
        getRows(ctx, "chatluna_binding"),
        getRows(ctx, "chatluna_acl"),
        getRows(ctx, "chatluna_constraint"),
        getRows(ctx, "user"),
        getRows(ctx, "binding"),
        getRows(ctx, "channel")
      ]);
      return pageRows(
        buildContexts(
          convs,
          bindings,
          acls,
          rules,
          users,
          kBindings,
          channels
        ),
        input,
        (row) => [
          row.bindingKey,
          row.baseKey,
          row.platform,
          row.selfId,
          row.guildId,
          row.userId,
          row.koishiUserName,
          row.channelAssignee
        ].join("\n"),
        (a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt),
        cfg
      );
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/listResources",
    async (input = {}) => {
      const [convs, rules] = await Promise.all([
        getRows(ctx, "chatluna_conversation"),
        getRows(ctx, "chatluna_constraint")
      ]);
      return pageRows(
        buildResources(app, convs, rules),
        input,
        (row) => [
          row.type,
          row.name,
          row.description,
          row.source,
          row.group,
          row.tags.join("\n")
        ].join("\n"),
        (a, b) => `${a.type}:${a.name}`.localeCompare(`${b.type}:${b.name}`),
        cfg
      );
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/getHealth",
    async () => health(ctx, cfg, app),
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/analyzeOpsError",
    async (input = {}) => {
      const result = await analyzeOpsError(ctx, cfg, input);
      if (input.text?.trim()) {
        await pushOpsError(
          ctx,
          {
            source: "manual",
            level: "error",
            logger: "console",
            message: input.text.trim()
          },
          result
        );
      }
      return result;
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/listOpsErrors",
    async () => ({ rows: opsErrors }),
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/resetOpsErrors",
    async () => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      const count = opsErrors.length;
      opsErrors.splice(0, opsErrors.length);
      await ctx.database.remove("chatluna_data_ops_error", {});
      pushAudit("ops-error.reset", "chatluna_data_ops_error", []);
      return { count };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/getConfig",
    async () => {
      const fork = findChatLunaFork(ctx);
      const source = fork?.fork.config ?? app.chatluna?.currentConfig ?? app.chatluna?.config ?? {};
      return {
        config: { ...chatlunaConfigDefaults(), ...source },
        runtime: {
          connected: app.chatluna != null,
          source: fork?.key ?? "runtime",
          writable: fork != null && ctx.get("loader")?.writable === true && !cfg.readonly
        },
        choices: {
          models: liveModels(app),
          chatModes: Object.keys(
            app.chatluna?.platform?._chatChains ?? {}
          ).sort(),
          presets: (app.chatluna?.preset?.getAllPreset?.(true).value ?? []).sort(),
          embeddings: Object.entries(
            app.chatluna?.platform?._models ?? {}
          ).flatMap(
            ([platform, rows]) => rows.filter((row) => row.type === 2).map((row) => `${platform}/${row.name}`)
          ).sort(),
          vectorStores: Object.keys(
            app.chatluna?.platform?._vectorStore ?? {}
          ).sort()
        }
      };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/saveConfig",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      const fork = findChatLunaFork(ctx);
      if (!fork) throw new Error("chatluna plugin fork not found");
      if (ctx.get("loader")?.writable !== true) {
        throw new Error("koishi config file is readonly");
      }
      const next = {
        ...fork.fork.config,
        ...input.config
      };
      fork.fork.update(next);
      pushAudit("config.save", fork.key, []);
      return { ok: true, key: fork.key };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/getUserDetail",
    async (input) => {
      const [
        convs,
        acls,
        rules,
        bindings,
        users,
        kBindings,
        channels
      ] = await Promise.all([
        getRows(ctx, "chatluna_conversation"),
        getRows(ctx, "chatluna_acl"),
        getRows(ctx, "chatluna_constraint"),
        getRows(ctx, "chatluna_binding"),
        getRows(ctx, "user"),
        getRows(ctx, "binding"),
        getRows(ctx, "channel")
      ]);
      const rows = convs.filter(
        (row) => row.createdBy === input.userId || row.bindingKey.includes(input.userId)
      );
      const ctxs = buildContexts(
        convs,
        bindings,
        acls,
        rules,
        users,
        kBindings,
        channels
      ).filter((row) => row.userId === input.userId);
      const ids = new Set(rows.map((row) => row.id));
      return {
        user: buildUsers(convs, acls, rules).find(
          (row) => row.userId === input.userId
        ),
        contexts: ctxs,
        koishiBindings: kBindings.filter(
          (row) => row.pid === input.userId
        ),
        koishiUsers: users.filter(
          (row) => kBindings.some(
            (item) => item.pid === input.userId && item.aid === row.id
          )
        ),
        channels: channels.filter(
          (row) => ctxs.some(
            (item) => item.platform === row.platform && (item.guildId === row.id || item.guildId === row.guildId)
          )
        ),
        conversations: rows.sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt)).map((row) => viewConversation(row)),
        acl: acls.filter(
          (row) => row.principalId === input.userId || ids.has(row.conversationId)
        ),
        constraints: rules.filter(
          (row) => [
            ...readUserList(row.users),
            ...readUserList(row.excludeUsers),
            row.createdBy
          ].includes(input.userId)
        ).map((row) => viewConstraint(row)),
        bindings: bindings.filter(
          (row) => row.bindingKey.includes(input.userId)
        )
      };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/listConversations",
    async (input = {}) => {
      const rows = await getRows(
        ctx,
        "chatluna_conversation"
      );
      return pageRows(
        rows.filter((row) => {
          if (input.status && row.status !== input.status) {
            return false;
          }
          if (input.model && row.model !== input.model) {
            return false;
          }
          if (input.user && row.createdBy !== input.user && !row.bindingKey.includes(input.user)) {
            return false;
          }
          return true;
        }).map((row) => viewConversation(row)),
        input,
        (row) => [
          row.id,
          row.title,
          row.model,
          row.preset,
          row.chatMode,
          row.bindingKey,
          row.createdBy,
          row.latestMessageId
        ].join("\n"),
        (a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt),
        cfg
      );
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/getConversationDetail",
    async (input) => {
      const [conv] = await ctx.database.get("chatluna_conversation", {
        id: input.id
      });
      const messageLimit = Math.max(1, input.messageLimit ?? 200);
      const [chainMsgs, bindings, acls, arcs] = await Promise.all([
        getMessageChainRows(ctx, { conversationId: input.id }),
        getRows(ctx, "chatluna_binding"),
        getRows(ctx, "chatluna_acl", {
          conversationId: input.id
        }),
        getRows(ctx, "chatluna_archive", {
          conversationId: input.id
        })
      ]);
      const diag = diagnoseConversation(conv, chainMsgs);
      const visibleIds = diag.rows.slice(0, messageLimit).map((row) => row.id);
      const fullRows = visibleIds.length === 0 ? [] : await ctx.database.get(
        "chatluna_message",
        { id: { $in: visibleIds } }
      );
      const fullById = new Map(fullRows.map((row) => [row.id, row]));
      const binding = bindings.find((row) => row.bindingKey === conv.bindingKey) ?? null;
      const refs = bindings.filter(
        (row) => row.bindingKey !== conv.bindingKey && (row.activeConversationId === conv.id || row.lastConversationId === conv.id)
      );
      const route = parseBindingKey(conv.bindingKey);
      return {
        conversation: viewConversation(conv),
        route,
        binding,
        bindingRefs: refs,
        acl: acls,
        archives: await Promise.all(
          arcs.map((row) => viewArchive(row, cfg))
        ),
        diagnostics: diag,
        messages: await Promise.all(
          visibleIds.map((id) => fullById.get(id)).filter((row) => row != null).map(async (row) => viewMessage(row))
        )
      };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/assignConversation",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      const [conv] = await ctx.database.get("chatluna_conversation", {
        id: input.conversationId
      });
      const ids = [conv.id];
      const now = /* @__PURE__ */ new Date();
      if (input.principalId) {
        await ctx.database.upsert("chatluna_acl", [
          {
            conversationId: conv.id,
            principalType: input.principalType,
            principalId: input.principalId,
            permission: input.permission
          }
        ]);
      }
      if (input.bindingKey) {
        const [binding] = await ctx.database.get("chatluna_binding", {
          bindingKey: input.bindingKey
        });
        await ctx.database.upsert("chatluna_binding", [
          {
            bindingKey: input.bindingKey,
            activeConversationId: input.setActive === false ? binding?.activeConversationId ?? null : conv.id,
            lastConversationId: input.setLast === false ? binding?.lastConversationId ?? null : conv.id,
            updatedAt: now
          }
        ]);
      }
      await clearRuntime(app, conv);
      pushAudit("conversation.assign", conv.id, ids, {
        principalType: input.principalType,
        principalId: input.principalId,
        permission: input.permission,
        bindingKey: input.bindingKey,
        setActive: input.setActive !== false,
        setLast: input.setLast !== false
      });
      return { ok: true };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/listMessages",
    async (input = {}) => {
      const msgQuery = {};
      if (input.conversationId) {
        msgQuery.conversationId = input.conversationId;
      }
      if (input.role && !input.user) {
        msgQuery.role = input.role;
      }
      const fastPath = !input.query?.trim() && !input.user;
      const page = Math.max(1, Number(input.page ?? 1));
      const pageSize = Math.max(
        10,
        Number(input.pageSize ?? cfg.pageSize)
      );
      if (fastPath) {
        const [pageMsgs, total, convs2] = await Promise.all([
          await ctx.database.get(
            "chatluna_message",
            msgQuery,
            {
              fields: MESSAGE_LIST_COLUMNS,
              sort: { createdAt: "desc" },
              limit: pageSize,
              offset: (page - 1) * pageSize
            }
          ),
          ctx.database.select("chatluna_message", msgQuery).execute(
            (row) => $.count(row.id)
          ),
          getRows(ctx, "chatluna_conversation")
        ]);
        const map2 = new Map(convs2.map((row) => [row.id, row]));
        const rows2 = await Promise.all(
          pageMsgs.map(async (row) => ({
            ...await viewMessage(row),
            title: map2.get(row.conversationId)?.title ?? "",
            model: map2.get(row.conversationId)?.model ?? "",
            createdBy: map2.get(row.conversationId)?.createdBy ?? "",
            bindingKey: map2.get(row.conversationId)?.bindingKey ?? ""
          }))
        );
        return {
          page,
          pageSize,
          total: Number(total ?? 0),
          rows: rows2
        };
      }
      const [msgs, convs] = await Promise.all([
        getMessageRows(ctx, msgQuery),
        getRows(ctx, "chatluna_conversation")
      ]);
      const map = new Map(convs.map((row) => [row.id, row]));
      const rows = await Promise.all(
        msgs.filter((row) => {
          const conv = map.get(row.conversationId);
          if (input.role && row.role !== input.role) return false;
          if (input.user && conv?.createdBy !== input.user && !conv?.bindingKey.includes(input.user)) {
            return false;
          }
          return true;
        }).map(async (row) => ({
          ...await viewMessage(row),
          title: map.get(row.conversationId)?.title ?? "",
          model: map.get(row.conversationId)?.model ?? "",
          createdBy: map.get(row.conversationId)?.createdBy ?? "",
          bindingKey: map.get(row.conversationId)?.bindingKey ?? ""
        }))
      );
      return pageRows(
        rows,
        input,
        (row) => [
          row.id,
          row.conversationId,
          row.parentId,
          row.rawId,
          row.role,
          row.text,
          row.title,
          row.model,
          row.createdBy,
          row.bindingKey
        ].join("\n"),
        (a, b) => timeOf(b.createdAt) - timeOf(a.createdAt),
        cfg
      );
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/saveConversationPatch",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      const [conv] = await ctx.database.get("chatluna_conversation", {
        id: input.id
      });
      const patch = {
        id: conv.id,
        updatedAt: /* @__PURE__ */ new Date()
      };
      for (const key of [
        "title",
        "model",
        "preset",
        "chatMode",
        "status",
        "latestMessageId",
        "archiveId",
        "autoTitle"
      ]) {
        if (Object.prototype.hasOwnProperty.call(input.patch, key)) {
          ;
          patch[key] = input.patch[key];
        }
      }
      await ctx.database.upsert("chatluna_conversation", [patch]);
      await clearRuntime(app, { ...conv, ...patch });
      pushAudit("conversation.patch", conv.id, [conv.id], patch);
      return { ok: true };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/createConversation",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      const now = /* @__PURE__ */ new Date();
      const row = {
        id: input.row.id || randomUUID(),
        bindingKey: input.row.bindingKey,
        title: input.row.title || "\u65B0\u4F1A\u8BDD",
        model: input.row.model,
        preset: input.row.preset,
        chatMode: input.row.chatMode,
        createdBy: input.row.createdBy,
        createdAt: now,
        updatedAt: now,
        lastChatAt: null,
        status: input.row.status || "active",
        latestMessageId: null,
        additional_kwargs: null,
        compression: null,
        archivedAt: null,
        archiveId: null,
        legacyRoomId: null,
        legacyMeta: null,
        autoTitle: true
      };
      await ctx.database.upsert("chatluna_conversation", [row]);
      if (input.setBindingActive) {
        await ctx.database.upsert("chatluna_binding", [
          {
            bindingKey: row.bindingKey,
            activeConversationId: row.id,
            lastConversationId: row.id,
            updatedAt: now
          }
        ]);
      }
      pushAudit("conversation.create", row.id, [row.id], row);
      return { ok: true, id: row.id };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/removeConversation",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      const [conv] = await ctx.database.get("chatluna_conversation", {
        id: input.id
      });
      await ctx.database.remove("chatluna_conversation", { id: input.id });
      if (input.removeMessages) {
        await ctx.database.remove("chatluna_message", {
          conversationId: input.id
        });
      }
      if (input.removeAcl) {
        await ctx.database.remove("chatluna_acl", {
          conversationId: input.id
        });
      }
      const bindings = await getRows(
        ctx,
        "chatluna_binding",
        {
          $or: [
            { activeConversationId: input.id },
            { lastConversationId: input.id }
          ]
        }
      );
      if (bindings.length > 0) {
        await ctx.database.upsert(
          "chatluna_binding",
          bindings.map((row) => ({
            bindingKey: row.bindingKey,
            activeConversationId: row.activeConversationId === input.id ? null : row.activeConversationId,
            lastConversationId: row.lastConversationId === input.id ? null : row.lastConversationId,
            updatedAt: /* @__PURE__ */ new Date()
          }))
        );
      }
      await clearRuntime(app, conv);
      pushAudit("conversation.remove", input.id, [input.id], input);
      return { ok: true };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/saveBinding",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      if (input.mode === "remove") {
        await ctx.database.remove("chatluna_binding", {
          bindingKey: input.row.bindingKey
        });
        pushAudit("binding.remove", input.row.bindingKey, []);
        return { ok: true };
      }
      await ctx.database.upsert("chatluna_binding", [
        {
          bindingKey: input.row.bindingKey,
          activeConversationId: input.row.activeConversationId || null,
          lastConversationId: input.row.lastConversationId || null,
          updatedAt: /* @__PURE__ */ new Date()
        }
      ]);
      pushAudit("binding.save", input.row.bindingKey, [
        input.row.activeConversationId ?? "",
        input.row.lastConversationId ?? ""
      ]);
      return { ok: true };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/saveMessage",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      const [conv] = await ctx.database.get("chatluna_conversation", {
        id: input.row.conversationId
      });
      const row = {
        id: input.row.id || randomUUID(),
        conversationId: conv.id,
        parentId: input.row.parentId || null,
        role: input.row.role,
        text: input.row.text ?? "",
        content: null,
        name: input.row.name || null,
        tool_call_id: input.row.tool_call_id || null,
        rawId: input.row.rawId || null,
        createdAt: input.row.createdAt ? new Date(input.row.createdAt) : /* @__PURE__ */ new Date()
      };
      await ctx.database.upsert("chatluna_message", [row]);
      await ctx.database.upsert("chatluna_conversation", [
        {
          id: conv.id,
          latestMessageId: input.setLatest === false ? conv.latestMessageId : row.id,
          updatedAt: /* @__PURE__ */ new Date()
        }
      ]);
      await clearRuntime(app, conv);
      pushAudit("message.save", conv.id, [String(row.id)], row);
      return { ok: true, id: row.id };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/removeMessage",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      const [msg] = await ctx.database.get("chatluna_message", {
        id: input.id
      });
      const [conv] = await ctx.database.get("chatluna_conversation", {
        id: msg.conversationId
      });
      await ctx.database.remove("chatluna_message", { id: input.id });
      const msgs = await getMessageChainRows(ctx, {
        conversationId: conv.id
      });
      await ctx.database.upsert("chatluna_conversation", [
        {
          id: conv.id,
          latestMessageId: conv.latestMessageId === input.id ? msgs.slice().sort(
            (a, b) => timeOf(b.createdAt) - timeOf(a.createdAt)
          )[0]?.id ?? null : conv.latestMessageId,
          updatedAt: /* @__PURE__ */ new Date()
        }
      ]);
      await clearRuntime(app, conv);
      pushAudit("message.remove", conv.id, [input.id]);
      return { ok: true };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/listAcl",
    async (input = {}) => {
      return pageRows(
        await getRows(ctx, "chatluna_acl"),
        input,
        (row) => `${row.conversationId}
${row.principalType}
${row.principalId}
${row.permission}`,
        (a, b) => `${a.conversationId}:${a.principalId}`.localeCompare(
          `${b.conversationId}:${b.principalId}`
        ),
        cfg
      );
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/getPermissionOverview",
    async (input) => getPermissionOverviewData(ctx, cfg, input ?? {}),
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/saveKoishiUserPermission",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      await ctx.database.upsert("user", [
        {
          id: input.id,
          authority: input.authority,
          permissions: readUserList(input.permissions)
        }
      ]);
      pushAudit("koishi-user.permission", String(input.id), [], input);
      return { ok: true };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/saveKoishiChannelPermission",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      await ctx.database.upsert("channel", [
        {
          id: input.id,
          platform: input.platform,
          assignee: input.assignee,
          permissions: readUserList(input.permissions)
        }
      ]);
      pushAudit("koishi-channel.permission", input.id, [], input);
      return { ok: true };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/previewKoishiPermissionPlan",
    async (input) => previewKoishiPermissionPlan(ctx, cfg, input),
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/applyKoishiPermissionPlan",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      const plan = await previewKoishiPermissionPlan(ctx, cfg, input);
      if (input.target === "channels" || input.target === "channels-empty") {
        await ctx.database.upsert(
          "channel",
          plan.allRows.map((row) => ({
            id: String(row.id),
            platform: row.platform,
            assignee: row.nextAssignee,
            permissions: row.nextPermissions
          }))
        );
      } else {
        await ctx.database.upsert(
          "user",
          plan.allRows.map((row) => ({
            id: Number(row.id),
            authority: row.nextAuthority,
            permissions: row.nextPermissions
          }))
        );
      }
      pushAudit(
        "koishi-permission.apply",
        input.target,
        plan.allRows.map((row) => String(row.id)),
        input
      );
      return { ok: true, count: plan.count };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/listKoishiIdentities",
    async (input) => {
      const rows = await getRows(
        ctx,
        "chatluna_data_identity"
      );
      return paginate(
        rows.filter(
          (row) => matchText(input?.query, [
            row.platform,
            row.id,
            row.name,
            row.source,
            row.error
          ])
        ).sort(
          (a, b) => `${a.platform}:${a.id}`.localeCompare(
            `${b.platform}:${b.id}`
          )
        ).map((row) => ({
          platform: row.platform,
          id: row.id,
          name: row.name,
          avatar: row.avatar,
          source: row.source,
          error: row.error,
          updatedAt: iso(row.updatedAt)
        })),
        input
      );
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/refreshKoishiIdentity",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      if (!cfg.enableIdentityLookup) {
        throw new Error("identity lookup disabled");
      }
      const row = await refreshKoishiIdentity(ctx, input);
      pushAudit(
        "koishi-identity.refresh",
        `${input.platform}:${input.id}`,
        [],
        input
      );
      return row;
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/refreshKoishiIdentityBatch",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      if (!cfg.enableIdentityLookup) {
        throw new Error("identity lookup disabled");
      }
      const rows = input.rows.slice(0, cfg.identityRefreshLimitPerBatch);
      const result = [];
      for (const row of rows) {
        result.push(await refreshKoishiIdentity(ctx, row));
        if (cfg.identityRefreshInterval > 0) {
          await sleep(cfg.identityRefreshInterval);
        }
      }
      pushAudit(
        "koishi-identity.refresh-batch",
        input.platform ?? "mixed",
        rows.map((row) => `${row.platform}:${row.id}`),
        { count: result.length }
      );
      return { ok: true, count: result.length, rows: result };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/listKoishiCommands",
    async () => listKoishiCommands(ctx),
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/getKoishiPermissionGraph",
    async () => ({
      permissions: ctx.permissions.list().sort(),
      commands: listKoishiCommands(ctx)
    }),
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/diagnoseKoishiPermission",
    async (input) => diagnoseKoishiPermission(ctx, input),
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/previewKoishiMaintenance",
    async (input) => previewKoishiMaintenance(ctx, cfg, input),
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/applyKoishiMaintenance",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      const plan = await previewKoishiMaintenance(ctx, cfg, input);
      if (input.type === "channels-assign") {
        await ctx.database.upsert(
          "channel",
          plan.allRows.map((row) => ({
            id: String(row.id),
            platform: row.platform,
            assignee: row.nextAssignee,
            permissions: row.nextPermissions
          }))
        );
      } else {
        await ctx.database.upsert(
          "user",
          plan.allRows.map((row) => ({
            id: Number(row.id),
            authority: row.nextAuthority,
            permissions: row.nextPermissions
          }))
        );
      }
      pushAudit(
        "koishi-maintenance.apply",
        input.type,
        plan.allRows.map((row) => String(row.id)),
        input
      );
      return { ok: true, count: plan.count };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/saveAcl",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      if (input.mode === "remove") {
        await ctx.database.remove("chatluna_acl", {
          conversationId: input.row.conversationId,
          principalType: input.row.principalType,
          principalId: input.row.principalId
        });
        pushAudit("acl.remove", input.row.conversationId, [
          input.row.conversationId
        ]);
        return { ok: true };
      }
      await ctx.database.upsert("chatluna_acl", [input.row]);
      pushAudit("acl.save", input.row.conversationId, [
        input.row.conversationId
      ]);
      return { ok: true };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/listConstraints",
    async (input = {}) => {
      return pageRows(
        (await getRows(ctx, "chatluna_constraint")).map(
          (row) => viewConstraint(row)
        ),
        input,
        (row) => [
          row.id,
          row.name,
          row.createdBy,
          row.guildId,
          row.channelId,
          row.defaultModel,
          row.fixedModel,
          row.routeKey
        ].join("\n"),
        (a, b) => b.priority - a.priority,
        cfg
      );
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/saveConstraint",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      if (input.mode === "remove") {
        await ctx.database.remove("chatluna_constraint", {
          id: input.row.id
        });
        pushAudit("constraint.remove", String(input.row.id), []);
        return { ok: true };
      }
      const now = /* @__PURE__ */ new Date();
      const row = { ...input.row };
      if (!row.id) delete row.id;
      await ctx.database.upsert("chatluna_constraint", [
        {
          ...row,
          users: writeUserList(row.users),
          excludeUsers: writeUserList(row.excludeUsers),
          createdAt: row.createdAt ? new Date(row.createdAt) : now,
          updatedAt: now
        }
      ]);
      pushAudit("constraint.save", String(input.row.id ?? input.row.name), []);
      return { ok: true };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/listArchives",
    async (input = {}) => {
      return pageRows(
        await Promise.all(
          (await getRows(ctx, "chatluna_archive")).map((row) => viewArchive(row, cfg))
        ),
        input,
        (row) => `${row.id}
${row.conversationId}
${row.path}
${row.state}
${row.checksum}`,
        (a, b) => timeOf(b.createdAt) - timeOf(a.createdAt),
        cfg
      );
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/previewOperation",
    async (input) => {
      return previewOperation(ctx, cfg, input);
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/applyOperation",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      const prev = await previewOperation(ctx, cfg, input);
      if (prev.blocked) return prev;
      if (input.type === "model-migration") {
        await ctx.database.upsert(
          "chatluna_conversation",
          prev.rows.map((row) => ({
            id: row.id,
            model: input.targetModel,
            updatedAt: /* @__PURE__ */ new Date()
          }))
        );
        if (prev.rows.length > 0) {
          const ids = prev.rows.map((row) => row.id);
          const convs = await getRows(
            ctx,
            "chatluna_conversation",
            { id: { $in: ids } }
          );
          await Promise.all(convs.map((conv) => clearRuntime(app, conv)));
        }
        pushAudit("operation.model-migration", input.targetModel, [
          ...prev.rows.map((row) => row.id)
        ]);
        return { ...prev, applied: true };
      }
      if (input.type === "model-reference-migration") {
        const rows = prev.allRows ?? prev.rows;
        const convRows = rows.filter((row) => row.kind === "conversation");
        const ruleRows = rows.filter((row) => row.kind === "constraint");
        const cfgRows = rows.filter((row) => row.kind === "config");
        if (convRows.length) {
          await ctx.database.upsert(
            "chatluna_conversation",
            convRows.map((row) => ({
              id: row.refId,
              model: input.targetModel,
              updatedAt: /* @__PURE__ */ new Date()
            }))
          );
          const ids = convRows.map((row) => row.refId);
          const convs = await getRows(
            ctx,
            "chatluna_conversation",
            { id: { $in: ids } }
          );
          await Promise.all(convs.map((conv) => clearRuntime(app, conv)));
        }
        if (ruleRows.length) {
          await ctx.database.upsert(
            "chatluna_constraint",
            ruleRows.map((row) => ({
              id: Number(row.refId),
              [row.field]: input.targetModel,
              updatedAt: /* @__PURE__ */ new Date()
            }))
          );
        }
        if (cfgRows.length) {
          const fork = findChatLunaFork(ctx);
          if (!fork) throw new Error("chatluna plugin fork not found");
          if (ctx.get("loader")?.writable !== true) {
            throw new Error("koishi config file is readonly");
          }
          fork.fork.update({
            ...fork.fork.config,
            defaultModel: input.targetModel
          });
        }
        pushAudit(
          "operation.model-reference-migration",
          input.targetModel,
          rows.map((row) => row.id),
          {
            fromModel: input.fromModel,
            scopes: input.scopes
          }
        );
        return { ...prev, applied: true };
      }
      if (input.type === "status-change") {
        await ctx.database.upsert(
          "chatluna_conversation",
          prev.rows.map((row) => ({
            id: row.id,
            status: input.targetStatus,
            updatedAt: /* @__PURE__ */ new Date()
          }))
        );
        pushAudit("operation.status-change", input.targetStatus, [
          ...prev.rows.map((row) => row.id)
        ]);
        return { ...prev, applied: true };
      }
      if (input.type === "archive-record-cleanup") {
        if (cfg.enableArchiveFileOps) {
          await Promise.all(
            prev.rows.map(
              (row) => ctx.database.remove("chatluna_archive", {
                id: row.id
              })
            )
          );
          pushAudit("operation.archive-cleanup", "missing archives", [
            ...prev.rows.map((row) => row.id)
          ]);
          return { ...prev, applied: true };
        }
        throw new Error("archive file operations disabled");
      }
      if (input.type === "message-repair") {
        if (!cfg.enableMessageRepair) {
          throw new Error("message repair disabled");
        }
        const [conv] = await ctx.database.get(
          "chatluna_conversation",
          { id: input.conversationId }
        );
        const msgs = await getMessageChainRows(ctx, {
          conversationId: input.conversationId
        });
        const rows = msgs.slice().sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt));
        await ctx.database.upsert(
          "chatluna_message",
          rows.map((row, idx) => ({
            id: row.id,
            parentId: idx > 0 ? rows[idx - 1].id : null
          }))
        );
        await ctx.database.upsert("chatluna_conversation", [
          {
            id: conv.id,
            latestMessageId: rows.at(-1)?.id ?? null,
            updatedAt: /* @__PURE__ */ new Date()
          }
        ]);
        pushAudit("operation.message-repair", conv.id, [conv.id]);
        return { ...prev, applied: true };
      }
      throw new Error("unknown operation");
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/summary",
    async () => {
      const data = await overview(ctx, cfg, app);
      return {
        conversations: data.totals.conversations,
        messages: data.totals.messages,
        active: data.totals.active,
        archived: data.totals.archived,
        broken: data.totals.broken,
        models: Object.fromEntries(
          data.models.map((row) => [
            row.model,
            row.count
          ])
        ),
        users: {}
      };
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/scanIntegrity",
    async (input = {}) => scanIntegrity(ctx, cfg, input),
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/repairIntegrity",
    async (input) => {
      if (cfg.readonly) throw new Error("readonly mode enabled");
      return repairIntegrity(ctx, cfg, input);
    },
    { authority: 3 }
  );
  ctx.console.addListener(
    "chatluna-data/getIntegrityField",
    async (input) => getIntegrityField(ctx, input),
    { authority: 3 }
  );
  ctx.on("ready", async () => {
    audits.splice(
      0,
      audits.length,
      ...(await getRows(ctx, "chatluna_data_audit")).sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt)).slice(0, 80).map((row) => ({
        id: row.id,
        action: row.action,
        target: row.target,
        ids: readUserList(row.ids),
        count: row.count,
        detail: row.detail ? JSON.parse(row.detail) : {},
        createdAt: iso(row.createdAt)
      }))
    );
    opsErrors.splice(
      0,
      opsErrors.length,
      ...(await getRows(ctx, "chatluna_data_ops_error")).sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt)).slice(0, 80).map((row) => ({
        id: row.id,
        source: row.source,
        level: row.level,
        logger: row.logger,
        message: row.message,
        createdAt: iso(row.createdAt),
        analysis: row.analysis ? JSON.parse(row.analysis) : {}
      }))
    );
  });
}
function isMinatoLoadError(err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message) return false;
  return message.includes("Unexpected end of JSON input") || message.includes("JSON.parse") || message.includes("SQLiteBuilder.load") || message.includes("SyntaxError") || message.includes("is not iterable");
}
var loadErrors = /* @__PURE__ */ new Map();
function recordLoadError(table, err, sample) {
  const message = err instanceof Error ? err.message : String(err);
  loadErrors.set(table, {
    table,
    message,
    at: (/* @__PURE__ */ new Date()).toISOString(),
    sample
  });
}
async function getRows(ctx, table, query = {}) {
  try {
    const rows = await ctx.database.get(
      table,
      query
    );
    if (Object.keys(query).length === 0) loadErrors.delete(table);
    return rows;
  } catch (err) {
    if (isMinatoLoadError(err)) {
      recordLoadError(table, err, query);
      return [];
    }
    throw err;
  }
}
async function getColumns(ctx, table, fields, query = {}) {
  try {
    return await ctx.database.get(
      table,
      query,
      fields
    );
  } catch (err) {
    if (isMinatoLoadError(err)) {
      recordLoadError(table, err, { fields, query });
      return [];
    }
    throw err;
  }
}
var MESSAGE_LIST_COLUMNS = [
  "id",
  "conversationId",
  "parentId",
  "role",
  "text",
  "name",
  "tool_call_id",
  "tool_calls",
  "rawId",
  "createdAt"
];
async function getMessageRows(ctx, query = {}) {
  try {
    const rows = await ctx.database.get(
      "chatluna_message",
      query,
      MESSAGE_LIST_COLUMNS
    );
    if (Object.keys(query).length === 0) {
      loadErrors.delete("chatluna_message");
    }
    return rows;
  } catch (err) {
    if (isMinatoLoadError(err)) {
      recordLoadError("chatluna_message", err, query);
      return [];
    }
    throw err;
  }
}
async function getMessageChainRows(ctx, query = {}) {
  try {
    return await ctx.database.get(
      "chatluna_message",
      query,
      ["id", "conversationId", "parentId", "createdAt"]
    );
  } catch (err) {
    if (isMinatoLoadError(err)) {
      recordLoadError("chatluna_message", err, query);
      return [];
    }
    throw err;
  }
}
function matchText(query, values) {
  if (!query) return true;
  const text = query.toLowerCase();
  return values.some((value) => String(value ?? "").toLowerCase().includes(text));
}
function paginate(rows, input) {
  const page = Math.max(1, input?.page ?? 1);
  const pageSize = Math.max(1, input?.pageSize ?? 40);
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize
  };
}
function sleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
function invalidatePermissionCache() {
  permissionCache = { expiresAt: 0 };
}
async function getPermissionSnapshot(ctx, cfg) {
  if (permissionCache.data && permissionCache.expiresAt > Date.now()) {
    return permissionCache.data;
  }
  if (permissionCache.task) return permissionCache.task;
  permissionCache.task = buildPermissionSnapshot(ctx, cfg);
  try {
    permissionCache.data = await permissionCache.task;
    permissionCache.expiresAt = Date.now() + 3e4;
    return permissionCache.data;
  } finally {
    permissionCache.task = void 0;
  }
}
async function buildPermissionSnapshot(ctx, cfg) {
  const [users, kBindings, channels, convs, acls, rules, identities] = await Promise.all([
    getColumns(ctx, "user", [
      "id",
      "name",
      "authority",
      "permissions",
      "createdAt"
    ]),
    getColumns(ctx, "binding", [
      "aid",
      "bid",
      "pid",
      "platform"
    ]),
    getColumns(ctx, "channel", [
      "id",
      "platform",
      "guildId",
      "assignee",
      "permissions",
      "createdAt"
    ]),
    getColumns(ctx, "chatluna_conversation", [
      "id",
      "bindingKey",
      "createdBy",
      "createdAt",
      "updatedAt",
      "lastChatAt"
    ]),
    getColumns(ctx, "chatluna_acl", [
      "principalId",
      "principalType",
      "conversationId",
      "permission"
    ]),
    getColumns(ctx, "chatluna_constraint", [
      "createdBy",
      "users",
      "excludeUsers"
    ]),
    getColumns(ctx, "chatluna_data_identity", [
      "platform",
      "id",
      "name",
      "avatar",
      "source",
      "error",
      "updatedAt"
    ])
  ]);
  const userById = new Map(users.map((row) => [row.id, row]));
  const identityByKey = new Map(
    identities.map((row) => [`${row.platform}:${row.id}`, row])
  );
  const bindingsByAid = /* @__PURE__ */ new Map();
  const convCountByPrincipal = /* @__PURE__ */ new Map();
  const lastActiveByPrincipal = /* @__PURE__ */ new Map();
  const aclCountByPrincipal = /* @__PURE__ */ new Map();
  const ruleCountByPrincipal = /* @__PURE__ */ new Map();
  const convCountByGuild = /* @__PURE__ */ new Map();
  for (const row of kBindings) {
    bindingsByAid.set(row.aid, [...bindingsByAid.get(row.aid) ?? [], row]);
  }
  for (const conv of convs) {
    const route = parseBindingKey(conv.bindingKey);
    for (const id of /* @__PURE__ */ new Set([conv.createdBy, route.userId])) {
      if (!id) continue;
      convCountByPrincipal.set(
        id,
        (convCountByPrincipal.get(id) ?? 0) + 1
      );
      const t = conv.lastChatAt ?? conv.updatedAt ?? conv.createdAt;
      if (timeOf(t) > timeOf(lastActiveByPrincipal.get(id))) {
        lastActiveByPrincipal.set(id, t);
      }
    }
    if (route.guildId) {
      convCountByGuild.set(
        route.guildId,
        (convCountByGuild.get(route.guildId) ?? 0) + 1
      );
    }
  }
  for (const acl of acls) {
    aclCountByPrincipal.set(
      acl.principalId,
      (aclCountByPrincipal.get(acl.principalId) ?? 0) + 1
    );
  }
  for (const rule of rules) {
    for (const id of /* @__PURE__ */ new Set([
      rule.createdBy,
      ...readUserList(rule.users),
      ...readUserList(rule.excludeUsers)
    ])) {
      if (!id) continue;
      ruleCountByPrincipal.set(
        id,
        (ruleCountByPrincipal.get(id) ?? 0) + 1
      );
    }
  }
  const userRows = users.map((row) => {
    const refs = bindingsByAid.get(row.id) ?? [];
    const ids = refs.map((item) => item.pid);
    const accounts = refs.map((item) => {
      const cached2 = identityByKey.get(`${item.platform}:${item.pid}`);
      return {
        platform: item.platform,
        id: item.pid,
        name: cached2?.name ?? "",
        source: cached2?.source ?? "",
        error: cached2?.error ?? "",
        updatedAt: iso(cached2?.updatedAt)
      };
    });
    const cached = refs.map((item) => identityByKey.get(`${item.platform}:${item.pid}`)).find((item) => item?.name);
    const display = row.name || cached?.name || ids[0] || `\u7528\u6237 ${row.id}`;
    let last;
    for (const id of ids) {
      const item = lastActiveByPrincipal.get(id);
      if (timeOf(item) > timeOf(last)) last = item;
    }
    const inactiveDays = last ? Math.floor((Date.now() - timeOf(last)) / 864e5) : null;
    const activeLevel = inactiveDays == null ? "unknown" : inactiveDays <= 30 ? "active" : inactiveDays <= cfg.inactiveWarningDays ? "quiet" : "inactive";
    const riskLevel = row.authority >= 4 || activeLevel === "inactive" && row.authority > 0 ? "warning" : refs.length === 0 && row.authority > 0 ? "info" : "normal";
    return {
      id: row.id,
      name: row.name,
      displayName: display,
      nameSource: row.name ? "koishi" : cached?.name ? "cache" : ids.length > 0 ? "binding" : "fallback",
      identitySource: cached?.source ?? "",
      identityUpdatedAt: iso(cached?.updatedAt),
      authority: row.authority,
      permissions: row.permissions ?? [],
      createdAt: iso(row.createdAt),
      lastActiveAt: iso(last),
      inactiveDays,
      activeLevel,
      lastActiveSource: last ? "chatluna_conversation" : "",
      bindings: refs.length,
      platforms: Array.from(new Set(refs.map((item) => item.platform))),
      principals: ids,
      accounts,
      chatlunaConversations: ids.reduce(
        (sum, id) => sum + (convCountByPrincipal.get(id) ?? 0),
        0
      ),
      chatlunaMessages: null,
      conversations: ids.reduce(
        (sum, id) => sum + (convCountByPrincipal.get(id) ?? 0),
        0
      ),
      acl: ids.reduce(
        (sum, id) => sum + (aclCountByPrincipal.get(id) ?? 0),
        0
      ),
      constraints: ids.reduce(
        (sum, id) => sum + (ruleCountByPrincipal.get(id) ?? 0),
        0
      ),
      riskLevel
    };
  });
  const perms = Array.from(
    /* @__PURE__ */ new Set([
      ...ctx.permissions.list(),
      ...users.flatMap((row) => row.permissions ?? []),
      ...channels.flatMap((row) => row.permissions ?? [])
    ])
  ).sort();
  const issues = [
    ...userRows.filter((row) => row.authority >= 4).map((row) => ({
      level: "warning",
      type: "high-authority",
      target: row.displayName,
      message: `\u7528\u6237 authority=${row.authority}`,
      action: "\u786E\u8BA4\u662F\u5426\u4ECD\u9700\u8981\u4FDD\u7559\u9AD8\u6743\u9650\u3002"
    })),
    ...userRows.filter((row) => row.bindings === 0 && row.authority > 0).map((row) => ({
      level: "info",
      type: "user-without-binding",
      target: row.name || String(row.id),
      message: "Koishi \u7528\u6237\u6CA1\u6709\u5E73\u53F0\u8D26\u53F7\u7ED1\u5B9A\u3002",
      action: "\u68C0\u67E5 binding \u8868\uFF0C\u6216\u5C06\u5176\u4F5C\u4E3A\u5386\u53F2\u7528\u6237\u4FDD\u7559\u3002"
    })),
    ...userRows.filter(
      (row) => row.inactiveDays != null && row.inactiveDays >= cfg.inactiveWarningDays && row.authority > 0
    ).map((row) => ({
      level: "warning",
      type: "inactive-user",
      target: row.displayName,
      message: `\u8D85\u8FC7 ${row.inactiveDays} \u5929\u672A\u6D3B\u8DC3\u3002`,
      action: "\u68C0\u67E5\u662F\u5426\u9700\u8981\u964D\u6743\u6216\u79FB\u9664\u7EC6\u7C92\u5EA6\u6743\u9650\u3002"
    })),
    ...kBindings.filter((row) => !userById.has(row.aid)).map((row) => ({
      level: "warning",
      type: "dangling-binding",
      target: `${row.platform}:${row.pid}`,
      message: `\u7ED1\u5B9A\u6307\u5411\u7F3A\u5931 Koishi \u7528\u6237: ${row.aid}`,
      action: "\u68C0\u67E5 binding \u8868\u6216\u6062\u590D\u5BF9\u5E94 user\u3002"
    })),
    ...channels.filter((row) => !row.assignee).map((row) => ({
      level: "info",
      type: "channel-without-assignee",
      target: `${row.platform}:${row.id}`,
      message: "\u9891\u9053\u6CA1\u6709 assignee\u3002",
      action: "\u9700\u8981\u673A\u5668\u4EBA\u4E3B\u52A8\u53D7\u7406\u8BE5\u9891\u9053\u65F6\u586B\u5199 assignee\u3002"
    })),
    ...channels.filter((row) => (row.permissions ?? []).length > 0).map((row) => ({
      level: "info",
      type: "channel-permissions",
      target: `${row.platform}:${row.id}`,
      message: `\u9891\u9053\u6743\u9650: ${(row.permissions ?? []).join(", ")}`,
      action: "\u786E\u8BA4\u8FD9\u4E9B\u9891\u9053\u7EA7\u6743\u9650\u662F\u5426\u4ECD\u7136\u9700\u8981\u3002"
    }))
  ];
  const bindingRows = kBindings.map((row) => {
    const user = userById.get(row.aid);
    return {
      aid: row.aid,
      bid: row.bid,
      pid: row.pid,
      platform: row.platform,
      userName: user?.name ?? "",
      authority: user?.authority ?? 0,
      permissions: user?.permissions ?? []
    };
  }).sort(
    (a, b) => `${a.platform}:${a.pid}`.localeCompare(`${b.platform}:${b.pid}`)
  );
  const channelRows = channels.map((row) => ({
    id: row.id,
    platform: row.platform,
    guildId: row.guildId,
    assignee: row.assignee,
    permissions: row.permissions ?? [],
    createdAt: iso(row.createdAt),
    conversations: convCountByGuild.get(row.id) ?? 0,
    acl: aclCountByPrincipal.get(row.id) ?? 0
  })).sort(
    (a, b) => `${a.platform}:${a.id}`.localeCompare(`${b.platform}:${b.id}`)
  );
  return {
    totals: {
      users: users.length,
      bindings: kBindings.length,
      channels: channels.length,
      acl: acls.length,
      issues: issues.length
    },
    permissions: perms,
    issues,
    users: userRows.sort((a, b) => b.authority - a.authority),
    bindings: bindingRows,
    channels: channelRows
  };
}
async function getPermissionOverviewData(ctx, cfg, input) {
  const snapshot = await getPermissionSnapshot(ctx, cfg);
  const filteredUsers = snapshot.users.filter(
    (row) => matchText(input.query, [
      row.id,
      row.name,
      row.displayName,
      row.permissions.join("\n"),
      row.platforms.join("\n"),
      row.principals.join("\n"),
      row.accounts.map((item) => item.name).join("\n")
    ])
  ).filter((row) => !input.platform || row.platforms.includes(input.platform)).filter(
    (row) => input.inactiveDays == null || row.inactiveDays != null && row.inactiveDays >= input.inactiveDays
  );
  const bindingRows = snapshot.bindings.filter(
    (row) => matchText(input.query, [
      row.aid,
      row.pid,
      row.platform,
      row.userName,
      row.permissions.join("\n")
    ])
  );
  const channelRows = snapshot.channels.filter(
    (row) => matchText(input.query, [
      row.id,
      row.platform,
      row.guildId,
      row.assignee,
      row.permissions.join("\n")
    ])
  );
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? cfg.pageSize;
  return {
    totals: {
      ...snapshot.totals,
      filteredUsers: filteredUsers.length,
      filteredBindings: bindingRows.length,
      filteredChannels: channelRows.length
    },
    permissions: snapshot.permissions,
    issues: snapshot.issues.slice(0, cfg.maxPreviewRows),
    users: filteredUsers.slice((page - 1) * pageSize, page * pageSize),
    userTotal: filteredUsers.length,
    bindings: bindingRows.slice(0, cfg.maxPreviewRows),
    bindingTotal: bindingRows.length,
    channels: channelRows.slice(0, cfg.maxPreviewRows),
    channelTotal: channelRows.length
  };
}
async function previewKoishiPermissionPlan(ctx, cfg, input) {
  const [users, kBindings, channels, convs] = await Promise.all([
    getColumns(ctx, "user", [
      "id",
      "name",
      "authority",
      "permissions"
    ]),
    getColumns(ctx, "binding", [
      "aid",
      "pid",
      "platform"
    ]),
    getColumns(ctx, "channel", [
      "id",
      "platform",
      "guildId",
      "assignee",
      "permissions"
    ]),
    getColumns(ctx, "chatluna_conversation", [
      "bindingKey",
      "createdBy",
      "createdAt",
      "updatedAt",
      "lastChatAt"
    ])
  ]);
  const bindingsByAid = /* @__PURE__ */ new Map();
  const chatUsers = /* @__PURE__ */ new Set();
  const chatGuilds = /* @__PURE__ */ new Set();
  const lastActiveByPrincipal = /* @__PURE__ */ new Map();
  for (const row of kBindings) {
    bindingsByAid.set(row.aid, [
      ...bindingsByAid.get(row.aid) ?? [],
      row
    ]);
  }
  for (const conv of convs) {
    const route = parseBindingKey(conv.bindingKey);
    if (conv.createdBy) chatUsers.add(conv.createdBy);
    if (route.userId) chatUsers.add(route.userId);
    const t = conv.lastChatAt ?? conv.updatedAt ?? conv.createdAt;
    for (const id of /* @__PURE__ */ new Set([conv.createdBy, route.userId])) {
      if (id && timeOf(t) > timeOf(lastActiveByPrincipal.get(id))) {
        lastActiveByPrincipal.set(id, t);
      }
    }
    if (route.guildId) chatGuilds.add(route.guildId);
  }
  const perms = input.permissions ?? [];
  const rows = input.target === "channels" || input.target === "channels-empty" ? channels.filter((row) => !input.platform || row.platform === input.platform).filter(
    (row) => input.target === "channels" || !row.assignee || chatGuilds.has(row.id)
  ).map((row) => {
    const current = row.permissions ?? [];
    const next = input.permissionMode === "replace" ? perms : input.permissionMode === "remove" ? current.filter((item) => !perms.includes(item)) : Array.from(/* @__PURE__ */ new Set([...current, ...perms]));
    return {
      kind: "channel",
      id: row.id,
      platform: row.platform,
      name: row.guildId || row.id,
      reason: row.assignee ? "\u5339\u914D\u9891\u9053\u7B5B\u9009\u6761\u4EF6" : "\u9891\u9053\u672A\u8BBE\u7F6E assignee",
      currentAuthority: null,
      nextAuthority: null,
      currentAssignee: row.assignee,
      nextAssignee: input.assignee ?? row.assignee,
      currentPermissions: current,
      nextPermissions: next
    };
  }) : users.filter((row) => {
    const refs = bindingsByAid.get(row.id) ?? [];
    if (input.platform && !refs.some((item) => item.platform === input.platform)) {
      return false;
    }
    if (input.target === "all-users") return true;
    if (input.target === "bound-users") return refs.length > 0;
    if (input.target === "chatluna-users") {
      return refs.some((item) => chatUsers.has(item.pid));
    }
    if (input.target === "inactive-users") {
      let last;
      for (const ref of refs) {
        const item = lastActiveByPrincipal.get(ref.pid);
        if (timeOf(item) > timeOf(last)) last = item;
      }
      return last != null && Math.floor((Date.now() - timeOf(last)) / 864e5) >= (input.inactiveDays ?? cfg.inactiveWarningDays);
    }
    return row.authority === 0 && (row.permissions ?? []).length === 0;
  }).map((row) => {
    const current = row.permissions ?? [];
    const next = input.permissionMode === "replace" ? perms : input.permissionMode === "remove" ? current.filter((item) => !perms.includes(item)) : Array.from(/* @__PURE__ */ new Set([...current, ...perms]));
    return {
      kind: "user",
      id: row.id,
      platform: (bindingsByAid.get(row.id) ?? []).map((item) => item.platform).join(", ") || "-",
      name: row.name || `\u7528\u6237 ${row.id}`,
      reason: input.target === "chatluna-users" ? "\u5E73\u53F0\u8D26\u53F7\u51FA\u73B0\u5728 ChatLuna \u4F1A\u8BDD\u4E2D" : input.target === "bound-users" ? "\u5B58\u5728\u5E73\u53F0\u8D26\u53F7\u7ED1\u5B9A" : input.target === "unconfigured-users" ? "authority \u4E0E permissions \u5747\u4E3A\u7A7A" : input.target === "inactive-users" ? `\u8D85\u8FC7 ${input.inactiveDays ?? cfg.inactiveWarningDays} \u5929\u672A\u6D3B\u8DC3` : "\u5339\u914D\u5168\u90E8 Koishi \u7528\u6237",
      currentAuthority: row.authority,
      nextAuthority: input.authority == null ? row.authority : input.authority,
      currentAssignee: "",
      nextAssignee: "",
      currentPermissions: current,
      nextPermissions: next
    };
  });
  const changed = rows.filter(
    (row) => row.currentAuthority !== row.nextAuthority || row.currentAssignee !== row.nextAssignee || row.currentPermissions.join("\n") !== row.nextPermissions.join("\n")
  );
  return {
    count: changed.length,
    rows: changed.slice(0, cfg.maxPreviewRows),
    allRows: changed,
    warnings: [
      "\u8FD9\u662F Koishi \u539F\u751F user/channel \u6743\u9650\u6279\u91CF\u4FEE\u6539\u3002",
      "\u8BF7\u5148\u786E\u8BA4\u9884\u89C8\u5BF9\u8C61\uFF0C\u5E94\u7528\u540E\u4F1A\u7ACB\u5373\u5199\u5165\u6570\u636E\u5E93\u3002"
    ]
  };
}
async function findKoishiUser(ctx, target) {
  if (/^\d+$/.test(target)) {
    const [user] = await ctx.database.get("user", { id: Number(target) });
    if (user) return user;
  }
  const [binding] = await ctx.database.get("binding", { pid: target });
  if (binding) {
    const [user] = await ctx.database.get("user", { id: binding.aid });
    if (user) return user;
  }
  const users = await getRows(ctx, "user");
  return users.find((row) => row.name === target) ?? users.find((row) => row.name?.includes(target)) ?? null;
}
async function refreshKoishiIdentity(ctx, input) {
  const bot = ctx.bots.find(
    (row) => row.platform === input.platform && (!input.selfId || row.selfId === input.selfId)
  );
  const payload = {
    platform: input.platform,
    id: input.id,
    name: "",
    avatar: "",
    source: "api",
    error: "",
    updatedAt: /* @__PURE__ */ new Date()
  };
  try {
    const raw = input.guildId ? await bot?.getGuildMember?.(input.guildId, input.id) : await bot?.getUser?.(input.id);
    const user = raw?.user ?? raw;
    payload.name = raw?.nick || raw?.name || user?.nick || user?.name || user?.username || input.id;
    payload.avatar = user?.avatar ?? raw?.avatar ?? "";
  } catch (err) {
    payload.source = "error";
    payload.name = input.id;
    payload.error = err instanceof Error ? err.message : String(err);
  }
  if (!bot) {
    payload.source = "error";
    payload.name = input.id;
    payload.error = `no online bot for platform ${input.platform}`;
  }
  await ctx.database.upsert("chatluna_data_identity", [payload]);
  return { ...payload, updatedAt: iso(payload.updatedAt) };
}
function listKoishiCommands(ctx) {
  const commander = ctx.$commander;
  return (commander?._commandList ?? []).map((row) => ({
    name: row.name,
    displayName: row.displayName ?? row.name,
    permissions: row.config?.permissions ?? [],
    dependencies: row.config?.dependencies ?? [],
    options: Object.values(row._options ?? {}).map((opt) => ({
      name: opt.name,
      permissions: opt.permissions ?? [],
      dependencies: opt.dependencies ?? []
    }))
  })).sort(
    (a, b) => a.name.localeCompare(b.name)
  );
}
async function diagnoseKoishiPermission(ctx, input) {
  const user = await findKoishiUser(ctx, input.target);
  if (!user) {
    return {
      allowed: false,
      status: "missing-user",
      reasons: [`\u627E\u4E0D\u5230\u7528\u6237\uFF1A${input.target}`],
      required: [],
      inherited: [],
      depended: []
    };
  }
  const refs = await getRows(ctx, "binding", {
    aid: user.id
  });
  const first = refs[0];
  const channelQuery = input.channel?.includes(":") ? {
    platform: input.channel.slice(0, input.channel.indexOf(":")),
    id: input.channel.slice(input.channel.indexOf(":") + 1)
  } : { id: input.channel };
  const [channel] = input.channel ? await ctx.database.get("channel", channelQuery) : [];
  const bot = ctx.bots.find(
    (row) => row.platform === (channel?.platform ?? first?.platform)
  );
  const name2 = input.command?.replace(/^command:/, "");
  const required = name2 ? [`command:${name2}`] : ["authority:1"];
  const session = {
    user,
    channel,
    bot,
    platform: channel?.platform ?? first?.platform,
    userId: first?.pid,
    channelId: channel?.id,
    guildId: channel?.guildId,
    selfId: bot?.selfId,
    permissions: []
  };
  const allowed = await ctx.permissions.test(required, session);
  const inherited = Array.from(ctx.permissions.subgraph("inherits", required));
  const depended = Array.from(ctx.permissions.subgraph("depends", required));
  const reasons = [
    `\u7528\u6237 authority=${user.authority}`,
    `\u7528\u6237 permissions=${(user.permissions ?? []).join(", ") || "-"}`,
    `\u5E73\u53F0\u7ED1\u5B9A=${refs.map((row) => `${row.platform}:${row.pid}`).join(", ") || "-"}`,
    `\u9891\u9053=${channel ? `${channel.platform}:${channel.id}` : "-"}`,
    `\u9891\u9053 permissions=${(channel?.permissions ?? []).join(", ") || "-"}`
  ];
  if (channel?.assignee && bot?.selfId && channel.assignee !== bot.selfId) {
    reasons.push(
      `\u9891\u9053 assignee=${channel.assignee}\uFF0C\u5F53\u524D bot=${bot.selfId}\uFF0C\u975E at \u573A\u666F\u53EF\u80FD\u88AB Koishi \u4E2D\u95F4\u4EF6\u62E6\u622A`
    );
  }
  if (input.command) {
    const cmd = listKoishiCommands(ctx).find((row) => row.name === name2);
    reasons.push(
      `\u6307\u4EE4\u6743\u9650=${cmd?.permissions?.join(", ") || "-"}`,
      `\u6307\u4EE4\u4F9D\u8D56=${cmd?.dependencies?.join(", ") || "-"}`
    );
  }
  return {
    allowed,
    status: channel?.assignee && bot?.selfId && channel.assignee !== bot.selfId ? "channel-blocked" : allowed ? "allowed" : "denied",
    reasons,
    required,
    inherited,
    depended
  };
}
async function previewKoishiMaintenance(ctx, cfg, input) {
  if (input.type === "channels-assign") {
    const channels = await getRows(ctx, "channel");
    const rows2 = channels.filter((row) => !input.platform || row.platform === input.platform).filter((row) => !row.assignee).map((row) => ({
      kind: "channel",
      id: row.id,
      platform: row.platform,
      name: row.guildId || row.id,
      reason: "\u9891\u9053\u672A\u8BBE\u7F6E assignee",
      currentAuthority: null,
      nextAuthority: null,
      currentAssignee: row.assignee,
      nextAssignee: input.assignee,
      currentPermissions: row.permissions ?? [],
      nextPermissions: row.permissions ?? []
    }));
    return {
      count: rows2.length,
      rows: rows2.slice(0, cfg.maxPreviewRows),
      allRows: rows2,
      warnings: ["\u5C06\u4E3A\u672A\u8BBE\u7F6E assignee \u7684\u9891\u9053\u5199\u5165\u6307\u5B9A\u53D7\u7406\u4EBA\u3002"]
    };
  }
  const data = await getPermissionOverviewData(ctx, cfg, {
    page: 1,
    pageSize: Number.MAX_SAFE_INTEGER,
    inactiveDays: input.days
  });
  const rows = data.users.map((row) => ({
    kind: "user",
    id: row.id,
    platform: row.platforms.join(", ") || "-",
    name: row.displayName,
    reason: `\u8D85\u8FC7 ${row.inactiveDays} \u5929\u672A\u6D3B\u8DC3`,
    currentAuthority: row.authority,
    nextAuthority: input.authority,
    currentAssignee: "",
    nextAssignee: "",
    currentPermissions: row.permissions,
    nextPermissions: input.permissions
  }));
  return {
    count: rows.length,
    rows: rows.slice(0, cfg.maxPreviewRows),
    allRows: rows,
    warnings: ["\u5C06\u4FEE\u6539\u957F\u671F\u672A\u6D3B\u8DC3\u7528\u6237\u7684 authority \u548C permissions\u3002"]
  };
}
async function overview(ctx, cfg, app) {
  const [convs, msgs, acls, rules, arcs, bindings, metas] = await Promise.all([
    getRows(ctx, "chatluna_conversation"),
    getMessageRows(ctx),
    getRows(ctx, "chatluna_acl"),
    getRows(ctx, "chatluna_constraint"),
    getRows(ctx, "chatluna_archive"),
    getRows(ctx, "chatluna_binding"),
    getRows(ctx, "chatluna_meta")
  ]);
  const models = countBy(convs.map((row) => row.model));
  const users = buildUsers(convs, acls, rules);
  const contexts = buildContexts(convs, bindings, acls, rules, [], [], []);
  const providers = buildProviders(app, convs);
  const resources = buildResources(app, convs, rules);
  const msgBucket = bucketByConversation(msgs);
  const issues = convs.map(
    (row) => diagnoseConversation(row, msgBucket.get(row.id) ?? [], true)
  ).filter((row) => row.issues.length > 0);
  return {
    config: cfg,
    totals: {
      conversations: convs.length,
      messages: msgs.length,
      users: users.length,
      contexts: contexts.length,
      acl: acls.length,
      constraints: rules.length,
      archives: arcs.length,
      bindings: bindings.length,
      meta: metas.length,
      active: convs.filter((row) => row.status === "active").length,
      archived: convs.filter((row) => row.status === "archived").length,
      deleted: convs.filter((row) => row.status === "deleted").length,
      broken: convs.filter((row) => row.status === "broken").length,
      issues: issues.length,
      providers: providers.length,
      resources: resources.length,
      liveModels: providers.reduce((sum, row) => sum + row.models.length, 0)
    },
    models: Object.entries(models).map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count),
    liveModels: liveModels(app),
    providers: providers.slice(0, 8),
    contexts: contexts.slice(0, 8),
    resources: resources.slice(0, 8),
    runtime: {
      connected: app.chatluna != null,
      tools: Object.keys(app.chatluna?.platform?._tools ?? {}).length,
      chatChains: Object.keys(app.chatluna?.platform?._chatChains ?? {}).length,
      vectorStores: Object.keys(app.chatluna?.platform?._vectorStore ?? {}).length,
      presets: app.chatluna?.preset?._presets?.value?.length ?? 0,
      presetDir: app.chatluna?.preset?.resolvePresetDir?.() ?? "",
      defaults: {
        model: app.chatluna?.currentConfig?.defaultModel ?? app.chatluna?.config?.defaultModel ?? "",
        preset: app.chatluna?.currentConfig?.defaultPreset ?? app.chatluna?.config?.defaultPreset ?? "",
        chatMode: app.chatluna?.currentConfig?.defaultChatMode ?? app.chatluna?.config?.defaultChatMode ?? "",
        embeddings: app.chatluna?.currentConfig?.defaultEmbeddings ?? app.chatluna?.config?.defaultEmbeddings ?? "",
        vectorStore: app.chatluna?.currentConfig?.defaultVectorStore ?? app.chatluna?.config?.defaultVectorStore ?? "",
        groupRoute: app.chatluna?.currentConfig?.defaultGroupRouteMode ?? app.chatluna?.config?.defaultGroupRouteMode ?? ""
      }
    },
    recent: convs.slice().sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt)).slice(0, 8).map((row) => viewConversation(row)),
    issues: issues.slice(0, 8),
    audits,
    loadErrors: Array.from(loadErrors.values())
  };
}
async function health(ctx, cfg, app) {
  const [convs, msgs, bindings, acls, rules, arcs] = await Promise.all([
    getRows(ctx, "chatluna_conversation"),
    getMessageRows(ctx),
    getRows(ctx, "chatluna_binding"),
    getRows(ctx, "chatluna_acl"),
    getRows(ctx, "chatluna_constraint"),
    getRows(ctx, "chatluna_archive")
  ]);
  const issues = [];
  const convIds = new Set(convs.map((row) => row.id));
  const modelNames = new Set(liveModels(app));
  const chainNames = new Set(
    Object.keys(app.chatluna?.platform?._chatChains ?? {})
  );
  const presetNames = new Set(
    (app.chatluna?.preset?._presets?.value ?? []).flatMap(
      (row) => row.triggerKeyword ?? []
    )
  );
  const msgBucket = bucketByConversation(msgs);
  for (const conv of convs) {
    const diag = diagnoseConversation(
      conv,
      msgBucket.get(conv.id) ?? [],
      true
    );
    for (const issue of diag.issues) {
      issues.push({
        type: "message-chain",
        level: issue.type === "orphan" ? "warning" : "danger",
        target: conv.id,
        message: issue.message,
        action: "\u6253\u5F00\u6D88\u606F\u9875\u68C0\u67E5\u94FE\u8DEF\uFF0C\u5FC5\u8981\u65F6\u542F\u7528\u6D88\u606F\u4FEE\u590D\u540E\u9884\u89C8\u6267\u884C\u3002"
      });
    }
    if (modelNames.size > 0 && !modelNames.has(conv.model)) {
      issues.push({
        type: "missing-model",
        level: "warning",
        target: conv.id,
        message: `\u4F1A\u8BDD\u6A21\u578B\u672A\u5728\u8FD0\u884C\u65F6\u6A21\u578B\u5217\u8868\u4E2D: ${conv.model}`,
        action: "\u68C0\u67E5 provider \u662F\u5426\u52A0\u8F7D\uFF0C\u6216\u6279\u91CF\u8FC1\u79FB\u5230\u53EF\u7528\u6A21\u578B\u3002"
      });
    }
    if (chainNames.size > 0 && !chainNames.has(conv.chatMode)) {
      issues.push({
        type: "missing-chat-chain",
        level: "warning",
        target: conv.id,
        message: `\u4F1A\u8BDD chatMode \u672A\u6CE8\u518C: ${conv.chatMode}`,
        action: "\u68C0\u67E5 ChatLuna \u6269\u5C55\u6216\u4FEE\u6539\u4F1A\u8BDD chatMode\u3002"
      });
    }
    if (presetNames.size > 0 && !presetNames.has(conv.preset)) {
      issues.push({
        type: "missing-preset",
        level: "warning",
        target: conv.id,
        message: `\u4F1A\u8BDD preset \u672A\u52A0\u8F7D: ${conv.preset}`,
        action: "\u68C0\u67E5 preset \u6587\u4EF6\u6216\u4FEE\u6539\u4F1A\u8BDD preset\u3002"
      });
    }
  }
  for (const binding of bindings) {
    if (binding.activeConversationId && !convIds.has(binding.activeConversationId)) {
      issues.push({
        type: "dangling-binding",
        level: "danger",
        target: binding.bindingKey,
        message: `activeConversationId \u6307\u5411\u7F3A\u5931\u4F1A\u8BDD: ${binding.activeConversationId}`,
        action: "\u5207\u6362\u6216\u6E05\u7406\u8BE5 binding \u7684\u6D3B\u8DC3\u4F1A\u8BDD\u3002"
      });
    }
    if (binding.lastConversationId && !convIds.has(binding.lastConversationId)) {
      issues.push({
        type: "dangling-binding",
        level: "warning",
        target: binding.bindingKey,
        message: `lastConversationId \u6307\u5411\u7F3A\u5931\u4F1A\u8BDD: ${binding.lastConversationId}`,
        action: "\u68C0\u67E5\u5386\u53F2 binding \u8BB0\u5F55\u3002"
      });
    }
  }
  for (const acl of acls) {
    if (!convIds.has(acl.conversationId)) {
      issues.push({
        type: "dangling-acl",
        level: "warning",
        target: acl.conversationId,
        message: `ACL \u6307\u5411\u7F3A\u5931\u4F1A\u8BDD: ${acl.principalType}/${acl.principalId}`,
        action: "\u5220\u9664\u60AC\u7A7A ACL \u6216\u6062\u590D\u5BF9\u5E94\u4F1A\u8BDD\u3002"
      });
    }
  }
  for (const rule of rules) {
    for (const model of [rule.defaultModel, rule.fixedModel]) {
      if (model && modelNames.size > 0 && !modelNames.has(model)) {
        issues.push({
          type: "rule-missing-model",
          level: "warning",
          target: rule.name,
          message: `\u89C4\u5219\u5F15\u7528\u672A\u52A0\u8F7D\u6A21\u578B: ${model}`,
          action: "\u66F4\u65B0\u89C4\u5219\u6A21\u578B\u6216\u68C0\u67E5 provider\u3002"
        });
      }
    }
    for (const mode of [rule.defaultChatMode, rule.fixedChatMode]) {
      if (mode && chainNames.size > 0 && !chainNames.has(mode)) {
        issues.push({
          type: "rule-missing-chat-chain",
          level: "warning",
          target: rule.name,
          message: `\u89C4\u5219\u5F15\u7528\u672A\u6CE8\u518C chatMode: ${mode}`,
          action: "\u66F4\u65B0\u89C4\u5219 chatMode \u6216\u542F\u7528\u5BF9\u5E94\u6269\u5C55\u3002"
        });
      }
    }
    for (const preset of [rule.defaultPreset, rule.fixedPreset]) {
      if (preset && presetNames.size > 0 && !presetNames.has(preset)) {
        issues.push({
          type: "rule-missing-preset",
          level: "warning",
          target: rule.name,
          message: `\u89C4\u5219\u5F15\u7528\u672A\u52A0\u8F7D preset: ${preset}`,
          action: "\u66F4\u65B0\u89C4\u5219 preset \u6216\u68C0\u67E5 preset \u6587\u4EF6\u3002"
        });
      }
    }
  }
  if (cfg.enableArchiveFileOps) {
    for (const arc of await Promise.all(
      arcs.map((row) => viewArchive(row, cfg))
    )) {
      if (arc.fileState === "missing") {
        issues.push({
          type: "archive-missing-file",
          level: "warning",
          target: arc.id,
          message: `\u5F52\u6863\u6587\u4EF6\u7F3A\u5931: ${arc.path}`,
          action: "\u5728\u64CD\u4F5C\u9875\u9884\u89C8\u5F52\u6863\u6E05\u7406\uFF0C\u6216\u6062\u590D\u6587\u4EF6\u3002"
        });
      }
    }
  }
  return {
    score: Math.max(0, 100 - issues.length * 5),
    totals: {
      danger: issues.filter((row) => row.level === "danger").length,
      warning: issues.filter((row) => row.level === "warning").length,
      info: issues.filter((row) => row.level === "info").length
    },
    rows: issues.slice(0, cfg.maxPreviewRows)
  };
}
async function modelHealth(ctx, cfg, app, input) {
  const [convs, rules, bindings, acls, arcs] = await Promise.all([
    getRows(ctx, "chatluna_conversation"),
    getRows(ctx, "chatluna_constraint"),
    getRows(ctx, "chatluna_binding"),
    getRows(ctx, "chatluna_acl"),
    getRows(ctx, "chatluna_archive")
  ]);
  const providers = buildProviders(app, convs);
  const resources = buildResources(app, convs, rules);
  const live = liveModels(app);
  const liveSet = new Set(live);
  const chainSet = new Set(Object.keys(app.chatluna?.platform?._chatChains ?? {}));
  const presetSet = new Set(
    (app.chatluna?.preset?._presets?.value ?? []).flatMap(
      (row) => row.triggerKeyword ?? []
    )
  );
  const fork = findChatLunaFork(ctx);
  const cfgSource = fork?.fork.config ?? app.chatluna?.currentConfig ?? app.chatluna?.config ?? {};
  const refs = [];
  for (const conv of convs) {
    refs.push({
      kind: "conversation",
      id: conv.id,
      title: conv.title || conv.id,
      field: "model",
      model: conv.model,
      status: conv.status,
      platform: conv.model.includes("/") ? conv.model.slice(0, conv.model.indexOf("/")) : "",
      valid: liveSet.size === 0 || liveSet.has(conv.model),
      updatedAt: iso(conv.updatedAt)
    });
  }
  for (const rule of rules) {
    for (const field of ["defaultModel", "fixedModel"]) {
      const model = rule[field];
      if (!model) continue;
      refs.push({
        kind: "constraint",
        id: String(rule.id),
        title: rule.name || String(rule.id),
        field,
        model,
        status: rule.enabled ? "enabled" : "disabled",
        platform: model.includes("/") ? model.slice(0, model.indexOf("/")) : "",
        valid: liveSet.size === 0 || liveSet.has(model),
        updatedAt: iso(rule.updatedAt)
      });
    }
  }
  if (cfgSource.defaultModel) {
    refs.push({
      kind: "config",
      id: "defaultModel",
      title: "ChatLuna \u9ED8\u8BA4\u6A21\u578B",
      field: "defaultModel",
      model: cfgSource.defaultModel,
      status: fork?.key ?? "runtime",
      platform: cfgSource.defaultModel.includes("/") ? cfgSource.defaultModel.slice(
        0,
        cfgSource.defaultModel.indexOf("/")
      ) : "",
      valid: liveSet.size === 0 || liveSet.has(cfgSource.defaultModel),
      updatedAt: ""
    });
  }
  const convIds = new Set(convs.map((row) => row.id));
  const issues = [];
  for (const row of providers) {
    if (row.state === "database-only") {
      issues.push({
        type: "database-only-provider",
        level: "warning",
        target: row.platform,
        platform: row.platform,
        message: "\u6570\u636E\u5E93\u4E2D\u5B58\u5728\u8BE5\u5E73\u53F0\u6A21\u578B\u5F15\u7528\uFF0C\u4F46\u8FD0\u884C\u65F6\u672A\u6CE8\u518C provider\u3002",
        action: "\u5B89\u88C5\u6216\u542F\u7528\u5BF9\u5E94 adapter\uFF0C\u6216\u8FC1\u79FB\u8FD9\u4E9B\u4F1A\u8BDD\u6A21\u578B\u3002"
      });
    }
    if (row.configCount > 0 && row.availableConfigCount === 0) {
      issues.push({
        type: "provider-no-config",
        level: "danger",
        target: row.platform,
        platform: row.platform,
        message: "provider \u5DF2\u6CE8\u518C\u4F46\u6CA1\u6709\u53EF\u7528\u914D\u7F6E\u3002",
        action: "\u68C0\u67E5 adapter \u914D\u7F6E\u6216\u5237\u65B0 provider\u3002"
      });
    }
  }
  for (const ref of refs.filter((row) => !row.valid)) {
    issues.push({
      type: "missing-model",
      level: "warning",
      target: ref.id,
      platform: ref.platform,
      message: `${ref.kind}.${ref.field} \u5F15\u7528\u672A\u52A0\u8F7D\u6A21\u578B: ${ref.model}`,
      action: "\u9009\u62E9\u53EF\u7528\u6A21\u578B\u540E\u9884\u89C8\u8FC1\u79FB\u3002"
    });
  }
  for (const conv of convs) {
    const platform = conv.model.includes("/") ? conv.model.slice(0, conv.model.indexOf("/")) : "";
    if (chainSet.size > 0 && !chainSet.has(conv.chatMode)) {
      issues.push({
        type: "missing-chat-chain",
        level: "warning",
        target: conv.id,
        platform,
        message: `\u4F1A\u8BDD chatMode \u672A\u6CE8\u518C: ${conv.chatMode}`,
        action: "\u542F\u7528\u5BF9\u5E94\u6269\u5C55\u6216\u4FEE\u6539\u4F1A\u8BDD chatMode\u3002"
      });
    }
    if (presetSet.size > 0 && !presetSet.has(conv.preset)) {
      issues.push({
        type: "missing-preset",
        level: "warning",
        target: conv.id,
        platform,
        message: `\u4F1A\u8BDD preset \u672A\u52A0\u8F7D: ${conv.preset}`,
        action: "\u68C0\u67E5 preset \u6587\u4EF6\u6216\u4FEE\u6539\u4F1A\u8BDD preset\u3002"
      });
    }
  }
  for (const rule of rules) {
    for (const mode of [rule.defaultChatMode, rule.fixedChatMode]) {
      if (mode && chainSet.size > 0 && !chainSet.has(mode)) {
        issues.push({
          type: "missing-chat-chain",
          level: "warning",
          target: rule.name,
          platform: "",
          message: `\u89C4\u5219\u5F15\u7528\u672A\u6CE8\u518C chatMode: ${mode}`,
          action: "\u66F4\u65B0\u89C4\u5219 chatMode \u6216\u542F\u7528\u5BF9\u5E94\u6269\u5C55\u3002"
        });
      }
    }
    for (const preset of [rule.defaultPreset, rule.fixedPreset]) {
      if (preset && presetSet.size > 0 && !presetSet.has(preset)) {
        issues.push({
          type: "missing-preset",
          level: "warning",
          target: rule.name,
          platform: "",
          message: `\u89C4\u5219\u5F15\u7528\u672A\u52A0\u8F7D preset: ${preset}`,
          action: "\u66F4\u65B0\u89C4\u5219 preset \u6216\u68C0\u67E5 preset \u6587\u4EF6\u3002"
        });
      }
    }
  }
  for (const binding of bindings) {
    if (binding.activeConversationId && !convIds.has(binding.activeConversationId)) {
      issues.push({
        type: "dangling-binding",
        level: "danger",
        target: binding.bindingKey,
        platform: "",
        message: `activeConversationId \u6307\u5411\u7F3A\u5931\u4F1A\u8BDD: ${binding.activeConversationId}`,
        action: "\u5207\u6362\u6216\u6E05\u7406\u8BE5 binding \u7684\u6D3B\u8DC3\u4F1A\u8BDD\u3002"
      });
    }
  }
  for (const acl of acls) {
    if (!convIds.has(acl.conversationId)) {
      issues.push({
        type: "dangling-acl",
        level: "warning",
        target: acl.conversationId,
        platform: "",
        message: `ACL \u6307\u5411\u7F3A\u5931\u4F1A\u8BDD: ${acl.principalType}/${acl.principalId}`,
        action: "\u5220\u9664\u60AC\u7A7A ACL \u6216\u6062\u590D\u5BF9\u5E94\u4F1A\u8BDD\u3002"
      });
    }
  }
  if (cfg.enableArchiveFileOps) {
    for (const arc of await Promise.all(
      arcs.map((row) => viewArchive(row, cfg))
    )) {
      if (arc.fileState === "missing") {
        issues.push({
          type: "archive-missing-file",
          level: "warning",
          target: arc.id,
          platform: "",
          message: `\u5F52\u6863\u6587\u4EF6\u7F3A\u5931: ${arc.path}`,
          action: "\u5728\u7EF4\u62A4\u9875\u9884\u89C8\u5F52\u6863\u6E05\u7406\uFF0C\u6216\u6062\u590D\u6587\u4EF6\u3002"
        });
      }
    }
  }
  const q = input.query?.trim().toLowerCase() ?? "";
  const filteredProviders = providers.map((row) => ({
    ...row,
    riskCount: issues.filter(
      (issue) => issue.platform === row.platform || issue.target === row.platform
    ).length
  })).filter((row) => {
    if (input.platform && row.platform !== input.platform) return false;
    if (!q) return true;
    return [
      row.platform,
      row.state,
      row.capabilities.join("\n"),
      row.models.map((model) => model.name).join("\n")
    ].join("\n").toLowerCase().includes(q);
  });
  const filteredIssues = issues.filter((row) => {
    if (input.platform && row.platform && row.platform !== input.platform) {
      return false;
    }
    if (input.issueType && row.type !== input.issueType) return false;
    if (!q) return true;
    return [row.type, row.target, row.message, row.action, row.platform].join("\n").toLowerCase().includes(q);
  });
  const groups = Object.values(
    filteredIssues.reduce(
      (map, row) => {
        map[row.type] ??= {
          type: row.type,
          label: issueTypeText(row.type),
          level: row.level,
          count: 0,
          action: row.action,
          rows: []
        };
        map[row.type].count += 1;
        map[row.type].rows.push(row);
        if (row.level === "danger") map[row.type].level = "danger";
        return map;
      },
      {}
    )
  ).sort((a, b) => b.count - a.count);
  const configTotal = providers.reduce((sum, row) => sum + row.configCount, 0);
  const configAvailable = providers.reduce(
    (sum, row) => sum + row.availableConfigCount,
    0
  );
  return {
    summary: {
      score: Math.max(
        0,
        100 - issues.filter((row) => row.level === "danger").length * 10 - issues.filter((row) => row.level === "warning").length * 5 - issues.filter((row) => row.level === "info").length * 2
      ),
      loadedProviders: providers.filter((row) => row.state === "loaded").length,
      registeredProviders: providers.filter(
        (row) => row.state === "registered"
      ).length,
      databaseOnlyProviders: providers.filter(
        (row) => row.state === "database-only"
      ).length,
      configAvailable,
      configTotal,
      missingModelRefs: refs.filter((row) => !row.valid).length,
      missingPresetRefs: issues.filter((row) => row.type === "missing-preset").length,
      missingChatModeRefs: issues.filter(
        (row) => row.type === "missing-chat-chain"
      ).length,
      issues: issues.length
    },
    providers: filteredProviders,
    issues: filteredIssues.slice(0, cfg.maxPreviewRows),
    issueGroups: groups,
    modelRefs: refs.filter((row) => {
      if (input.platform && row.platform !== input.platform) return false;
      if (!q) return true;
      return [row.kind, row.title, row.field, row.model, row.status].join("\n").toLowerCase().includes(q);
    }),
    resources,
    choices: {
      models: live,
      providers: providers.map((row) => row.platform).sort(),
      issueTypes: Array.from(new Set(issues.map((row) => row.type))).sort()
    }
  };
}
function pageRows(rows, input, text, sort, cfg) {
  const q = (input.query ?? "").trim().toLowerCase();
  const page = Math.max(1, Number(input.page ?? 1));
  const pageSize = Math.max(10, Number(input.pageSize ?? cfg.pageSize));
  const filtered = rows.filter((row) => !q || text(row).toLowerCase().includes(q)).sort(sort);
  const start = (page - 1) * pageSize;
  return {
    page,
    pageSize,
    total: filtered.length,
    rows: filtered.slice(start, start + pageSize)
  };
}
function viewConversation(row) {
  return {
    id: row.id,
    seq: row.seq ?? null,
    bindingKey: row.bindingKey,
    title: row.title,
    model: row.model,
    preset: row.preset,
    chatMode: row.chatMode,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    lastChatAt: iso(row.lastChatAt),
    status: row.status,
    latestMessageId: row.latestMessageId ?? null,
    compression: row.compression ?? null,
    archivedAt: iso(row.archivedAt),
    archiveId: row.archiveId ?? null,
    legacyRoomId: row.legacyRoomId ?? null,
    autoTitle: row.autoTitle ?? null
  };
}
async function viewMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    parentId: row.parentId ?? null,
    role: row.role,
    text: await readMessageText(row),
    name: row.name ?? "",
    toolCallId: row.tool_call_id ?? "",
    rawId: row.rawId ?? "",
    createdAt: iso(row.createdAt)
  };
}
function viewConstraint(row) {
  return {
    ...row,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    users: row.users ?? [],
    excludeUsers: row.excludeUsers ?? []
  };
}
async function viewArchive(row, cfg) {
  if (!cfg.enableArchiveFileOps) {
    return {
      ...row,
      createdAt: iso(row.createdAt),
      restoredAt: iso(row.restoredAt),
      fileState: "disabled",
      fileSize: null
    };
  }
  try {
    await access(row.path, constants.R_OK);
    return {
      ...row,
      createdAt: iso(row.createdAt),
      restoredAt: iso(row.restoredAt),
      fileState: "ok",
      fileSize: (await stat(row.path)).size
    };
  } catch {
    return {
      ...row,
      createdAt: iso(row.createdAt),
      restoredAt: iso(row.restoredAt),
      fileState: "missing",
      fileSize: null
    };
  }
}
function bucketByConversation(messages) {
  const map = /* @__PURE__ */ new Map();
  for (const row of messages) {
    const key = row.conversationId;
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}
function diagnoseConversation(conv, messages, preFiltered = false) {
  const rows = preFiltered ? messages : messages.filter((row) => row.conversationId === conv.id);
  const map = new Map(rows.map((row) => [row.id, row]));
  const chain = [];
  const seen = /* @__PURE__ */ new Set();
  const issues = [];
  let id = conv.latestMessageId;
  if (rows.length > 0 && !id) {
    issues.push({ type: "missing-latest", message: "latestMessageId \u7F3A\u5931" });
  }
  while (id) {
    if (seen.has(id)) {
      issues.push({ type: "loop", message: `\u6D88\u606F\u94FE\u5FAA\u73AF: ${id}` });
      break;
    }
    const row = map.get(id);
    if (!row) {
      issues.push({ type: "broken-link", message: `\u627E\u4E0D\u5230\u6D88\u606F: ${id}` });
      break;
    }
    seen.add(id);
    chain.unshift(row);
    id = row.parentId;
  }
  const loose = rows.filter((row) => !seen.has(row.id));
  if (loose.length > 0) {
    issues.push({
      type: "orphan",
      message: `${loose.length} \u6761\u6D88\u606F\u4E0D\u5728 latestMessageId \u94FE\u8DEF\u4E2D`
    });
  }
  return {
    conversationId: conv.id,
    title: conv.title,
    status: conv.status,
    latestMessageId: conv.latestMessageId ?? null,
    messageCount: rows.length,
    chainCount: chain.length,
    orphanCount: loose.length,
    issues,
    rows: [...chain, ...loose]
  };
}
function buildUsers(convs, acls, rules) {
  const map = /* @__PURE__ */ new Map();
  for (const row of convs) {
    const userId = row.createdBy || row.bindingKey;
    const item = map.get(userId) ?? {
      userId,
      guildId: "",
      bindingKeys: [],
      conversations: 0,
      active: 0,
      archived: 0,
      acl: 0,
      constraints: 0,
      latestConversationId: "",
      latestTitle: "",
      updatedAt: "",
      models: {}
    };
    item.conversations += 1;
    item.active += row.status === "active" ? 1 : 0;
    item.archived += row.status === "archived" ? 1 : 0;
    item.models[row.model] = (item.models[row.model] ?? 0) + 1;
    if (!item.bindingKeys.includes(row.bindingKey)) {
      item.bindingKeys.push(row.bindingKey);
    }
    if (timeOf(row.updatedAt) >= timeOf(item.updatedAt)) {
      item.updatedAt = iso(row.updatedAt);
      item.latestConversationId = row.id;
      item.latestTitle = row.title;
    }
    map.set(userId, item);
  }
  for (const row of acls) {
    const item = map.get(row.principalId);
    if (item) item.acl += 1;
  }
  for (const row of rules) {
    for (const user of [
      row.createdBy,
      ...readUserList(row.users),
      ...readUserList(row.excludeUsers)
    ]) {
      if (user && map.has(user)) map.get(user).constraints += 1;
    }
  }
  return Array.from(map.values());
}
function buildContexts(convs, bindings, acls, rules, users, kBindings, channels) {
  const map = /* @__PURE__ */ new Map();
  for (const conv of convs) {
    const parsed = parseBindingKey(conv.bindingKey);
    const row = map.get(conv.bindingKey) ?? {
      bindingKey: conv.bindingKey,
      baseKey: parsed.baseKey,
      routeMode: parsed.routeMode,
      presetLane: parsed.presetLane,
      platform: parsed.platform,
      selfId: parsed.selfId,
      scope: parsed.scope,
      guildId: parsed.guildId,
      userId: parsed.userId,
      conversations: 0,
      active: 0,
      archived: 0,
      deleted: 0,
      broken: 0,
      acl: 0,
      constraints: 0,
      models: {},
      activeConversationId: "",
      lastConversationId: "",
      latestConversationId: "",
      latestTitle: "",
      updatedAt: "",
      koishiUserId: null,
      koishiUserName: "",
      koishiUserAuthority: null,
      koishiUserPermissions: [],
      koishiBindingCount: 0,
      channelAssignee: "",
      channelPermissions: []
    };
    row.conversations += 1;
    row.active += conv.status === "active" ? 1 : 0;
    row.archived += conv.status === "archived" ? 1 : 0;
    row.deleted += conv.status === "deleted" ? 1 : 0;
    row.broken += conv.status === "broken" ? 1 : 0;
    row.models[conv.model] = (row.models[conv.model] ?? 0) + 1;
    if (timeOf(conv.updatedAt) >= timeOf(row.updatedAt)) {
      row.updatedAt = iso(conv.updatedAt);
      row.latestConversationId = conv.id;
      row.latestTitle = conv.title;
    }
    map.set(conv.bindingKey, row);
  }
  for (const binding of bindings) {
    const row = map.get(binding.bindingKey);
    if (!row) continue;
    row.activeConversationId = binding.activeConversationId ?? "";
    row.lastConversationId = binding.lastConversationId ?? "";
  }
  const ctxByLatestConvId = /* @__PURE__ */ new Map();
  for (const row of map.values()) {
    if (row.latestConversationId) {
      ctxByLatestConvId.set(row.latestConversationId, row);
    }
  }
  for (const acl of acls) {
    const row = ctxByLatestConvId.get(acl.conversationId);
    if (row) row.acl += 1;
  }
  for (const rule of rules) {
    const ruleUsers = readUserList(rule.users);
    const ruleExcludes = readUserList(rule.excludeUsers);
    for (const row of map.values()) {
      const byPlatform = rule.platform == null || rule.platform === row.platform;
      const bySelf = rule.selfId == null || rule.selfId === row.selfId;
      const byGuild = rule.guildId == null || rule.guildId === row.guildId;
      const byUser = ruleUsers.length === 0 || ruleUsers.includes(row.userId);
      const excluded = ruleExcludes.includes(row.userId);
      if (byPlatform && bySelf && byGuild && byUser && !excluded) {
        row.constraints += 1;
      }
    }
  }
  const bindingByPidKey = /* @__PURE__ */ new Map();
  for (const item of kBindings) {
    const key = `${item.platform}:${item.pid}`;
    const list = bindingByPidKey.get(key);
    if (list) list.push(item);
    else bindingByPidKey.set(key, [item]);
  }
  const userById = new Map(users.map((item) => [item.id, item]));
  const channelByGuild = /* @__PURE__ */ new Map();
  for (const item of channels) {
    if (item.guildId) {
      channelByGuild.set(`${item.platform}:${item.guildId}`, item);
    }
    if (item.id) {
      const key = `${item.platform}:${item.id}`;
      if (!channelByGuild.has(key)) channelByGuild.set(key, item);
    }
  }
  for (const row of map.values()) {
    const refs = bindingByPidKey.get(`${row.platform}:${row.userId}`) ?? [];
    row.koishiBindingCount = refs.length;
    let user;
    for (const ref of refs) {
      user = userById.get(ref.aid);
      if (user) break;
    }
    if (user) {
      row.koishiUserId = user.id;
      row.koishiUserName = user.name;
      row.koishiUserAuthority = user.authority;
      row.koishiUserPermissions = user.permissions ?? [];
    }
    const channel = channelByGuild.get(`${row.platform}:${row.guildId}`);
    if (channel) {
      row.channelAssignee = channel.assignee;
      row.channelPermissions = channel.permissions ?? [];
    }
  }
  return Array.from(map.values());
}
function buildProviders(app, convs) {
  const service = app.chatluna?.platform;
  const names = /* @__PURE__ */ new Set([
    ...Object.keys(service?._createClientFunctions ?? {}),
    ...Object.keys(service?._platformClients ?? {}),
    ...Object.keys(service?._models ?? {})
  ]);
  for (const row of convs) {
    const idx = row.model.indexOf("/");
    if (idx > 0) names.add(row.model.slice(0, idx));
  }
  return Array.from(names).map((platform) => {
    const client = service?._platformClients?.[platform];
    const plugin = app.chatluna?.getPlugin?.(platform);
    const models = (service?._models?.[platform] ?? []).map((model) => ({
      name: model.name,
      type: model.type,
      typeText: modelTypeText(model.type),
      maxTokens: model.maxTokens ?? 0,
      capabilities: model.capabilities ?? []
    }));
    const rows = convs.filter(
      (row) => row.model.startsWith(`${platform}/`)
    );
    const configs = client?.configPool?.getConfigs?.() ?? plugin?.platformConfigPool?.getConfigs?.() ?? [];
    const caps = Array.from(
      new Set(models.flatMap((model) => model.capabilities))
    ).sort();
    const tokens = models.map((model) => model.maxTokens).filter((value) => value > 0);
    const files = client?.getFileHandlingConfig?.();
    return {
      platform,
      registered: service?._createClientFunctions?.[platform] != null,
      loaded: client != null,
      pluginInstalled: plugin != null,
      state: client ? "loaded" : service?._createClientFunctions?.[platform] ? "registered" : "database-only",
      configCount: configs.length,
      availableConfigCount: configs.filter((row) => row.isAvailable).length,
      modelCount: models.length,
      llmCount: models.filter((model) => model.type === 1).length,
      embeddingsCount: models.filter((model) => model.type === 2).length,
      rerankerCount: models.filter((model) => model.type === 3).length,
      capabilities: caps,
      maxTokensMin: tokens.length > 0 ? Math.min(...tokens) : 0,
      maxTokensMax: tokens.length > 0 ? Math.max(...tokens) : 0,
      fileHandling: files ? {
        supportedMimeTypes: Array.from(files.supportedMimeTypes),
        maxTotalSizeBytes: files.maxTotalSizeBytes,
        maxFileSizeBytes: files.maxFileSizeBytes,
        maxFileSizeBytesOverrides: files.maxFileSizeBytesOverrides ?? {}
      } : null,
      conversations: rows.length,
      activeConversations: rows.filter((row) => row.status === "active").length,
      archivedConversations: rows.filter(
        (row) => row.status === "archived"
      ).length,
      models,
      recent: rows.slice().sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt)).slice(0, 8).map((row) => viewConversation(row))
    };
  });
}
function buildResources(app, convs, rules) {
  const result = [];
  for (const [name2, tool] of Object.entries(
    app.chatluna?.platform?._tools ?? {}
  )) {
    result.push({
      type: "tool",
      name: name2,
      description: tool.description ?? "",
      source: tool.meta?.source ?? "",
      group: tool.meta?.group ?? "",
      tags: tool.meta?.tags ?? [],
      usedByConversations: 0,
      usedByRules: 0,
      path: "",
      details: {
        mcp: tool.meta?.isMcp === true,
        serverName: tool.meta?.serverName ?? "",
        defaultAvailability: tool.meta?.defaultAvailability ?? {}
      }
    });
  }
  for (const [name2, chain] of Object.entries(
    app.chatluna?.platform?._chatChains ?? {}
  )) {
    result.push({
      type: "chat-chain",
      name: name2,
      description: JSON.stringify(chain.description ?? {}),
      source: "",
      group: "",
      tags: [],
      usedByConversations: convs.filter((row) => row.chatMode === name2).length,
      usedByRules: rules.filter(
        (row) => row.defaultChatMode === name2 || row.fixedChatMode === name2
      ).length,
      path: "",
      details: chain.description ?? {}
    });
  }
  for (const name2 of Object.keys(app.chatluna?.platform?._vectorStore ?? {})) {
    result.push({
      type: "vector-store",
      name: name2,
      description: "",
      source: "",
      group: "",
      tags: [],
      usedByConversations: 0,
      usedByRules: 0,
      path: "",
      details: {}
    });
  }
  for (const preset of app.chatluna?.preset?._presets?.value ?? []) {
    const name2 = preset.triggerKeyword?.[0] ?? preset.path ?? "";
    result.push({
      type: "preset",
      name: name2,
      description: preset.rawText?.slice(0, 180) ?? "",
      source: "",
      group: "",
      tags: preset.triggerKeyword ?? [],
      usedByConversations: convs.filter(
        (row) => preset.triggerKeyword?.includes(row.preset)
      ).length,
      usedByRules: rules.filter(
        (row) => preset.triggerKeyword?.includes(row.defaultPreset ?? "") || preset.triggerKeyword?.includes(row.fixedPreset ?? "")
      ).length,
      path: preset.path ?? "",
      details: {
        keywords: preset.triggerKeyword ?? [],
        messages: preset.messages?.length ?? 0,
        presetDir: app.chatluna?.preset?.resolvePresetDir?.() ?? ""
      }
    });
  }
  const cfg = app.chatluna?.currentConfig ?? app.chatluna?.config;
  if (cfg) {
    for (const [name2, value] of Object.entries({
      defaultModel: cfg.defaultModel,
      defaultPreset: cfg.defaultPreset,
      defaultChatMode: cfg.defaultChatMode,
      defaultEmbeddings: cfg.defaultEmbeddings,
      defaultVectorStore: cfg.defaultVectorStore,
      defaultGroupRouteMode: cfg.defaultGroupRouteMode
    })) {
      result.push({
        type: "default",
        name: name2,
        description: String(value ?? ""),
        source: "chatluna-config",
        group: "default",
        tags: [],
        usedByConversations: 0,
        usedByRules: 0,
        path: "",
        details: {}
      });
    }
  }
  return result;
}
function buildProviderDetail(app, convs, platform) {
  const provider = buildProviders(app, convs).find(
    (row) => row.platform === platform
  );
  return {
    provider,
    tools: Object.entries(app.chatluna?.platform?._tools ?? {}).map(
      ([name2, tool]) => ({
        name: name2,
        description: tool.description ?? "",
        source: tool.meta?.source ?? "",
        group: tool.meta?.group ?? "",
        tags: tool.meta?.tags ?? []
      })
    ),
    chatChains: Object.entries(
      app.chatluna?.platform?._chatChains ?? {}
    ).map(([name2, chain]) => ({
      name: name2,
      description: chain.description ?? {}
    })),
    vectorStores: Object.keys(app.chatluna?.platform?._vectorStore ?? {})
  };
}
async function previewOperation(ctx, cfg, input) {
  if (input.type === "model-migration") {
    const rows = (await getRows(
      ctx,
      "chatluna_conversation"
    )).filter((row) => {
      if (input.fromModel && row.model !== input.fromModel) {
        return false;
      }
      if (input.status && row.status !== input.status) return false;
      if (input.user && row.createdBy !== input.user && !row.bindingKey.includes(input.user)) {
        return false;
      }
      if (!input.includeArchived && row.status === "archived") {
        return false;
      }
      return row.model !== input.targetModel;
    }).map((row) => viewConversation(row));
    return {
      type: input.type,
      count: rows.length,
      rows: rows.slice(0, cfg.maxPreviewRows),
      warnings: [
        "\u5C06\u4FEE\u6539 chatluna_conversation.model \u5E76\u6E05\u7406\u8FD0\u884C\u65F6\u4F1A\u8BDD\u7F13\u5B58\u3002",
        "\u53EA\u4F1A\u6267\u884C\u672C\u6B21\u9884\u89C8\u6761\u4EF6\u5339\u914D\u5230\u7684\u4F1A\u8BDD\u3002"
      ],
      blocked: !input.targetModel
    };
  }
  if (input.type === "model-reference-migration") {
    const rows = [];
    if (input.scopes.includes("conversation")) {
      for (const row of await getRows(
        ctx,
        "chatluna_conversation"
      )) {
        if (row.model !== input.fromModel) continue;
        if (!input.includeArchived && row.status === "archived") continue;
        rows.push({
          id: `conversation:${row.id}:model`,
          refId: row.id,
          kind: "conversation",
          title: row.title || row.id,
          field: "model",
          model: row.model,
          targetModel: input.targetModel,
          status: row.status
        });
      }
    }
    const rules = await getRows(
      ctx,
      "chatluna_constraint"
    );
    if (input.scopes.includes("constraint-default")) {
      for (const row of rules) {
        if (row.defaultModel !== input.fromModel) continue;
        rows.push({
          id: `constraint:${row.id}:defaultModel`,
          refId: String(row.id),
          kind: "constraint",
          title: row.name || String(row.id),
          field: "defaultModel",
          model: row.defaultModel,
          targetModel: input.targetModel,
          status: row.enabled ? "enabled" : "disabled"
        });
      }
    }
    if (input.scopes.includes("constraint-fixed")) {
      for (const row of rules) {
        if (row.fixedModel !== input.fromModel) continue;
        rows.push({
          id: `constraint:${row.id}:fixedModel`,
          refId: String(row.id),
          kind: "constraint",
          title: row.name || String(row.id),
          field: "fixedModel",
          model: row.fixedModel,
          targetModel: input.targetModel,
          status: row.enabled ? "enabled" : "disabled"
        });
      }
    }
    if (input.scopes.includes("config-default")) {
      const fork = findChatLunaFork(ctx);
      const source = fork?.fork.config ?? {};
      if (source.defaultModel === input.fromModel) {
        rows.push({
          id: "config:chatluna:defaultModel",
          refId: "defaultModel",
          kind: "config",
          title: "ChatLuna \u9ED8\u8BA4\u6A21\u578B",
          field: "defaultModel",
          model: source.defaultModel,
          targetModel: input.targetModel,
          status: fork?.key ?? "runtime"
        });
      }
    }
    return {
      type: input.type,
      count: rows.length,
      rows: rows.slice(0, cfg.maxPreviewRows),
      allRows: rows,
      warnings: [
        "\u5C06\u4FEE\u6539\u6A21\u578B\u5F15\u7528\u5B57\u6BB5\uFF0C\u6D89\u53CA\u4F1A\u8BDD\u65F6\u4F1A\u6E05\u7406\u8FD0\u884C\u65F6\u4F1A\u8BDD\u7F13\u5B58\u3002",
        "\u914D\u7F6E\u5199\u56DE\u8981\u6C42 Koishi loader \u53EF\u5199\u3002"
      ],
      blocked: !input.fromModel || !input.targetModel || input.fromModel === input.targetModel || input.scopes.length === 0
    };
  }
  if (input.type === "status-change") {
    const rows = (await getRows(
      ctx,
      "chatluna_conversation"
    )).filter((row) => {
      if (input.status && row.status !== input.status) return false;
      if (input.model && row.model !== input.model) return false;
      if (input.user && row.createdBy !== input.user && !row.bindingKey.includes(input.user)) {
        return false;
      }
      return row.status !== input.targetStatus;
    }).map((row) => viewConversation(row));
    return {
      type: input.type,
      count: rows.length,
      rows: rows.slice(0, cfg.maxPreviewRows),
      warnings: ["\u5C06\u6279\u91CF\u4FEE\u6539\u4F1A\u8BDD status\u3002"],
      blocked: !input.targetStatus
    };
  }
  if (input.type === "archive-record-cleanup") {
    const rows = (await Promise.all(
      (await getRows(ctx, "chatluna_archive")).map((row) => viewArchive(row, cfg))
    )).filter((row) => row.fileState === "missing");
    return {
      type: input.type,
      count: rows.length,
      rows: rows.slice(0, cfg.maxPreviewRows),
      warnings: ["\u5C06\u5220\u9664\u7F3A\u5931\u6587\u4EF6\u5BF9\u5E94\u7684 chatluna_archive \u8868\u8BB0\u5F55\u3002"],
      blocked: !cfg.enableArchiveFileOps
    };
  }
  if (input.type === "message-repair") {
    const [conv] = await ctx.database.get("chatluna_conversation", {
      id: input.conversationId
    });
    const msgs = await getMessageChainRows(ctx, {
      conversationId: input.conversationId
    });
    const diag = diagnoseConversation(conv, msgs);
    return {
      type: input.type,
      count: diag.issues.length,
      rows: diag.rows.slice(0, cfg.maxPreviewRows),
      warnings: [
        "\u5C06\u6309 createdAt \u91CD\u5EFA parentId \u94FE\u8DEF\uFF0C\u5E76\u628A latestMessageId \u6307\u5411\u6700\u540E\u4E00\u6761\u6D88\u606F\u3002"
      ],
      blocked: !cfg.enableMessageRepair || !input.conversationId
    };
  }
  return {
    type: "unknown",
    count: 0,
    rows: [],
    warnings: ["\u672A\u77E5\u64CD\u4F5C\u3002"],
    blocked: true
  };
}
function liveModels(app) {
  return Object.entries(app.chatluna?.platform?._models ?? {}).flatMap(
    ([platform, rows]) => rows.filter((row) => row.type === 1).map((row) => `${platform}/${row.name}`)
  ).sort();
}
function chatlunaConfigDefaults() {
  return {
    botNames: ["\u9999\u8349"],
    isNickname: true,
    isNickNameWithContent: false,
    allowPrivate: true,
    allowAtReply: true,
    allowQuoteReply: false,
    privateChatWithoutCommand: true,
    includeQuoteReply: true,
    randomReplyFrequency: 0,
    attachForwardMsgIdToContext: false,
    isForwardMsg: false,
    forwardMsgMinLength: 0,
    isReplyWithAt: false,
    replyQuoteThreshold: 0,
    sendThinkingMessage: true,
    sendThinkingMessageTimeout: 15e3,
    msgCooldown: 0,
    messageQueue: true,
    messageQueueDelay: 0,
    showThoughtMessage: false,
    outputMode: "text",
    splitMessage: false,
    censor: false,
    rawOnCensor: false,
    streamResponse: false,
    blackList: 0,
    infiniteContext: true,
    infiniteContextThreshold: 0.85,
    autoArchive: false,
    autoArchiveTimeout: 864e3,
    autoPurgeArchive: false,
    autoPurgeArchiveTimeout: 2592e3,
    defaultEmbeddings: "\u65E0",
    defaultVectorStore: "\u65E0",
    defaultGroupRouteMode: "shared",
    defaultChatMode: "plugin",
    defaultModel: "\u65E0",
    defaultPreset: "sydney",
    voiceSpeakId: 0,
    isLog: false,
    isProxy: false,
    proxyAddress: "http://127.0.0.1:7897"
  };
}
function findChatLunaFork(ctx) {
  const seen = /* @__PURE__ */ new Set();
  let cur = ctx;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const record = cur.scope[Symbol.for("koishi.loader.record")];
    const entry = Object.entries(record ?? {}).find(
      ([key]) => key === "chatluna" || key.startsWith("chatluna:")
    );
    if (entry) return { key: entry[0], fork: entry[1] };
    cur = cur.scope?.parent;
  }
  return null;
}
function modelTypeText(type) {
  if (type === 1) return "LLM";
  if (type === 2) return "\u5D4C\u5165";
  if (type === 3) return "\u91CD\u6392";
  return "\u672A\u77E5";
}
function issueTypeText(type) {
  if (type === "missing-model") return "\u7F3A\u5931\u6A21\u578B";
  if (type === "missing-preset") return "\u7F3A\u5931 preset";
  if (type === "missing-chat-chain") return "\u7F3A\u5931 chatMode";
  if (type === "database-only-provider") return "\u4EC5\u6570\u636E\u5E93 Provider";
  if (type === "provider-no-config") return "\u65E0\u53EF\u7528\u914D\u7F6E";
  if (type === "dangling-binding") return "\u60AC\u7A7A binding";
  if (type === "dangling-acl") return "\u60AC\u7A7A ACL";
  if (type === "archive-missing-file") return "\u5F52\u6863\u7F3A\u6587\u4EF6";
  return type;
}
function parseBindingKey(bindingKey) {
  const presetIdx = bindingKey.indexOf(":preset:");
  const baseKey = presetIdx < 0 ? bindingKey : bindingKey.slice(0, presetIdx);
  const presetLane = presetIdx < 0 ? "" : bindingKey.slice(presetIdx + ":preset:".length);
  const parts = baseKey.split(":");
  if (parts[0] === "shared") {
    return {
      baseKey,
      presetLane,
      routeMode: "shared",
      platform: parts[1] ?? "",
      selfId: parts[2] ?? "",
      scope: "guild",
      guildId: parts[3] ?? "",
      userId: ""
    };
  }
  if (parts[0] === "personal") {
    if (parts[3] === "direct") {
      return {
        baseKey,
        presetLane,
        routeMode: "personal",
        platform: parts[1] ?? "",
        selfId: parts[2] ?? "",
        scope: "direct",
        guildId: "",
        userId: parts[4] ?? ""
      };
    }
    return {
      baseKey,
      presetLane,
      routeMode: "personal",
      platform: parts[1] ?? "",
      selfId: parts[2] ?? "",
      scope: "guild",
      guildId: parts[3] ?? "",
      userId: parts[4] ?? ""
    };
  }
  if (parts[0] === "custom") {
    return {
      baseKey,
      presetLane,
      routeMode: "custom",
      platform: "",
      selfId: "",
      scope: "custom",
      guildId: "",
      userId: ""
    };
  }
  return {
    baseKey,
    presetLane,
    routeMode: "legacy",
    platform: "",
    selfId: "",
    scope: "legacy",
    guildId: "",
    userId: ""
  };
}
function readUserList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const data = JSON.parse(value);
    return Array.isArray(data) ? data : [];
  } catch {
    return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  }
}
function writeUserList(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? JSON.stringify(data) : text;
  } catch {
    return JSON.stringify(
      text.split(",").map((item) => item.trim()).filter((item) => item.length > 0)
    );
  }
}
async function clearRuntime(app, conv) {
  try {
    await app.chatluna?.conversationRuntime?.clearConversationInterface(conv);
  } catch {
  }
}
var PERMISSION_AUDIT_PREFIXES = [
  "koishi-user.",
  "koishi-channel.",
  "koishi-identity.",
  "koishi-permission.",
  "koishi-maintenance.",
  "acl.",
  "rule.",
  "conversation.remove",
  "conversation.assign",
  "binding."
];
function affectsPermissionCache(action) {
  return PERMISSION_AUDIT_PREFIXES.some((prefix) => action.startsWith(prefix));
}
function pushAudit(action, target, ids, detail = {}) {
  if (affectsPermissionCache(action)) invalidatePermissionCache();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    action,
    target,
    ids,
    count: ids.length,
    detail,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  audits.unshift(entry);
  audits.splice(80);
  if (rootCtx) {
    void rootCtx.database.upsert("chatluna_data_audit", [
      {
        id: entry.id,
        action,
        target,
        ids: JSON.stringify(ids),
        count: ids.length,
        detail: JSON.stringify(detail),
        createdAt: new Date(entry.createdAt)
      }
    ]).catch(() => {
    });
  }
}
function countBy(values) {
  const result = {};
  for (const value of values) {
    result[value || ""] = (result[value || ""] ?? 0) + 1;
  }
  return result;
}
async function readMessageText(row) {
  const raw = row.content ? await gzipDecode(row.content) : row.text == null ? "" : String(row.text);
  try {
    const json = JSON.parse(raw);
    if (typeof json === "string") return json;
    if (Array.isArray(json)) {
      return json.map((part) => {
        if (part.type === "text") return part.text;
        if (part.type === "image_url") return "[image]";
        if (part.type === "file_url") return "[file]";
        if (part.type === "audio_url") return "[audio]";
        if (part.type === "video_url") return "[video]";
        return `[${part.type}]`;
      }).join("");
    }
    return JSON.stringify(json);
  } catch {
    return raw;
  }
}
function describeIssueKind(kind, table, field) {
  switch (kind) {
    case "invalid-tool-calls":
      return {
        errorCode: "CHATLUNA-103",
        reason: `${table}.${field} \u4E0D\u662F\u5408\u6CD5 JSON \u6570\u7EC4\uFF0C\u8FD0\u884C\u65F6\u4F1A\u629B\u51FA toolCalls.map is not a function\u3002`,
        recommendation: "\u5EFA\u8BAE\u300C\u5B89\u5168\u7F6E\u7A7A\u300D\uFF1A\u5199\u5165 []\uFF0CChatLuna \u5728\u4E0B\u4E00\u6B21\u5199\u5165\u65F6\u4F1A\u91CD\u65B0\u751F\u6210 tool_calls\uFF0C\u4E0D\u5F71\u54CD\u5BF9\u8BDD\u4E3B\u4F53\u3002"
      };
    case "invalid-json":
      return {
        errorCode: "CHATLUNA-DATA-JSON",
        reason: `${table}.${field} \u4E0D\u662F\u5408\u6CD5 JSON\uFF0C\u53CD\u5E8F\u5217\u5316\u65F6\u4F1A\u5931\u8D25\u3002`,
        recommendation: "\u5EFA\u8BAE\u300C\u5B89\u5168\u7F6E\u7A7A\u300D\uFF1A\u5199\u5165 {} \u6216 []\uFF0C\u8BE5\u5B57\u6BB5\u4E3A\u53EF\u9009\u5143\u6570\u636E\uFF0C\u540E\u7EED\u53EF\u7531\u8FD0\u884C\u65F6\u91CD\u5EFA\u3002"
      };
    case "driver-load-error":
      return {
        errorCode: "MINATO-306",
        reason: `${table}.${field} \u89E6\u53D1 minato JSON.parse(<\u7A7A\u5B57\u7B26\u4E32>)\uFF0C\u6574\u5F20\u8868\u52A0\u8F7D\u4F1A\u88AB\u4E2D\u65AD\u3002`,
        recommendation: "\u5EFA\u8BAE\u300C\u5B89\u5168\u7F6E\u7A7A\u300D\uFF08\u63A8\u8350\uFF09\u6216\u300C\u5220\u9664\u884C\u300D\uFF1A\u5148\u628A\u574F JSON \u6539\u6210 {} / [] / \u7A7A\u5B57\u7B26\u4E32\uFF0C\u8BA9\u63A7\u5236\u53F0\u4E0E ChatLuna \u6062\u590D\u8BFB\u53D6\u3002"
      };
    case "malformed-message-content":
      return {
        errorCode: "CHATLUNA-MSG-CONTENT",
        reason: `${table}.${field} gzip \u89E3\u538B\u540E\u975E\u5408\u6CD5 JSON\uFF0C\u4F1A\u8BA9 ChatLuna \u8DF3\u8FC7\u8FD9\u6761\u6D88\u606F\u3002`,
        recommendation: "\u5EFA\u8BAE\u300C\u5220\u9664\u884C\u300D\uFF1A\u6D88\u606F\u4F53\u5DF2\u635F\u574F\u4E0D\u53EF\u4FEE\u590D\uFF0C\u5220\u6389\u8FD9\u6761\u6D88\u606F\u8BB0\u5F55\u5373\u53EF\u8BA9\u5BF9\u8BDD\u7EE7\u7EED\u53EF\u8BFB\u3002"
      };
    case "invalid-binding-key":
      return {
        errorCode: "CHATLUNA-BINDING-KEY",
        reason: `${table}.${field} \u662F\u65E7\u7248 legacy:legacy \u5360\u4F4D\u7ED1\u5B9A\u952E\u3002`,
        recommendation: "\u5EFA\u8BAE\u624B\u52A8\u5904\u7406\uFF1A\u53EF\u5728\u300C\u7ED1\u5B9A\u300D\u9762\u677F\u91CD\u65B0\u5206\u914D\u4F1A\u8BDD\u5F52\u5C5E\uFF0C\u6216\u4FDD\u7559\u4F5C\u4E3A\u5386\u53F2\u6570\u636E\u3002"
      };
    case "dangling-latest-message":
      return {
        errorCode: "CHATLUNA-CONV-LATEST",
        reason: `${table}.${field} \u6307\u5411\u4E0D\u5B58\u5728\u7684\u6D88\u606F\uFF0C\u4F1A\u8BDD\u5C3E\u90E8\u8FFD\u6EAF\u5931\u8D25\u3002`,
        recommendation: "\u5EFA\u8BAE\u300C\u5B89\u5168\u7F6E\u7A7A\u300D\uFF1A\u6E05\u7A7A latestMessageId\uFF0CChatLuna \u4E0B\u6B21\u53D1\u6D88\u606F\u65F6\u4F1A\u5237\u65B0\u3002"
      };
    case "dangling-conversation-ref":
      return {
        errorCode: "CHATLUNA-CONV-REF",
        reason: `${table}.${field} \u6307\u5411\u5DF2\u5220\u9664\u7684\u4F1A\u8BDD\uFF0C\u4F1A\u89E6\u53D1 "\u672A\u627E\u5230\u4F1A\u8BDD" \u62A5\u9519\u3002`,
        recommendation: "\u5EFA\u8BAE\u300C\u5B89\u5168\u7F6E\u7A7A\u300D\uFF1A\u6E05\u7A7A\u8BE5\u7ED1\u5B9A\u540E\u7528\u6237\u4E0B\u6B21\u5BF9\u8BDD\u4F1A\u91CD\u65B0\u9009\u62E9\u4F1A\u8BDD\u3002"
      };
    case "invalid-acl-principal":
      return {
        errorCode: "CHATLUNA-ACL-PRINCIPAL",
        reason: `${table}.${field} \u4E0D\u662F user/role/channel/platform \u4E4B\u4E00\uFF0CACL \u89E3\u6790\u4F1A\u5931\u8D25\u3002`,
        recommendation: "\u5EFA\u8BAE\u300C\u5220\u9664\u884C\u300D\uFF1A\u6765\u6E90\u4E0D\u660E\u7684 ACL \u884C\u6CA1\u6709\u610F\u4E49\uFF0C\u79FB\u9664\u540E\u9ED8\u8BA4 ACL \u751F\u6548\u3002"
      };
    case "invalid-acl-permission":
      return {
        errorCode: "CHATLUNA-ACL-PERM",
        reason: `${table}.${field} \u4E0D\u662F view/edit/owner/admin/reader \u4E4B\u4E00\u3002`,
        recommendation: "\u5EFA\u8BAE\u624B\u52A8\u5904\u7406\uFF1A\u53EF\u5728 ACL \u9762\u677F\u91CD\u65B0\u6307\u5B9A\u6743\u9650\u7EA7\u522B\u3002"
      };
    case "invalid-archive-path":
      return {
        errorCode: "CHATLUNA-ARCHIVE-PATH",
        reason: `${table}.${field} \u7F3A\u5931\u6216\u975E\u5B57\u7B26\u4E32\uFF0C\u5F52\u6863\u65E0\u6CD5\u8BFB\u53D6\u3002`,
        recommendation: "\u5EFA\u8BAE\u300C\u5220\u9664\u884C\u300D\uFF1A\u5F52\u6863\u5143\u6570\u636E\u5DF2\u574F\uFF0C\u78C1\u76D8\u4E0A\u7684\u6587\u4EF6\u53EF\u624B\u52A8\u5F52\u6863\u76EE\u5F55\u91CC\u6062\u590D\u3002"
      };
    case "invalid-audit-payload":
      return {
        errorCode: "CHATLUNA-DATA-AUDIT",
        reason: `${table}.${field} JSON \u7ED3\u6784\u635F\u574F\uFF0C\u5BA1\u8BA1\u8BB0\u5F55\u65E0\u6CD5\u5C55\u5F00\u3002`,
        recommendation: "\u5EFA\u8BAE\u300C\u5B89\u5168\u7F6E\u7A7A\u300D\uFF1A\u5BA1\u8BA1\u4EC5\u7559\u4F5C\u5386\u53F2\u8BB0\u5F55\uFF0C\u7F6E\u7A7A detail/ids \u4E0D\u5F71\u54CD\u4E1A\u52A1\u3002"
      };
    default:
      return {
        reason: `${table}.${field} \u51FA\u73B0\u5B8C\u6574\u6027\u95EE\u9898\u3002`,
        recommendation: "\u5EFA\u8BAE\u5148\u67E5\u770B\u300C\u8BE6\u60C5\u300D\u518D\u51B3\u5B9A\u5982\u4F55\u5904\u7406\u3002"
      };
  }
}
function makeIssue(args) {
  const desc = describeIssueKind(args.kind, args.table, args.field);
  return {
    id: makeIssueId(args.table, args.recordId, args.field),
    ...args,
    reason: desc.reason,
    recommendation: desc.recommendation,
    errorCode: desc.errorCode,
    canAutoFix: args.suggestedFix !== "manual"
  };
}
async function recordOpsLog(ctx, cfg, record) {
  if (record.type !== "error" && record.type !== "warn") return;
  const text = `[${record.name}] ${record.content}`;
  const lower = text.toLowerCase();
  if (!record.name.toLowerCase().includes("chatluna") && !lower.includes("chatluna") && !lower.includes("@minatojs/driver-sqlite") && !lower.includes("sqlitebuilder.load") && !lower.includes("toolcalls.map") && !lower.includes("tool_calls") && !lower.includes("no available config")) {
    return;
  }
  const analysis = await analyzeOpsError(ctx, cfg, { text });
  await pushOpsError(
    ctx,
    {
      source: "logger",
      level: record.type,
      logger: record.name,
      message: text
    },
    analysis
  );
}
async function pushOpsError(ctx, input, analysis) {
  const recent = opsErrors.find(
    (row2) => row2.message === input.message && Date.now() - new Date(row2.createdAt).getTime() < 6e4
  );
  if (recent) return recent;
  const result = analysis;
  const row = {
    id: randomUUID(),
    source: input.source,
    level: input.level,
    logger: input.logger,
    message: input.message,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    analysis
  };
  opsErrors.unshift(row);
  opsErrors.splice(80);
  await ctx.database.upsert("chatluna_data_ops_error", [
    {
      id: row.id,
      source: row.source,
      level: row.level,
      logger: row.logger,
      message: row.message,
      kind: result.kind ?? "unknown",
      title: result.title ?? "",
      severity: result.severity ?? "info",
      analysis: JSON.stringify(analysis),
      createdAt: new Date(row.createdAt)
    }
  ]);
  return row;
}
function inspectModelPayload(text) {
  if (!text.startsWith("{") || !text.includes('"model"') || !text.includes('"messages"')) {
    return null;
  }
  try {
    const data = JSON.parse(text);
    if (!data.model || !Array.isArray(data.messages)) return null;
    let textChars = 0;
    let imageChars = 0;
    let images = 0;
    let maxImage = 0;
    for (const msg of data.messages) {
      if (typeof msg.content === "string") {
        textChars += msg.content.length;
        continue;
      }
      if (!Array.isArray(msg.content)) continue;
      for (const part of msg.content) {
        if (part.type === "text") {
          textChars += part.text?.length ?? 0;
        }
        if (part.type === "image_url") {
          const url = part.image_url?.url ?? "";
          if (url.startsWith("data:image/")) {
            images += 1;
            imageChars += url.length;
            maxImage = Math.max(maxImage, url.length);
          }
        }
      }
    }
    const tools = Array.isArray(data.tools) ? data.tools : [];
    return {
      model: data.model,
      bytes: Buffer.byteLength(text),
      messages: data.messages.length,
      tools: tools.length,
      toolBytes: Buffer.byteLength(JSON.stringify(tools)),
      images,
      imageChars,
      maxImage,
      textChars
    };
  } catch {
    return null;
  }
}
async function analyzeOpsError(ctx, cfg, input) {
  const text = (input.text ?? "").trim();
  const lower = text.toLowerCase();
  const loads = Array.from(loadErrors.values());
  const payload = inspectModelPayload(text);
  if (payload) {
    const heavy = payload.bytes > 15e5 || payload.imageChars > 1e6 || payload.tools > 40 || payload.textChars > 5e4;
    return {
      analyzedAt: (/* @__PURE__ */ new Date()).toISOString(),
      severity: heavy ? "warning" : "info",
      kind: "model-request-payload",
      title: heavy ? "\u6A21\u578B\u8BF7\u6C42\u8D1F\u8F7D\u8FC7\u5927\uFF0C\u5BB9\u6613\u89E6\u53D1\u8D85\u65F6\u6216\u4E0A\u6E38\u62D2\u7EDD" : "\u8FD9\u662F\u6A21\u578B\u8BF7\u6C42\u8F6C\u50A8\uFF0C\u4E0D\u662F\u6570\u636E\u5E93\u9519\u8BEF",
      confidence: "high",
      summary: "\u65E5\u5FD7\u5185\u5BB9\u662F\u4E00\u6B21\u53D1\u5F80\u6A21\u578B\u7684\u5B8C\u6574\u8BF7\u6C42 JSON\u3002\u5B83\u5305\u542B prompt\u3001\u7528\u6237\u4E0A\u4E0B\u6587\u3001\u5DE5\u5177\u5B9A\u4E49\u548C\u5185\u8054\u56FE\u7247\uFF0C\u4E0D\u5C5E\u4E8E ChatLuna \u6570\u636E\u5E93\u635F\u574F\u3002",
      impact: "\u8BF7\u6C42\u8D8A\u5927\uFF0C\u4E0A\u6E38\u8D8A\u5BB9\u6613\u51FA\u73B0\u6162\u54CD\u5E94\u3001\u8D85\u65F6\u3001\u8BF7\u6C42\u4F53\u8D85\u9650\u3001429/\u9650\u6D41\u6216\u591A\u6A21\u6001\u5904\u7406\u5931\u8D25\uFF1B\u540C\u65F6\u5B8C\u6574 prompt \u548C\u56FE\u7247\u4F1A\u66B4\u9732\u5728\u65E5\u5FD7\u6587\u4EF6\u91CC\u3002",
      evidence: [
        {
          label: "\u6A21\u578B",
          value: payload.model
        },
        {
          label: "\u8BF7\u6C42\u5927\u5C0F",
          value: `${payload.bytes} bytes`
        },
        {
          label: "\u6D88\u606F / \u5DE5\u5177",
          value: `${payload.messages} messages \xB7 ${payload.tools} tools \xB7 ${payload.toolBytes} tool bytes`
        },
        {
          label: "\u5185\u8054\u56FE\u7247",
          value: `${payload.images} images \xB7 ${payload.imageChars} chars \xB7 max ${payload.maxImage}`
        },
        {
          label: "\u6587\u672C\u4E0A\u4E0B\u6587",
          value: `${payload.textChars} chars`
        }
      ],
      actions: [
        {
          title: "\u6536\u655B\u56FE\u7247\u8F7D\u8377",
          level: "recommended",
          description: "\u8FD9\u7C7B\u8BF7\u6C42\u628A\u56FE\u7247\u76F4\u63A5\u8F6C\u6210 base64 \u653E\u8FDB\u6A21\u578B\u8BF7\u6C42\uFF0C\u5355\u5F20\u56FE\u8FC7\u5927\u65F6\u6700\u5BB9\u6613\u62D6\u6162\u6216\u6253\u7206\u4E0A\u6E38\u3002",
          steps: [
            "\u51CF\u5C11\u540C\u4E00\u8F6E\u53D1\u9001\u5230\u6A21\u578B\u7684\u56FE\u7247\u6570\u91CF\u3002",
            "\u538B\u7F29\u56FE\u7247\u5C3A\u5BF8\u548C\u8D28\u91CF\u540E\u518D\u8FDB\u5165 ChatLuna\u3002",
            "\u4F18\u5148\u8BA9\u56FE\u7247\u8D70\u53EF\u8BBF\u95EE URL \u6216\u4E34\u65F6\u6587\u4EF6\uFF0C\u800C\u4E0D\u662F\u957F\u671F\u4FDD\u5B58\u5B8C\u6574 data URL \u65E5\u5FD7\u3002"
          ],
          target: "manual-request-trim"
        },
        {
          title: "\u51CF\u5C11\u672C\u8F6E\u5DE5\u5177\u5B9A\u4E49",
          level: "normal",
          description: "\u5DE5\u5177 schema \u4E5F\u4F1A\u5360\u7528\u8BF7\u6C42\u4F53\u3002\u5DE5\u5177\u5F88\u591A\u65F6\uFF0C\u5373\u4F7F\u7528\u6237\u53EA\u662F\u53D1\u56FE\uFF0C\u4E5F\u4F1A\u628A\u5927\u91CF\u65E0\u5173\u5DE5\u5177\u8BF4\u660E\u4E00\u8D77\u53D1\u7ED9\u6A21\u578B\u3002",
          steps: [
            "\u6309\u4F1A\u8BDD\u573A\u666F\u5173\u95ED\u4E0D\u9700\u8981\u7684\u5DE5\u5177\u6216\u6280\u80FD\u3002",
            "\u628A\u9AD8\u98CE\u9669\u6216\u4F4E\u9891\u5DE5\u5177\u4ECE\u9ED8\u8BA4\u5DE5\u5177\u96C6\u4E2D\u79FB\u51FA\u3002",
            "\u53EA\u5728\u9700\u8981\u65F6\u542F\u7528\u6587\u4EF6\u3001\u7EC8\u7AEF\u3001\u5E73\u53F0\u7BA1\u7406\u7C7B\u5DE5\u5177\u3002"
          ],
          target: "config"
        },
        {
          title: "\u88C1\u526A\u4E0A\u4E0B\u6587\u4E0E\u73AF\u5883\u6D88\u606F",
          level: "normal",
          description: "\u957F\u89D2\u8272\u8BBE\u5B9A\u3001\u7FA4\u4FE1\u606F\u3001\u5386\u53F2\u6D88\u606F\u548C\u5DE5\u5177\u8BF4\u660E\u53E0\u52A0\u540E\uFF0C\u4F1A\u8BA9\u666E\u901A\u56FE\u7247\u8BF7\u6C42\u53D8\u6210\u5927\u8BF7\u6C42\u3002",
          steps: [
            "\u964D\u4F4E\u5386\u53F2\u6D88\u606F\u6570\u91CF\u6216\u542F\u7528\u66F4\u79EF\u6781\u7684\u6458\u8981\u3002",
            "\u7CBE\u7B80\u7FA4\u6210\u5458\u8D44\u6599\u548C\u73AF\u5883\u6D88\u606F\u3002",
            "\u68C0\u67E5 preset \u662F\u5426\u628A\u56FA\u5B9A\u8D44\u6599\u91CD\u590D\u6CE8\u5165\u3002"
          ],
          target: "config"
        },
        {
          title: "\u4E0D\u8981\u6309\u6570\u636E\u5E93\u4FEE\u590D\u5904\u7406",
          level: "manual",
          description: "\u8FD9\u4EFD\u65E5\u5FD7\u6CA1\u6709\u6307\u5411 chatluna_message\u3001archive\u3001ACL \u7B49\u6E90\u5934\u884C\uFF0C\u5B8C\u6574\u6027\u626B\u63CF\u4E0D\u4F1A\u4FEE\u590D\u8BF7\u6C42\u8FC7\u5927\u7684\u6839\u56E0\u3002",
          steps: [
            "\u4E0D\u8981\u5220\u9664\u4F1A\u8BDD\u6216\u6D88\u606F\u6765\u5904\u7406\u8FD9\u7C7B\u95EE\u9898\u3002",
            "\u5982\u679C\u771F\u5B9E\u62A5\u9519\u53E6\u6709 400/413/429/timeout\uFF0C\u8BF7\u628A\u90A3\u6BB5\u54CD\u5E94\u5806\u6808\u4E00\u8D77\u653E\u8FDB\u7814\u5224\u3002"
          ],
          target: "paste-stack"
        }
      ],
      related: { loadErrors: loads, issues: [], scanSummary: null }
    };
  }
  const minatoJson = lower.includes("chatlunaerror:306") || lower.includes("chatlunaerror 306") || lower.includes("error:306") || lower.includes("unexpected end of json input") || lower.includes("sqlitebuilder.load") || lower.includes("@minatojs/driver-sqlite") || !text && loads.length > 0;
  const toolCalls = lower.includes("toolcalls.map") || lower.includes("tool_calls") || lower.includes("tool calls");
  const noConfig = lower.includes("no available config") || lower.includes("available config") || lower.includes("307");
  const auth = lower.includes("unauthorized") || lower.includes("invalid api key") || lower.includes("401") || lower.includes("403");
  const timeout = lower.includes("timeout") || lower.includes("etimedout") || lower.includes("econnreset") || lower.includes("fetch failed");
  if (minatoJson || toolCalls) {
    const scan = await scanIntegrity(ctx, cfg, {
      limit: Math.min(cfg.maxPreviewRows ?? 200, 120)
    });
    const rows = scan.issues.filter(
      (row) => minatoJson ? row.kind === "driver-load-error" || row.kind === "invalid-json" || row.kind === "invalid-audit-payload" : row.kind === "invalid-tool-calls"
    ).slice(0, 20);
    return {
      analyzedAt: (/* @__PURE__ */ new Date()).toISOString(),
      severity: "danger",
      kind: minatoJson ? "database-json-load-error" : "message-tool-calls-error",
      title: minatoJson ? "\u6570\u636E\u5E93 JSON \u5B57\u6BB5\u635F\u574F\u5BFC\u81F4 Minato \u8BFB\u53D6\u5931\u8D25" : "\u6D88\u606F tool_calls \u5B57\u6BB5\u635F\u574F\u5BFC\u81F4 ChatLuna \u8FD0\u884C\u65F6\u5931\u8D25",
      confidence: text || loads.length ? "high" : "medium",
      summary: minatoJson ? "SQLite \u9A71\u52A8\u6B63\u5728\u628A\u67D0\u4E2A JSON \u5B57\u6BB5\u53CD\u5E8F\u5217\u5316\uFF0C\u4F46\u8BE5\u5B57\u6BB5\u662F\u7A7A\u5B57\u7B26\u4E32\u6216\u622A\u65AD JSON\uFF0C\u6240\u4EE5\u6574\u5F20\u8868\u8BFB\u53D6\u88AB\u4E2D\u65AD\u3002" : "ChatLuna \u671F\u671B tool_calls \u662F JSON \u6570\u7EC4\uFF0C\u4F46\u6570\u636E\u5E93\u91CC\u5B58\u5728\u7A7A\u5B57\u7B26\u4E32\u3001\u5BF9\u8C61\u6216\u574F JSON\u3002",
      impact: minatoJson ? "\u63A7\u5236\u53F0\u3001\u4F1A\u8BDD\u5217\u8868\u6216 ChatLuna \u8BFB\u53D6\u76F8\u5173\u8868\u65F6\u4F1A\u62A5 306/Unexpected end of JSON input\u3002" : "\u5305\u542B\u574F\u6D88\u606F\u7684\u4F1A\u8BDD\u5728\u56DE\u590D\u6216\u5C55\u793A\u5DE5\u5177\u8C03\u7528\u65F6\u53EF\u80FD\u4E2D\u65AD\u3002",
      evidence: [
        ...loads.map((row) => ({
          label: `\u6355\u83B7\u8868 ${row.table}`,
          value: row.message
        })),
        ...rows.slice(0, 6).map((row) => ({
          label: `${row.table}.${row.field}`,
          value: `${row.recordId} \xB7 ${row.kind} \xB7 ${row.snippet}`
        }))
      ],
      actions: [
        {
          title: "\u65B9\u5F0F\u4E00\uFF1A\u4FDD\u5B88\u4FEE\u590D\u810F\u5B57\u6BB5\uFF08\u63A8\u8350\uFF09",
          level: "recommended",
          description: "\u8FDB\u5165\u5B8C\u6574\u6027\u626B\u63CF\uFF0C\u5148\u9884\u89C8\u95EE\u9898\u884C\uFF0C\u518D\u5BF9\u53EF\u81EA\u52A8\u4FEE\u590D\u7684 JSON \u5143\u6570\u636E\u5B57\u6BB5\u6267\u884C\u300C\u5B89\u5168\u7F6E\u7A7A\u300D\u3002ChatLuna \u4F1A\u5728\u540E\u7EED\u5199\u5165\u4E2D\u91CD\u5EFA\u53EF\u9009\u5B57\u6BB5\u3002",
          steps: [
            "\u70B9\u51FB\u4E0B\u65B9\u201C\u6253\u5F00\u5B8C\u6574\u6027\u626B\u63CF\u201D\u3002",
            "\u52FE\u9009 driver-load-error\u3001invalid-json \u6216 invalid-tool-calls \u884C\u3002",
            "\u4F18\u5148\u6267\u884C\u201C\u5B89\u5168\u7F6E\u7A7A\u201D\uFF0C\u4FEE\u590D\u540E\u5237\u65B0 ChatLuna \u6216\u91CD\u542F Koishi\u3002"
          ],
          target: "integrity-null-field"
        },
        {
          title: "\u65B9\u5F0F\u4E8C\uFF1A\u9694\u79BB\u5220\u9664\u574F\u8BB0\u5F55",
          level: "danger",
          description: "\u5982\u679C\u574F\u7684\u662F\u6D88\u606F\u4F53\u3001\u5F52\u6863\u5143\u6570\u636E\u6216\u65E0\u610F\u4E49\u7684\u60AC\u7A7A\u8BB0\u5F55\uFF0C\u5148\u5907\u4EFD\u6570\u636E\u5E93\uFF0C\u518D\u5220\u9664\u5BF9\u5E94\u884C\uFF0C\u6362\u53D6\u8FD0\u884C\u65F6\u6062\u590D\u3002",
          steps: [
            "\u5728\u5B8C\u6574\u6027\u626B\u63CF\u91CC\u67E5\u770B recordId \u548C\u5B57\u6BB5\u6837\u4F8B\u3002",
            "\u4EC5\u9009\u62E9 malformed-message-content\u3001\u65E0\u6548 ACL\u3001\u574F\u5F52\u6863\u7B49\u4E0D\u53EF\u6062\u590D\u8BB0\u5F55\u3002",
            "\u6267\u884C\u201C\u5220\u9664\u884C\u201D\uFF0C\u968F\u540E\u68C0\u67E5\u4F1A\u8BDD\u94FE\u662F\u5426\u4ECD\u7136\u53EF\u7528\u3002"
          ],
          target: "integrity-remove-row"
        },
        {
          title: "\u65B9\u5F0F\u4E09\uFF1A\u5907\u4EFD\u540E\u624B\u5DE5\u6062\u590D/\u56DE\u6EDA",
          level: "manual",
          description: "\u5982\u679C\u574F\u884C\u627F\u8F7D\u91CD\u8981\u5386\u53F2\u8BB0\u5F55\uFF0C\u5148\u590D\u5236 SQLite \u6587\u4EF6\uFF0C\u518D\u7528\u6570\u636E\u5E93\u5DE5\u5177\u624B\u5DE5\u628A\u7A7A\u5B57\u7B26\u4E32\u6539\u6210 NULL \u6216\u5408\u6CD5 JSON\uFF0C\u5FC5\u8981\u65F6\u56DE\u6EDA\u5230\u6700\u8FD1\u5907\u4EFD\u3002",
          steps: [
            "\u505C\u6B62 Koishi\uFF0C\u590D\u5236\u5F53\u524D sqlite \u6570\u636E\u5E93\u6587\u4EF6\u3002",
            "\u7528 DB Browser for SQLite \u6216 sqlite3 \u5B9A\u4F4D\u8868\u548C\u4E3B\u952E\u3002",
            "\u628A\u574F JSON \u5B57\u6BB5\u6539\u6210 NULL\u3001{} \u6216 []\uFF0C\u6539\u54EA\u79CD\u4EE5\u5B8C\u6574\u6027\u626B\u63CF\u5EFA\u8BAE\u4E3A\u51C6\u3002"
          ],
          target: "manual-sql"
        }
      ],
      related: {
        loadErrors: loads,
        issues: rows,
        scanSummary: scan.summary
      }
    };
  }
  if (noConfig) {
    return {
      analyzedAt: (/* @__PURE__ */ new Date()).toISOString(),
      severity: "warning",
      kind: "provider-config-unavailable",
      title: "Provider \u6CA1\u6709\u53EF\u7528\u914D\u7F6E",
      confidence: text ? "high" : "medium",
      summary: "ChatLuna \u627E\u5230\u4E86 provider \u6216\u6A21\u578B\u5F15\u7528\uFF0C\u4F46\u8FD0\u884C\u65F6\u6CA1\u6709\u53EF\u7528 adapter \u914D\u7F6E\uFF0C\u5E38\u89C1\u4E8E key \u88AB\u7981\u7528\u3001\u914D\u7F6E\u672A\u52A0\u8F7D\u6216\u4F1A\u8BDD\u5F15\u7528\u65E7\u6A21\u578B\u3002",
      impact: "\u65B0\u6D88\u606F\u65E0\u6CD5\u53D1\u7ED9\u6A21\u578B\uFF0C\u5DF2\u6709\u4F1A\u8BDD\u53EF\u80FD\u53EA\u80FD\u8BFB\u53D6\u4E0D\u80FD\u7EE7\u7EED\u56DE\u590D\u3002",
      evidence: [],
      actions: [
        {
          title: "\u68C0\u67E5\u6A21\u578B\u4E0E Provider \u5065\u5EB7\u4E2D\u5FC3",
          level: "recommended",
          description: "\u67E5\u770B provider \u72B6\u6001\u3001\u53EF\u7528\u914D\u7F6E\u7387\u548C\u7F3A\u5931\u6A21\u578B\u5F15\u7528\uFF0C\u786E\u8BA4\u662F adapter \u672A\u52A0\u8F7D\u8FD8\u662F\u6570\u636E\u5E93\u5F15\u7528\u5931\u6548\u3002",
          steps: [
            "\u6253\u5F00\u201C\u6A21\u578B\u4E0E Provider\u201D\u3002",
            "\u67E5\u770B\u65E0\u53EF\u7528\u914D\u7F6E\u548C\u7F3A\u5931\u6A21\u578B\u5206\u7EC4\u3002",
            "\u5982\u6A21\u578B\u5DF2\u66F4\u540D\uFF0C\u4F7F\u7528\u6A21\u578B\u5F15\u7528\u8FC1\u79FB\u5148\u9884\u89C8\u518D\u6267\u884C\u3002"
          ],
          target: "model-health"
        },
        {
          title: "\u5237\u65B0 provider",
          level: "normal",
          description: "adapter \u914D\u7F6E\u521A\u6539\u5B8C\u65F6\uFF0C\u5237\u65B0 provider \u53EF\u91CD\u65B0\u8BFB\u53D6\u8FD0\u884C\u65F6\u6A21\u578B\u548C\u914D\u7F6E\u6C60\u3002",
          steps: ["\u5728 provider \u8BE6\u60C5\u70B9\u51FB\u5237\u65B0\u3002", "\u518D\u6B21\u68C0\u67E5\u5065\u5EB7\u5206\u548C\u6A21\u578B\u5217\u8868\u3002"],
          target: "provider-refresh"
        },
        {
          title: "\u56DE\u5230 ChatLuna \u914D\u7F6E\u6838\u5BF9\u9ED8\u8BA4\u6A21\u578B",
          level: "manual",
          description: "\u5982\u679C\u9ED8\u8BA4\u6A21\u578B\u5F15\u7528\u4E0D\u5B58\u5728\uFF0C\u4FEE\u6539 ChatLuna \u914D\u7F6E\u6216 data \u63D2\u4EF6\u7684\u914D\u7F6E\u9875\u3002",
          steps: ["\u6253\u5F00\u914D\u7F6E\u9875\u3002", "\u6838\u5BF9 defaultModel\u3001defaultEmbeddings\u3001chatMode\u3002"],
          target: "config"
        }
      ],
      related: { loadErrors: loads, issues: [], scanSummary: null }
    };
  }
  if (auth || timeout) {
    return {
      analyzedAt: (/* @__PURE__ */ new Date()).toISOString(),
      severity: auth ? "danger" : "warning",
      kind: auth ? "provider-auth-error" : "provider-network-error",
      title: auth ? "\u6A21\u578B\u670D\u52A1\u9274\u6743\u5931\u8D25" : "\u6A21\u578B\u670D\u52A1\u7F51\u7EDC\u8D85\u65F6\u6216\u8FDE\u63A5\u5931\u8D25",
      confidence: text ? "high" : "medium",
      summary: auth ? "\u4E0A\u6E38\u6A21\u578B\u670D\u52A1\u62D2\u7EDD\u4E86\u8BF7\u6C42\uFF0C\u901A\u5E38\u662F API Key\u3001Base URL\u3001\u989D\u5EA6\u6216\u6743\u9650\u8303\u56F4\u9519\u8BEF\u3002" : "\u8BF7\u6C42\u6CA1\u6709\u7A33\u5B9A\u5230\u8FBE\u4E0A\u6E38\u670D\u52A1\uFF0C\u53EF\u80FD\u662F\u7F51\u7EDC\u3001\u4EE3\u7406\u3001\u8D85\u65F6\u6216\u670D\u52A1\u7AEF\u9650\u6D41\u3002",
      impact: "ChatLuna \u4F1A\u8BDD\u672C\u8EAB\u901A\u5E38\u6CA1\u6709\u635F\u574F\uFF0C\u4F46\u7EE7\u7EED\u56DE\u590D\u4F1A\u5931\u8D25\u3002",
      evidence: [],
      actions: [
        {
          title: "\u6838\u5BF9 provider \u914D\u7F6E",
          level: "recommended",
          description: "\u68C0\u67E5 adapter \u7684 key\u3001baseURL\u3001\u6A21\u578B\u540D\u548C\u53EF\u7528\u914D\u7F6E\u72B6\u6001\u3002",
          steps: ["\u6253\u5F00\u6A21\u578B\u4E0E Provider\u3002", "\u786E\u8BA4 provider \u5DF2\u52A0\u8F7D\u4E14\u914D\u7F6E\u53EF\u7528\u7387\u4E0D\u4E3A 0\u3002"],
          target: "model-health"
        },
        {
          title: "\u505A\u6700\u5C0F\u5316\u8BF7\u6C42\u9A8C\u8BC1",
          level: "normal",
          description: "\u7528\u540C\u4E00\u4E2A key \u548C baseURL \u5728 provider \u5B98\u65B9\u63A7\u5236\u53F0\u6216 curl \u4E2D\u9A8C\u8BC1\u3002",
          steps: ["\u6D4B\u8BD5\u4E00\u4E2A\u6700\u5C0F\u804A\u5929\u8BF7\u6C42\u3002", "\u5BF9\u6BD4 ChatLuna \u4E2D\u7684\u6A21\u578B\u540D\u548C endpoint\u3002"],
          target: "manual-provider-test"
        },
        {
          title: "\u4E34\u65F6\u5207\u6362\u4F1A\u8BDD\u6A21\u578B",
          level: "manual",
          description: "\u5982\u679C\u4E0A\u6E38\u77ED\u671F\u4E0D\u53EF\u7528\uFF0C\u53EF\u628A\u6D3B\u8DC3\u4F1A\u8BDD\u8FC1\u79FB\u5230\u5907\u7528\u6A21\u578B\u3002",
          steps: ["\u5728\u6A21\u578B\u5065\u5EB7\u9875\u9009\u62E9\u7F3A\u5931\u6216\u5F02\u5E38\u6A21\u578B\u3002", "\u9884\u89C8\u8FC1\u79FB\u5230\u53EF\u7528\u6A21\u578B\u540E\u518D\u6267\u884C\u3002"],
          target: "model-migration"
        }
      ],
      related: { loadErrors: loads, issues: [], scanSummary: null }
    };
  }
  return {
    analyzedAt: (/* @__PURE__ */ new Date()).toISOString(),
    severity: "info",
    kind: "unknown",
    title: "\u672A\u5339\u914D\u5230\u5DF2\u77E5 ChatLuna \u8FD0\u7EF4\u6A21\u5F0F",
    confidence: text ? "low" : "none",
    summary: "\u8FD9\u6BB5\u62A5\u9519\u6CA1\u6709\u547D\u4E2D\u5F53\u524D\u89C4\u5219\u3002\u5EFA\u8BAE\u5148\u68C0\u67E5\u6A21\u578B\u5065\u5EB7\u548C\u6570\u636E\u5B8C\u6574\u6027\uFF0C\u518D\u6839\u636E\u5806\u6808\u91CC\u7684\u63D2\u4EF6\u540D\u5B9A\u4F4D\u3002",
    impact: "\u9700\u8981\u7ED3\u5408\u53D1\u751F\u65F6\u7684\u64CD\u4F5C\u3001\u4F1A\u8BDD ID\u3001\u6A21\u578B\u540D\u548C provider \u65E5\u5FD7\u5224\u65AD\u3002",
    evidence: loads.map((row) => ({
      label: `\u6355\u83B7\u8868 ${row.table}`,
      value: row.message
    })),
    actions: [
      {
        title: "\u5148\u505A\u5065\u5EB7\u68C0\u67E5",
        level: "recommended",
        description: "\u786E\u8BA4 provider\u3001\u6A21\u578B\u5F15\u7528\u3001preset/chatMode \u548C\u5F52\u6863\u72B6\u6001\u662F\u5426\u5F02\u5E38\u3002",
        steps: ["\u6253\u5F00\u7CFB\u7EDF\u5065\u5EB7\u3002", "\u6253\u5F00\u6A21\u578B\u4E0E Provider \u5065\u5EB7\u4E2D\u5FC3\u3002"],
        target: "health"
      },
      {
        title: "\u626B\u63CF\u6570\u636E\u5E93\u5B8C\u6574\u6027",
        level: "normal",
        description: "\u6392\u9664 JSON \u5B57\u6BB5\u3001\u6D88\u606F\u94FE\u3001\u60AC\u7A7A\u5F15\u7528\u8FD9\u7C7B\u5E38\u89C1\u6570\u636E\u5E93\u95EE\u9898\u3002",
        steps: ["\u6253\u5F00\u5B8C\u6574\u6027\u626B\u63CF\u3002", "\u9700\u8981\u65F6\u5F00\u542F\u6DF1\u5EA6\u626B\u63CF\u3002"],
        target: "integrity"
      },
      {
        title: "\u8865\u5145\u4E0A\u4E0B\u6587\u540E\u518D\u5206\u6790",
        level: "manual",
        description: "\u7C98\u8D34\u5B8C\u6574\u5806\u6808\u3001\u89E6\u53D1\u6307\u4EE4\u3001\u4F1A\u8BDD ID\u3001\u6A21\u578B\u540D\u548C provider \u540D\uFF0C\u7814\u5224\u4F1A\u66F4\u51C6\u786E\u3002",
        steps: ["\u590D\u5236 Koishi \u63A7\u5236\u53F0\u5B8C\u6574\u9519\u8BEF\u3002", "\u518D\u6B21\u70B9\u51FB\u5206\u6790\u3002"],
        target: "paste-stack"
      }
    ],
    related: { loadErrors: loads, issues: [], scanSummary: null }
  };
}
var ACL_PRINCIPALS = /* @__PURE__ */ new Set(["user", "role", "channel", "platform"]);
var ACL_PERMISSIONS = /* @__PURE__ */ new Set(["view", "edit", "owner", "admin", "reader"]);
function isJsonArray(value) {
  if (typeof value !== "string") return Array.isArray(value);
  if (value === "") return false;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed);
  } catch {
    return false;
  }
}
function isParseable(value) {
  if (value == null) return true;
  if (typeof value !== "string") return true;
  if (value === "") return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}
function snippet(value, max = 80) {
  if (value == null) return "<null>";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? text.slice(0, max) + "\u2026" : text;
}
function makeIssueId(table, recordId, field) {
  return `${table}:${recordId}:${field}`;
}
function sqliteDriver(ctx) {
  const driver = ctx.model.drivers?.find(
    (item) => typeof item._all === "function" && typeof item._run === "function"
  );
  if (!driver) throw new Error("sqlite raw driver not found");
  return driver;
}
function sqliteHasTable(driver, table) {
  return !!driver._get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    [table]
  );
}
function scan306Sources(ctx, limit) {
  const driver = sqliteDriver(ctx);
  const issues = [];
  if (sqliteHasTable(driver, "chatluna_message")) {
    const rows = driver._all(
      "SELECT id, conversationId, role, tool_calls FROM chatluna_message WHERE tool_calls IS NOT NULL LIMIT ?",
      [Math.max(limit, 5e3)]
    );
    for (const row of rows) {
      if (issues.length >= limit) break;
      const value = row.tool_calls;
      if (value === "") {
        issues.push(makeIssue({
          table: "chatluna_message",
          recordId: String(row.id),
          field: "tool_calls",
          kind: "invalid-tool-calls",
          severity: "danger",
          snippet: snippet(value),
          suggestedFix: "null-field"
        }));
        continue;
      }
      try {
        if (!Array.isArray(JSON.parse(String(value)))) {
          throw new Error("tool_calls is not array");
        }
      } catch {
        issues.push(makeIssue({
          table: "chatluna_message",
          recordId: String(row.id),
          field: "tool_calls",
          kind: "invalid-tool-calls",
          severity: "danger",
          snippet: snippet(value),
          suggestedFix: "null-field"
        }));
      }
    }
  }
  if (issues.length < limit && sqliteHasTable(driver, "chatluna_docstore")) {
    const rows = driver._all(
      "SELECT key, id, metadata FROM chatluna_docstore WHERE metadata IS NOT NULL LIMIT ?",
      [Math.max(limit - issues.length, 5e3)]
    );
    for (const row of rows) {
      if (issues.length >= limit) break;
      try {
        JSON.parse(String(row.metadata));
      } catch {
        issues.push(makeIssue({
          table: "chatluna_docstore",
          recordId: JSON.stringify([row.key, row.id]),
          field: "metadata",
          kind: "invalid-json",
          severity: "danger",
          snippet: snippet(row.metadata),
          suggestedFix: "null-field"
        }));
      }
    }
  }
  return issues;
}
async function probeLoadErrorsRaw(ctx, want, limit) {
  return Array.from(loadErrors.values()).filter((row) => row.table.startsWith("chatluna_")).filter((row) => want(row.table)).slice(0, Math.max(0, limit)).map(
    (row) => makeIssue({
      table: row.table,
      recordId: "driver-load-error",
      field: "<unknown>",
      kind: "driver-load-error",
      severity: "danger",
      snippet: snippet(row.message),
      suggestedFix: "manual"
    })
  );
}
async function scanIntegrity(ctx, cfg, input) {
  const limit = Math.max(50, input.limit ?? cfg.maxPreviewRows ?? 200);
  const wanted = input.tables && input.tables.length ? new Set(input.tables) : null;
  const want = (table) => !wanted || wanted.has(table);
  const issues = [];
  const push = (issue) => {
    if (issues.length < limit) issues.push(issue);
  };
  try {
    for (const issue of scan306Sources(ctx, limit - issues.length)) {
      push(issue);
    }
  } catch (err) {
    recordLoadError("sqlite-raw-306-scan", err);
  }
  if (want("chatluna_conversation")) {
    const convs = await getRows(
      ctx,
      "chatluna_conversation"
    );
    const convIds = new Set(convs.map((row) => row.id));
    for (const row of convs) {
      if (row.additional_kwargs && !isParseable(row.additional_kwargs)) {
        push(makeIssue({
          table: "chatluna_conversation",
          recordId: row.id,
          field: "additional_kwargs",
          kind: "invalid-json",
          severity: "warning",
          snippet: snippet(row.additional_kwargs),
          suggestedFix: "null-field"
        }));
      }
      if (row.legacyMeta && !isParseable(row.legacyMeta)) {
        push(makeIssue({
          table: "chatluna_conversation",
          recordId: row.id,
          field: "legacyMeta",
          kind: "invalid-json",
          severity: "info",
          snippet: snippet(row.legacyMeta),
          suggestedFix: "null-field"
        }));
      }
      const route = parseBindingKey(row.bindingKey ?? "");
      if (row.bindingKey && route.routeMode === "legacy" && route.scope === "legacy") {
        push(makeIssue({
          table: "chatluna_conversation",
          recordId: row.id,
          field: "bindingKey",
          kind: "invalid-binding-key",
          severity: "info",
          snippet: snippet(row.bindingKey),
          suggestedFix: "manual"
        }));
      }
      if (row.latestMessageId && !await messageExists(ctx, row.latestMessageId)) {
        push(makeIssue({
          table: "chatluna_conversation",
          recordId: row.id,
          field: "latestMessageId",
          kind: "dangling-latest-message",
          severity: "warning",
          snippet: snippet(row.latestMessageId),
          suggestedFix: "null-field"
        }));
      }
    }
    if (want("chatluna_binding")) {
      const bindings = await getRows(
        ctx,
        "chatluna_binding"
      );
      for (const row of bindings) {
        if (row.activeConversationId && !convIds.has(row.activeConversationId)) {
          push(makeIssue({
            table: "chatluna_binding",
            recordId: row.bindingKey,
            field: "activeConversationId",
            kind: "dangling-conversation-ref",
            severity: "warning",
            snippet: snippet(row.activeConversationId),
            suggestedFix: "null-field"
          }));
        }
        if (row.lastConversationId && !convIds.has(row.lastConversationId)) {
          push(makeIssue({
            table: "chatluna_binding",
            recordId: row.bindingKey,
            field: "lastConversationId",
            kind: "dangling-conversation-ref",
            severity: "info",
            snippet: snippet(row.lastConversationId),
            suggestedFix: "null-field"
          }));
        }
      }
    }
  }
  return finalizeScanIntegrity(ctx, cfg, input, issues, want, limit);
}
async function messageExists(ctx, id) {
  const rows = await getMessageChainRows(ctx, { id });
  return rows.length > 0;
}
async function finalizeScanIntegrity(ctx, cfg, input, issues, want, limit) {
  const push = (issue) => {
    if (issues.length < limit) issues.push(issue);
  };
  if (want("chatluna_message")) {
    const msgs = await getMessageRows(ctx);
    for (const row of msgs) {
      if (row.tool_calls != null && !isJsonArray(row.tool_calls)) {
        push(makeIssue({
          table: "chatluna_message",
          recordId: row.id,
          field: "tool_calls",
          kind: "invalid-tool-calls",
          severity: "danger",
          snippet: snippet(row.tool_calls),
          suggestedFix: "null-field"
        }));
      }
    }
    if (input.deep) {
      const ids = msgs.slice(0, limit).map((row) => row.id);
      if (ids.length > 0) {
        const fullRows = await ctx.database.get(
          "chatluna_message",
          { id: { $in: ids } }
        );
        for (const row of fullRows) {
          if (row.content) {
            try {
              const decoded = await gzipDecode(row.content);
              if (decoded === "") throw new Error("empty");
              JSON.parse(decoded);
            } catch {
              push(makeIssue({
                table: "chatluna_message",
                recordId: row.id,
                field: "content",
                kind: "malformed-message-content",
                severity: "danger",
                snippet: "<gzip blob>",
                suggestedFix: "remove-row"
              }));
            }
          }
        }
      }
    }
  }
  if (want("chatluna_acl")) {
    const acls = await getRows(ctx, "chatluna_acl");
    for (const row of acls) {
      const recordId = `${row.conversationId}:${row.principalType}:${row.principalId}`;
      if (!ACL_PRINCIPALS.has(row.principalType)) {
        push(makeIssue({
          table: "chatluna_acl",
          recordId,
          field: "principalType",
          kind: "invalid-acl-principal",
          severity: "warning",
          snippet: snippet(row.principalType),
          suggestedFix: "remove-row"
        }));
      }
      if (row.permission && !ACL_PERMISSIONS.has(row.permission)) {
        push(makeIssue({
          table: "chatluna_acl",
          recordId,
          field: "permission",
          kind: "invalid-acl-permission",
          severity: "info",
          snippet: snippet(row.permission),
          suggestedFix: "manual"
        }));
      }
    }
  }
  if (want("chatluna_constraint")) {
    const rules = await getRows(ctx, "chatluna_constraint");
    for (const row of rules) {
      if (row.users != null && typeof row.users === "string" && row.users !== "" && !isJsonArray(row.users)) {
        push(makeIssue({
          table: "chatluna_constraint",
          recordId: String(row.id),
          field: "users",
          kind: "invalid-json",
          severity: "info",
          snippet: snippet(row.users),
          suggestedFix: "null-field"
        }));
      }
      if (row.excludeUsers != null && typeof row.excludeUsers === "string" && row.excludeUsers !== "" && !isJsonArray(row.excludeUsers)) {
        push(makeIssue({
          table: "chatluna_constraint",
          recordId: String(row.id),
          field: "excludeUsers",
          kind: "invalid-json",
          severity: "info",
          snippet: snippet(row.excludeUsers),
          suggestedFix: "null-field"
        }));
      }
    }
  }
  return finalizeScanIntegrityTail(ctx, cfg, input, issues, want, limit);
}
async function finalizeScanIntegrityTail(ctx, cfg, input, issues, want, limit) {
  const push = (issue) => {
    if (issues.length < limit) issues.push(issue);
  };
  if (want("chatluna_archive")) {
    const arcs = await getRows(ctx, "chatluna_archive");
    for (const row of arcs) {
      if (!row.path || typeof row.path !== "string") {
        push(makeIssue({
          table: "chatluna_archive",
          recordId: row.id,
          field: "path",
          kind: "invalid-archive-path",
          severity: "warning",
          snippet: snippet(row.path),
          suggestedFix: "remove-row"
        }));
      }
    }
  }
  if (want("chatluna_data_audit")) {
    const audits2 = await getRows(
      ctx,
      "chatluna_data_audit"
    );
    for (const row of audits2) {
      if (row.detail && !isParseable(row.detail)) {
        push(makeIssue({
          table: "chatluna_data_audit",
          recordId: row.id,
          field: "detail",
          kind: "invalid-audit-payload",
          severity: "info",
          snippet: snippet(row.detail),
          suggestedFix: "null-field"
        }));
      }
      if (row.ids && !isParseable(row.ids)) {
        push(makeIssue({
          table: "chatluna_data_audit",
          recordId: row.id,
          field: "ids",
          kind: "invalid-audit-payload",
          severity: "info",
          snippet: snippet(row.ids),
          suggestedFix: "null-field"
        }));
      }
    }
  }
  if (want("chatluna_meta")) {
    const metas = await getRows(ctx, "chatluna_meta");
    for (const row of metas) {
      if (row.value && !isParseable(row.value)) {
        push(makeIssue({
          table: "chatluna_meta",
          recordId: row.key,
          field: "value",
          kind: "invalid-json",
          severity: "info",
          snippet: snippet(row.value),
          suggestedFix: "null-field"
        }));
      }
    }
  }
  const fixedTables = new Set(
    issues.filter((row) => row.recordId !== "driver-load-error").map((row) => row.table)
  );
  const driverIssues = (await probeLoadErrorsRaw(
    ctx,
    want,
    limit - issues.length
  )).filter((row) => !fixedTables.has(row.table));
  for (const issue of driverIssues) {
    push(issue);
  }
  const byTable = {};
  const byKind = {};
  for (const issue of issues) {
    byTable[issue.table] = (byTable[issue.table] ?? 0) + 1;
    byKind[issue.kind] = (byKind[issue.kind] ?? 0) + 1;
  }
  return {
    scannedAt: (/* @__PURE__ */ new Date()).toISOString(),
    deep: input.deep === true,
    truncated: issues.length >= limit,
    loadErrors: Array.from(loadErrors.values()),
    summary: {
      total: issues.length,
      byTable,
      byKind,
      loadErrors: loadErrors.size
    },
    issues
  };
}
function canRepairIssue(issue, action) {
  if (issue.recordId === "driver-load-error") return false;
  if (issue.field === "<unknown>") return false;
  if (action === "null-field") return issue.suggestedFix === "null-field";
  return true;
}
async function repairIntegrity(ctx, cfg, input) {
  if (!input.confirm) {
    const scan2 = await scanIntegrity(ctx, cfg, {
      limit: cfg.maxPreviewRows ?? 200
    });
    const ids = new Set(input.issueIds);
    const picked = scan2.issues.filter((row) => ids.has(row.id));
    const rows = picked.filter((row) => canRepairIssue(row, input.action));
    const skipped = picked.length - rows.length;
    return {
      mode: "preview",
      action: input.action,
      count: rows.length,
      rows,
      warnings: [
        ...skipped ? [
          `${skipped} \u6761\u626B\u63CF\u9879\u6CA1\u6709\u5B9A\u4F4D\u5230\u771F\u5B9E\u5B57\u6BB5\uFF0C\u5DF2\u8DF3\u8FC7\u81EA\u52A8\u4FEE\u590D\u3002`
        ] : [],
        ...input.action === "remove-row" ? ["\u6574\u884C\u5220\u9664\u4E0D\u53EF\u6062\u590D\uFF0C\u8BF7\u5148\u5907\u4EFD\u3002"] : input.action === "set-value" ? ["\u5C06\u628A\u9009\u4E2D\u5B57\u6BB5\u5199\u6210\u4F60\u8F93\u5165\u7684\u539F\u59CB\u6587\u672C\uFF0C\u8BF7\u786E\u8BA4\u5B57\u6BB5\u7C7B\u578B\u3002"] : [
          "\u5BF9\u5E94\u5B57\u6BB5\u4F1A\u88AB\u5199\u6210 {}\u3001[] \u6216\u7A7A\u5B57\u7B26\u4E32\uFF0C\u8FD0\u884C\u65F6\u4F1A\u91CD\u65B0\u751F\u6210\u3002"
        ]
      ]
    };
  }
  const scan = await scanIntegrity(ctx, cfg, {
    limit: cfg.maxPreviewRows ?? 200
  });
  const issuesById = new Map(scan.issues.map((row) => [row.id, row]));
  const applied = [];
  for (const issueId of input.issueIds) {
    const issue = issuesById.get(issueId);
    if (!issue) continue;
    if (!canRepairIssue(issue, input.action)) continue;
    if (input.action === "remove-row") {
      await removeRowForIssue(ctx, issue);
    } else if (input.action === "set-value") {
      await setFieldForIssue(ctx, issue, input.value ?? "");
    } else {
      await nullFieldForIssue(ctx, issue);
    }
    applied.push(issue);
  }
  pushAudit(
    `integrity.${input.action}`,
    applied.map((row) => row.table).join(","),
    applied.map((row) => row.id),
    { count: applied.length }
  );
  return { mode: "applied", count: applied.length, rows: applied };
}
async function getIntegrityField(ctx, input) {
  if (input.recordId === "driver-load-error" || input.field === "<unknown>") {
    throw new Error("\u8FD9\u4E2A\u626B\u63CF\u9879\u6CA1\u6709\u5B9A\u4F4D\u5230\u5177\u4F53\u884C\u6216\u5B57\u6BB5\uFF0C\u65E0\u6CD5\u8BFB\u53D6\u539F\u503C\u3002");
  }
  const read = async (table, query) => {
    const rows = await ctx.database.get(
      table,
      query
    );
    if (!rows[0]) throw new Error(`record not found: ${input.recordId}`);
    return rows[0];
  };
  let row;
  switch (input.table) {
    case "chatluna_conversation":
      row = await read(input.table, { id: input.recordId });
      break;
    case "chatluna_message":
      row = await read(input.table, { id: input.recordId });
      break;
    case "chatluna_binding":
      row = await read(input.table, { bindingKey: input.recordId });
      break;
    case "chatluna_acl": {
      const [conversationId, principalType, principalId] = input.recordId.split(":");
      row = await read(input.table, {
        conversationId,
        principalType,
        principalId
      });
      break;
    }
    case "chatluna_constraint":
      row = await read(input.table, { id: Number(input.recordId) });
      break;
    case "chatluna_archive":
      row = await read(input.table, { id: input.recordId });
      break;
    case "chatluna_meta":
      row = await read(input.table, { key: input.recordId });
      break;
    case "chatluna_data_audit":
      row = await read(input.table, { id: input.recordId });
      break;
    case "chatluna_data_identity": {
      const [platform, id] = input.recordId.split(":");
      row = await read(input.table, { platform, id });
      break;
    }
    case "chatluna_docstore": {
      const [key, id] = JSON.parse(input.recordId);
      row = sqliteDriver(ctx)._get(
        "SELECT metadata FROM chatluna_docstore WHERE key = ? AND id = ?",
        [key, id]
      );
      break;
    }
    default:
      throw new Error(`unsupported table: ${input.table}`);
  }
  const value = row[input.field];
  return {
    value: value == null ? "" : typeof value === "string" ? value : value instanceof Date ? iso(value) : JSON.stringify(value)
  };
}
async function removeRowForIssue(ctx, issue) {
  const recordId = issue.recordId;
  switch (issue.table) {
    case "chatluna_conversation":
      await ctx.database.remove("chatluna_conversation", { id: recordId });
      return;
    case "chatluna_message":
      sqliteDriver(ctx)._run("DELETE FROM chatluna_message WHERE id = ?", [
        recordId
      ]);
      return;
    case "chatluna_docstore": {
      const [key, id] = JSON.parse(recordId);
      sqliteDriver(ctx)._run(
        "DELETE FROM chatluna_docstore WHERE key = ? AND id = ?",
        [key, id]
      );
      return;
    }
    case "chatluna_binding":
      await ctx.database.remove("chatluna_binding", {
        bindingKey: recordId
      });
      return;
    case "chatluna_acl": {
      const [conversationId, principalType, principalId] = recordId.split(":");
      await ctx.database.remove("chatluna_acl", {
        conversationId,
        principalType,
        principalId
      });
      return;
    }
    case "chatluna_constraint":
      await ctx.database.remove("chatluna_constraint", {
        id: Number(recordId)
      });
      return;
    case "chatluna_archive":
      await ctx.database.remove("chatluna_archive", { id: recordId });
      return;
    case "chatluna_meta":
      await ctx.database.remove("chatluna_meta", { key: recordId });
      return;
    case "chatluna_data_audit":
      await ctx.database.remove("chatluna_data_audit", { id: recordId });
      return;
    case "chatluna_data_identity": {
      const [platform, id] = recordId.split(":");
      await ctx.database.remove("chatluna_data_identity", {
        platform,
        id
      });
      return;
    }
  }
  throw new Error(`unsupported table: ${issue.table}`);
}
function repairValueForIssue(issue) {
  if (issue.kind === "invalid-tool-calls") return "[]";
  if (issue.field === "users" || issue.field === "excludeUsers") return "[]";
  if (issue.field === "ids") return "[]";
  if (issue.field === "activeConversationId") return "";
  if (issue.field === "lastConversationId") return "";
  if (issue.field === "latestMessageId") return "";
  if (issue.kind === "dangling-conversation-ref") return "";
  if (issue.kind === "dangling-latest-message") return "";
  return "{}";
}
async function setFieldForIssue(ctx, issue, value) {
  await applyFieldPatchForIssue(ctx, issue, value);
}
async function nullFieldForIssue(ctx, issue) {
  await applyFieldPatchForIssue(ctx, issue, repairValueForIssue(issue));
}
async function applyFieldPatchForIssue(ctx, issue, value) {
  const { table, recordId, field } = issue;
  const model = ctx.model.tables[table];
  if (recordId === "driver-load-error" || field === "<unknown>" || !model?.fields?.[field] && !(table === "chatluna_docstore" && field === "metadata")) {
    throw new Error(
      `${table}.${field} \u6CA1\u6709\u53EF\u5199\u5165\u7684\u771F\u5B9E\u5B57\u6BB5\u6216\u4E3B\u952E\u3002\u8BF7\u590D\u5236\u62A5\u544A\u540E\u7528 SQLite \u5DE5\u5177\u5B9A\u4F4D\u574F\u884C\uFF0C\u6216\u9009\u62E9\u80FD\u5B9A\u4F4D\u5230\u5177\u4F53 recordId/field \u7684\u626B\u63CF\u9879\u3002`
    );
  }
  const patch = { [field]: value };
  switch (table) {
    case "chatluna_conversation":
      await ctx.database.upsert("chatluna_conversation", [
        { id: recordId, ...patch, updatedAt: /* @__PURE__ */ new Date() }
      ]);
      return;
    case "chatluna_message":
      if (field === "tool_calls") {
        sqliteDriver(ctx)._run(
          "UPDATE chatluna_message SET tool_calls = ? WHERE id = ?",
          [value, recordId]
        );
      } else {
        await ctx.database.upsert("chatluna_message", [
          { id: recordId, ...patch }
        ]);
      }
      return;
    case "chatluna_docstore": {
      const [key, id] = JSON.parse(recordId);
      sqliteDriver(ctx)._run(
        "UPDATE chatluna_docstore SET metadata = ? WHERE key = ? AND id = ?",
        [value, key, id]
      );
      return;
    }
    case "chatluna_binding":
      await ctx.database.upsert("chatluna_binding", [
        {
          bindingKey: recordId,
          ...patch,
          updatedAt: /* @__PURE__ */ new Date()
        }
      ]);
      return;
    case "chatluna_constraint":
      await ctx.database.upsert("chatluna_constraint", [
        { id: Number(recordId), ...patch, updatedAt: /* @__PURE__ */ new Date() }
      ]);
      return;
    case "chatluna_meta":
      await ctx.database.upsert("chatluna_meta", [
        { key: recordId, ...patch, updatedAt: /* @__PURE__ */ new Date() }
      ]);
      return;
    case "chatluna_data_audit":
      await ctx.database.upsert("chatluna_data_audit", [
        { id: recordId, ...patch }
      ]);
      return;
    case "chatluna_data_identity": {
      const [platform, id] = recordId.split(":");
      await ctx.database.upsert("chatluna_data_identity", [
        { platform, id, ...patch, updatedAt: /* @__PURE__ */ new Date() }
      ]);
      return;
    }
  }
  throw new Error(
    `field patch not supported for ${table}.${field}; use remove-row or manual SQL`
  );
}
async function gzipDecode(data) {
  const buf = typeof data === "string" ? Buffer.from(data, "base64") : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : Buffer.from(data);
  return (await gunzipAsync(buf)).toString();
}
function iso(value) {
  if (!value) return "";
  const time = typeof value === "string" ? new Date(value).getTime() : value.getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}
function timeOf(value) {
  if (!value) return 0;
  const time = typeof value === "string" ? new Date(value).getTime() : value.getTime();
  return Number.isFinite(time) ? time : 0;
}
export {
  Config,
  apply,
  inject,
  name
};
