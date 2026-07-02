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
                    :class="{ active: active === item.tab }"
                    type="button"
                    @click="active = item.tab"
                >
                    <span>{{ item.label }}</span>
                    <strong>{{ item.value }}</strong>
                </button>
            </section>

            <el-tabs v-model="active" class="tabs">
                <el-tab-pane name="overview" label="概览">
                    <el-alert
                        v-if="overview.loadErrors && overview.loadErrors.length"
                        type="error"
                        :closable="false"
                        show-icon
                        class="integrity-banner"
                    >
                        <template #title>
                            数据库存在脏数据，{{ overview.loadErrors.length }} 张表加载失败（如 chatluna_conversation 在 minato 反序列化阶段崩溃）。已自动跳过相关读取以保证控制台可用。
                        </template>
                        <template #default>
                            <el-button
                                size="small"
                                type="primary"
                                plain
                                @click="goToIntegrity"
                            >
                                前往修复
                            </el-button>
                        </template>
                    </el-alert>
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

                <el-tab-pane name="models" label="模型与 Provider">
                    <section class="panel model-health">
                        <div class="panel-head wrap">
                            <div>
                                <h2>模型与 Provider 健康中心</h2>
                                <p>聚合运行时 provider、模型引用、资源能力和失效配置。</p>
                            </div>
                            <div class="filters">
                                <el-input
                                    v-model="modelHealth.query"
                                    :prefix-icon="Search"
                                    clearable
                                    size="small"
                                    placeholder="搜索 provider / 模型 / 问题"
                                    @keydown.enter="loadModelHealth"
                                    @clear="loadModelHealth"
                                />
                                <el-select
                                    v-model="modelHealth.platform"
                                    clearable
                                    filterable
                                    size="small"
                                    placeholder="Provider"
                                    @change="loadModelHealth"
                                >
                                    <el-option
                                        v-for="item in modelHealth.choices.providers"
                                        :key="item"
                                        :label="item"
                                        :value="item"
                                    />
                                </el-select>
                                <el-select
                                    v-model="modelHealth.issueType"
                                    clearable
                                    filterable
                                    size="small"
                                    placeholder="问题类型"
                                    @change="loadModelHealth"
                                >
                                    <el-option
                                        v-for="item in modelHealth.choices.issueTypes"
                                        :key="item"
                                        :label="issueTypeText(item)"
                                        :value="item"
                                    />
                                </el-select>
                                <el-button
                                    :icon="Refresh"
                                    size="small"
                                    type="primary"
                                    plain
                                    @click="loadModelHealth"
                                >
                                    检查
                                </el-button>
                            </div>
                        </div>

                        <div class="model-kpis">
                            <div v-for="item in modelHealthMetrics" :key="item.label">
                                <span>{{ item.label }}</span>
                                <strong>{{ item.value }}</strong>
                            </div>
                        </div>

                        <div class="model-workbench">
                            <section class="provider-list">
                                <div
                                    v-for="row in modelHealth.providers"
                                    :key="row.platform"
                                    class="provider-card"
                                    :class="{
                                        active:
                                            modelHealth.selectedProvider?.platform ===
                                            row.platform
                                    }"
                                    @click="selectModelProvider(row)"
                                >
                                    <div class="provider-title">
                                        <strong>{{ row.platform }}</strong>
                                        <el-tag
                                            :type="providerStateType(row.state)"
                                            effect="plain"
                                            size="small"
                                        >
                                            {{ providerStateText(row.state) }}
                                        </el-tag>
                                    </div>
                                    <div class="provider-meta">
                                        <span>模型 {{ row.modelCount }}</span>
                                        <span>配置 {{ row.availableConfigCount }} / {{ row.configCount }}</span>
                                        <span>会话 {{ row.conversations }}</span>
                                        <span>风险 {{ row.riskCount || 0 }}</span>
                                    </div>
                                    <el-progress
                                        :percentage="
                                            row.configCount
                                                ? Math.round(
                                                      (row.availableConfigCount /
                                                          row.configCount) *
                                                          100
                                                  )
                                                : 0
                                        "
                                        :show-text="false"
                                        :status="
                                            row.riskCount
                                                ? 'warning'
                                                : row.state === 'loaded'
                                                  ? 'success'
                                                  : undefined
                                        "
                                    />
                                </div>
                                <el-empty
                                    v-if="!modelHealth.providers.length"
                                    description="暂无 Provider"
                                />
                            </section>

                            <section class="provider-detail-panel">
                                <template v-if="modelHealth.selectedProvider">
                                    <div class="provider-detail-head">
                                        <div>
                                            <h3>{{ modelHealth.selectedProvider.platform }}</h3>
                                            <p>
                                                {{ providerStateText(modelHealth.selectedProvider.state) }}
                                                / 会话 {{ modelHealth.selectedProvider.conversations }}
                                            </p>
                                        </div>
                                        <el-button
                                            :icon="Refresh"
                                            size="small"
                                            type="primary"
                                            plain
                                            :disabled="
                                                overview.config.readonly ||
                                                !modelHealth.selectedProvider.registered
                                            "
                                            :loading="saving"
                                            @click="
                                                refreshProviderFromHealth(
                                                    modelHealth.selectedProvider
                                                )
                                            "
                                        >
                                            刷新模型
                                        </el-button>
                                    </div>
                                    <div class="model-matrix">
                                        <div>
                                            <span>LLM</span>
                                            <strong>{{ modelHealth.selectedProvider.llmCount }}</strong>
                                        </div>
                                        <div>
                                            <span>嵌入</span>
                                            <strong>{{ modelHealth.selectedProvider.embeddingsCount }}</strong>
                                        </div>
                                        <div>
                                            <span>重排</span>
                                            <strong>{{ modelHealth.selectedProvider.rerankerCount }}</strong>
                                        </div>
                                        <div>
                                            <span>Token</span>
                                            <strong>
                                                {{ modelHealth.selectedProvider.maxTokensMin || '-' }}
                                                -
                                                {{ modelHealth.selectedProvider.maxTokensMax || '-' }}
                                            </strong>
                                        </div>
                                    </div>
                                    <div class="tags runtime-tags">
                                        <el-tag
                                            v-for="item in modelHealth.selectedProvider.capabilities"
                                            :key="item"
                                            effect="plain"
                                            size="small"
                                        >
                                            {{ capabilityText(item) }}
                                        </el-tag>
                                    </div>
                                    <el-tabs class="inner-tabs compact-tabs">
                                        <el-tab-pane label="模型">
                                            <el-table
                                                :data="modelHealth.selectedProvider.models"
                                                height="260"
                                            >
                                                <el-table-column label="名称" min-width="220">
                                                    <template #default="{ row }">
                                                        <code>{{ row.name }}</code>
                                                    </template>
                                                </el-table-column>
                                                <el-table-column prop="typeText" label="类型" width="90" />
                                                <el-table-column prop="maxTokens" label="Tokens" width="110" />
                                            </el-table>
                                        </el-tab-pane>
                                        <el-tab-pane label="最近会话">
                                            <el-table
                                                :data="modelHealth.selectedProvider.recent"
                                                height="260"
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
                                            </el-table>
                                        </el-tab-pane>
                                    </el-tabs>
                                </template>
                                <el-empty v-else description="选择一个 Provider" />
                            </section>
                        </div>
                    </section>

                    <section class="panel model-health">
                        <div class="panel-head wrap">
                            <div>
                                <h2>失效引用与迁移</h2>
                                <p>缺失模型可以在这里直接预览迁移。</p>
                            </div>
                            <div class="filters">
                                <el-select
                                    v-model="modelHealth.targetModel"
                                    filterable
                                    clearable
                                    size="small"
                                    placeholder="迁移到可用模型"
                                >
                                    <el-option
                                        v-for="item in modelHealth.choices.models"
                                        :key="item"
                                        :label="item"
                                        :value="item"
                                    />
                                </el-select>
                                <el-checkbox v-model="modelHealth.includeArchived">
                                    包含归档
                                </el-checkbox>
                            </div>
                        </div>
                        <div class="issue-groups">
                            <div
                                v-for="group in modelHealth.issueGroups"
                                :key="group.type"
                                class="issue-group"
                            >
                                <div>
                                    <el-tag
                                        :type="healthType(group.level)"
                                        effect="plain"
                                        size="small"
                                    >
                                        {{ issueTypeText(group.type) }}
                                    </el-tag>
                                    <strong>{{ group.count }}</strong>
                                </div>
                                <span>{{ group.action }}</span>
                            </div>
                            <el-empty
                                v-if="!modelHealth.issueGroups.length"
                                description="暂无模型健康问题"
                            />
                        </div>
                        <el-table :data="missingModelRefs" height="320">
                            <el-table-column label="对象" min-width="260">
                                <template #default="{ row }">
                                    <div class="stack">
                                        <strong>{{ row.title }}</strong>
                                        <code>{{ row.kind }} / {{ row.id }}</code>
                                    </div>
                                </template>
                            </el-table-column>
                            <el-table-column label="字段" width="150">
                                <template #default="{ row }">
                                    <code>{{ row.field }}</code>
                                </template>
                            </el-table-column>
                            <el-table-column label="当前模型" min-width="260">
                                <template #default="{ row }">
                                    <code>{{ row.model }}</code>
                                </template>
                            </el-table-column>
                            <el-table-column label="状态" width="120">
                                <template #default>
                                    <el-tag type="danger" effect="plain" size="small">
                                        缺失
                                    </el-tag>
                                </template>
                            </el-table-column>
                            <el-table-column label="操作" width="120">
                                <template #default="{ row }">
                                    <el-button
                                        link
                                        type="primary"
                                        :disabled="
                                            overview.config.readonly ||
                                            !modelHealth.targetModel
                                        "
                                        @click="
                                            preview({
                                                type: 'model-reference-migration',
                                                fromModel: row.model,
                                                targetModel: modelHealth.targetModel,
                                                scopes: modelReferenceScopes(row),
                                                includeArchived:
                                                    modelHealth.includeArchived
                                            })
                                        "
                                    >
                                        预览迁移
                                    </el-button>
                                </template>
                            </el-table-column>
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
                                <div>
                                    <article
                                        v-for="msg in visibleMessages"
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
                                    <div
                                        v-if="messageChainTruncated"
                                        class="message-truncated"
                                    >
                                        <span>
                                            仅展示最近 {{ visibleMessages.length }} / {{ detail.messages.length }} 条
                                        </span>
                                        <el-button
                                            link
                                            type="primary"
                                            @click="showAllMessages = true"
                                        >
                                            展开全部
                                        </el-button>
                                    </div>
                                </div>
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
                    <div class="permission-console">
                        <section class="panel permission-shell">
                            <div class="panel-head wrap">
                                <div>
                                    <h2>Koishi 权限诊断台</h2>
                                    <p>
                                        从身份、频道受理、指令继承链三个角度判断权限问题。
                                    </p>
                                </div>
                                <div class="filters">
                                    <el-input
                                        v-model="perm.query"
                                        :prefix-icon="Search"
                                        clearable
                                        size="small"
                                        placeholder="搜索用户 / 平台账号 / 权限"
                                        @keydown.enter="loadPermissions(1)"
                                        @clear="loadPermissions(1)"
                                    />
                                    <el-select
                                        v-model="perm.platform"
                                        clearable
                                        filterable
                                        size="small"
                                        placeholder="平台"
                                        @change="loadPermissions(1)"
                                    >
                                        <el-option
                                            v-for="item in platformChoices"
                                            :key="item"
                                            :label="item"
                                            :value="item"
                                        />
                                    </el-select>
                                    <el-select
                                        v-model="perm.inactiveDays"
                                        clearable
                                        size="small"
                                        placeholder="活跃筛选"
                                        @change="loadPermissions(1)"
                                    >
                                        <el-option label="30 天未活跃" :value="30" />
                                        <el-option label="90 天未活跃" :value="90" />
                                        <el-option label="180 天未活跃" :value="180" />
                                        <el-option label="365 天未活跃" :value="365" />
                                    </el-select>
                                    <el-button
                                        size="small"
                                        type="primary"
                                        plain
                                        @click="loadPermissions(1)"
                                    >
                                        刷新
                                    </el-button>
                                    <el-button
                                        size="small"
                                        type="primary"
                                        :disabled="overview.config.readonly || !perm.users.some((row) => row.accounts.length)"
                                        @click="refreshCurrentPageIdentities"
                                    >
                                        刷新本页身份
                                    </el-button>
                                </div>
                            </div>

                            <div class="permission-stats">
                                <span>用户 {{ perm.totals.users }}</span>
                                <span>账号绑定 {{ perm.totals.bindings }}</span>
                                <span>频道 {{ perm.totals.channels }}</span>
                                <span>ACL {{ perm.totals.acl }}</span>
                                <span>风险 {{ perm.totals.issues }}</span>
                                <span>当前筛选 {{ perm.userTotal }}</span>
                            </div>

                            <el-tabs v-model="perm.view" class="inner-tabs">
                                <el-tab-pane name="identity" label="身份总览">
                                    <div class="permission-grid">
                                        <div class="permission-main">
                                            <el-table
                                                :data="perm.users"
                                                height="560"
                                                highlight-current-row
                                                @row-click="selectPermissionUser"
                                            >
                                                <el-table-column label="用户" min-width="260">
                                                    <template #default="{ row }">
                                                        <div class="stack">
                                                            <strong>{{ row.displayName }}</strong>
                                                            <span>{{ row.nameSource }} / {{ row.identitySource || '-' }}</span>
                                                            <code>{{ row.accounts.map((item) => `${item.platform}:${item.name || item.id}`).join(', ') || row.id }}</code>
                                                        </div>
                                                    </template>
                                                </el-table-column>
                                                <el-table-column label="状态" width="130">
                                                    <template #default="{ row }">
                                                        <el-tag
                                                            :type="activeType(row.activeLevel, row.riskLevel)"
                                                            effect="plain"
                                                            size="small"
                                                        >
                                                            {{ activeText(row.activeLevel, row.riskLevel) }}
                                                        </el-tag>
                                                    </template>
                                                </el-table-column>
                                                <el-table-column label="活跃" width="150">
                                                    <template #default="{ row }">
                                                        <div class="stack">
                                                            <strong>{{ row.inactiveDays == null ? '-' : `${row.inactiveDays} 天前` }}</strong>
                                                            <span>{{ shortTime(row.lastActiveAt) }}</span>
                                                        </div>
                                                    </template>
                                                </el-table-column>
                                                <el-table-column label="authority" width="160">
                                                    <template #default="{ row }">
                                                        <el-input-number
                                                            v-model="row.authority"
                                                            :min="0"
                                                            :max="5"
                                                            size="small"
                                                            class="wide"
                                                            :disabled="overview.config.readonly"
                                                        />
                                                    </template>
                                                </el-table-column>
                                                <el-table-column label="permissions" min-width="280">
                                                    <template #default="{ row }">
                                                        <el-select
                                                            v-model="row.permissions"
                                                            multiple
                                                            filterable
                                                            allow-create
                                                            default-first-option
                                                            size="small"
                                                            class="wide"
                                                            :disabled="overview.config.readonly"
                                                            placeholder="权限字符串"
                                                        >
                                                            <el-option
                                                                v-for="item in permissionChoices"
                                                                :key="item"
                                                                :label="item"
                                                                :value="item"
                                                            />
                                                        </el-select>
                                                    </template>
                                                </el-table-column>
                                                <el-table-column label="ChatLuna" width="110">
                                                    <template #default="{ row }">
                                                        {{ row.chatlunaConversations }} / {{ row.chatlunaMessages ?? '-' }}
                                                    </template>
                                                </el-table-column>
                                                <el-table-column label="操作" width="170" fixed="right">
                                                    <template #default="{ row }">
                                                        <el-button
                                                            link
                                                            type="primary"
                                                            @click.stop="selectPermissionUser(row)"
                                                        >
                                                            详情
                                                        </el-button>
                                                        <el-button
                                                            link
                                                            type="primary"
                                                            :disabled="overview.config.readonly"
                                                            @click.stop="saveKoishiUser(row)"
                                                        >
                                                            保存
                                                        </el-button>
                                                        <el-button
                                                            link
                                                            type="primary"
                                                            :disabled="overview.config.readonly || !row.principals.length"
                                                            @click.stop="refreshIdentity(row)"
                                                        >
                                                            刷新身份
                                                        </el-button>
                                                    </template>
                                                </el-table-column>
                                            </el-table>
                                            <div class="pager compact">
                                                <el-pagination
                                                    v-model:current-page="perm.userPage"
                                                    background
                                                    small
                                                    layout="prev, pager, next, total"
                                                    :page-size="perm.pageSize"
                                                    :total="perm.userTotal"
                                                    @current-change="loadPermissions"
                                                />
                                            </div>
                                        </div>
                                        <aside class="permission-side">
                                            <Transition name="soft-slide" mode="out-in">
                                                <div
                                                    v-if="perm.selectedUser"
                                                    :key="perm.selectedUser.id"
                                                    class="permission-detail"
                                                >
                                                    <h3>{{ perm.selectedUser.displayName }}</h3>
                                                    <dl class="meta">
                                                        <span>ID</span>
                                                        <code>{{ perm.selectedUser.id }}</code>
                                                        <span>名称来源</span>
                                                        <span>{{ perm.selectedUser.nameSource }}</span>
                                                        <span>身份缓存</span>
                                                        <span>{{ shortTime(perm.selectedUser.identityUpdatedAt) || '-' }}</span>
                                                        <span>平台账号</span>
                                                        <code>{{ perm.selectedUser.accounts.map((item) => `${item.platform}:${item.name || item.id}`).join(', ') || '-' }}</code>
                                                        <span>活跃来源</span>
                                                        <span>{{ perm.selectedUser.lastActiveSource || '-' }}</span>
                                                        <span>ChatLuna 会话</span>
                                                        <span>{{ perm.selectedUser.chatlunaConversations }}</span>
                                                        <span>ChatLuna 消息</span>
                                                        <span>{{ perm.selectedUser.chatlunaMessages ?? '未扫描' }}</span>
                                                    </dl>
                                                    <el-button
                                                        size="small"
                                                        type="primary"
                                                        plain
                                                        :disabled="overview.config.readonly || !perm.selectedUser.principals.length"
                                                        @click="refreshIdentity(perm.selectedUser)"
                                                    >
                                                        刷新平台身份
                                                    </el-button>
                                                </div>
                                                <el-empty
                                                    v-else
                                                    key="empty"
                                                    description="点击用户行查看详情"
                                                />
                                            </Transition>
                                        </aside>
                                    </div>
                                </el-tab-pane>

                                <el-tab-pane name="diagnose" label="权限诊断">
                                    <div class="permission-diagnose">
                                        <el-form label-width="90px">
                                            <el-form-item label="用户">
                                                <el-input
                                                    v-model="permDiag.target"
                                                    placeholder="Koishi 用户 ID / 平台账号 ID / 名称"
                                                />
                                            </el-form-item>
                                            <el-form-item label="频道">
                                                <el-input
                                                    v-model="permDiag.channel"
                                                    placeholder="可选：channelId 或 platform:channelId"
                                                />
                                            </el-form-item>
                                            <el-form-item label="指令">
                                                <el-select
                                                    v-model="permDiag.command"
                                                    clearable
                                                    filterable
                                                    placeholder="可选：选择 Koishi 指令"
                                                    class="wide"
                                                >
                                                    <el-option
                                                        v-for="item in perm.commands"
                                                        :key="item.name"
                                                        :label="item.name"
                                                        :value="item.name"
                                                    />
                                                </el-select>
                                            </el-form-item>
                                            <el-form-item>
                                                <el-button type="primary" @click="diagnosePermission">
                                                    开始诊断
                                                </el-button>
                                            </el-form-item>
                                        </el-form>
                                        <section class="diagnose-result" v-if="permDiag.result">
                                            <el-result
                                                :icon="permDiag.result.allowed ? 'success' : permDiag.result.status === 'channel-blocked' ? 'warning' : 'error'"
                                                :title="permDiag.result.allowed ? '允许' : '未通过'"
                                                :sub-title="permDiag.result.status"
                                            />
                                            <el-table :data="permDiag.result.reasons.map((message) => ({ message }))" height="260">
                                                <el-table-column prop="message" label="诊断细节" />
                                            </el-table>
                                            <div class="permission-chains">
                                                <el-tag
                                                    v-for="item in permDiag.result.inherited"
                                                    :key="item"
                                                    size="small"
                                                    effect="plain"
                                                >
                                                    {{ item }}
                                                </el-tag>
                                            </div>
                                        </section>
                                    </div>
                                </el-tab-pane>

                                <el-tab-pane name="auto" label="自动分配">
                                    <div class="permission-auto">
                                        <el-select v-model="permPlan.target" size="small" class="wide">
                                            <el-option label="全部 Koishi 用户" value="all-users" />
                                            <el-option label="有平台绑定的用户" value="bound-users" />
                                            <el-option label="ChatLuna 活跃用户" value="chatluna-users" />
                                            <el-option label="未配置权限用户" value="unconfigured-users" />
                                            <el-option label="长期未活跃用户" value="inactive-users" />
                                            <el-option label="全部频道" value="channels" />
                                            <el-option label="未设置 assignee 的频道" value="channels-empty" />
                                        </el-select>
                                        <el-input-number
                                            v-model="permPlan.inactiveDays"
                                            :min="1"
                                            :max="3650"
                                            size="small"
                                            placeholder="未活跃天数"
                                        />
                                        <el-select v-model="permPlan.permissionMode" size="small" class="wide">
                                            <el-option label="追加权限" value="add" />
                                            <el-option label="替换权限" value="replace" />
                                            <el-option label="移除权限" value="remove" />
                                        </el-select>
                                        <el-select
                                            v-model="permPlan.permissions"
                                            multiple
                                            filterable
                                            allow-create
                                            default-first-option
                                            size="small"
                                            class="wide"
                                            placeholder="权限字符串"
                                        >
                                            <el-option
                                                v-for="item in permissionChoices"
                                                :key="item"
                                                :label="item"
                                                :value="item"
                                            />
                                        </el-select>
                                        <el-input-number
                                            v-model="permPlan.authority"
                                            :min="0"
                                            :max="5"
                                            size="small"
                                            placeholder="authority"
                                        />
                                        <el-input v-model="permPlan.assignee" size="small" placeholder="频道 assignee" />
                                        <el-button
                                            size="small"
                                            type="primary"
                                            plain
                                            :disabled="overview.config.readonly"
                                            @click="previewKoishiPlan"
                                        >
                                            预览自动分配
                                        </el-button>
                                    </div>
                                </el-tab-pane>

                                <el-tab-pane name="maintenance" label="维护清理">
                                    <div class="permission-maintenance">
                                        <el-table :data="perm.issues" height="300">
                                            <el-table-column label="权限提示" min-width="260">
                                                <template #default="{ row }">
                                                    <div class="stack">
                                                        <strong>{{ row.target }}</strong>
                                                        <span>{{ row.message }}</span>
                                                    </div>
                                                </template>
                                            </el-table-column>
                                            <el-table-column label="级别" width="100">
                                                <template #default="{ row }">
                                                    <el-tag
                                                        :type="row.level === 'warning' ? 'warning' : 'info'"
                                                        effect="plain"
                                                        size="small"
                                                    >
                                                        {{ row.level === 'warning' ? '注意' : '提示' }}
                                                    </el-tag>
                                                </template>
                                            </el-table-column>
                                            <el-table-column prop="action" label="建议" min-width="260" />
                                        </el-table>
                                        <div class="permission-auto">
                                            <el-select v-model="permMaintenance.type" size="small" class="wide">
                                                <el-option label="长期未活跃用户降权" value="inactive-down" />
                                                <el-option label="为空频道设置 assignee" value="channels-assign" />
                                            </el-select>
                                            <el-input-number v-model="permMaintenance.days" :min="1" :max="3650" size="small" />
                                            <el-input-number v-model="permMaintenance.authority" :min="0" :max="5" size="small" />
                                            <el-select
                                                v-model="permMaintenance.permissions"
                                                multiple
                                                filterable
                                                allow-create
                                                default-first-option
                                                size="small"
                                                class="wide"
                                                placeholder="降权后权限"
                                            >
                                                <el-option
                                                    v-for="item in permissionChoices"
                                                    :key="item"
                                                    :label="item"
                                                    :value="item"
                                                />
                                            </el-select>
                                            <el-input v-model="permMaintenance.assignee" size="small" placeholder="assignee" />
                                            <el-button
                                                size="small"
                                                type="primary"
                                                plain
                                                :disabled="overview.config.readonly"
                                                @click="previewMaintenance"
                                            >
                                                预览维护
                                            </el-button>
                                        </div>
                                    </div>
                                </el-tab-pane>
                            </el-tabs>
                        </section>

                        <section class="panel">
                            <div class="panel-head wrap">
                                <div>
                                    <h2>频道权限</h2>
                                    <p>频道受理人和频道级 permissions 会影响最终指令权限。</p>
                                </div>
                            </div>
                            <el-table :data="perm.channels" height="260">
                                <el-table-column label="频道" min-width="260">
                                    <template #default="{ row }">
                                        <div class="stack">
                                            <strong>{{ row.platform }}</strong>
                                            <code>{{ row.id }}</code>
                                        </div>
                                    </template>
                                </el-table-column>
                                <el-table-column label="assignee" width="180">
                                    <template #default="{ row }">
                                        <el-input v-model="row.assignee" size="small" :disabled="overview.config.readonly" />
                                    </template>
                                </el-table-column>
                                <el-table-column label="permissions" min-width="260">
                                    <template #default="{ row }">
                                        <el-select
                                            v-model="row.permissions"
                                            multiple
                                            filterable
                                            allow-create
                                            default-first-option
                                            size="small"
                                            class="wide"
                                            :disabled="overview.config.readonly"
                                        >
                                            <el-option
                                                v-for="item in permissionChoices"
                                                :key="item"
                                                :label="item"
                                                :value="item"
                                            />
                                        </el-select>
                                    </template>
                                </el-table-column>
                                <el-table-column label="操作" width="110">
                                    <template #default="{ row }">
                                        <el-button
                                            link
                                            type="primary"
                                            :disabled="overview.config.readonly"
                                            @click="saveKoishiChannel(row)"
                                        >
                                            保存
                                        </el-button>
                                    </template>
                                </el-table-column>
                            </el-table>
                        </section>

                        <section class="panel">
                            <div class="panel-head wrap">
                                <div>
                                    <h2>ChatLuna 会话授权</h2>
                                    <p>只管理 ChatLuna 会话 ACL，不影响 Koishi 原生权限。</p>
                                </div>
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
                            <el-table :data="acl.rows" height="320">
                                <el-table-column label="conversationId" min-width="280">
                                    <template #default="{ row }">
                                        <code>{{ row.conversationId }}</code>
                                    </template>
                                </el-table-column>
                                <el-table-column prop="principalType" label="类型" width="110" />
                                <el-table-column label="principalId" min-width="220">
                                    <template #default="{ row }">
                                        <code>{{ row.principalId }}</code>
                                    </template>
                                </el-table-column>
                                <el-table-column prop="permission" label="权限" width="130" />
                                <el-table-column label="操作" width="150">
                                    <template #default="{ row }">
                                        <el-button link type="primary" :disabled="overview.config.readonly" @click="editAcl(row)">
                                            编辑
                                        </el-button>
                                        <el-button link type="danger" :disabled="overview.config.readonly" @click="removeAcl(row)">
                                            删除
                                        </el-button>
                                    </template>
                                </el-table-column>
                            </el-table>
                            <Pager :data="acl" @change="loadAcl" />
                        </section>
                    </div>
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

                        <el-tab-pane name="ops" label="报错研判">
                            <section class="panel ops-panel">
                                <div class="panel-head wrap">
                                    <div>
                                        <h2>报错研判工作台</h2>
                                        <p>
                                            这里只处理日志事实和诊断结论。修复必须落到完整性页里的表、主键和字段。
                                        </p>
                                    </div>
                                    <div class="filters">
                                        <el-tag size="small" effect="plain">
                                            记录 {{ opsStats.total }}
                                        </el-tag>
                                        <el-tag
                                            v-if="opsStats.danger"
                                            type="danger"
                                            size="small"
                                            effect="plain"
                                        >
                                            危险 {{ opsStats.danger }}
                                        </el-tag>
                                        <el-tag
                                            v-if="opsStats.database"
                                            type="warning"
                                            size="small"
                                            effect="plain"
                                        >
                                            数据库 {{ opsStats.database }}
                                        </el-tag>
                                        <el-button
                                            size="small"
                                            plain
                                            @click="loadOpsErrors"
                                        >
                                            刷新记录
                                        </el-button>
                                        <el-button
                                            size="small"
                                            plain
                                            :disabled="!overview.loadErrors.length"
                                            @click="useLatestOpsError"
                                        >
                                            使用最近数据库错误
                                        </el-button>
                                        <el-button
                                            size="small"
                                            plain
                                            @click="resetOpsWorkspace"
                                        >
                                            重置工作台
                                        </el-button>
                                        <el-button
                                            size="small"
                                            type="danger"
                                            plain
                                            :disabled="
                                                overview.config.readonly ||
                                                !ops.rows.length
                                            "
                                            @click="resetOpsErrors"
                                        >
                                            清空记录
                                        </el-button>
                                    </div>
                                </div>

                                <el-alert
                                    type="warning"
                                    :closable="false"
                                    show-icon
                                >
                                    <template #title>
                                        报错记录不是错误本身
                                    </template>
                                    <template #default>
                                        清空这里的记录只会清理 data 插件的诊断台账；306、坏 JSON、坏消息链仍要在源头数据完整性里扫描和修复。
                                        <el-button
                                            size="small"
                                            type="primary"
                                            plain
                                            @click="goToIntegrity"
                                        >
                                            去修源头
                                        </el-button>
                                    </template>
                                </el-alert>

                                <div class="ops-flow">
                                    <article>
                                        <span>1</span>
                                        <h3>报错记录</h3>
                                        <p>来自 Koishi logger 或手动粘贴，只证明发生过什么。</p>
                                    </article>
                                    <article>
                                        <span>2</span>
                                        <h3>诊断结论</h3>
                                        <p>根据堆栈和完整性扫描给出可能原因、影响和证据。</p>
                                    </article>
                                    <article>
                                        <span>3</span>
                                        <h3>源头处置</h3>
                                        <p>真正改数据库时必须进入完整性页预览后执行。</p>
                                    </article>
                                </div>

                                <div class="ops-workspace">
                                    <section class="ops-card">
                                        <div class="ops-card-head">
                                            <div>
                                                <h3>记录台账</h3>
                                                <p>
                                                    点击一行会加载对应的原始报错和诊断，不会执行任何修复。
                                                </p>
                                            </div>
                                            <el-tag size="small" effect="plain">
                                                {{ opsStats.lastAt ? shortTime(opsStats.lastAt) : '无记录' }}
                                            </el-tag>
                                        </div>
                                        <div class="ops-history">
                                            <el-table
                                                :data="ops.rows"
                                                height="360"
                                                highlight-current-row
                                                empty-text="还没有捕获到 ChatLuna 运维报错"
                                                @row-click="selectOpsRecord"
                                            >
                                                <el-table-column label="时间" width="150">
                                                    <template #default="{ row }">
                                                        {{ shortTime(row.createdAt) }}
                                                    </template>
                                                </el-table-column>
                                                <el-table-column label="来源" width="128">
                                                    <template #default="{ row }">
                                                        <div class="stack">
                                                            <el-tag
                                                                size="small"
                                                                effect="plain"
                                                            >
                                                                {{ row.source }}
                                                            </el-tag>
                                                            <code>{{ row.logger }}</code>
                                                        </div>
                                                    </template>
                                                </el-table-column>
                                                <el-table-column
                                                    label="结论"
                                                    min-width="260"
                                                >
                                                    <template #default="{ row }">
                                                        <div class="stack">
                                                            <strong>
                                                                {{ row.analysis.title || '未命名诊断' }}
                                                            </strong>
                                                            <span>{{ row.analysis.kind }}</span>
                                                        </div>
                                                    </template>
                                                </el-table-column>
                                                <el-table-column label="级别" width="86">
                                                    <template #default="{ row }">
                                                        <el-tag
                                                            :type="
                                                                healthType(
                                                                    row.analysis.severity
                                                                )
                                                            "
                                                            size="small"
                                                            effect="plain"
                                                        >
                                                            {{
                                                                healthText(
                                                                    row.analysis.severity
                                                                )
                                                            }}
                                                        </el-tag>
                                                    </template>
                                                </el-table-column>
                                                <el-table-column
                                                    prop="message"
                                                    label="原始报错"
                                                    min-width="300"
                                                    show-overflow-tooltip
                                                />
                                            </el-table>
                                        </div>
                                    </section>

                                    <section class="ops-card ops-diagnosis">
                                        <div class="ops-card-head">
                                            <div>
                                                <h3>手动研判</h3>
                                                <p>
                                                    粘贴完整堆栈后分析，结果会进入记录台账，方便复盘。
                                                </p>
                                            </div>
                                            <el-tag
                                                v-if="ops.selected"
                                                size="small"
                                                effect="plain"
                                            >
                                                当前：{{ shortTime(ops.selected.createdAt) }}
                                            </el-tag>
                                        </div>
                                        <el-input
                                            v-model="ops.input"
                                            type="textarea"
                                            :rows="11"
                                            resize="vertical"
                                            placeholder="粘贴 Koishi / ChatLuna 完整报错堆栈。这里不会修复源头数据，只会生成诊断记录。"
                                        />
                                        <div class="ops-toolbar">
                                            <el-button
                                                type="primary"
                                                :loading="ops.analyzing"
                                                @click="analyzeOpsError"
                                            >
                                                分析并记录
                                            </el-button>
                                            <el-button
                                                plain
                                                :disabled="!overview.loadErrors.length"
                                                @click="useLatestOpsError"
                                            >
                                                填入最近数据库错误
                                            </el-button>
                                            <el-button plain @click="resetOpsWorkspace">
                                                只重置输入
                                            </el-button>
                                        </div>

                                        <div
                                            v-if="ops.result"
                                            class="ops-result"
                                        >
                                            <el-alert
                                                :type="healthType(ops.result.severity)"
                                                :closable="false"
                                                show-icon
                                            >
                                                <template #title>
                                                    诊断结论：{{ ops.result.title }}
                                                </template>
                                                <template #default>
                                                    <div class="ops-alert-body">
                                                        <p>{{ ops.result.summary }}</p>
                                                        <p>{{ ops.result.impact }}</p>
                                                        <el-tag size="small" effect="plain">
                                                            {{ ops.result.kind }}
                                                        </el-tag>
                                                        <el-tag size="small" effect="plain">
                                                            置信度 {{ ops.result.confidence }}
                                                        </el-tag>
                                                    </div>
                                                </template>
                                            </el-alert>
                                        </div>
                                        <el-empty
                                            v-else
                                            description="选择一条记录，或粘贴报错后点击分析"
                                        />
                                    </section>
                                </div>

                                <div
                                    v-if="ops.result"
                                    class="ops-source-grid"
                                >
                                    <section class="ops-card">
                                        <div class="ops-card-head">
                                            <div>
                                                <h3>处置路径</h3>
                                                <p>
                                                    data 只给出运维路径；危险操作仍要在目标页面预览确认。
                                                </p>
                                            </div>
                                        </div>
                                        <div class="ops-actions">
                                            <article
                                                v-for="item in ops.result.actions"
                                                :key="item.title"
                                                class="ops-action"
                                                :class="item.level"
                                            >
                                                <div class="ops-action-head">
                                                    <h3>{{ item.title }}</h3>
                                                    <el-tag
                                                        :type="opsLevelType(item.level)"
                                                        size="small"
                                                        effect="plain"
                                                    >
                                                        {{ item.level }}
                                                    </el-tag>
                                                </div>
                                                <p>{{ item.description }}</p>
                                                <ol>
                                                    <li
                                                        v-for="step in item.steps"
                                                        :key="step"
                                                    >
                                                        {{ step }}
                                                    </li>
                                                </ol>
                                                <el-button
                                                    v-if="
                                                        item.target.includes(
                                                            'integrity'
                                                        )
                                                    "
                                                    size="small"
                                                    type="primary"
                                                    plain
                                                    @click="goToIntegrity"
                                                >
                                                    打开完整性扫描
                                                </el-button>
                                                <el-button
                                                    v-else-if="
                                                        item.target === 'model-health'
                                                    "
                                                    size="small"
                                                    type="primary"
                                                    plain
                                                    @click="active = 'models'"
                                                >
                                                    打开模型健康
                                                </el-button>
                                                <el-button
                                                    v-else-if="item.target === 'health'"
                                                    size="small"
                                                    plain
                                                    @click="advanced = 'health'"
                                                >
                                                    打开系统健康
                                                </el-button>
                                                <el-button
                                                    v-else-if="item.target === 'config'"
                                                    size="small"
                                                    plain
                                                    @click="
                                                        active = 'advanced';
                                                        advanced = 'config'
                                                    "
                                                >
                                                    打开配置页
                                                </el-button>
                                            </article>
                                        </div>
                                    </section>

                                    <section class="ops-card">
                                        <div class="ops-card-head">
                                            <div>
                                                <h3>证据与关联源头</h3>
                                                <p>
                                                    这些是定位线索。能修复的对象会在完整性页按表、主键、字段展示。
                                                </p>
                                            </div>
                                            <el-button
                                                size="small"
                                                type="primary"
                                                plain
                                                @click="goToIntegrity"
                                            >
                                                去源头修复
                                            </el-button>
                                        </div>

                                        <div
                                            v-if="ops.result.related.scanSummary"
                                            class="integrity-summary"
                                        >
                                            <span>
                                                同步扫描发现
                                                {{ ops.result.related.scanSummary.total }}
                                                条数据问题
                                            </span>
                                            <el-tag
                                                v-for="(count, kind) in ops.result.related.scanSummary.byKind"
                                                :key="kind"
                                                size="small"
                                                effect="plain"
                                            >
                                                {{ kind }} · {{ count }}
                                            </el-tag>
                                        </div>

                                        <el-table
                                            v-if="ops.result.evidence.length"
                                            :data="ops.result.evidence"
                                            height="180"
                                        >
                                            <el-table-column
                                                prop="label"
                                                label="来源"
                                                min-width="180"
                                            />
                                            <el-table-column
                                                prop="value"
                                                label="内容"
                                                min-width="360"
                                                show-overflow-tooltip
                                            />
                                        </el-table>

                                        <el-table
                                            v-if="ops.result.related.issues.length"
                                            :data="ops.result.related.issues"
                                            height="220"
                                        >
                                            <el-table-column
                                                label="源头对象"
                                                min-width="260"
                                            >
                                                <template #default="{ row }">
                                                    <div class="stack">
                                                        <code>
                                                            {{ row.table }}.{{
                                                                row.field
                                                            }}
                                                        </code>
                                                        <span>{{ row.recordId }}</span>
                                                    </div>
                                                </template>
                                            </el-table-column>
                                            <el-table-column
                                                label="问题"
                                                min-width="240"
                                            >
                                                <template #default="{ row }">
                                                    <div class="stack">
                                                        <strong>
                                                            {{ row.errorCode || row.kind }}
                                                        </strong>
                                                        <span>{{ row.snippet }}</span>
                                                    </div>
                                                </template>
                                            </el-table-column>
                                        </el-table>

                                        <el-empty
                                            v-if="
                                                !ops.result.evidence.length &&
                                                !ops.result.related.issues.length
                                            "
                                            description="当前诊断没有可定位到具体行的源头证据"
                                        />
                                    </section>
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

                        <el-tab-pane name="integrity" label="完整性">
                            <section class="panel integrity-panel">
                                <div class="panel-head wrap">
                                    <div>
                                        <h2>源头数据完整性修复</h2>
                                        <p>
                                            这里处理真实数据库对象：表、主键、字段。报错记录只负责提示症状，源头修复必须落到具体数据。
                                        </p>
                                    </div>
                                    <div class="filters">
                                        <el-checkbox v-model="integrity.deep">
                                            深度扫描（解压消息体）
                                        </el-checkbox>
                                        <el-button
                                            size="small"
                                            type="primary"
                                            plain
                                            :loading="integrity.scanning"
                                            @click="scanIntegrity"
                                        >
                                            开始扫描
                                        </el-button>
                                        <el-button
                                            size="small"
                                            plain
                                            :disabled="!integrity.issues.length"
                                            @click="copyIntegrityReport"
                                        >
                                            复制报告
                                        </el-button>
                                        <el-button
                                            size="small"
                                            type="warning"
                                            plain
                                            :disabled="
                                                overview.config.readonly ||
                                                selectedIntegrityFixable('null-field') === 0
                                            "
                                            @click="previewIntegrityRepair('null-field')"
                                        >
                                            安全置空（{{ selectedIntegrityFixable('null-field') }}）
                                        </el-button>
                                        <el-button
                                            size="small"
                                            type="danger"
                                            :disabled="
                                                overview.config.readonly ||
                                                selectedIntegrityFixable('remove-row') === 0
                                            "
                                            @click="previewIntegrityRepair('remove-row')"
                                        >
                                            删除行（{{ selectedIntegrityFixable('remove-row') }}）
                                        </el-button>
                                    </div>
                                </div>

                                <div class="integrity-kpis">
                                    <div>
                                        <span>问题总数</span>
                                        <strong>{{ integrity.summary?.total ?? 0 }}</strong>
                                    </div>
                                    <div>
                                        <span>严重</span>
                                        <strong>{{ integritySeverityCount.danger }}</strong>
                                    </div>
                                    <div>
                                        <span>可自动处理</span>
                                        <strong>{{ integrityAutoFixCount }}</strong>
                                    </div>
                                    <div>
                                        <span>Driver 失败</span>
                                        <strong>{{ integrity.loadErrors.length }}</strong>
                                    </div>
                                </div>

                                <div class="integrity-methods">
                                    <article>
                                        <h3>安全置空</h3>
                                        <p>
                                            适合可选 JSON 元数据、tool_calls、悬空 latestMessageId。写入 {}、[] 或空字符串，让运行时恢复读取。
                                        </p>
                                        <el-tag type="success" effect="plain">
                                            优先尝试
                                        </el-tag>
                                    </article>
                                    <article>
                                        <h3>隔离删除</h3>
                                        <p>
                                            适合坏消息体、无效 ACL、坏归档记录。删除前先备份数据库，删除后重新扫描。
                                        </p>
                                        <el-tag type="warning" effect="plain">
                                            谨慎
                                        </el-tag>
                                    </article>
                                    <article>
                                        <h3>手工恢复</h3>
                                        <p>
                                            适合重要历史记录或 driver-load-error 未定位到行时。复制报告后停 Koishi，用 SQLite 工具修。
                                        </p>
                                        <el-tag type="info" effect="plain">
                                            高保真
                                        </el-tag>
                                    </article>
                                </div>

                                <div
                                    v-if="integrity.loadErrors.length"
                                    class="integrity-load-errors"
                                >
                                        <h3>Driver 加载失败</h3>
                                        <p>
                                        以下是读取阶段捕获到的失败来源。只有定位到真实表、主键、字段后，才会进入下方可修复列表。
                                    </p>
                                    <ul>
                                        <li
                                            v-for="row in integrity.loadErrors"
                                            :key="row.table"
                                        >
                                            <code>{{ row.table }}</code>
                                            — {{ row.message }}
                                        </li>
                                    </ul>
                                </div>

                                <div class="integrity-filterbar">
                                    <el-select
                                        v-model="integrity.filterSeverity"
                                        size="small"
                                        clearable
                                        placeholder="级别"
                                    >
                                        <el-option label="严重" value="danger" />
                                        <el-option label="警告" value="warning" />
                                        <el-option label="提示" value="info" />
                                    </el-select>
                                    <el-select
                                        v-model="integrity.filterFix"
                                        size="small"
                                        clearable
                                        placeholder="处置方式"
                                    >
                                        <el-option label="安全置空" value="null-field" />
                                        <el-option label="删除行" value="remove-row" />
                                        <el-option label="手工处理" value="manual" />
                                    </el-select>
                                    <el-select
                                        v-model="integrity.filterTable"
                                        size="small"
                                        clearable
                                        filterable
                                        placeholder="表"
                                    >
                                        <el-option
                                            v-for="item in integrityTables"
                                            :key="item"
                                            :label="item"
                                            :value="item"
                                        />
                                    </el-select>
                                    <el-select
                                        v-model="integrity.filterKind"
                                        size="small"
                                        clearable
                                        filterable
                                        placeholder="问题类型"
                                    >
                                        <el-option
                                            v-for="item in integrityKinds"
                                            :key="item"
                                            :label="item"
                                            :value="item"
                                        />
                                    </el-select>
                                    <el-button
                                        size="small"
                                        plain
                                        @click="clearIntegrityFilters"
                                    >
                                        清空筛选
                                    </el-button>
                                </div>

                                <div v-if="integrity.summary" class="integrity-summary">
                                    <span>当前显示 {{ filteredIntegrityIssues.length }} / {{ integrity.summary.total }}</span>
                                    <el-tag
                                        v-for="(count, kind) in integrity.summary.byKind"
                                        :key="kind"
                                        size="small"
                                        effect="plain"
                                    >
                                        {{ kind }} · {{ count }}
                                    </el-tag>
                                </div>

                                <el-table
                                    :data="filteredIntegrityIssues"
                                    height="540"
                                    @selection-change="onIntegritySelect"
                                >
                                    <el-table-column
                                        type="selection"
                                        width="44"
                                        :selectable="canSelectIntegrityRow"
                                    />
                                    <el-table-column prop="severity" label="级别" width="80">
                                        <template #default="{ row }">
                                            <el-tag
                                                :type="row.severity === 'danger' ? 'danger' : row.severity === 'warning' ? 'warning' : 'info'"
                                                size="small"
                                                effect="plain"
                                            >
                                                {{ row.severity }}
                                            </el-tag>
                                        </template>
                                    </el-table-column>
                                    <el-table-column label="对象" min-width="260">
                                        <template #default="{ row }">
                                            <div class="stack">
                                                <code>{{ row.table }}.{{ row.field }}</code>
                                                <span>{{ row.recordId }}</span>
                                            </div>
                                        </template>
                                    </el-table-column>
                                    <el-table-column label="问题" min-width="320">
                                        <template #default="{ row }">
                                            <div class="stack">
                                                <strong>{{ row.errorCode || row.kind }}</strong>
                                                <span>{{ row.reason || row.kind }}</span>
                                            </div>
                                        </template>
                                    </el-table-column>
                                    <el-table-column
                                        prop="snippet"
                                        label="样例"
                                        min-width="180"
                                        show-overflow-tooltip
                                    />
                                    <el-table-column label="处置建议" min-width="300">
                                        <template #default="{ row }">
                                            <span>{{ row.recommendation || fixText(row.suggestedFix) }}</span>
                                        </template>
                                    </el-table-column>
                                    <el-table-column label="操作" width="250" fixed="right">
                                        <template #default="{ row }">
                                            <el-button
                                                size="small"
                                                type="warning"
                                                plain
                                                :disabled="
                                                    overview.config.readonly ||
                                                    !canApplyIntegrityAction(
                                                        row,
                                                        'null-field'
                                                    )
                                                "
                                                @click="previewIntegrityRepair('null-field', [row])"
                                            >
                                                安全置空
                                            </el-button>
                                            <el-button
                                                size="small"
                                                type="danger"
                                                plain
                                                :disabled="
                                                    overview.config.readonly ||
                                                    !canApplyIntegrityAction(
                                                        row,
                                                        'remove-row'
                                                    )
                                                "
                                                @click="previewIntegrityRepair('remove-row', [row])"
                                            >
                                                删除
                                            </el-button>
                                            <el-button
                                                size="small"
                                                plain
                                                :disabled="
                                                    overview.config.readonly ||
                                                    !canEditIntegrityRow(row)
                                                "
                                                @click="openIntegrityEdit(row)"
                                            >
                                                手动
                                            </el-button>
                                        </template>
                                    </el-table-column>
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
                            <span>
                                {{
                                    row.targetModel
                                        ? `${row.field || 'model'} -> ${row.targetModel}`
                                        : row.status || row.fileState || '-'
                                }}
                            </span>
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

        <el-dialog
            v-model="integrityPreview.open"
            title="完整性修复预览"
            width="860px"
        >
            <div class="preview-head">
                <el-statistic
                    title="将处理"
                    :value="integrityPreview.data.count"
                />
                <el-tag
                    :type="integrityPreview.action === 'remove-row' ? 'danger' : 'warning'"
                    effect="plain"
                >
                    {{ integrityPreview.action === 'remove-row' ? '删除行' : '安全置空' }}
                </el-tag>
            </div>
            <div class="tags warn">
                <el-tag
                    v-for="item in integrityPreview.data.warnings"
                    :key="item"
                    type="warning"
                    effect="plain"
                >
                    {{ item }}
                </el-tag>
            </div>
            <el-table :data="integrityPreview.data.rows" height="320">
                <el-table-column label="对象" min-width="260">
                    <template #default="{ row }">
                        <div class="stack">
                            <code>{{ row.table }}.{{ row.field }}</code>
                            <span>{{ row.recordId }}</span>
                        </div>
                    </template>
                </el-table-column>
                <el-table-column label="问题" min-width="260">
                    <template #default="{ row }">
                        <div class="stack">
                            <strong>{{ row.errorCode || row.kind }}</strong>
                            <span>{{ row.reason || '-' }}</span>
                        </div>
                    </template>
                </el-table-column>
                <el-table-column
                    prop="snippet"
                    label="样例"
                    min-width="180"
                    show-overflow-tooltip
                />
            </el-table>
            <template #footer>
                <el-button @click="integrityPreview.open = false">取消</el-button>
                <el-button
                    :type="integrityPreview.action === 'remove-row' ? 'danger' : 'warning'"
                    :disabled="
                        overview.config.readonly ||
                        integrityPreview.data.count === 0
                    "
                    :loading="saving"
                    @click="applyIntegrityPreview"
                >
                    确认执行
                </el-button>
            </template>
        </el-dialog>

        <el-dialog
            v-model="integrityEdit.open"
            title="手动修改字段"
            width="680px"
        >
            <template v-if="integrityEdit.row">
                <div class="kv">
                    <span>表</span>
                    <code>{{ integrityEdit.row.table }}</code>
                    <span>主键</span>
                    <code>{{ integrityEdit.row.recordId }}</code>
                    <span>字段</span>
                    <code>{{ integrityEdit.row.field }}</code>
                    <span>问题</span>
                    <span>{{ integrityEdit.row.reason }}</span>
                </div>
                <el-divider />
                <el-input
                    v-model="integrityEdit.value"
                    type="textarea"
                    :rows="8"
                    resize="vertical"
                    :loading="integrityEdit.loading"
                    placeholder='输入要写入的原始文本，例如 {}、[]、"" 或新的 ID'
                />
            </template>
            <template #footer>
                <el-button @click="integrityEdit.open = false">取消</el-button>
                <el-button
                    type="primary"
                    :loading="saving"
                    :disabled="overview.config.readonly || !integrityEdit.row"
                    @click="applyIntegrityEdit"
                >
                    写入
                </el-button>
            </template>
        </el-dialog>

        <el-dialog v-model="permPreview.open" title="权限自动分配预览" width="860px">
            <div class="preview-head">
                <el-statistic title="影响数量" :value="permPreview.data.count" />
            </div>
            <div class="tags warn">
                <el-tag
                    v-for="item in permPreview.data.warnings"
                    :key="item"
                    type="warning"
                    effect="plain"
                >
                    {{ item }}
                </el-tag>
            </div>
            <el-table :data="permPreview.data.rows" height="360">
                <el-table-column label="对象" min-width="260">
                    <template #default="{ row }">
                        <div class="stack">
                            <strong>{{ row.name }}</strong>
                            <code>{{ row.kind }} / {{ row.platform }} / {{ row.id }}</code>
                        </div>
                    </template>
                </el-table-column>
                <el-table-column label="原因" min-width="220" prop="reason" />
                <el-table-column label="authority" width="130">
                    <template #default="{ row }">
                        {{ row.currentAuthority ?? '-' }} -> {{ row.nextAuthority ?? '-' }}
                    </template>
                </el-table-column>
                <el-table-column label="permissions" min-width="260">
                    <template #default="{ row }">
                        <div class="stack">
                            <span>{{ row.currentPermissions.join(', ') || '-' }}</span>
                            <strong>{{ row.nextPermissions.join(', ') || '-' }}</strong>
                        </div>
                    </template>
                </el-table-column>
            </el-table>
            <template #footer>
                <el-button @click="permPreview.open = false">取消</el-button>
                <el-button
                    type="danger"
                    :disabled="overview.config.readonly || permPreview.data.count === 0"
                    :loading="saving"
                    @click="applyKoishiPlan"
                >
                    应用自动分配
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
import {
    computed,
    defineComponent,
    h,
    onMounted,
    reactive,
    ref,
    shallowReactive,
    watch
} from 'vue'
import { router, send } from '@koishijs/client'
import { ElMessage, ElMessageBox, ElPagination } from 'element-plus'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import type {
    Acl,
    Archive,
    Audit,
    Binding,
    ChatChain,
    Conversation,
    ConversationEdit,
    ContextRow,
    Diagnostic,
    HealthIssue,
    IdentityRow,
    IntegrityIssue,
    KoishiBinding,
    KoishiChannel,
    KoishiCommand,
    KoishiUser,
    Message,
    MessageEdit,
    ModelCount,
    ModelHealthIssue,
    ModelHealthIssueGroup,
    ModelReference,
    Operation,
    OpsErrorAnalysis,
    OpsErrorRecord,
    PermissionBinding,
    PermissionChannel,
    PermissionDiagnosis,
    PermissionIssue,
    PermissionPlanRow,
    PermissionUser,
    Provider,
    Resource,
    RouteInfo,
    Rule,
    Tool,
    User
} from './types'
import { configGroups } from './configSchema'
import {
    activeText,
    activeType,
    capabilityText,
    healthText,
    healthType,
    issueTypeText,
    modelReferenceScopes,
    providerStateText,
    providerStateType,
    resourceTypeText,
    roleText,
    roleType,
    routeText,
    shortTime,
    statusText,
    statusType
} from './formatters'

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
// Soft cap on the message-chain panel — long conversations made the per-row
// <pre> render eat the main thread. Default to the last 100; user can opt
// into the full list per conversation.
const MESSAGE_CHAIN_INITIAL = 100
const showAllMessages = ref(false)

// Big result containers: switch to shallowReactive so Vue only tracks the
// top-level `rows`/`totals`/etc. swap when the API returns a new payload
// instead of recursively proxying every row & nested object. All places
// that consume these read top-level keys or iterate read-only rows; rows
// are never mutated in place (mutations happen via API refetch).
const overview = shallowReactive({
    config: {
        pageSize: 40,
        readonly: false,
        maxPreviewRows: 200,
        enableArchiveFileOps: false,
        enableMessageRepair: false,
        identityRefreshLimitPerBatch: 30,
        identityRefreshInterval: 800,
        inactiveWarningDays: 180,
        enableIdentityLookup: true,
        enableKoishiPermissionCommands: true
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
    audits: [] as Audit[],
    loadErrors: [] as IntegrityLoadError[]
})

const quick = reactive({ model: '' })
const users = shallowReactive(pageState<User>())
const contexts = shallowReactive(pageState<ContextRow>())
const resources = shallowReactive(pageState<Resource>())
const providers = shallowReactive(pageState<Provider>())
const modelHealth = shallowReactive({
    query: '',
    platform: '',
    issueType: '',
    targetModel: '',
    includeArchived: false,
    selectedProvider: null as Provider | null,
    summary: {
        score: 100,
        loadedProviders: 0,
        registeredProviders: 0,
        databaseOnlyProviders: 0,
        configAvailable: 0,
        configTotal: 0,
        missingModelRefs: 0,
        missingPresetRefs: 0,
        missingChatModeRefs: 0,
        issues: 0
    },
    providers: [] as Provider[],
    issues: [] as ModelHealthIssue[],
    issueGroups: [] as ModelHealthIssueGroup[],
    modelRefs: [] as ModelReference[],
    resources: [] as Resource[],
    choices: {
        models: [] as string[],
        providers: [] as string[],
        issueTypes: [] as string[]
    }
})
const convs = shallowReactive({
    ...pageState<Conversation>(),
    status: '',
    model: '',
    user: ''
})
const messages = shallowReactive({
    ...pageState<Message>(),
    conversationId: '',
    role: '',
    user: ''
})
const perm = reactive({
    view: 'identity',
    query: '',
    platform: '',
    inactiveDays: null as number | null,
    pageSize: 30,
    userPage: 1,
    bindingPage: 1,
    channelPage: 1,
    issuePage: 1,
    loaded: false,
    totals: {
        users: 0,
        bindings: 0,
        channels: 0,
        acl: 0,
        issues: 0,
        filteredUsers: 0,
        filteredBindings: 0,
        filteredChannels: 0
    },
    userTotal: 0,
    bindingTotal: 0,
    channelTotal: 0,
    permissions: [] as string[],
    issues: [] as PermissionIssue[],
    users: [] as PermissionUser[],
    bindings: [] as PermissionBinding[],
    channels: [] as PermissionChannel[],
    selectedUser: null as PermissionUser | null,
    commands: [] as KoishiCommand[]
})
const acl = shallowReactive(pageState<Acl>())
const rules = shallowReactive(pageState<Rule>())
const archives = shallowReactive(pageState<Archive>())
const health = shallowReactive({
    score: 100,
    totals: {
        danger: 0,
        warning: 0,
        info: 0
    },
    rows: [] as HealthIssue[]
})
const ops = shallowReactive({
    input: '',
    analyzing: false,
    result: null as OpsErrorAnalysis | null,
    rows: [] as OpsErrorRecord[],
    selected: null as OpsErrorRecord | null
})

interface IntegrityLoadError {
    table: string
    message: string
    at: string
}
const integrity = shallowReactive({
    deep: false,
    scanning: false,
    filterSeverity: '',
    filterFix: '',
    filterTable: '',
    filterKind: '',
    issues: [] as IntegrityIssue[],
    selected: [] as IntegrityIssue[],
    summary: null as
        | {
              total: number
              byTable: Record<string, number>
              byKind: Record<string, number>
              loadErrors: number
          }
        | null,
    loadErrors: [] as IntegrityLoadError[],
    scannedAt: ''
})
const integrityPreview = shallowReactive({
    open: false,
    action: 'null-field' as 'null-field' | 'remove-row',
    ids: [] as string[],
    data: {
        count: 0,
        rows: [] as IntegrityIssue[],
        warnings: [] as string[]
    }
})
const integrityEdit = shallowReactive({
    open: false,
    row: null as IntegrityIssue | null,
    value: '',
    loading: false
})

const detail = shallowReactive({
    conversation: null as Conversation | null,
    route: null as RouteInfo | null,
    binding: null as Binding | null,
    bindingRefs: [] as Binding[],
    acl: [] as Acl[],
    archives: [] as Archive[],
    diagnostics: null as Diagnostic | null,
    messages: [] as Message[]
})

const providerDetail = shallowReactive({
    provider: null as Provider | null,
    tools: [] as Tool[],
    chatChains: [] as ChatChain[],
    vectorStores: [] as string[]
})
const contextDetail = ref<ContextRow | null>(null)
const resourceDetail = ref<Resource | null>(null)
const userDetail = shallowReactive({
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

const previewBox = shallowReactive({
    open: false,
    input: null as Operation | null,
    data: {
        count: 0,
        rows: [] as Record<string, unknown>[],
        warnings: [] as string[],
        blocked: false
    }
})

const permPlan = reactive({
    target: 'bound-users',
    inactiveDays: 180,
    permissionMode: 'add',
    permissions: [] as string[],
    authority: null as number | null,
    assignee: ''
})

const permDiag = reactive({
    target: '',
    channel: '',
    command: '',
    result: null as PermissionDiagnosis | null
})

const permMaintenance = reactive({
    type: 'inactive-down',
    days: 180,
    authority: 0,
    permissions: [] as string[],
    assignee: ''
})

const permPreview = shallowReactive({
    open: false,
    mode: 'plan',
    input: null as Record<string, unknown> | null,
    data: {
        count: 0,
        rows: [] as PermissionPlanRow[],
        warnings: [] as string[]
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
const permissionChoices = computed(() =>
    Array.from(
        new Set([
            ...perm.permissions,
            ...perm.users.flatMap((row) => row.permissions),
            ...perm.channels.flatMap((row) => row.permissions),
            'admin',
            'manager',
            'operator'
        ])
    ).filter(Boolean)
)
const platformChoices = computed(() =>
    Array.from(
        new Set([
            ...perm.users.flatMap((row) => row.platforms),
            ...perm.bindings.map((row) => row.platform),
            ...perm.channels.map((row) => row.platform)
        ])
    )
        .filter(Boolean)
        .sort()
)

const modelHealthMetrics = computed(() => [
    { label: '健康分', value: modelHealth.summary.score },
    { label: '已加载', value: modelHealth.summary.loadedProviders },
    { label: '已注册', value: modelHealth.summary.registeredProviders },
    { label: '仅数据库', value: modelHealth.summary.databaseOnlyProviders },
    {
        label: '可用配置',
        value: `${modelHealth.summary.configAvailable}/${modelHealth.summary.configTotal}`
    },
    { label: '缺失模型', value: modelHealth.summary.missingModelRefs },
    {
        label: 'preset/chatMode',
        value:
            modelHealth.summary.missingPresetRefs +
            modelHealth.summary.missingChatModeRefs
    }
])

const missingModelRefs = computed(() =>
    modelHealth.modelRefs.filter((row) => !row.valid)
)
const filteredIntegrityIssues = computed(() =>
    integrity.issues.filter(
        (row) =>
            (!integrity.filterSeverity ||
                row.severity === integrity.filterSeverity) &&
            (!integrity.filterFix ||
                row.suggestedFix === integrity.filterFix) &&
            (!integrity.filterTable || row.table === integrity.filterTable) &&
            (!integrity.filterKind || row.kind === integrity.filterKind)
    )
)
const integrityTables = computed(() =>
    Array.from(new Set(integrity.issues.map((row) => row.table))).sort()
)
const integrityKinds = computed(() =>
    Array.from(new Set(integrity.issues.map((row) => row.kind))).sort()
)
const integritySeverityCount = computed(() => ({
    danger: integrity.issues.filter((row) => row.severity === 'danger').length,
    warning: integrity.issues.filter((row) => row.severity === 'warning').length,
    info: integrity.issues.filter((row) => row.severity === 'info').length
}))
const opsStats = computed(() => ({
    total: ops.rows.length,
    danger: ops.rows.filter((row) => row.analysis.severity === 'danger').length,
    warning: ops.rows.filter((row) => row.analysis.severity === 'warning').length,
    database: ops.rows.filter(
        (row) =>
            row.analysis.kind?.includes('database') ||
            row.analysis.kind?.includes('json') ||
            row.analysis.kind?.includes('message-tool-calls')
    ).length,
    lastAt: ops.rows[0]?.createdAt ?? ''
}))
const integrityAutoFixCount = computed(
    () => integrity.issues.filter((row) => row.suggestedFix !== 'manual').length
)
const resourceJson = computed(() =>
    JSON.stringify(resourceDetail.value?.details ?? {}, null, 2)
)
const visibleMessages = computed(() => {
    const all = detail.messages
    if (showAllMessages.value || all.length <= MESSAGE_CHAIN_INITIAL) return all
    return all.slice(all.length - MESSAGE_CHAIN_INITIAL)
})
const messageChainTruncated = computed(
    () => !showAllMessages.value && detail.messages.length > MESSAGE_CHAIN_INITIAL
)
const metricRows = computed(() => [
    {
        key: 'overview',
        label: '总览',
        value: overview.totals.issues,
        tab: 'overview'
    },
    {
        key: 'models',
        label: '模型',
        value: modelHealth.summary.issues,
        tab: 'models'
    },
    {
        key: 'conversations',
        label: '会话与消息',
        value: overview.totals.conversations + overview.totals.messages,
        tab: 'conversations'
    },
    {
        key: 'permissions',
        label: '身份与权限',
        value: overview.totals.users + overview.totals.acl,
        tab: 'permissions'
    },
    {
        key: 'maintenance',
        label: '配置与维护',
        value:
            overview.totals.providers +
            overview.totals.resources +
            overview.totals.contexts,
        tab: 'advanced'
    }
])

// Lazy per-tab loaders. A tab's data is only fetched on first activation
// (and on explicit refresh of that tab) instead of all tabs being hydrated
// up front in `onMounted`. This used to fan out 13 endpoints on first paint.
type LoadFn = () => Promise<unknown>
const loadedTabs = new Set<string>()
const tabLoaders: Record<string, LoadFn[]> = {
    overview: [() => loadOverview()],
    models: [
        () => loadModelHealth(),
        () => loadProviders(providers.page)
    ],
    config: [() => loadConfig()],
    users: [() => loadUsers(users.page)],
    conversations: [() => loadConversations(convs.page)],
    messages: [() => loadMessages(messages.page)],
    permissions: [() => loadPermissions(), () => loadAcl(acl.page)],
    rules: [() => loadRules(rules.page)],
    advanced: [
        () => loadProviders(providers.page),
        () => loadContexts(contexts.page),
        () => loadResources(resources.page),
        () => loadArchives(archives.page),
        () => loadHealth(),
        () => loadOpsErrors()
    ]
}

async function ensureTabLoaded(tab: string) {
    if (loadedTabs.has(tab)) return
    loadedTabs.add(tab)
    const loaders = tabLoaders[tab] ?? []
    await Promise.all(loaders.map((fn) => fn()))
}

async function loadOverview() {
    Object.assign(overview, await send('chatluna-data/getOverview'))
}

watch(
    () => quick.model,
    (model) => {
        convs.model = model
        if (active.value === 'conversations') loadConversations(1)
    }
)

watch(
    () => active.value,
    (tab) => {
        void ensureTabLoaded(tab).catch((err) => ElMessage.error(String(err)))
    }
)

function goHome() {
    router.push('/')
}

function goToIntegrity() {
    active.value = 'advanced'
    advanced.value = 'integrity'
}

// Refresh re-fetches the overview (the global counters seen across the app)
// plus whatever tab is currently active. Other tabs are refreshed when the
// user navigates to them.
async function refresh() {
    loading.value = true
    try {
        const tasks: Array<Promise<unknown>> = [loadOverview()]
        const tab = active.value
        if (tab !== 'overview') {
            for (const fn of tabLoaders[tab] ?? []) tasks.push(fn())
        }
        if (detail.conversation) tasks.push(loadDetail(detail.conversation.id))
        await Promise.all(tasks)
        loadedTabs.add(tab)
    } catch (err) {
        ElMessage.error(String(err))
    } finally {
        loading.value = false
    }
}

// Targeted post-mutation refresh. Refetches the overview totals plus only
// the tabs that have been visited and are listed in `tabs`. Untouched tabs
// stay unloaded; they'll fetch fresh data when the user navigates to them.
async function refreshAfter(...tabs: string[]) {
    const tasks: Array<Promise<unknown>> = [loadOverview()]
    for (const tab of tabs) {
        if (!loadedTabs.has(tab)) continue
        for (const fn of tabLoaders[tab] ?? []) tasks.push(fn())
    }
    await Promise.all(tasks)
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

async function loadModelHealth() {
    const data = await send('chatluna-data/getModelHealth', {
        query: modelHealth.query,
        platform: modelHealth.platform,
        issueType: modelHealth.issueType
    })
    modelHealth.summary = data.summary
    modelHealth.providers = data.providers
    modelHealth.issues = data.issues
    modelHealth.issueGroups = data.issueGroups
    modelHealth.modelRefs = data.modelRefs
    modelHealth.resources = data.resources
    modelHealth.choices = data.choices
    const row = modelHealth.providers.find(
        (item) => item.platform === modelHealth.selectedProvider?.platform
    )
    modelHealth.selectedProvider = row ?? modelHealth.providers[0] ?? null
}

function selectModelProvider(row: Provider) {
    modelHealth.selectedProvider = row
}

async function refreshProviderFromHealth(row: Provider) {
    saving.value = true
    try {
        await send('chatluna-data/refreshProvider', {
            platform: row.platform
        })
        ElMessage.success('提供商模型已刷新')
        await refreshAfter('models', 'advanced')
    } finally {
        saving.value = false
    }
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

async function loadPermissions(page = perm.userPage) {
    const data = await send('chatluna-data/getPermissionOverview', {
        page,
        pageSize: perm.pageSize,
        query: perm.query,
        platform: perm.platform || undefined,
        inactiveDays: perm.inactiveDays ?? undefined
    })
    perm.totals = data.totals
    perm.permissions = data.permissions
    perm.issues = data.issues
    perm.users = data.users
    perm.userTotal = data.userTotal
    perm.bindings = data.bindings
    perm.bindingTotal = data.bindingTotal
    perm.channels = data.channels
    perm.channelTotal = data.channelTotal
    perm.userPage = data.page ?? page
    if (!perm.commands.length) {
        perm.commands = await send('chatluna-data/listKoishiCommands')
    }
    perm.loaded = true
}

function resetPermissionPages() {
    perm.userPage = 1
    perm.bindingPage = 1
    perm.channelPage = 1
    perm.issuePage = 1
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

async function loadOpsErrors() {
    const data = await send('chatluna-data/listOpsErrors')
    ops.rows = data.rows
    if (!ops.rows.length) {
        resetOpsWorkspace()
        return
    }
    if (
        (!ops.selected || !ops.rows.some((row) => row.id === ops.selected?.id))
    ) {
        ops.selected = ops.rows[0]
        ops.result = ops.rows[0].analysis
    }
}

function resetOpsWorkspace() {
    ops.input = ''
    ops.result = null
    ops.selected = null
}

async function resetOpsErrors() {
    await ElMessageBox.confirm(
        '这只会清空 data 插件的报错记录与诊断历史，不会修复或删除 ChatLuna 源头数据。继续？',
        '清空报错记录',
        {
            type: 'warning',
            confirmButtonText: '清空记录'
        }
    )
    const data = await send('chatluna-data/resetOpsErrors')
    resetOpsWorkspace()
    ops.rows = []
    ElMessage.success(`已清空 ${data.count ?? 0} 条报错记录`)
}

function useLatestOpsError() {
    const row = overview.loadErrors[0]
    if (!row) return
    ops.input = `${row.message}\n\n捕获表：${row.table}\n时间：${row.at}`
}

function opsLevelType(level: string) {
    if (level === 'recommended') return 'success'
    if (level === 'danger') return 'danger'
    if (level === 'manual') return 'warning'
    return 'info'
}

async function analyzeOpsError() {
    ops.analyzing = true
    try {
        ops.result = await send('chatluna-data/analyzeOpsError', {
            text: ops.input
        })
        await loadOpsErrors()
        if (ops.rows.length) selectOpsRecord(ops.rows[0])
        if (ops.result.related.loadErrors.length) {
            integrity.loadErrors = ops.result.related.loadErrors
        }
    } catch (err) {
        ElMessage.error(String(err))
    } finally {
        ops.analyzing = false
    }
}

function selectOpsRecord(row: OpsErrorRecord) {
    ops.selected = row
    ops.result = row.analysis
    ops.input = row.message
}

async function scanIntegrity() {
    integrity.scanning = true
    try {
        const data = await send('chatluna-data/scanIntegrity', {
            deep: integrity.deep
        })
        integrity.issues = data.issues
        integrity.summary = data.summary
        integrity.loadErrors = data.loadErrors ?? []
        integrity.scannedAt = data.scannedAt
        integrity.selected = []
        ElMessage.success(`扫描完成，发现 ${data.summary.total} 条问题`)
    } catch (err) {
        ElMessage.error(String(err))
    } finally {
        integrity.scanning = false
    }
}

function onIntegritySelect(rows: IntegrityIssue[]) {
    integrity.selected = rows
}

function fixText(fix: string) {
    if (fix === 'null-field') return '安全置空'
    if (fix === 'remove-row') return '删除行'
    return '手工处理'
}

function canSelectIntegrityRow(row: IntegrityIssue) {
    return true
}

function canEditIntegrityRow(row: IntegrityIssue) {
    return row.recordId !== 'driver-load-error' && row.field !== '<unknown>'
}

function canApplyIntegrityAction(
    row: IntegrityIssue,
    action: 'null-field' | 'remove-row'
) {
    if (!canEditIntegrityRow(row)) return false
    if (action === 'null-field') return row.suggestedFix === 'null-field'
    return true
}

function selectedIntegrityFixable(action: 'null-field' | 'remove-row') {
    return integrity.selected.filter((row) =>
        canApplyIntegrityAction(row, action)
    ).length
}

function clearIntegrityFilters() {
    integrity.filterSeverity = ''
    integrity.filterFix = ''
    integrity.filterTable = ''
    integrity.filterKind = ''
}

async function copyIntegrityReport() {
    const lines = [
        `ChatLuna Data Integrity Report ${integrity.scannedAt || ''}`,
        `total=${integrity.summary?.total ?? 0}`,
        ...filteredIntegrityIssues.value.map(
            (row) =>
                `${row.severity} ${row.table}.${row.field} ${row.recordId} ${row.kind} ${row.snippet}`
        )
    ]
    try {
        await navigator.clipboard.writeText(lines.join('\n'))
        ElMessage.success('完整性报告已复制')
    } catch (err) {
        ElMessage.error(String(err))
    }
}

async function previewIntegrityRepair(
    action: 'null-field' | 'remove-row',
    rows = integrity.selected
) {
    const ids = rows
        .filter((row) => canApplyIntegrityAction(row, action))
        .map((row) => row.id)
    if (!ids.length) return
    try {
        const data = await send('chatluna-data/repairIntegrity', {
            issueIds: ids,
            action,
            confirm: false
        })
        integrityPreview.action = action
        integrityPreview.ids = ids
        integrityPreview.data = {
            count: data.count,
            rows: data.rows,
            warnings: data.warnings ?? []
        }
        integrityPreview.open = true
    } catch (err) {
        ElMessage.error(String(err))
    }
}

async function applyIntegrityPreview() {
    saving.value = true
    try {
        await send('chatluna-data/repairIntegrity', {
            issueIds: integrityPreview.ids,
            action: integrityPreview.action,
            confirm: true
        })
        ElMessage.success(
            `已${integrityPreview.action === 'remove-row' ? '删除' : '安全置空'} ${integrityPreview.data.count} 条`
        )
        integrityPreview.open = false
        await scanIntegrity()
    } catch (err) {
        ElMessage.error(String(err))
    } finally {
        saving.value = false
    }
}

async function openIntegrityEdit(row: IntegrityIssue) {
    integrityEdit.row = row
    integrityEdit.value = ''
    integrityEdit.open = true
    integrityEdit.loading = true
    try {
        const data = await send('chatluna-data/getIntegrityField', {
            table: row.table,
            recordId: row.recordId,
            field: row.field
        })
        integrityEdit.value = data.value
    } catch (err) {
        integrityEdit.value =
            row.field === 'users' ||
            row.field === 'excludeUsers' ||
            row.field === 'ids' ||
            row.kind === 'invalid-tool-calls'
                ? '[]'
                : row.suggestedFix === 'null-field'
                  ? '{}'
                  : ''
        ElMessage.warning(String(err))
    } finally {
        integrityEdit.loading = false
    }
}

async function applyIntegrityEdit() {
    if (!integrityEdit.row) return
    saving.value = true
    try {
        await send('chatluna-data/repairIntegrity', {
            issueIds: [integrityEdit.row.id],
            action: 'set-value',
            value: integrityEdit.value,
            confirm: true
        })
        ElMessage.success('字段已写入')
        integrityEdit.open = false
        await scanIntegrity()
    } catch (err) {
        ElMessage.error(String(err))
    } finally {
        saving.value = false
    }
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
        await refreshAfter('models', 'advanced')
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
    showAllMessages.value = false
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
        await Promise.all([
            refreshAfter('conversations', 'messages'),
            loadDetail(detail.conversation.id)
        ])
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
    await refreshAfter('conversations', 'messages', 'users')
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
    await refreshAfter('conversations', 'messages', 'permissions', 'users')
}

async function saveBinding() {
    await send('chatluna-data/saveBinding', {
        mode: 'save',
        row: bindingBox.row
    })
    ElMessage.success('绑定已保存')
    await refreshAfter('conversations', 'permissions')
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
    await refreshAfter('conversations', 'permissions')
}

async function assignConversation() {
    await send('chatluna-data/assignConversation', {
        ...assignBox.row,
        bindingKey: assignBox.row.bindingKey || undefined,
        principalId: assignBox.row.principalId || undefined
    })
    assignBox.open = false
    ElMessage.success('会话已分配')
    await refreshAfter('conversations', 'permissions', 'users')
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
        // Operations span many surfaces (model migration, status change,
        // archive cleanup, message repair). Refresh whatever is currently
        // visited so totals stay accurate.
        const tabs = ['conversations', 'messages', 'models', 'advanced']
        await refreshAfter(...tabs)
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
    await Promise.all([
        loadAcl(acl.page),
        refreshAfter('permissions')
    ])
}

async function removeAcl(row: Acl) {
    await ElMessageBox.confirm('确定删除这条 ACL？', '确认', {
        type: 'warning'
    })
    await send('chatluna-data/saveAcl', { mode: 'remove', row })
    ElMessage.success('ACL 已删除')
    await Promise.all([
        loadAcl(acl.page),
        refreshAfter('permissions')
    ])
}

async function saveKoishiUser(row: PermissionUser) {
    await send('chatluna-data/saveKoishiUserPermission', {
        id: row.id,
        authority: row.authority,
        permissions: row.permissions
    })
    ElMessage.success('Koishi 用户权限已保存')
    await loadPermissions()
}

async function saveKoishiChannel(row: PermissionChannel) {
    await send('chatluna-data/saveKoishiChannelPermission', {
        id: row.id,
        platform: row.platform,
        assignee: row.assignee,
        permissions: row.permissions
    })
    ElMessage.success('频道权限已保存')
    await loadPermissions()
}

function selectPermissionUser(row: PermissionUser) {
    perm.selectedUser = row
    permDiag.target = String(row.principals[0] || row.id)
}

async function refreshIdentity(row: PermissionUser) {
    const account = row.accounts[0]
    if (!account) return
    const data = await send('chatluna-data/refreshKoishiIdentity', {
        platform: account.platform,
        id: account.id
    })
    applyIdentityRows([data])
    ElMessage.success('身份资料已刷新')
    void loadPermissions(perm.userPage)
}

async function refreshCurrentPageIdentities() {
    const rows = perm.users.flatMap((row) =>
        row.accounts.map((item) => ({
            platform: item.platform,
            id: item.id
        }))
    )
    if (!rows.length) return
    saving.value = true
    try {
        const data = await send('chatluna-data/refreshKoishiIdentityBatch', {
            rows
        })
        applyIdentityRows(data.rows)
        ElMessage.success(`已刷新 ${data.count} 个平台账号`)
        void loadPermissions(perm.userPage)
    } finally {
        saving.value = false
    }
}

function applyIdentityRows(rows: IdentityRow[]) {
    const map = new Map(rows.map((row) => [`${row.platform}:${row.id}`, row]))
    for (const row of perm.users) {
        for (const account of row.accounts) {
            const next = map.get(`${account.platform}:${account.id}`)
            if (!next) continue
            account.name = next.name
            account.source = next.source
            account.error = next.error
            account.updatedAt = next.updatedAt
            if (!row.name && next.name && row.nameSource !== 'koishi') {
                row.displayName = next.name
                row.nameSource = 'cache'
                row.identitySource = next.source
                row.identityUpdatedAt = next.updatedAt
            }
        }
    }
    if (perm.selectedUser) {
        perm.selectedUser =
            perm.users.find((row) => row.id === perm.selectedUser?.id) ??
            perm.selectedUser
    }
}

async function diagnosePermission() {
    permDiag.result = await send('chatluna-data/diagnoseKoishiPermission', {
        target: permDiag.target,
        channel: permDiag.channel || undefined,
        command: permDiag.command || undefined
    })
}

async function previewKoishiPlan() {
    const input = {
        target: permPlan.target,
        inactiveDays: permPlan.inactiveDays,
        permissionMode: permPlan.permissionMode,
        permissions: permPlan.permissions,
        authority: permPlan.authority,
        assignee: permPlan.assignee || undefined
    }
    const data = await send('chatluna-data/previewKoishiPermissionPlan', input)
    permPreview.mode = 'plan'
    permPreview.input = input
    permPreview.data = data
    permPreview.open = true
}

async function applyKoishiPlan() {
    saving.value = true
    try {
        await send(
            permPreview.mode === 'maintenance'
                ? 'chatluna-data/applyKoishiMaintenance'
                : 'chatluna-data/applyKoishiPermissionPlan',
            permPreview.input
        )
        permPreview.open = false
        ElMessage.success('权限自动分配已应用')
        await loadPermissions()
    } finally {
        saving.value = false
    }
}

async function previewMaintenance() {
    const input =
        permMaintenance.type === 'channels-assign'
            ? {
                  type: 'channels-assign',
                  assignee: permMaintenance.assignee
              }
            : {
                  type: 'inactive-down',
                  days: permMaintenance.days,
                  authority: permMaintenance.authority,
                  permissions: permMaintenance.permissions
              }
    permPreview.mode = 'maintenance'
    permPreview.input = input
    permPreview.data = await send('chatluna-data/previewKoishiMaintenance', input)
    permPreview.open = true
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
    await refreshAfter('rules')
}

async function removeRule(row: Rule) {
    await ElMessageBox.confirm('确定删除这条约束规则？', '确认', {
        type: 'warning'
    })
    await send('chatluna-data/saveConstraint', { mode: 'remove', row })
    ElMessage.success('规则已删除')
    await refreshAfter('rules')
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

onMounted(async () => {
    loading.value = true
    try {
        await ensureTabLoaded('overview')
    } catch (err) {
        ElMessage.error(String(err))
    } finally {
        loading.value = false
    }
})

</script>

<style scoped>
.cl-data-page {
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--k-page-bg);
    color: var(--k-text-dark);
}

@keyframes panel-in {
    from {
        opacity: 0;
        transform: translateY(8px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes value-in {
    from {
        opacity: 0;
        transform: translateY(4px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.shell {
    height: 100%;
    min-height: 0;
    padding: 24px 88px 80px 24px;
    box-sizing: border-box;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    scroll-behavior: smooth;
    scrollbar-gutter: stable;
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

.topbar {
    position: sticky;
    top: 0;
    z-index: 8;
    margin: -24px -88px 0 -24px;
    padding: 24px 88px 16px 24px;
    background: color-mix(in srgb, var(--k-page-bg), transparent 6%);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 72%);
    box-shadow: 0 8px 24px color-mix(in srgb, #000, transparent 96%);
    animation: panel-in 180ms ease-out both;
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

.title-row h1 {
    display: inline-flex;
    align-items: center;
    gap: 9px;
}

.title-row h1::before {
    content: "Δ";
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid color-mix(in srgb, var(--k-color-primary), transparent 52%);
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-color-primary), transparent 91%);
    color: var(--k-color-primary);
    font-size: 15px;
    font-weight: 700;
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
    animation: panel-in 180ms ease-out both;
}

.metric {
    position: relative;
    display: grid;
    gap: 5px;
    padding: 15px 18px;
    text-align: left;
    border: 0;
    border-right: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 30%);
    background: transparent;
    cursor: pointer;
    transition:
        background-color 160ms ease,
        transform 160ms ease,
        color 160ms ease;
    animation: panel-in 180ms ease-out both;
}

.metric::after {
    content: "";
    position: absolute;
    left: 18px;
    right: 18px;
    bottom: 0;
    height: 2px;
    border-radius: 999px;
    background: var(--k-color-primary);
    opacity: 0;
    transform: scaleX(0.4);
    transition:
        opacity 160ms ease,
        transform 160ms ease;
}

.metric:hover,
.metric.active {
    background: color-mix(in srgb, var(--k-color-primary), transparent 93%);
    transform: translateY(-1px);
}

.metric:hover::after,
.metric.active::after {
    opacity: 0.8;
    transform: scaleX(1);
}

.metric:last-child {
    border-right: 0;
}

.metric strong {
    font-size: 24px;
    color: var(--k-text-dark);
    animation: value-in 180ms ease-out both;
}

.metric:nth-child(2) {
    animation-delay: 25ms;
}

.metric:nth-child(3) {
    animation-delay: 50ms;
}

.metric:nth-child(4) {
    animation-delay: 75ms;
}

.metric:nth-child(5) {
    animation-delay: 100ms;
}

.metric:nth-child(6) {
    animation-delay: 125ms;
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
    box-shadow: 0 1px 2px color-mix(in srgb, #000, transparent 88%);
    animation: panel-in 180ms ease-out both;
    transition:
        border-color 160ms ease,
        box-shadow 160ms ease,
        transform 160ms ease,
        background-color 160ms ease;
}

.panel:hover {
    border-color: color-mix(in srgb, var(--k-color-primary), var(--k-color-divider) 68%);
    box-shadow: 0 10px 24px color-mix(in srgb, #000, transparent 90%);
    transform: translateY(-1px);
}

.panel-head {
    min-height: 54px;
    padding: 12px 14px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 28%);
    background: color-mix(in srgb, var(--k-side-bg), transparent 42%);
}

.panel-head h2 {
    display: inline-flex;
    align-items: center;
    gap: 8px;
}

.panel-head h2::before {
    content: "";
    width: 3px;
    height: 14px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--k-color-primary), var(--k-text-light) 16%);
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

.panel-head p {
    margin-top: 4px;
    color: var(--k-text-light);
    font-size: 13px;
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

.permission-layout {
    display: grid;
    gap: 14px;
}

.permission-console {
    display: grid;
    gap: 14px;
}

.permission-shell {
    min-height: 720px;
}

.inner-tabs {
    padding: 0 14px 14px;
}

.permission-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    gap: 14px;
}

.permission-main,
.permission-side,
.permission-diagnose,
.permission-maintenance {
    min-width: 0;
}

.permission-side {
    display: grid;
    align-content: start;
    gap: 12px;
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 28%);
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 42%);
    transition:
        border-color 160ms ease,
        box-shadow 160ms ease,
        transform 160ms ease;
}

.permission-side:hover {
    border-color: color-mix(in srgb, var(--k-color-primary), var(--k-color-divider) 64%);
    box-shadow: 0 8px 18px color-mix(in srgb, #000, transparent 91%);
    transform: translateY(-1px);
}

.permission-side h3 {
    margin: 0;
    font-size: 15px;
}

.permission-detail {
    display: grid;
    gap: 12px;
}

.diagnose-result {
    display: grid;
    gap: 12px;
}

.permission-chains {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.permission-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 14px 12px;
}

.permission-stats span {
    padding: 5px 9px;
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 22%);
    border-radius: 6px;
    color: var(--k-text-light);
    background: color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 36%);
    font-size: 13px;
    transition:
        color 140ms ease,
        border-color 140ms ease,
        background-color 140ms ease,
        transform 140ms ease;
}

.permission-stats span:hover {
    color: var(--k-text-dark);
    border-color: color-mix(in srgb, var(--k-color-primary), var(--k-color-divider) 58%);
    background: color-mix(in srgb, var(--k-color-primary), transparent 94%);
    transform: translateY(-1px);
}

.permission-auto {
    display: grid;
    grid-template-columns: 180px 120px minmax(180px, 1fr) 140px 160px 130px;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 34%);
}

.permission-guide {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1px;
    margin: 0 14px 12px;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 28%);
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-color-divider), transparent 40%);
}

.permission-guide div {
    display: grid;
    gap: 4px;
    min-width: 0;
    padding: 10px 12px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 42%);
}

.permission-guide strong {
    color: var(--k-text-dark);
    font-size: 13px;
}

.permission-guide span {
    font-size: 12px;
    line-height: 1.45;
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

.model-health {
    overflow: visible;
}

.model-kpis {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 1px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 30%);
    background: color-mix(in srgb, var(--k-color-divider), transparent 34%);
}

.model-kpis div,
.model-matrix div {
    display: grid;
    gap: 6px;
    min-width: 0;
    padding: 14px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 42%);
}

.model-kpis strong,
.model-matrix strong {
    color: var(--k-text-dark);
    font-size: 20px;
}

.model-workbench {
    display: grid;
    grid-template-columns: 360px minmax(0, 1fr);
    gap: 14px;
    padding: 14px;
}

.provider-list {
    display: grid;
    align-content: start;
    gap: 10px;
    min-width: 0;
}

.provider-card {
    display: grid;
    gap: 10px;
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 28%);
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 34%);
    cursor: pointer;
    transition:
        border-color 150ms ease,
        background-color 150ms ease;
}

.provider-card:hover,
.provider-card.active {
    border-color: color-mix(in srgb, var(--k-color-primary), var(--k-color-divider) 55%);
    background: color-mix(in srgb, var(--k-color-primary), transparent 95%);
}

.provider-title,
.provider-detail-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}

.provider-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 12px;
}

.provider-detail-panel {
    min-width: 0;
    padding: 14px;
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 28%);
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 42%);
}

.model-matrix {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1px;
    margin-top: 14px;
    background: color-mix(in srgb, var(--k-color-divider), transparent 34%);
}

.compact-tabs {
    margin-top: 12px;
}

.issue-groups {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    padding: 14px;
}

.issue-group {
    display: grid;
    gap: 8px;
    min-width: 0;
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 30%);
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 34%);
}

.issue-group div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.issue-group strong {
    color: var(--k-text-dark);
    font-size: 18px;
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

.integrity-banner {
    margin-bottom: 16px;
}

.integrity-summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 12px 0;
    font-size: 13px;
}

.integrity-panel {
    display: grid;
    gap: 16px;
}

.integrity-kpis,
.integrity-methods {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
}

.integrity-methods {
    grid-template-columns: repeat(3, minmax(0, 1fr));
}

.integrity-kpis div,
.integrity-methods article {
    padding: 14px;
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 30%);
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 34%);
}

.integrity-kpis span {
    display: block;
    color: var(--k-text-light);
    font-size: 12px;
}

.integrity-kpis strong {
    display: block;
    margin-top: 4px;
    color: var(--k-text-dark);
    font-size: 24px;
}

.integrity-methods article {
    display: grid;
    align-content: start;
    gap: 8px;
}

.integrity-methods h3 {
    margin: 0;
    font-size: 14px;
}

.integrity-methods p {
    margin: 0;
    color: var(--k-text-light);
    font-size: 12px;
    line-height: 1.6;
}

.integrity-filterbar {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
}

.integrity-filterbar :deep(.el-select) {
    width: 160px;
}

.integrity-load-errors {
    margin: 12px 0;
    padding: 12px 16px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--el-color-danger), transparent 40%);
    background: color-mix(in srgb, var(--el-color-danger), transparent 92%);
    color: var(--k-text-dark);
}

.integrity-load-errors h3 {
    margin: 0 0 4px 0;
    font-size: 14px;
}

.integrity-load-errors p {
    margin: 4px 0;
    font-size: 12px;
    color: var(--k-text-light);
}

.integrity-load-errors ul {
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
    font-size: 12px;
}

.integrity-load-errors li {
    padding: 2px 0;
    word-break: break-all;
}

.ops-panel {
    display: grid;
    gap: 16px;
}

.ops-flow,
.ops-workspace,
.ops-source-grid {
    display: grid;
    gap: 14px;
}

.ops-flow {
    grid-template-columns: repeat(3, minmax(0, 1fr));
}

.ops-flow article,
.ops-card {
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 26%);
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 32%);
}

.ops-flow article {
    position: relative;
    min-height: 104px;
    padding: 16px 16px 16px 52px;
}

.ops-flow span {
    position: absolute;
    top: 16px;
    left: 16px;
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border-radius: 999px;
    background: color-mix(in srgb, var(--k-color-primary), transparent 86%);
    color: var(--k-color-primary);
    font-size: 12px;
    font-weight: 700;
}

.ops-flow h3,
.ops-card h3 {
    margin: 0;
    font-size: 15px;
}

.ops-flow p,
.ops-card-head p {
    margin: 6px 0 0;
    color: var(--k-text-light);
    font-size: 12px;
    line-height: 1.6;
}

.ops-workspace {
    grid-template-columns: minmax(420px, 1.15fr) minmax(360px, 0.85fr);
    align-items: start;
}

.ops-source-grid {
    grid-template-columns: minmax(0, 1fr) minmax(420px, 0.95fr);
    align-items: start;
}

.ops-card {
    display: grid;
    gap: 14px;
    padding: 14px;
    min-width: 0;
}

.ops-card-head,
.ops-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.ops-card-head > div {
    min-width: 0;
}

.ops-diagnosis {
    align-content: start;
}

.ops-toolbar {
    justify-content: flex-start;
    flex-wrap: wrap;
}

.ops-result {
    display: grid;
    gap: 16px;
}

.ops-history {
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 32%);
    border-radius: 8px;
    overflow: hidden;
}

.ops-alert-body {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
}

.ops-alert-body p {
    flex-basis: 100%;
    margin: 2px 0;
}

.ops-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
}

.ops-action {
    display: grid;
    align-content: start;
    gap: 10px;
    padding: 14px;
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 20%);
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 35%);
}

.ops-action.recommended {
    border-color: color-mix(in srgb, var(--el-color-success), transparent 45%);
}

.ops-action.danger {
    border-color: color-mix(in srgb, var(--el-color-danger), transparent 45%);
}

.ops-action-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.ops-action h3,
.ops-evidence h3 {
    margin: 0;
    font-size: 14px;
}

.ops-action p {
    margin: 0;
    color: var(--k-text-light);
    font-size: 12px;
    line-height: 1.6;
}

.ops-action ol {
    display: grid;
    gap: 6px;
    margin: 0;
    padding-left: 18px;
    color: var(--k-text-dark);
    font-size: 12px;
}

.ops-evidence {
    display: grid;
    gap: 10px;
}

.message-list {
    height: 620px;
}

.message-truncated {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin: 12px;
    padding: 10px 12px;
    border: 1px dashed color-mix(in srgb, var(--k-color-divider), transparent 30%);
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 40%);
    color: var(--k-text-light);
    font-size: 12px;
}

.message {
    margin: 12px;
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 30%);
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 40%);
    transition:
        border-color 160ms ease,
        background-color 160ms ease,
        transform 160ms ease,
        box-shadow 160ms ease;
}

.message:hover {
    border-color: color-mix(in srgb, var(--k-color-primary), var(--k-color-divider) 64%);
    background: color-mix(in srgb, var(--k-color-primary), transparent 96%);
    box-shadow: 0 8px 18px color-mix(in srgb, #000, transparent 92%);
    transform: translateY(-1px);
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
    transition:
        border-color 160ms ease,
        background-color 160ms ease;
}

.config-section:hover {
    border-color: color-mix(in srgb, var(--k-color-primary), var(--k-color-divider) 64%);
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 24%);
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
    transition:
        border-color 160ms ease,
        box-shadow 160ms ease,
        transform 160ms ease;
}

.op-block:hover {
    border-color: color-mix(in srgb, var(--k-color-primary), var(--k-color-divider) 64%);
    box-shadow: 0 8px 18px color-mix(in srgb, #000, transparent 92%);
    transform: translateY(-1px);
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

:deep(.el-table__row) {
    transition:
        background-color 140ms ease,
        transform 140ms ease;
}

:deep(.el-table__row:hover > td) {
    background: color-mix(in srgb, var(--k-color-primary), transparent 94%) !important;
}

:deep(.el-table th.el-table__cell) {
    font-weight: 650;
}

:deep(.el-table__cell) {
    transition: background-color 140ms ease;
}

:deep(.el-tabs__item) {
    transition:
        color 140ms ease,
        transform 140ms ease;
}

:deep(.el-tabs__item:hover) {
    transform: translateY(-1px);
}

:deep(.el-tabs__active-bar) {
    border-radius: 999px;
    transition:
        transform 180ms ease,
        width 180ms ease;
}

:deep(.el-button) {
    transition:
        transform 140ms ease,
        box-shadow 140ms ease,
        background-color 140ms ease,
        border-color 140ms ease;
}

:deep(.el-button:not(.is-disabled):hover) {
    transform: translateY(-1px);
}

:deep(.el-button:not(.is-disabled):active) {
    transform: translateY(0);
}

:deep(.el-tab-pane) {
    animation: panel-in 180ms ease-out both;
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

:deep(.el-input__wrapper),
:deep(.el-select__wrapper) {
    transition:
        box-shadow 140ms ease,
        background-color 140ms ease,
        border-color 140ms ease;
}

:deep(.el-drawer),
:deep(.el-dialog) {
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 28%);
    border-radius: 8px;
    background: var(--k-side-bg);
    box-shadow: 0 18px 48px color-mix(in srgb, #000, transparent 82%);
}

:deep(.el-drawer__header),
:deep(.el-dialog__header) {
    margin-bottom: 0;
    padding-bottom: 14px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 34%);
}

.soft-slide-enter-active,
.soft-slide-leave-active,
.list-enter-active,
.list-leave-active {
    transition:
        opacity 160ms ease,
        transform 160ms ease;
}

.soft-slide-enter-from,
.soft-slide-leave-to {
    opacity: 0;
    transform: translateX(10px);
}

.list-enter-from,
.list-leave-to {
    opacity: 0;
    transform: translateY(8px);
}

.list-move {
    transition: transform 160ms ease;
}

@media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after,
    :deep(*) {
        animation-duration: 1ms !important;
        transition-duration: 1ms !important;
        scroll-behavior: auto !important;
    }
}

@media (max-width: 1180px) {
    .shell {
        padding: 18px 18px 72px;
    }

    .topbar {
        margin: -18px -18px 0;
        padding: 18px 18px 14px;
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
    .model-kpis,
    .model-workbench,
    .model-matrix,
    .issue-groups,
    .permission-grid,
    .permission-auto,
    .permission-guide,
    .ops-actions,
    .ops-flow,
    .ops-source-grid,
    .ops-workspace,
    .integrity-kpis,
    .integrity-methods,
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
    .integrity-filterbar :deep(.el-select),
    .top-actions :deep(.el-select) {
        width: 100%;
    }

    .left-list {
        border-right: 0;
        border-bottom: 1px solid
            color-mix(in srgb, var(--k-color-divider), transparent 28%);
    }
}

@media (max-width: 768px) {
    .metrics,
    .model-kpis {
        display: flex;
        overflow-x: auto;
        scroll-snap-type: x proximity;
    }

    .metric,
    .model-kpis div {
        min-width: 160px;
        scroll-snap-align: start;
    }

    .provider-detail-head {
        align-items: flex-start;
        flex-direction: column;
    }
}

@media (max-width: 520px) {
    .provider-card,
    .issue-group {
        border-radius: 6px;
    }

    .model-health :deep(.el-table__cell:nth-child(n + 4)) {
        display: none;
    }

    .model-health :deep(.el-table__header col:nth-child(n + 4)),
    .model-health :deep(.el-table__body col:nth-child(n + 4)) {
        display: none;
    }
}
</style>
