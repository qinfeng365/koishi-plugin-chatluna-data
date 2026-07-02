import { access, stat } from 'fs/promises'
import { constants } from 'fs'
import { randomUUID } from 'crypto'
import { dirname, resolve } from 'path'
import { gunzip } from 'zlib'
import { promisify } from 'util'
import { fileURLToPath } from 'url'
import { Context, Schema, $, Logger } from 'koishi'
import type {} from '@koishijs/plugin-console'
import type {} from '@koishijs/console'

const gunzipAsync = promisify(gunzip)
const root =
    typeof __dirname === 'string'
        ? __dirname
        : dirname(fileURLToPath(import.meta.url))

export const name = 'chatluna-data'

export const inject = {
    required: ['database', 'console'],
    optional: ['chatluna']
}

export interface Config {
    pageSize: number
    readonly: boolean
    maxPreviewRows: number
    enableArchiveFileOps: boolean
    enableMessageRepair: boolean
    identityRefreshLimitPerBatch: number
    identityRefreshInterval: number
    inactiveWarningDays: number
    enableIdentityLookup: boolean
    enableKoishiPermissionCommands: boolean
}

export const Config: Schema<Config> = Schema.object({
    pageSize: Schema.number()
        .min(10)
        .max(200)
        .default(40)
        .description('默认分页大小。'),
    readonly: Schema.boolean()
        .default(false)
        .description('只读模式会隐藏写按钮，并拒绝所有写 RPC。'),
    maxPreviewRows: Schema.number()
        .min(10)
        .max(1000)
        .default(200)
        .description('危险操作预览最多返回的对象数量。'),
    enableArchiveFileOps: Schema.boolean()
        .default(false)
        .description('允许检查归档文件是否存在与读取文件大小。'),
    enableMessageRepair: Schema.boolean()
        .default(false)
        .description('允许执行消息链 parentId/latestMessageId 修复。'),
    identityRefreshLimitPerBatch: Schema.number()
        .min(1)
        .max(200)
        .default(30)
        .description('每次批量刷新平台身份资料的最大数量。'),
    identityRefreshInterval: Schema.number()
        .min(0)
        .max(10000)
        .default(800)
        .role('ms')
        .description('批量刷新平台身份资料时，每个请求之间的等待时间。'),
    inactiveWarningDays: Schema.number()
        .min(1)
        .max(3650)
        .default(180)
        .description('超过多少天未活跃时在权限页提示。'),
    enableIdentityLookup: Schema.boolean()
        .default(true)
        .description('允许手动调用平台 API 刷新用户昵称和头像。'),
    enableKoishiPermissionCommands: Schema.boolean()
        .default(true)
        .description('注册 Koishi 权限治理指令。')
})

const audits: AuditEntry[] = []
const opsErrors: OpsErrorEntry[] = []
let rootCtx: Context
let permissionCache: {
    expiresAt: number
    data?: PermissionSnapshot
    task?: Promise<PermissionSnapshot>
} = { expiresAt: 0 }
type PermissionSnapshot = Awaited<ReturnType<typeof buildPermissionSnapshot>>

export function apply(ctx: Context, cfg: Config) {
    rootCtx = ctx
    const app = ctx as Context & {
        chatluna?: {
            platform?: {
                _platformClients?: Record<string, PlatformClient>
                _createClientFunctions?: Record<string, () => PlatformClient>
                _models?: Record<string, ModelEntry[]>
                _tools?: Record<string, ToolEntry>
                _chatChains?: Record<string, ChainEntry>
                _vectorStore?: Record<string, unknown>
                createClient?: (platform: string) => Promise<PlatformClient>
                refreshClient?: (
                    client: PlatformClient,
                    platform: string
                ) => Promise<void>
            }
            getPlugin?: (platform: string) => PluginEntry | undefined
            preset?: {
                _presets?: {
                    value?: PresetEntry[]
                }
                getAllPreset?: (concatKeyword?: boolean) => {
                    value: string[]
                }
                resolvePresetDir?: () => string
            }
            config?: ChatLunaRuntimeConfig
            currentConfig?: ChatLunaRuntimeConfig
            conversationRuntime?: {
                clearConversationInterface: (
                    conversation: ConversationRecord
                ) => Promise<boolean>
            }
        }
    }

    const perm = cfg.enableKoishiPermissionCommands
        ? ctx.command('chatluna-data.permission', {
              authority: 4
          })
        : null

    perm?.subcommand('.who <target:string>')
        .alias('chatluna-data.perm.who')
        .action(async ({ session }, target) => {
            if (!target) return '请输入 Koishi 用户 ID 或平台用户 ID。'
            const user = await findKoishiUser(ctx, target)
            if (!user) return `找不到用户：${target}`
            const bindings = await getRows<KoishiBindingRecord>(ctx, 'binding', {
                aid: user.id
            })
            return [
                `Koishi 用户：${user.name || user.id}`,
                `id：${user.id}`,
                `authority：${user.authority}`,
                `permissions：${(user.permissions ?? []).join(', ') || '-'}`,
                `bindings：${
                    bindings
                        .map((row) => `${row.platform}:${row.pid}`)
                        .join(', ') || '-'
                }`
            ].join('\n')
        })

    perm?.subcommand('.authority <target:string> <value:number>')
        .alias('chatluna-data.perm.authority')
        .action(async ({ session }, target, value) => {
            if (cfg.readonly) return 'readonly 模式已启用，拒绝修改。'
            if (!target || value == null) return '用法：authority <用户> <等级>'
            const user = await findKoishiUser(ctx, target)
            if (!user) return `找不到用户：${target}`
            await ctx.database.upsert('user', [
                {
                    id: user.id,
                    authority: value
                }
            ])
            pushAudit('command.koishi-user.authority', String(user.id), [], {
                operator: session.userId,
                value
            })
            return `已设置 ${user.name || user.id} 的 authority 为 ${value}。`
        })

    perm?.subcommand('.perm-add <target:string> <permission:string>')
        .alias('chatluna-data.perm.add')
        .action(async ({ session }, target, permission) => {
            if (cfg.readonly) return 'readonly 模式已启用，拒绝修改。'
            if (!target || !permission) {
                return '用法：perm-add <用户> <权限字符串>'
            }
            const user = await findKoishiUser(ctx, target)
            if (!user) return `找不到用户：${target}`
            await ctx.database.upsert('user', [
                {
                    id: user.id,
                    permissions: Array.from(
                        new Set([...(user.permissions ?? []), permission])
                    )
                }
            ])
            pushAudit('command.koishi-user.permission-add', String(user.id), [], {
                operator: session.userId,
                permission
            })
            return `已为 ${user.name || user.id} 添加权限 ${permission}。`
        })

    perm?.subcommand('.perm-remove <target:string> <permission:string>')
        .alias('chatluna-data.perm.remove')
        .action(async ({ session }, target, permission) => {
            if (cfg.readonly) return 'readonly 模式已启用，拒绝修改。'
            if (!target || !permission) {
                return '用法：perm-remove <用户> <权限字符串>'
            }
            const user = await findKoishiUser(ctx, target)
            if (!user) return `找不到用户：${target}`
            await ctx.database.upsert('user', [
                {
                    id: user.id,
                    permissions: (user.permissions ?? []).filter(
                        (item) => item !== permission
                    )
                }
            ])
            pushAudit(
                'command.koishi-user.permission-remove',
                String(user.id),
                [],
                {
                    operator: session.userId,
                    permission
                }
            )
            return `已移除 ${user.name || user.id} 的权限 ${permission}。`
        })

    perm?.subcommand('.channel <channel:string> [assignee:string]')
        .alias('chatluna-data.perm.channel')
        .option('add', '-a <permission:string>')
        .option('remove', '-r <permission:string>')
        .action(async ({ session, options }, channel, assignee) => {
            if (cfg.readonly) return 'readonly 模式已启用，拒绝修改。'
            if (!channel) return '用法：channel <频道 ID> [assignee]'
            const [row] = await ctx.database.get('channel', { id: channel })
            if (!row) return `找不到频道：${channel}`
            const current = row.permissions ?? []
            const permissions = options.add
                ? Array.from(new Set([...current, options.add]))
                : options.remove
                  ? current.filter((item) => item !== options.remove)
                  : current
            await ctx.database.upsert('channel', [
                {
                    id: row.id,
                    platform: row.platform,
                    assignee: assignee ?? row.assignee,
                    permissions
                }
            ])
            pushAudit('command.koishi-channel.permission', row.id, [], {
                operator: session.userId,
                assignee,
                add: options.add,
                remove: options.remove
            })
            return [
                `已更新频道 ${row.platform}:${row.id}`,
                `assignee：${(assignee ?? row.assignee) || '-'}`,
                `permissions：${permissions.join(', ') || '-'}`
            ].join('\n')
        })

    perm?.subcommand('.bindings <target:string>')
        .alias('chatluna-data.perm.bindings')
        .action(async ({}, target) => {
            if (!target) return '请输入 Koishi 用户 ID 或平台用户 ID。'
            const user = await findKoishiUser(ctx, target)
            if (!user) return `找不到用户：${target}`
            const rows = await getRows<KoishiBindingRecord>(ctx, 'binding', {
                aid: user.id
            })
            if (!rows.length) return `用户 ${user.id} 没有平台绑定。`
            return rows
                .map((row) => `${row.platform}:${row.pid} -> aid=${row.aid}`)
                .join('\n')
        })

    perm?.subcommand('.inactive [days:number]')
        .alias('chatluna-data.perm.inactive')
        .action(async ({}, days) => {
            const result = await getPermissionOverviewData(ctx, cfg, {
                page: 1,
                pageSize: cfg.maxPreviewRows,
                inactiveDays: days ?? cfg.inactiveWarningDays
            })
            if (!result.users.length) return '没有匹配的长期未活跃用户。'
            return result.users
                .map(
                    (row) =>
                        `${row.displayName} (${row.id}) authority=${row.authority} inactive=${row.inactiveDays ?? '-'}d`
                )
                .join('\n')
        })

    perm?.subcommand('.check <target:string> [command:string]')
        .alias('chatluna-data.perm.check')
        .option('channel', '-c <channel:string>')
        .action(async ({ options }, target, command) => {
            if (!target) return '请输入 Koishi 用户 ID 或平台用户 ID。'
            const result = await diagnoseKoishiPermission(ctx, {
                target,
                command,
                channel: options.channel
            })
            return [
                `结果：${result.allowed ? '允许' : '拒绝'}`,
                `状态：${result.status}`,
                ...result.reasons.map((row) => `- ${row}`)
            ].join('\n')
        })

    perm?.subcommand('.auto <rule:string>')
        .alias('chatluna-data.perm.auto')
        .action(async ({ session }, rule) => {
            if (cfg.readonly) return 'readonly 模式已启用，拒绝修改。'
            if (!rule) return '用法：auto <inactive-down|channels-assign>'
            const input: KoishiMaintenanceInput =
                rule === 'channels-assign'
                    ? { type: 'channels-assign', assignee: session.selfId }
                    : {
                          type: 'inactive-down',
                          days: cfg.inactiveWarningDays,
                          authority: 0,
                          permissions: []
                      }
            const plan = await previewKoishiMaintenance(ctx, cfg, input)
            return [
                `规则：${rule}`,
                `影响：${plan.count}`,
                '请在控制台预览后应用。'
            ].join('\n')
        })

    ctx.model.extend(
        'chatluna_conversation',
        {
            id: 'string',
            seq: 'unsigned',
            bindingKey: 'string',
            title: 'text',
            model: 'string',
            preset: 'string',
            chatMode: 'string',
            createdBy: 'string',
            createdAt: 'timestamp',
            updatedAt: 'timestamp',
            lastChatAt: 'timestamp',
            status: 'string',
            latestMessageId: 'string',
            additional_kwargs: 'text',
            compression: 'string',
            archivedAt: 'timestamp',
            archiveId: 'string',
            legacyRoomId: 'unsigned',
            legacyMeta: 'text',
            autoTitle: 'boolean'
        },
        {
            primary: 'id',
            indexes: [
                { keys: { bindingKey: 'asc' } },
                { keys: { status: 'asc' } },
                { keys: { model: 'asc' } },
                { keys: { createdBy: 'asc' } },
                { keys: { updatedAt: 'desc' } }
            ]
        }
    )
    ctx.model.extend(
        'chatluna_message',
        {
            id: 'string',
            conversationId: 'string',
            parentId: 'string',
            role: 'string',
            text: 'text',
            content: 'binary',
            name: 'string',
            tool_call_id: 'string',
            tool_calls: 'text',
            additional_kwargs_binary: 'binary',
            response_metadata_binary: 'binary',
            rawId: 'string',
            createdAt: 'timestamp'
        },
        {
            primary: 'id',
            indexes: [
                { keys: { conversationId: 'asc' } },
                { keys: { parentId: 'asc' } }
            ]
        }
    )
    ctx.model.extend(
        'chatluna_binding',
        {
            bindingKey: 'string',
            activeConversationId: 'string',
            lastConversationId: 'string',
            updatedAt: 'timestamp'
        },
        {
            primary: 'bindingKey',
            indexes: [
                { keys: { activeConversationId: 'asc' } },
                { keys: { lastConversationId: 'asc' } }
            ]
        }
    )
    ctx.model.extend(
        'chatluna_acl',
        {
            conversationId: 'string',
            principalType: 'string',
            principalId: 'string',
            permission: 'string'
        },
        {
            primary: ['conversationId', 'principalType', 'principalId'],
            indexes: [{ keys: { principalId: 'asc' } }]
        }
    )
    ctx.model.extend(
        'chatluna_constraint',
        {
            id: 'unsigned',
            name: 'string',
            enabled: 'boolean',
            priority: 'integer',
            createdBy: 'string',
            createdAt: 'timestamp',
            updatedAt: 'timestamp',
            platform: 'string',
            selfId: 'string',
            guildId: 'string',
            channelId: 'string',
            direct: 'boolean',
            users: 'text',
            excludeUsers: 'text',
            routeMode: 'string',
            routeKey: 'string',
            activePresetLane: 'string',
            defaultModel: 'string',
            defaultPreset: 'string',
            defaultChatMode: 'string',
            fixedModel: 'string',
            fixedPreset: 'string',
            fixedChatMode: 'string',
            lockConversation: 'boolean',
            allowNew: 'boolean',
            allowSwitch: 'boolean',
            allowArchive: 'boolean',
            allowExport: 'boolean',
            manageMode: 'string'
        },
        { primary: 'id' }
    )
    ctx.model.extend(
        'chatluna_archive',
        {
            id: 'string',
            conversationId: 'string',
            path: 'string',
            formatVersion: 'integer',
            messageCount: 'integer',
            checksum: 'string',
            size: 'unsigned',
            state: 'string',
            createdAt: 'timestamp',
            restoredAt: 'timestamp'
        },
        {
            primary: 'id',
            indexes: [{ keys: { conversationId: 'asc' } }]
        }
    )
    ctx.model.extend(
        'chatluna_meta',
        {
            key: 'string',
            value: 'text',
            updatedAt: 'timestamp'
        },
        { primary: 'key' }
    )
    ctx.model.extend(
        'chatluna_data_audit',
        {
            id: 'string',
            action: 'string',
            target: 'string',
            ids: 'text',
            count: 'integer',
            detail: 'text',
            createdAt: 'timestamp'
        },
        { primary: 'id' }
    )
    ctx.model.extend(
        'chatluna_data_identity',
        {
            platform: 'string',
            id: 'string',
            name: 'string',
            avatar: 'text',
            source: 'string',
            error: 'text',
            updatedAt: 'timestamp'
        },
        { primary: ['platform', 'id'] }
    )
    ctx.model.extend(
        'chatluna_data_ops_error',
        {
            id: 'string',
            source: 'string',
            level: 'string',
            logger: 'string',
            message: 'text',
            kind: 'string',
            title: 'text',
            severity: 'string',
            analysis: 'text',
            createdAt: 'timestamp'
        },
        {
            primary: 'id',
            indexes: [
                { keys: { createdAt: 'desc' } },
                { keys: { kind: 'asc' } }
            ]
        }
    )

    ctx.console.addEntry({
        dev: resolve(root, '../client/index.ts'),
        prod: resolve(root, '../dist')
    })

    const opsTarget: Logger.Target = {
        levels: { base: Logger.WARN },
        record: (record) => {
            void recordOpsLog(ctx, cfg, record).catch(() => {})
        }
    }
    Logger.targets.push(opsTarget)
    ctx.on('dispose', () => {
        const idx = Logger.targets.indexOf(opsTarget)
        if (idx >= 0) Logger.targets.splice(idx, 1)
    })

    // Wrap every listener so minato's JSON.parse-on-load crashes (raised by
    // dirty rows in tables we read) become a structured error the frontend
    // can surface, instead of taking the whole console down. Every handler
    // we register goes through this. We intentionally keep the original
    // method available so we can call through to it.
    const originalAddListener: typeof ctx.console.addListener =
        ctx.console.addListener.bind(ctx.console)
    ctx.console.addListener = ((
        path: string,
        callback: (...args: unknown[]) => unknown,
        options?: unknown
    ) => {
        const wrapped = async (...args: unknown[]) => {
            try {
                return await callback(...args)
            } catch (err) {
                if (isMinatoLoadError(err)) {
                    recordLoadError(path, err, args[0])
                    const message =
                        err instanceof Error ? err.message : String(err)
                    const result = await analyzeOpsError(ctx, cfg, {
                        text: message
                    })
                    await pushOpsError(
                        ctx,
                        {
                            source: 'rpc',
                            level: 'error',
                            logger: path,
                            message
                        },
                        result
                    )
                    throw new Error(
                        `数据库脏数据阻止了 ${path}: ${message}。请前往「高级 / 完整性」面板查看。`
                    )
                }
                throw err
            }
        }
        return originalAddListener(path as never, wrapped as never, options as never)
    }) as typeof ctx.console.addListener

    ctx.console.addListener(
        'chatluna-data/getOverview',
        async () => overview(ctx, cfg, app),
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/getModelHealth',
        async (input: ModelHealthInput = {}) => modelHealth(ctx, cfg, app, input),
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/listProviders',
        async (input: ListInput = {}) => {
            const convs = await getRows<ConversationRecord>(
                ctx,
                'chatluna_conversation'
            )
            return pageRows(
                buildProviders(app, convs),
                input,
                (row) =>
                    [
                        row.platform,
                        row.state,
                        row.capabilities.join('\n'),
                        row.models.map((model) => model.name).join('\n')
                    ].join('\n'),
                (a, b) => a.platform.localeCompare(b.platform),
                cfg
            )
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/getProviderDetail',
        async (input: ProviderInput) => {
            const convs = await getRows<ConversationRecord>(
                ctx,
                'chatluna_conversation'
            )
            return buildProviderDetail(app, convs, input.platform)
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/refreshProvider',
        async (input: ProviderInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            const platform = app.chatluna?.platform
            const client =
                platform?._platformClients?.[input.platform] ??
                (await platform?.createClient?.(input.platform))
            if (!client) throw new Error(`provider ${input.platform} not found`)
            await platform?.refreshClient?.(client, input.platform)
            pushAudit('provider.refresh', input.platform, [])
            return { ok: true }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/listUsers',
        async (input: ListInput = {}) => {
            const [convs, acls, rules] = await Promise.all([
                getRows<ConversationRecord>(ctx, 'chatluna_conversation'),
                getRows<AclRecord>(ctx, 'chatluna_acl'),
                getRows<ConstraintRecord>(ctx, 'chatluna_constraint')
            ])
            return pageRows(
                buildUsers(convs, acls, rules),
                input,
                (row) =>
                    `${row.userId}\n${row.guildId}\n${row.bindingKeys.join('\n')}`,
                (a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt),
                cfg
            )
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/listContexts',
        async (input: ListInput = {}) => {
            const [convs, bindings, acls, rules, users, kBindings, channels] =
                await Promise.all([
                    getRows<ConversationRecord>(ctx, 'chatluna_conversation'),
                    getRows<BindingRecord>(ctx, 'chatluna_binding'),
                    getRows<AclRecord>(ctx, 'chatluna_acl'),
                    getRows<ConstraintRecord>(ctx, 'chatluna_constraint'),
                    getRows<KoishiUserRecord>(ctx, 'user'),
                    getRows<KoishiBindingRecord>(ctx, 'binding'),
                    getRows<KoishiChannelRecord>(ctx, 'channel')
                ])
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
                (row) =>
                    [
                        row.bindingKey,
                        row.baseKey,
                        row.platform,
                        row.selfId,
                        row.guildId,
                        row.userId,
                        row.koishiUserName,
                        row.channelAssignee
                    ].join('\n'),
                (a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt),
                cfg
            )
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/listResources',
        async (input: ListInput = {}) => {
            const [convs, rules] = await Promise.all([
                getRows<ConversationRecord>(ctx, 'chatluna_conversation'),
                getRows<ConstraintRecord>(ctx, 'chatluna_constraint')
            ])
            return pageRows(
                buildResources(app, convs, rules),
                input,
                (row) =>
                    [
                        row.type,
                        row.name,
                        row.description,
                        row.source,
                        row.group,
                        row.tags.join('\n')
                    ].join('\n'),
                (a, b) =>
                    `${a.type}:${a.name}`.localeCompare(`${b.type}:${b.name}`),
                cfg
            )
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/getHealth',
        async () => health(ctx, cfg, app),
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/analyzeOpsError',
        async (input: OpsErrorInput = {}) => {
            const result = await analyzeOpsError(ctx, cfg, input)
            if (input.text?.trim()) {
                await pushOpsError(
                    ctx,
                    {
                        source: 'manual',
                        level: 'error',
                        logger: 'console',
                        message: input.text.trim()
                    },
                    result
                )
            }
            return result
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/listOpsErrors',
        async () => ({ rows: opsErrors }),
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/resetOpsErrors',
        async () => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            const count = opsErrors.length
            opsErrors.splice(0, opsErrors.length)
            await ctx.database.remove('chatluna_data_ops_error', {})
            pushAudit('ops-error.reset', 'chatluna_data_ops_error', [])
            return { count }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/getConfig',
        async () => {
            const fork = findChatLunaFork(ctx)
            const source =
                (fork?.fork.config as Partial<ChatLunaRuntimeConfig>) ??
                app.chatluna?.currentConfig ??
                app.chatluna?.config ??
                {}
            return {
                config: { ...chatlunaConfigDefaults(), ...source },
                runtime: {
                    connected: app.chatluna != null,
                    source: fork?.key ?? 'runtime',
                    writable:
                        fork != null &&
                        ctx.get('loader')?.writable === true &&
                        !cfg.readonly
                },
                choices: {
                    models: liveModels(app),
                    chatModes: Object.keys(
                        app.chatluna?.platform?._chatChains ?? {}
                    ).sort(),
                    presets: (
                        app.chatluna?.preset?.getAllPreset?.(true).value ?? []
                    ).sort(),
                    embeddings: Object.entries(
                        app.chatluna?.platform?._models ?? {}
                    )
                        .flatMap(([platform, rows]) =>
                            rows
                                .filter((row) => row.type === 2)
                                .map((row) => `${platform}/${row.name}`)
                        )
                        .sort(),
                    vectorStores: Object.keys(
                        app.chatluna?.platform?._vectorStore ?? {}
                    ).sort()
                }
            }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/saveConfig',
        async (input: ConfigInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            const fork = findChatLunaFork(ctx)
            if (!fork) throw new Error('chatluna plugin fork not found')
            if (ctx.get('loader')?.writable !== true) {
                throw new Error('koishi config file is readonly')
            }
            const next = {
                ...(fork.fork.config as Record<string, unknown>),
                ...input.config
            }
            fork.fork.update(next)
            pushAudit('config.save', fork.key, [])
            return { ok: true, key: fork.key }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/getUserDetail',
        async (input: UserInput) => {
            const [
                convs,
                acls,
                rules,
                bindings,
                users,
                kBindings,
                channels
            ] = await Promise.all([
                getRows<ConversationRecord>(ctx, 'chatluna_conversation'),
                getRows<AclRecord>(ctx, 'chatluna_acl'),
                getRows<ConstraintRecord>(ctx, 'chatluna_constraint'),
                getRows<BindingRecord>(ctx, 'chatluna_binding'),
                getRows<KoishiUserRecord>(ctx, 'user'),
                getRows<KoishiBindingRecord>(ctx, 'binding'),
                getRows<KoishiChannelRecord>(ctx, 'channel')
            ])
            const rows = convs.filter(
                (row) =>
                    row.createdBy === input.userId ||
                    row.bindingKey.includes(input.userId)
            )
            const ctxs = buildContexts(
                convs,
                bindings,
                acls,
                rules,
                users,
                kBindings,
                channels
            ).filter((row) => row.userId === input.userId)
            const ids = new Set(rows.map((row) => row.id))
            return {
                user: buildUsers(convs, acls, rules).find(
                    (row) => row.userId === input.userId
                ),
                contexts: ctxs,
                koishiBindings: kBindings.filter(
                    (row) => row.pid === input.userId
                ),
                koishiUsers: users.filter((row) =>
                    kBindings.some(
                        (item) =>
                            item.pid === input.userId && item.aid === row.id
                    )
                ),
                channels: channels.filter((row) =>
                    ctxs.some(
                        (item) =>
                            item.platform === row.platform &&
                            (item.guildId === row.id ||
                                item.guildId === row.guildId)
                    )
                ),
                conversations: rows
                    .sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt))
                    .map((row) => viewConversation(row)),
                acl: acls.filter(
                    (row) =>
                        row.principalId === input.userId ||
                        ids.has(row.conversationId)
                ),
                constraints: rules
                    .filter((row) =>
                        [
                            ...readUserList(row.users),
                            ...readUserList(row.excludeUsers),
                            row.createdBy
                        ].includes(input.userId)
                    )
                    .map((row) => viewConstraint(row)),
                bindings: bindings.filter((row) =>
                    row.bindingKey.includes(input.userId)
                )
            }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/listConversations',
        async (input: ConversationInput = {}) => {
            const rows = await getRows<ConversationRecord>(
                ctx,
                'chatluna_conversation'
            )
            return pageRows(
                rows
                    .filter((row) => {
                        if (input.status && row.status !== input.status) {
                            return false
                        }
                        if (input.model && row.model !== input.model) {
                            return false
                        }
                        if (
                            input.user &&
                            row.createdBy !== input.user &&
                            !row.bindingKey.includes(input.user)
                        ) {
                            return false
                        }
                        return true
                    })
                    .map((row) => viewConversation(row)),
                input,
                (row) =>
                    [
                        row.id,
                        row.title,
                        row.model,
                        row.preset,
                        row.chatMode,
                        row.bindingKey,
                        row.createdBy,
                        row.latestMessageId
                    ].join('\n'),
                (a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt),
                cfg
            )
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/getConversationDetail',
        async (input: ConversationDetailInput) => {
            const [conv] = await ctx.database.get('chatluna_conversation', {
                id: input.id
            })
            const messageLimit = Math.max(1, input.messageLimit ?? 200)
            // Diagnose the chain over a lightweight projection (no binary
            // blobs) so we can handle conversations with thousands of rows
            // without loading every gzipped content payload. Then fetch the
            // first `messageLimit` chained rows in full so viewMessage can
            // decode them.
            const [chainMsgs, bindings, acls, arcs] = await Promise.all([
                getMessageChainRows(ctx, { conversationId: input.id }),
                getRows<BindingRecord>(ctx, 'chatluna_binding'),
                getRows<AclRecord>(ctx, 'chatluna_acl', {
                    conversationId: input.id
                }),
                getRows<ArchiveRecord>(ctx, 'chatluna_archive', {
                    conversationId: input.id
                })
            ])
            const diag = diagnoseConversation(conv, chainMsgs as never)
            const visibleIds = diag.rows
                .slice(0, messageLimit)
                .map((row) => row.id)
            const fullRows =
                visibleIds.length === 0
                    ? []
                    : ((await ctx.database.get(
                          'chatluna_message' as never,
                          { id: { $in: visibleIds } } as never
                      )) as MessageRecord[])
            const fullById = new Map(fullRows.map((row) => [row.id, row]))
            const binding =
                bindings.find((row) => row.bindingKey === conv.bindingKey) ??
                null
            const refs = bindings.filter(
                (row) =>
                    row.bindingKey !== conv.bindingKey &&
                    (row.activeConversationId === conv.id ||
                        row.lastConversationId === conv.id)
            )
            const route = parseBindingKey(conv.bindingKey)
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
                    visibleIds
                        .map((id) => fullById.get(id))
                        .filter((row): row is MessageRecord => row != null)
                        .map(async (row) => viewMessage(row))
                )
            }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/assignConversation',
        async (input: AssignConversationInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            const [conv] = await ctx.database.get('chatluna_conversation', {
                id: input.conversationId
            })
            const ids = [conv.id]
            const now = new Date()
            if (input.principalId) {
                await ctx.database.upsert('chatluna_acl', [
                    {
                        conversationId: conv.id,
                        principalType: input.principalType,
                        principalId: input.principalId,
                        permission: input.permission
                    }
                ])
            }
            if (input.bindingKey) {
                const [binding] = await ctx.database.get('chatluna_binding', {
                    bindingKey: input.bindingKey
                })
                await ctx.database.upsert('chatluna_binding', [
                    {
                        bindingKey: input.bindingKey,
                        activeConversationId:
                            input.setActive === false
                                ? binding?.activeConversationId ?? null
                                : conv.id,
                        lastConversationId:
                            input.setLast === false
                                ? binding?.lastConversationId ?? null
                                : conv.id,
                        updatedAt: now
                    }
                ])
            }
            await clearRuntime(app, conv)
            pushAudit('conversation.assign', conv.id, ids, {
                principalType: input.principalType,
                principalId: input.principalId,
                permission: input.permission,
                bindingKey: input.bindingKey,
                setActive: input.setActive !== false,
                setLast: input.setLast !== false
            })
            return { ok: true }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/listMessages',
        async (input: MessageListInput = {}) => {
            // Push the conversationId filter (and role, when no user join is
            // needed) into the DB query so we don't scan + decompress every
            // message in the table on every keystroke.
            const msgQuery: Record<string, unknown> = {}
            if (input.conversationId) {
                msgQuery.conversationId = input.conversationId
            }
            if (input.role && !input.user) {
                msgQuery.role = input.role
            }
            // Fast path: no fuzzy text query and no cross-conversation user
            // join. Push pagination + descending-time sort to the DB so we
            // never materialize the full table in Node — which is what was
            // OOMing on production deployments with large message tables.
            const fastPath = !input.query?.trim() && !input.user
            const page = Math.max(1, Number(input.page ?? 1))
            const pageSize = Math.max(
                10,
                Number(input.pageSize ?? cfg.pageSize)
            )
            if (fastPath) {
                const [pageMsgs, total, convs] = await Promise.all([
                    (
                        await ctx.database.get(
                            'chatluna_message' as never,
                            msgQuery as never,
                            {
                                fields: MESSAGE_LIST_COLUMNS,
                                sort: { createdAt: 'desc' },
                                limit: pageSize,
                                offset: (page - 1) * pageSize
                            } as never
                        )
                    ) as unknown as MessageListRow[],
                    ctx.database
                        .select('chatluna_message' as never, msgQuery as never)
                        .execute((row: { id: unknown }) =>
                            $.count(row.id as never)
                        ) as Promise<number>,
                    getRows<ConversationRecord>(ctx, 'chatluna_conversation')
                ])
                const map = new Map(convs.map((row) => [row.id, row]))
                const rows = await Promise.all(
                    pageMsgs.map(async (row) => ({
                        ...(await viewMessage(row)),
                        title: map.get(row.conversationId)?.title ?? '',
                        model: map.get(row.conversationId)?.model ?? '',
                        createdBy:
                            map.get(row.conversationId)?.createdBy ?? '',
                        bindingKey:
                            map.get(row.conversationId)?.bindingKey ?? ''
                    }))
                )
                return {
                    page,
                    pageSize,
                    total: Number(total ?? 0),
                    rows
                }
            }
            const [msgs, convs] = await Promise.all([
                getMessageRows(ctx, msgQuery),
                getRows<ConversationRecord>(ctx, 'chatluna_conversation')
            ])
            const map = new Map(convs.map((row) => [row.id, row]))
            const rows = await Promise.all(
                msgs
                    .filter((row) => {
                        const conv = map.get(row.conversationId)
                        if (input.role && row.role !== input.role) return false
                        if (
                            input.user &&
                            conv?.createdBy !== input.user &&
                            !conv?.bindingKey.includes(input.user)
                        ) {
                            return false
                        }
                        return true
                    })
                    .map(async (row) => ({
                        ...(await viewMessage(row)),
                        title: map.get(row.conversationId)?.title ?? '',
                        model: map.get(row.conversationId)?.model ?? '',
                        createdBy: map.get(row.conversationId)?.createdBy ?? '',
                        bindingKey: map.get(row.conversationId)?.bindingKey ?? ''
                    }))
            )
            return pageRows(
                rows,
                input,
                (row) =>
                    [
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
                    ].join('\n'),
                (a, b) => timeOf(b.createdAt) - timeOf(a.createdAt),
                cfg
            )
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/saveConversationPatch',
        async (input: ConversationPatchInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            const [conv] = await ctx.database.get('chatluna_conversation', {
                id: input.id
            })
            const patch: Partial<ConversationRecord> = {
                id: conv.id,
                updatedAt: new Date()
            }
            for (const key of [
                'title',
                'model',
                'preset',
                'chatMode',
                'status',
                'latestMessageId',
                'archiveId',
                'autoTitle'
            ] as const) {
                if (Object.prototype.hasOwnProperty.call(input.patch, key)) {
                    ;(patch as Record<string, unknown>)[key] = input.patch[key]
                }
            }
            await ctx.database.upsert('chatluna_conversation', [patch])
            await clearRuntime(app, { ...conv, ...patch })
            pushAudit('conversation.patch', conv.id, [conv.id], patch)
            return { ok: true }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/createConversation',
        async (input: CreateConversationInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            const now = new Date()
            const row: ConversationRecord = {
                id: input.row.id || randomUUID(),
                bindingKey: input.row.bindingKey,
                title: input.row.title || '新会话',
                model: input.row.model,
                preset: input.row.preset,
                chatMode: input.row.chatMode,
                createdBy: input.row.createdBy,
                createdAt: now,
                updatedAt: now,
                lastChatAt: null,
                status: input.row.status || 'active',
                latestMessageId: null,
                additional_kwargs: null,
                compression: null,
                archivedAt: null,
                archiveId: null,
                legacyRoomId: null,
                legacyMeta: null,
                autoTitle: true
            }
            await ctx.database.upsert('chatluna_conversation', [row])
            if (input.setBindingActive) {
                await ctx.database.upsert('chatluna_binding', [
                    {
                        bindingKey: row.bindingKey,
                        activeConversationId: row.id,
                        lastConversationId: row.id,
                        updatedAt: now
                    }
                ])
            }
            pushAudit('conversation.create', row.id, [row.id], row)
            return { ok: true, id: row.id }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/removeConversation',
        async (input: RemoveConversationInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            const [conv] = await ctx.database.get('chatluna_conversation', {
                id: input.id
            })
            await ctx.database.remove('chatluna_conversation', { id: input.id })
            if (input.removeMessages) {
                await ctx.database.remove('chatluna_message', {
                    conversationId: input.id
                })
            }
            if (input.removeAcl) {
                await ctx.database.remove('chatluna_acl', {
                    conversationId: input.id
                })
            }
            const bindings = await getRows<BindingRecord>(
                ctx,
                'chatluna_binding',
                {
                    $or: [
                        { activeConversationId: input.id },
                        { lastConversationId: input.id }
                    ]
                }
            )
            if (bindings.length > 0) {
                await ctx.database.upsert(
                    'chatluna_binding',
                    bindings.map((row) => ({
                        bindingKey: row.bindingKey,
                        activeConversationId:
                            row.activeConversationId === input.id
                                ? null
                                : row.activeConversationId,
                        lastConversationId:
                            row.lastConversationId === input.id
                                ? null
                                : row.lastConversationId,
                        updatedAt: new Date()
                    }))
                )
            }
            await clearRuntime(app, conv)
            pushAudit('conversation.remove', input.id, [input.id], input)
            return { ok: true }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/saveBinding',
        async (input: SaveBindingInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            if (input.mode === 'remove') {
                await ctx.database.remove('chatluna_binding', {
                    bindingKey: input.row.bindingKey
                })
                pushAudit('binding.remove', input.row.bindingKey, [])
                return { ok: true }
            }
            await ctx.database.upsert('chatluna_binding', [
                {
                    bindingKey: input.row.bindingKey,
                    activeConversationId:
                        input.row.activeConversationId || null,
                    lastConversationId: input.row.lastConversationId || null,
                    updatedAt: new Date()
                }
            ])
            pushAudit('binding.save', input.row.bindingKey, [
                input.row.activeConversationId ?? '',
                input.row.lastConversationId ?? ''
            ])
            return { ok: true }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/saveMessage',
        async (input: SaveMessageInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            const [conv] = await ctx.database.get('chatluna_conversation', {
                id: input.row.conversationId
            })
            const row: Partial<MessageRecord> = {
                id: input.row.id || randomUUID(),
                conversationId: conv.id,
                parentId: input.row.parentId || null,
                role: input.row.role,
                text: input.row.text ?? '',
                content: null,
                name: input.row.name || null,
                tool_call_id: input.row.tool_call_id || null,
                rawId: input.row.rawId || null,
                createdAt: input.row.createdAt
                    ? new Date(input.row.createdAt)
                    : new Date()
            }
            await ctx.database.upsert('chatluna_message', [row])
            await ctx.database.upsert('chatluna_conversation', [
                {
                    id: conv.id,
                    latestMessageId:
                        input.setLatest === false ? conv.latestMessageId : row.id,
                    updatedAt: new Date()
                }
            ])
            await clearRuntime(app, conv)
            pushAudit('message.save', conv.id, [String(row.id)], row)
            return { ok: true, id: row.id }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/removeMessage',
        async (input: MessageInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            const [msg] = await ctx.database.get('chatluna_message', {
                id: input.id
            })
            const [conv] = await ctx.database.get('chatluna_conversation', {
                id: msg.conversationId
            })
            await ctx.database.remove('chatluna_message', { id: input.id })
            const msgs = await getMessageChainRows(ctx, {
                conversationId: conv.id
            })
            await ctx.database.upsert('chatluna_conversation', [
                {
                    id: conv.id,
                    latestMessageId:
                        conv.latestMessageId === input.id
                            ? msgs
                                  .slice()
                                  .sort(
                                      (a, b) =>
                                          timeOf(b.createdAt) -
                                          timeOf(a.createdAt)
                                  )[0]?.id ?? null
                            : conv.latestMessageId,
                    updatedAt: new Date()
                }
            ])
            await clearRuntime(app, conv)
            pushAudit('message.remove', conv.id, [input.id])
            return { ok: true }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/listAcl',
        async (input: ListInput = {}) => {
            return pageRows(
                await getRows<AclRecord>(ctx, 'chatluna_acl'),
                input,
                (row) =>
                    `${row.conversationId}\n${row.principalType}\n${row.principalId}\n${row.permission}`,
                (a, b) =>
                    `${a.conversationId}:${a.principalId}`.localeCompare(
                        `${b.conversationId}:${b.principalId}`
                    ),
                cfg
            )
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/getPermissionOverview',
        async (input?: PermissionOverviewInput) =>
            getPermissionOverviewData(ctx, cfg, input ?? {}),
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/saveKoishiUserPermission',
        async (input: SaveKoishiUserInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            await ctx.database.upsert('user', [
                {
                    id: input.id,
                    authority: input.authority,
                    permissions: readUserList(input.permissions)
                }
            ])
            pushAudit('koishi-user.permission', String(input.id), [], input)
            return { ok: true }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/saveKoishiChannelPermission',
        async (input: SaveKoishiChannelInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            await ctx.database.upsert('channel', [
                {
                    id: input.id,
                    platform: input.platform,
                    assignee: input.assignee,
                    permissions: readUserList(input.permissions)
                }
            ])
            pushAudit('koishi-channel.permission', input.id, [], input)
            return { ok: true }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/previewKoishiPermissionPlan',
        async (input: KoishiPermissionPlanInput) =>
            previewKoishiPermissionPlan(ctx, cfg, input),
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/applyKoishiPermissionPlan',
        async (input: KoishiPermissionPlanInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            const plan = await previewKoishiPermissionPlan(ctx, cfg, input)
            if (input.target === 'channels' || input.target === 'channels-empty') {
                await ctx.database.upsert(
                    'channel',
                    plan.allRows.map((row) => ({
                        id: String(row.id),
                        platform: row.platform,
                        assignee: row.nextAssignee,
                        permissions: row.nextPermissions
                    }))
                )
            } else {
                await ctx.database.upsert(
                    'user',
                    plan.allRows.map((row) => ({
                        id: Number(row.id),
                        authority: row.nextAuthority,
                        permissions: row.nextPermissions
                    }))
                )
            }
            pushAudit(
                'koishi-permission.apply',
                input.target,
                plan.allRows.map((row) => String(row.id)),
                input
            )
            return { ok: true, count: plan.count }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/listKoishiIdentities',
        async (input?: ListInput) => {
            const rows = await getRows<IdentityRecord>(
                ctx,
                'chatluna_data_identity'
            )
            return paginate(
                rows
                    .filter((row) =>
                        matchText(input?.query, [
                            row.platform,
                            row.id,
                            row.name,
                            row.source,
                            row.error
                        ])
                    )
                    .sort((a, b) =>
                        `${a.platform}:${a.id}`.localeCompare(
                            `${b.platform}:${b.id}`
                        )
                    )
                    .map((row) => ({
                        platform: row.platform,
                        id: row.id,
                        name: row.name,
                        avatar: row.avatar,
                        source: row.source,
                        error: row.error,
                        updatedAt: iso(row.updatedAt)
                    })),
                input
            )
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/refreshKoishiIdentity',
        async (input: IdentityRefreshInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            if (!cfg.enableIdentityLookup) {
                throw new Error('identity lookup disabled')
            }
            const row = await refreshKoishiIdentity(ctx, input)
            pushAudit(
                'koishi-identity.refresh',
                `${input.platform}:${input.id}`,
                [],
                input
            )
            return row
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/refreshKoishiIdentityBatch',
        async (input: IdentityBatchInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            if (!cfg.enableIdentityLookup) {
                throw new Error('identity lookup disabled')
            }
            const rows = input.rows.slice(0, cfg.identityRefreshLimitPerBatch)
            const result = []
            for (const row of rows) {
                result.push(await refreshKoishiIdentity(ctx, row))
                if (cfg.identityRefreshInterval > 0) {
                    await sleep(cfg.identityRefreshInterval)
                }
            }
            pushAudit(
                'koishi-identity.refresh-batch',
                input.platform ?? 'mixed',
                rows.map((row) => `${row.platform}:${row.id}`),
                { count: result.length }
            )
            return { ok: true, count: result.length, rows: result }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/listKoishiCommands',
        async () => listKoishiCommands(ctx),
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/getKoishiPermissionGraph',
        async () => ({
            permissions: ctx.permissions.list().sort(),
            commands: listKoishiCommands(ctx)
        }),
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/diagnoseKoishiPermission',
        async (input: PermissionDiagnoseInput) =>
            diagnoseKoishiPermission(ctx, input),
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/previewKoishiMaintenance',
        async (input: KoishiMaintenanceInput) =>
            previewKoishiMaintenance(ctx, cfg, input),
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/applyKoishiMaintenance',
        async (input: KoishiMaintenanceInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            const plan = await previewKoishiMaintenance(ctx, cfg, input)
            if (input.type === 'channels-assign') {
                await ctx.database.upsert(
                    'channel',
                    plan.allRows.map((row) => ({
                        id: String(row.id),
                        platform: row.platform,
                        assignee: row.nextAssignee,
                        permissions: row.nextPermissions
                    }))
                )
            } else {
                await ctx.database.upsert(
                    'user',
                    plan.allRows.map((row) => ({
                        id: Number(row.id),
                        authority: row.nextAuthority,
                        permissions: row.nextPermissions
                    }))
                )
            }
            pushAudit(
                'koishi-maintenance.apply',
                input.type,
                plan.allRows.map((row) => String(row.id)),
                input
            )
            return { ok: true, count: plan.count }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/saveAcl',
        async (input: SaveAclInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            if (input.mode === 'remove') {
                await ctx.database.remove('chatluna_acl', {
                    conversationId: input.row.conversationId,
                    principalType: input.row.principalType,
                    principalId: input.row.principalId
                })
                pushAudit('acl.remove', input.row.conversationId, [
                    input.row.conversationId
                ])
                return { ok: true }
            }
            await ctx.database.upsert('chatluna_acl', [input.row])
            pushAudit('acl.save', input.row.conversationId, [
                input.row.conversationId
            ])
            return { ok: true }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/listConstraints',
        async (input: ListInput = {}) => {
            return pageRows(
                (await getRows<ConstraintRecord>(ctx, 'chatluna_constraint')).map(
                    (row) => viewConstraint(row)
                ),
                input,
                (row) =>
                    [
                        row.id,
                        row.name,
                        row.createdBy,
                        row.guildId,
                        row.channelId,
                        row.defaultModel,
                        row.fixedModel,
                        row.routeKey
                    ].join('\n'),
                (a, b) => b.priority - a.priority,
                cfg
            )
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/saveConstraint',
        async (input: SaveConstraintInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            if (input.mode === 'remove') {
                await ctx.database.remove('chatluna_constraint', {
                    id: input.row.id
                })
                pushAudit('constraint.remove', String(input.row.id), [])
                return { ok: true }
            }
            const now = new Date()
            const row = { ...input.row }
            if (!row.id) delete row.id
            await ctx.database.upsert('chatluna_constraint', [
                {
                    ...row,
                    users: writeUserList(row.users),
                    excludeUsers: writeUserList(row.excludeUsers),
                    createdAt: row.createdAt
                        ? new Date(row.createdAt)
                        : now,
                    updatedAt: now
                }
            ])
            pushAudit('constraint.save', String(input.row.id ?? input.row.name), [])
            return { ok: true }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/listArchives',
        async (input: ListInput = {}) => {
            return pageRows(
                await Promise.all(
                    (
                        await getRows<ArchiveRecord>(ctx, 'chatluna_archive')
                    ).map((row) => viewArchive(row, cfg))
                ),
                input,
                (row) =>
                    `${row.id}\n${row.conversationId}\n${row.path}\n${row.state}\n${row.checksum}`,
                (a, b) => timeOf(b.createdAt) - timeOf(a.createdAt),
                cfg
            )
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/previewOperation',
        async (input: OperationInput) => {
            return previewOperation(ctx, cfg, input)
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/applyOperation',
        async (input: OperationInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            const prev = await previewOperation(ctx, cfg, input)
            if (prev.blocked) return prev
            if (input.type === 'model-migration') {
                await ctx.database.upsert(
                    'chatluna_conversation',
                    prev.rows.map((row) => ({
                        id: row.id,
                        model: input.targetModel,
                        updatedAt: new Date()
                    }))
                )
                if (prev.rows.length > 0) {
                    const ids = prev.rows.map((row) => row.id)
                    const convs = await getRows<ConversationRecord>(
                        ctx,
                        'chatluna_conversation',
                        { id: { $in: ids } }
                    )
                    await Promise.all(convs.map((conv) => clearRuntime(app, conv)))
                }
                pushAudit('operation.model-migration', input.targetModel, [
                    ...prev.rows.map((row) => row.id)
                ])
                return { ...prev, applied: true }
            }
            if (input.type === 'model-reference-migration') {
                const rows = ((prev as { allRows?: ModelReferencePreview[] })
                    .allRows ?? prev.rows) as ModelReferencePreview[]
                const convRows = rows.filter((row) => row.kind === 'conversation')
                const ruleRows = rows.filter((row) => row.kind === 'constraint')
                const cfgRows = rows.filter((row) => row.kind === 'config')
                if (convRows.length) {
                    await ctx.database.upsert(
                        'chatluna_conversation',
                        convRows.map((row) => ({
                            id: row.refId,
                            model: input.targetModel,
                            updatedAt: new Date()
                        }))
                    )
                    const ids = convRows.map((row) => row.refId)
                    const convs = await getRows<ConversationRecord>(
                        ctx,
                        'chatluna_conversation',
                        { id: { $in: ids } }
                    )
                    await Promise.all(convs.map((conv) => clearRuntime(app, conv)))
                }
                if (ruleRows.length) {
                    await ctx.database.upsert(
                        'chatluna_constraint',
                        ruleRows.map((row) => ({
                            id: Number(row.refId),
                            [row.field]: input.targetModel,
                            updatedAt: new Date()
                        }))
                    )
                }
                if (cfgRows.length) {
                    const fork = findChatLunaFork(ctx)
                    if (!fork) throw new Error('chatluna plugin fork not found')
                    if (ctx.get('loader')?.writable !== true) {
                        throw new Error('koishi config file is readonly')
                    }
                    fork.fork.update({
                        ...(fork.fork.config as Record<string, unknown>),
                        defaultModel: input.targetModel
                    })
                }
                pushAudit(
                    'operation.model-reference-migration',
                    input.targetModel,
                    rows.map((row) => row.id),
                    {
                        fromModel: input.fromModel,
                        scopes: input.scopes
                    }
                )
                return { ...prev, applied: true }
            }
            if (input.type === 'status-change') {
                await ctx.database.upsert(
                    'chatluna_conversation',
                    prev.rows.map((row) => ({
                        id: row.id,
                        status: input.targetStatus,
                        updatedAt: new Date()
                    }))
                )
                pushAudit('operation.status-change', input.targetStatus, [
                    ...prev.rows.map((row) => row.id)
                ])
                return { ...prev, applied: true }
            }
            if (input.type === 'archive-record-cleanup') {
                if (cfg.enableArchiveFileOps) {
                    await Promise.all(
                        prev.rows.map((row) =>
                            ctx.database.remove('chatluna_archive', {
                                id: row.id
                            })
                        )
                    )
                    pushAudit('operation.archive-cleanup', 'missing archives', [
                        ...prev.rows.map((row) => row.id)
                    ])
                    return { ...prev, applied: true }
                }
                throw new Error('archive file operations disabled')
            }
            if (input.type === 'message-repair') {
                if (!cfg.enableMessageRepair) {
                    throw new Error('message repair disabled')
                }
                const [conv] = await ctx.database.get(
                    'chatluna_conversation',
                    { id: input.conversationId }
                )
                const msgs = await getMessageChainRows(ctx, {
                    conversationId: input.conversationId
                })
                const rows = msgs
                    .slice()
                    .sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt))
                await ctx.database.upsert(
                    'chatluna_message',
                    rows.map((row, idx) => ({
                        id: row.id,
                        parentId: idx > 0 ? rows[idx - 1].id : null
                    }))
                )
                await ctx.database.upsert('chatluna_conversation', [
                    {
                        id: conv.id,
                        latestMessageId: rows.at(-1)?.id ?? null,
                        updatedAt: new Date()
                    }
                ])
                pushAudit('operation.message-repair', conv.id, [conv.id])
                return { ...prev, applied: true }
            }
            throw new Error('unknown operation')
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/summary',
        async () => {
            const data = await overview(ctx, cfg, app)
            return {
                conversations: data.totals.conversations,
                messages: data.totals.messages,
                active: data.totals.active,
                archived: data.totals.archived,
                broken: data.totals.broken,
                models: Object.fromEntries(
                    data.models.map((row: ModelCount) => [
                        row.model,
                        row.count
                    ])
                ),
                users: {}
            }
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/scanIntegrity',
        async (input: IntegrityScanInput = {}) =>
            scanIntegrity(ctx, cfg, input),
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/repairIntegrity',
        async (input: IntegrityRepairInput) => {
            if (cfg.readonly) throw new Error('readonly mode enabled')
            return repairIntegrity(ctx, cfg, input)
        },
        { authority: 3 }
    )

    ctx.console.addListener(
        'chatluna-data/getIntegrityField',
        async (input: IntegrityFieldInput) => getIntegrityField(ctx, input),
        { authority: 3 }
    )

    ctx.on('ready', async () => {
        audits.splice(
            0,
            audits.length,
            ...(
                await getRows<AuditRecord>(ctx, 'chatluna_data_audit')
            )
                .sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt))
                .slice(0, 80)
                .map((row) => ({
                    id: row.id,
                    action: row.action,
                    target: row.target,
                    ids: readUserList(row.ids),
                    count: row.count,
                    detail: row.detail ? JSON.parse(row.detail) : {},
                    createdAt: iso(row.createdAt)
                }))
        )
        opsErrors.splice(
            0,
            opsErrors.length,
            ...(
                await getRows<OpsErrorRecord>(ctx, 'chatluna_data_ops_error')
            )
                .sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt))
                .slice(0, 80)
                .map((row) => ({
                    id: row.id,
                    source: row.source,
                    level: row.level,
                    logger: row.logger,
                    message: row.message,
                    createdAt: iso(row.createdAt),
                    analysis: row.analysis ? JSON.parse(row.analysis) : {}
                }))
        )
    })
}

function isMinatoLoadError(err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (!message) return false
    return (
        message.includes('Unexpected end of JSON input') ||
        message.includes('JSON.parse') ||
        message.includes('SQLiteBuilder.load') ||
        message.includes('SyntaxError') ||
        message.includes('is not iterable')
    )
}

// Tracks tables whose load failed because minato's driver hit a bad row
// (typically an empty string in a column declared as `json`). Rather than
// letting that take down the whole dashboard, getRows reports it here and
// returns an empty array. The integrity scanner exposes the entries so
// operators can locate and clean the offending row.
const loadErrors = new Map<
    string,
    { table: string; message: string; at: string; sample?: unknown }
>()

function recordLoadError(table: string, err: unknown, sample?: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    loadErrors.set(table, {
        table,
        message,
        at: new Date().toISOString(),
        sample
    })
}

// Safe direct-row lookup. Equivalent to ctx.database.get(table, query) but
// swallows minato's JSON.parse-on-load crashes and records them so the
// integrity panel can surface the offending table.
async function safeGet<T>(
    ctx: Context,
    table: string,
    query: Record<string, unknown>
): Promise<T[]> {
    try {
        return (await ctx.database.get(
            table as never,
            query as never
        )) as T[]
    } catch (err) {
        if (isMinatoLoadError(err)) {
            recordLoadError(table, err, query)
            return []
        }
        throw err
    }
}

async function getRows<T>(ctx: Context, table: string, query = {}) {
    try {
        const rows = (await ctx.database.get(
            table as never,
            query as never
        )) as T[]
        if (Object.keys(query).length === 0) loadErrors.delete(table)
        return rows
    } catch (err) {
        if (isMinatoLoadError(err)) {
            recordLoadError(table, err, query)
            return [] as T[]
        }
        throw err
    }
}

async function getColumns<T>(
    ctx: Context,
    table: string,
    fields: string[],
    query = {}
) {
    try {
        return (await ctx.database.get(
            table as never,
            query as never,
            fields as never
        )) as T[]
    } catch (err) {
        if (isMinatoLoadError(err)) {
            recordLoadError(table, err, { fields, query })
            return [] as T[]
        }
        throw err
    }
}

// Columns sufficient for diagnose/list/migration paths. We deliberately omit
// `content` (gzip-compressed binary), `additional_kwargs_binary`, and
// `response_metadata_binary` — those can be tens of KB per row and Node OOMs
// on dashboards once the message table grows past a few hundred MB.
const MESSAGE_LIST_COLUMNS = [
    'id',
    'conversationId',
    'parentId',
    'role',
    'text',
    'name',
    'tool_call_id',
    'tool_calls',
    'rawId',
    'createdAt'
] as const
type MessageListRow = Pick<
    MessageRecord,
    (typeof MESSAGE_LIST_COLUMNS)[number]
>

async function getMessageRows(
    ctx: Context,
    query: Record<string, unknown> = {}
) {
    try {
        const rows = (await ctx.database.get(
            'chatluna_message' as never,
            query as never,
            MESSAGE_LIST_COLUMNS as unknown as never
        )) as unknown as MessageListRow[]
        if (Object.keys(query).length === 0) {
            loadErrors.delete('chatluna_message')
        }
        return rows
    } catch (err) {
        if (isMinatoLoadError(err)) {
            recordLoadError('chatluna_message', err, query)
            return [] as MessageListRow[]
        }
        throw err
    }
}

// Even leaner: the chain-repair / latest-message lookups only need link info.
async function getMessageChainRows(
    ctx: Context,
    query: Record<string, unknown> = {}
) {
    try {
        return (await ctx.database.get(
            'chatluna_message' as never,
            query as never,
            ['id', 'conversationId', 'parentId', 'createdAt'] as unknown as never
        )) as unknown as Pick<
            MessageRecord,
            'id' | 'conversationId' | 'parentId' | 'createdAt'
        >[]
    } catch (err) {
        if (isMinatoLoadError(err)) {
            recordLoadError('chatluna_message', err, query)
            return [] as Pick<
                MessageRecord,
                'id' | 'conversationId' | 'parentId' | 'createdAt'
            >[]
        }
        throw err
    }
}

function matchText(query: string | undefined, values: unknown[]) {
    if (!query) return true
    const text = query.toLowerCase()
    return values.some((value) => String(value ?? '').toLowerCase().includes(text))
}

function paginate<T>(rows: T[], input?: ListInput) {
    const page = Math.max(1, input?.page ?? 1)
    const pageSize = Math.max(1, input?.pageSize ?? 40)
    return {
        rows: rows.slice((page - 1) * pageSize, page * pageSize),
        total: rows.length,
        page,
        pageSize
    }
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function invalidatePermissionCache() {
    permissionCache = { expiresAt: 0 }
}

async function getPermissionSnapshot(ctx: Context, cfg: Config) {
    if (permissionCache.data && permissionCache.expiresAt > Date.now()) {
        return permissionCache.data
    }
    if (permissionCache.task) return permissionCache.task
    permissionCache.task = buildPermissionSnapshot(ctx, cfg)
    try {
        permissionCache.data = await permissionCache.task
        permissionCache.expiresAt = Date.now() + 30000
        return permissionCache.data
    } finally {
        permissionCache.task = undefined
    }
}

async function buildPermissionSnapshot(ctx: Context, cfg: Config) {
    const [users, kBindings, channels, convs, acls, rules, identities] =
        await Promise.all([
            getColumns<KoishiUserRecord>(ctx, 'user', [
                'id',
                'name',
                'authority',
                'permissions',
                'createdAt'
            ]),
            getColumns<KoishiBindingRecord>(ctx, 'binding', [
                'aid',
                'bid',
                'pid',
                'platform'
            ]),
            getColumns<KoishiChannelRecord>(ctx, 'channel', [
                'id',
                'platform',
                'guildId',
                'assignee',
                'permissions',
                'createdAt'
            ]),
            getColumns<ConversationRecord>(ctx, 'chatluna_conversation', [
                'id',
                'bindingKey',
                'createdBy',
                'createdAt',
                'updatedAt',
                'lastChatAt'
            ]),
            getColumns<AclRecord>(ctx, 'chatluna_acl', [
                'principalId',
                'principalType',
                'conversationId',
                'permission'
            ]),
            getColumns<ConstraintRecord>(ctx, 'chatluna_constraint', [
                'createdBy',
                'users',
                'excludeUsers'
            ]),
            getColumns<IdentityRecord>(ctx, 'chatluna_data_identity', [
                'platform',
                'id',
                'name',
                'avatar',
                'source',
                'error',
                'updatedAt'
            ])
        ])
    const userById = new Map(users.map((row) => [row.id, row]))
    const identityByKey = new Map(
        identities.map((row) => [`${row.platform}:${row.id}`, row])
    )
    const bindingsByAid = new Map<number, KoishiBindingRecord[]>()
    const convCountByPrincipal = new Map<string, number>()
    const lastActiveByPrincipal = new Map<string, Date>()
    const aclCountByPrincipal = new Map<string, number>()
    const ruleCountByPrincipal = new Map<string, number>()
    const convCountByGuild = new Map<string, number>()

    for (const row of kBindings) {
        bindingsByAid.set(row.aid, [...(bindingsByAid.get(row.aid) ?? []), row])
    }
    for (const conv of convs) {
        const route = parseBindingKey(conv.bindingKey)
        for (const id of new Set([conv.createdBy, route.userId])) {
            if (!id) continue
            convCountByPrincipal.set(
                id,
                (convCountByPrincipal.get(id) ?? 0) + 1
            )
            const t = conv.lastChatAt ?? conv.updatedAt ?? conv.createdAt
            if (timeOf(t) > timeOf(lastActiveByPrincipal.get(id))) {
                lastActiveByPrincipal.set(id, t)
            }
        }
        if (route.guildId) {
            convCountByGuild.set(
                route.guildId,
                (convCountByGuild.get(route.guildId) ?? 0) + 1
            )
        }
    }
    for (const acl of acls) {
        aclCountByPrincipal.set(
            acl.principalId,
            (aclCountByPrincipal.get(acl.principalId) ?? 0) + 1
        )
    }
    for (const rule of rules) {
        for (const id of new Set([
            rule.createdBy,
            ...readUserList(rule.users),
            ...readUserList(rule.excludeUsers)
        ])) {
            if (!id) continue
            ruleCountByPrincipal.set(
                id,
                (ruleCountByPrincipal.get(id) ?? 0) + 1
            )
        }
    }

    const userRows = users.map((row) => {
        const refs = bindingsByAid.get(row.id) ?? []
        const ids = refs.map((item) => item.pid)
        const accounts = refs.map((item) => {
            const cached = identityByKey.get(`${item.platform}:${item.pid}`)
            return {
                platform: item.platform,
                id: item.pid,
                name: cached?.name ?? '',
                source: cached?.source ?? '',
                error: cached?.error ?? '',
                updatedAt: iso(cached?.updatedAt)
            }
        })
        const cached = refs
            .map((item) => identityByKey.get(`${item.platform}:${item.pid}`))
            .find((item) => item?.name)
        const display = row.name || cached?.name || ids[0] || `用户 ${row.id}`
        let last: Date | undefined
        for (const id of ids) {
            const item = lastActiveByPrincipal.get(id)
            if (timeOf(item) > timeOf(last)) last = item
        }
        const inactiveDays = last
            ? Math.floor((Date.now() - timeOf(last)) / 86400000)
            : null
        const activeLevel =
            inactiveDays == null
                ? 'unknown'
                : inactiveDays <= 30
                  ? 'active'
                  : inactiveDays <= cfg.inactiveWarningDays
                    ? 'quiet'
                    : 'inactive'
        const riskLevel =
            row.authority >= 4 ||
            (activeLevel === 'inactive' && row.authority > 0)
                ? 'warning'
                : refs.length === 0 && row.authority > 0
                  ? 'info'
                  : 'normal'
        return {
            id: row.id,
            name: row.name,
            displayName: display,
            nameSource: row.name
                ? 'koishi'
                : cached?.name
                  ? 'cache'
                  : ids.length > 0
                    ? 'binding'
                    : 'fallback',
            identitySource: cached?.source ?? '',
            identityUpdatedAt: iso(cached?.updatedAt),
            authority: row.authority,
            permissions: row.permissions ?? [],
            createdAt: iso(row.createdAt),
            lastActiveAt: iso(last),
            inactiveDays,
            activeLevel,
            lastActiveSource: last ? 'chatluna_conversation' : '',
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
        }
    })
    const perms = Array.from(
        new Set([
            ...ctx.permissions.list(),
            ...users.flatMap((row) => row.permissions ?? []),
            ...channels.flatMap((row) => row.permissions ?? [])
        ])
    ).sort()
    const issues: PermissionIssue[] = [
        ...userRows
            .filter((row) => row.authority >= 4)
            .map((row) => ({
                level: 'warning' as const,
                type: 'high-authority',
                target: row.displayName,
                message: `用户 authority=${row.authority}`,
                action: '确认是否仍需要保留高权限。'
            })),
        ...userRows
            .filter((row) => row.bindings === 0 && row.authority > 0)
            .map((row) => ({
                level: 'info' as const,
                type: 'user-without-binding',
                target: row.name || String(row.id),
                message: 'Koishi 用户没有平台账号绑定。',
                action: '检查 binding 表，或将其作为历史用户保留。'
            })),
        ...userRows
            .filter(
                (row) =>
                    row.inactiveDays != null &&
                    row.inactiveDays >= cfg.inactiveWarningDays &&
                    row.authority > 0
            )
            .map((row) => ({
                level: 'warning' as const,
                type: 'inactive-user',
                target: row.displayName,
                message: `超过 ${row.inactiveDays} 天未活跃。`,
                action: '检查是否需要降权或移除细粒度权限。'
            })),
        ...kBindings
            .filter((row) => !userById.has(row.aid))
            .map((row) => ({
                level: 'warning' as const,
                type: 'dangling-binding',
                target: `${row.platform}:${row.pid}`,
                message: `绑定指向缺失 Koishi 用户: ${row.aid}`,
                action: '检查 binding 表或恢复对应 user。'
            })),
        ...channels
            .filter((row) => !row.assignee)
            .map((row) => ({
                level: 'info' as const,
                type: 'channel-without-assignee',
                target: `${row.platform}:${row.id}`,
                message: '频道没有 assignee。',
                action: '需要机器人主动受理该频道时填写 assignee。'
            })),
        ...channels
            .filter((row) => (row.permissions ?? []).length > 0)
            .map((row) => ({
                level: 'info' as const,
                type: 'channel-permissions',
                target: `${row.platform}:${row.id}`,
                message: `频道权限: ${(row.permissions ?? []).join(', ')}`,
                action: '确认这些频道级权限是否仍然需要。'
            }))
    ]
    const bindingRows = kBindings
        .map((row) => {
            const user = userById.get(row.aid)
            return {
                aid: row.aid,
                bid: row.bid,
                pid: row.pid,
                platform: row.platform,
                userName: user?.name ?? '',
                authority: user?.authority ?? 0,
                permissions: user?.permissions ?? []
            }
        })
        .sort((a, b) =>
            `${a.platform}:${a.pid}`.localeCompare(`${b.platform}:${b.pid}`)
        )
    const channelRows = channels
        .map((row) => ({
            id: row.id,
            platform: row.platform,
            guildId: row.guildId,
            assignee: row.assignee,
            permissions: row.permissions ?? [],
            createdAt: iso(row.createdAt),
            conversations: convCountByGuild.get(row.id) ?? 0,
            acl: aclCountByPrincipal.get(row.id) ?? 0
        }))
        .sort((a, b) =>
            `${a.platform}:${a.id}`.localeCompare(`${b.platform}:${b.id}`)
        )
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
    }
}

async function getPermissionOverviewData(
    ctx: Context,
    cfg: Config,
    input: PermissionOverviewInput
) {
    const snapshot = await getPermissionSnapshot(ctx, cfg)
    const filteredUsers = snapshot.users
        .filter((row) =>
            matchText(input.query, [
                row.id,
                row.name,
                row.displayName,
                row.permissions.join('\n'),
                row.platforms.join('\n'),
                row.principals.join('\n'),
                row.accounts.map((item) => item.name).join('\n')
            ])
        )
        .filter((row) => !input.platform || row.platforms.includes(input.platform))
        .filter(
            (row) =>
                input.inactiveDays == null ||
                (row.inactiveDays != null && row.inactiveDays >= input.inactiveDays)
        )
    const bindingRows = snapshot.bindings.filter((row) =>
        matchText(input.query, [
            row.aid,
            row.pid,
            row.platform,
            row.userName,
            row.permissions.join('\n')
        ])
    )
    const channelRows = snapshot.channels.filter((row) =>
        matchText(input.query, [
            row.id,
            row.platform,
            row.guildId,
            row.assignee,
            row.permissions.join('\n')
        ])
    )
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? cfg.pageSize
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
    }
}

async function previewKoishiPermissionPlan(
    ctx: Context,
    cfg: Config,
    input: KoishiPermissionPlanInput
) {
    const [users, kBindings, channels, convs] = await Promise.all([
        getColumns<KoishiUserRecord>(ctx, 'user', [
            'id',
            'name',
            'authority',
            'permissions'
        ]),
        getColumns<KoishiBindingRecord>(ctx, 'binding', [
            'aid',
            'pid',
            'platform'
        ]),
        getColumns<KoishiChannelRecord>(ctx, 'channel', [
            'id',
            'platform',
            'guildId',
            'assignee',
            'permissions'
        ]),
        getColumns<ConversationRecord>(ctx, 'chatluna_conversation', [
            'bindingKey',
            'createdBy',
            'createdAt',
            'updatedAt',
            'lastChatAt'
        ])
    ])
    const bindingsByAid = new Map<number, KoishiBindingRecord[]>()
    const chatUsers = new Set<string>()
    const chatGuilds = new Set<string>()
    const lastActiveByPrincipal = new Map<string, Date>()
    for (const row of kBindings) {
        bindingsByAid.set(row.aid, [
            ...(bindingsByAid.get(row.aid) ?? []),
            row
        ])
    }
    for (const conv of convs) {
        const route = parseBindingKey(conv.bindingKey)
        if (conv.createdBy) chatUsers.add(conv.createdBy)
        if (route.userId) chatUsers.add(route.userId)
        const t = conv.lastChatAt ?? conv.updatedAt ?? conv.createdAt
        for (const id of new Set([conv.createdBy, route.userId])) {
            if (id && timeOf(t) > timeOf(lastActiveByPrincipal.get(id))) {
                lastActiveByPrincipal.set(id, t)
            }
        }
        if (route.guildId) chatGuilds.add(route.guildId)
    }
    const perms = input.permissions ?? []
    const rows =
        input.target === 'channels' || input.target === 'channels-empty'
            ? channels
                  .filter((row) => !input.platform || row.platform === input.platform)
                  .filter(
                      (row) =>
                          input.target === 'channels' ||
                          !row.assignee ||
                          chatGuilds.has(row.id)
                  )
                  .map((row) => {
                      const current = row.permissions ?? []
                      const next =
                          input.permissionMode === 'replace'
                              ? perms
                              : input.permissionMode === 'remove'
                                ? current.filter((item) => !perms.includes(item))
                                : Array.from(new Set([...current, ...perms]))
                      return {
                          kind: 'channel',
                          id: row.id,
                          platform: row.platform,
                          name: row.guildId || row.id,
                          reason: row.assignee
                              ? '匹配频道筛选条件'
                              : '频道未设置 assignee',
                          currentAuthority: null,
                          nextAuthority: null,
                          currentAssignee: row.assignee,
                          nextAssignee: input.assignee ?? row.assignee,
                          currentPermissions: current,
                          nextPermissions: next
                      }
                  })
            : users
                  .filter((row) => {
                      const refs = bindingsByAid.get(row.id) ?? []
                      if (
                          input.platform &&
                          !refs.some((item) => item.platform === input.platform)
                      ) {
                          return false
                      }
                      if (input.target === 'all-users') return true
                      if (input.target === 'bound-users') return refs.length > 0
                      if (input.target === 'chatluna-users') {
                          return refs.some((item) => chatUsers.has(item.pid))
                      }
                      if (input.target === 'inactive-users') {
                          let last: Date | undefined
                          for (const ref of refs) {
                              const item = lastActiveByPrincipal.get(ref.pid)
                              if (timeOf(item) > timeOf(last)) last = item
                          }
                          return (
                              last != null &&
                              Math.floor((Date.now() - timeOf(last)) / 86400000) >=
                                  (input.inactiveDays ?? cfg.inactiveWarningDays)
                          )
                      }
                      return (
                          row.authority === 0 &&
                          (row.permissions ?? []).length === 0
                      )
                  })
                  .map((row) => {
                      const current = row.permissions ?? []
                      const next =
                          input.permissionMode === 'replace'
                              ? perms
                              : input.permissionMode === 'remove'
                                ? current.filter((item) => !perms.includes(item))
                                : Array.from(new Set([...current, ...perms]))
                      return {
                          kind: 'user',
                          id: row.id,
                          platform:
                              (bindingsByAid.get(row.id) ?? [])
                                  .map((item) => item.platform)
                                  .join(', ') || '-',
                          name: row.name || `用户 ${row.id}`,
                          reason:
                              input.target === 'chatluna-users'
                                  ? '平台账号出现在 ChatLuna 会话中'
                                  : input.target === 'bound-users'
                                    ? '存在平台账号绑定'
                                    : input.target === 'unconfigured-users'
                                      ? 'authority 与 permissions 均为空'
                                      : input.target === 'inactive-users'
                                        ? `超过 ${input.inactiveDays ?? cfg.inactiveWarningDays} 天未活跃`
                                      : '匹配全部 Koishi 用户',
                          currentAuthority: row.authority,
                          nextAuthority:
                              input.authority == null
                                  ? row.authority
                                  : input.authority,
                          currentAssignee: '',
                          nextAssignee: '',
                          currentPermissions: current,
                          nextPermissions: next
                      }
                  })
    const changed = rows.filter(
        (row) =>
            row.currentAuthority !== row.nextAuthority ||
            row.currentAssignee !== row.nextAssignee ||
            row.currentPermissions.join('\n') !==
                row.nextPermissions.join('\n')
    )
    return {
        count: changed.length,
        rows: changed.slice(0, cfg.maxPreviewRows),
        allRows: changed,
        warnings: [
            '这是 Koishi 原生 user/channel 权限批量修改。',
            '请先确认预览对象，应用后会立即写入数据库。'
        ]
    }
}

async function findKoishiUser(ctx: Context, target: string) {
    if (/^\d+$/.test(target)) {
        const [user] = await ctx.database.get('user', { id: Number(target) })
        if (user) return user as KoishiUserRecord
    }
    const [binding] = await ctx.database.get('binding', { pid: target })
    if (binding) {
        const [user] = await ctx.database.get('user', { id: binding.aid })
        if (user) return user as KoishiUserRecord
    }
    const users = await getRows<KoishiUserRecord>(ctx, 'user')
    return (
        users.find((row) => row.name === target) ??
        users.find((row) => row.name?.includes(target)) ??
        null
    )
}

async function refreshKoishiIdentity(ctx: Context, input: IdentityRefreshInput) {
    const bot = ctx.bots.find(
        (row) =>
            row.platform === input.platform &&
            (!input.selfId || row.selfId === input.selfId)
    )
    const payload = {
        platform: input.platform,
        id: input.id,
        name: '',
        avatar: '',
        source: 'api',
        error: '',
        updatedAt: new Date()
    }
    try {
        const raw = input.guildId
            ? await (bot as any)?.getGuildMember?.(input.guildId, input.id)
            : await (bot as any)?.getUser?.(input.id)
        const user = raw?.user ?? raw
        payload.name =
            raw?.nick ||
            raw?.name ||
            user?.nick ||
            user?.name ||
            user?.username ||
            input.id
        payload.avatar = user?.avatar ?? raw?.avatar ?? ''
    } catch (err) {
        payload.source = 'error'
        payload.name = input.id
        payload.error = err instanceof Error ? err.message : String(err)
    }
    if (!bot) {
        payload.source = 'error'
        payload.name = input.id
        payload.error = `no online bot for platform ${input.platform}`
    }
    await ctx.database.upsert('chatluna_data_identity', [payload])
    return { ...payload, updatedAt: iso(payload.updatedAt) }
}

function listKoishiCommands(ctx: Context) {
    const commander = (ctx as any).$commander
    return (commander?._commandList ?? [])
        .map((row: any) => ({
            name: row.name,
            displayName: row.displayName ?? row.name,
            permissions: row.config?.permissions ?? [],
            dependencies: row.config?.dependencies ?? [],
            options: Object.values(row._options ?? {}).map((opt: any) => ({
                name: opt.name,
                permissions: opt.permissions ?? [],
                dependencies: opt.dependencies ?? []
            }))
        }))
        .sort((a: { name: string }, b: { name: string }) =>
            a.name.localeCompare(b.name)
        )
}

async function diagnoseKoishiPermission(
    ctx: Context,
    input: PermissionDiagnoseInput
) {
    const user = await findKoishiUser(ctx, input.target)
    if (!user) {
        return {
            allowed: false,
            status: 'missing-user',
            reasons: [`找不到用户：${input.target}`],
            required: [],
            inherited: [],
            depended: []
        }
    }
    const refs = await getRows<KoishiBindingRecord>(ctx, 'binding', {
        aid: user.id
    })
    const first = refs[0]
    const channelQuery = input.channel?.includes(':')
        ? {
              platform: input.channel.slice(0, input.channel.indexOf(':')),
              id: input.channel.slice(input.channel.indexOf(':') + 1)
          }
        : { id: input.channel }
    const [channel] = input.channel
        ? await ctx.database.get('channel', channelQuery as never)
        : []
    const bot = ctx.bots.find(
        (row) => row.platform === (channel?.platform ?? first?.platform)
    )
    const name = input.command?.replace(/^command:/, '')
    const required = name ? [`command:${name}`] : ['authority:1']
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
    }
    const allowed = await ctx.permissions.test(required, session as never)
    const inherited = Array.from(ctx.permissions.subgraph('inherits', required))
    const depended = Array.from(ctx.permissions.subgraph('depends', required))
    const reasons = [
        `用户 authority=${user.authority}`,
        `用户 permissions=${(user.permissions ?? []).join(', ') || '-'}`,
        `平台绑定=${refs.map((row) => `${row.platform}:${row.pid}`).join(', ') || '-'}`,
        `频道=${channel ? `${channel.platform}:${channel.id}` : '-'}`,
        `频道 permissions=${(channel?.permissions ?? []).join(', ') || '-'}`
    ]
    if (channel?.assignee && bot?.selfId && channel.assignee !== bot.selfId) {
        reasons.push(
            `频道 assignee=${channel.assignee}，当前 bot=${bot.selfId}，非 at 场景可能被 Koishi 中间件拦截`
        )
    }
    if (input.command) {
        const cmd = listKoishiCommands(ctx).find((row) => row.name === name)
        reasons.push(
            `指令权限=${cmd?.permissions?.join(', ') || '-'}`,
            `指令依赖=${cmd?.dependencies?.join(', ') || '-'}`
        )
    }
    return {
        allowed,
        status:
            channel?.assignee && bot?.selfId && channel.assignee !== bot.selfId
                ? 'channel-blocked'
                : allowed
                  ? 'allowed'
                  : 'denied',
        reasons,
        required,
        inherited,
        depended
    }
}

async function previewKoishiMaintenance(
    ctx: Context,
    cfg: Config,
    input: KoishiMaintenanceInput
) {
    if (input.type === 'channels-assign') {
        const channels = await getRows<KoishiChannelRecord>(ctx, 'channel')
        const rows = channels
            .filter((row) => !input.platform || row.platform === input.platform)
            .filter((row) => !row.assignee)
            .map((row) => ({
                kind: 'channel',
                id: row.id,
                platform: row.platform,
                name: row.guildId || row.id,
                reason: '频道未设置 assignee',
                currentAuthority: null,
                nextAuthority: null,
                currentAssignee: row.assignee,
                nextAssignee: input.assignee,
                currentPermissions: row.permissions ?? [],
                nextPermissions: row.permissions ?? []
            }))
        return {
            count: rows.length,
            rows: rows.slice(0, cfg.maxPreviewRows),
            allRows: rows,
            warnings: ['将为未设置 assignee 的频道写入指定受理人。']
        }
    }
    const data = await getPermissionOverviewData(ctx, cfg, {
        page: 1,
        pageSize: Number.MAX_SAFE_INTEGER,
        inactiveDays: input.days
    })
    const rows = data.users.map((row: PermissionUserView) => ({
        kind: 'user',
        id: row.id,
        platform: row.platforms.join(', ') || '-',
        name: row.displayName,
        reason: `超过 ${row.inactiveDays} 天未活跃`,
        currentAuthority: row.authority,
        nextAuthority: input.authority,
        currentAssignee: '',
        nextAssignee: '',
        currentPermissions: row.permissions,
        nextPermissions: input.permissions
    }))
    return {
        count: rows.length,
        rows: rows.slice(0, cfg.maxPreviewRows),
        allRows: rows,
        warnings: ['将修改长期未活跃用户的 authority 和 permissions。']
    }
}

async function overview(
    ctx: Context,
    cfg: Config,
    app: {
        chatluna?: {
            platform?: {
                _platformClients?: Record<string, PlatformClient>
                _createClientFunctions?: Record<string, () => PlatformClient>
                _models?: Record<string, ModelEntry[]>
                _tools?: Record<string, ToolEntry>
                _chatChains?: Record<string, ChainEntry>
                _vectorStore?: Record<string, unknown>
            }
            getPlugin?: (platform: string) => PluginEntry | undefined
            preset?: {
                _presets?: {
                    value?: PresetEntry[]
                }
                resolvePresetDir?: () => string
            }
            config?: ChatLunaRuntimeConfig
            currentConfig?: ChatLunaRuntimeConfig
        }
    }
) {
    const [convs, msgs, acls, rules, arcs, bindings, metas] =
        await Promise.all([
            getRows<ConversationRecord>(ctx, 'chatluna_conversation'),
            getMessageRows(ctx),
            getRows<AclRecord>(ctx, 'chatluna_acl'),
            getRows<ConstraintRecord>(ctx, 'chatluna_constraint'),
            getRows<ArchiveRecord>(ctx, 'chatluna_archive'),
            getRows<BindingRecord>(ctx, 'chatluna_binding'),
            getRows<MetaRecord>(ctx, 'chatluna_meta')
        ])
    const models = countBy(convs.map((row) => row.model))
    const users = buildUsers(convs, acls, rules)
    const contexts = buildContexts(convs, bindings, acls, rules, [], [], [])
    const providers = buildProviders(app, convs)
    const resources = buildResources(app, convs, rules)
    const msgBucket = bucketByConversation(msgs)
    const issues = convs
        .map((row) =>
            diagnoseConversation(row, msgBucket.get(row.id) ?? [], true)
        )
        .filter((row) => row.issues.length > 0)

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
            active: convs.filter((row) => row.status === 'active').length,
            archived: convs.filter((row) => row.status === 'archived').length,
            deleted: convs.filter((row) => row.status === 'deleted').length,
            broken: convs.filter((row) => row.status === 'broken').length,
            issues: issues.length,
            providers: providers.length,
            resources: resources.length,
            liveModels: providers.reduce((sum, row) => sum + row.models.length, 0)
        },
        models: Object.entries(models)
            .map(([model, count]) => ({ model, count }))
            .sort((a, b) => b.count - a.count),
        liveModels: liveModels(app),
        providers: providers.slice(0, 8),
        contexts: contexts.slice(0, 8),
        resources: resources.slice(0, 8),
        runtime: {
            connected: app.chatluna != null,
            tools: Object.keys(app.chatluna?.platform?._tools ?? {}).length,
            chatChains: Object.keys(app.chatluna?.platform?._chatChains ?? {})
                .length,
            vectorStores: Object.keys(app.chatluna?.platform?._vectorStore ?? {})
                .length,
            presets: app.chatluna?.preset?._presets?.value?.length ?? 0,
            presetDir: app.chatluna?.preset?.resolvePresetDir?.() ?? '',
            defaults: {
                model:
                    app.chatluna?.currentConfig?.defaultModel ??
                    app.chatluna?.config?.defaultModel ??
                    '',
                preset:
                    app.chatluna?.currentConfig?.defaultPreset ??
                    app.chatluna?.config?.defaultPreset ??
                    '',
                chatMode:
                    app.chatluna?.currentConfig?.defaultChatMode ??
                    app.chatluna?.config?.defaultChatMode ??
                    '',
                embeddings:
                    app.chatluna?.currentConfig?.defaultEmbeddings ??
                    app.chatluna?.config?.defaultEmbeddings ??
                    '',
                vectorStore:
                    app.chatluna?.currentConfig?.defaultVectorStore ??
                    app.chatluna?.config?.defaultVectorStore ??
                    '',
                groupRoute:
                    app.chatluna?.currentConfig?.defaultGroupRouteMode ??
                    app.chatluna?.config?.defaultGroupRouteMode ??
                    ''
            }
        },
        recent: convs
            .slice()
            .sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt))
            .slice(0, 8)
            .map((row) => viewConversation(row)),
        issues: issues.slice(0, 8),
        audits,
        loadErrors: Array.from(loadErrors.values())
    }
}

async function health(
    ctx: Context,
    cfg: Config,
    app: {
        chatluna?: {
            platform?: {
                _models?: Record<string, ModelEntry[]>
                _chatChains?: Record<string, ChainEntry>
            }
            preset?: {
                _presets?: {
                    value?: PresetEntry[]
                }
            }
        }
    }
) {
    const [convs, msgs, bindings, acls, rules, arcs] = await Promise.all([
        getRows<ConversationRecord>(ctx, 'chatluna_conversation'),
        getMessageRows(ctx),
        getRows<BindingRecord>(ctx, 'chatluna_binding'),
        getRows<AclRecord>(ctx, 'chatluna_acl'),
        getRows<ConstraintRecord>(ctx, 'chatluna_constraint'),
        getRows<ArchiveRecord>(ctx, 'chatluna_archive')
    ])
    const issues: HealthIssue[] = []
    const convIds = new Set(convs.map((row) => row.id))
    const modelNames = new Set(liveModels(app))
    const chainNames = new Set(
        Object.keys(app.chatluna?.platform?._chatChains ?? {})
    )
    const presetNames = new Set(
        (app.chatluna?.preset?._presets?.value ?? []).flatMap(
            (row) => row.triggerKeyword ?? []
        )
    )
    const msgBucket = bucketByConversation(msgs)
    for (const conv of convs) {
        const diag = diagnoseConversation(
            conv,
            msgBucket.get(conv.id) ?? [],
            true
        )
        for (const issue of diag.issues) {
            issues.push({
                type: 'message-chain',
                level: issue.type === 'orphan' ? 'warning' : 'danger',
                target: conv.id,
                message: issue.message,
                action: '打开消息页检查链路，必要时启用消息修复后预览执行。'
            })
        }
        if (modelNames.size > 0 && !modelNames.has(conv.model)) {
            issues.push({
                type: 'missing-model',
                level: 'warning',
                target: conv.id,
                message: `会话模型未在运行时模型列表中: ${conv.model}`,
                action: '检查 provider 是否加载，或批量迁移到可用模型。'
            })
        }
        if (chainNames.size > 0 && !chainNames.has(conv.chatMode)) {
            issues.push({
                type: 'missing-chat-chain',
                level: 'warning',
                target: conv.id,
                message: `会话 chatMode 未注册: ${conv.chatMode}`,
                action: '检查 ChatLuna 扩展或修改会话 chatMode。'
            })
        }
        if (presetNames.size > 0 && !presetNames.has(conv.preset)) {
            issues.push({
                type: 'missing-preset',
                level: 'warning',
                target: conv.id,
                message: `会话 preset 未加载: ${conv.preset}`,
                action: '检查 preset 文件或修改会话 preset。'
            })
        }
    }
    for (const binding of bindings) {
        if (
            binding.activeConversationId &&
            !convIds.has(binding.activeConversationId)
        ) {
            issues.push({
                type: 'dangling-binding',
                level: 'danger',
                target: binding.bindingKey,
                message: `activeConversationId 指向缺失会话: ${binding.activeConversationId}`,
                action: '切换或清理该 binding 的活跃会话。'
            })
        }
        if (
            binding.lastConversationId &&
            !convIds.has(binding.lastConversationId)
        ) {
            issues.push({
                type: 'dangling-binding',
                level: 'warning',
                target: binding.bindingKey,
                message: `lastConversationId 指向缺失会话: ${binding.lastConversationId}`,
                action: '检查历史 binding 记录。'
            })
        }
    }
    for (const acl of acls) {
        if (!convIds.has(acl.conversationId)) {
            issues.push({
                type: 'dangling-acl',
                level: 'warning',
                target: acl.conversationId,
                message: `ACL 指向缺失会话: ${acl.principalType}/${acl.principalId}`,
                action: '删除悬空 ACL 或恢复对应会话。'
            })
        }
    }
    for (const rule of rules) {
        for (const model of [rule.defaultModel, rule.fixedModel]) {
            if (model && modelNames.size > 0 && !modelNames.has(model)) {
                issues.push({
                    type: 'rule-missing-model',
                    level: 'warning',
                    target: rule.name,
                    message: `规则引用未加载模型: ${model}`,
                    action: '更新规则模型或检查 provider。'
                })
            }
        }
        for (const mode of [rule.defaultChatMode, rule.fixedChatMode]) {
            if (mode && chainNames.size > 0 && !chainNames.has(mode)) {
                issues.push({
                    type: 'rule-missing-chat-chain',
                    level: 'warning',
                    target: rule.name,
                    message: `规则引用未注册 chatMode: ${mode}`,
                    action: '更新规则 chatMode 或启用对应扩展。'
                })
            }
        }
        for (const preset of [rule.defaultPreset, rule.fixedPreset]) {
            if (preset && presetNames.size > 0 && !presetNames.has(preset)) {
                issues.push({
                    type: 'rule-missing-preset',
                    level: 'warning',
                    target: rule.name,
                    message: `规则引用未加载 preset: ${preset}`,
                    action: '更新规则 preset 或检查 preset 文件。'
                })
            }
        }
    }
    if (cfg.enableArchiveFileOps) {
        for (const arc of await Promise.all(
            arcs.map((row) => viewArchive(row, cfg))
        )) {
            if (arc.fileState === 'missing') {
                issues.push({
                    type: 'archive-missing-file',
                    level: 'warning',
                    target: arc.id,
                    message: `归档文件缺失: ${arc.path}`,
                    action: '在操作页预览归档清理，或恢复文件。'
                })
            }
        }
    }
    return {
        score: Math.max(0, 100 - issues.length * 5),
        totals: {
            danger: issues.filter((row) => row.level === 'danger').length,
            warning: issues.filter((row) => row.level === 'warning').length,
            info: issues.filter((row) => row.level === 'info').length
        },
        rows: issues.slice(0, cfg.maxPreviewRows)
    }
}

async function modelHealth(
    ctx: Context,
    cfg: Config,
    app: {
        chatluna?: {
            platform?: {
                _platformClients?: Record<string, PlatformClient>
                _createClientFunctions?: Record<string, () => PlatformClient>
                _models?: Record<string, ModelEntry[]>
                _tools?: Record<string, ToolEntry>
                _chatChains?: Record<string, ChainEntry>
                _vectorStore?: Record<string, unknown>
            }
            preset?: {
                _presets?: {
                    value?: PresetEntry[]
                }
            }
            config?: ChatLunaRuntimeConfig
            currentConfig?: ChatLunaRuntimeConfig
            getPlugin?: (platform: string) => PluginEntry | undefined
        }
    },
    input: ModelHealthInput
) {
    const [convs, rules, bindings, acls, arcs] = await Promise.all([
        getRows<ConversationRecord>(ctx, 'chatluna_conversation'),
        getRows<ConstraintRecord>(ctx, 'chatluna_constraint'),
        getRows<BindingRecord>(ctx, 'chatluna_binding'),
        getRows<AclRecord>(ctx, 'chatluna_acl'),
        getRows<ArchiveRecord>(ctx, 'chatluna_archive')
    ])
    const providers = buildProviders(app, convs)
    const resources = buildResources(app, convs, rules)
    const live = liveModels(app)
    const liveSet = new Set(live)
    const chainSet = new Set(Object.keys(app.chatluna?.platform?._chatChains ?? {}))
    const presetSet = new Set(
        (app.chatluna?.preset?._presets?.value ?? []).flatMap(
            (row) => row.triggerKeyword ?? []
        )
    )
    const fork = findChatLunaFork(ctx)
    const cfgSource =
        (fork?.fork.config as Partial<ChatLunaRuntimeConfig>) ??
        app.chatluna?.currentConfig ??
        app.chatluna?.config ??
        {}
    const refs: ModelReferenceView[] = []
    for (const conv of convs) {
        refs.push({
            kind: 'conversation',
            id: conv.id,
            title: conv.title || conv.id,
            field: 'model',
            model: conv.model,
            status: conv.status,
            platform: conv.model.includes('/')
                ? conv.model.slice(0, conv.model.indexOf('/'))
                : '',
            valid: liveSet.size === 0 || liveSet.has(conv.model),
            updatedAt: iso(conv.updatedAt)
        })
    }
    for (const rule of rules) {
        for (const field of ['defaultModel', 'fixedModel'] as const) {
            const model = rule[field]
            if (!model) continue
            refs.push({
                kind: 'constraint',
                id: String(rule.id),
                title: rule.name || String(rule.id),
                field,
                model,
                status: rule.enabled ? 'enabled' : 'disabled',
                platform: model.includes('/')
                    ? model.slice(0, model.indexOf('/'))
                    : '',
                valid: liveSet.size === 0 || liveSet.has(model),
                updatedAt: iso(rule.updatedAt)
            })
        }
    }
    if (cfgSource.defaultModel) {
        refs.push({
            kind: 'config',
            id: 'defaultModel',
            title: 'ChatLuna 默认模型',
            field: 'defaultModel',
            model: cfgSource.defaultModel,
            status: fork?.key ?? 'runtime',
            platform: cfgSource.defaultModel.includes('/')
                ? cfgSource.defaultModel.slice(
                      0,
                      cfgSource.defaultModel.indexOf('/')
                  )
                : '',
            valid: liveSet.size === 0 || liveSet.has(cfgSource.defaultModel),
            updatedAt: ''
        })
    }
    const convIds = new Set(convs.map((row) => row.id))
    const issues: ModelHealthIssue[] = []
    for (const row of providers) {
        if (row.state === 'database-only') {
            issues.push({
                type: 'database-only-provider',
                level: 'warning',
                target: row.platform,
                platform: row.platform,
                message: '数据库中存在该平台模型引用，但运行时未注册 provider。',
                action: '安装或启用对应 adapter，或迁移这些会话模型。'
            })
        }
        if (row.configCount > 0 && row.availableConfigCount === 0) {
            issues.push({
                type: 'provider-no-config',
                level: 'danger',
                target: row.platform,
                platform: row.platform,
                message: 'provider 已注册但没有可用配置。',
                action: '检查 adapter 配置或刷新 provider。'
            })
        }
    }
    for (const ref of refs.filter((row) => !row.valid)) {
        issues.push({
            type: 'missing-model',
            level: 'warning',
            target: ref.id,
            platform: ref.platform,
            message: `${ref.kind}.${ref.field} 引用未加载模型: ${ref.model}`,
            action: '选择可用模型后预览迁移。'
        })
    }
    for (const conv of convs) {
        const platform = conv.model.includes('/')
            ? conv.model.slice(0, conv.model.indexOf('/'))
            : ''
        if (chainSet.size > 0 && !chainSet.has(conv.chatMode)) {
            issues.push({
                type: 'missing-chat-chain',
                level: 'warning',
                target: conv.id,
                platform,
                message: `会话 chatMode 未注册: ${conv.chatMode}`,
                action: '启用对应扩展或修改会话 chatMode。'
            })
        }
        if (presetSet.size > 0 && !presetSet.has(conv.preset)) {
            issues.push({
                type: 'missing-preset',
                level: 'warning',
                target: conv.id,
                platform,
                message: `会话 preset 未加载: ${conv.preset}`,
                action: '检查 preset 文件或修改会话 preset。'
            })
        }
    }
    for (const rule of rules) {
        for (const mode of [rule.defaultChatMode, rule.fixedChatMode]) {
            if (mode && chainSet.size > 0 && !chainSet.has(mode)) {
                issues.push({
                    type: 'missing-chat-chain',
                    level: 'warning',
                    target: rule.name,
                    platform: '',
                    message: `规则引用未注册 chatMode: ${mode}`,
                    action: '更新规则 chatMode 或启用对应扩展。'
                })
            }
        }
        for (const preset of [rule.defaultPreset, rule.fixedPreset]) {
            if (preset && presetSet.size > 0 && !presetSet.has(preset)) {
                issues.push({
                    type: 'missing-preset',
                    level: 'warning',
                    target: rule.name,
                    platform: '',
                    message: `规则引用未加载 preset: ${preset}`,
                    action: '更新规则 preset 或检查 preset 文件。'
                })
            }
        }
    }
    for (const binding of bindings) {
        if (
            binding.activeConversationId &&
            !convIds.has(binding.activeConversationId)
        ) {
            issues.push({
                type: 'dangling-binding',
                level: 'danger',
                target: binding.bindingKey,
                platform: '',
                message: `activeConversationId 指向缺失会话: ${binding.activeConversationId}`,
                action: '切换或清理该 binding 的活跃会话。'
            })
        }
    }
    for (const acl of acls) {
        if (!convIds.has(acl.conversationId)) {
            issues.push({
                type: 'dangling-acl',
                level: 'warning',
                target: acl.conversationId,
                platform: '',
                message: `ACL 指向缺失会话: ${acl.principalType}/${acl.principalId}`,
                action: '删除悬空 ACL 或恢复对应会话。'
            })
        }
    }
    if (cfg.enableArchiveFileOps) {
        for (const arc of await Promise.all(
            arcs.map((row) => viewArchive(row, cfg))
        )) {
            if (arc.fileState === 'missing') {
                issues.push({
                    type: 'archive-missing-file',
                    level: 'warning',
                    target: arc.id,
                    platform: '',
                    message: `归档文件缺失: ${arc.path}`,
                    action: '在维护页预览归档清理，或恢复文件。'
                })
            }
        }
    }
    const q = input.query?.trim().toLowerCase() ?? ''
    const filteredProviders = providers
        .map((row) => ({
            ...row,
            riskCount: issues.filter(
                (issue) =>
                    issue.platform === row.platform || issue.target === row.platform
            ).length
        }))
        .filter((row) => {
            if (input.platform && row.platform !== input.platform) return false
            if (!q) return true
            return [
                row.platform,
                row.state,
                row.capabilities.join('\n'),
                row.models.map((model) => model.name).join('\n')
            ]
                .join('\n')
                .toLowerCase()
                .includes(q)
        })
    const filteredIssues = issues.filter((row) => {
        if (input.platform && row.platform && row.platform !== input.platform) {
            return false
        }
        if (input.issueType && row.type !== input.issueType) return false
        if (!q) return true
        return [row.type, row.target, row.message, row.action, row.platform]
            .join('\n')
            .toLowerCase()
            .includes(q)
    })
    const groups = Object.values(
        filteredIssues.reduce<Record<string, ModelHealthIssueGroup>>(
            (map, row) => {
                map[row.type] ??= {
                    type: row.type,
                    label: issueTypeText(row.type),
                    level: row.level,
                    count: 0,
                    action: row.action,
                    rows: []
                }
                map[row.type].count += 1
                map[row.type].rows.push(row)
                if (row.level === 'danger') map[row.type].level = 'danger'
                return map
            },
            {}
        )
    ).sort((a, b) => b.count - a.count)
    const configTotal = providers.reduce((sum, row) => sum + row.configCount, 0)
    const configAvailable = providers.reduce(
        (sum, row) => sum + row.availableConfigCount,
        0
    )
    return {
        summary: {
            score: Math.max(
                0,
                100 -
                    issues.filter((row) => row.level === 'danger').length * 10 -
                    issues.filter((row) => row.level === 'warning').length * 5 -
                    issues.filter((row) => row.level === 'info').length * 2
            ),
            loadedProviders: providers.filter((row) => row.state === 'loaded')
                .length,
            registeredProviders: providers.filter(
                (row) => row.state === 'registered'
            ).length,
            databaseOnlyProviders: providers.filter(
                (row) => row.state === 'database-only'
            ).length,
            configAvailable,
            configTotal,
            missingModelRefs: refs.filter((row) => !row.valid).length,
            missingPresetRefs: issues.filter((row) => row.type === 'missing-preset')
                .length,
            missingChatModeRefs: issues.filter(
                (row) => row.type === 'missing-chat-chain'
            ).length,
            issues: issues.length
        },
        providers: filteredProviders,
        issues: filteredIssues.slice(0, cfg.maxPreviewRows),
        issueGroups: groups,
        modelRefs: refs.filter((row) => {
            if (input.platform && row.platform !== input.platform) return false
            if (!q) return true
            return [row.kind, row.title, row.field, row.model, row.status]
                .join('\n')
                .toLowerCase()
                .includes(q)
        }),
        resources,
        choices: {
            models: live,
            providers: providers.map((row) => row.platform).sort(),
            issueTypes: Array.from(new Set(issues.map((row) => row.type))).sort()
        }
    }
}

function pageRows<T>(
    rows: T[],
    input: ListInput,
    text: (row: T) => string,
    sort: (a: T, b: T) => number,
    cfg: Config
) {
    const q = (input.query ?? '').trim().toLowerCase()
    const page = Math.max(1, Number(input.page ?? 1))
    const pageSize = Math.max(10, Number(input.pageSize ?? cfg.pageSize))
    const filtered = rows
        .filter((row) => !q || text(row).toLowerCase().includes(q))
        .sort(sort)
    const start = (page - 1) * pageSize
    return {
        page,
        pageSize,
        total: filtered.length,
        rows: filtered.slice(start, start + pageSize)
    }
}

function viewConversation(row: ConversationRecord) {
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
    }
}

async function viewMessage(row: Partial<MessageRecord> & MessageListRow) {
    return {
        id: row.id,
        conversationId: row.conversationId,
        parentId: row.parentId ?? null,
        role: row.role,
        text: await readMessageText(row),
        name: row.name ?? '',
        toolCallId: row.tool_call_id ?? '',
        rawId: row.rawId ?? '',
        createdAt: iso(row.createdAt)
    }
}

function viewConstraint(row: ConstraintRecord) {
    return {
        ...row,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
        users: row.users ?? [],
        excludeUsers: row.excludeUsers ?? []
    }
}

async function viewArchive(row: ArchiveRecord, cfg: Config) {
    if (!cfg.enableArchiveFileOps) {
        return {
            ...row,
            createdAt: iso(row.createdAt),
            restoredAt: iso(row.restoredAt),
            fileState: 'disabled',
            fileSize: null
        }
    }
    try {
        await access(row.path, constants.R_OK)
        return {
            ...row,
            createdAt: iso(row.createdAt),
            restoredAt: iso(row.restoredAt),
            fileState: 'ok',
            fileSize: (await stat(row.path)).size
        }
    } catch {
        return {
            ...row,
            createdAt: iso(row.createdAt),
            restoredAt: iso(row.restoredAt),
            fileState: 'missing',
            fileSize: null
        }
    }
}

// Structural shape used by diagnoseConversation / bucketByConversation. Both
// the full MessageRecord and the projected MessageListRow satisfy it, so we
// don't have to load binary blobs to run the chain diagnostics.
type ChainMessage = {
    id: string
    conversationId: string
    parentId?: string | null
}

function bucketByConversation<T extends ChainMessage>(messages: T[]) {
    const map = new Map<string, T[]>()
    for (const row of messages) {
        const key = row.conversationId
        const list = map.get(key)
        if (list) list.push(row)
        else map.set(key, [row])
    }
    return map
}

function diagnoseConversation<T extends ChainMessage>(
    conv: ConversationRecord,
    messages: T[],
    preFiltered = false
) {
    const rows = preFiltered
        ? messages
        : messages.filter((row) => row.conversationId === conv.id)
    const map = new Map(rows.map((row) => [row.id, row]))
    const chain: T[] = []
    const seen = new Set<string>()
    const issues: DiagnosticIssue[] = []
    let id: string | null | undefined = conv.latestMessageId
    if (rows.length > 0 && !id) {
        issues.push({ type: 'missing-latest', message: 'latestMessageId 缺失' })
    }
    while (id) {
        if (seen.has(id)) {
            issues.push({ type: 'loop', message: `消息链循环: ${id}` })
            break
        }
        const row = map.get(id)
        if (!row) {
            issues.push({ type: 'broken-link', message: `找不到消息: ${id}` })
            break
        }
        seen.add(id)
        chain.unshift(row)
        id = row.parentId
    }
    const loose = rows.filter((row) => !seen.has(row.id))
    if (loose.length > 0) {
        issues.push({
            type: 'orphan',
            message: `${loose.length} 条消息不在 latestMessageId 链路中`
        })
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
    }
}

function buildUsers(
    convs: ConversationRecord[],
    acls: AclRecord[],
    rules: ConstraintRecord[]
) {
    const map = new Map<string, UserView>()
    for (const row of convs) {
        const userId = row.createdBy || row.bindingKey
        const item =
            map.get(userId) ??
            ({
                userId,
                guildId: '',
                bindingKeys: [],
                conversations: 0,
                active: 0,
                archived: 0,
                acl: 0,
                constraints: 0,
                latestConversationId: '',
                latestTitle: '',
                updatedAt: '',
                models: {}
            } satisfies UserView)
        item.conversations += 1
        item.active += row.status === 'active' ? 1 : 0
        item.archived += row.status === 'archived' ? 1 : 0
        item.models[row.model] = (item.models[row.model] ?? 0) + 1
        if (!item.bindingKeys.includes(row.bindingKey)) {
            item.bindingKeys.push(row.bindingKey)
        }
        if (timeOf(row.updatedAt) >= timeOf(item.updatedAt)) {
            item.updatedAt = iso(row.updatedAt)
            item.latestConversationId = row.id
            item.latestTitle = row.title
        }
        map.set(userId, item)
    }
    for (const row of acls) {
        const item = map.get(row.principalId)
        if (item) item.acl += 1
    }
    for (const row of rules) {
        for (const user of [
            row.createdBy,
            ...readUserList(row.users),
            ...readUserList(row.excludeUsers)
        ]) {
            if (user && map.has(user)) map.get(user).constraints += 1
        }
    }
    return Array.from(map.values())
}

function buildContexts(
    convs: ConversationRecord[],
    bindings: BindingRecord[],
    acls: AclRecord[],
    rules: ConstraintRecord[],
    users: KoishiUserRecord[],
    kBindings: KoishiBindingRecord[],
    channels: KoishiChannelRecord[]
) {
    const map = new Map<string, ContextView>()
    for (const conv of convs) {
        const parsed = parseBindingKey(conv.bindingKey)
        const row =
            map.get(conv.bindingKey) ??
            ({
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
                activeConversationId: '',
                lastConversationId: '',
                latestConversationId: '',
                latestTitle: '',
                updatedAt: '',
                koishiUserId: null,
                koishiUserName: '',
                koishiUserAuthority: null,
                koishiUserPermissions: [],
                koishiBindingCount: 0,
                channelAssignee: '',
                channelPermissions: []
            } satisfies ContextView)
        row.conversations += 1
        row.active += conv.status === 'active' ? 1 : 0
        row.archived += conv.status === 'archived' ? 1 : 0
        row.deleted += conv.status === 'deleted' ? 1 : 0
        row.broken += conv.status === 'broken' ? 1 : 0
        row.models[conv.model] = (row.models[conv.model] ?? 0) + 1
        if (timeOf(conv.updatedAt) >= timeOf(row.updatedAt)) {
            row.updatedAt = iso(conv.updatedAt)
            row.latestConversationId = conv.id
            row.latestTitle = conv.title
        }
        map.set(conv.bindingKey, row)
    }
    for (const binding of bindings) {
        const row = map.get(binding.bindingKey)
        if (!row) continue
        row.activeConversationId = binding.activeConversationId ?? ''
        row.lastConversationId = binding.lastConversationId ?? ''
    }
    // Index contexts by their latestConversationId so ACLs can be counted in
    // a single pass over `acls` instead of acls·contexts.
    const ctxByLatestConvId = new Map<string, ContextView>()
    for (const row of map.values()) {
        if (row.latestConversationId) {
            ctxByLatestConvId.set(row.latestConversationId, row)
        }
    }
    for (const acl of acls) {
        const row = ctxByLatestConvId.get(acl.conversationId)
        if (row) row.acl += 1
    }
    for (const rule of rules) {
        // Parse user lists once per rule rather than re-parsing inside the
        // contexts loop (which used to JSON.parse them up to 2x per context).
        const ruleUsers = readUserList(rule.users)
        const ruleExcludes = readUserList(rule.excludeUsers)
        for (const row of map.values()) {
            const byPlatform =
                rule.platform == null || rule.platform === row.platform
            const bySelf = rule.selfId == null || rule.selfId === row.selfId
            const byGuild = rule.guildId == null || rule.guildId === row.guildId
            const byUser =
                ruleUsers.length === 0 || ruleUsers.includes(row.userId)
            const excluded = ruleExcludes.includes(row.userId)
            if (byPlatform && bySelf && byGuild && byUser && !excluded) {
                row.constraints += 1
            }
        }
    }
    // Pre-index Koishi bindings by `platform:pid` and channels by
    // `platform:guildId|id` so the contexts loop is O(contexts) instead of
    // O(contexts·kBindings + contexts·channels + contexts·users).
    const bindingByPidKey = new Map<string, KoishiBindingRecord[]>()
    for (const item of kBindings) {
        const key = `${item.platform}:${item.pid}`
        const list = bindingByPidKey.get(key)
        if (list) list.push(item)
        else bindingByPidKey.set(key, [item])
    }
    const userById = new Map(users.map((item) => [item.id, item]))
    const channelByGuild = new Map<string, KoishiChannelRecord>()
    for (const item of channels) {
        if (item.guildId) {
            channelByGuild.set(`${item.platform}:${item.guildId}`, item)
        }
        if (item.id) {
            const key = `${item.platform}:${item.id}`
            if (!channelByGuild.has(key)) channelByGuild.set(key, item)
        }
    }
    for (const row of map.values()) {
        const refs = bindingByPidKey.get(`${row.platform}:${row.userId}`) ?? []
        row.koishiBindingCount = refs.length
        let user: KoishiUserRecord | undefined
        for (const ref of refs) {
            user = userById.get(ref.aid)
            if (user) break
        }
        if (user) {
            row.koishiUserId = user.id
            row.koishiUserName = user.name
            row.koishiUserAuthority = user.authority
            row.koishiUserPermissions = user.permissions ?? []
        }
        const channel = channelByGuild.get(`${row.platform}:${row.guildId}`)
        if (channel) {
            row.channelAssignee = channel.assignee
            row.channelPermissions = channel.permissions ?? []
        }
    }
    return Array.from(map.values())
}

function buildProviders(
    app: {
        chatluna?: {
            platform?: {
                _platformClients?: Record<string, PlatformClient>
                _createClientFunctions?: Record<string, () => PlatformClient>
                _models?: Record<string, ModelEntry[]>
            }
            getPlugin?: (platform: string) => PluginEntry | undefined
        }
    },
    convs: ConversationRecord[]
) {
    const service = app.chatluna?.platform
    const names = new Set<string>([
        ...Object.keys(service?._createClientFunctions ?? {}),
        ...Object.keys(service?._platformClients ?? {}),
        ...Object.keys(service?._models ?? {})
    ])
    for (const row of convs) {
        const idx = row.model.indexOf('/')
        if (idx > 0) names.add(row.model.slice(0, idx))
    }
    return Array.from(names).map((platform) => {
        const client = service?._platformClients?.[platform]
        const plugin = app.chatluna?.getPlugin?.(platform)
        const models = (service?._models?.[platform] ?? []).map((model) => ({
            name: model.name,
            type: model.type,
            typeText: modelTypeText(model.type),
            maxTokens: model.maxTokens ?? 0,
            capabilities: model.capabilities ?? []
        }))
        const rows = convs.filter((row) =>
            row.model.startsWith(`${platform}/`)
        )
        const configs =
            client?.configPool?.getConfigs?.() ??
            plugin?.platformConfigPool?.getConfigs?.() ??
            []
        const caps = Array.from(
            new Set(models.flatMap((model) => model.capabilities))
        ).sort()
        const tokens = models
            .map((model) => model.maxTokens)
            .filter((value) => value > 0)
        const files = client?.getFileHandlingConfig?.()
        return {
            platform,
            registered: service?._createClientFunctions?.[platform] != null,
            loaded: client != null,
            pluginInstalled: plugin != null,
            state: client
                ? 'loaded'
                : service?._createClientFunctions?.[platform]
                  ? 'registered'
                  : 'database-only',
            configCount: configs.length,
            availableConfigCount: configs.filter((row) => row.isAvailable)
                .length,
            modelCount: models.length,
            llmCount: models.filter((model) => model.type === 1).length,
            embeddingsCount: models.filter((model) => model.type === 2).length,
            rerankerCount: models.filter((model) => model.type === 3).length,
            capabilities: caps,
            maxTokensMin: tokens.length > 0 ? Math.min(...tokens) : 0,
            maxTokensMax: tokens.length > 0 ? Math.max(...tokens) : 0,
            fileHandling: files
                ? {
                      supportedMimeTypes: Array.from(files.supportedMimeTypes),
                      maxTotalSizeBytes: files.maxTotalSizeBytes,
                      maxFileSizeBytes: files.maxFileSizeBytes,
                      maxFileSizeBytesOverrides:
                          files.maxFileSizeBytesOverrides ?? {}
                  }
                : null,
            conversations: rows.length,
            activeConversations: rows.filter((row) => row.status === 'active')
                .length,
            archivedConversations: rows.filter(
                (row) => row.status === 'archived'
            ).length,
            models,
            recent: rows
                .slice()
                .sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt))
                .slice(0, 8)
                .map((row) => viewConversation(row))
        } satisfies ProviderView
    })
}

function buildResources(
    app: {
        chatluna?: {
            platform?: {
                _tools?: Record<string, ToolEntry>
                _chatChains?: Record<string, ChainEntry>
                _vectorStore?: Record<string, unknown>
            }
            preset?: {
                _presets?: {
                    value?: PresetEntry[]
                }
                resolvePresetDir?: () => string
            }
            config?: ChatLunaRuntimeConfig
            currentConfig?: ChatLunaRuntimeConfig
        }
    },
    convs: ConversationRecord[],
    rules: ConstraintRecord[]
) {
    const result: ResourceView[] = []
    for (const [name, tool] of Object.entries(
        app.chatluna?.platform?._tools ?? {}
    )) {
        result.push({
            type: 'tool',
            name,
            description: tool.description ?? '',
            source: tool.meta?.source ?? '',
            group: tool.meta?.group ?? '',
            tags: tool.meta?.tags ?? [],
            usedByConversations: 0,
            usedByRules: 0,
            path: '',
            details: {
                mcp: tool.meta?.isMcp === true,
                serverName: tool.meta?.serverName ?? '',
                defaultAvailability: tool.meta?.defaultAvailability ?? {}
            }
        })
    }
    for (const [name, chain] of Object.entries(
        app.chatluna?.platform?._chatChains ?? {}
    )) {
        result.push({
            type: 'chat-chain',
            name,
            description: JSON.stringify(chain.description ?? {}),
            source: '',
            group: '',
            tags: [],
            usedByConversations: convs.filter((row) => row.chatMode === name)
                .length,
            usedByRules: rules.filter(
                (row) =>
                    row.defaultChatMode === name || row.fixedChatMode === name
            ).length,
            path: '',
            details: chain.description ?? {}
        })
    }
    for (const name of Object.keys(app.chatluna?.platform?._vectorStore ?? {})) {
        result.push({
            type: 'vector-store',
            name,
            description: '',
            source: '',
            group: '',
            tags: [],
            usedByConversations: 0,
            usedByRules: 0,
            path: '',
            details: {}
        })
    }
    for (const preset of app.chatluna?.preset?._presets?.value ?? []) {
        const name = preset.triggerKeyword?.[0] ?? preset.path ?? ''
        result.push({
            type: 'preset',
            name,
            description: preset.rawText?.slice(0, 180) ?? '',
            source: '',
            group: '',
            tags: preset.triggerKeyword ?? [],
            usedByConversations: convs.filter((row) =>
                preset.triggerKeyword?.includes(row.preset)
            ).length,
            usedByRules: rules.filter(
                (row) =>
                    preset.triggerKeyword?.includes(row.defaultPreset ?? '') ||
                    preset.triggerKeyword?.includes(row.fixedPreset ?? '')
            ).length,
            path: preset.path ?? '',
            details: {
                keywords: preset.triggerKeyword ?? [],
                messages: preset.messages?.length ?? 0,
                presetDir: app.chatluna?.preset?.resolvePresetDir?.() ?? ''
            }
        })
    }
    const cfg = app.chatluna?.currentConfig ?? app.chatluna?.config
    if (cfg) {
        for (const [name, value] of Object.entries({
            defaultModel: cfg.defaultModel,
            defaultPreset: cfg.defaultPreset,
            defaultChatMode: cfg.defaultChatMode,
            defaultEmbeddings: cfg.defaultEmbeddings,
            defaultVectorStore: cfg.defaultVectorStore,
            defaultGroupRouteMode: cfg.defaultGroupRouteMode
        })) {
            result.push({
                type: 'default',
                name,
                description: String(value ?? ''),
                source: 'chatluna-config',
                group: 'default',
                tags: [],
                usedByConversations: 0,
                usedByRules: 0,
                path: '',
                details: {}
            })
        }
    }
    return result
}

function buildProviderDetail(
    app: {
        chatluna?: {
            platform?: {
                _platformClients?: Record<string, PlatformClient>
                _createClientFunctions?: Record<string, () => PlatformClient>
                _models?: Record<string, ModelEntry[]>
                _tools?: Record<string, ToolEntry>
                _chatChains?: Record<string, ChainEntry>
                _vectorStore?: Record<string, unknown>
            }
            getPlugin?: (platform: string) => PluginEntry | undefined
        }
    },
    convs: ConversationRecord[],
    platform: string
) {
    const provider = buildProviders(app, convs).find(
        (row) => row.platform === platform
    )
    return {
        provider,
        tools: Object.entries(app.chatluna?.platform?._tools ?? {}).map(
            ([name, tool]) => ({
                name,
                description: tool.description ?? '',
                source: tool.meta?.source ?? '',
                group: tool.meta?.group ?? '',
                tags: tool.meta?.tags ?? []
            })
        ),
        chatChains: Object.entries(
            app.chatluna?.platform?._chatChains ?? {}
        ).map(([name, chain]) => ({
            name,
            description: chain.description ?? {}
        })),
        vectorStores: Object.keys(app.chatluna?.platform?._vectorStore ?? {})
    }
}

async function previewOperation(
    ctx: Context,
    cfg: Config,
    input: OperationInput
) {
    if (input.type === 'model-migration') {
        const rows = (await getRows<ConversationRecord>(
            ctx,
            'chatluna_conversation'
        ))
            .filter((row) => {
                if (input.fromModel && row.model !== input.fromModel) {
                    return false
                }
                if (input.status && row.status !== input.status) return false
                if (
                    input.user &&
                    row.createdBy !== input.user &&
                    !row.bindingKey.includes(input.user)
                ) {
                    return false
                }
                if (!input.includeArchived && row.status === 'archived') {
                    return false
                }
                return row.model !== input.targetModel
            })
            .map((row) => viewConversation(row))
        return {
            type: input.type,
            count: rows.length,
            rows: rows.slice(0, cfg.maxPreviewRows),
            warnings: [
                '将修改 chatluna_conversation.model 并清理运行时会话缓存。',
                '只会执行本次预览条件匹配到的会话。'
            ],
            blocked: !input.targetModel
        }
    }
    if (input.type === 'model-reference-migration') {
        const rows: ModelReferencePreview[] = []
        if (input.scopes.includes('conversation')) {
            for (const row of await getRows<ConversationRecord>(
                ctx,
                'chatluna_conversation'
            )) {
                if (row.model !== input.fromModel) continue
                if (!input.includeArchived && row.status === 'archived') continue
                rows.push({
                    id: `conversation:${row.id}:model`,
                    refId: row.id,
                    kind: 'conversation',
                    title: row.title || row.id,
                    field: 'model',
                    model: row.model,
                    targetModel: input.targetModel,
                    status: row.status
                })
            }
        }
        const rules = await getRows<ConstraintRecord>(
            ctx,
            'chatluna_constraint'
        )
        if (input.scopes.includes('constraint-default')) {
            for (const row of rules) {
                if (row.defaultModel !== input.fromModel) continue
                rows.push({
                    id: `constraint:${row.id}:defaultModel`,
                    refId: String(row.id),
                    kind: 'constraint',
                    title: row.name || String(row.id),
                    field: 'defaultModel',
                    model: row.defaultModel,
                    targetModel: input.targetModel,
                    status: row.enabled ? 'enabled' : 'disabled'
                })
            }
        }
        if (input.scopes.includes('constraint-fixed')) {
            for (const row of rules) {
                if (row.fixedModel !== input.fromModel) continue
                rows.push({
                    id: `constraint:${row.id}:fixedModel`,
                    refId: String(row.id),
                    kind: 'constraint',
                    title: row.name || String(row.id),
                    field: 'fixedModel',
                    model: row.fixedModel,
                    targetModel: input.targetModel,
                    status: row.enabled ? 'enabled' : 'disabled'
                })
            }
        }
        if (input.scopes.includes('config-default')) {
            const fork = findChatLunaFork(ctx)
            const source =
                (fork?.fork.config as Partial<ChatLunaRuntimeConfig>) ?? {}
            if (source.defaultModel === input.fromModel) {
                rows.push({
                    id: 'config:chatluna:defaultModel',
                    refId: 'defaultModel',
                    kind: 'config',
                    title: 'ChatLuna 默认模型',
                    field: 'defaultModel',
                    model: source.defaultModel,
                    targetModel: input.targetModel,
                    status: fork?.key ?? 'runtime'
                })
            }
        }
        return {
            type: input.type,
            count: rows.length,
            rows: rows.slice(0, cfg.maxPreviewRows),
            allRows: rows,
            warnings: [
                '将修改模型引用字段，涉及会话时会清理运行时会话缓存。',
                '配置写回要求 Koishi loader 可写。'
            ],
            blocked:
                !input.fromModel ||
                !input.targetModel ||
                input.fromModel === input.targetModel ||
                input.scopes.length === 0
        }
    }
    if (input.type === 'status-change') {
        const rows = (await getRows<ConversationRecord>(
            ctx,
            'chatluna_conversation'
        ))
            .filter((row) => {
                if (input.status && row.status !== input.status) return false
                if (input.model && row.model !== input.model) return false
                if (
                    input.user &&
                    row.createdBy !== input.user &&
                    !row.bindingKey.includes(input.user)
                ) {
                    return false
                }
                return row.status !== input.targetStatus
            })
            .map((row) => viewConversation(row))
        return {
            type: input.type,
            count: rows.length,
            rows: rows.slice(0, cfg.maxPreviewRows),
            warnings: ['将批量修改会话 status。'],
            blocked: !input.targetStatus
        }
    }
    if (input.type === 'archive-record-cleanup') {
        const rows = (
            await Promise.all(
                (
                    await getRows<ArchiveRecord>(ctx, 'chatluna_archive')
                ).map((row) => viewArchive(row, cfg))
            )
        ).filter((row) => row.fileState === 'missing')
        return {
            type: input.type,
            count: rows.length,
            rows: rows.slice(0, cfg.maxPreviewRows),
            warnings: ['将删除缺失文件对应的 chatluna_archive 表记录。'],
            blocked: !cfg.enableArchiveFileOps
        }
    }
    if (input.type === 'message-repair') {
        const [conv] = await ctx.database.get('chatluna_conversation', {
            id: input.conversationId
        })
        const msgs = await getMessageChainRows(ctx, {
            conversationId: input.conversationId
        })
        const diag = diagnoseConversation(conv, msgs)
        return {
            type: input.type,
            count: diag.issues.length,
            rows: diag.rows.slice(0, cfg.maxPreviewRows),
            warnings: [
                '将按 createdAt 重建 parentId 链路，并把 latestMessageId 指向最后一条消息。'
            ],
            blocked: !cfg.enableMessageRepair || !input.conversationId
        }
    }
    return {
        type: 'unknown',
        count: 0,
        rows: [],
        warnings: ['未知操作。'],
        blocked: true
    }
}

function liveModels(app: {
    chatluna?: { platform?: { _models?: Record<string, ModelEntry[]> } }
}) {
    return Object.entries(app.chatluna?.platform?._models ?? {})
        .flatMap(([platform, rows]) =>
            rows
                .filter((row) => row.type === 1)
                .map((row) => `${platform}/${row.name}`)
        )
        .sort()
}

function chatlunaConfigDefaults(): ChatLunaRuntimeConfig {
    return {
        botNames: ['香草'],
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
        sendThinkingMessageTimeout: 15000,
        msgCooldown: 0,
        messageQueue: true,
        messageQueueDelay: 0,
        showThoughtMessage: false,
        outputMode: 'text',
        splitMessage: false,
        censor: false,
        rawOnCensor: false,
        streamResponse: false,
        blackList: 0,
        infiniteContext: true,
        infiniteContextThreshold: 0.85,
        autoArchive: false,
        autoArchiveTimeout: 864000,
        autoPurgeArchive: false,
        autoPurgeArchiveTimeout: 2592000,
        defaultEmbeddings: '无',
        defaultVectorStore: '无',
        defaultGroupRouteMode: 'shared',
        defaultChatMode: 'plugin',
        defaultModel: '无',
        defaultPreset: 'sydney',
        voiceSpeakId: 0,
        isLog: false,
        isProxy: false,
        proxyAddress: 'http://127.0.0.1:7897'
    }
}

function findChatLunaFork(ctx: Context) {
    const seen = new Set<Context>()
    let cur: Context | undefined = ctx
    while (cur && !seen.has(cur)) {
        seen.add(cur)
        const record = (
            cur as Context & {
                scope: {
                    [key: symbol]: Record<
                        string,
                        { config: unknown; update: Function }
                    >
                }
            }
        ).scope[Symbol.for('koishi.loader.record')]
        const entry = Object.entries(record ?? {}).find(
            ([key]) => key === 'chatluna' || key.startsWith('chatluna:')
        )
        if (entry) return { key: entry[0], fork: entry[1] }
        cur = cur.scope?.parent
    }
    return null
}

function modelTypeText(type: number) {
    if (type === 1) return 'LLM'
    if (type === 2) return '嵌入'
    if (type === 3) return '重排'
    return '未知'
}

function issueTypeText(type: string) {
    if (type === 'missing-model') return '缺失模型'
    if (type === 'missing-preset') return '缺失 preset'
    if (type === 'missing-chat-chain') return '缺失 chatMode'
    if (type === 'database-only-provider') return '仅数据库 Provider'
    if (type === 'provider-no-config') return '无可用配置'
    if (type === 'dangling-binding') return '悬空 binding'
    if (type === 'dangling-acl') return '悬空 ACL'
    if (type === 'archive-missing-file') return '归档缺文件'
    return type
}

function parseBindingKey(bindingKey: string) {
    const presetIdx = bindingKey.indexOf(':preset:')
    const baseKey =
        presetIdx < 0 ? bindingKey : bindingKey.slice(0, presetIdx)
    const presetLane =
        presetIdx < 0 ? '' : bindingKey.slice(presetIdx + ':preset:'.length)
    const parts = baseKey.split(':')
    if (parts[0] === 'shared') {
        return {
            baseKey,
            presetLane,
            routeMode: 'shared',
            platform: parts[1] ?? '',
            selfId: parts[2] ?? '',
            scope: 'guild',
            guildId: parts[3] ?? '',
            userId: ''
        }
    }
    if (parts[0] === 'personal') {
        if (parts[3] === 'direct') {
            return {
                baseKey,
                presetLane,
                routeMode: 'personal',
                platform: parts[1] ?? '',
                selfId: parts[2] ?? '',
                scope: 'direct',
                guildId: '',
                userId: parts[4] ?? ''
            }
        }
        return {
            baseKey,
            presetLane,
            routeMode: 'personal',
            platform: parts[1] ?? '',
            selfId: parts[2] ?? '',
            scope: 'guild',
            guildId: parts[3] ?? '',
            userId: parts[4] ?? ''
        }
    }
    if (parts[0] === 'custom') {
        return {
            baseKey,
            presetLane,
            routeMode: 'custom',
            platform: '',
            selfId: '',
            scope: 'custom',
            guildId: '',
            userId: ''
        }
    }
    return {
        baseKey,
        presetLane,
        routeMode: 'legacy',
        platform: '',
        selfId: '',
        scope: 'legacy',
        guildId: '',
        userId: ''
    }
}

function readUserList(value?: string | string[] | null) {
    if (Array.isArray(value)) return value
    if (!value) return []
    try {
        const data = JSON.parse(value)
        return Array.isArray(data) ? data : []
    } catch {
        return value
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
    }
}

function writeUserList(value?: string | string[] | null) {
    if (Array.isArray(value)) return JSON.stringify(value)
    if (!value) return null
    const text = value.trim()
    if (!text) return null
    try {
        const data = JSON.parse(text)
        return Array.isArray(data) ? JSON.stringify(data) : text
    } catch {
        return JSON.stringify(
            text
                .split(',')
                .map((item) => item.trim())
                .filter((item) => item.length > 0)
        )
    }
}

async function clearRuntime(
    app: {
        chatluna?: {
            conversationRuntime?: {
                clearConversationInterface: (
                    conversation: ConversationRecord
                ) => Promise<boolean>
            }
        }
    },
    conv: ConversationRecord
) {
    try {
        await app.chatluna?.conversationRuntime?.clearConversationInterface(conv)
    } catch {}
}

// Audits whose action prefix actually mutates the permission snapshot. Other
// audits (provider refresh, conversation patch, etc.) leave the snapshot
// untouched, so we let the 8s TTL handle them instead of thrashing the cache.
const PERMISSION_AUDIT_PREFIXES = [
    'koishi-user.',
    'koishi-channel.',
    'koishi-identity.',
    'koishi-permission.',
    'koishi-maintenance.',
    'acl.',
    'rule.',
    'conversation.remove',
    'conversation.assign',
    'binding.'
]

function affectsPermissionCache(action: string) {
    return PERMISSION_AUDIT_PREFIXES.some((prefix) => action.startsWith(prefix))
}

function pushAudit(action: string, target: string, ids: string[], detail = {}) {
    if (affectsPermissionCache(action)) invalidatePermissionCache()
    const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        action,
        target,
        ids,
        count: ids.length,
        detail,
        createdAt: new Date().toISOString()
    }
    audits.unshift(entry)
    audits.splice(80)
    if (rootCtx) {
        void rootCtx.database
            .upsert('chatluna_data_audit', [
                {
                    id: entry.id,
                    action,
                    target,
                    ids: JSON.stringify(ids),
                    count: ids.length,
                    detail: JSON.stringify(detail),
                    createdAt: new Date(entry.createdAt)
                }
            ])
            .catch(() => {})
    }
}

function countBy(values: string[]) {
    const result: Record<string, number> = {}
    for (const value of values) {
        result[value || ''] = (result[value || ''] ?? 0) + 1
    }
    return result
}

async function readMessageText(row: Partial<MessageRecord> & MessageListRow) {
    const raw = row.content
        ? await gzipDecode(row.content)
        : row.text == null
          ? ''
          : String(row.text)
    try {
        const json = JSON.parse(raw)
        if (typeof json === 'string') return json
        if (Array.isArray(json)) {
            return json
                .map((part) => {
                    if (part.type === 'text') return part.text
                    if (part.type === 'image_url') return '[image]'
                    if (part.type === 'file_url') return '[file]'
                    if (part.type === 'audio_url') return '[audio]'
                    if (part.type === 'video_url') return '[video]'
                    return `[${part.type}]`
                })
                .join('')
        }
        return JSON.stringify(json)
    } catch {
        return raw
    }
}

// ─── Integrity scanner ───────────────────────────────────────────────────
//
// Operators upgrading ChatLuna keep hitting three runtime errors that all
// trace back to dirty data in the database, not bugs in the runtime:
//
//   • 307 (no available config) — handled by the existing model-health view
//   • 103 (toolCalls.map is not a function) — chatluna_message.tool_calls
//     was written as something other than a JSON array (often "" or {})
//   • 306 (Unexpected end of JSON input) — minato sees an empty string in a
//     column it expects to JSON.parse, e.g. additional_kwargs / legacyMeta
//
// The scanner walks every table this plugin owns and reports rows whose
// columns would trip those parsers. Repairs are issued through a separate
// preview-and-apply flow gated by `readonly`.

type IntegrityKind =
    | 'invalid-json'
    | 'invalid-tool-calls'
    | 'invalid-binding-key'
    | 'dangling-conversation-ref'
    | 'dangling-latest-message'
    | 'invalid-acl-principal'
    | 'invalid-acl-permission'
    | 'invalid-archive-path'
    | 'invalid-audit-payload'
    | 'malformed-message-content'
    | 'driver-load-error'

interface IntegrityIssue {
    id: string
    table: string
    recordId: string
    field: string
    kind: IntegrityKind
    severity: 'danger' | 'warning' | 'info'
    snippet: string
    suggestedFix: 'null-field' | 'remove-row' | 'manual'
    // Operator-friendly metadata so the dashboard can guide a fix without
    // requiring the operator to know what each kind means.
    reason: string
    recommendation: string
    errorCode?: string
    canAutoFix: boolean
}

// Centralised diagnosis: maps a raw IntegrityKind to a human reason +
// recommended action so the dashboard never has to translate codes itself.
function describeIssueKind(
    kind: IntegrityKind,
    table: string,
    field: string
): {
    reason: string
    recommendation: string
    errorCode?: string
} {
    switch (kind) {
        case 'invalid-tool-calls':
            return {
                errorCode: 'CHATLUNA-103',
                reason: `${table}.${field} 不是合法 JSON 数组，运行时会抛出 toolCalls.map is not a function。`,
                recommendation:
                    '建议「安全置空」：写入 []，ChatLuna 在下一次写入时会重新生成 tool_calls，不影响对话主体。'
            }
        case 'invalid-json':
            return {
                errorCode: 'CHATLUNA-DATA-JSON',
                reason: `${table}.${field} 不是合法 JSON，反序列化时会失败。`,
                recommendation:
                    '建议「安全置空」：写入 {} 或 []，该字段为可选元数据，后续可由运行时重建。'
            }
        case 'driver-load-error':
            return {
                errorCode: 'MINATO-306',
                reason: `${table}.${field} 触发 minato JSON.parse(<空字符串>)，整张表加载会被中断。`,
                recommendation:
                    '建议「安全置空」（推荐）或「删除行」：先把坏 JSON 改成 {} / [] / 空字符串，让控制台与 ChatLuna 恢复读取。'
            }
        case 'malformed-message-content':
            return {
                errorCode: 'CHATLUNA-MSG-CONTENT',
                reason: `${table}.${field} gzip 解压后非合法 JSON，会让 ChatLuna 跳过这条消息。`,
                recommendation:
                    '建议「删除行」：消息体已损坏不可修复，删掉这条消息记录即可让对话继续可读。'
            }
        case 'invalid-binding-key':
            return {
                errorCode: 'CHATLUNA-BINDING-KEY',
                reason: `${table}.${field} 是旧版 legacy:legacy 占位绑定键。`,
                recommendation:
                    '建议手动处理：可在「绑定」面板重新分配会话归属，或保留作为历史数据。'
            }
        case 'dangling-latest-message':
            return {
                errorCode: 'CHATLUNA-CONV-LATEST',
                reason: `${table}.${field} 指向不存在的消息，会话尾部追溯失败。`,
                recommendation:
                    '建议「安全置空」：清空 latestMessageId，ChatLuna 下次发消息时会刷新。'
            }
        case 'dangling-conversation-ref':
            return {
                errorCode: 'CHATLUNA-CONV-REF',
                reason: `${table}.${field} 指向已删除的会话，会触发 "未找到会话" 报错。`,
                recommendation:
                    '建议「安全置空」：清空该绑定后用户下次对话会重新选择会话。'
            }
        case 'invalid-acl-principal':
            return {
                errorCode: 'CHATLUNA-ACL-PRINCIPAL',
                reason: `${table}.${field} 不是 user/role/channel/platform 之一，ACL 解析会失败。`,
                recommendation:
                    '建议「删除行」：来源不明的 ACL 行没有意义，移除后默认 ACL 生效。'
            }
        case 'invalid-acl-permission':
            return {
                errorCode: 'CHATLUNA-ACL-PERM',
                reason: `${table}.${field} 不是 view/edit/owner/admin/reader 之一。`,
                recommendation:
                    '建议手动处理：可在 ACL 面板重新指定权限级别。'
            }
        case 'invalid-archive-path':
            return {
                errorCode: 'CHATLUNA-ARCHIVE-PATH',
                reason: `${table}.${field} 缺失或非字符串，归档无法读取。`,
                recommendation:
                    '建议「删除行」：归档元数据已坏，磁盘上的文件可手动归档目录里恢复。'
            }
        case 'invalid-audit-payload':
            return {
                errorCode: 'CHATLUNA-DATA-AUDIT',
                reason: `${table}.${field} JSON 结构损坏，审计记录无法展开。`,
                recommendation:
                    '建议「安全置空」：审计仅留作历史记录，置空 detail/ids 不影响业务。'
            }
        default:
            return {
                reason: `${table}.${field} 出现完整性问题。`,
                recommendation: '建议先查看「详情」再决定如何处理。'
            }
    }
}

function makeIssue(args: {
    table: string
    recordId: string
    field: string
    kind: IntegrityKind
    severity: 'danger' | 'warning' | 'info'
    snippet: string
    suggestedFix: 'null-field' | 'remove-row' | 'manual'
}): IntegrityIssue {
    const desc = describeIssueKind(args.kind, args.table, args.field)
    return {
        id: makeIssueId(args.table, args.recordId, args.field),
        ...args,
        reason: desc.reason,
        recommendation: desc.recommendation,
        errorCode: desc.errorCode,
        canAutoFix: args.suggestedFix !== 'manual'
    }
}

async function recordOpsLog(
    ctx: Context,
    cfg: Config,
    record: Logger.Record
) {
    if (record.type !== 'error' && record.type !== 'warn') return
    const text = `[${record.name}] ${record.content}`
    const lower = text.toLowerCase()
    if (
        !record.name.toLowerCase().includes('chatluna') &&
        !lower.includes('chatluna') &&
        !lower.includes('@minatojs/driver-sqlite') &&
        !lower.includes('sqlitebuilder.load') &&
        !lower.includes('toolcalls.map') &&
        !lower.includes('tool_calls') &&
        !lower.includes('no available config')
    ) {
        return
    }
    const analysis = await analyzeOpsError(ctx, cfg, { text })
    await pushOpsError(
        ctx,
        {
            source: 'logger',
            level: record.type,
            logger: record.name,
            message: text
        },
        analysis
    )
}

async function pushOpsError(
    ctx: Context,
    input: {
        source: string
        level: string
        logger: string
        message: string
    },
    analysis: unknown
) {
    const recent = opsErrors.find(
        (row) =>
            row.message === input.message &&
            Date.now() - new Date(row.createdAt).getTime() < 60000
    )
    if (recent) return recent
    const result = analysis as {
        kind?: string
        title?: string
        severity?: string
    }
    const row: OpsErrorEntry = {
        id: randomUUID(),
        source: input.source,
        level: input.level,
        logger: input.logger,
        message: input.message,
        createdAt: new Date().toISOString(),
        analysis
    }
    opsErrors.unshift(row)
    opsErrors.splice(80)
    await ctx.database.upsert('chatluna_data_ops_error', [
        {
            id: row.id,
            source: row.source,
            level: row.level,
            logger: row.logger,
            message: row.message,
            kind: result.kind ?? 'unknown',
            title: result.title ?? '',
            severity: result.severity ?? 'info',
            analysis: JSON.stringify(analysis),
            createdAt: new Date(row.createdAt)
        }
    ])
    return row
}

function inspectModelPayload(text: string) {
    if (
        !text.startsWith('{') ||
        !text.includes('"model"') ||
        !text.includes('"messages"')
    ) {
        return null
    }
    try {
        const data = JSON.parse(text) as {
            model?: string
            messages?: Array<{
                role?: string
                content?:
                    | string
                    | Array<{
                          type?: string
                          text?: string
                          image_url?: { url?: string }
                      }>
            }>
            tools?: unknown[]
        }
        if (!data.model || !Array.isArray(data.messages)) return null
        let textChars = 0
        let imageChars = 0
        let images = 0
        let maxImage = 0
        for (const msg of data.messages) {
            if (typeof msg.content === 'string') {
                textChars += msg.content.length
                continue
            }
            if (!Array.isArray(msg.content)) continue
            for (const part of msg.content) {
                if (part.type === 'text') {
                    textChars += part.text?.length ?? 0
                }
                if (part.type === 'image_url') {
                    const url = part.image_url?.url ?? ''
                    if (url.startsWith('data:image/')) {
                        images += 1
                        imageChars += url.length
                        maxImage = Math.max(maxImage, url.length)
                    }
                }
            }
        }
        const tools = Array.isArray(data.tools) ? data.tools : []
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
        }
    } catch {
        return null
    }
}

async function analyzeOpsError(
    ctx: Context,
    cfg: Config,
    input: OpsErrorInput
) {
    const text = (input.text ?? '').trim()
    const lower = text.toLowerCase()
    const loads = Array.from(loadErrors.values())
    const payload = inspectModelPayload(text)
    if (payload) {
        const heavy =
            payload.bytes > 1500000 ||
            payload.imageChars > 1000000 ||
            payload.tools > 40 ||
            payload.textChars > 50000
        return {
            analyzedAt: new Date().toISOString(),
            severity: heavy ? 'warning' : 'info',
            kind: 'model-request-payload',
            title: heavy
                ? '模型请求负载过大，容易触发超时或上游拒绝'
                : '这是模型请求转储，不是数据库错误',
            confidence: 'high',
            summary:
                '日志内容是一次发往模型的完整请求 JSON。它包含 prompt、用户上下文、工具定义和内联图片，不属于 ChatLuna 数据库损坏。',
            impact:
                '请求越大，上游越容易出现慢响应、超时、请求体超限、429/限流或多模态处理失败；同时完整 prompt 和图片会暴露在日志文件里。',
            evidence: [
                {
                    label: '模型',
                    value: payload.model
                },
                {
                    label: '请求大小',
                    value: `${payload.bytes} bytes`
                },
                {
                    label: '消息 / 工具',
                    value: `${payload.messages} messages · ${payload.tools} tools · ${payload.toolBytes} tool bytes`
                },
                {
                    label: '内联图片',
                    value: `${payload.images} images · ${payload.imageChars} chars · max ${payload.maxImage}`
                },
                {
                    label: '文本上下文',
                    value: `${payload.textChars} chars`
                }
            ],
            actions: [
                {
                    title: '收敛图片载荷',
                    level: 'recommended',
                    description:
                        '这类请求把图片直接转成 base64 放进模型请求，单张图过大时最容易拖慢或打爆上游。',
                    steps: [
                        '减少同一轮发送到模型的图片数量。',
                        '压缩图片尺寸和质量后再进入 ChatLuna。',
                        '优先让图片走可访问 URL 或临时文件，而不是长期保存完整 data URL 日志。'
                    ],
                    target: 'manual-request-trim'
                },
                {
                    title: '减少本轮工具定义',
                    level: 'normal',
                    description:
                        '工具 schema 也会占用请求体。工具很多时，即使用户只是发图，也会把大量无关工具说明一起发给模型。',
                    steps: [
                        '按会话场景关闭不需要的工具或技能。',
                        '把高风险或低频工具从默认工具集中移出。',
                        '只在需要时启用文件、终端、平台管理类工具。'
                    ],
                    target: 'config'
                },
                {
                    title: '裁剪上下文与环境消息',
                    level: 'normal',
                    description:
                        '长角色设定、群信息、历史消息和工具说明叠加后，会让普通图片请求变成大请求。',
                    steps: [
                        '降低历史消息数量或启用更积极的摘要。',
                        '精简群成员资料和环境消息。',
                        '检查 preset 是否把固定资料重复注入。'
                    ],
                    target: 'config'
                },
                {
                    title: '不要按数据库修复处理',
                    level: 'manual',
                    description:
                        '这份日志没有指向 chatluna_message、archive、ACL 等源头行，完整性扫描不会修复请求过大的根因。',
                    steps: [
                        '不要删除会话或消息来处理这类问题。',
                        '如果真实报错另有 400/413/429/timeout，请把那段响应堆栈一起放进研判。'
                    ],
                    target: 'paste-stack'
                }
            ],
            related: { loadErrors: loads, issues: [], scanSummary: null }
        }
    }
    const minatoJson =
        lower.includes('chatlunaerror:306') ||
        lower.includes('chatlunaerror 306') ||
        lower.includes('error:306') ||
        lower.includes('unexpected end of json input') ||
        lower.includes('sqlitebuilder.load') ||
        lower.includes('@minatojs/driver-sqlite') ||
        (!text && loads.length > 0)
    const toolCalls =
        lower.includes('toolcalls.map') ||
        lower.includes('tool_calls') ||
        lower.includes('tool calls')
    const noConfig =
        lower.includes('no available config') ||
        lower.includes('available config') ||
        lower.includes('307')
    const auth =
        lower.includes('unauthorized') ||
        lower.includes('invalid api key') ||
        lower.includes('401') ||
        lower.includes('403')
    const timeout =
        lower.includes('timeout') ||
        lower.includes('etimedout') ||
        lower.includes('econnreset') ||
        lower.includes('fetch failed')

    if (minatoJson || toolCalls) {
        const scan = await scanIntegrity(ctx, cfg, {
            limit: Math.min(cfg.maxPreviewRows ?? 200, 120)
        })
        const rows = scan.issues
            .filter((row) =>
                minatoJson
                    ? row.kind === 'driver-load-error' ||
                      row.kind === 'invalid-json' ||
                      row.kind === 'invalid-audit-payload'
                    : row.kind === 'invalid-tool-calls'
            )
            .slice(0, 20)
        return {
            analyzedAt: new Date().toISOString(),
            severity: 'danger',
            kind: minatoJson
                ? 'database-json-load-error'
                : 'message-tool-calls-error',
            title: minatoJson
                ? '数据库 JSON 字段损坏导致 Minato 读取失败'
                : '消息 tool_calls 字段损坏导致 ChatLuna 运行时失败',
            confidence: text || loads.length ? 'high' : 'medium',
            summary: minatoJson
                ? 'SQLite 驱动正在把某个 JSON 字段反序列化，但该字段是空字符串或截断 JSON，所以整张表读取被中断。'
                : 'ChatLuna 期望 tool_calls 是 JSON 数组，但数据库里存在空字符串、对象或坏 JSON。',
            impact: minatoJson
                ? '控制台、会话列表或 ChatLuna 读取相关表时会报 306/Unexpected end of JSON input。'
                : '包含坏消息的会话在回复或展示工具调用时可能中断。',
            evidence: [
                ...loads.map((row) => ({
                    label: `捕获表 ${row.table}`,
                    value: row.message
                })),
                ...rows.slice(0, 6).map((row) => ({
                    label: `${row.table}.${row.field}`,
                    value: `${row.recordId} · ${row.kind} · ${row.snippet}`
                }))
            ],
            actions: [
                {
                    title: '方式一：保守修复脏字段（推荐）',
                    level: 'recommended',
                    description:
                        '进入完整性扫描，先预览问题行，再对可自动修复的 JSON 元数据字段执行「安全置空」。ChatLuna 会在后续写入中重建可选字段。',
                    steps: [
                        '点击下方“打开完整性扫描”。',
                        '勾选 driver-load-error、invalid-json 或 invalid-tool-calls 行。',
                        '优先执行“安全置空”，修复后刷新 ChatLuna 或重启 Koishi。'
                    ],
                    target: 'integrity-null-field'
                },
                {
                    title: '方式二：隔离删除坏记录',
                    level: 'danger',
                    description:
                        '如果坏的是消息体、归档元数据或无意义的悬空记录，先备份数据库，再删除对应行，换取运行时恢复。',
                    steps: [
                        '在完整性扫描里查看 recordId 和字段样例。',
                        '仅选择 malformed-message-content、无效 ACL、坏归档等不可恢复记录。',
                        '执行“删除行”，随后检查会话链是否仍然可用。'
                    ],
                    target: 'integrity-remove-row'
                },
                {
                    title: '方式三：备份后手工恢复/回滚',
                    level: 'manual',
                    description:
                        '如果坏行承载重要历史记录，先复制 SQLite 文件，再用数据库工具手工把空字符串改成 NULL 或合法 JSON，必要时回滚到最近备份。',
                    steps: [
                        '停止 Koishi，复制当前 sqlite 数据库文件。',
                        '用 DB Browser for SQLite 或 sqlite3 定位表和主键。',
                        '把坏 JSON 字段改成 NULL、{} 或 []，改哪种以完整性扫描建议为准。'
                    ],
                    target: 'manual-sql'
                }
            ],
            related: {
                loadErrors: loads,
                issues: rows,
                scanSummary: scan.summary
            }
        }
    }

    if (noConfig) {
        return {
            analyzedAt: new Date().toISOString(),
            severity: 'warning',
            kind: 'provider-config-unavailable',
            title: 'Provider 没有可用配置',
            confidence: text ? 'high' : 'medium',
            summary:
                'ChatLuna 找到了 provider 或模型引用，但运行时没有可用 adapter 配置，常见于 key 被禁用、配置未加载或会话引用旧模型。',
            impact: '新消息无法发给模型，已有会话可能只能读取不能继续回复。',
            evidence: [],
            actions: [
                {
                    title: '检查模型与 Provider 健康中心',
                    level: 'recommended',
                    description:
                        '查看 provider 状态、可用配置率和缺失模型引用，确认是 adapter 未加载还是数据库引用失效。',
                    steps: [
                        '打开“模型与 Provider”。',
                        '查看无可用配置和缺失模型分组。',
                        '如模型已更名，使用模型引用迁移先预览再执行。'
                    ],
                    target: 'model-health'
                },
                {
                    title: '刷新 provider',
                    level: 'normal',
                    description:
                        'adapter 配置刚改完时，刷新 provider 可重新读取运行时模型和配置池。',
                    steps: ['在 provider 详情点击刷新。', '再次检查健康分和模型列表。'],
                    target: 'provider-refresh'
                },
                {
                    title: '回到 ChatLuna 配置核对默认模型',
                    level: 'manual',
                    description:
                        '如果默认模型引用不存在，修改 ChatLuna 配置或 data 插件的配置页。',
                    steps: ['打开配置页。', '核对 defaultModel、defaultEmbeddings、chatMode。'],
                    target: 'config'
                }
            ],
            related: { loadErrors: loads, issues: [], scanSummary: null }
        }
    }

    if (auth || timeout) {
        return {
            analyzedAt: new Date().toISOString(),
            severity: auth ? 'danger' : 'warning',
            kind: auth ? 'provider-auth-error' : 'provider-network-error',
            title: auth ? '模型服务鉴权失败' : '模型服务网络超时或连接失败',
            confidence: text ? 'high' : 'medium',
            summary: auth
                ? '上游模型服务拒绝了请求，通常是 API Key、Base URL、额度或权限范围错误。'
                : '请求没有稳定到达上游服务，可能是网络、代理、超时或服务端限流。',
            impact: 'ChatLuna 会话本身通常没有损坏，但继续回复会失败。',
            evidence: [],
            actions: [
                {
                    title: '核对 provider 配置',
                    level: 'recommended',
                    description:
                        '检查 adapter 的 key、baseURL、模型名和可用配置状态。',
                    steps: ['打开模型与 Provider。', '确认 provider 已加载且配置可用率不为 0。'],
                    target: 'model-health'
                },
                {
                    title: '做最小化请求验证',
                    level: 'normal',
                    description:
                        '用同一个 key 和 baseURL 在 provider 官方控制台或 curl 中验证。',
                    steps: ['测试一个最小聊天请求。', '对比 ChatLuna 中的模型名和 endpoint。'],
                    target: 'manual-provider-test'
                },
                {
                    title: '临时切换会话模型',
                    level: 'manual',
                    description:
                        '如果上游短期不可用，可把活跃会话迁移到备用模型。',
                    steps: ['在模型健康页选择缺失或异常模型。', '预览迁移到可用模型后再执行。'],
                    target: 'model-migration'
                }
            ],
            related: { loadErrors: loads, issues: [], scanSummary: null }
        }
    }

    return {
        analyzedAt: new Date().toISOString(),
        severity: 'info',
        kind: 'unknown',
        title: '未匹配到已知 ChatLuna 运维模式',
        confidence: text ? 'low' : 'none',
        summary:
            '这段报错没有命中当前规则。建议先检查模型健康和数据完整性，再根据堆栈里的插件名定位。',
        impact: '需要结合发生时的操作、会话 ID、模型名和 provider 日志判断。',
        evidence: loads.map((row) => ({
            label: `捕获表 ${row.table}`,
            value: row.message
        })),
        actions: [
            {
                title: '先做健康检查',
                level: 'recommended',
                description:
                    '确认 provider、模型引用、preset/chatMode 和归档状态是否异常。',
                steps: ['打开系统健康。', '打开模型与 Provider 健康中心。'],
                target: 'health'
            },
            {
                title: '扫描数据库完整性',
                level: 'normal',
                description:
                    '排除 JSON 字段、消息链、悬空引用这类常见数据库问题。',
                steps: ['打开完整性扫描。', '需要时开启深度扫描。'],
                target: 'integrity'
            },
            {
                title: '补充上下文后再分析',
                level: 'manual',
                description:
                    '粘贴完整堆栈、触发指令、会话 ID、模型名和 provider 名，研判会更准确。',
                steps: ['复制 Koishi 控制台完整错误。', '再次点击分析。'],
                target: 'paste-stack'
            }
        ],
        related: { loadErrors: loads, issues: [], scanSummary: null }
    }
}

interface IntegrityScanInput {
    tables?: string[]
    deep?: boolean
    limit?: number
}

interface IntegrityRepairInput {
    issueIds: string[]
    action: 'null-field' | 'remove-row' | 'set-value'
    value?: string
    confirm?: boolean
}

interface IntegrityFieldInput {
    table: string
    recordId: string
    field: string
}

interface OpsErrorInput {
    text?: string
}

const ACL_PRINCIPALS = new Set(['user', 'role', 'channel', 'platform'])
const ACL_PERMISSIONS = new Set(['view', 'edit', 'owner', 'admin', 'reader'])

function isJsonArray(value: unknown): boolean {
    if (typeof value !== 'string') return Array.isArray(value)
    if (value === '') return false
    try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed)
    } catch {
        return false
    }
}

function isParseable(value: unknown): boolean {
    if (value == null) return true
    if (typeof value !== 'string') return true
    if (value === '') return false
    try {
        JSON.parse(value)
        return true
    } catch {
        return false
    }
}

function snippet(value: unknown, max = 80): string {
    if (value == null) return '<null>'
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return text.length > max ? text.slice(0, max) + '…' : text
}

function makeIssueId(table: string, recordId: string, field: string) {
    return `${table}:${recordId}:${field}`
}

function sqliteDriver(ctx: Context) {
    const driver = (ctx.model as unknown as { drivers?: unknown[] }).drivers?.find(
        (item) =>
            typeof (item as { _all?: unknown })._all === 'function' &&
            typeof (item as { _run?: unknown })._run === 'function'
    ) as
        | {
              _all: (sql: string, params?: unknown[]) => Record<string, unknown>[]
              _get: (sql: string, params?: unknown[]) => Record<string, unknown>
              _run: (sql: string, params?: unknown[]) => void
          }
        | undefined
    if (!driver) throw new Error('sqlite raw driver not found')
    return driver
}

function sqliteHasTable(driver: ReturnType<typeof sqliteDriver>, table: string) {
    return !!driver._get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        [table]
    )
}

function scan306Sources(ctx: Context, limit: number) {
    const driver = sqliteDriver(ctx)
    const issues: IntegrityIssue[] = []
    if (sqliteHasTable(driver, 'chatluna_message')) {
        const rows = driver._all(
            'SELECT id, conversationId, role, tool_calls FROM chatluna_message WHERE tool_calls IS NOT NULL LIMIT ?',
            [Math.max(limit, 5000)]
        )
        for (const row of rows) {
            if (issues.length >= limit) break
            const value = row.tool_calls
            if (value === '') {
                issues.push(makeIssue({
                    table: 'chatluna_message',
                    recordId: String(row.id),
                    field: 'tool_calls',
                    kind: 'invalid-tool-calls',
                    severity: 'danger',
                    snippet: snippet(value),
                    suggestedFix: 'null-field'
                }))
                continue
            }
            try {
                if (!Array.isArray(JSON.parse(String(value)))) {
                    throw new Error('tool_calls is not array')
                }
            } catch {
                issues.push(makeIssue({
                    table: 'chatluna_message',
                    recordId: String(row.id),
                    field: 'tool_calls',
                    kind: 'invalid-tool-calls',
                    severity: 'danger',
                    snippet: snippet(value),
                    suggestedFix: 'null-field'
                }))
            }
        }
    }
    if (issues.length < limit && sqliteHasTable(driver, 'chatluna_docstore')) {
        const rows = driver._all(
            'SELECT key, id, metadata FROM chatluna_docstore WHERE metadata IS NOT NULL LIMIT ?',
            [Math.max(limit - issues.length, 5000)]
        )
        for (const row of rows) {
            if (issues.length >= limit) break
            try {
                JSON.parse(String(row.metadata))
            } catch {
                issues.push(makeIssue({
                    table: 'chatluna_docstore',
                    recordId: JSON.stringify([row.key, row.id]),
                    field: 'metadata',
                    kind: 'invalid-json',
                    severity: 'danger',
                    snippet: snippet(row.metadata),
                    suggestedFix: 'null-field'
                }))
            }
        }
    }
    return issues
}

async function probeLoadErrorsRaw(
    ctx: Context,
    want: (table: string) => boolean,
    limit: number
) {
    return Array.from(loadErrors.values())
        .filter((row) => row.table.startsWith('chatluna_'))
        .filter((row) => want(row.table))
        .slice(0, Math.max(0, limit))
        .map((row) =>
            makeIssue({
                table: row.table,
                recordId: 'driver-load-error',
                field: '<unknown>',
                kind: 'driver-load-error',
                severity: 'danger',
                snippet: snippet(row.message),
                suggestedFix: 'manual'
            })
        )
}

async function scanIntegrity(
    ctx: Context,
    cfg: Config,
    input: IntegrityScanInput
) {
    const limit = Math.max(50, input.limit ?? cfg.maxPreviewRows ?? 200)
    const wanted = input.tables && input.tables.length
        ? new Set(input.tables)
        : null
    const want = (table: string) => !wanted || wanted.has(table)
    const issues: IntegrityIssue[] = []
    const push = (issue: IntegrityIssue) => {
        if (issues.length < limit) issues.push(issue)
    }

    try {
        for (const issue of scan306Sources(ctx, limit - issues.length)) {
            push(issue)
        }
    } catch (err) {
        recordLoadError('sqlite-raw-306-scan', err)
    }

    // chatluna_conversation: parseable JSON columns + bindingKey shape +
    // latestMessageId reachability.
    if (want('chatluna_conversation')) {
        const convs = await getRows<ConversationRecord>(
            ctx,
            'chatluna_conversation'
        )
        const convIds = new Set(convs.map((row) => row.id))
        for (const row of convs) {
            if (row.additional_kwargs && !isParseable(row.additional_kwargs)) {
                push(makeIssue({
                    table: 'chatluna_conversation',
                    recordId: row.id,
                    field: 'additional_kwargs',
                    kind: 'invalid-json',
                    severity: 'warning',
                    snippet: snippet(row.additional_kwargs),
                    suggestedFix: 'null-field'
                }))
            }
            if (row.legacyMeta && !isParseable(row.legacyMeta)) {
                push(makeIssue({
                    table: 'chatluna_conversation',
                    recordId: row.id,
                    field: 'legacyMeta',
                    kind: 'invalid-json',
                    severity: 'info',
                    snippet: snippet(row.legacyMeta),
                    suggestedFix: 'null-field'
                }))
            }
            const route = parseBindingKey(row.bindingKey ?? '')
            if (
                row.bindingKey &&
                route.routeMode === 'legacy' &&
                route.scope === 'legacy'
            ) {
                push(makeIssue({
                    table: 'chatluna_conversation',
                    recordId: row.id,
                    field: 'bindingKey',
                    kind: 'invalid-binding-key',
                    severity: 'info',
                    snippet: snippet(row.bindingKey),
                    suggestedFix: 'manual'
                }))
            }
            if (
                row.latestMessageId &&
                !(await messageExists(ctx, row.latestMessageId))
            ) {
                push(makeIssue({
                    table: 'chatluna_conversation',
                    recordId: row.id,
                    field: 'latestMessageId',
                    kind: 'dangling-latest-message',
                    severity: 'warning',
                    snippet: snippet(row.latestMessageId),
                    suggestedFix: 'null-field'
                }))
            }
        }
        // bindings -> conversations
        if (want('chatluna_binding')) {
            const bindings = await getRows<BindingRecord>(
                ctx,
                'chatluna_binding'
            )
            for (const row of bindings) {
                if (
                    row.activeConversationId &&
                    !convIds.has(row.activeConversationId)
                ) {
                    push(makeIssue({
                        table: 'chatluna_binding',
                        recordId: row.bindingKey,
                        field: 'activeConversationId',
                        kind: 'dangling-conversation-ref',
                        severity: 'warning',
                        snippet: snippet(row.activeConversationId),
                        suggestedFix: 'null-field'
                    }))
                }
                if (
                    row.lastConversationId &&
                    !convIds.has(row.lastConversationId)
                ) {
                    push(makeIssue({
                        table: 'chatluna_binding',
                        recordId: row.bindingKey,
                        field: 'lastConversationId',
                        kind: 'dangling-conversation-ref',
                        severity: 'info',
                        snippet: snippet(row.lastConversationId),
                        suggestedFix: 'null-field'
                    }))
                }
            }
        }
    }

    return finalizeScanIntegrity(ctx, cfg, input, issues, want, limit)
}

async function messageExists(ctx: Context, id: string) {
    const rows = await getMessageChainRows(ctx, { id })
    return rows.length > 0
}

async function finalizeScanIntegrity(
    ctx: Context,
    cfg: Config,
    input: IntegrityScanInput,
    issues: IntegrityIssue[],
    want: (table: string) => boolean,
    limit: number
) {
    const push = (issue: IntegrityIssue) => {
        if (issues.length < limit) issues.push(issue)
    }

    // Messages: tool_calls must be a JSON array. text/content must produce a
    // decodable payload. additional_kwargs_binary / response_metadata_binary
    // checked in deep mode.
    if (want('chatluna_message')) {
        const msgs = await getMessageRows(ctx)
        for (const row of msgs) {
            if (row.tool_calls != null && !isJsonArray(row.tool_calls)) {
                push(makeIssue({
                    table: 'chatluna_message',
                    recordId: row.id,
                    field: 'tool_calls',
                    kind: 'invalid-tool-calls',
                    severity: 'danger',
                    snippet: snippet(row.tool_calls),
                    suggestedFix: 'null-field'
                }))
            }
        }
        if (input.deep) {
            // Deep mode: refetch with binary columns so we can validate them.
            // Bounded by `limit` to avoid OOM.
            const ids = msgs.slice(0, limit).map((row) => row.id)
            if (ids.length > 0) {
                const fullRows = (await ctx.database.get(
                    'chatluna_message' as never,
                    { id: { $in: ids } } as never
                )) as MessageRecord[]
                for (const row of fullRows) {
                    if (row.content) {
                        try {
                            const decoded = await gzipDecode(row.content)
                            if (decoded === '') throw new Error('empty')
                            JSON.parse(decoded)
                        } catch {
                            push(makeIssue({
                                table: 'chatluna_message',
                                recordId: row.id,
                                field: 'content',
                                kind: 'malformed-message-content',
                                severity: 'danger',
                                snippet: '<gzip blob>',
                                suggestedFix: 'remove-row'
                            }))
                        }
                    }
                }
            }
        }
    }

    if (want('chatluna_acl')) {
        const acls = await getRows<AclRecord>(ctx, 'chatluna_acl')
        for (const row of acls) {
            const recordId = `${row.conversationId}:${row.principalType}:${row.principalId}`
            if (!ACL_PRINCIPALS.has(row.principalType)) {
                push(makeIssue({
                    table: 'chatluna_acl',
                    recordId,
                    field: 'principalType',
                    kind: 'invalid-acl-principal',
                    severity: 'warning',
                    snippet: snippet(row.principalType),
                    suggestedFix: 'remove-row'
                }))
            }
            if (row.permission && !ACL_PERMISSIONS.has(row.permission)) {
                push(makeIssue({
                    table: 'chatluna_acl',
                    recordId,
                    field: 'permission',
                    kind: 'invalid-acl-permission',
                    severity: 'info',
                    snippet: snippet(row.permission),
                    suggestedFix: 'manual'
                }))
            }
        }
    }

    if (want('chatluna_constraint')) {
        const rules = await getRows<ConstraintRecord>(ctx, 'chatluna_constraint')
        for (const row of rules) {
            if (
                row.users != null &&
                typeof row.users === 'string' &&
                row.users !== '' &&
                !isJsonArray(row.users)
            ) {
                push(makeIssue({
                    table: 'chatluna_constraint',
                    recordId: String(row.id),
                    field: 'users',
                    kind: 'invalid-json',
                    severity: 'info',
                    snippet: snippet(row.users),
                    suggestedFix: 'null-field'
                }))
            }
            if (
                row.excludeUsers != null &&
                typeof row.excludeUsers === 'string' &&
                row.excludeUsers !== '' &&
                !isJsonArray(row.excludeUsers)
            ) {
                push(makeIssue({
                    table: 'chatluna_constraint',
                    recordId: String(row.id),
                    field: 'excludeUsers',
                    kind: 'invalid-json',
                    severity: 'info',
                    snippet: snippet(row.excludeUsers),
                    suggestedFix: 'null-field'
                }))
            }
        }
    }

    return finalizeScanIntegrityTail(ctx, cfg, input, issues, want, limit)
}

async function finalizeScanIntegrityTail(
    ctx: Context,
    cfg: Config,
    input: IntegrityScanInput,
    issues: IntegrityIssue[],
    want: (table: string) => boolean,
    limit: number
) {
    const push = (issue: IntegrityIssue) => {
        if (issues.length < limit) issues.push(issue)
    }

    if (want('chatluna_archive')) {
        const arcs = await getRows<ArchiveRecord>(ctx, 'chatluna_archive')
        for (const row of arcs) {
            if (!row.path || typeof row.path !== 'string') {
                push(makeIssue({
                    table: 'chatluna_archive',
                    recordId: row.id,
                    field: 'path',
                    kind: 'invalid-archive-path',
                    severity: 'warning',
                    snippet: snippet(row.path),
                    suggestedFix: 'remove-row'
                }))
            }
        }
    }

    if (want('chatluna_data_audit')) {
        const audits = await getRows<AuditRecord>(
            ctx,
            'chatluna_data_audit'
        )
        for (const row of audits) {
            if (row.detail && !isParseable(row.detail)) {
                push(makeIssue({
                    table: 'chatluna_data_audit',
                    recordId: row.id,
                    field: 'detail',
                    kind: 'invalid-audit-payload',
                    severity: 'info',
                    snippet: snippet(row.detail),
                    suggestedFix: 'null-field'
                }))
            }
            if (row.ids && !isParseable(row.ids)) {
                push(makeIssue({
                    table: 'chatluna_data_audit',
                    recordId: row.id,
                    field: 'ids',
                    kind: 'invalid-audit-payload',
                    severity: 'info',
                    snippet: snippet(row.ids),
                    suggestedFix: 'null-field'
                }))
            }
        }
    }

    if (want('chatluna_meta')) {
        const metas = await getRows<MetaRecord>(ctx, 'chatluna_meta')
        for (const row of metas) {
            if (row.value && !isParseable(row.value)) {
                push(makeIssue({
                    table: 'chatluna_meta',
                    recordId: row.key,
                    field: 'value',
                    kind: 'invalid-json',
                    severity: 'info',
                    snippet: snippet(row.value),
                    suggestedFix: 'null-field'
                }))
            }
        }
    }

    // Promote driver load errors into row-level issues by probing the raw
    // driver. This is what makes 306 (Unexpected end of JSON input) actionable
    // — without this we only know the table, not the row.
    const fixedTables = new Set(
        issues
            .filter((row) => row.recordId !== 'driver-load-error')
            .map((row) => row.table)
    )
    const driverIssues = (await probeLoadErrorsRaw(
        ctx,
        want,
        limit - issues.length
    )).filter((row) => !fixedTables.has(row.table))
    for (const issue of driverIssues) {
        push(issue)
    }

    const byTable: Record<string, number> = {}
    const byKind: Record<string, number> = {}
    for (const issue of issues) {
        byTable[issue.table] = (byTable[issue.table] ?? 0) + 1
        byKind[issue.kind] = (byKind[issue.kind] ?? 0) + 1
    }

    return {
        scannedAt: new Date().toISOString(),
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
    }
}

interface AuditRecord {
    id: string
    action: string
    target: string
    ids: string
    count: number
    detail: string
    createdAt: Date
}

function canRepairIssue(
    issue: IntegrityIssue,
    action: IntegrityRepairInput['action']
) {
    if (issue.recordId === 'driver-load-error') return false
    if (issue.field === '<unknown>') return false
    if (action === 'null-field') return issue.suggestedFix === 'null-field'
    return true
}

async function repairIntegrity(
    ctx: Context,
    cfg: Config,
    input: IntegrityRepairInput
) {
    if (!input.confirm) {
        // Preview-only: re-run the scan and return the rows that would be
        // touched. The frontend gets a chance to display the diff before
        // calling again with confirm=true.
        const scan = await scanIntegrity(ctx, cfg, {
            limit: cfg.maxPreviewRows ?? 200
        })
        const ids = new Set(input.issueIds)
        const picked = scan.issues.filter((row) => ids.has(row.id))
        const rows = picked.filter((row) => canRepairIssue(row, input.action))
        const skipped = picked.length - rows.length
        return {
            mode: 'preview' as const,
            action: input.action,
            count: rows.length,
            rows,
            warnings:
                [
                    ...(skipped
                        ? [
                              `${skipped} 条扫描项没有定位到真实字段，已跳过自动修复。`
                          ]
                        : []),
                    ...(input.action === 'remove-row'
                        ? ['整行删除不可恢复，请先备份。']
                        : input.action === 'set-value'
                          ? ['将把选中字段写成你输入的原始文本，请确认字段类型。']
                          : [
                                '对应字段会被写成 {}、[] 或空字符串，运行时会重新生成。'
                            ])
                ]
        }
    }
    const scan = await scanIntegrity(ctx, cfg, {
        limit: cfg.maxPreviewRows ?? 200
    })
    const issuesById = new Map(scan.issues.map((row) => [row.id, row]))
    const applied: IntegrityIssue[] = []
    for (const issueId of input.issueIds) {
        const issue = issuesById.get(issueId)
        if (!issue) continue
        if (!canRepairIssue(issue, input.action)) continue
        if (input.action === 'remove-row') {
            await removeRowForIssue(ctx, issue)
        } else if (input.action === 'set-value') {
            await setFieldForIssue(ctx, issue, input.value ?? '')
        } else {
            await nullFieldForIssue(ctx, issue)
        }
        applied.push(issue)
    }
    pushAudit(
        `integrity.${input.action}`,
        applied.map((row) => row.table).join(','),
        applied.map((row) => row.id),
        { count: applied.length }
    )
    return { mode: 'applied' as const, count: applied.length, rows: applied }
}

async function getIntegrityField(ctx: Context, input: IntegrityFieldInput) {
    if (
        input.recordId === 'driver-load-error' ||
        input.field === '<unknown>'
    ) {
        throw new Error('这个扫描项没有定位到具体行或字段，无法读取原值。')
    }
    const read = async <T>(
        table: string,
        query: Record<string, unknown>
    ): Promise<T> => {
        const rows = (await ctx.database.get(
            table as never,
            query as never
        )) as T[]
        if (!rows[0]) throw new Error(`record not found: ${input.recordId}`)
        return rows[0]
    }
    let row: Record<string, unknown>
    switch (input.table) {
        case 'chatluna_conversation':
            row = await read(input.table, { id: input.recordId })
            break
        case 'chatluna_message':
            row = await read(input.table, { id: input.recordId })
            break
        case 'chatluna_binding':
            row = await read(input.table, { bindingKey: input.recordId })
            break
        case 'chatluna_acl': {
            const [conversationId, principalType, principalId] =
                input.recordId.split(':')
            row = await read(input.table, {
                conversationId,
                principalType,
                principalId
            })
            break
        }
        case 'chatluna_constraint':
            row = await read(input.table, { id: Number(input.recordId) })
            break
        case 'chatluna_archive':
            row = await read(input.table, { id: input.recordId })
            break
        case 'chatluna_meta':
            row = await read(input.table, { key: input.recordId })
            break
        case 'chatluna_data_audit':
            row = await read(input.table, { id: input.recordId })
            break
        case 'chatluna_data_identity': {
            const [platform, id] = input.recordId.split(':')
            row = await read(input.table, { platform, id })
            break
        }
        case 'chatluna_docstore': {
            const [key, id] = JSON.parse(input.recordId)
            row = sqliteDriver(ctx)._get(
                'SELECT metadata FROM chatluna_docstore WHERE key = ? AND id = ?',
                [key, id]
            )
            break
        }
        default:
            throw new Error(`unsupported table: ${input.table}`)
    }
    const value = row[input.field]
    return {
        value:
            value == null
                ? ''
                : typeof value === 'string'
                  ? value
                  : value instanceof Date
                    ? iso(value)
                    : JSON.stringify(value)
    }
}

async function removeRowForIssue(ctx: Context, issue: IntegrityIssue) {
    const recordId = issue.recordId
    switch (issue.table) {
        case 'chatluna_conversation':
            await ctx.database.remove('chatluna_conversation', { id: recordId })
            return
        case 'chatluna_message':
            sqliteDriver(ctx)._run('DELETE FROM chatluna_message WHERE id = ?', [
                recordId
            ])
            return
        case 'chatluna_docstore': {
            const [key, id] = JSON.parse(recordId)
            sqliteDriver(ctx)._run(
                'DELETE FROM chatluna_docstore WHERE key = ? AND id = ?',
                [key, id]
            )
            return
        }
        case 'chatluna_binding':
            await ctx.database.remove('chatluna_binding', {
                bindingKey: recordId
            })
            return
        case 'chatluna_acl': {
            const [conversationId, principalType, principalId] =
                recordId.split(':')
            await ctx.database.remove('chatluna_acl', {
                conversationId,
                principalType,
                principalId
            })
            return
        }
        case 'chatluna_constraint':
            await ctx.database.remove('chatluna_constraint', {
                id: Number(recordId)
            })
            return
        case 'chatluna_archive':
            await ctx.database.remove('chatluna_archive', { id: recordId })
            return
        case 'chatluna_meta':
            await ctx.database.remove('chatluna_meta', { key: recordId })
            return
        case 'chatluna_data_audit':
            await ctx.database.remove('chatluna_data_audit', { id: recordId })
            return
        case 'chatluna_data_identity': {
            const [platform, id] = recordId.split(':')
            await ctx.database.remove('chatluna_data_identity', {
                platform,
                id
            })
            return
        }
    }
    throw new Error(`unsupported table: ${issue.table}`)
}

function repairValueForIssue(issue: IntegrityIssue) {
    if (issue.kind === 'invalid-tool-calls') return '[]'
    if (issue.field === 'users' || issue.field === 'excludeUsers') return '[]'
    if (issue.field === 'ids') return '[]'
    if (issue.field === 'activeConversationId') return ''
    if (issue.field === 'lastConversationId') return ''
    if (issue.field === 'latestMessageId') return ''
    if (issue.kind === 'dangling-conversation-ref') return ''
    if (issue.kind === 'dangling-latest-message') return ''
    return '{}'
}

async function setFieldForIssue(
    ctx: Context,
    issue: IntegrityIssue,
    value: string
) {
    await applyFieldPatchForIssue(ctx, issue, value)
}

async function nullFieldForIssue(ctx: Context, issue: IntegrityIssue) {
    await applyFieldPatchForIssue(ctx, issue, repairValueForIssue(issue))
}

async function applyFieldPatchForIssue(
    ctx: Context,
    issue: IntegrityIssue,
    value: unknown
) {
    const { table, recordId, field } = issue
    const model = ctx.model.tables[table]
    if (
        recordId === 'driver-load-error' ||
        field === '<unknown>' ||
        (!model?.fields?.[field] &&
            !(table === 'chatluna_docstore' && field === 'metadata'))
    ) {
        throw new Error(
            `${table}.${field} 没有可写入的真实字段或主键。请复制报告后用 SQLite 工具定位坏行，或选择能定位到具体 recordId/field 的扫描项。`
        )
    }
    const patch: Record<string, unknown> = { [field]: value }
    switch (table) {
        case 'chatluna_conversation':
            await ctx.database.upsert('chatluna_conversation', [
                { id: recordId, ...patch, updatedAt: new Date() }
            ])
            return
        case 'chatluna_message':
            if (field === 'tool_calls') {
                sqliteDriver(ctx)._run(
                    'UPDATE chatluna_message SET tool_calls = ? WHERE id = ?',
                    [value, recordId]
                )
            } else {
                await ctx.database.upsert('chatluna_message', [
                    { id: recordId, ...patch }
                ])
            }
            return
        case 'chatluna_docstore': {
            const [key, id] = JSON.parse(recordId)
            sqliteDriver(ctx)._run(
                'UPDATE chatluna_docstore SET metadata = ? WHERE key = ? AND id = ?',
                [value, key, id]
            )
            return
        }
        case 'chatluna_binding':
            await ctx.database.upsert('chatluna_binding', [
                {
                    bindingKey: recordId,
                    ...patch,
                    updatedAt: new Date()
                }
            ])
            return
        case 'chatluna_constraint':
            await ctx.database.upsert('chatluna_constraint', [
                { id: Number(recordId), ...patch, updatedAt: new Date() }
            ])
            return
        case 'chatluna_meta':
            await ctx.database.upsert('chatluna_meta', [
                { key: recordId, ...patch, updatedAt: new Date() }
            ])
            return
        case 'chatluna_data_audit':
            await ctx.database.upsert('chatluna_data_audit', [
                { id: recordId, ...patch }
            ])
            return
        case 'chatluna_data_identity': {
            const [platform, id] = recordId.split(':')
            await ctx.database.upsert('chatluna_data_identity', [
                { platform, id, ...patch, updatedAt: new Date() }
            ])
            return
        }
    }
    throw new Error(
        `field patch not supported for ${table}.${field}; use remove-row or manual SQL`
    )
}

async function gzipDecode(data: ArrayBuffer | ArrayBufferView | string) {
    const buf =
        typeof data === 'string'
            ? Buffer.from(data, 'base64')
            : ArrayBuffer.isView(data)
              ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
              : Buffer.from(data)
    return (await gunzipAsync(buf)).toString()
}

function iso(value?: Date | string | null) {
    if (!value) return ''
    const time =
        typeof value === 'string' ? new Date(value).getTime() : value.getTime()
    return Number.isFinite(time) ? new Date(time).toISOString() : ''
}

function timeOf(value?: Date | string | null) {
    if (!value) return 0
    const time =
        typeof value === 'string' ? new Date(value).getTime() : value.getTime()
    return Number.isFinite(time) ? time : 0
}

interface ListInput {
    query?: string
    page?: number
    pageSize?: number
}

interface PermissionOverviewInput extends ListInput {
    platform?: string
    inactiveDays?: number
}

interface IdentityRefreshInput {
    platform: string
    id: string
    guildId?: string
    selfId?: string
}

interface IdentityBatchInput {
    platform?: string
    rows: IdentityRefreshInput[]
}

interface PermissionDiagnoseInput {
    target: string
    command?: string
    channel?: string
}

type KoishiMaintenanceInput =
    | {
          type: 'inactive-down'
          days: number
          authority: number
          permissions: string[]
      }
    | {
          type: 'channels-assign'
          platform?: string
          assignee: string
      }

interface UserInput {
    userId: string
}

interface ConversationInput extends ListInput {
    model?: string
    user?: string
    status?: string
}

interface ProviderInput {
    platform: string
}

interface ConversationDetailInput {
    id: string
    messageLimit?: number
}

interface MessageListInput extends ListInput {
    conversationId?: string
    role?: string
    user?: string
}

interface ConversationPatchInput {
    id: string
    patch: Partial<ConversationRecord>
}

interface CreateConversationInput {
    row: {
        id?: string
        bindingKey: string
        title: string
        model: string
        preset: string
        chatMode: string
        createdBy: string
        status?: string
    }
    setBindingActive?: boolean
}

interface RemoveConversationInput {
    id: string
    removeMessages?: boolean
    removeAcl?: boolean
}

interface SaveBindingInput {
    mode: 'save' | 'remove'
    row: BindingRecord
}

interface SaveMessageInput {
    row: {
        id?: string
        conversationId: string
        parentId?: string | null
        role: string
        text?: string | null
        name?: string | null
        tool_call_id?: string | null
        rawId?: string | null
        createdAt?: string | null
    }
    setLatest?: boolean
}

interface MessageInput {
    id: string
}

interface ConfigInput {
    config: Partial<ChatLunaRuntimeConfig>
}

interface SaveAclInput {
    mode: 'save' | 'remove'
    row: AclRecord
}

interface AssignConversationInput {
    conversationId: string
    principalType: string
    principalId: string
    permission: string
    bindingKey?: string
    setActive?: boolean
    setLast?: boolean
}

interface SaveKoishiUserInput {
    id: number
    authority: number
    permissions?: string | string[] | null
}

interface SaveKoishiChannelInput {
    id: string
    platform: string
    assignee: string
    permissions?: string | string[] | null
}

interface KoishiPermissionPlanInput {
    target:
        | 'all-users'
        | 'bound-users'
        | 'chatluna-users'
        | 'unconfigured-users'
        | 'inactive-users'
        | 'channels'
        | 'channels-empty'
    platform?: string
    inactiveDays?: number
    authority?: number | null
    permissionMode: 'add' | 'replace' | 'remove'
    permissions?: string[]
    assignee?: string
}

interface SaveConstraintInput {
    mode: 'save' | 'remove'
    row: ConstraintRecord & { createdAt?: string; updatedAt?: string }
}

type OperationInput =
    | {
          type: 'model-migration'
          fromModel?: string
          targetModel: string
          status?: string
          user?: string
          includeArchived?: boolean
      }
    | {
          type: 'model-reference-migration'
          fromModel: string
          targetModel: string
          scopes: Array<
              | 'conversation'
              | 'constraint-default'
              | 'constraint-fixed'
              | 'config-default'
          >
          includeArchived?: boolean
      }
    | {
          type: 'status-change'
          status?: string
          model?: string
          user?: string
          targetStatus: string
      }
    | {
          type: 'archive-record-cleanup'
      }
    | {
          type: 'message-repair'
          conversationId: string
      }

interface ConversationRecord {
    id: string
    seq?: number
    bindingKey: string
    title: string
    model: string
    preset: string
    chatMode: string
    createdBy: string
    createdAt: Date
    updatedAt: Date
    lastChatAt?: Date | null
    status: string
    latestMessageId?: string | null
    additional_kwargs?: string | null
    compression?: string | null
    archivedAt?: Date | null
    archiveId?: string | null
    legacyRoomId?: number | null
    legacyMeta?: string | null
    autoTitle?: boolean | null
}

interface MessageRecord {
    id: string
    conversationId: string
    parentId?: string | null
    role: string
    text?: string | null
    content?: ArrayBuffer | null
    name?: string | null
    tool_call_id?: string | null
    tool_calls?: string | null
    additional_kwargs_binary?: ArrayBuffer | null
    response_metadata_binary?: ArrayBuffer | null
    rawId?: string | null
    createdAt?: Date | null
}

interface BindingRecord {
    bindingKey: string
    activeConversationId?: string | null
    lastConversationId?: string | null
    updatedAt?: Date | null
}

interface AclRecord {
    conversationId: string
    principalType: string
    principalId: string
    permission: string
}

interface ConstraintRecord {
    id?: number
    name: string
    enabled: boolean
    priority: number
    createdBy: string
    createdAt: Date
    updatedAt: Date
    platform?: string | null
    selfId?: string | null
    guildId?: string | null
    channelId?: string | null
    direct?: boolean | null
    users?: string | string[] | null
    excludeUsers?: string | string[] | null
    routeMode?: string | null
    routeKey?: string | null
    activePresetLane?: string | null
    defaultModel?: string | null
    defaultPreset?: string | null
    defaultChatMode?: string | null
    fixedModel?: string | null
    fixedPreset?: string | null
    fixedChatMode?: string | null
    lockConversation?: boolean | null
    allowNew?: boolean | null
    allowSwitch?: boolean | null
    allowArchive?: boolean | null
    allowExport?: boolean | null
    manageMode?: string | null
}

interface ArchiveRecord {
    id: string
    conversationId: string
    path: string
    formatVersion: number
    messageCount: number
    checksum: string
    size: number
    state: string
    createdAt: Date
    restoredAt?: Date | null
}

interface MetaRecord {
    key: string
    value: string
    updatedAt: Date
}

interface AuditEntry {
    id: string
    action: string
    target: string
    ids: string[]
    count: number
    detail: unknown
    createdAt: string
}

interface AuditRecord {
    id: string
    action: string
    target: string
    ids: string
    count: number
    detail: string
    createdAt: Date
}

interface OpsErrorEntry {
    id: string
    source: string
    level: string
    logger: string
    message: string
    createdAt: string
    analysis: unknown
}

interface OpsErrorRecord {
    id: string
    source: string
    level: string
    logger: string
    message: string
    kind: string
    title: string
    severity: string
    analysis: string
    createdAt: Date
}

interface IdentityRecord {
    platform: string
    id: string
    name: string
    avatar?: string
    source: string
    error?: string
    updatedAt: Date
}

interface DiagnosticIssue {
    type: string
    message: string
}

interface HealthIssue {
    type: string
    level: 'danger' | 'warning' | 'info'
    target: string
    message: string
    action: string
}

interface ModelHealthInput extends ListInput {
    platform?: string
    issueType?: string
}

interface ModelHealthIssue extends HealthIssue {
    platform: string
}

interface ModelHealthIssueGroup {
    type: string
    label: string
    level: 'danger' | 'warning' | 'info'
    count: number
    action: string
    rows: ModelHealthIssue[]
}

interface ModelReferenceView {
    kind: 'conversation' | 'constraint' | 'config'
    id: string
    title: string
    field: string
    model: string
    status: string
    platform: string
    valid: boolean
    updatedAt: string
}

interface ModelReferencePreview {
    id: string
    refId: string
    kind: 'conversation' | 'constraint' | 'config'
    title: string
    field: string
    model: string
    targetModel: string
    status: string
}

interface PermissionIssue {
    type: string
    level: 'warning' | 'info'
    target: string
    message: string
    action: string
}

interface UserView {
    userId: string
    guildId: string
    bindingKeys: string[]
    conversations: number
    active: number
    archived: number
    acl: number
    constraints: number
    latestConversationId: string
    latestTitle: string
    updatedAt: string
    models: Record<string, number>
}

interface ContextView {
    bindingKey: string
    baseKey: string
    routeMode: string
    presetLane: string
    platform: string
    selfId: string
    scope: string
    guildId: string
    userId: string
    conversations: number
    active: number
    archived: number
    deleted: number
    broken: number
    acl: number
    constraints: number
    models: Record<string, number>
    activeConversationId: string
    lastConversationId: string
    latestConversationId: string
    latestTitle: string
    updatedAt: string
    koishiUserId: number | null
    koishiUserName: string
    koishiUserAuthority: number | null
    koishiUserPermissions: string[]
    koishiBindingCount: number
    channelAssignee: string
    channelPermissions: string[]
}

interface ModelEntry {
    name: string
    type: number
    maxTokens?: number
    capabilities?: string[]
}

interface ModelCount {
    model: string
    count: number
}

interface PlatformClient {
    platform: string
    configPool?: {
        getConfigs?: () => ConfigWrapper[]
    }
    getFileHandlingConfig?: () => FileHandling | null
}

interface PluginEntry {
    platformName?: string
    supportedModels?: string[]
    platformConfigPool?: {
        getConfigs?: () => ConfigWrapper[]
    }
}

interface ConfigWrapper {
    isAvailable: boolean
}

interface FileHandling {
    supportedMimeTypes: Set<string>
    maxTotalSizeBytes: number
    maxFileSizeBytes: number
    maxFileSizeBytesOverrides?: Record<string, number>
}

interface ToolEntry {
    description?: string
    meta?: {
        source?: string
        group?: string
        tags?: string[]
        isMcp?: boolean
        serverName?: string
        defaultAvailability?: Record<string, unknown>
    }
}

interface ChainEntry {
    description?: Record<string, unknown>
}

interface PresetEntry {
    triggerKeyword?: string[]
    path?: string
    rawText?: string
    messages?: unknown[]
}

interface ChatLunaRuntimeConfig {
    botNames?: string[]
    isNickname?: boolean
    isNickNameWithContent?: boolean
    allowPrivate?: boolean
    isForwardMsg?: boolean
    forwardMsgMinLength?: number
    msgCooldown?: number
    randomReplyFrequency?: number
    includeQuoteReply?: boolean
    attachForwardMsgIdToContext?: boolean
    isLog?: boolean
    isReplyWithAt?: boolean
    replyQuoteThreshold?: number
    allowQuoteReply?: boolean
    proxyAddress?: string
    isProxy?: boolean
    outputMode?: string
    sendThinkingMessage?: boolean
    sendThinkingMessageTimeout?: number
    showThoughtMessage?: boolean
    splitMessage?: boolean
    blackList?: number
    censor?: boolean
    autoArchive?: boolean
    autoArchiveTimeout?: number
    autoPurgeArchive?: boolean
    autoPurgeArchiveTimeout?: number
    messageQueue?: boolean
    messageQueueDelay?: number
    infiniteContext?: boolean
    infiniteContextThreshold?: number
    rawOnCensor?: boolean
    defaultModel?: string
    defaultPreset?: string
    defaultChatMode?: string
    defaultEmbeddings?: string
    defaultVectorStore?: string
    defaultGroupRouteMode?: string
    privateChatWithoutCommand?: boolean
    allowAtReply?: boolean
    streamResponse?: boolean
    voiceSpeakId?: number
}

interface ResourceView {
    type: string
    name: string
    description: string
    source: string
    group: string
    tags: string[]
    usedByConversations: number
    usedByRules: number
    path: string
    details: Record<string, unknown>
}

interface KoishiUserRecord {
    id: number
    name: string
    authority: number
    permissions?: string[]
    createdAt?: Date
}

interface KoishiBindingRecord {
    aid: number
    bid: number
    pid: string
    platform: string
}

interface KoishiChannelRecord {
    id: string
    platform: string
    assignee: string
    guildId: string
    permissions?: string[]
    createdAt?: Date
}

interface PermissionUserView {
    id: number
    displayName: string
    authority: number
    permissions: string[]
    inactiveDays: number | null
    platforms: string[]
}

interface ProviderView {
    platform: string
    registered: boolean
    loaded: boolean
    pluginInstalled: boolean
    state: string
    configCount: number
    availableConfigCount: number
    modelCount: number
    llmCount: number
    embeddingsCount: number
    rerankerCount: number
    capabilities: string[]
    maxTokensMin: number
    maxTokensMax: number
    fileHandling: {
        supportedMimeTypes: string[]
        maxTotalSizeBytes: number
        maxFileSizeBytes: number
        maxFileSizeBytesOverrides: Record<string, number>
    } | null
    conversations: number
    activeConversations: number
    archivedConversations: number
    models: {
        name: string
        type: number
        typeText: string
        maxTokens: number
        capabilities: string[]
    }[]
    recent: ReturnType<typeof viewConversation>[]
}

declare module '@koishijs/console' {
    interface Events {
        'chatluna-data/getOverview': () => Promise<unknown>
        'chatluna-data/getModelHealth': (
            input?: ModelHealthInput
        ) => Promise<unknown>
        'chatluna-data/listProviders': (
            input?: ListInput
        ) => Promise<unknown>
        'chatluna-data/getProviderDetail': (
            input: ProviderInput
        ) => Promise<unknown>
        'chatluna-data/refreshProvider': (
            input: ProviderInput
        ) => Promise<unknown>
        'chatluna-data/listContexts': (input?: ListInput) => Promise<unknown>
        'chatluna-data/listResources': (input?: ListInput) => Promise<unknown>
        'chatluna-data/getHealth': () => Promise<unknown>
        'chatluna-data/analyzeOpsError': (
            input?: OpsErrorInput
        ) => Promise<unknown>
        'chatluna-data/listOpsErrors': () => Promise<unknown>
        'chatluna-data/resetOpsErrors': () => Promise<unknown>
        'chatluna-data/getConfig': () => Promise<unknown>
        'chatluna-data/saveConfig': (
            input: ConfigInput
        ) => Promise<unknown>
        'chatluna-data/listUsers': (input?: ListInput) => Promise<unknown>
        'chatluna-data/getUserDetail': (
            input: UserInput
        ) => Promise<unknown>
        'chatluna-data/listConversations': (
            input?: ConversationInput
        ) => Promise<unknown>
        'chatluna-data/getConversationDetail': (
            input: ConversationDetailInput
        ) => Promise<unknown>
        'chatluna-data/listMessages': (
            input?: MessageListInput
        ) => Promise<unknown>
        'chatluna-data/saveConversationPatch': (
            input: ConversationPatchInput
        ) => Promise<unknown>
        'chatluna-data/createConversation': (
            input: CreateConversationInput
        ) => Promise<unknown>
        'chatluna-data/removeConversation': (
            input: RemoveConversationInput
        ) => Promise<unknown>
        'chatluna-data/saveBinding': (
            input: SaveBindingInput
        ) => Promise<unknown>
        'chatluna-data/saveMessage': (
            input: SaveMessageInput
        ) => Promise<unknown>
        'chatluna-data/removeMessage': (input: MessageInput) => Promise<unknown>
        'chatluna-data/listAcl': (input?: ListInput) => Promise<unknown>
        'chatluna-data/getPermissionOverview': (
            input?: PermissionOverviewInput
        ) => Promise<unknown>
        'chatluna-data/saveKoishiUserPermission': (
            input: SaveKoishiUserInput
        ) => Promise<unknown>
        'chatluna-data/saveKoishiChannelPermission': (
            input: SaveKoishiChannelInput
        ) => Promise<unknown>
        'chatluna-data/previewKoishiPermissionPlan': (
            input: KoishiPermissionPlanInput
        ) => Promise<unknown>
        'chatluna-data/applyKoishiPermissionPlan': (
            input: KoishiPermissionPlanInput
        ) => Promise<unknown>
        'chatluna-data/listKoishiIdentities': (
            input?: ListInput
        ) => Promise<unknown>
        'chatluna-data/refreshKoishiIdentity': (
            input: IdentityRefreshInput
        ) => Promise<unknown>
        'chatluna-data/refreshKoishiIdentityBatch': (
            input: IdentityBatchInput
        ) => Promise<unknown>
        'chatluna-data/getKoishiPermissionGraph': () => Promise<unknown>
        'chatluna-data/diagnoseKoishiPermission': (
            input: PermissionDiagnoseInput
        ) => Promise<unknown>
        'chatluna-data/listKoishiCommands': () => Promise<unknown>
        'chatluna-data/previewKoishiMaintenance': (
            input: KoishiMaintenanceInput
        ) => Promise<unknown>
        'chatluna-data/applyKoishiMaintenance': (
            input: KoishiMaintenanceInput
        ) => Promise<unknown>
        'chatluna-data/saveAcl': (input: SaveAclInput) => Promise<unknown>
        'chatluna-data/assignConversation': (
            input: AssignConversationInput
        ) => Promise<unknown>
        'chatluna-data/listConstraints': (
            input?: ListInput
        ) => Promise<unknown>
        'chatluna-data/saveConstraint': (
            input: SaveConstraintInput
        ) => Promise<unknown>
        'chatluna-data/listArchives': (input?: ListInput) => Promise<unknown>
        'chatluna-data/previewOperation': (
            input: OperationInput
        ) => Promise<unknown>
        'chatluna-data/applyOperation': (
            input: OperationInput
        ) => Promise<unknown>
        'chatluna-data/summary': () => Promise<unknown>
        'chatluna-data/scanIntegrity': (
            input?: IntegrityScanInput
        ) => Promise<unknown>
        'chatluna-data/repairIntegrity': (
            input: IntegrityRepairInput
        ) => Promise<unknown>
        'chatluna-data/getIntegrityField': (
            input: IntegrityFieldInput
        ) => Promise<unknown>
    }
}

declare module 'koishi' {
    interface Tables {
        chatluna_conversation: ConversationRecord
        chatluna_message: MessageRecord
        chatluna_binding: BindingRecord
        chatluna_acl: AclRecord
        chatluna_constraint: ConstraintRecord
        chatluna_archive: ArchiveRecord
        chatluna_meta: MetaRecord
        chatluna_data_audit: AuditRecord
        chatluna_data_identity: IdentityRecord
        chatluna_data_ops_error: OpsErrorRecord
    }
}
