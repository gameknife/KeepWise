# 规则
- 本文件是来自CEO的最高需求，以最高优先级执行
- 新需求内是CEO目前提出的需求，按从上到下的顺序执行
- 规划中的暂时不做，还需继续细化需求
- 完成后，需要把需求挪入已完成

# 新需求
- （暂无）

# 规划中
- 开始进行移动端的页面适配（纯前端逻辑）

# 已完成
- 对前端框架作第八阶段拆分：`App` 内请求构建与输入清洗函数下沉到 `app/requestBuilders.ts`，主组件内嵌函数继续收敛
- 对前端框架作第七阶段拆分：`App` 的 summary/helper/金额格式化函数下沉到 `app/summaries.ts`、`app/helpers.ts`、`app/amountFormatting.ts`
- 对前端框架作第六阶段拆分：通用 UI 原语（`PathRow/DateInput/LineAreaChart/SortableHeader` 等）下沉到 `features/shared/UiPrimitives.tsx`
- 对前端框架作第五阶段拆分：`InvestmentCurve`、`WealthOverview/Curve`、`Budget/FIRE` 与 `RulesAdminPanel` 全量下沉到 `features/records|wealth|budget|rules`，`App` 进一步收敛为装配层
- 对前端框架作第四阶段拆分：投资/账户/资产列表预览组件下沉到 `features/records`，导入中心 6 个摘要组件下沉到 `features/import`
- 对前端框架作第三阶段拆分：消费分析、收入分析、管理健康预览组件下沉到 `features/*` 模块，`App` 改为组装层
- 对前端框架作第二阶段拆分：`App.tsx` 下沉为 `src/app/App.tsx`，根入口仅保留薄封装导出
- 对前端框架作第一阶段重构：抽离 types/app、utils/value、hooks/useDebouncedAutoRun、hooks/useAsyncQuery，并将消费分析查询切换到 useAsyncQuery
- 投资收益模块进一步精简，两个卡片合并，预设区间共享，投资收益率对比直接显示账户列表，去掉其他信息
- 消费分析页面，高频商户列表内，在条目上提供对分类的切换功能，快捷修改分类，点击分类后，下拉栏选择应该归属的分类，待分类放第一个
- 收入分析tab按钮上的显示不对，没有显示到最新数据（2026年2月）
- 记一笔弹窗内的两个hint，出现的时候影响了排版对齐，需要修复，可以为他预留出下方的空间，需要的时候显示（字色可以更暗一些）
- 收入分析，消费分析的tab按钮上，加上x月收入：xxx，x月消费：yyy
- 记一笔的弹窗里，选择了账户后，显示一个当前的总资金，方便用户二次确认是否正确。同时输入金额时，如果超过10万，在同步显示一个xx万的数值，方便用户确认是否输入正确
- 投资收益模块，现有的三个曲线，做成一个图，通过下拉栏切换，默认显示收益率曲线
- 投资收益tab按钮上的年化预估，应该始终使用ytd计算。不应随内部的range修改而修改，并将年化预估的文字修改为xxxx年预估
