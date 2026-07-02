import { Context, Schema } from 'koishi';
export declare const name = "chatluna-data";
export declare const inject: {
    required: string[];
    optional: string[];
};
export interface Config {
    pageSize: number;
    readonly: boolean;
    maxPreviewRows: number;
    enableArchiveFileOps: boolean;
    enableMessageRepair: boolean;
    identityRefreshLimitPerBatch: number;
    identityRefreshInterval: number;
    inactiveWarningDays: number;
    enableIdentityLookup: boolean;
    enableKoishiPermissionCommands: boolean;
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, cfg: Config): void;
interface IntegrityScanInput {
    tables?: string[];
    deep?: boolean;
    limit?: number;
}
interface IntegrityRepairInput {
    issueIds: string[];
    action: 'null-field' | 'remove-row' | 'set-value';
    value?: string;
    confirm?: boolean;
}
interface IntegrityFieldInput {
    table: string;
    recordId: string;
    field: string;
}
interface OpsErrorInput {
    text?: string;
}
interface AuditRecord {
    id: string;
    action: string;
    target: string;
    ids: string;
    count: number;
    detail: string;
    createdAt: Date;
}
interface ListInput {
    query?: string;
    page?: number;
    pageSize?: number;
}
interface PermissionOverviewInput extends ListInput {
    platform?: string;
    inactiveDays?: number;
}
interface IdentityRefreshInput {
    platform: string;
    id: string;
    guildId?: string;
    selfId?: string;
}
interface IdentityBatchInput {
    platform?: string;
    rows: IdentityRefreshInput[];
}
interface PermissionDiagnoseInput {
    target: string;
    command?: string;
    channel?: string;
}
type KoishiMaintenanceInput = {
    type: 'inactive-down';
    days: number;
    authority: number;
    permissions: string[];
} | {
    type: 'channels-assign';
    platform?: string;
    assignee: string;
};
interface UserInput {
    userId: string;
}
interface ConversationInput extends ListInput {
    model?: string;
    user?: string;
    status?: string;
}
interface ProviderInput {
    platform: string;
}
interface ConversationDetailInput {
    id: string;
    messageLimit?: number;
}
interface MessageListInput extends ListInput {
    conversationId?: string;
    role?: string;
    user?: string;
}
interface ConversationPatchInput {
    id: string;
    patch: Partial<ConversationRecord>;
}
interface CreateConversationInput {
    row: {
        id?: string;
        bindingKey: string;
        title: string;
        model: string;
        preset: string;
        chatMode: string;
        createdBy: string;
        status?: string;
    };
    setBindingActive?: boolean;
}
interface RemoveConversationInput {
    id: string;
    removeMessages?: boolean;
    removeAcl?: boolean;
}
interface SaveBindingInput {
    mode: 'save' | 'remove';
    row: BindingRecord;
}
interface SaveMessageInput {
    row: {
        id?: string;
        conversationId: string;
        parentId?: string | null;
        role: string;
        text?: string | null;
        name?: string | null;
        tool_call_id?: string | null;
        rawId?: string | null;
        createdAt?: string | null;
    };
    setLatest?: boolean;
}
interface MessageInput {
    id: string;
}
interface ConfigInput {
    config: Partial<ChatLunaRuntimeConfig>;
}
interface SaveAclInput {
    mode: 'save' | 'remove';
    row: AclRecord;
}
interface AssignConversationInput {
    conversationId: string;
    principalType: string;
    principalId: string;
    permission: string;
    bindingKey?: string;
    setActive?: boolean;
    setLast?: boolean;
}
interface SaveKoishiUserInput {
    id: number;
    authority: number;
    permissions?: string | string[] | null;
}
interface SaveKoishiChannelInput {
    id: string;
    platform: string;
    assignee: string;
    permissions?: string | string[] | null;
}
interface KoishiPermissionPlanInput {
    target: 'all-users' | 'bound-users' | 'chatluna-users' | 'unconfigured-users' | 'inactive-users' | 'channels' | 'channels-empty';
    platform?: string;
    inactiveDays?: number;
    authority?: number | null;
    permissionMode: 'add' | 'replace' | 'remove';
    permissions?: string[];
    assignee?: string;
}
interface SaveConstraintInput {
    mode: 'save' | 'remove';
    row: ConstraintRecord & {
        createdAt?: string;
        updatedAt?: string;
    };
}
type OperationInput = {
    type: 'model-migration';
    fromModel?: string;
    targetModel: string;
    status?: string;
    user?: string;
    includeArchived?: boolean;
} | {
    type: 'model-reference-migration';
    fromModel: string;
    targetModel: string;
    scopes: Array<'conversation' | 'constraint-default' | 'constraint-fixed' | 'config-default'>;
    includeArchived?: boolean;
} | {
    type: 'status-change';
    status?: string;
    model?: string;
    user?: string;
    targetStatus: string;
} | {
    type: 'archive-record-cleanup';
} | {
    type: 'message-repair';
    conversationId: string;
};
interface ConversationRecord {
    id: string;
    seq?: number;
    bindingKey: string;
    title: string;
    model: string;
    preset: string;
    chatMode: string;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
    lastChatAt?: Date | null;
    status: string;
    latestMessageId?: string | null;
    additional_kwargs?: string | null;
    compression?: string | null;
    archivedAt?: Date | null;
    archiveId?: string | null;
    legacyRoomId?: number | null;
    legacyMeta?: string | null;
    autoTitle?: boolean | null;
}
interface MessageRecord {
    id: string;
    conversationId: string;
    parentId?: string | null;
    role: string;
    text?: string | null;
    content?: ArrayBuffer | null;
    name?: string | null;
    tool_call_id?: string | null;
    tool_calls?: string | null;
    additional_kwargs_binary?: ArrayBuffer | null;
    response_metadata_binary?: ArrayBuffer | null;
    rawId?: string | null;
    createdAt?: Date | null;
}
interface BindingRecord {
    bindingKey: string;
    activeConversationId?: string | null;
    lastConversationId?: string | null;
    updatedAt?: Date | null;
}
interface AclRecord {
    conversationId: string;
    principalType: string;
    principalId: string;
    permission: string;
}
interface ConstraintRecord {
    id?: number;
    name: string;
    enabled: boolean;
    priority: number;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
    platform?: string | null;
    selfId?: string | null;
    guildId?: string | null;
    channelId?: string | null;
    direct?: boolean | null;
    users?: string | string[] | null;
    excludeUsers?: string | string[] | null;
    routeMode?: string | null;
    routeKey?: string | null;
    activePresetLane?: string | null;
    defaultModel?: string | null;
    defaultPreset?: string | null;
    defaultChatMode?: string | null;
    fixedModel?: string | null;
    fixedPreset?: string | null;
    fixedChatMode?: string | null;
    lockConversation?: boolean | null;
    allowNew?: boolean | null;
    allowSwitch?: boolean | null;
    allowArchive?: boolean | null;
    allowExport?: boolean | null;
    manageMode?: string | null;
}
interface ArchiveRecord {
    id: string;
    conversationId: string;
    path: string;
    formatVersion: number;
    messageCount: number;
    checksum: string;
    size: number;
    state: string;
    createdAt: Date;
    restoredAt?: Date | null;
}
interface MetaRecord {
    key: string;
    value: string;
    updatedAt: Date;
}
interface AuditRecord {
    id: string;
    action: string;
    target: string;
    ids: string;
    count: number;
    detail: string;
    createdAt: Date;
}
interface OpsErrorRecord {
    id: string;
    source: string;
    level: string;
    logger: string;
    message: string;
    kind: string;
    title: string;
    severity: string;
    analysis: string;
    createdAt: Date;
}
interface IdentityRecord {
    platform: string;
    id: string;
    name: string;
    avatar?: string;
    source: string;
    error?: string;
    updatedAt: Date;
}
interface ModelHealthInput extends ListInput {
    platform?: string;
    issueType?: string;
}
interface ChatLunaRuntimeConfig {
    botNames?: string[];
    isNickname?: boolean;
    isNickNameWithContent?: boolean;
    allowPrivate?: boolean;
    isForwardMsg?: boolean;
    forwardMsgMinLength?: number;
    msgCooldown?: number;
    randomReplyFrequency?: number;
    includeQuoteReply?: boolean;
    attachForwardMsgIdToContext?: boolean;
    isLog?: boolean;
    isReplyWithAt?: boolean;
    replyQuoteThreshold?: number;
    allowQuoteReply?: boolean;
    proxyAddress?: string;
    isProxy?: boolean;
    outputMode?: string;
    sendThinkingMessage?: boolean;
    sendThinkingMessageTimeout?: number;
    showThoughtMessage?: boolean;
    splitMessage?: boolean;
    blackList?: number;
    censor?: boolean;
    autoArchive?: boolean;
    autoArchiveTimeout?: number;
    autoPurgeArchive?: boolean;
    autoPurgeArchiveTimeout?: number;
    messageQueue?: boolean;
    messageQueueDelay?: number;
    infiniteContext?: boolean;
    infiniteContextThreshold?: number;
    rawOnCensor?: boolean;
    defaultModel?: string;
    defaultPreset?: string;
    defaultChatMode?: string;
    defaultEmbeddings?: string;
    defaultVectorStore?: string;
    defaultGroupRouteMode?: string;
    privateChatWithoutCommand?: boolean;
    allowAtReply?: boolean;
    streamResponse?: boolean;
    voiceSpeakId?: number;
}
declare module '@koishijs/console' {
    interface Events {
        'chatluna-data/getOverview': () => Promise<unknown>;
        'chatluna-data/getModelHealth': (input?: ModelHealthInput) => Promise<unknown>;
        'chatluna-data/listProviders': (input?: ListInput) => Promise<unknown>;
        'chatluna-data/getProviderDetail': (input: ProviderInput) => Promise<unknown>;
        'chatluna-data/refreshProvider': (input: ProviderInput) => Promise<unknown>;
        'chatluna-data/listContexts': (input?: ListInput) => Promise<unknown>;
        'chatluna-data/listResources': (input?: ListInput) => Promise<unknown>;
        'chatluna-data/getHealth': () => Promise<unknown>;
        'chatluna-data/analyzeOpsError': (input?: OpsErrorInput) => Promise<unknown>;
        'chatluna-data/listOpsErrors': () => Promise<unknown>;
        'chatluna-data/resetOpsErrors': () => Promise<unknown>;
        'chatluna-data/getConfig': () => Promise<unknown>;
        'chatluna-data/saveConfig': (input: ConfigInput) => Promise<unknown>;
        'chatluna-data/listUsers': (input?: ListInput) => Promise<unknown>;
        'chatluna-data/getUserDetail': (input: UserInput) => Promise<unknown>;
        'chatluna-data/listConversations': (input?: ConversationInput) => Promise<unknown>;
        'chatluna-data/getConversationDetail': (input: ConversationDetailInput) => Promise<unknown>;
        'chatluna-data/listMessages': (input?: MessageListInput) => Promise<unknown>;
        'chatluna-data/saveConversationPatch': (input: ConversationPatchInput) => Promise<unknown>;
        'chatluna-data/createConversation': (input: CreateConversationInput) => Promise<unknown>;
        'chatluna-data/removeConversation': (input: RemoveConversationInput) => Promise<unknown>;
        'chatluna-data/saveBinding': (input: SaveBindingInput) => Promise<unknown>;
        'chatluna-data/saveMessage': (input: SaveMessageInput) => Promise<unknown>;
        'chatluna-data/removeMessage': (input: MessageInput) => Promise<unknown>;
        'chatluna-data/listAcl': (input?: ListInput) => Promise<unknown>;
        'chatluna-data/getPermissionOverview': (input?: PermissionOverviewInput) => Promise<unknown>;
        'chatluna-data/saveKoishiUserPermission': (input: SaveKoishiUserInput) => Promise<unknown>;
        'chatluna-data/saveKoishiChannelPermission': (input: SaveKoishiChannelInput) => Promise<unknown>;
        'chatluna-data/previewKoishiPermissionPlan': (input: KoishiPermissionPlanInput) => Promise<unknown>;
        'chatluna-data/applyKoishiPermissionPlan': (input: KoishiPermissionPlanInput) => Promise<unknown>;
        'chatluna-data/listKoishiIdentities': (input?: ListInput) => Promise<unknown>;
        'chatluna-data/refreshKoishiIdentity': (input: IdentityRefreshInput) => Promise<unknown>;
        'chatluna-data/refreshKoishiIdentityBatch': (input: IdentityBatchInput) => Promise<unknown>;
        'chatluna-data/getKoishiPermissionGraph': () => Promise<unknown>;
        'chatluna-data/diagnoseKoishiPermission': (input: PermissionDiagnoseInput) => Promise<unknown>;
        'chatluna-data/listKoishiCommands': () => Promise<unknown>;
        'chatluna-data/previewKoishiMaintenance': (input: KoishiMaintenanceInput) => Promise<unknown>;
        'chatluna-data/applyKoishiMaintenance': (input: KoishiMaintenanceInput) => Promise<unknown>;
        'chatluna-data/saveAcl': (input: SaveAclInput) => Promise<unknown>;
        'chatluna-data/assignConversation': (input: AssignConversationInput) => Promise<unknown>;
        'chatluna-data/listConstraints': (input?: ListInput) => Promise<unknown>;
        'chatluna-data/saveConstraint': (input: SaveConstraintInput) => Promise<unknown>;
        'chatluna-data/listArchives': (input?: ListInput) => Promise<unknown>;
        'chatluna-data/previewOperation': (input: OperationInput) => Promise<unknown>;
        'chatluna-data/applyOperation': (input: OperationInput) => Promise<unknown>;
        'chatluna-data/summary': () => Promise<unknown>;
        'chatluna-data/scanIntegrity': (input?: IntegrityScanInput) => Promise<unknown>;
        'chatluna-data/repairIntegrity': (input: IntegrityRepairInput) => Promise<unknown>;
        'chatluna-data/getIntegrityField': (input: IntegrityFieldInput) => Promise<unknown>;
    }
}
declare module 'koishi' {
    interface Tables {
        chatluna_conversation: ConversationRecord;
        chatluna_message: MessageRecord;
        chatluna_binding: BindingRecord;
        chatluna_acl: AclRecord;
        chatluna_constraint: ConstraintRecord;
        chatluna_archive: ArchiveRecord;
        chatluna_meta: MetaRecord;
        chatluna_data_audit: AuditRecord;
        chatluna_data_identity: IdentityRecord;
        chatluna_data_ops_error: OpsErrorRecord;
    }
}
export {};
