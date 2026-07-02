import type { ConfigGroup } from './types'

// Static descriptor for the ChatLuna config tab. Lives outside page.vue
// so we don't reparse 300+ lines of config metadata on every reload.

export const configGroups: ConfigGroup[] = [
    {
        title: 'Bot',
        items: [
            {
                key: 'botNames',
                label: 'botNames',
                type: 'array',
                desc: '第一个名称是实际 bot 名称，其余名称用于触发。'
            },
            {
                key: 'isNickname',
                label: 'isNickname',
                type: 'boolean',
                desc: '允许在开头匹配昵称触发。'
            },
            {
                key: 'isNickNameWithContent',
                label: 'isNickNameWithContent',
                type: 'boolean',
                desc: '允许在内容中任意匹配昵称触发。'
            }
        ]
    },
    {
        title: '触发',
        items: [
            {
                key: 'allowPrivate',
                label: 'allowPrivate',
                type: 'boolean',
                desc: '允许私聊触发。'
            },
            {
                key: 'allowAtReply',
                label: 'allowAtReply',
                type: 'boolean',
                desc: '允许 @ bot 触发。'
            },
            {
                key: 'allowQuoteReply',
                label: 'allowQuoteReply',
                type: 'boolean',
                desc: '允许引用 bot 消息触发。'
            },
            {
                key: 'privateChatWithoutCommand',
                label: 'privateChatWithoutCommand',
                type: 'boolean',
                desc: '私聊无需命令直接对话。'
            },
            {
                key: 'includeQuoteReply',
                label: 'includeQuoteReply',
                type: 'boolean',
                desc: '请求中包含被引用消息内容。'
            },
            {
                key: 'randomReplyFrequency',
                label: 'randomReplyFrequency',
                type: 'percent',
                min: 0,
                max: 1,
                step: 0.01,
                desc: '随机回复概率。'
            },
            {
                key: 'attachForwardMsgIdToContext',
                label: 'attachForwardMsgIdToContext',
                type: 'boolean',
                desc: '把合并转发记录 id 附加到上下文。'
            }
        ]
    },
    {
        title: '回复',
        items: [
            {
                key: 'sendThinkingMessage',
                label: 'sendThinkingMessage',
                type: 'boolean',
                desc: '模型响应前发送等待消息。'
            },
            {
                key: 'sendThinkingMessageTimeout',
                label: 'sendThinkingMessageTimeout',
                type: 'number',
                min: 0,
                desc: '等待消息延迟，单位毫秒。'
            },
            {
                key: 'msgCooldown',
                label: 'msgCooldown',
                type: 'number',
                min: 0,
                max: 3600,
                desc: '全局消息冷却，单位秒。'
            },
            {
                key: 'messageQueue',
                label: 'messageQueue',
                type: 'boolean',
                desc: '启用消息队列合并。'
            },
            {
                key: 'messageQueueDelay',
                label: 'messageQueueDelay',
                type: 'number',
                min: 0,
                max: 1800,
                desc: '队列延迟，单位秒。'
            },
            {
                key: 'showThoughtMessage',
                label: 'showThoughtMessage',
                type: 'boolean',
                desc: '显示思考过程。'
            }
        ]
    },
    {
        title: '渲染',
        items: [
            {
                key: 'outputMode',
                label: 'outputMode',
                type: 'select',
                options: 'outputModes',
                desc: '回复渲染输出模式。'
            },
            {
                key: 'splitMessage',
                label: 'splitMessage',
                type: 'boolean',
                desc: '把回复拆成多条消息。'
            },
            {
                key: 'censor',
                label: 'censor',
                type: 'boolean',
                desc: '启用 censor 服务。'
            },
            {
                key: 'rawOnCensor',
                label: 'rawOnCensor',
                type: 'boolean',
                desc: '审核触发时发送原始消息给模型。'
            },
            {
                key: 'streamResponse',
                label: 'streamResponse',
                type: 'boolean',
                desc: '启用流式响应。'
            }
        ]
    },
    {
        title: '历史',
        items: [
            {
                key: 'infiniteContext',
                label: 'infiniteContext',
                type: 'boolean',
                desc: '启用无限上下文压缩。'
            },
            {
                key: 'infiniteContextThreshold',
                label: 'infiniteContextThreshold',
                type: 'percent',
                min: 0.5,
                max: 0.95,
                step: 0.01,
                desc: '触发压缩的上下文阈值。'
            },
            {
                key: 'autoArchive',
                label: 'autoArchive',
                type: 'boolean',
                desc: '自动归档长期未用会话。'
            },
            {
                key: 'autoArchiveTimeout',
                label: 'autoArchiveTimeout',
                type: 'number',
                min: 3600,
                desc: '自动归档阈值，单位秒。'
            },
            {
                key: 'autoPurgeArchive',
                label: 'autoPurgeArchive',
                type: 'boolean',
                desc: '自动清理过期归档。'
            },
            {
                key: 'autoPurgeArchiveTimeout',
                label: 'autoPurgeArchiveTimeout',
                type: 'number',
                min: 3600,
                desc: '归档保留时间，单位秒。'
            }
        ]
    },
    {
        title: '默认模型',
        items: [
            {
                key: 'defaultModel',
                label: 'defaultModel',
                type: 'select',
                options: 'models',
                desc: '默认聊天模型。'
            },
            {
                key: 'defaultPreset',
                label: 'defaultPreset',
                type: 'select',
                options: 'presets',
                desc: '默认预设。'
            },
            {
                key: 'defaultChatMode',
                label: 'defaultChatMode',
                type: 'select',
                options: 'chatModes',
                desc: '默认聊天链。'
            },
            {
                key: 'defaultGroupRouteMode',
                label: 'defaultGroupRouteMode',
                type: 'select',
                options: 'routeModes',
                desc: '群聊默认共享或个人路由。'
            },
            {
                key: 'defaultEmbeddings',
                label: 'defaultEmbeddings',
                type: 'select',
                options: 'embeddings',
                desc: '默认嵌入模型。'
            },
            {
                key: 'defaultVectorStore',
                label: 'defaultVectorStore',
                type: 'select',
                options: 'vectorStores',
                desc: '默认向量库。'
            }
        ]
    },
    {
        title: '发送形式',
        items: [
            {
                key: 'isForwardMsg',
                label: 'isForwardMsg',
                type: 'boolean',
                desc: '用合并消息发送回复。'
            },
            {
                key: 'forwardMsgMinLength',
                label: 'forwardMsgMinLength',
                type: 'number',
                min: 0,
                max: 400,
                desc: '合并消息最小长度。'
            },
            {
                key: 'isReplyWithAt',
                label: 'isReplyWithAt',
                type: 'boolean',
                desc: '回复时引用原消息。'
            },
            {
                key: 'replyQuoteThreshold',
                label: 'replyQuoteThreshold',
                type: 'number',
                min: 0,
                max: 600,
                desc: '引用原消息的最小响应时长。'
            }
        ]
    },
    {
        title: '杂项',
        items: [
            {
                key: 'blackList',
                label: 'blackList',
                type: 'number',
                min: 0,
                max: 1,
                desc: '黑名单 computed 值，0/1。'
            },
            {
                key: 'voiceSpeakId',
                label: 'voiceSpeakId',
                type: 'number',
                min: 0,
                desc: 'vits 默认发音人。'
            },
            {
                key: 'isLog',
                label: 'isLog',
                type: 'boolean',
                desc: '启用 ChatLuna 调试日志。'
            },
            {
                key: 'isProxy',
                label: 'isProxy',
                type: 'boolean',
                desc: '启用 ChatLuna 网络代理。'
            },
            {
                key: 'proxyAddress',
                label: 'proxyAddress',
                type: 'text',
                desc: '代理地址。'
            }
        ]
    }
]
