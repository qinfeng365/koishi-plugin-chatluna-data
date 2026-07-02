// Shared types extracted from page.vue. These describe the shapes the
// console RPC endpoints return; keeping them in a separate module shaves
// hundreds of lines off the SFC and makes it cheaper for tooling to lint.

export interface ModelCount {
    model: string
    count: number
}

export interface Conversation {
    id: string
    title: string
    model: string
    preset: string
    chatMode: string
    createdBy: string
    bindingKey: string
    status: string
    latestMessageId: string | null
    updatedAt: string
    archiveId?: string | null
}

export interface ConversationEdit {
    id: string
    bindingKey: string
    title: string
    model: string
    preset: string
    chatMode: string
    createdBy: string
    status: string
}

export interface User {
    userId: string
    bindingKeys: string[]
    conversations: number
    active: number
    archived: number
    acl: number
    constraints: number
    latestConversationId: string
    latestTitle: string
    models: Record<string, number>
}

export interface ContextRow {
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

export interface RouteInfo {
    baseKey: string
    presetLane: string
    routeMode: string
    platform: string
    selfId: string
    scope: string
    guildId: string
    userId: string
}

export interface Provider {
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
    riskCount?: number
    models: ProviderModel[]
    recent: Conversation[]
}

export interface ModelHealthIssue {
    type: string
    level: string
    target: string
    platform: string
    message: string
    action: string
}

export interface ModelHealthIssueGroup {
    type: string
    label: string
    level: string
    count: number
    action: string
    rows: ModelHealthIssue[]
}

export interface ModelReference {
    kind: string
    id: string
    title: string
    field: string
    model: string
    status: string
    platform: string
    valid: boolean
    updatedAt: string
}

export interface Resource {
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

export interface ProviderModel {
    name: string
    type: number
    typeText: string
    maxTokens: number
    capabilities: string[]
}

export interface Tool {
    name: string
    description: string
    source: string
    group: string
    tags: string[]
}

export interface ChatChain {
    name: string
    description: Record<string, unknown>
}

export interface Diagnostic {
    conversationId: string
    title: string
    status: string
    latestMessageId: string | null
    messageCount: number
    chainCount: number
    orphanCount: number
    issues: { type: string; message: string }[]
}

export interface Message {
    id: string
    conversationId: string
    parentId: string | null
    role: string
    text: string
    name: string
    toolCallId: string
    rawId: string
    createdAt: string
    title?: string
    model?: string
    createdBy?: string
    bindingKey?: string
}

export interface MessageEdit {
    id: string
    conversationId: string
    parentId: string | null
    role: string
    text: string
    name: string
    tool_call_id: string
    rawId: string
    createdAt: string
}

export interface Acl {
    conversationId: string
    principalType: string
    principalId: string
    permission: string
}

export interface Rule {
    id?: number
    name: string
    enabled: boolean
    priority: number
    createdBy: string
    createdAt: string
    updatedAt: string
    guildId?: string | null
    channelId?: string | null
    routeMode?: string | null
    routeKey?: string | null
    defaultModel?: string | null
    defaultPreset?: string | null
    fixedModel?: string | null
    fixedPreset?: string | null
    lockConversation?: boolean | null
    allowNew?: boolean | null
    allowSwitch?: boolean | null
    allowArchive?: boolean | null
    allowExport?: boolean | null
    users: string[] | string
    excludeUsers: string[] | string
    usersText?: string
    excludeUsersText?: string
}

export interface Archive {
    id: string
    conversationId: string
    path: string
    state: string
    messageCount: number
    size: number
    fileState: string
}

export interface Binding {
    bindingKey: string
    activeConversationId?: string | null
    lastConversationId?: string | null
    updatedAt?: string | null
}

export interface KoishiBinding {
    aid: number
    bid: number
    pid: string
    platform: string
}

export interface KoishiUser {
    id: number
    name: string
    authority: number
    permissions?: string[]
    createdAt?: string
}

export interface KoishiChannel {
    id: string
    platform: string
    assignee: string
    guildId: string
    permissions?: string[]
    createdAt?: string
}

export interface PermissionUser {
    id: number
    name: string
    displayName: string
    nameSource: string
    identitySource: string
    identityUpdatedAt: string
    authority: number
    permissions: string[]
    createdAt: string
    lastActiveAt: string
    inactiveDays: number | null
    activeLevel: string
    lastActiveSource: string
    bindings: number
    platforms: string[]
    principals: string[]
    accounts: PermissionAccount[]
    chatlunaConversations: number
    chatlunaMessages: number | null
    conversations: number
    acl: number
    constraints: number
    riskLevel: string
}

export interface PermissionAccount {
    platform: string
    id: string
    name: string
    source: string
    error: string
    updatedAt: string
}

export interface IdentityRow {
    platform: string
    id: string
    name: string
    avatar: string
    source: string
    error: string
    updatedAt: string
}

export interface PermissionBinding {
    aid: number
    bid: number
    pid: string
    platform: string
    userName: string
    authority: number
    permissions: string[]
}

export interface PermissionChannel {
    id: string
    platform: string
    guildId: string
    assignee: string
    permissions: string[]
    createdAt: string
    conversations: number
    acl: number
}

export interface PermissionIssue {
    type: string
    level: string
    target: string
    message: string
    action: string
}

export interface PermissionPlanRow {
    kind: string
    id: string | number
    platform: string
    name: string
    reason: string
    currentAuthority: number | null
    nextAuthority: number | null
    currentAssignee: string
    nextAssignee: string
    currentPermissions: string[]
    nextPermissions: string[]
}

export interface KoishiCommand {
    name: string
    displayName: string
    permissions: string[]
    dependencies: string[]
}

export interface PermissionDiagnosis {
    allowed: boolean
    status: string
    reasons: string[]
    required: string[]
    inherited: string[]
    depended: string[]
}

export interface Audit {
    id: string
    action: string
    target: string
    count: number
    createdAt: string
}

export interface HealthIssue {
    type: string
    level: string
    target: string
    message: string
    action: string
}

export interface OpsAction {
    title: string
    level: string
    description: string
    steps: string[]
    target: string
}

export interface OpsErrorAnalysis {
    analyzedAt: string
    severity: string
    kind: string
    title: string
    confidence: string
    summary: string
    impact: string
    evidence: { label: string; value: string }[]
    actions: OpsAction[]
    related: {
        loadErrors: { table: string; message: string; at: string }[]
        issues: IntegrityIssue[]
        scanSummary: null | {
            total: number
            byTable: Record<string, number>
            byKind: Record<string, number>
            loadErrors: number
        }
    }
}

export interface OpsErrorRecord {
    id: string
    source: string
    level: string
    logger: string
    message: string
    createdAt: string
    analysis: OpsErrorAnalysis
}

export interface IntegrityIssue {
    id: string
    table: string
    recordId: string
    field: string
    kind: string
    severity: 'danger' | 'warning' | 'info'
    snippet: string
    suggestedFix: 'null-field' | 'remove-row' | 'manual'
    reason: string
    recommendation: string
    errorCode?: string
    canAutoFix: boolean
}

export interface ConfigGroup {
    title: string
    items: ConfigItem[]
}

export interface ConfigItem {
    key: string
    label: string
    type: string
    desc: string
    min?: number
    max?: number
    step?: number
    options?: string
}

export type Operation =
    | {
          type: 'model-migration'
          fromModel?: string
          targetModel: string
          status?: string
          includeArchived?: boolean
      }
    | {
          type: 'model-reference-migration'
          fromModel: string
          targetModel: string
          scopes: string[]
          includeArchived?: boolean
      }
    | {
          type: 'status-change'
          status?: string
          targetStatus: string
      }
    | {
          type: 'archive-record-cleanup'
      }
    | {
          type: 'message-repair'
          conversationId: string
      }
