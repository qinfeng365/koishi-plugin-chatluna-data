<template>
    <k-layout class="cl-data-page">
        <div class="shell" v-loading="loading">
            <header class="topbar">
                <div>
                    <div class="title-row">
                        <h1>ChatLuna 数据管理</h1>
                        <el-tag
                            v-if="overview.config.readonly"
                            type="warning"
                            effect="plain"
                        >
                            只读
                        </el-tag>
                    </div>
                    <p>ChatLuna 1.4 数据库管理台</p>
                </div>
                <div class="top-actions">
                    <el-button size="small" plain @click="goHome">
                        返回
                    </el-button>
                    <el-select
                        v-model="quick.model"
                        size="small"
                        filterable
                        clearable
                        placeholder="模型"
                    >
                        <el-option
                            v-for="item in modelChoices"
                            :key="item"
                            :label="item"
                            :value="item"
                        />
                    </el-select>
                    <el-button
                        :icon="Refresh"
                        size="small"
                        :loading="loading"
                        @click="refresh"
                    >
                        刷新
                    </el-button>
                </div>
            </header>

            <section class="metrics">
                <button
                    v-for="item in metricRows"
                    :key="item.key"
                    class="metric"
                    type="button"
                    @click="active = item.tab"
                >
                    <span>{{ item.label }}</span>
                    <strong>{{ item.value }}</strong>
                </button>
            </section>

            <el-tabs v-model="active" class="tabs">
                <el-tab-pane name="overview" label="概览">
                    <div class="grid two">
                        <section class="panel">
                            <div class="panel-head">
                                <h2>模型分布</h2>
                            </div>
                            <el-table :data="overview.models" height="280">
                                <el-table-column label="模型" min-width="260">
                                    <template #default="{ row }">
                                        <code>{{ row.model || '-' }}</code>
                                    </template>
                                </el-table-column>
                                <el-table-column
                                    prop="count"
                                    label="数量"
                                    width="120"
                                />
                            </el-table>
                        </section>
                        <section class="panel">
                            <div class="panel-head">
                                <h2>最近活动</h2>
                            </div>
                            <el-table
                                :data="overview.recent"
                                height="280"
                                @row-click="openConversation"
                            >
                                <el-table-column label="会话" min-width="280">
                                    <template #default="{ row }">
                                        <div class="stack">
                                            <strong>{{ row.title || '-' }}</strong>
                                            <code>{{ row.id }}</code>
                                        </div>
                                    </template>
                                </el-table-column>
                                <el-table-column label="状态" width="110">
                                    <template #default="{ row }">
                                        <el-tag
                                            :type="statusType(row.status)"
                                            size="small"
                                            effect="plain"
                                        >
                                            {{ statusText(row.status) }}
                                        </el-tag>
                                    </template>
                                </el-table-column>
                            </el-table>
                        </section>
                    </div>
                    <div class="grid two">
                        <section class="panel">
                            <div class="panel-head">
                                <h2>运行时</h2>
                                <el-tag
                                    :type="
                                        overview.runtime.connected
                                            ? 'success'
                                            : 'danger'
                                    "
                                    effect="plain"
                                >
                                    {{
                                        overview.runtime.connected
                                            ? 'ChatLuna 已连接'
                                            : 'ChatLuna 未加载'
                                    }}
                                </el-tag>
                            </div>
                            <div class="runtime-grid">
                                <div>
                                    <span>提供商</span>
                                    <strong>{{ overview.totals.providers }}</strong>
                                </div>
                                <div>
                                    <span>上下文</span>
                                    <strong>{{ overview.totals.contexts }}</strong>
                                </div>
                                <div>
                                    <span>实时模型</span>
                                    <strong>{{ overview.totals.liveModels }}</strong>
                                </div>
                                <div>
                                    <span>工具</span>
                                    <strong>{{ overview.runtime.tools }}</strong>
                                </div>
                                <div>
                                    <span>链</span>
                                    <strong>{{ overview.runtime.chatChains }}</strong>
                                </div>
                                <div>
                                    <span>向量库</span>
                                    <strong>{{ overview.runtime.vectorStores }}</strong>
                                </div>
                                <div>
                                    <span>预设</span>
                                    <strong>{{ overview.runtime.presets }}</strong>
                                </div>
                            </div>
                        </section>
                        <section class="panel">
                            <div class="panel-head">
                                <h2>提供商概览</h2>
                            </div>
                            <el-table
                                :data="overview.providers"
                                height="220"
                                @row-click="openProvider"
                            >
                                <el-table-column label="平台" min-width="180">
                                    <template #default="{ row }">
                                        <div class="stack">
                                            <strong>{{ row.platform }}</strong>
                                            <span>{{ providerStateText(row.state) }}</span>
                                        </div>
                                    </template>
                                </el-table-column>
                                <el-table-column
                                    prop="modelCount"
                                    label="模型"
                                    width="90"
                                />
                                <el-table-column
                                    prop="conversations"
                                    label="会话"
                                    width="90"
                                />
                            </el-table>
                        </section>
                    </div>
                    <section class="panel">
                        <div class="panel-head">
                            <h2>默认配置</h2>
                        </div>
                        <div class="defaults-grid">
                            <div>
                                <span>模型</span>
                                <code>{{ overview.runtime.defaults.model || '-' }}</code>
                            </div>
                            <div>
                                <span>预设</span>
                                <code>{{ overview.runtime.defaults.preset || '-' }}</code>
                            </div>
                            <div>
                                <span>聊天链</span>
                                <code>{{ overview.runtime.defaults.chatMode || '-' }}</code>
                            </div>
                            <div>
                                <span>嵌入</span>
                                <code>
                                    {{ overview.runtime.defaults.embeddings || '-' }}
                                </code>
                            </div>
                            <div>
                                <span>向量库</span>
                                <code>
                                    {{ overview.runtime.defaults.vectorStore || '-' }}
                                </code>
                            </div>
                            <div>
                                <span>群路由</span>
                                <code>
                                    {{ overview.runtime.defaults.groupRoute || '-' }}
                                </code>
                            </div>
                        </div>
                    </section>
                    <section class="panel">
                        <div class="panel-head">
                            <h2>Koishi 上下文</h2>
                        </div>
                        <el-table
                            :data="overview.contexts"
                            height="220"
                            @row-click="openContext"
                        >
                            <el-table-column label="路由" min-width="300">
                                <template #default="{ row }">
                                    <div class="stack">
                                        <code>{{ row.bindingKey }}</code>
                                        <span>
                                            {{ row.platform || '-' }} /
                                            {{ row.selfId || '-' }}
                                        </span>
                                    </div>
                                </template>
                            </el-table-column>
                            <el-table-column label="范围" width="120">
                                <template #default="{ row }">
                                    <el-tag effect="plain" size="small">
                                        {{ routeText(row.routeMode, row.scope) }}
                                    </el-tag>
                                </template>
                            </el-table-column>
                            <el-table-column label="Koishi 用户" min-width="180">
                                <template #default="{ row }">
                                    <span>{{ row.koishiUserName || row.userId || '-' }}</span>
                                </template>
                            </el-table-column>
                            <el-table-column
                                prop="conversations"
                                label="会话"
                                width="90"
                            />
                        </el-table>
                    </section>
                    <section class="panel">
                        <div class="panel-head">
                            <h2>链路诊断</h2>
                        </div>
                        <el-table :data="overview.issues" height="300">
                            <el-table-column label="会话" min-width="280">
                                <template #default="{ row }">
                                    <div class="stack">
                                        <strong>{{ row.title || '-' }}</strong>
                                        <code>{{ row.conversationId }}</code>
                                    </div>
                                </template>
                            </el-table-column>
                            <el-table-column label="异常" min-width="320">
                                <template #default="{ row }">
                                    <div class="tags">
                                        <el-tag
                                            v-for="item in row.issues"
                                            :key="item.type"
                                            type="danger"
                                            effect="plain"
                                            size="small"
                                        >
                                            {{ item.message }}
                                        </el-tag>
                                    </div>
                                </template>
                            </el-table-column>
                            <el-table-column
                                prop="messageCount"
                                label="消息"
                                width="110"
                            />
                            <el-table-column
                                prop="orphanCount"
                                label="孤儿"
                                width="100"
                            />
                        </el-table>
                    </section>
                </el-tab-pane>

                <el-tab-pane name="config" label="配置">
                    <section class="panel">
                        <div class="panel-head wrap">
                            <div>
                                <h2>ChatLuna 配置</h2>
                                <p>
                                    来源 {{ configState.runtime.source }} /
                                    {{
                                        configState.runtime.writable
                                            ? '可保存'
                                            : '只读'
                                    }}
                                </p>
                            </div>
                            <div class="filters">
                                <el-button
                                    :icon="Refresh"
                                    size="small"
                                    plain
                                    @click="loadConfig"
                                >
                                    重新读取
                                </el-button>
                                <el-button
                                    type="primary"
                                    size="small"
                                    :loading="saving"
                                    :disabled="
                                        overview.config.readonly ||
                                        !configState.runtime.writable
                                    "
                                    @click="saveConfig"
                                >
                                    保存配置
                                </el-button>
                            </div>
                        </div>
                        <el-alert
                            v-if="!configState.runtime.connected"
                            title="ChatLuna 服务未加载，只能读取默认结构。"
                            type="warning"
                            show-icon
                            :closable="false"
                        />
                        <el-form
                            class="config-form"
                            label-position="top"
                            :disabled="
                                overview.config.readonly ||
                                !configState.runtime.writable
                            "
                        >
                            <div class="config-grid">
                                <section
                                    v-for="group in configGroups"
                                    :key="group.title"
                                    class="config-section"
                                >
                                    <h3>{{ group.title }}</h3>
                                    <div class="config-fields">
                                        <el-form-item
                                            v-for="item in group.items"
                                            :key="item.key"
                                            :label="item.label"
                                        >
                                            <template v-if="item.type === 'boolean'">
                                                <el-switch
                                                    v-model="
                                                        configState.form[item.key]
                                                    "
                                                />
                                            </template>
                                            <template v-else-if="item.type === 'number'">
                                                <el-input-number
                                                    v-model="
                                                        configState.form[item.key]
                                                    "
                                                    class="wide"
                                                    :min="item.min"
                                                    :max="item.max"
                                                    :step="item.step ?? 1"
                                                />
                                            </template>
                                            <template v-else-if="item.type === 'percent'">
                                                <el-slider
                                                    v-model="
                                                        configState.form[item.key]
                                                    "
                                                    :min="item.min ?? 0"
                                                    :max="item.max ?? 1"
                                                    :step="item.step ?? 0.01"
                                                    show-input
                                                />
                                            </template>
                                            <template v-else-if="item.type === 'select'">
                                                <el-select
                                                    v-model="
                                                        configState.form[item.key]
                                                    "
                                                    allow-create
                                                    filterable
                                                    class="wide"
                                                >
                                                    <el-option
                                                        v-for="opt in configOptions(
                                                            item.options
                                                        )"
                                                        :key="opt"
                                                        :label="opt"
                                                        :value="opt"
                                                    />
                                                </el-select>
                                            </template>
                                            <template v-else-if="item.type === 'array'">
                                                <el-select
                                                    v-model="
                                                        configState.form[item.key]
                                                    "
                                                    multiple
                                                    allow-create
                                                    filterable
                                                    class="wide"
                                                />
                                            </template>
                                            <template v-else>
                                                <el-input
                                                    v-model="
                                                        configState.form[item.key]
                                                    "
                                                />
                                            </template>
                                            <p>{{ item.desc }}</p>
                                        </el-form-item>
                                    </div>
                                </section>
                            </div>
                        </el-form>
                    </section>
                </el-tab-pane>


                <el-tab-pane name="users" label="用户">
                    <section class="panel">
                        <div class="panel-head">
                            <h2>聚合用户</h2>
                            <el-input
                                v-model="users.query"
                                :prefix-icon="Search"
                                clearable
                                size="small"
                                placeholder="搜索用户 / 绑定"
                                @keydown.enter="loadUsers(1)"
                            />
                        </div>
                        <el-table
                            :data="users.rows"
                            row-class-name="clickable-row"
                            height="560"
                            @row-click="openUser"
                        >
                            <el-table-column label="User" min-width="260">
                                <template #default="{ row }">
                                    <div class="stack">
                                        <code>{{ row.userId }}</code>
                                        <span>{{ row.bindingKeys.length }} 个绑定</span>
                                    </div>
                                </template>
                            </el-table-column>
                            <el-table-column
                                prop="conversations"
                                label="会话"
                                width="140"
                            />
                            <el-table-column prop="active" label="活跃" width="90" />
                            <el-table-column
                                prop="archived"
                                label="归档"
                                width="100"
                            />
                            <el-table-column prop="acl" label="ACL" width="80" />
                            <el-table-column
                                prop="constraints"
                                label="规则"
                                width="80"
                            />
                            <el-table-column label="最近会话" min-width="260">
                                <template #default="{ row }">
                                    <div class="stack">
                                        <span>{{ row.latestTitle || '-' }}</span>
                                        <code>{{ row.latestConversationId }}</code>
                                    </div>
                                </template>
                            </el-table-column>
                            <el-table-column label="操作" width="150" fixed="right">
                                <template #default="{ row }">
                                    <el-button
                                        link
                                        type="primary"
                                        @click.stop="openUser(row)"
                                    >
                                        详情
                                    </el-button>
                                    <el-button
                                        link
                                        type="primary"
                                        @click.stop="filterUser(row)"
                                    >
                                        过滤
                                    </el-button>
                                </template>
                            </el-table-column>
                        </el-table>
                        <Pager :data="users" @change="loadUsers" />
                    </section>
                </el-tab-pane>

                <el-tab-pane name="conversations" label="会话">
                    <section class="panel">
                        <div class="panel-head wrap">
                            <h2>会话</h2>
                            <div class="filters">
                                <el-input
                                    v-model="convs.query"
                                    :prefix-icon="Search"
                                    clearable
                                    size="small"
                                    placeholder="搜索"
                                    @keydown.enter="loadConversations(1)"
                                />
                                <el-select
                                    v-model="convs.status"
                                    clearable
                                    size="small"
                                    placeholder="状态"
                                >
                                    <el-option label="active" value="active" />
                                    <el-option label="archived" value="archived" />
                                    <el-option label="broken" value="broken" />
                                    <el-option label="deleted" value="deleted" />
                                </el-select>
                                <el-select
                                    v-model="convs.model"
                                    clearable
                                    filterable
                                    size="small"
                                    placeholder="模型"
                                >
                                    <el-option
                                        v-for="item in modelChoices"
                                        :key="item"
                                        :label="item"
                                        :value="item"
                                    />
                                </el-select>
                                <el-button
                                    type="primary"
                                    plain
                                    size="small"
                                    @click="loadConversations(1)"
                                >
                                    筛选
                                </el-button>
                                <el-button
                                    :icon="Plus"
                                    :disabled="overview.config.readonly"
                                    size="small"
                                    type="primary"
                                    @click="newConversation"
                                >
                                    新建
                                </el-button>
                            </div>
                        </div>
                        <div class="table-note">
                            使用右侧操作打开详情或消息。点击行也会打开会话详情。
                        </div>
                        <el-table
                            :data="convs.rows"
                            row-class-name="clickable-row"
                            height="560"
                            @row-click="openConversation"
                        >
                            <el-table-column label="会话" min-width="310">
                                <template #default="{ row }">
                                    <div class="stack">
                                        <strong>{{ row.title || '-' }}</strong>
                                        <code>{{ row.id }}</code>
                                    </div>
                                </template>
                            </el-table-column>
                            <el-table-column label="创建者" min-width="180">
                                <template #default="{ row }">
                                    <code>{{ row.createdBy }}</code>
                                </template>
                            </el-table-column>
                            <el-table-column label="模型" min-width="220">
                                <template #default="{ row }">
                                    <code>{{ row.model }}</code>
                                </template>
                            </el-table-column>
                            <el-table-column label="预设" min-width="150">
                                <template #default="{ row }">
                                    <span>{{ row.preset || '-' }}</span>
                                </template>
                            </el-table-column>
                            <el-table-column label="状态" width="110">
                                <template #default="{ row }">
                                    <el-tag
                                        :type="statusType(row.status)"
                                        size="small"
                                        effect="plain"
                                    >
                                        {{ statusText(row.status) }}
                                    </el-tag>
                                </template>
                            </el-table-column>
                            <el-table-column label="更新时间" min-width="180">
                                <template #default="{ row }">
                                    {{ shortTime(row.updatedAt) }}
                                </template>
                            </el-table-column>
                            <el-table-column label="操作" width="180" fixed="right">
                                <template #default="{ row }">
                                    <el-button
                                        link
                                        type="primary"
                                        @click.stop="openConversation(row)"
                                    >
                                        打开
                                    </el-button>
                                    <el-button
                                        link
                                        type="primary"
                                        @click.stop="openConversationMessages(row)"
                                    >
                                        消息
                                    </el-button>
                                </template>
                            </el-table-column>
                        </el-table>
                        <Pager :data="convs" @change="loadConversations" />
                    </section>
                </el-tab-pane>

                <el-tab-pane name="messages" label="消息">
                    <section class="panel">
                        <div class="panel-head wrap">
                            <h2>聊天记录</h2>
                            <div class="filters">
                                <el-input
                                    v-model="messages.query"
                                    :prefix-icon="Search"
                                    clearable
                                    size="small"
                                    placeholder="搜索内容 / id / 会话"
                                    @keydown.enter="loadMessages(1)"
                                />
                                <el-input
                                    v-model="messages.conversationId"
                                    clearable
                                    size="small"
                                    placeholder="conversationId"
                                    @keydown.enter="loadMessages(1)"
                                />
                                <el-input
                                    v-model="messages.user"
                                    clearable
                                    size="small"
                                    placeholder="createdBy"
                                    @keydown.enter="loadMessages(1)"
                                />
                                <el-select
                                    v-model="messages.role"
                                    clearable
                                    size="small"
                                    placeholder="role"
                                >
                                    <el-option label="human" value="human" />
                                    <el-option label="ai" value="ai" />
                                    <el-option label="system" value="system" />
                                    <el-option label="tool" value="tool" />
                                </el-select>
                                <el-button
                                    type="primary"
                                    plain
                                    size="small"
                                    @click="loadMessages(1)"
                                >
                                    筛选
                                </el-button>
                            </div>
                        </div>
                        <div class="table-note">
                            使用右侧操作打开会话链或编辑消息。点击行会切换到对应会话。
                        </div>
                        <el-table
                            :data="messages.rows"
                            row-class-name="clickable-row"
                            height="360"
                            @row-click="openMessage"
                        >
                            <el-table-column label="消息" min-width="320">
                                <template #default="{ row }">
                                    <div class="stack">
                                        <strong>{{ row.text || '-' }}</strong>
                                        <code>{{ row.id }}</code>
                                    </div>
                                </template>
                            </el-table-column>
                            <el-table-column label="会话" min-width="260">
                                <template #default="{ row }">
                                    <div class="stack">
                                        <span>{{ row.title || '-' }}</span>
                                        <code>{{ row.conversationId }}</code>
                                    </div>
                                </template>
                            </el-table-column>
                            <el-table-column label="角色" width="100">
                                <template #default="{ row }">
                                    <el-tag
                                        :type="roleType(row.role)"
                                        size="small"
                                        effect="plain"
                                    >
                                        {{ roleText(row.role) }}
                                    </el-tag>
                                </template>
                            </el-table-column>
                            <el-table-column label="用户" min-width="160">
                                <template #default="{ row }">
                                    <code>{{ row.createdBy || '-' }}</code>
                                </template>
                            </el-table-column>
                            <el-table-column label="时间" min-width="180">
                                <template #default="{ row }">
                                    {{ shortTime(row.createdAt) }}
                                </template>
                            </el-table-column>
                            <el-table-column label="操作" width="180" fixed="right">
                                <template #default="{ row }">
                                    <el-button
                                        link
                                        type="primary"
                                        @click.stop="openMessage(row)"
                                    >
                                        会话
                                    </el-button>
                                    <el-button
                                        link
                                        type="primary"
                                        @click.stop="editMessage(row)"
                                    >
                                        编辑
                                    </el-button>
                                </template>
                            </el-table-column>
                        </el-table>
                        <Pager :data="messages" @change="loadMessages" />
                    </section>
                    <section class="panel split">
                        <div class="left-list">
                            <div class="panel-head wrap">
                                <h2>当前会话链</h2>
                                <div class="filters">
                                    <el-input
                                        v-model="messageId"
                                        clearable
                                        size="small"
                                        placeholder="conversationId"
                                        @keydown.enter="loadDetail(messageId)"
                                    />
                                    <el-button
                                        :icon="Plus"
                                        :disabled="
                                            overview.config.readonly ||
                                            !detail.conversation
                                        "
                                        size="small"
                                        type="primary"
                                        @click="editMessage()"
                                    >
                                        新增
                                    </el-button>
                                </div>
                            </div>
                            <el-empty
                                v-if="!detail.conversation"
                                description="请选择会话"
                            />
                            <el-scrollbar v-else class="message-list">
                                <article
                                    v-for="msg in detail.messages"
                                    :key="msg.id"
                                    class="message"
                                >
                                    <header>
                                        <div class="tags">
                                            <el-tag
                                                :type="roleType(msg.role)"
                                                size="small"
                                                effect="plain"
                                            >
                                                {{ roleText(msg.role) }}
                                            </el-tag>
                                            <time>{{ shortTime(msg.createdAt) }}</time>
                                        </div>
                                        <div class="message-actions">
                                            <el-button
                                                link
                                                type="primary"
                                                :disabled="overview.config.readonly"
                                                @click="editMessage(msg)"
                                            >
                                                编辑
                                            </el-button>
                                            <el-button
                                                link
                                                type="danger"
                                                :disabled="overview.config.readonly"
                                                @click="removeMessage(msg)"
                                            >
                                                删除
                                            </el-button>
                                        </div>
                                    </header>
                                    <dl>
                                        <dt>conversationId</dt>
                                        <dd><code>{{ msg.conversationId }}</code></dd>
                                        <dt>id</dt>
                                        <dd><code>{{ msg.id }}</code></dd>
                                        <dt>parentId</dt>
                                        <dd><code>{{ msg.parentId || '-' }}</code></dd>
                                        <dt>rawId</dt>
                                        <dd><code>{{ msg.rawId || '-' }}</code></dd>
                                    </dl>
                                    <pre>{{ msg.text }}</pre>
                                </article>
                            </el-scrollbar>
                        </div>
                        <aside class="side-detail">
                            <h2>链路诊断</h2>
                            <div v-if="detail.diagnostics" class="kv">
                                <span>latestMessageId</span>
                                <code>{{ detail.diagnostics.latestMessageId || '-' }}</code>
                                <span>messageCount</span>
                                <strong>{{ detail.diagnostics.messageCount }}</strong>
                                <span>chainCount</span>
                                <strong>{{ detail.diagnostics.chainCount }}</strong>
                                <span>orphanCount</span>
                                <strong>{{ detail.diagnostics.orphanCount }}</strong>
                            </div>
                            <div class="tags">
                                <el-tag
                                    v-for="item in detail.diagnostics?.issues || []"
                                    :key="item.type"
                                    type="danger"
                                    effect="plain"
                                >
                                    {{ item.message }}
                                </el-tag>
                            </div>
                            <el-button
                                v-if="detail.conversation"
                                :disabled="
                                    overview.config.readonly ||
                                    !overview.config.enableMessageRepair
                                "
                                type="warning"
                                plain
                                size="small"
                                @click="
                                    preview({
                                        type: 'message-repair',
                                        conversationId: detail.conversation.id
                                    })
                                "
                            >
                                预览修复
                            </el-button>
                        </aside>
                    </section>
                </el-tab-pane>

                <el-tab-pane name="permissions" label="权限">
                    <section class="panel">
                        <div class="panel-head wrap">
                            <h2>ACL</h2>
                            <div class="filters">
                                <el-input
                                    v-model="acl.query"
                                    :prefix-icon="Search"
                                    clearable
                                    size="small"
                                    placeholder="搜索 ACL"
                                    @keydown.enter="loadAcl(1)"
                                />
                                <el-button
                                    :icon="Plus"
                                    :disabled="overview.config.readonly"
                                    size="small"
                                    type="primary"
                                    @click="editAcl()"
                                >
                                    新建
                                </el-button>
                            </div>
                        </div>
                        <el-table :data="acl.rows" height="560">
                            <el-table-column label="conversationId" min-width="280">
                                <template #default="{ row }">
                                    <code>{{ row.conversationId }}</code>
                                </template>
                            </el-table-column>
                            <el-table-column
                                prop="principalType"
                                label="类型"
                                width="110"
                            />
                            <el-table-column label="principalId" min-width="220">
                                <template #default="{ row }">
                                    <code>{{ row.principalId }}</code>
                                </template>
                            </el-table-column>
                            <el-table-column
                                prop="permission"
                                label="权限"
                                width="130"
                            />
                            <el-table-column label="操作" width="150">
                                <template #default="{ row }">
                                    <el-button
                                        link
                                        type="primary"
                                        :disabled="overview.config.readonly"
                                        @click="editAcl(row)"
                                    >
                                        编辑
                                    </el-button>
                                    <el-button
                                        link
                                        type="danger"
                                        :disabled="overview.config.readonly"
                                        @click="removeAcl(row)"
                                    >
                                        删除
                                    </el-button>
                                </template>
                            </el-table-column>
                        </el-table>
                        <Pager :data="acl" @change="loadAcl" />
                    </section>
                </el-tab-pane>

                <el-tab-pane name="rules" label="规则">
                    <section class="panel">
                        <div class="panel-head wrap">
                            <h2>约束规则</h2>
                            <div class="filters">
                                <el-input
                                    v-model="rules.query"
                                    :prefix-icon="Search"
                                    clearable
                                    size="small"
                                    placeholder="搜索规则"
                                    @keydown.enter="loadRules(1)"
                                />
                                <el-button
                                    :icon="Plus"
                                    :disabled="overview.config.readonly"
                                    size="small"
                                    type="primary"
                                    @click="editRule()"
                                >
                                    新建
                                </el-button>
                            </div>
                        </div>
                        <el-table :data="rules.rows" height="560">
                            <el-table-column label="规则" min-width="260">
                                <template #default="{ row }">
                                    <div class="stack">
                                        <strong>{{ row.name }}</strong>
                                        <code>{{ row.id }}</code>
                                    </div>
                                </template>
                            </el-table-column>
                            <el-table-column
                                prop="priority"
                                label="优先级"
                                width="90"
                            />
                            <el-table-column label="路由" min-width="220">
                                <template #default="{ row }">
                                    <div class="stack">
                                        <span>{{ row.routeMode || '-' }}</span>
                                        <code>{{ row.routeKey || '-' }}</code>
                                    </div>
                                </template>
                            </el-table-column>
                            <el-table-column label="模型" min-width="240">
                                <template #default="{ row }">
                                    <div class="stack">
                                        <code>{{ row.fixedModel || '-' }}</code>
                                        <span>{{ row.defaultModel || '-' }}</span>
                                    </div>
                                </template>
                            </el-table-column>
                            <el-table-column label="标记" min-width="240">
                                <template #default="{ row }">
                                    <div class="tags">
                                        <el-tag
                                            v-if="row.enabled"
                                            type="success"
                                            effect="plain"
                                            size="small"
                                        >
                                            enabled
                                        </el-tag>
                                        <el-tag
                                            v-if="row.lockConversation"
                                            type="warning"
                                            effect="plain"
                                            size="small"
                                        >
                                            locked
                                        </el-tag>
                                        <el-tag
                                            v-if="row.allowArchive"
                                            effect="plain"
                                            size="small"
                                        >
                                            archive
                                        </el-tag>
                                        <el-tag
                                            v-if="row.allowExport"
                                            effect="plain"
                                            size="small"
                                        >
                                            export
                                        </el-tag>
                                    </div>
                                </template>
                            </el-table-column>
                            <el-table-column label="操作" width="150">
                                <template #default="{ row }">
                                    <el-button
                                        link
                                        type="primary"
                                        :disabled="overview.config.readonly"
                                        @click="editRule(row)"
                                    >
                                        编辑
                                    </el-button>
                                    <el-button
                                        link
                                        type="danger"
                                        :disabled="overview.config.readonly"
                                        @click="removeRule(row)"
                                    >
                                        删除
                                    </el-button>
                                </template>
                            </el-table-column>
                        </el-table>
                        <Pager :data="rules" @change="loadRules" />
                    </section>
                </el-tab-pane>

                <el-tab-pane name="advanced" label="高级">
                    <el-tabs v-model="advanced" class="inner-tabs">
                        <el-tab-pane name="providers" label="提供商">
                            <section class="panel">
                                <div class="panel-head wrap">
                                    <h2>适配器 / Provider</h2>
                                    <div class="filters">
                                        <el-input
                                            v-model="providers.query"
                                            :prefix-icon="Search"
                                            clearable
                                            size="small"
                                            placeholder="搜索平台 / 模型 / 能力"
                                            @keydown.enter="loadProviders(1)"
                                        />
                                        <el-button
                                            type="primary"
                                            plain
                                            size="small"
                                            @click="loadProviders(1)"
                                        >
                                            筛选
                                        </el-button>
                                    </div>
                                </div>
                                <el-table
                                    :data="providers.rows"
                                    height="560"
                                    row-class-name="clickable-row"
                                    @row-click="openProvider"
                                >
                                    <el-table-column label="平台" min-width="220">
                                        <template #default="{ row }">
                                            <div class="stack">
                                                <strong>{{ row.platform }}</strong>
                                                <div class="tags">
                                                    <el-tag
                                                        :type="
                                                            providerStateType(
                                                                row.state
                                                            )
                                                        "
                                                        effect="plain"
                                                        size="small"
                                                    >
                                                        {{
                                                            providerStateText(
                                                                row.state
                                                            )
                                                        }}
                                                    </el-tag>
                                                    <el-tag
                                                        v-if="row.pluginInstalled"
                                                        effect="plain"
                                                        size="small"
                                                    >
                                                        plugin
                                                    </el-tag>
                                                </div>
                                            </div>
                                        </template>
                                    </el-table-column>
                                    <el-table-column label="模型" min-width="220">
                                        <template #default="{ row }">
                                            <div class="provider-counts">
                                                <span>LLM {{ row.llmCount }}</span>
                                                <span>嵌入 {{ row.embeddingsCount }}</span>
                                                <span>重排 {{ row.rerankerCount }}</span>
                                            </div>
                                        </template>
                                    </el-table-column>
                                    <el-table-column label="配置" width="130">
                                        <template #default="{ row }">
                                            {{ row.availableConfigCount }} /
                                            {{ row.configCount }}
                                        </template>
                                    </el-table-column>
                                    <el-table-column label="能力" min-width="260">
                                        <template #default="{ row }">
                                            <div class="tags">
                                                <el-tag
                                                    v-for="item in row.capabilities.slice(0, 4)"
                                                    :key="item"
                                                    effect="plain"
                                                    size="small"
                                                >
                                                    {{ capabilityText(item) }}
                                                </el-tag>
                                            </div>
                                        </template>
                                    </el-table-column>
                                    <el-table-column
                                        prop="conversations"
                                        label="会话"
                                        width="100"
                                    />
                                    <el-table-column label="操作" width="100">
                                        <template #default="{ row }">
                                            <el-button
                                                link
                                                type="primary"
                                                @click.stop="openProvider(row)"
                                            >
                                                详情
                                            </el-button>
                                        </template>
                                    </el-table-column>
                                </el-table>
                                <Pager :data="providers" @change="loadProviders" />
                            </section>
                        </el-tab-pane>

                        <el-tab-pane name="resources" label="资源">
                            <section class="panel">
                                <div class="panel-head wrap">
                                    <h2>运行时资源</h2>
                                    <div class="filters">
                                        <el-input
                                            v-model="resources.query"
                                            :prefix-icon="Search"
                                            clearable
                                            size="small"
                                            placeholder="搜索工具 / 链 / 向量库 / 预设"
                                            @keydown.enter="loadResources(1)"
                                        />
                                        <el-button
                                            type="primary"
                                            plain
                                            size="small"
                                            @click="loadResources(1)"
                                        >
                                            筛选
                                        </el-button>
                                    </div>
                                </div>
                                <el-table
                                    :data="resources.rows"
                                    height="560"
                                    row-class-name="clickable-row"
                                    @row-click="openResource"
                                >
                                    <el-table-column label="资源" min-width="260">
                                        <template #default="{ row }">
                                            <div class="stack">
                                                <strong>{{ row.name || '-' }}</strong>
                                                <code>{{ row.path || row.source || '-' }}</code>
                                            </div>
                                        </template>
                                    </el-table-column>
                                    <el-table-column label="类型" width="130">
                                        <template #default="{ row }">
                                            <el-tag effect="plain" size="small">
                                                {{ resourceTypeText(row.type) }}
                                            </el-tag>
                                        </template>
                                    </el-table-column>
                                    <el-table-column label="引用" width="150">
                                        <template #default="{ row }">
                                            会话 {{ row.usedByConversations }} /
                                            规则 {{ row.usedByRules }}
                                        </template>
                                    </el-table-column>
                                    <el-table-column label="标签" min-width="240">
                                        <template #default="{ row }">
                                            <div class="tags">
                                                <el-tag
                                                    v-for="item in row.tags.slice(0, 4)"
                                                    :key="item"
                                                    effect="plain"
                                                    size="small"
                                                >
        {{ item }}
    </el-tag>
</div>

                                        </template>
                                    </el-table-column>
                                </el-table>
                                <Pager :data="resources" @change="loadResources" />
                            </section>
                        </el-tab-pane>

                        <el-tab-pane name="contexts" label="上下文">
                            <section class="panel">
                                <div class="panel-head wrap">
                                    <h2>Koishi / ChatLuna 上下文</h2>
                                    <div class="filters">
                                        <el-input
                                            v-model="contexts.query"
                                            :prefix-icon="Search"
                                            clearable
                                            size="small"
                                            placeholder="搜索平台 / 群 / 用户 / bindingKey"
                                            @keydown.enter="loadContexts(1)"
                                        />
                                        <el-button
                                            type="primary"
                                            plain
                                            size="small"
                                            @click="loadContexts(1)"
                                        >
                                            筛选
                                        </el-button>
                                    </div>
                                </div>
                                <el-table
                                    :data="contexts.rows"
                                    height="560"
                                    row-class-name="clickable-row"
                                    @row-click="openContext"
                                >
                                    <el-table-column label="bindingKey" min-width="340">
                                        <template #default="{ row }">
                                            <div class="stack">
                                                <code>{{ row.bindingKey }}</code>
                                                <span>{{ row.baseKey }}</span>
                                            </div>
                                        </template>
                                    </el-table-column>
                                    <el-table-column label="Koishi" min-width="240">
                                        <template #default="{ row }">
                                            <div class="stack">
                                                <span>
                                                    {{ row.platform || '-' }} /
                                                    {{ row.selfId || '-' }}
                                                </span>
                                                <code>
                                                    {{
                                                        row.guildId ||
                                                        row.userId ||
                                                        row.scope ||
                                                        '-'
                                                    }}
                                                </code>
                                            </div>
                                        </template>
                                    </el-table-column>
                                    <el-table-column label="路由" width="120">
                                        <template #default="{ row }">
                                            <el-tag effect="plain" size="small">
                                                {{ routeText(row.routeMode, row.scope) }}
                                            </el-tag>
                                        </template>
                                    </el-table-column>
                                    <el-table-column
                                        prop="conversations"
                                        label="会话"
                                        width="90"
                                    />
                                    <el-table-column prop="active" label="活跃" width="90" />
                                </el-table>
                                <Pager :data="contexts" @change="loadContexts" />
                            </section>
                        </el-tab-pane>

                        <el-tab-pane name="archives" label="归档">
                            <section class="panel">
                                <div class="panel-head wrap">
                                    <h2>归档</h2>
                                    <el-input
                                        v-model="archives.query"
                                        :prefix-icon="Search"
                                        clearable
                                        size="small"
                                        placeholder="搜索归档"
                                        @keydown.enter="loadArchives(1)"
                                    />
                                </div>
                                <el-table :data="archives.rows" height="560">
                                    <el-table-column label="归档" min-width="260">
                                        <template #default="{ row }">
                                            <div class="stack">
                                                <code>{{ row.id }}</code>
                                                <span>{{ row.state }}</span>
                                            </div>
                                        </template>
                                    </el-table-column>
                                    <el-table-column label="会话" min-width="260">
                                        <template #default="{ row }">
                                            <code>{{ row.conversationId }}</code>
                                        </template>
                                    </el-table-column>
                                    <el-table-column label="文件" min-width="300">
                                        <template #default="{ row }">
                                            <div class="stack">
                                                <code>{{ row.path }}</code>
                                                <el-tag
                                                    :type="
                                                        row.fileState === 'missing'
                                                            ? 'danger'
                                                            : row.fileState === 'ok'
                                                              ? 'success'
                                                              : 'info'
                                                    "
                                                    effect="plain"
                                                    size="small"
                                                >
                                                    {{ row.fileState }}
                                                </el-tag>
                                            </div>
                                        </template>
                                    </el-table-column>
                                    <el-table-column
                                        prop="messageCount"
                                        label="消息"
                                        width="110"
                                    />
                                </el-table>
                                <Pager :data="archives" @change="loadArchives" />
                            </section>
                        </el-tab-pane>

                        <el-tab-pane name="operations" label="操作">
                            <section class="panel operations">
                                <div class="panel-head">
                                    <h2>批量操作</h2>
                                </div>
                                <div class="operation-grid">
                                    <div class="op-block">
                                        <h3>模型迁移</h3>
                                        <el-select
                                            v-model="op.fromModel"
                                            clearable
                                            filterable
                                            placeholder="来源模型"
                                        >
                                            <el-option
                                                v-for="item in usedModels"
                                                :key="item"
                                                :label="item"
                                                :value="item"
                                            />
                                        </el-select>
                                        <el-select
                                            v-model="op.targetModel"
                                            allow-create
                                            filterable
                                            placeholder="目标模型"
                                        >
                                            <el-option
                                                v-for="item in modelChoices"
                                                :key="item"
                                                :label="item"
                                                :value="item"
                                            />
                                        </el-select>
                                        <el-select
                                            v-model="op.status"
                                            clearable
                                            placeholder="状态"
                                        >
                                            <el-option label="active" value="active" />
                                            <el-option label="archived" value="archived" />
                                            <el-option label="broken" value="broken" />
                                            <el-option label="deleted" value="deleted" />
                                        </el-select>
                                        <el-checkbox v-model="op.includeArchived">
                                            包含归档会话
                                        </el-checkbox>
                                        <el-button
                                            type="primary"
                                            :disabled="
                                                overview.config.readonly ||
                                                !op.targetModel
                                            "
                                            @click="
                                                preview({
                                                    type: 'model-migration',
                                                    fromModel: op.fromModel,
                                                    targetModel: op.targetModel,
                                                    status: op.status,
                                                    includeArchived: op.includeArchived
                                                })
                                            "
                                        >
                                            预览
                                        </el-button>
                                    </div>
                                    <div class="op-block">
                                        <h3>状态变更</h3>
                                        <el-select
                                            v-model="op.statusFrom"
                                            clearable
                                            placeholder="当前状态"
                                        >
                                            <el-option label="active" value="active" />
                                            <el-option label="archived" value="archived" />
                                            <el-option label="broken" value="broken" />
                                            <el-option label="deleted" value="deleted" />
                                        </el-select>
                                        <el-select
                                            v-model="op.targetStatus"
                                            placeholder="目标状态"
                                        >
                                            <el-option label="active" value="active" />
                                            <el-option label="archived" value="archived" />
                                            <el-option label="broken" value="broken" />
                                            <el-option label="deleted" value="deleted" />
                                        </el-select>
                                        <el-button
                                            type="warning"
                                            :disabled="
                                                overview.config.readonly ||
                                                !op.targetStatus
                                            "
                                            @click="
                                                preview({
                                                    type: 'status-change',
                                                    status: op.statusFrom,
                                                    targetStatus: op.targetStatus
                                                })
                                            "
                                        >
                                            预览
                                        </el-button>
                                    </div>
                                    <div class="op-block">
                                        <h3>归档清理</h3>
                                        <p>删除归档文件已缺失的 archive 表记录。</p>
                                        <el-button
                                            type="danger"
                                            plain
                                            :disabled="
                                                overview.config.readonly ||
                                                !overview.config.enableArchiveFileOps
                                            "
                                            @click="
                                                preview({
                                                    type: 'archive-record-cleanup'
                                                })
                                            "
                                        >
                                            预览
                                        </el-button>
                                    </div>
                                </div>
                            </section>
                        </el-tab-pane>

                        <el-tab-pane name="health" label="健康">
                            <section class="panel">
                                <div class="panel-head">
                                    <h2>系统健康</h2>
                                    <el-button
                                        :icon="Refresh"
                                        size="small"
                                        plain
                                        @click="loadHealth"
                                    >
                                        检查
                                    </el-button>
                                </div>
                                <div class="health-strip">
                                    <div>
                                        <span>评分</span>
                                        <strong>{{ health.score }}</strong>
                                    </div>
                                    <div>
                                        <span>严重</span>
                                        <strong>{{ health.totals.danger }}</strong>
                                    </div>
                                    <div>
                                        <span>警告</span>
                                        <strong>{{ health.totals.warning }}</strong>
                                    </div>
                                    <div>
                                        <span>提示</span>
                                        <strong>{{ health.totals.info }}</strong>
                                    </div>
                                </div>
                                <el-table :data="health.rows" height="520">
                                    <el-table-column label="级别" width="100">
                                        <template #default="{ row }">
                                            <el-tag
                                                :type="healthType(row.level)"
                                                effect="plain"
                                                size="small"
                                            >
                                                {{ healthText(row.level) }}
                                            </el-tag>
                                        </template>
                                    </el-table-column>
                                    <el-table-column label="类型" width="180">
                                        <template #default="{ row }">
                                            <code>{{ row.type }}</code>
                                        </template>
                                    </el-table-column>
                                    <el-table-column label="目标" min-width="220">
                                        <template #default="{ row }">
                                            <code>{{ row.target }}</code>
                                        </template>
                                    </el-table-column>
                                    <el-table-column
                                        prop="message"
                                        label="问题"
                                        min-width="320"
                                    />
                                    <el-table-column
                                        prop="action"
                                        label="建议"
                                        min-width="300"
                                    />
                                </el-table>
                            </section>
                        </el-tab-pane>

                        <el-tab-pane name="audit" label="审计">
                            <section class="panel">
                                <div class="panel-head">
                                    <h2>最近操作</h2>
                                    <el-tag effect="plain">数据库持久化</el-tag>
                                </div>
                                <el-table :data="overview.audits" height="560">
                                    <el-table-column
                                        prop="createdAt"
                                        label="时间"
                                        min-width="180"
                                    />
                                    <el-table-column
                                        prop="action"
                                        label="操作"
                                        min-width="220"
                                    />
                                    <el-table-column
                                        prop="target"
                                        label="目标"
                                        min-width="220"
                                    />
                                    <el-table-column prop="count" label="数量" width="90" />
                                </el-table>
                            </section>
                        </el-tab-pane>
                    </el-tabs>
                </el-tab-pane>
            </el-tabs>
        </div>

        <el-drawer
            v-model="drawer"
            size="560px"
            :title="detail.conversation?.title || '会话'"
        >
            <template v-if="detail.conversation">
                <el-form
                    class="edit-form"
                    label-position="top"
                    :disabled="overview.config.readonly"
                >
                    <el-form-item label="title">
                        <el-input v-model="edit.title" />
                    </el-form-item>
                    <el-form-item label="model">
                        <el-select
                            v-model="edit.model"
                            allow-create
                            filterable
                            class="wide"
                        >
                            <el-option
                                v-for="item in modelChoices"
                                :key="item"
                                :label="item"
                                :value="item"
                            />
                        </el-select>
                    </el-form-item>
                    <div class="form-grid">
                        <el-form-item label="preset">
                            <el-input v-model="edit.preset" />
                        </el-form-item>
                        <el-form-item label="chatMode">
                            <el-input v-model="edit.chatMode" />
                        </el-form-item>
                    </div>
                    <el-form-item label="status">
                        <el-select v-model="edit.status" class="wide">
                            <el-option label="active" value="active" />
                            <el-option label="archived" value="archived" />
                            <el-option label="broken" value="broken" />
                            <el-option label="deleted" value="deleted" />
                        </el-select>
                    </el-form-item>
                    <el-form-item label="latestMessageId">
                        <el-input v-model="edit.latestMessageId" />
                    </el-form-item>
                    <div class="drawer-actions">
                        <el-button
                            type="primary"
                            :disabled="overview.config.readonly"
                            @click="saveConversation"
                        >
                            保存
                        </el-button>
                        <el-button
                            type="danger"
                            plain
                            :disabled="overview.config.readonly"
                            @click="removeConversation"
                        >
                            删除会话
                        </el-button>
                    </div>
                </el-form>
                <el-divider />
                <div class="drawer-actions">
                    <el-button
                        type="primary"
                        plain
                        :disabled="overview.config.readonly"
                        @click="openAssign(detail.conversation)"
                    >
                        分配会话
                    </el-button>
                </div>
                <el-divider />
                <div class="kv">
                    <span>id</span>
                    <code>{{ detail.conversation.id }}</code>
                    <span>createdBy</span>
                    <code>{{ detail.conversation.createdBy }}</code>
                    <span>bindingKey</span>
                    <code>{{ detail.conversation.bindingKey }}</code>
                    <span>archiveId</span>
                    <code>{{ detail.conversation.archiveId || '-' }}</code>
                </div>
                <el-divider />
                <h2>路由可见性</h2>
                <div class="kv">
                    <span>路由</span>
                    <strong>
                        {{
                            detail.route
                                ? routeText(detail.route.routeMode, detail.route.scope)
                                : '-'
                        }}
                    </strong>
                    <span>平台</span>
                    <code>{{ detail.route?.platform || '-' }}</code>
                    <span>群/频道</span>
                    <code>{{ detail.route?.guildId || '-' }}</code>
                    <span>用户</span>
                    <code>{{ detail.route?.userId || detail.conversation.createdBy }}</code>
                </div>
                <el-alert
                    class="inline-alert"
                    type="info"
                    show-icon
                    :closable="false"
                    title="ChatLuna list 只显示当前上下文 bindingKey 下的会话；跨路由会话需要 ACL 授权，或把目标 binding 指向该会话。"
                />
                <el-divider />
                <h2>当前路由绑定</h2>
                <el-form
                    class="edit-form"
                    label-position="top"
                    :disabled="overview.config.readonly"
                >
                    <el-form-item label="bindingKey">
                        <el-input v-model="bindingBox.row.bindingKey" />
                    </el-form-item>
                    <div class="form-grid">
                        <el-form-item label="activeConversationId">
                            <el-input
                                v-model="bindingBox.row.activeConversationId"
                            />
                        </el-form-item>
                        <el-form-item label="lastConversationId">
                            <el-input
                                v-model="bindingBox.row.lastConversationId"
                            />
                        </el-form-item>
                    </div>
                    <div class="drawer-actions">
                        <el-button
                            type="primary"
                            :disabled="overview.config.readonly"
                            @click="saveBinding"
                        >
                            保存绑定
                        </el-button>
                        <el-button
                            type="danger"
                            plain
                            :disabled="
                                overview.config.readonly ||
                                !bindingBox.row.bindingKey
                            "
                            @click="removeBinding"
                        >
                            删除绑定
                        </el-button>
                    </div>
                </el-form>
                <template v-if="detail.bindingRefs.length">
                    <el-divider />
                    <h2>被其他 binding 引用</h2>
                    <el-table :data="detail.bindingRefs" height="180">
                        <el-table-column label="bindingKey" min-width="280">
                            <template #default="{ row }">
                                <code>{{ row.bindingKey }}</code>
                            </template>
                        </el-table-column>
                        <el-table-column
                            prop="activeConversationId"
                            label="active"
                            min-width="180"
                        />
                        <el-table-column
                            prop="lastConversationId"
                            label="last"
                            min-width="180"
                        />
                    </el-table>
                </template>
                <el-divider />
                <h2>授权用户 / 群</h2>
                <el-table :data="detail.acl" height="180">
                    <el-table-column prop="principalType" label="类型" width="90" />
                    <el-table-column prop="principalId" label="目标" />
                    <el-table-column prop="permission" label="权限" width="90" />
                </el-table>
            </template>
        </el-drawer>

        <el-drawer
            v-model="providerDrawer"
            size="720px"
            :title="providerDetail.provider?.platform || '提供商'"
        >
            <template v-if="providerDetail.provider">
                <div class="drawer-head">
                    <div class="tags">
                        <el-tag
                            :type="
                                providerStateType(providerDetail.provider.state)
                            "
                            effect="plain"
                        >
                            {{ providerStateText(providerDetail.provider.state) }}
                        </el-tag>
                        <el-tag effect="plain">
                            {{ providerDetail.provider.modelCount }} 模型
                        </el-tag>
                        <el-tag effect="plain">
                            {{ providerDetail.provider.conversations }} 会话
                        </el-tag>
                    </div>
                    <el-button
                        :icon="Refresh"
                        :disabled="
                            overview.config.readonly ||
                            !providerDetail.provider.registered
                        "
                        :loading="saving"
                        size="small"
                        type="primary"
                        plain
                        @click="refreshProvider"
                    >
                        刷新模型
                    </el-button>
                </div>
                <div class="kv provider-kv">
                    <span>配置</span>
                    <strong>
                        {{ providerDetail.provider.availableConfigCount }} /
                        {{ providerDetail.provider.configCount }}
                    </strong>
                    <span>Token</span>
                    <strong>
                        {{ providerDetail.provider.maxTokensMin || '-' }} -
                        {{ providerDetail.provider.maxTokensMax || '-' }}
                    </strong>
                    <span>文件</span>
                    <strong>
                        {{
                            providerDetail.provider.fileHandling
                                ? '支持'
                                : '未声明'
                        }}
                    </strong>
                    <span>MIME</span>
                    <code>
                        {{
                            providerDetail.provider.fileHandling
                                ?.supportedMimeTypes.join(', ') || '-'
                        }}
                    </code>
                </div>
                <el-divider />
                <h2>模型</h2>
                <el-table :data="providerDetail.provider.models" height="300">
                    <el-table-column label="名称" min-width="220">
                        <template #default="{ row }">
                            <code>{{ row.name }}</code>
                        </template>
                    </el-table-column>
                    <el-table-column prop="typeText" label="类型" width="90" />
                    <el-table-column
                        prop="maxTokens"
                        label="Tokens"
                        width="120"
                    />
                    <el-table-column label="能力" min-width="240">
                        <template #default="{ row }">
                            <div class="tags">
                                <el-tag
                                    v-for="item in row.capabilities"
                                    :key="item"
                                    effect="plain"
                                    size="small"
                                >
                                    {{ capabilityText(item) }}
                                </el-tag>
                            </div>
                        </template>
                    </el-table-column>
                </el-table>
                <el-divider />
                <div class="grid two drawer-grid">
                    <section>
                        <h2>相关会话</h2>
                        <el-table
                            :data="providerDetail.provider.recent"
                            height="220"
                            @row-click="openConversation"
                        >
                            <el-table-column label="会话" min-width="220">
                                <template #default="{ row }">
                                    <div class="stack">
                                        <strong>{{ row.title || '-' }}</strong>
                                        <code>{{ row.id }}</code>
                                    </div>
                                </template>
                            </el-table-column>
                        </el-table>
                    </section>
                    <section>
                        <h2>运行时扩展</h2>
                        <div class="runtime-list">
                            <span>工具 {{ providerDetail.tools.length }}</span>
                            <span>链 {{ providerDetail.chatChains.length }}</span>
                            <span>向量库 {{ providerDetail.vectorStores.length }}</span>
                        </div>
                        <div class="tags runtime-tags">
                            <el-tag
                                v-for="item in providerDetail.vectorStores"
                                :key="item"
                                effect="plain"
                                size="small"
                            >
                                {{ item }}
                            </el-tag>
                        </div>
                    </section>
                </div>
            </template>
        </el-drawer>

        <el-drawer
            v-model="userDrawer"
            size="760px"
            :title="userDetail.user?.userId || '用户'"
        >
            <template v-if="userDetail.user">
                <div class="tags warn">
                    <el-tag effect="plain">
                        会话 {{ userDetail.user.conversations }}
                    </el-tag>
                    <el-tag effect="plain">
                        活跃 {{ userDetail.user.active }}
                    </el-tag>
                    <el-tag effect="plain">
                        归档 {{ userDetail.user.archived }}
                    </el-tag>
                    <el-tag effect="plain">ACL {{ userDetail.acl.length }}</el-tag>
                    <el-tag effect="plain">
                        规则 {{ userDetail.constraints.length }}
                    </el-tag>
                    <el-button
                        size="small"
                        type="primary"
                        plain
                        @click="filterUser(userDetail.user)"
                    >
                        过滤会话和消息
                    </el-button>
                    <el-button
                        size="small"
                        type="success"
                        plain
                        :disabled="overview.config.readonly"
                        @click="openAssign()"
                    >
                        给用户分配会话
                    </el-button>
                </div>
                <div class="kv">
                    <span>userId</span>
                    <code>{{ userDetail.user.userId }}</code>
                    <span>最新会话</span>
                    <code>{{ userDetail.user.latestConversationId || '-' }}</code>
                    <span>Koishi 用户</span>
                    <strong>
                        {{
                            userDetail.koishiUsers
                                .map((row) => row.name || row.id)
                                .join(', ') || '-'
                        }}
                    </strong>
                    <span>Koishi 绑定</span>
                    <strong>{{ userDetail.koishiBindings.length }}</strong>
                </div>
                <el-divider />
                <h2>模型分布</h2>
                <div class="tags runtime-tags">
                    <el-tag
                        v-for="(count, model) in userDetail.user.models"
                        :key="model"
                        effect="plain"
                    >
                        {{ model }}: {{ count }}
                    </el-tag>
                </div>
                <el-collapse class="advanced-box">
                    <el-collapse-item title="用户批量维护" name="ops">
                        <div class="user-ops">
                            <el-select
                                v-model="op.userTargetModel"
                                allow-create
                                filterable
                                clearable
                                placeholder="迁移到模型"
                            >
                                <el-option
                                    v-for="item in modelChoices"
                                    :key="item"
                                    :label="item"
                                    :value="item"
                                />
                            </el-select>
                            <el-button
                                type="primary"
                                plain
                                :disabled="
                                    overview.config.readonly ||
                                    !op.userTargetModel
                                "
                                @click="
                                    preview({
                                        type: 'model-migration',
                                        user: userDetail.user.userId,
                                        targetModel: op.userTargetModel,
                                        includeArchived: true
                                    })
                                "
                            >
                                预览模型迁移
                            </el-button>
                            <el-select
                                v-model="op.userTargetStatus"
                                clearable
                                placeholder="目标状态"
                            >
                                <el-option label="active" value="active" />
                                <el-option label="archived" value="archived" />
                                <el-option label="broken" value="broken" />
                                <el-option label="deleted" value="deleted" />
                            </el-select>
                            <el-button
                                type="warning"
                                plain
                                :disabled="
                                    overview.config.readonly ||
                                    !op.userTargetStatus
                                "
                                @click="
                                    preview({
                                        type: 'status-change',
                                        user: userDetail.user.userId,
                                        targetStatus: op.userTargetStatus
                                    })
                                "
                            >
                                预览状态变更
                            </el-button>
                        </div>
                    </el-collapse-item>
                </el-collapse>
                <el-divider />
                <h2>关联会话</h2>
                <el-table
                    :data="userDetail.conversations"
                    height="240"
                    @row-click="openConversation"
                >
                    <el-table-column label="会话" min-width="260">
                        <template #default="{ row }">
                            <div class="stack">
                                <strong>{{ row.title || '-' }}</strong>
                                <code>{{ row.id }}</code>
                            </div>
                        </template>
                    </el-table-column>
                    <el-table-column label="模型" min-width="220">
                        <template #default="{ row }">
                            <code>{{ row.model }}</code>
                        </template>
                    </el-table-column>
                    <el-table-column label="状态" width="110">
                        <template #default="{ row }">
                            <el-tag
                                :type="statusType(row.status)"
                                effect="plain"
                                size="small"
                            >
                                {{ statusText(row.status) }}
                            </el-tag>
                        </template>
                    </el-table-column>
                    <el-table-column label="操作" width="100">
                        <template #default="{ row }">
                            <el-button
                                size="small"
                                text
                                :disabled="overview.config.readonly"
                                @click.stop="openAssign(row)"
                            >
                                分配
                            </el-button>
                        </template>
                    </el-table-column>
                </el-table>
                <el-divider />
                <h2>上下文 / 绑定</h2>
                <el-table :data="userDetail.contexts" height="200">
                    <el-table-column label="bindingKey" min-width="320">
                        <template #default="{ row }">
                            <code>{{ row.bindingKey }}</code>
                        </template>
                    </el-table-column>
                    <el-table-column label="范围" width="120">
                        <template #default="{ row }">
                            {{ routeText(row.routeMode, row.scope) }}
                        </template>
                    </el-table-column>
                    <el-table-column prop="conversations" label="会话" width="90" />
                </el-table>
                <el-divider />
                <h2>权限与规则</h2>
                <div class="drawer-grid two">
                    <el-table :data="userDetail.acl" height="220">
                        <el-table-column prop="conversationId" label="会话" />
                        <el-table-column prop="permission" label="权限" width="90" />
                    </el-table>
                    <el-table :data="userDetail.constraints" height="220">
                        <el-table-column prop="name" label="规则" />
                        <el-table-column prop="priority" label="优先级" width="90" />
                    </el-table>
                </div>
            </template>
        </el-drawer>

        <el-drawer
            v-model="contextDrawer"
            size="640px"
            :title="contextDetail?.bindingKey || '上下文'"
        >
            <template v-if="contextDetail">
                <div class="tags warn">
                    <el-tag effect="plain">
                        {{ routeText(contextDetail.routeMode, contextDetail.scope) }}
                    </el-tag>
                    <el-tag effect="plain">
                        {{ contextDetail.conversations }} 会话
                    </el-tag>
                    <el-tag effect="plain">
                        {{ contextDetail.constraints }} 规则
                    </el-tag>
                    <el-tag effect="plain">{{ contextDetail.acl }} ACL</el-tag>
                </div>
                <div class="kv">
                    <span>bindingKey</span>
                    <code>{{ contextDetail.bindingKey }}</code>
                    <span>baseKey</span>
                    <code>{{ contextDetail.baseKey }}</code>
                    <span>presetLane</span>
                    <code>{{ contextDetail.presetLane || '-' }}</code>
                    <span>platform</span>
                    <code>{{ contextDetail.platform || '-' }}</code>
                    <span>selfId</span>
                    <code>{{ contextDetail.selfId || '-' }}</code>
                    <span>guildId</span>
                    <code>{{ contextDetail.guildId || '-' }}</code>
                    <span>userId</span>
                    <code>{{ contextDetail.userId || '-' }}</code>
                    <span>Koishi user</span>
                    <strong>
                        {{
                            contextDetail.koishiUserName ||
                            contextDetail.koishiUserId ||
                            '-'
                        }}
                    </strong>
                    <span>authority</span>
                    <strong>{{ contextDetail.koishiUserAuthority ?? '-' }}</strong>
                    <span>channel assignee</span>
                    <code>{{ contextDetail.channelAssignee || '-' }}</code>
                    <span>activeConversation</span>
                    <code>{{ contextDetail.activeConversationId || '-' }}</code>
                    <span>latestConversation</span>
                    <code>{{ contextDetail.latestConversationId || '-' }}</code>
                </div>
                <el-divider />
                <h2>模型分布</h2>
                <div class="tags runtime-tags">
                    <el-tag
                        v-for="(count, model) in contextDetail.models"
                        :key="model"
                        effect="plain"
                    >
                        {{ model }}: {{ count }}
                    </el-tag>
                </div>
            </template>
        </el-drawer>

        <el-drawer
            v-model="resourceDrawer"
            size="620px"
            :title="resourceDetail?.name || '资源'"
        >
            <template v-if="resourceDetail">
                <div class="tags warn">
                    <el-tag effect="plain">
                        {{ resourceTypeText(resourceDetail.type) }}
                    </el-tag>
                    <el-tag effect="plain">
                        会话 {{ resourceDetail.usedByConversations }}
                    </el-tag>
                    <el-tag effect="plain">
                        规则 {{ resourceDetail.usedByRules }}
                    </el-tag>
                </div>
                <div class="kv">
                    <span>name</span>
                    <code>{{ resourceDetail.name }}</code>
                    <span>type</span>
                    <code>{{ resourceDetail.type }}</code>
                    <span>source</span>
                    <code>{{ resourceDetail.source || '-' }}</code>
                    <span>group</span>
                    <code>{{ resourceDetail.group || '-' }}</code>
                    <span>path</span>
                    <code>{{ resourceDetail.path || '-' }}</code>
                    <span>description</span>
                    <span>{{ resourceDetail.description || '-' }}</span>
                </div>
                <el-divider />
                <h2>标签</h2>
                <div class="tags runtime-tags">
                    <el-tag
                        v-for="item in resourceDetail.tags"
                        :key="item"
                        effect="plain"
                    >
                        {{ item }}
                    </el-tag>
                </div>
                <el-divider />
                <h2>详情</h2>
                <pre class="json-view">{{ resourceJson }}</pre>
            </template>
        </el-drawer>

        <el-dialog v-model="previewBox.open" title="确认操作" width="760px">
            <div class="preview-head">
                <el-statistic title="影响数量" :value="previewBox.data.count" />
                <el-tag
                    v-if="previewBox.data.blocked"
                    type="danger"
                    effect="plain"
                >
                    已阻止
                </el-tag>
            </div>
            <div class="tags warn">
                <el-tag
                    v-for="item in previewBox.data.warnings"
                    :key="item"
                    type="warning"
                    effect="plain"
                >
                    {{ item }}
                </el-tag>
            </div>
            <el-table :data="previewBox.data.rows" height="300">
                <el-table-column label="对象" min-width="320">
                    <template #default="{ row }">
                        <div class="stack">
                            <strong>{{ row.title || row.name || row.state || '-' }}</strong>
                            <code>{{ row.id || row.conversationId }}</code>
                        </div>
                    </template>
                </el-table-column>
                <el-table-column label="模型 / 状态" min-width="220">
                    <template #default="{ row }">
                        <div class="stack">
                            <code>{{ row.model || row.path || '-' }}</code>
                            <span>{{ row.status || row.fileState || '-' }}</span>
                        </div>
                    </template>
                </el-table-column>
            </el-table>
            <template #footer>
                <el-button @click="previewBox.open = false">取消</el-button>
                <el-button
                    type="danger"
                    :disabled="overview.config.readonly || previewBox.data.blocked"
                    :loading="saving"
                    @click="applyPreview"
                >
                    执行
                </el-button>
            </template>
        </el-dialog>

        <el-dialog v-model="msgBox.open" title="聊天记录" width="760px">
            <el-form label-position="top" :disabled="overview.config.readonly">
                <div class="form-grid">
                    <el-form-item label="id">
                        <el-input
                            v-model="msgBox.row.id"
                            placeholder="留空则自动生成"
                        />
                    </el-form-item>
                    <el-form-item label="conversationId">
                        <el-input v-model="msgBox.row.conversationId" />
                    </el-form-item>
                </div>
                <div class="form-grid">
                    <el-form-item label="role">
                        <el-select v-model="msgBox.row.role" class="wide">
                            <el-option label="human" value="human" />
                            <el-option label="ai" value="ai" />
                            <el-option label="system" value="system" />
                            <el-option label="tool" value="tool" />
                        </el-select>
                    </el-form-item>
                    <el-form-item label="parentId">
                        <el-input v-model="msgBox.row.parentId" />
                    </el-form-item>
                </div>
                <div class="form-grid">
                    <el-form-item label="rawId">
                        <el-input v-model="msgBox.row.rawId" />
                    </el-form-item>
                    <el-form-item label="name">
                        <el-input v-model="msgBox.row.name" />
                    </el-form-item>
                </div>
                <el-form-item label="tool_call_id">
                    <el-input v-model="msgBox.row.tool_call_id" />
                </el-form-item>
                <el-form-item label="text">
                    <el-input
                        v-model="msgBox.row.text"
                        type="textarea"
                        :rows="10"
                    />
                </el-form-item>
                <el-checkbox v-model="msgBox.setLatest">
                    保存后设为 latestMessageId
                </el-checkbox>
            </el-form>
            <template #footer>
                <el-button @click="msgBox.open = false">取消</el-button>
                <el-button
                    type="primary"
                    :disabled="overview.config.readonly"
                    @click="saveMessage"
                >
                    保存
                </el-button>
            </template>
        </el-dialog>

        <el-dialog v-model="convBox.open" title="新建会话" width="760px">
            <el-form label-position="top" :disabled="overview.config.readonly">
                <div class="form-grid">
                    <el-form-item label="id">
                        <el-input
                            v-model="convBox.row.id"
                            placeholder="留空则自动生成"
                        />
                    </el-form-item>
                    <el-form-item label="createdBy">
                        <el-input v-model="convBox.row.createdBy" />
                    </el-form-item>
                </div>
                <el-form-item label="bindingKey">
                    <el-input v-model="convBox.row.bindingKey" />
                </el-form-item>
                <el-form-item label="title">
                    <el-input v-model="convBox.row.title" />
                </el-form-item>
                <el-form-item label="model">
                    <el-select
                        v-model="convBox.row.model"
                        allow-create
                        filterable
                        class="wide"
                    >
                        <el-option
                            v-for="item in modelChoices"
                            :key="item"
                            :label="item"
                            :value="item"
                        />
                    </el-select>
                </el-form-item>
                <div class="form-grid">
                    <el-form-item label="preset">
                        <el-input v-model="convBox.row.preset" />
                    </el-form-item>
                    <el-form-item label="chatMode">
                        <el-input v-model="convBox.row.chatMode" />
                    </el-form-item>
                </div>
                <el-form-item label="status">
                    <el-select v-model="convBox.row.status" class="wide">
                        <el-option label="active" value="active" />
                        <el-option label="archived" value="archived" />
                        <el-option label="broken" value="broken" />
                        <el-option label="deleted" value="deleted" />
                    </el-select>
                </el-form-item>
                <el-checkbox v-model="convBox.setBindingActive">
                    同步设为 binding 的 active/last 会话
                </el-checkbox>
            </el-form>
            <template #footer>
                <el-button @click="convBox.open = false">取消</el-button>
                <el-button
                    type="primary"
                    :disabled="overview.config.readonly"
                    @click="createConversation"
                >
                    创建
                </el-button>
            </template>
        </el-dialog>

        <el-dialog v-model="aclBox.open" title="访问控制" width="520px">
            <el-form label-position="top">
                <el-form-item label="conversationId">
                    <el-input v-model="aclBox.row.conversationId" />
                </el-form-item>
                <div class="form-grid">
                    <el-form-item label="principalType">
                        <el-select v-model="aclBox.row.principalType" class="wide">
                            <el-option label="user" value="user" />
                            <el-option label="guild" value="guild" />
                        </el-select>
                    </el-form-item>
                    <el-form-item label="permission">
                        <el-select v-model="aclBox.row.permission" class="wide">
                            <el-option label="view" value="view" />
                            <el-option label="manage" value="manage" />
                        </el-select>
                    </el-form-item>
                </div>
                <el-form-item label="principalId">
                    <el-input v-model="aclBox.row.principalId" />
                </el-form-item>
            </el-form>
            <template #footer>
                <el-button @click="aclBox.open = false">取消</el-button>
                <el-button type="primary" @click="saveAcl">保存</el-button>
            </template>
        </el-dialog>

        <el-dialog v-model="assignBox.open" title="分配会话" width="680px">
            <el-form label-position="top" :disabled="overview.config.readonly">
                <el-form-item label="conversationId">
                    <el-select
                        v-model="assignBox.row.conversationId"
                        filterable
                        class="wide"
                    >
                        <el-option
                            v-for="item in assignConversationChoices"
                            :key="item.id"
                            :label="`${item.title || item.id} / ${item.id}`"
                            :value="item.id"
                        />
                    </el-select>
                </el-form-item>
                <div class="form-grid">
                    <el-form-item label="授权类型">
                        <el-select
                            v-model="assignBox.row.principalType"
                            class="wide"
                        >
                            <el-option label="user" value="user" />
                            <el-option label="guild" value="guild" />
                        </el-select>
                    </el-form-item>
                    <el-form-item label="权限">
                        <el-select v-model="assignBox.row.permission" class="wide">
                            <el-option label="view" value="view" />
                            <el-option label="manage" value="manage" />
                        </el-select>
                    </el-form-item>
                </div>
                <el-form-item label="授权目标 ID">
                    <el-input
                        v-model="assignBox.row.principalId"
                        placeholder="用户 ID 或群/频道 ID"
                    />
                </el-form-item>
                <el-form-item label="绑定到上下文">
                    <el-select
                        v-model="assignBox.row.bindingKey"
                        filterable
                        clearable
                        allow-create
                        class="wide"
                        placeholder="可选：设为这个 bindingKey 的当前会话"
                    >
                        <el-option
                            v-for="item in assignBindingChoices"
                            :key="item.bindingKey"
                            :label="item.bindingKey"
                            :value="item.bindingKey"
                        />
                    </el-select>
                </el-form-item>
                <div class="checks">
                    <el-checkbox v-model="assignBox.row.setActive">
                        设为 activeConversationId
                    </el-checkbox>
                    <el-checkbox v-model="assignBox.row.setLast">
                        设为 lastConversationId
                    </el-checkbox>
                </div>
                <el-alert
                    class="inline-alert"
                    type="warning"
                    show-icon
                    :closable="false"
                    title="ACL 让用户可跨路由按 ID 使用；绑定上下文会让对应私聊/群上下文直接继续使用该会话。"
                />
            </el-form>
            <template #footer>
                <el-button @click="assignBox.open = false">取消</el-button>
                <el-button
                    type="primary"
                    :disabled="
                        overview.config.readonly ||
                        !assignBox.row.conversationId ||
                        (!assignBox.row.principalId && !assignBox.row.bindingKey)
                    "
                    @click="assignConversation"
                >
                    应用分配
                </el-button>
            </template>
        </el-dialog>

        <el-dialog v-model="ruleBox.open" title="约束规则" width="760px">
            <el-form label-position="top">
                <div class="form-grid">
                    <el-form-item label="id">
                        <el-input-number v-model="ruleBox.row.id" class="wide" />
                    </el-form-item>
                    <el-form-item label="name">
                        <el-input v-model="ruleBox.row.name" />
                    </el-form-item>
                </div>
                <div class="form-grid">
                    <el-form-item label="priority">
                        <el-input-number v-model="ruleBox.row.priority" class="wide" />
                    </el-form-item>
                    <el-form-item label="createdBy">
                        <el-input v-model="ruleBox.row.createdBy" />
                    </el-form-item>
                </div>
                <div class="form-grid">
                    <el-form-item label="guildId">
                        <el-input v-model="ruleBox.row.guildId" />
                    </el-form-item>
                    <el-form-item label="channelId">
                        <el-input v-model="ruleBox.row.channelId" />
                    </el-form-item>
                </div>
                <div class="form-grid">
                    <el-form-item label="defaultModel">
                        <el-input v-model="ruleBox.row.defaultModel" />
                    </el-form-item>
                    <el-form-item label="fixedModel">
                        <el-input v-model="ruleBox.row.fixedModel" />
                    </el-form-item>
                </div>
                <div class="form-grid">
                    <el-form-item label="defaultPreset">
                        <el-input v-model="ruleBox.row.defaultPreset" />
                    </el-form-item>
                    <el-form-item label="fixedPreset">
                        <el-input v-model="ruleBox.row.fixedPreset" />
                    </el-form-item>
                </div>
                <div class="form-grid">
                    <el-form-item label="users">
                        <el-input
                            v-model="ruleBox.row.usersText"
                            placeholder='JSON 数组或逗号分隔，如 ["10001"]'
                        />
                    </el-form-item>
                    <el-form-item label="excludeUsers">
                        <el-input
                            v-model="ruleBox.row.excludeUsersText"
                            placeholder='JSON 数组或逗号分隔，如 ["10002"]'
                        />
                    </el-form-item>
                </div>
                <div class="checks">
                    <el-checkbox v-model="ruleBox.row.enabled">启用</el-checkbox>
                    <el-checkbox v-model="ruleBox.row.lockConversation">
                        锁定
                    </el-checkbox>
                    <el-checkbox v-model="ruleBox.row.allowNew">允许新建</el-checkbox>
                    <el-checkbox v-model="ruleBox.row.allowSwitch">
                        允许切换
                    </el-checkbox>
                    <el-checkbox v-model="ruleBox.row.allowArchive">
                        允许归档
                    </el-checkbox>
                    <el-checkbox v-model="ruleBox.row.allowExport">
                        允许导出
                    </el-checkbox>
                </div>
            </el-form>
            <template #footer>
                <el-button @click="ruleBox.open = false">取消</el-button>
                <el-button type="primary" @click="saveRule">保存</el-button>
            </template>
        </el-dialog>
    </k-layout>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, reactive, ref, watch } from 'vue'
import { router, send } from '@koishijs/client'
import { ElMessage, ElMessageBox, ElPagination } from 'element-plus'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'

const Pager = defineComponent({
    props: {
        data: { type: Object, required: true }
    },
    emits: ['change'],
    setup(props, { emit }) {
        return () =>
            h('div', { class: 'pager' }, [
                h(ElPagination, {
                    background: true,
                    layout: 'prev, pager, next, total',
                    currentPage: props.data.page,
                    pageSize: props.data.pageSize,
                    total: props.data.total,
                    onCurrentChange: (page: number) => emit('change', page)
                })
            ])
    }
})

const active = ref('overview')
const advanced = ref('providers')
const loading = ref(false)
const saving = ref(false)
const drawer = ref(false)
const providerDrawer = ref(false)
const contextDrawer = ref(false)
const resourceDrawer = ref(false)
const userDrawer = ref(false)
const messageId = ref('')

const overview = reactive({
    config: {
        pageSize: 40,
        readonly: false,
        maxPreviewRows: 200,
        enableArchiveFileOps: false,
        enableMessageRepair: false
    },
    totals: {
        conversations: 0,
        messages: 0,
        users: 0,
        acl: 0,
        constraints: 0,
        archives: 0,
        bindings: 0,
        meta: 0,
        active: 0,
        archived: 0,
        deleted: 0,
        broken: 0,
        issues: 0,
        contexts: 0,
        providers: 0,
        resources: 0,
        liveModels: 0
    },
    runtime: {
        connected: false,
        tools: 0,
        chatChains: 0,
        vectorStores: 0,
        presets: 0,
        presetDir: '',
        defaults: {
            model: '',
            preset: '',
            chatMode: '',
            embeddings: '',
            vectorStore: '',
            groupRoute: ''
        }
    },
    models: [] as ModelCount[],
    liveModels: [] as string[],
    providers: [] as Provider[],
    contexts: [] as ContextRow[],
    resources: [] as Resource[],
    recent: [] as Conversation[],
    issues: [] as Diagnostic[],
    audits: [] as Audit[]
})

const quick = reactive({ model: '' })
const users = reactive(pageState<User>())
const contexts = reactive(pageState<ContextRow>())
const resources = reactive(pageState<Resource>())
const providers = reactive(pageState<Provider>())
const convs = reactive({
    ...pageState<Conversation>(),
    status: '',
    model: '',
    user: ''
})
const messages = reactive({
    ...pageState<Message>(),
    conversationId: '',
    role: '',
    user: ''
})
const acl = reactive(pageState<Acl>())
const rules = reactive(pageState<Rule>())
const archives = reactive(pageState<Archive>())
const health = reactive({
    score: 100,
    totals: {
        danger: 0,
        warning: 0,
        info: 0
    },
    rows: [] as HealthIssue[]
})

const detail = reactive({
    conversation: null as Conversation | null,
    route: null as RouteInfo | null,
    binding: null as Binding | null,
    bindingRefs: [] as Binding[],
    acl: [] as Acl[],
    archives: [] as Archive[],
    diagnostics: null as Diagnostic | null,
    messages: [] as Message[]
})

const providerDetail = reactive({
    provider: null as Provider | null,
    tools: [] as Tool[],
    chatChains: [] as ChatChain[],
    vectorStores: [] as string[]
})
const contextDetail = ref<ContextRow | null>(null)
const resourceDetail = ref<Resource | null>(null)
const userDetail = reactive({
    user: null as User | null,
    contexts: [] as ContextRow[],
    koishiBindings: [] as KoishiBinding[],
    koishiUsers: [] as KoishiUser[],
    channels: [] as KoishiChannel[],
    conversations: [] as Conversation[],
    acl: [] as Acl[],
    constraints: [] as Rule[],
    bindings: [] as Binding[]
})

const configState = reactive({
    runtime: {
        connected: false,
        source: 'runtime',
        writable: false
    },
    choices: {
        models: [] as string[],
        chatModes: [] as string[],
        presets: [] as string[],
        embeddings: [] as string[],
        vectorStores: [] as string[]
    },
    form: emptyConfig() as Record<string, unknown>
})

const edit = reactive({
    title: '',
    model: '',
    preset: '',
    chatMode: '',
    status: '',
    latestMessageId: ''
})

const op = reactive({
    fromModel: '',
    targetModel: '',
    status: 'active',
    includeArchived: false,
    statusFrom: '',
    targetStatus: '',
    userTargetModel: '',
    userTargetStatus: ''
})

const previewBox = reactive({
    open: false,
    input: null as Operation | null,
    data: {
        count: 0,
        rows: [] as Record<string, unknown>[],
        warnings: [] as string[],
        blocked: false
    }
})

const aclBox = reactive({
    open: false,
    row: {
        conversationId: '',
        principalType: 'user',
        principalId: '',
        permission: 'view'
    } as Acl
})

const assignBox = reactive({
    open: false,
    row: {
        conversationId: '',
        principalType: 'user',
        principalId: '',
        permission: 'manage',
        bindingKey: '',
        setActive: true,
        setLast: true
    }
})

const ruleBox = reactive({
    open: false,
    row: emptyRule()
})

const msgBox = reactive({
    open: false,
    setLatest: true,
    row: emptyMessage()
})

const convBox = reactive({
    open: false,
    setBindingActive: true,
    row: emptyConversation()
})

const bindingBox = reactive({
    row: emptyBinding()
})

const usedModels = computed(() => overview.models.map((row) => row.model))
const modelChoices = computed(() =>
    Array.from(new Set([...overview.liveModels, ...usedModels.value])).sort()
)
const assignConversationChoices = computed(() =>
    Array.from(
        new Map(
            [
                ...convs.rows,
                ...userDetail.conversations,
                ...(detail.conversation ? [detail.conversation] : [])
            ].map((row) => [row.id, row])
        ).values()
    )
)
const assignBindingChoices = computed(() =>
    Array.from(
        new Map(
            [
                ...userDetail.contexts.map((row) => ({
                    bindingKey: row.bindingKey
                })),
                ...userDetail.bindings,
                ...(detail.binding ? [detail.binding] : []),
                ...detail.bindingRefs,
                ...(detail.conversation
                    ? [{ bindingKey: detail.conversation.bindingKey }]
                    : [])
            ].map((row) => [row.bindingKey, row])
        ).values()
    )
)
const resourceJson = computed(() =>
    JSON.stringify(resourceDetail.value?.details ?? {}, null, 2)
)
const configGroups: ConfigGroup[] = [
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
const metricRows = computed(() => [
    {
        key: 'conversations',
        label: '会话',
        value: overview.totals.conversations,
        tab: 'conversations'
    },
    {
        key: 'messages',
        label: '消息',
        value: overview.totals.messages,
        tab: 'messages'
    },
    {
        key: 'users',
        label: '用户',
        value: overview.totals.users,
        tab: 'users'
    },
    {
        key: 'config',
        label: '配置',
        value: configState.runtime.writable ? '可写' : '只读',
        tab: 'config'
    },
    {
        key: 'acl',
        label: 'ACL',
        value: overview.totals.acl,
        tab: 'permissions'
    },
    {
        key: 'issues',
        label: '异常',
        value: overview.totals.issues,
        tab: 'advanced'
    },
    {
        key: 'advanced',
        label: '高级',
        value:
            overview.totals.providers +
            overview.totals.resources +
            overview.totals.contexts,
        tab: 'advanced'
    }
])

watch(
    () => quick.model,
    (model) => {
        convs.model = model
        if (active.value === 'conversations') loadConversations(1)
    }
)

function goHome() {
    router.push('/')
}

async function refresh() {
    loading.value = true
    try {
        Object.assign(overview, await send('chatluna-data/getOverview'))
        await Promise.all([
            loadProviders(providers.page),
            loadContexts(contexts.page),
            loadResources(resources.page),
            loadUsers(users.page),
            loadConversations(convs.page),
            loadMessages(messages.page),
            loadAcl(acl.page),
            loadRules(rules.page),
            loadArchives(archives.page),
            loadConfig(),
            loadHealth()
        ])
        if (detail.conversation) await loadDetail(detail.conversation.id)
    } catch (err) {
        ElMessage.error(String(err))
    } finally {
        loading.value = false
    }
}

async function loadProviders(page = 1) {
    Object.assign(
        providers,
        await send('chatluna-data/listProviders', {
            page,
            pageSize: providers.pageSize,
            query: providers.query
        })
    )
}

async function loadContexts(page = 1) {
    Object.assign(
        contexts,
        await send('chatluna-data/listContexts', {
            page,
            pageSize: contexts.pageSize,
            query: contexts.query
        })
    )
}

async function loadResources(page = 1) {
    Object.assign(
        resources,
        await send('chatluna-data/listResources', {
            page,
            pageSize: resources.pageSize,
            query: resources.query
        })
    )
}

async function loadUsers(page = 1) {
    Object.assign(
        users,
        await send('chatluna-data/listUsers', {
            page,
            pageSize: users.pageSize,
            query: users.query
        })
    )
}

async function loadConversations(page = 1) {
    Object.assign(
        convs,
        await send('chatluna-data/listConversations', {
            page,
            pageSize: convs.pageSize,
            query: convs.query,
            model: convs.model,
            user: convs.user,
            status: convs.status
        })
    )
}

async function loadMessages(page = 1) {
    Object.assign(
        messages,
        await send('chatluna-data/listMessages', {
            page,
            pageSize: messages.pageSize,
            query: messages.query,
            conversationId: messages.conversationId,
            role: messages.role,
            user: messages.user
        })
    )
}

async function loadAcl(page = 1) {
    Object.assign(
        acl,
        await send('chatluna-data/listAcl', {
            page,
            pageSize: acl.pageSize,
            query: acl.query
        })
    )
}

async function loadRules(page = 1) {
    Object.assign(
        rules,
        await send('chatluna-data/listConstraints', {
            page,
            pageSize: rules.pageSize,
            query: rules.query
        })
    )
}

async function loadArchives(page = 1) {
    Object.assign(
        archives,
        await send('chatluna-data/listArchives', {
            page,
            pageSize: archives.pageSize,
            query: archives.query
        })
    )
}

async function loadHealth() {
    Object.assign(health, await send('chatluna-data/getHealth'))
}

async function loadConfig() {
    const data = await send('chatluna-data/getConfig')
    configState.runtime = data.runtime
    configState.choices = data.choices
    configState.form = { ...emptyConfig(), ...data.config }
}

async function saveConfig() {
    saving.value = true
    try {
        await send('chatluna-data/saveConfig', {
            config: configState.form
        })
        ElMessage.success('ChatLuna 配置已保存')
        await loadConfig()
    } finally {
        saving.value = false
    }
}

function configOptions(name?: string) {
    if (name === 'models') return configState.choices.models
    if (name === 'chatModes') return configState.choices.chatModes
    if (name === 'presets') return configState.choices.presets
    if (name === 'embeddings') return ['无', ...configState.choices.embeddings]
    if (name === 'vectorStores') return ['无', ...configState.choices.vectorStores]
    if (name === 'routeModes') return ['shared', 'personal']
    if (name === 'outputModes') {
        return [
            'text',
            'image',
            'voice',
            'mixed-voice',
            'raw',
            'koishi-element',
            'pure-text'
        ]
    }
    return []
}

async function openUser(row: User) {
    Object.assign(
        userDetail,
        await send('chatluna-data/getUserDetail', {
            userId: row.userId
        })
    )
    userDrawer.value = true
}

async function filterUser(row: User) {
    convs.user = row.userId
    messages.user = row.userId
    active.value = 'conversations'
    await Promise.all([loadConversations(1), loadMessages(1)])
}

function openContext(row: ContextRow) {
    contextDetail.value = row
    contextDrawer.value = true
}

function openResource(row: Resource) {
    resourceDetail.value = row
    resourceDrawer.value = true
}

async function openProvider(row: Provider) {
    Object.assign(
        providerDetail,
        await send('chatluna-data/getProviderDetail', {
            platform: row.platform
        })
    )
    providerDrawer.value = true
}

async function refreshProvider() {
    if (!providerDetail.provider) return
    saving.value = true
    try {
        await send('chatluna-data/refreshProvider', {
            platform: providerDetail.provider.platform
        })
        ElMessage.success('提供商模型已刷新')
        await refresh()
        const row = providers.rows.find(
            (item) => item.platform === providerDetail.provider?.platform
        )
        if (row) await openProvider(row)
    } finally {
        saving.value = false
    }
}

async function openConversation(row: Conversation) {
    await loadDetail(row.id)
    drawer.value = true
}

function openAssign(row?: Conversation) {
    assignBox.row.conversationId =
        row?.id ?? detail.conversation?.id ?? userDetail.user?.latestConversationId ?? ''
    assignBox.row.principalType = 'user'
    assignBox.row.principalId =
        userDetail.user?.userId ?? detail.conversation?.createdBy ?? ''
    assignBox.row.permission = 'manage'
    assignBox.row.bindingKey =
        userDetail.contexts[0]?.bindingKey ?? detail.conversation?.bindingKey ?? ''
    assignBox.row.setActive = true
    assignBox.row.setLast = true
    assignBox.open = true
}

async function openConversationMessages(row: Conversation) {
    active.value = 'messages'
    await loadDetail(row.id)
    await loadMessages(1)
}

async function openMessage(row: Message) {
    active.value = 'messages'
    await loadDetail(row.conversationId)
}

async function loadDetail(id: string) {
    if (!id) return
    const data = await send('chatluna-data/getConversationDetail', { id })
    Object.assign(detail, data)
    messageId.value = id
    messages.conversationId = id
    edit.title = detail.conversation?.title ?? ''
    edit.model = detail.conversation?.model ?? ''
    edit.preset = detail.conversation?.preset ?? ''
    edit.chatMode = detail.conversation?.chatMode ?? ''
    edit.status = detail.conversation?.status ?? ''
    edit.latestMessageId = detail.conversation?.latestMessageId ?? ''
    bindingBox.row = data.binding
        ? {
              bindingKey: data.binding.bindingKey,
              activeConversationId: data.binding.activeConversationId ?? '',
              lastConversationId: data.binding.lastConversationId ?? ''
          }
        : {
              bindingKey: detail.conversation?.bindingKey ?? '',
              activeConversationId: detail.conversation?.id ?? '',
              lastConversationId: detail.conversation?.id ?? ''
          }
}

async function saveConversation() {
    if (!detail.conversation) return
    saving.value = true
    try {
        await send('chatluna-data/saveConversationPatch', {
            id: detail.conversation.id,
            patch: {
                title: edit.title,
                model: edit.model,
                preset: edit.preset,
                chatMode: edit.chatMode,
                status: edit.status,
                latestMessageId: edit.latestMessageId || null
            }
        })
        ElMessage.success('会话已保存')
        await refresh()
    } finally {
        saving.value = false
    }
}

function newConversation() {
    convBox.row = emptyConversation()
    convBox.row.model = quick.model || modelChoices.value[0] || ''
    convBox.open = true
}

async function createConversation() {
    await send('chatluna-data/createConversation', {
        row: convBox.row,
        setBindingActive: convBox.setBindingActive
    })
    convBox.open = false
    ElMessage.success('会话已创建')
    await refresh()
}

async function removeConversation() {
    if (!detail.conversation) return
    await ElMessageBox.confirm(
        '确定删除此会话？可选择同时删除消息与 ACL。',
        '确认',
        {
            type: 'warning'
        }
    )
    await send('chatluna-data/removeConversation', {
        id: detail.conversation.id,
        removeMessages: true,
        removeAcl: true
    })
    drawer.value = false
    detail.conversation = null
    ElMessage.success('会话已删除')
    await refresh()
}

async function saveBinding() {
    await send('chatluna-data/saveBinding', {
        mode: 'save',
        row: bindingBox.row
    })
    ElMessage.success('绑定已保存')
    await refresh()
}

async function removeBinding() {
    await ElMessageBox.confirm('确定删除这条 ChatLuna 绑定？', '确认', {
        type: 'warning'
    })
    await send('chatluna-data/saveBinding', {
        mode: 'remove',
        row: bindingBox.row
    })
    bindingBox.row = emptyBinding()
    ElMessage.success('绑定已删除')
    await refresh()
}

async function assignConversation() {
    await send('chatluna-data/assignConversation', {
        ...assignBox.row,
        bindingKey: assignBox.row.bindingKey || undefined,
        principalId: assignBox.row.principalId || undefined
    })
    assignBox.open = false
    ElMessage.success('会话已分配')
    await refresh()
    if (userDetail.user) await openUser(userDetail.user)
}

function editMessage(row?: Message) {
    msgBox.row = row
        ? {
              id: row.id,
              conversationId: row.conversationId,
              parentId: row.parentId,
              role: row.role,
              text: row.text,
              name: row.name ?? '',
              tool_call_id: row.toolCallId ?? '',
              rawId: row.rawId ?? '',
              createdAt: row.createdAt
          }
        : emptyMessage(detail.conversation?.id ?? messageId.value)
    msgBox.setLatest = row == null
    msgBox.open = true
}

async function saveMessage() {
    await send('chatluna-data/saveMessage', {
        row: msgBox.row,
        setLatest: msgBox.setLatest
    })
    msgBox.open = false
    ElMessage.success('消息已保存')
    await loadDetail(msgBox.row.conversationId)
    await loadMessages(messages.page)
}

async function removeMessage(row: Message) {
    await ElMessageBox.confirm('确定删除这条消息？', '确认', {
        type: 'warning'
    })
    await send('chatluna-data/removeMessage', { id: row.id })
    ElMessage.success('消息已删除')
    await loadDetail(row.conversationId)
    await loadMessages(messages.page)
}

async function preview(input: Operation) {
    previewBox.input = input
    previewBox.data = await send('chatluna-data/previewOperation', input)
    previewBox.open = true
}

async function applyPreview() {
    if (!previewBox.input) return
    saving.value = true
    try {
        await send('chatluna-data/applyOperation', previewBox.input)
        previewBox.open = false
        ElMessage.success('操作已执行')
        await refresh()
    } finally {
        saving.value = false
    }
}

function editAcl(row?: Acl) {
    aclBox.row = row
        ? { ...row }
        : {
              conversationId: detail.conversation?.id ?? '',
              principalType: 'user',
              principalId: '',
              permission: 'view'
          }
    aclBox.open = true
}

async function saveAcl() {
    await send('chatluna-data/saveAcl', { mode: 'save', row: aclBox.row })
    aclBox.open = false
    ElMessage.success('ACL 已保存')
    await refresh()
}

async function removeAcl(row: Acl) {
    await ElMessageBox.confirm('确定删除这条 ACL？', '确认', {
        type: 'warning'
    })
    await send('chatluna-data/saveAcl', { mode: 'remove', row })
    ElMessage.success('ACL 已删除')
    await refresh()
}

function editRule(row?: Rule) {
    ruleBox.row = row
        ? {
              ...row,
              usersText: readUsers(row.users),
              excludeUsersText: readUsers(row.excludeUsers)
          }
        : emptyRule()
    ruleBox.open = true
}

async function saveRule() {
    await send('chatluna-data/saveConstraint', {
        mode: 'save',
        row: {
            ...ruleBox.row,
            users: ruleBox.row.usersText,
            excludeUsers: ruleBox.row.excludeUsersText
        }
    })
    ruleBox.open = false
    ElMessage.success('规则已保存')
    await refresh()
}

async function removeRule(row: Rule) {
    await ElMessageBox.confirm('确定删除这条约束规则？', '确认', {
        type: 'warning'
    })
    await send('chatluna-data/saveConstraint', { mode: 'remove', row })
    ElMessage.success('规则已删除')
    await refresh()
}

function pageState<T>() {
    return {
        query: '',
        page: 1,
        pageSize: 40,
        total: 0,
        rows: [] as T[]
    }
}

function emptyRule(): Rule {
    return {
        id: undefined,
        name: '',
        enabled: true,
        priority: 0,
        createdBy: '',
        createdAt: '',
        updatedAt: '',
        users: [],
        excludeUsers: [],
        usersText: '',
        excludeUsersText: '',
        lockConversation: false,
        allowNew: true,
        allowSwitch: true,
        allowArchive: true,
        allowExport: true
    }
}

function emptyMessage(id = ''): MessageEdit {
    return {
        id: '',
        conversationId: id,
        parentId: '',
        role: 'human',
        text: '',
        name: '',
        tool_call_id: '',
        rawId: '',
        createdAt: ''
    }
}

function emptyConversation(): ConversationEdit {
    return {
        id: '',
        bindingKey: '',
        title: '',
        model: '',
        preset: '',
        chatMode: 'chat',
        createdBy: '',
        status: 'active'
    }
}

function emptyBinding(): Binding {
    return {
        bindingKey: '',
        activeConversationId: '',
        lastConversationId: ''
    }
}

function emptyConfig() {
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

function readUsers(value?: string[] | string | null) {
    if (Array.isArray(value)) return JSON.stringify(value)
    return value ?? ''
}

function statusText(status: string) {
    if (status === 'active') return '活跃'
    if (status === 'archived') return '已归档'
    if (status === 'broken') return '已损坏'
    if (status === 'deleted') return '已删除'
    return status
}

function statusType(status: string) {
    if (status === 'active') return 'success'
    if (status === 'archived') return 'info'
    if (status === 'broken') return 'danger'
    return 'warning'
}

function roleText(role: string) {
    if (role === 'human') return '用户'
    if (role === 'ai') return '助手'
    if (role === 'system') return '系统'
    if (role === 'tool') return '工具'
    return role
}

function roleType(role: string) {
    if (role === 'human') return 'primary'
    if (role === 'ai') return 'success'
    if (role === 'tool') return 'warning'
    return 'info'
}

function providerStateText(state: string) {
    if (state === 'loaded') return '已加载'
    if (state === 'registered') return '已注册'
    return '仅数据库'
}

function providerStateType(state: string) {
    if (state === 'loaded') return 'success'
    if (state === 'registered') return 'warning'
    return 'info'
}

function capabilityText(name: string) {
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

function routeText(mode: string, scope: string) {
    if (mode === 'shared') return '共享群聊'
    if (mode === 'personal' && scope === 'direct') return '私聊个人'
    if (mode === 'personal') return '群内个人'
    if (mode === 'custom') return '自定义'
    return mode || scope || '-'
}

function resourceTypeText(type: string) {
    if (type === 'tool') return '工具'
    if (type === 'chat-chain') return '聊天链'
    if (type === 'vector-store') return '向量库'
    if (type === 'preset') return '预设'
    if (type === 'default') return '默认配置'
    return type
}

function healthText(level: string) {
    if (level === 'danger') return '严重'
    if (level === 'warning') return '警告'
    return '提示'
}

function healthType(level: string) {
    if (level === 'danger') return 'danger'
    if (level === 'warning') return 'warning'
    return 'info'
}

function shortTime(value: string) {
    if (!value) return '-'
    return value.replace('T', ' ').slice(0, 19)
}

onMounted(refresh)

interface ModelCount {
    model: string
    count: number
}

interface Conversation {
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

interface ConversationEdit {
    id: string
    bindingKey: string
    title: string
    model: string
    preset: string
    chatMode: string
    createdBy: string
    status: string
}

interface User {
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

interface ContextRow {
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

interface RouteInfo {
    baseKey: string
    presetLane: string
    routeMode: string
    platform: string
    selfId: string
    scope: string
    guildId: string
    userId: string
}

interface Provider {
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
    models: ProviderModel[]
    recent: Conversation[]
}

interface Resource {
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

interface ProviderModel {
    name: string
    type: number
    typeText: string
    maxTokens: number
    capabilities: string[]
}

interface Tool {
    name: string
    description: string
    source: string
    group: string
    tags: string[]
}

interface ChatChain {
    name: string
    description: Record<string, unknown>
}

interface Diagnostic {
    conversationId: string
    title: string
    status: string
    latestMessageId: string | null
    messageCount: number
    chainCount: number
    orphanCount: number
    issues: { type: string; message: string }[]
}

interface Message {
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

interface MessageEdit {
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

interface Acl {
    conversationId: string
    principalType: string
    principalId: string
    permission: string
}

interface Rule {
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

interface Archive {
    id: string
    conversationId: string
    path: string
    state: string
    messageCount: number
    size: number
    fileState: string
}

interface Binding {
    bindingKey: string
    activeConversationId?: string | null
    lastConversationId?: string | null
    updatedAt?: string | null
}

interface KoishiBinding {
    aid: number
    bid: number
    pid: string
    platform: string
}

interface KoishiUser {
    id: number
    name: string
    authority: number
    permissions?: string[]
    createdAt?: string
}

interface KoishiChannel {
    id: string
    platform: string
    assignee: string
    guildId: string
    permissions?: string[]
    createdAt?: string
}

interface Audit {
    id: string
    action: string
    target: string
    count: number
    createdAt: string
}

interface HealthIssue {
    type: string
    level: string
    target: string
    message: string
    action: string
}

interface ConfigGroup {
    title: string
    items: ConfigItem[]
}

interface ConfigItem {
    key: string
    label: string
    type: string
    desc: string
    min?: number
    max?: number
    step?: number
    options?: string
}

type Operation =
    | {
          type: 'model-migration'
          fromModel?: string
          targetModel: string
          status?: string
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
</script>

<style scoped>
.cl-data-page {
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--k-page-bg);
    color: var(--k-text-dark);
}

.shell {
    height: 100%;
    min-height: 0;
    padding: 24px 88px 80px 24px;
    box-sizing: border-box;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
}

.topbar,
.title-row,
.top-actions,
.panel-head,
.filters,
.tags,
.preview-head,
.checks {
    display: flex;
    align-items: center;
    gap: 10px;
}

.topbar,
.panel-head,
.preview-head {
    justify-content: space-between;
}

h1,
h2,
h3,
p {
    margin: 0;
}

h1 {
    font-size: 24px;
    font-weight: 650;
}

h2 {
    font-size: 15px;
    font-weight: 650;
}

h3 {
    font-size: 14px;
    font-weight: 650;
}

p,
span,
time,
dt {
    color: var(--k-text-light);
}

.top-actions {
    justify-content: flex-end;
}

.top-actions :deep(.el-select) {
    width: 260px;
}

.metrics {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    margin-top: 18px;
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 24%);
    border-radius: 8px;
    overflow: hidden;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 38%);
}

.metric {
    display: grid;
    gap: 5px;
    padding: 15px 18px;
    text-align: left;
    border: 0;
    border-right: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 30%);
    background: transparent;
    cursor: pointer;
}

.metric:last-child {
    border-right: 0;
}

.metric strong {
    font-size: 24px;
    color: var(--k-text-dark);
}

.tabs {
    margin-top: 16px;
}

.grid {
    display: grid;
    gap: 14px;
}

.grid.two {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.panel {
    min-width: 0;
    margin-bottom: 14px;
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 24%);
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 45%);
    overflow: hidden;
}

.panel-head {
    min-height: 54px;
    padding: 12px 14px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 28%);
}

.table-note {
    padding: 8px 14px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 36%);
    color: var(--k-text-light);
    font-size: 12px;
}

.panel-head.wrap {
    flex-wrap: wrap;
}

.filters {
    flex-wrap: wrap;
    justify-content: flex-end;
}

.filters :deep(.el-input) {
    width: 230px;
}

.filters :deep(.el-select) {
    width: 180px;
}

.stack {
    display: grid;
    gap: 4px;
    min-width: 0;
}

.stack strong,
.stack span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tags {
    flex-wrap: wrap;
}

.tags.warn {
    margin: 12px 0;
}

.runtime-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 1px;
    background: color-mix(in srgb, var(--k-color-divider), transparent 30%);
}

.runtime-grid div {
    display: grid;
    gap: 6px;
    padding: 18px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 42%);
}

.runtime-grid strong {
    font-size: 22px;
    color: var(--k-text-dark);
}

.defaults-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    background: color-mix(in srgb, var(--k-color-divider), transparent 30%);
}

.defaults-grid div {
    display: grid;
    gap: 6px;
    min-width: 0;
    padding: 14px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 42%);
}

.health-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1px;
    background: color-mix(in srgb, var(--k-color-divider), transparent 30%);
}

.health-strip div {
    display: grid;
    gap: 6px;
    padding: 16px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 42%);
}

.health-strip strong {
    font-size: 22px;
    color: var(--k-text-dark);
}

.provider-counts,
.runtime-list,
.drawer-head {
    display: flex;
    align-items: center;
    gap: 10px;
}

.provider-counts,
.runtime-list {
    flex-wrap: wrap;
}

.drawer-head {
    justify-content: space-between;
    margin-bottom: 16px;
}

.drawer-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}

.inline-alert {
    margin-top: 12px;
}

.provider-kv {
    margin-top: 8px;
}

.drawer-grid {
    margin-top: 12px;
}

.runtime-tags {
    margin-top: 12px;
}

.advanced-box {
    margin-top: 16px;
}

.user-ops {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
    gap: 10px;
    margin-top: 12px;
}

.split {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
}

.left-list {
    min-width: 0;
    border-right: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 28%);
}

.side-detail {
    display: grid;
    align-content: start;
    gap: 14px;
    padding: 16px;
}

.message-list {
    height: 620px;
}

.message {
    margin: 12px;
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 30%);
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 40%);
}

.message header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
}

.message-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.message dl,
.kv {
    display: grid;
    grid-template-columns: 130px minmax(0, 1fr);
    gap: 7px 10px;
}

.message dl {
    margin: 0;
}

.message dd {
    min-width: 0;
    margin: 0;
}

.message pre {
    max-height: 180px;
    margin: 12px 0 0;
    padding: 10px;
    overflow: auto;
    border-radius: 6px;
    background: color-mix(in srgb, var(--k-page-bg), #000 8%);
    color: var(--k-text-dark);
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.json-view {
    max-height: 300px;
    margin: 12px 0 0;
    padding: 12px;
    overflow: auto;
    border-radius: 6px;
    background: color-mix(in srgb, var(--k-page-bg), #000 8%);
    color: var(--k-text-dark);
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    line-height: 1.55;
}

.pager {
    display: flex;
    justify-content: flex-end;
    padding: 12px 14px;
    border-top: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 28%);
}

.operations {
    padding-bottom: 16px;
}

.operation-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
    padding: 14px;
}

.config-form {
    padding: 14px;
}

.config-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
}

.config-section {
    min-width: 0;
    padding: 14px;
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 28%);
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 30%);
}

.config-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px 12px;
    margin-top: 12px;
}

.config-fields p {
    margin-top: 5px;
    font-size: 12px;
    line-height: 1.45;
}

.op-block {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 14px;
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 28%);
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 30%);
}

.edit-form {
    display: grid;
    gap: 4px;
}

.form-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
}

.wide {
    width: 100%;
}

code {
    min-width: 0;
    color: color-mix(in srgb, var(--k-text-dark), var(--k-color-primary) 18%);
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    overflow-wrap: anywhere;
}

:deep(.el-table) {
    --el-table-header-bg-color: color-mix(
        in srgb,
        var(--k-page-bg),
        var(--k-side-bg) 35%
    );
    --el-table-tr-bg-color: transparent;
    --el-table-row-hover-bg-color: color-mix(
        in srgb,
        var(--k-color-primary),
        transparent 92%
    );
}

:deep(.clickable-row) {
    cursor: pointer;
}

:deep(.el-tabs__nav-wrap::after) {
    background: color-mix(in srgb, var(--k-color-divider), transparent 28%);
}

:deep(.el-button),
:deep(.el-input__wrapper),
:deep(.el-select__wrapper),
:deep(.el-tag) {
    border-radius: 6px;
}

@media (max-width: 1180px) {
    .shell {
        padding: 18px 18px 72px;
    }

    .topbar,
    .panel-head {
        align-items: flex-start;
        flex-direction: column;
    }

    .metrics,
    .grid.two,
    .split,
    .operation-grid,
    .config-grid,
    .config-fields,
    .form-grid,
    .runtime-grid,
    .defaults-grid,
    .health-strip {
        grid-template-columns: 1fr;
    }

    .metric {
        border-right: 0;
        border-bottom: 1px solid
            color-mix(in srgb, var(--k-color-divider), transparent 30%);
    }

    .metric:last-child {
        border-bottom: 0;
    }

    .filters,
    .top-actions {
        width: 100%;
        justify-content: flex-start;
    }

    .filters :deep(.el-input),
    .filters :deep(.el-select),
    .top-actions :deep(.el-select) {
        width: 100%;
    }

    .left-list {
        border-right: 0;
        border-bottom: 1px solid
            color-mix(in srgb, var(--k-color-divider), transparent 28%);
    }
}
</style>
