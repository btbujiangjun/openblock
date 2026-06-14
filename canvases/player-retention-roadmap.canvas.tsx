import {
    Card,
    CardBody,
    CardHeader,
    Code,
    Divider,
    Grid,
    H1,
    H2,
    H3,
    Pill,
    Row,
    Stack,
    Stat,
    Table,
    Text,
} from 'cursor/canvas';

/**
 * OpenBlock 玩家留存 / 活跃提升路线图（v10.16.6 现状盘点）
 *
 * 输入：
 *  - 已实装 13 大类留存抓手（签到 / 钱包 / 道具 / 宝箱 / 转盘 / 战令 / 任务 / 推送 / 商业化分群 / 皮肤 / 图鉴 / 节日 / 大师挑战）
 *  - 6 个 P2 stub 等待填实（BGM / 异步PK / 伙伴 / 复盘相册 / 旋转玩法 / 玩法轮换）
 *  - 商业化分层 / 个性化已成熟（personalization / strategyEngine / dailyTasks）
 *
 * 输出：
 *  - 18 项新建议（按 D1 / D2-7 / D7-30 / 社交 / 进度 / 付费 6 轴划分）
 *  - 4 周 Sprint 落地路径
 */
export default function PlayerRetentionRoadmap() {
    return (
        <Stack gap={28}>
            {/* ─────────── 1. 顶部：现状速览 ─────────── */}
            <Stack gap={12}>
                <H1>玩家留存 / 活跃提升路线图</H1>
                <Text tone="secondary">
                    基于 v10.16.6 盘点：D1 / D7 / D30 主体抓手已铺底（签到 7 日 + 连登勋章 + 4 件道具 +
                    36 款皮肤剧情图鉴 + 局末宝箱 + 商业化分群个性化），但「第一次愉悦的速度」「每日想回来的钩子密度」
                    「玩法多样性」与「长期进度可视化」四块仍可挖掘 30~50% 增量。
                </Text>
                <Grid columns={4} gap={16}>
                    <Stat value="13" label="已实装抓手类别" tone="success" />
                    <Stat value="6" label="P2 Stub 待填实" tone="warning" />
                    <Stat value="18" label="新建议项目（待评估）" tone="info" />
                    <Stat value="4w" label="推荐 Sprint 路径" />
                </Grid>
            </Stack>

            <Divider />

            {/* ─────────── 2. 现状画像：哪些钩子已铺好 ─────────── */}
            <Stack gap={12}>
                <H2>现状画像 — 已实装抓手按生命周期分布</H2>
                <Table
                    headers={['生命周期', '已实装', '覆盖度', '关键模块']}
                    columnAlign={['left', 'left', 'center', 'left']}
                    rows={[
                        [
                            'D0（首次进入）',
                            '皮肤选择 / FTUE 缺位 / 立刻进入主玩法',
                            <Pill tone="warning" active size="sm">弱</Pill>,
                            'main.js / skins.js',
                        ],
                        [
                            'D1（首日留存）',
                            '7 日签到 / 节日皮肤推荐 / 数字彩蛋',
                            <Pill tone="info" active size="sm">中</Pill>,
                            'checkInPanel / seasonalSkin / easterEggs',
                        ],
                        [
                            'D2-D7（习惯养成）',
                            '连登勋章 / 每日任务 / 迷你目标 / 推送',
                            <Pill tone="success" active size="sm">强</Pill>,
                            'loginStreak / dailyTasks / miniGoals / pushNotifications',
                        ],
                        [
                            'D7-D30（情感粘性）',
                            '36 款皮肤图鉴 + 大师挑战 + 极限成就 + 局末宝箱 + 转盘',
                            <Pill tone="success" active size="sm">强</Pill>,
                            'skinLore / dailyMaster / extremeAchievements / endGameChest / luckyWheel',
                        ],
                        [
                            '道具循环',
                            '4 件道具 + 统一钱包（5 币种）+ 道具栏 UI',
                            <Pill tone="success" active size="sm">强</Pill>,
                            'wallet / skillBar / undo / hint / bomb / rainbow',
                        ],
                        [
                            '商业化分层',
                            '6 类用户分群 / 13 条策略规则 / 个性化推送',
                            <Pill tone="success" active size="sm">强</Pill>,
                            'personalization / strategyEngine / adTrigger / iapAdapter',
                        ],
                        [
                            '玩法多样性',
                            '关卡模式 + 大师挑战 + 复活',
                            <Pill tone="warning" active size="sm">弱</Pill>,
                            'levelManager / revive（rotationStub 未填）',
                        ],
                        [
                            '社交粘性',
                            '分享卡 + 匿名日榜（异步 PK / 复盘相册 stub 未填）',
                            <Pill tone="warning" active size="sm">弱</Pill>,
                            'shareCard / leaderboard',
                        ],
                        [
                            '长期进度感',
                            '战令通行证（无前端面板）/ 玩家画像',
                            <Pill tone="warning" active size="sm">弱</Pill>,
                            'seasonPass / playerProfile',
                        ],
                    ]}
                    rowTone={[
                        'warning',
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        'warning',
                        'warning',
                        'warning',
                    ]}
                />
            </Stack>

            <Divider />

            {/* ─────────── 3. P2 Stub 待填实 ─────────── */}
            <Stack gap={12}>
                <H2>已有占位 stub —— 优先填实而非新建</H2>
                <Text tone="secondary">
                    6 个 P2 模块已有 API 与 TODO 列表，零原型成本。建议按「依赖资产成本」从低到高填实。
                </Text>
                <Table
                    headers={['模块', '工时', '依赖资产', '留存价值', '优先级']}
                    columnAlign={['left', 'center', 'left', 'left', 'center']}
                    rows={[
                        [
                            <Text>复盘相册 <Code>replayAlbumStub</Code></Text>,
                            '3d',
                            '纯本地 IndexedDB / 无外部资产',
                            'D7+ 玩家"展示型分享"动机；100/500/1000 局里程碑',
                            <Pill tone="success" active size="sm">P1·先做</Pill>,
                        ],
                        [
                            <Text>异步 PK <Code>asyncPkStub</Code></Text>,
                            '5d（含后端）',
                            'server.py 加 pk_challenges 表 + URL 路由',
                            '社交裂变唯一抓手；分享种子让朋友"挑战我的 N 分"',
                            <Pill tone="success" active size="sm">P1·先做</Pill>,
                        ],
                        [
                            <Text>旋转方块 <Code>rotationStub</Code></Text>,
                            '4d',
                            '无外部资产，纯算法 + UI 调整',
                            '玩法分支（致敬俄罗斯方块），增加新模式吸引怀旧群体',
                            <Pill tone="info" active size="sm">P2·中</Pill>,
                        ],
                        [
                            <Text>玩法轮换 <Code>rotationStub</Code> 关联</Text>,
                            '6d',
                            '需要 3-4 个新玩法配合',
                            '抗审美疲劳；闪电 60 秒 / 无尽 zen / 限时 boss',
                            <Pill tone="info" active size="sm">P2·中</Pill>,
                        ],
                        [
                            <Text>BGM 主题音乐 <Code>bgmStub</Code></Text>,
                            '1d 接入 + 5MB 资产',
                            '36 款皮肤 × 30s OGG（需音频制作 / 采购 ~$200）',
                            '感官沉浸，但音频是高内存 + 移动流量负担',
                            <Pill tone="warning" active size="sm">P3·低</Pill>,
                        ],
                        [
                            <Text>角色伙伴 <Code>companionStub</Code></Text>,
                            '8d + 立绘资产',
                            '36 × 5 等级 = 180 张立绘（视觉团队）',
                            '高情感粘性但工程量大；可作为商业化扩展',
                            <Pill tone="warning" active size="sm">P3·低</Pill>,
                        ],
                    ]}
                />
            </Stack>

            <Divider />

            {/* ─────────── 4. 18 个新建议（核心） ─────────── */}
            <Stack gap={20}>
                <H2>新建议 18 项 — 按 6 轴划分</H2>

                {/* A. D0-D1 首次愉悦 */}
                <Stack gap={10}>
                    <Row gap={8} align="center">
                        <H3>A. D0-D1 首次愉悦的路径压缩</H3>
                        <Pill tone="success" active size="sm">3 项</Pill>
                    </Row>
                    <Text tone="secondary">
                        当前空白点：用户首次进入直接进主玩法，没有教学引导，没有"第一次成功"的强化反馈。
                    </Text>
                    <Table
                        headers={['#', '建议', '体验', '成本', 'ROI']}
                        columnAlign={['center', 'left', 'left', 'center', 'center']}
                        rows={[
                            [
                                '1',
                                'FTUE 教学动画（前 3 局）',
                                '第 1 局：3 步教学卡（拖拽 / 消行 / combo 提示），AI 自动演示落子动画',
                                '2d',
                                <Pill tone="success" active size="sm">极高</Pill>,
                            ],
                            [
                                '2',
                                '首日大礼包（首次进入掉落）',
                                '送 3 提示券 + 2 撤销券 + 1 炸弹 + 1 限定皮肤试穿券（24h），让玩家立刻体验全部 4 件道具',
                                '0.5d',
                                <Pill tone="success" active size="sm">极高</Pill>,
                            ],
                            [
                                '3',
                                '首次成功 wow moment 强化',
                                '第一次双消 / perfect / streak 5 时弹"成就达成"+独家 toast，写入 firstUnlockCelebration 触发条件',
                                '1d',
                                <Pill tone="info" active size="sm">高</Pill>,
                            ],
                        ]}
                    />
                </Stack>

                {/* B. D2-D7 习惯养成 */}
                <Stack gap={10}>
                    <Row gap={8} align="center">
                        <H3>B. D2-D7 习惯养成的钩子加密</H3>
                        <Pill tone="success" active size="sm">4 项</Pill>
                    </Row>
                    <Text tone="secondary">
                        签到 / 任务 / 推送已铺底，但「每天打开都有新东西」的密度还可加强；同时缺少沉默用户的回归关怀。
                    </Text>
                    <Table
                        headers={['#', '建议', '体验', '成本', 'ROI']}
                        columnAlign={['center', 'left', 'left', 'center', 'center']}
                        rows={[
                            [
                                '4',
                                '回归玩家关怀礼包',
                                '沉默 ≥ 1/3/7 天再次登录，立即弹"我们想你了"toast + 自动到账分级礼包（提示券+撤销+随机皮肤试穿）',
                                '1d',
                                <Pill tone="success" active size="sm">极高</Pill>,
                            ],
                            [
                                '5',
                                '每日首胜加分（First Win of Day）',
                                '每日首局得分 ×1.5；倒计时显示"剩 X 小时获取首胜加成"，制造时段紧迫感',
                                '0.5d',
                                <Pill tone="success" active size="sm">极高</Pill>,
                            ],
                            [
                                '6',
                                '每日轮换主题盘面',
                                '每日 00:00 切到一个特殊 modifier："今日全 L 形"/"今日 4×4 大块"/"今日 spawn 偏向 perfect"，覆盖 7 种循环',
                                '2d',
                                <Pill tone="info" active size="sm">高</Pill>,
                            ],
                            [
                                '7',
                                '局末进度齐刷条',
                                '把目前散在 5 个模块（任务/迷你目标/战令/连登/赛季）的进度条聚合到 game over 弹窗，一齐推进给即时多巴胺',
                                '1.5d',
                                <Pill tone="info" active size="sm">高</Pill>,
                            ],
                        ]}
                    />
                </Stack>

                {/* C. D7-D30 玩法多样性 */}
                <Stack gap={10}>
                    <Row gap={8} align="center">
                        <H3>C. D7-D30 抗审美疲劳的玩法分支</H3>
                        <Pill tone="info" active size="sm">3 项</Pill>
                    </Row>
                    <Text tone="secondary">
                        优先填实 <Code>rotationStub</Code> 并基于其新增 2-3 个轻量模式，让"同样的盘面有 4-5 种玩法"。
                    </Text>
                    <Table
                        headers={['#', '建议', '体验', '成本', 'ROI']}
                        columnAlign={['center', 'left', 'left', 'center', 'center']}
                        rows={[
                            [
                                '8',
                                '闪电 60 秒局',
                                '60 秒倒计时；只看分数 / 消行数；轻量但有差异感',
                                '2d',
                                <Pill tone="success" active size="sm">极高</Pill>,
                            ],
                            [
                                '9',
                                'Zen 无尽模式',
                                '无 game over，盘面满了自动清掉一行；纯减压；情绪调节出口',
                                '1.5d',
                                <Pill tone="info" active size="sm">高</Pill>,
                            ],
                            [
                                '10',
                                '道具池扩容（+3 件）',
                                '冻结某行 1 局 / 预览下 3 块候选 / 重摇候选块；与现有 4 件道具配套钱包币种',
                                '3d',
                                <Pill tone="info" active size="sm">高</Pill>,
                            ],
                        ]}
                    />
                </Stack>

                {/* D. 社交粘性 */}
                <Stack gap={10}>
                    <Row gap={8} align="center">
                        <H3>D. 社交粘性 — 把孤单的单机变成"轻社交"</H3>
                        <Pill tone="info" active size="sm">3 项</Pill>
                    </Row>
                    <Table
                        headers={['#', '建议', '体验', '成本', 'ROI']}
                        columnAlign={['center', 'left', 'left', 'center', 'center']}
                        rows={[
                            [
                                '11',
                                <Text>填实 <Code>asyncPkStub</Code> + 朋友圈分享话术</Text>,
                                '玩家自动生成"挑战种子"链接 → 朋友点开复刻同盘面 PK，结果对比；分享卡片注入"我打了 N 分，你呢？"',
                                '5d',
                                <Pill tone="success" active size="sm">极高</Pill>,
                            ],
                            [
                                '12',
                                '复盘 GIF 一键分享',
                                <Text>填实 <Code>replayAlbumStub</Code>；3 秒高光时刻自动剪辑（perfect / 5 连消瞬间）→ 导出 WebP / GIF 分享</Text>,
                                '4d',
                                <Pill tone="info" active size="sm">高</Pill>,
                            ],
                            [
                                '13',
                                '好友礼物互送（弱社交）',
                                '账户系统 + 每日 1 个免费礼物名额：送好友 1 提示券 / 1 撤销，对方收到时弹 toast；增加打开频次',
                                '6d（含后端）',
                                <Pill tone="warning" active size="sm">中</Pill>,
                            ],
                        ]}
                    />
                </Stack>

                {/* E. 进度可视化 */}
                <Stack gap={10}>
                    <Row gap={8} align="center">
                        <H3>E. 长期进度可视化（D14+ 防流失）</H3>
                        <Pill tone="info" active size="sm">3 项</Pill>
                    </Row>
                    <Table
                        headers={['#', '建议', '体验', '成本', 'ROI']}
                        columnAlign={['center', 'left', 'left', 'center', 'center']}
                        rows={[
                            [
                                '14',
                                '段位系统（青铜→传奇）',
                                '7 段位 × 3 小段，每段独占皮肤边框 / 颜色；周晋升 / 降级；与 leaderboard 联动；排位赛轨道',
                                '4d',
                                <Pill tone="success" active size="sm">极高</Pill>,
                            ],
                            [
                                '15',
                                '皮肤碎片合成系统',
                                '把"立刻解锁"改为渐进：每天玩 +1 碎片，凑齐 30 个解锁某皮肤；新增长期挂钩',
                                '3d',
                                <Pill tone="info" active size="sm">高</Pill>,
                            ],
                            [
                                '16',
                                '个人数据 dashboard + 年终回顾',
                                '总分曲线 / 总时长 / 最高 combo / 偏好皮肤 / 进步幅度 12 张图；首年生日生成"年报"分享卡',
                                '3d',
                                <Pill tone="info" active size="sm">高</Pill>,
                            ],
                        ]}
                    />
                </Stack>

                {/* F. 付费 + 留存协同 */}
                <Stack gap={10}>
                    <Row gap={8} align="center">
                        <H3>F. 付费循环与留存协同（C 类鲸鱼）</H3>
                        <Pill tone="warning" active size="sm">2 项</Pill>
                    </Row>
                    <Text tone="secondary">
                        商业化策略层已经成熟（13 条规则 / 6 类分群），但前端"付费产品的可视化展示"与"日历多月化"还未做。
                    </Text>
                    <Table
                        headers={['#', '建议', '体验', '成本', 'ROI']}
                        columnAlign={['center', 'left', 'left', 'center', 'center']}
                        rows={[
                            [
                                '17',
                                <Text>战令 <Code>seasonPass</Code> 前端面板</Text>,
                                '后端逻辑已实装 322 行，缺主菜单入口 + 进度条 + 双轨（免费/付费）UI；每天打开都能看到 +1 进度',
                                '3d',
                                <Pill tone="success" active size="sm">极高</Pill>,
                            ],
                            [
                                '18',
                                '签到日历从 7 → 30 天 + 月底大奖',
                                '现有 7 日转 30 日；第 7/14/21/28 天给中奖；月底给"独占皮肤永久解锁"；付费补签 ¥1',
                                '2d',
                                <Pill tone="info" active size="sm">高</Pill>,
                            ],
                        ]}
                    />
                </Stack>
            </Stack>

            <Divider />

            {/* ─────────── 5. 推荐 4 周 sprint ─────────── */}
            <Stack gap={12}>
                <H2>推荐 4 周 Sprint 落地路径</H2>
                <Text tone="secondary">
                    按"高 ROI + 短工时 + 与现有架构无冲突"原则排序。每周 ~7d 工程量（双人月可压到 2 周）。
                </Text>
                <Grid columns={2} gap={16}>
                    <Card>
                        <CardHeader trailing={<Pill tone="success" active size="sm">W1 · D1 强化</Pill>}>
                            首次愉悦
                        </CardHeader>
                        <CardBody>
                            <Stack gap={6}>
                                <Text weight="semibold">目标：D1 留存 +8~12pp</Text>
                                <Text>① FTUE 教学动画（2d）</Text>
                                <Text>② 首日大礼包（0.5d）</Text>
                                <Text>③ 首次成功 wow moment（1d）</Text>
                                <Text>④ 回归玩家关怀礼包（1d）</Text>
                                <Divider />
                                <Text tone="secondary" size="small">
                                    工时合计 ~4.5d；强烈复用现有 wallet / firstUnlockCelebration / pushNotifications。
                                </Text>
                            </Stack>
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader trailing={<Pill tone="info" active size="sm">W2 · 钩子加密</Pill>}>
                            习惯养成
                        </CardHeader>
                        <CardBody>
                            <Stack gap={6}>
                                <Text weight="semibold">目标：D7 留存 +5~8pp</Text>
                                <Text>⑤ 每日首胜加分（0.5d）</Text>
                                <Text>⑥ 每日轮换主题盘面（2d）</Text>
                                <Text>⑦ 局末进度齐刷条（1.5d）</Text>
                                <Text>⑧ 战令前端面板（3d）</Text>
                                <Divider />
                                <Text tone="secondary" size="small">
                                    工时合计 ~7d；战令前端是工作量大但 LTV 直接抓手。
                                </Text>
                            </Stack>
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader trailing={<Pill tone="info" active size="sm">W3 · 玩法多样</Pill>}>
                            抗审美疲劳
                        </CardHeader>
                        <CardBody>
                            <Stack gap={6}>
                                <Text weight="semibold">目标：D14 留存 +4~6pp</Text>
                                <Text>⑨ 闪电 60 秒局（2d）</Text>
                                <Text>⑩ Zen 无尽模式（1.5d）</Text>
                                <Text>⑪ 道具池 +3 件（3d）</Text>
                                <Divider />
                                <Text tone="secondary" size="small">
                                    工时合计 ~6.5d；闪电与 Zen 是同一架构（计时 / 无终止条件）的两个变体，复用收益高。
                                </Text>
                            </Stack>
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader trailing={<Pill tone="warning" active size="sm">W4 · 长期粘性</Pill>}>
                            进度 + 社交
                        </CardHeader>
                        <CardBody>
                            <Stack gap={6}>
                                <Text weight="semibold">目标：D30 留存 +3~5pp / 分享率 +15%</Text>
                                <Text>⑫ 段位系统（4d）</Text>
                                <Text>⑬ 复盘相册（填 stub，3d）</Text>
                                <Divider />
                                <Text tone="secondary" size="small">
                                    工时合计 ~7d；段位是社交分享的"标签"，与复盘 GIF 结合发酵裂变。
                                </Text>
                            </Stack>
                        </CardBody>
                    </Card>
                </Grid>
            </Stack>

            <Divider />

            {/* ─────────── 6. 后续候选（不进 4 周 sprint） ─────────── */}
            <Stack gap={12}>
                <H2>后续候选（M2 之后）</H2>
                <Table
                    headers={['编号', '项目', '推迟原因', '触发条件']}
                    columnAlign={['center', 'left', 'left', 'left']}
                    rows={[
                        [
                            '13',
                            '好友礼物互送',
                            '需账户体系 + 后端 6d',
                            'M2 启动账户系统后再做',
                        ],
                        [
                            '15',
                            '皮肤碎片合成',
                            '需先收集"用户实际解锁哪些皮肤"数据',
                            'M2 数据回流后调参',
                        ],
                        [
                            '16',
                            '个人 dashboard + 年终回顾',
                            'D365 才有触发场景',
                            '账户成立第一年内任意时间',
                        ],
                        [
                            '18',
                            '签到 30 天日历',
                            '7 日数据未沉淀，先观察',
                            'M2 看 D7 完成率决定是否扩到 30 天',
                        ],
                        [
                            'P2',
                            'BGM / 角色伙伴',
                            '资产成本高',
                            '商业化收入足以支付资产采购后启动',
                        ],
                    ]}
                />
            </Stack>

            <Divider />

            {/* ─────────── 7. 风险 / 副作用提示 ─────────── */}
            <Stack gap={10}>
                <H2>实施风险与副作用</H2>
                <Stack gap={4}>
                    <Text>
                        <Text weight="semibold">钱包通胀</Text>：新增"每日首胜""回归礼包""轮换盘奖励"等多个发币入口后，
                        提示券 / 撤销券存量上升 → 道具的"稀缺感"下降。需要 wallet.js 加发放上限或引入消耗放大器（如 boss
                        盘"双倍消耗"）。
                    </Text>
                    <Text>
                        <Text weight="semibold">弹窗轰炸</Text>：D1 起首日礼包 + 签到 + 战令更新 + 节日推荐 + 大师挑战
                        全部在登录前 5 秒弹出，需要 <Code>popupCoordinator</Code> 加优先级队列与"每会话最多 1 个主弹窗"约束。
                    </Text>
                    <Text>
                        <Text weight="semibold">玩法分支稀释主玩法</Text>：闪电 / Zen 模式分流主玩法时长 → 大师挑战 /
                        关卡完成率指标可能降。建议默认 Tab 仍是经典模式，新模式作为"小入口"展示。
                    </Text>
                    <Text>
                        <Text weight="semibold">段位与商业化分群冲突</Text>：当前 6 类商业化分群按付费意愿，新段位按技术水平。
                        要避免"玩家是钻石段位但被分到 minnow（小鱼）"的尴尬，UI 上分清"展示段位"与"商业化分群"。
                    </Text>
                </Stack>
            </Stack>

            <Divider />

            {/* ─────────── 8. 度量指标建议 ─────────── */}
            <Stack gap={10}>
                <H2>度量与回收</H2>
                <Text tone="secondary">每个 sprint 上线后建议监控 7 天的 A/B 对照。</Text>
                <Table
                    headers={['指标', '基线', 'W1 目标', 'W2 目标', 'W3 目标', 'W4 目标']}
                    columnAlign={['left', 'right', 'right', 'right', 'right', 'right']}
                    rows={[
                        ['D1 留存', '~28%', '36~40%', '36~40%', '38~42%', '38~42%'],
                        ['D7 留存', '~12%', '12~14%', '17~20%', '18~21%', '20~24%'],
                        ['D30 留存', '~5%', '5~6%', '6~7%', '7~9%', '8~10%'],
                        ['日均会话数', '1.4', '1.5', '1.7', '1.9', '2.0'],
                        ['日均时长', '8min', '9min', '11min', '13min', '14min'],
                        ['付费转化', '1.2%', '1.2%', '1.5~1.8%', '1.5~1.8%', '1.7~2.0%'],
                        ['分享率', '0.8%', '0.8%', '1.0%', '1.0%', '2.5~3.0%'],
                    ]}
                />
                <Text tone="tertiary" size="small">
                    基线值为示意（实际请从 monetization / playerProfile 中拉取）。每项落地后用 abTest.js 切流 50/50 验证。
                </Text>
            </Stack>
        </Stack>
    );
}
