// src/index.ts
import { access, stat } from "fs/promises";
import { constants } from "fs";
import { randomUUID } from "crypto";
import { dirname, resolve } from "path";
import { gunzip } from "zlib";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { Schema } from "koishi";
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
  enableMessageRepair: Schema.boolean().default(false).description("\u5141\u8BB8\u6267\u884C\u6D88\u606F\u94FE parentId/latestMessageId \u4FEE\u590D\u3002")
});
var audits = [];
var rootCtx;
function apply(ctx, cfg) {
  rootCtx = ctx;
  const app = ctx;
  const perm = ctx.command("chatluna-data.permission", {
    authority: 4
  });
  perm.subcommand(".who <target:string>").alias("chatluna-data.perm.who").action(async ({ session }, target) => {
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
  perm.subcommand(".authority <target:string> <value:number>").alias("chatluna-data.perm.authority").action(async ({ session }, target, value) => {
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
  perm.subcommand(".perm-add <target:string> <permission:string>").alias("chatluna-data.perm.add").action(async ({ session }, target, permission) => {
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
  perm.subcommand(".perm-remove <target:string> <permission:string>").alias("chatluna-data.perm.remove").action(async ({ session }, target, permission) => {
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
  perm.subcommand(".channel <channel:string> [assignee:string]").alias("chatluna-data.perm.channel").option("add", "-a <permission:string>").option("remove", "-r <permission:string>").action(async ({ session, options }, channel, assignee) => {
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
    { primary: "id" }
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
    { primary: "id" }
  );
  ctx.model.extend(
    "chatluna_binding",
    {
      bindingKey: "string",
      activeConversationId: "string",
      lastConversationId: "string",
      updatedAt: "timestamp"
    },
    { primary: "bindingKey" }
  );
  ctx.model.extend(
    "chatluna_acl",
    {
      conversationId: "string",
      principalType: "string",
      principalId: "string",
      permission: "string"
    },
    { primary: ["conversationId", "principalType", "principalId"] }
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
    { primary: "id" }
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
  ctx.console.addEntry({
    dev: resolve(root, "../client/index.ts"),
    prod: resolve(root, "../dist")
  });
  ctx.console.addListener(
    "chatluna-data/getOverview",
    async () => overview(ctx, cfg, app),
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
      const [msgs, bindings, acls, arcs] = await Promise.all([
        getRows(ctx, "chatluna_message", {
          conversationId: input.id
        }),
        getRows(ctx, "chatluna_binding"),
        getRows(ctx, "chatluna_acl", {
          conversationId: input.id
        }),
        getRows(ctx, "chatluna_archive", {
          conversationId: input.id
        })
      ]);
      const diag = diagnoseConversation(conv, msgs);
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
          diag.rows.slice(0, input.messageLimit ?? 200).map(async (row) => viewMessage(row))
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
      const [msgs, convs] = await Promise.all([
        getRows(ctx, "chatluna_message"),
        getRows(ctx, "chatluna_conversation")
      ]);
      const map = new Map(convs.map((row) => [row.id, row]));
      const rows = await Promise.all(
        msgs.filter((row) => {
          const conv = map.get(row.conversationId);
          if (input.conversationId && row.conversationId !== input.conversationId) {
            return false;
          }
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
        "chatluna_binding"
      );
      await Promise.all(
        bindings.filter(
          (row) => row.activeConversationId === input.id || row.lastConversationId === input.id
        ).map(
          (row) => ctx.database.upsert("chatluna_binding", [
            {
              bindingKey: row.bindingKey,
              activeConversationId: row.activeConversationId === input.id ? null : row.activeConversationId,
              lastConversationId: row.lastConversationId === input.id ? null : row.lastConversationId,
              updatedAt: /* @__PURE__ */ new Date()
            }
          ])
        )
      );
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
      const msgs = await getRows(ctx, "chatluna_message", {
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
    async () => {
      const [users, kBindings, channels, convs, acls, rules] = await Promise.all([
        getRows(ctx, "user"),
        getRows(ctx, "binding"),
        getRows(ctx, "channel"),
        getRows(ctx, "chatluna_conversation"),
        getRows(ctx, "chatluna_acl"),
        getRows(ctx, "chatluna_constraint")
      ]);
      const userById = new Map(users.map((row) => [row.id, row]));
      const bindingsByAid = /* @__PURE__ */ new Map();
      const convCountByPrincipal = /* @__PURE__ */ new Map();
      const aclCountByPrincipal = /* @__PURE__ */ new Map();
      const ruleCountByPrincipal = /* @__PURE__ */ new Map();
      const convCountByGuild = /* @__PURE__ */ new Map();
      for (const row of kBindings) {
        bindingsByAid.set(row.aid, [
          ...bindingsByAid.get(row.aid) ?? [],
          row
        ]);
      }
      for (const conv of convs) {
        const route = parseBindingKey(conv.bindingKey);
        for (const id of /* @__PURE__ */ new Set([conv.createdBy, route.userId])) {
          if (!id) continue;
          convCountByPrincipal.set(
            id,
            (convCountByPrincipal.get(id) ?? 0) + 1
          );
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
        return {
          id: row.id,
          name: row.name,
          authority: row.authority,
          permissions: row.permissions ?? [],
          createdAt: iso(row.createdAt),
          bindings: refs.length,
          platforms: Array.from(
            new Set(refs.map((item) => item.platform))
          ),
          principals: ids,
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
          )
        };
      });
      const perms = Array.from(
        /* @__PURE__ */ new Set([
          ...users.flatMap((row) => row.permissions ?? []),
          ...channels.flatMap((row) => row.permissions ?? [])
        ])
      ).sort();
      const issues = [
        ...userRows.filter((row) => row.authority >= 4).map((row) => ({
          level: "warning",
          type: "high-authority",
          target: row.name || String(row.id),
          message: `\u7528\u6237 authority=${row.authority}`,
          action: "\u786E\u8BA4\u662F\u5426\u9700\u8981\u4FDD\u7559\u9AD8\u6743\u9650\u3002"
        })),
        ...userRows.filter((row) => row.bindings === 0 && row.authority > 0).map((row) => ({
          level: "info",
          type: "user-without-binding",
          target: row.name || String(row.id),
          message: "Koishi \u7528\u6237\u6CA1\u6709\u5E73\u53F0\u8D26\u53F7\u7ED1\u5B9A\u3002",
          action: "\u5982\u679C\u8FD9\u662F\u5386\u53F2\u7528\u6237\uFF0C\u53EF\u4EE5\u4FDD\u7559\uFF1B\u5426\u5219\u68C0\u67E5 binding \u8868\u3002"
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
          action: "\u9700\u8981\u5B9A\u5411\u673A\u5668\u4EBA\u53D7\u7406\u65F6\u586B\u5199 assignee\u3002"
        })),
        ...channels.filter((row) => (row.permissions ?? []).length > 0).map((row) => ({
          level: "info",
          type: "channel-permissions",
          target: `${row.platform}:${row.id}`,
          message: `\u9891\u9053\u6743\u9650: ${(row.permissions ?? []).join(", ")}`,
          action: "\u786E\u8BA4\u8FD9\u4E9B\u6743\u9650\u662F\u5426\u4ECD\u7136\u9700\u8981\u3002"
        }))
      ];
      return {
        totals: {
          users: users.length,
          bindings: kBindings.length,
          channels: channels.length,
          acl: acls.length,
          issues: issues.length
        },
        permissions: perms,
        issues: issues.slice(0, cfg.maxPreviewRows),
        users: userRows.sort((a, b) => b.authority - a.authority),
        bindings: kBindings.map((row) => {
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
          (a, b) => `${a.platform}:${a.pid}`.localeCompare(
            `${b.platform}:${b.pid}`
          )
        ),
        channels: channels.map((row) => ({
          id: row.id,
          platform: row.platform,
          guildId: row.guildId,
          assignee: row.assignee,
          permissions: row.permissions ?? [],
          createdAt: iso(row.createdAt),
          conversations: convCountByGuild.get(row.id) ?? 0,
          acl: aclCountByPrincipal.get(row.id) ?? 0
        })).sort(
          (a, b) => `${a.platform}:${a.id}`.localeCompare(
            `${b.platform}:${b.id}`
          )
        )
      };
    },
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
        await Promise.all(
          prev.rows.map(async (row) => {
            const [conv] = await ctx.database.get(
              "chatluna_conversation",
              { id: row.id }
            );
            await clearRuntime(app, conv);
          })
        );
        pushAudit("operation.model-migration", input.targetModel, [
          ...prev.rows.map((row) => row.id)
        ]);
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
        const msgs = await getRows(
          ctx,
          "chatluna_message",
          { conversationId: input.conversationId }
        );
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
  });
}
async function getRows(ctx, table, query = {}) {
  return await ctx.database.get(table, query);
}
async function previewKoishiPermissionPlan(ctx, cfg, input) {
  const [users, kBindings, channels, convs] = await Promise.all([
    getRows(ctx, "user"),
    getRows(ctx, "binding"),
    getRows(ctx, "channel"),
    getRows(ctx, "chatluna_conversation")
  ]);
  const bindingsByAid = /* @__PURE__ */ new Map();
  const chatUsers = /* @__PURE__ */ new Set();
  const chatGuilds = /* @__PURE__ */ new Set();
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
    return row.authority === 0 && (row.permissions ?? []).length === 0;
  }).map((row) => {
    const current = row.permissions ?? [];
    const next = input.permissionMode === "replace" ? perms : input.permissionMode === "remove" ? current.filter((item) => !perms.includes(item)) : Array.from(/* @__PURE__ */ new Set([...current, ...perms]));
    return {
      kind: "user",
      id: row.id,
      platform: (bindingsByAid.get(row.id) ?? []).map((item) => item.platform).join(", ") || "-",
      name: row.name || `\u7528\u6237 ${row.id}`,
      reason: input.target === "chatluna-users" ? "\u5E73\u53F0\u8D26\u53F7\u51FA\u73B0\u5728 ChatLuna \u4F1A\u8BDD\u4E2D" : input.target === "bound-users" ? "\u5B58\u5728\u5E73\u53F0\u8D26\u53F7\u7ED1\u5B9A" : input.target === "unconfigured-users" ? "authority \u4E0E permissions \u5747\u4E3A\u7A7A" : "\u5339\u914D\u5168\u90E8 Koishi \u7528\u6237",
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
async function overview(ctx, cfg, app) {
  const [convs, msgs, acls, rules, arcs, bindings, metas] = await Promise.all([
    getRows(ctx, "chatluna_conversation"),
    getRows(ctx, "chatluna_message"),
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
  const issues = convs.map((row) => diagnoseConversation(row, msgs)).filter((row) => row.issues.length > 0);
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
    audits
  };
}
async function health(ctx, cfg, app) {
  const [convs, msgs, bindings, acls, rules, arcs] = await Promise.all([
    getRows(ctx, "chatluna_conversation"),
    getRows(ctx, "chatluna_message"),
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
  for (const conv of convs) {
    const diag = diagnoseConversation(
      conv,
      msgs.filter((row) => row.conversationId === conv.id)
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
function diagnoseConversation(conv, messages) {
  const rows = messages.filter((row) => row.conversationId === conv.id);
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
  for (const acl of acls) {
    for (const row of map.values()) {
      if (row.latestConversationId === acl.conversationId) row.acl += 1;
    }
  }
  for (const rule of rules) {
    for (const row of map.values()) {
      const byPlatform = rule.platform == null || rule.platform === row.platform;
      const bySelf = rule.selfId == null || rule.selfId === row.selfId;
      const byGuild = rule.guildId == null || rule.guildId === row.guildId;
      const byUser = readUserList(rule.users).length === 0 || readUserList(rule.users).includes(row.userId);
      const excluded = readUserList(rule.excludeUsers).includes(row.userId);
      if (byPlatform && bySelf && byGuild && byUser && !excluded) {
        row.constraints += 1;
      }
    }
  }
  for (const row of map.values()) {
    const refs = kBindings.filter(
      (item) => item.platform === row.platform && item.pid === row.userId
    );
    row.koishiBindingCount = refs.length;
    const user = users.find((item) => refs.some((ref) => ref.aid === item.id));
    if (user) {
      row.koishiUserId = user.id;
      row.koishiUserName = user.name;
      row.koishiUserAuthority = user.authority;
      row.koishiUserPermissions = user.permissions ?? [];
    }
    const channel = channels.find(
      (item) => item.platform === row.platform && (item.id === row.guildId || item.guildId === row.guildId)
    );
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
    const msgs = await getRows(ctx, "chatluna_message", {
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
function pushAudit(action, target, ids, detail = {}) {
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
async function gzipDecode(data) {
  const buf = typeof data === "string" ? Buffer.from(data, "base64") : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : Buffer.from(data);
  return (await gunzipAsync(buf)).toString();
}
function iso(value) {
  if (!value) return "";
  return typeof value === "string" ? value : value.toISOString();
}
function timeOf(value) {
  if (!value) return 0;
  return typeof value === "string" ? new Date(value).getTime() : value.getTime();
}
export {
  Config,
  apply,
  inject,
  name
};
