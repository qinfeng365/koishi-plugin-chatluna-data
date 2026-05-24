import { access, stat } from 'fs/promises'
import { constants } from 'fs'
import { randomUUID } from 'crypto'
import { dirname, resolve } from 'path'
import { gunzip } from 'zlib'
import { promisify } from 'util'
import { fileURLToPath } from 'url'
import { Context, Schema } from 'koishi'
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
        .description('允许执行消息链 parentId/latestMessageId 修复。')
})

const audits: AuditEntry[] = []
let rootCtx: Context

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
        { primary: 'id' }
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
        { primary: 'id' }
    )
    ctx.model.extend(
        'chatluna_binding',
        {
            bindingKey: 'string',
            activeConversationId: 'string',
            lastConversationId: 'string',
            updatedAt: 'timestamp'
        },
        { primary: 'bindingKey' }
    )
    ctx.model.extend(
        'chatluna_acl',
        {
            conversationId: 'string',
            principalType: 'string',
            principalId: 'string',
            permission: 'string'
        },
        { primary: ['conversationId', 'principalType', 'principalId'] }
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
        { primary: 'id' }
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

    ctx.console.addEntry({
        dev: resolve(root, '../client/index.ts'),
        prod: resolve(root, '../dist')
    })

    ctx.console.addListener(
        'chatluna-data/getOverview',
        async () => overview(ctx, cfg, app),
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
            const [msgs, bindings, acls, arcs] = await Promise.all([
                getRows<MessageRecord>(ctx, 'chatluna_message', {
                    conversationId: input.id
                }),
                getRows<BindingRecord>(ctx, 'chatluna_binding'),
                getRows<AclRecord>(ctx, 'chatluna_acl', {
                    conversationId: input.id
                }),
                getRows<ArchiveRecord>(ctx, 'chatluna_archive', {
                    conversationId: input.id
                })
            ])
            const diag = diagnoseConversation(conv, msgs)
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
                    diag.rows
                        .slice(0, input.messageLimit ?? 200)
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
            const [msgs, convs] = await Promise.all([
                getRows<MessageRecord>(ctx, 'chatluna_message'),
                getRows<ConversationRecord>(ctx, 'chatluna_conversation')
            ])
            const map = new Map(convs.map((row) => [row.id, row]))
            const rows = await Promise.all(
                msgs
                    .filter((row) => {
                        const conv = map.get(row.conversationId)
                        if (
                            input.conversationId &&
                            row.conversationId !== input.conversationId
                        ) {
                            return false
                        }
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
                'chatluna_binding'
            )
            await Promise.all(
                bindings
                    .filter(
                        (row) =>
                            row.activeConversationId === input.id ||
                            row.lastConversationId === input.id
                    )
                    .map((row) =>
                        ctx.database.upsert('chatluna_binding', [
                            {
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
                            }
                        ])
                    )
            )
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
            const msgs = await getRows<MessageRecord>(ctx, 'chatluna_message', {
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
        async () => {
            const [users, kBindings, channels, convs, acls, rules] =
                await Promise.all([
                    getRows<KoishiUserRecord>(ctx, 'user'),
                    getRows<KoishiBindingRecord>(ctx, 'binding'),
                    getRows<KoishiChannelRecord>(ctx, 'channel'),
                    getRows<ConversationRecord>(ctx, 'chatluna_conversation'),
                    getRows<AclRecord>(ctx, 'chatluna_acl'),
                    getRows<ConstraintRecord>(ctx, 'chatluna_constraint')
                ])
            const userRows = users.map((row) => {
                const refs = kBindings.filter((item) => item.aid === row.id)
                const ids = refs.map((item) => item.pid)
                const rows = convs.filter(
                    (conv) =>
                        ids.includes(conv.createdBy) ||
                        ids.some((id) => conv.bindingKey.includes(id))
                )
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
                    conversations: rows.length,
                    acl: acls.filter((acl) => ids.includes(acl.principalId))
                        .length,
                    constraints: rules.filter((rule) =>
                        ids.some((id) =>
                            [
                                ...readUserList(rule.users),
                                ...readUserList(rule.excludeUsers),
                                rule.createdBy
                            ].includes(id)
                        )
                    ).length
                }
            })
            return {
                totals: {
                    users: users.length,
                    bindings: kBindings.length,
                    channels: channels.length,
                    acl: acls.length
                },
                users: userRows.sort((a, b) => b.authority - a.authority),
                bindings: kBindings
                    .map((row) => {
                        const user = users.find((item) => item.id === row.aid)
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
                        `${a.platform}:${a.pid}`.localeCompare(
                            `${b.platform}:${b.pid}`
                        )
                    ),
                channels: channels
                    .map((row) => ({
                        id: row.id,
                        platform: row.platform,
                        guildId: row.guildId,
                        assignee: row.assignee,
                        permissions: row.permissions ?? [],
                        createdAt: iso(row.createdAt),
                        conversations: convs.filter((conv) =>
                            conv.bindingKey.includes(row.id)
                        ).length,
                        acl: acls.filter(
                            (acl) =>
                                acl.principalType === 'guild' &&
                                acl.principalId === row.id
                        ).length
                    }))
                    .sort((a, b) =>
                        `${a.platform}:${a.id}`.localeCompare(
                            `${b.platform}:${b.id}`
                        )
                    )
            }
        },
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
                await Promise.all(
                    prev.rows.map(async (row) => {
                        const [conv] = await ctx.database.get(
                            'chatluna_conversation',
                            { id: row.id }
                        )
                        await clearRuntime(app, conv)
                    })
                )
                pushAudit('operation.model-migration', input.targetModel, [
                    ...prev.rows.map((row) => row.id)
                ])
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
                const msgs = await getRows<MessageRecord>(
                    ctx,
                    'chatluna_message',
                    { conversationId: input.conversationId }
                )
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
    })
}

async function getRows<T>(ctx: Context, table: string, query = {}) {
    return (await ctx.database.get(table as never, query as never)) as T[]
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
            getRows<MessageRecord>(ctx, 'chatluna_message'),
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
    const issues = convs
        .map((row) => diagnoseConversation(row, msgs))
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
        audits
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
        getRows<MessageRecord>(ctx, 'chatluna_message'),
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
    for (const conv of convs) {
        const diag = diagnoseConversation(
            conv,
            msgs.filter((row) => row.conversationId === conv.id)
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

async function viewMessage(row: MessageRecord) {
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

function diagnoseConversation(
    conv: ConversationRecord,
    messages: MessageRecord[]
) {
    const rows = messages.filter((row) => row.conversationId === conv.id)
    const map = new Map(rows.map((row) => [row.id, row]))
    const chain: MessageRecord[] = []
    const seen = new Set<string>()
    const issues: DiagnosticIssue[] = []
    let id = conv.latestMessageId
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
    for (const acl of acls) {
        for (const row of map.values()) {
            if (row.latestConversationId === acl.conversationId) row.acl += 1
        }
    }
    for (const rule of rules) {
        for (const row of map.values()) {
            const byPlatform =
                rule.platform == null || rule.platform === row.platform
            const bySelf = rule.selfId == null || rule.selfId === row.selfId
            const byGuild = rule.guildId == null || rule.guildId === row.guildId
            const byUser =
                readUserList(rule.users).length === 0 ||
                readUserList(rule.users).includes(row.userId)
            const excluded = readUserList(rule.excludeUsers).includes(row.userId)
            if (byPlatform && bySelf && byGuild && byUser && !excluded) {
                row.constraints += 1
            }
        }
    }
    for (const row of map.values()) {
        const refs = kBindings.filter(
            (item) => item.platform === row.platform && item.pid === row.userId
        )
        row.koishiBindingCount = refs.length
        const user = users.find((item) => refs.some((ref) => ref.aid === item.id))
        if (user) {
            row.koishiUserId = user.id
            row.koishiUserName = user.name
            row.koishiUserAuthority = user.authority
            row.koishiUserPermissions = user.permissions ?? []
        }
        const channel = channels.find(
            (item) =>
                item.platform === row.platform &&
                (item.id === row.guildId || item.guildId === row.guildId)
        )
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
        const msgs = await getRows<MessageRecord>(ctx, 'chatluna_message', {
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

function pushAudit(action: string, target: string, ids: string[], detail = {}) {
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

async function readMessageText(row: MessageRecord) {
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
    return typeof value === 'string' ? value : value.toISOString()
}

function timeOf(value?: Date | string | null) {
    if (!value) return 0
    return typeof value === 'string' ? new Date(value).getTime() : value.getTime()
}

interface ListInput {
    query?: string
    page?: number
    pageSize?: number
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
        'chatluna-data/getPermissionOverview': () => Promise<unknown>
        'chatluna-data/saveKoishiUserPermission': (
            input: SaveKoishiUserInput
        ) => Promise<unknown>
        'chatluna-data/saveKoishiChannelPermission': (
            input: SaveKoishiChannelInput
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
    }
}
