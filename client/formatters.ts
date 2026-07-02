import type { ModelReference } from './types'

// Static lookup tables: status/role/health text and Element Plus tag
// types. Pulled out of page.vue so the SFC stays focused on layout +
// state, and so other modules (drawers, dialogs once split) can reuse
// them without duplicating the maps.

export function statusText(status: string) {
    if (status === 'active') return '活跃'
    if (status === 'archived') return '已归档'
    if (status === 'broken') return '已损坏'
    if (status === 'deleted') return '已删除'
    return status
}

export function statusType(status: string) {
    if (status === 'active') return 'success'
    if (status === 'archived') return 'info'
    if (status === 'broken') return 'danger'
    return 'warning'
}

export function roleText(role: string) {
    if (role === 'human') return '用户'
    if (role === 'ai') return '助手'
    if (role === 'system') return '系统'
    if (role === 'tool') return '工具'
    return role
}

export function roleType(role: string) {
    if (role === 'human') return 'primary'
    if (role === 'ai') return 'success'
    if (role === 'tool') return 'warning'
    return 'info'
}

export function providerStateText(state: string) {
    if (state === 'loaded') return '已加载'
    if (state === 'registered') return '已注册'
    return '仅数据库'
}

export function providerStateType(state: string) {
    if (state === 'loaded') return 'success'
    if (state === 'registered') return 'warning'
    return 'info'
}

export function capabilityText(name: string) {
    if (name === 'text_input') return '文本'
    if (name === 'tool_call') return '工具调用'
    if (name === 'image_input') return '图像输入'
    if (name === 'thinking') return '思考'
    if (name === 'image_generation') return '图像生成'
    if (name === 'audio_input') return '音频输入'
    if (name === 'video_input') return '视频输入'
    if (name === 'file_input') return '文件输入'
    return name
}

export function routeText(mode: string, scope: string) {
    if (mode === 'shared') return '共享群聊'
    if (mode === 'personal' && scope === 'direct') return '私聊个人'
    if (mode === 'personal') return '群内个人'
    if (mode === 'custom') return '自定义'
    return mode || scope || '-'
}

export function resourceTypeText(type: string) {
    if (type === 'tool') return '工具'
    if (type === 'chat-chain') return '聊天链'
    if (type === 'vector-store') return '向量库'
    if (type === 'preset') return '预设'
    if (type === 'default') return '默认配置'
    return type
}

export function issueTypeText(type: string) {
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

export function healthText(level: string) {
    if (level === 'danger') return '严重'
    if (level === 'warning') return '警告'
    return '提示'
}

export function healthType(level: string) {
    if (level === 'danger') return 'danger'
    if (level === 'warning') return 'warning'
    return 'info'
}

export function modelReferenceScopes(row: ModelReference) {
    if (row.kind === 'conversation') return ['conversation']
    if (row.kind === 'constraint' && row.field === 'defaultModel') {
        return ['constraint-default']
    }
    if (row.kind === 'constraint' && row.field === 'fixedModel') {
        return ['constraint-fixed']
    }
    return ['config-default']
}

export function activeText(level: string, risk: string) {
    if (risk === 'warning') return '需检查'
    if (risk === 'info') return '提示'
    if (level === 'active') return '活跃'
    if (level === 'quiet') return '低活跃'
    if (level === 'inactive') return '长期未用'
    return '未知'
}

export function activeType(level: string, risk: string) {
    if (risk === 'warning') return 'warning'
    if (risk === 'info') return 'info'
    if (level === 'active') return 'success'
    if (level === 'quiet') return 'info'
    if (level === 'inactive') return 'warning'
    return 'info'
}

export function shortTime(value: string) {
    if (!value) return '-'
    return value.replace('T', ' ').slice(0, 19)
}

