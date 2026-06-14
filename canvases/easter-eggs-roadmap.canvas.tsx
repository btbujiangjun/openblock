import {
    Card,
    CardBody,
    CardHeader,
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
 * OpenBlock 彩蛋 / 惊喜路线图
 *
 * 基于现状盘点（v10.14）+ 休闲游戏类比（俄罗斯方块、Candy Crush、2048、合成大西瓜、Threes、Vampire Survivors）
 * 给出 35 个候选项目，按「感知/工时」杠杆排优先级。
 */
export default function EasterEggsRoadmap() {
    return (
        <Stack gap={28}>
            {/* ───── 顶部：标题 + 速览统计 ───── */}
            <Stack gap={12}>
                <H1>OpenBlock 彩蛋 / 惊喜路线图</H1>
                <Text tone="secondary">
                    基于 v10.14 现状盘点：核心玩法（bonus / combo / perfect / streak / 关卡 / 复活）已扎实，36
                    款皮肤是巨大未充分利用的资产；空白主要集中在感官层、皮肤微动效、节日 / 时段换皮、主动道具、隐藏彩蛋、签到经济、社交分享 7 大象限。
                </Text>
                <Grid columns={4} gap={16}>
                    <Stat value="35" label="候选项目（8 大类）" />
                    <Stat value="11" label="P0 高 ROI（本月可上）" tone="success" />
                    <Stat value="14" label="P1 中等（次月）" tone="info" />
                    <Stat value="10" label="P2 长期 / 大工程" tone="warning" />
                </Grid>
            </Stack>

            <Divider />

            {/* ───── 空白象限速览 ───── */}
            <Stack gap={12}>
                <H2>空白象限速览</H2>
                <Text tone="secondary">
                    7 个维度按「现状 → 杠杆资产 → 关键缺口」横切，定位高 ROI 入口。
                </Text>
                <Table
                    headers={['维度', '现状', '可复用资产', '关键缺口', '杠杆']}
                    columnAlign={['left', 'left', 'left', 'left', 'center']}
                    rows={[
                        [
                            '感官层',
                            '仅画布震屏 + 飘字',
                            'Web Audio API（无成本）',
                            '音效 / BGM / 设备震动全无',
                            <Pill tone="success" active size="sm">极高</Pill>,
                        ],
                        [
                            '皮肤微动效',
                            '配色 + emoji + blockStyle',
                            'fxCanvas + game-board-flow-bg',
                            '环境粒子（樱花 / 萤火虫 / 极光）零实现',
                            <Pill tone="success" active size="sm">极高</Pill>,
                        ],
                        [
                            '节日 / 时段',
                            '36 款皮肤静态选择',
                            '皮肤库 + cssVars 切换管线',
                            '日期感知 / 时段动态 / 周末活动全无',
                            <Pill tone="success" active size="sm">极高</Pill>,
                        ],
                        [
                            '主动技能',
                            '复活 + spawnHints + 难题👍',
                            'dailyTasks 已发 hintTokens',
                            'hint 经济未闭环，无炸弹 / 撤销 / 彩虹',
                            <Pill tone="info" active size="sm">高</Pill>,
                        ],
                        [
                            '隐藏彩蛋',
                            '仅工程级 window.* 调试入口',
                            '36 款皮肤可用于"未列出"皮肤',
                            'Konami / 节日限定 / 数字 / 文案梗全无',
                            <Pill tone="info" active size="sm">中高</Pill>,
                        ],
                        [
                            '签到 / 宝箱',
                            '每日任务 + streak 写入 XP',
                            'progression / dailyTasks',
                            '无独立签到 UI / 转盘 / 宝箱 / 试穿券',
                            <Pill tone="info" active size="sm">中高</Pill>,
                        ],
                        [
                            '社交分享',
                            'replayShare + 匿名日榜',
                            'navigator.share + 种子化盘面',
                            '海报艺术化 / 异步 PK / 每日大师题',
                            <Pill tone="warning" active size="sm">中</Pill>,
                        ],
                    ]}
                />
            </Stack>

            <Divider />

            {/* ───── Top 5 推荐 ───── */}
            <Stack gap={16}>
                <H2>Top 5 高 ROI 推荐（按"感知/工时"排序）</H2>
                <Grid columns={1} gap={12}>
                    <Card>
                        <CardHeader trailing={<Pill tone="success" active size="sm">P0 · 1-2d</Pill>}>
                            程序化音效系统（Web Audio API）
                        </CardHeader>
                        <CardBody>
                            <Stack gap={6}>
                                <Text>
                                    <Text weight="semibold">体验</Text>：落子"啪"、消除"叮"、combo 上扬音阶、perfect 和声铺底、bonus 同色"哗"。完全用 oscillator 程序化合成，零音频资源。
                                </Text>
                                <Text>
                                    <Text weight="semibold">技术</Text>：单个 <Text as="span">audio.js</Text> 工具类，60 行 Web Audio。通过 <Text as="span">EffectLayer</Text> 事件总线接入（这条副带价值：让 EffectLayer 与 game.js 主路径终于统一）。
                                </Text>
                                <Text>
                                    <Text weight="semibold">皮肤升级</Text>：next step — music 皮肤钢琴音、forest 鸟鸣、ocean 水滴、industrial 金属敲击，36 款各一套，皮肤资产价值翻倍。
                                </Text>
                            </Stack>
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader trailing={<Pill tone="success" active size="sm">P0 · 2-3d</Pill>}>
                            皮肤环境粒子层（樱花飘落 / 雪花 / 萤火虫 / 极光）
                        </CardHeader>
                        <CardBody>
                            <Stack gap={6}>
                                <Text>
                                    <Text weight="semibold">体验</Text>：sakura 皮肤樱花瓣从盘面外缘缓缓飘下、winter 雪花、fairy 萤火虫游动、universe 流星划过、autumn 落叶旋转。让"配色皮肤"升级为"活的世界观"。
                                </Text>
                                <Text>
                                    <Text weight="semibold">技术</Text>：复用 v10.12 引入的 <Text as="span">fxCanvas</Text> 体系，新增 <Text as="span">_renderAmbientParticles()</Text>。先做 5 款示范（sakura / winter / forest / fairy / universe），其余按需扩展。
                                </Text>
                                <Text>
                                    <Text weight="semibold">护栏</Text>：勾入 <Text as="span">prefers-reduced-motion</Text>，无障碍用户自动关闭。
                                </Text>
                            </Stack>
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader trailing={<Pill tone="success" active size="sm">P0 · 1.5d</Pill>}>
                            节日 / 时段自动换皮推荐
                        </CardHeader>
                        <CardBody>
                            <Stack gap={6}>
                                <Text>
                                    <Text weight="semibold">体验</Text>：春节当天首次进入弹"今日推荐：故宫禁城（forbidden）"，一键启用 + 24h 后自动恢复。中秋 → autumn / koi、万圣 → demon、圣诞 → winter、4 月 1 日 → 全 emoji 限定。
                                </Text>
                                <Text>
                                    <Text weight="semibold">体验</Text>：用户已主动选定皮肤时降级为"轻提示"，不强制。
                                </Text>
                                <Text>
                                    <Text weight="semibold">技术</Text>：6 个节日节点 + 5 个时段（早曙 / 午海 / 夕阳 / 夜星 / 深夜星空）映射表，30 行配置。0 成本——皮肤资产已就绪。
                                </Text>
                            </Stack>
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader trailing={<Pill tone="success" active size="sm">P0 · 2d</Pill>}>
                            7 日签到日历 + 限定皮肤试穿券
                        </CardHeader>
                        <CardBody>
                            <Stack gap={6}>
                                <Text>
                                    <Text weight="semibold">体验</Text>：每日首次打开弹日历，第 7 天大奖 = 24h 限定皮肤试穿券（让玩家提前尝到付费皮肤）。连续打卡 7 / 30 / 100 天解锁专属勋章。
                                </Text>
                                <Text>
                                    <Text weight="semibold">技术</Text>：复用 <Text as="span">progression.js</Text> 的连续天数 streak + <Text as="span">monetization/dailyTasks</Text> 的 ymd 轮换；新增 <Text as="span">CheckInPanel</Text> 模态。
                                </Text>
                                <Text>
                                    <Text weight="semibold">商业化</Text>：试穿 → 试穿期满诱导 IAP，为皮肤付费埋管道。
                                </Text>
                            </Stack>
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader trailing={<Pill tone="success" active size="sm">P0 · 1d + 1d</Pill>}>
                            Konami 隐藏皮肤 + 4 月 1 日全 emoji 限定
                        </CardHeader>
                        <CardBody>
                            <Stack gap={6}>
                                <Text>
                                    <Text weight="semibold">体验</Text>：盘面输入 ↑↑↓↓←→←→BA → 解锁开发者第 37 款隐藏皮肤"OG 几何"（黑白极简，致敬经典）。4 月 1 日全方块变 emoji 表情（笑脸 / 哭脸 / 鬼脸），仅当日。
                                </Text>
                                <Text>
                                    <Text weight="semibold">传播</Text>：极客社区天然话题点；4.1 限定皮肤可截图分享，社交流量入口。
                                </Text>
                                <Text>
                                    <Text weight="semibold">技术</Text>：键盘事件状态机 + 日期判断，每个 ~50 行。
                                </Text>
                            </Stack>
                        </CardBody>
                    </Card>
                </Grid>
            </Stack>

            <Divider />

            {/* ───── 全量候选清单 ───── */}
            <Stack gap={16}>
                <H2>全量候选清单（35 项）</H2>
                <Text tone="secondary">
                    按 8 大分类展开。<Text as="span" weight="semibold">优先级</Text> 综合"感知 ÷ 工时 × 资产复用度"。
                </Text>

                <H3>1. 感官层（5）</H3>
                <Table
                    headers={['项目', '体验描述', '工时', '复用资产', '优先级']}
                    columnAlign={['left', 'left', 'right', 'left', 'center']}
                    rows={[
                        ['程序化音效', 'Web Audio 落子 / 消除 / combo / perfect 反馈', '1-2d', '无需资源', <Pill tone="success" active size="sm">P0</Pill>],
                        ['设备震动', 'navigator.vibrate 消除 20ms / combo 三段', '0.5d', '原生 API', <Pill tone="success" active size="sm">P0</Pill>],
                        ['皮肤专属音色', 'music 钢琴 / forest 鸟鸣 / industrial 金属', '3d', '36 款皮肤', <Pill tone="info" active size="sm">P1</Pill>],
                        ['BGM 主题循环', '每款主题独立 BGM（合成或外部资源）', '5d+', '需音频制作', <Pill tone="warning" active size="sm">P2</Pill>],
                        ['反馈强弱开关', '用户偏好（音量 / 触觉 / 动效）三档', '1d', '设置面板', <Pill tone="info" active size="sm">P1</Pill>],
                    ]}
                />

                <H3>2. 皮肤微动效（5）</H3>
                <Table
                    headers={['项目', '体验描述', '工时', '复用资产', '优先级']}
                    columnAlign={['left', 'left', 'right', 'left', 'center']}
                    rows={[
                        ['环境粒子层', 'sakura 樱花 / winter 雪 / forest 落叶', '2-3d', 'fxCanvas（v10.12）', <Pill tone="success" active size="sm">P0</Pill>],
                        ['流体背景', 'ocean 波浪 / aurora 极光带 / fairy 萤火虫', '3d', 'game-board-flow-bg', <Pill tone="info" active size="sm">P1</Pill>],
                        ['皮肤切换转场', '0.6s 主题色一闪 + 淡出/淡入', '0.5d', 'cssVars 管线', <Pill tone="success" active size="sm">P0</Pill>],
                        ['首次解锁庆祝', '新皮肤启用瞬间 3s bonus 爆炸 + 飘字', '1d', 'bonus 系统', <Pill tone="info" active size="sm">P1</Pill>],
                        ['季节限定边框', '节日盘面外光晕装饰（圣诞红绿、春节灯笼）', '1d', 'edgeFalloff（v10.13）', <Pill tone="warning" active size="sm">P2</Pill>],
                    ]}
                />

                <H3>3. 节日 / 时段 / 天气换皮（5）</H3>
                <Table
                    headers={['项目', '触发条件', '工时', '资产', '优先级']}
                    columnAlign={['left', 'left', 'right', 'left', 'center']}
                    rows={[
                        ['节日自动推荐', '春节 / 中秋 / 万圣 / 圣诞 / 4.1，仅推荐不强制', '1.5d', '皮肤库', <Pill tone="success" active size="sm">P0</Pill>],
                        ['时段动态色彩', '早曙 / 午海 / 夕阳 / 夜星，按系统时间', '1d', '皮肤库', <Pill tone="info" active size="sm">P1</Pill>],
                        ['周末活动皮肤', '周末解锁限定皮肤试穿 48h', '1d', 'skinUnlock', <Pill tone="info" active size="sm">P1</Pill>],
                        ['天气感知', '雨天推 koi / 雪天推 winter（地理 API）', '2d', 'open-meteo', <Pill tone="warning" active size="sm">P2</Pill>],
                        ['生日皮肤', '注册生日当天送限定皮肤试穿', '0.5d（需注册流）', '注册', <Pill tone="info" active size="sm">P1</Pill>],
                    ]}
                />

                <H3>4. 主动技能 / 道具（5）</H3>
                <Table
                    headers={['项目', '体验描述', '工时', '商业化', '优先级']}
                    columnAlign={['left', 'left', 'right', 'left', 'center']}
                    rows={[
                        ['hint 经济闭环', '长按方块显示推荐落点（消耗 hintToken）', '1.5d', '已有 token 通货', <Pill tone="success" active size="sm">P0</Pill>],
                        ['撤销一步', '每日 3 次免费 + 看广告获额外', '2d', '广告位', <Pill tone="success" active size="sm">P0</Pill>],
                        ['炸弹道具', '点选后消除 3×3', '2d', '抽奖 / IAP', <Pill tone="info" active size="sm">P1</Pill>],
                        ['彩虹替换', '将一格染主色，触发 bonus 同色行', '2d', '抽奖 / IAP', <Pill tone="info" active size="sm">P1</Pill>],
                        ['旋转方块', '俄罗斯方块流玩法分支', '3d', '玩法实验', <Pill tone="warning" active size="sm">P2</Pill>],
                    ]}
                />

                <H3>5. 隐藏 / 复活节彩蛋（5）</H3>
                <Table
                    headers={['项目', '触发条件', '工时', '传播', '优先级']}
                    columnAlign={['left', 'left', 'right', 'left', 'center']}
                    rows={[
                        ['Konami 隐藏皮肤', '↑↑↓↓←→←→BA 解锁第 37 款', '1d', '极客圈病毒式', <Pill tone="success" active size="sm">P0</Pill>],
                        ['4 月 1 日限定', '当日所有方块变 emoji 表情', '0.5d', '社交分享', <Pill tone="success" active size="sm">P0</Pill>],
                        ['极限成就', '7 次 perfect / 单局触发 36 种 bonus', '1d', '勋章墙', <Pill tone="info" active size="sm">P1</Pill>],
                        ['数字彩蛋', '分数到 1234 / 8888 / 12345 短特效', '0.5d', '玩家自发截图', <Pill tone="info" active size="sm">P1</Pill>],
                        ['控制台口令', 'window.openBlockGame.cheat.god() 等', '0.5d', '开发者社区', <Pill tone="warning" active size="sm">P2</Pill>],
                    ]}
                />

                <H3>6. 签到 / 宝箱 / 转盘（5）</H3>
                <Table
                    headers={['项目', '体验描述', '工时', '留存价值', '优先级']}
                    columnAlign={['left', 'left', 'right', 'left', 'center']}
                    rows={[
                        ['7 日签到日历', '第 7 天大奖 = 24h 限定皮肤试穿', '2d', 'DAU 唤起', <Pill tone="success" active size="sm">P0</Pill>],
                        ['连登勋章', '7 / 30 / 100 / 365 天里程碑', '1d', '长留存', <Pill tone="info" active size="sm">P1</Pill>],
                        ['局末宝箱', '5% 概率随机奖（hintToken / 试穿 / coin）', '1.5d', '次日回访', <Pill tone="info" active size="sm">P1</Pill>],
                        ['周末幸运转盘', '每周一 / 五各一次', '2d', '周回访', <Pill tone="info" active size="sm">P1</Pill>],
                        ['赛季进阶宝箱', '累计积分解锁稀有奖（限定皮肤）', '2d', '季留存', <Pill tone="warning" active size="sm">P2</Pill>],
                    ]}
                />

                <H3>7. 社交 / 分享（4）</H3>
                <Table
                    headers={['项目', '体验描述', '工时', '复用资产', '优先级']}
                    columnAlign={['left', 'left', 'right', 'left', 'center']}
                    rows={[
                        ['分享海报艺术化', '自动生成"分数 + 皮肤名 + 主题色"海报', '2d', 'replayShare', <Pill tone="success" active size="sm">P0</Pill>],
                        ['每日大师题', '同种子全网同题，公平比拼', '4d', 'spawnModel 种子', <Pill tone="info" active size="sm">P1</Pill>],
                        ['异步盘面挑战', '分享种子让朋友复刻', '5d', '种子化', <Pill tone="warning" active size="sm">P2</Pill>],
                        ['历史最佳棋谱回放', '本地保存 Top N 局可回放', '3d', 'replayShare 基础', <Pill tone="warning" active size="sm">P2</Pill>],
                    ]}
                />

                <H3>8. 生活化叙事（3）</H3>
                <Table
                    headers={['项目', '体验描述', '工时', '心理价值', '优先级']}
                    columnAlign={['left', 'left', 'right', 'left', 'center']}
                    rows={[
                        ['皮肤剧情图鉴', '每款 200 字小故事 + 设计灵感', '4d（含文案）', '收藏感', <Pill tone="info" active size="sm">P1</Pill>],
                        ['里程碑回放相册', '100 / 500 / 1000 局节点纪念', '3d', '情怀沉淀', <Pill tone="warning" active size="sm">P2</Pill>],
                        ['角色养成（虚拟伙伴）', '皮肤主题伙伴随等级长大', '8d+', '陪伴感', <Pill tone="warning" active size="sm">P2</Pill>],
                    ]}
                />
            </Stack>

            <Divider />

            {/* ───── 排期建议 ───── */}
            <Stack gap={12}>
                <H2>排期建议（按 sprint 切分）</H2>
                <Text tone="secondary">
                    每个 sprint 2 周（10 工作日）。建议把最高 ROI 的"感官 + 微动效 + 节日"组合先打透，再向道具 / 签到 / 隐藏彩蛋扩展。
                </Text>
                <Table
                    headers={['Sprint', '主题', '关键交付', '总工时', '验收']}
                    columnAlign={['left', 'left', 'left', 'right', 'left']}
                    rows={[
                        [
                            <Pill tone="success" active size="sm">S1</Pill>,
                            '感官 + 微动效 起步',
                            '程序化音效 + 设备震动 + 5 款皮肤环境粒子 + 切换转场',
                            '~7d',
                            '玩家"听得见、摸得到、看得活"',
                        ],
                        [
                            <Pill tone="success" active size="sm">S2</Pill>,
                            '节日 + 隐藏彩蛋',
                            '节日自动推荐 + 时段切换 + Konami 隐藏皮肤 + 4.1 限定 + 数字彩蛋',
                            '~5d',
                            '社交媒体首批截图传播',
                        ],
                        [
                            <Pill tone="info" active size="sm">S3</Pill>,
                            '签到 + 道具闭环',
                            '7 日签到日历 + hint 经济闭环 + 撤销道具 + 局末宝箱',
                            '~7d',
                            'DAU/留存指标可量化',
                        ],
                        [
                            <Pill tone="info" active size="sm">S4</Pill>,
                            '皮肤升级 + 分享',
                            '皮肤专属音色 + 流体背景 + 海报艺术化 + 极限成就',
                            '~10d',
                            '皮肤资产价值翻倍',
                        ],
                        [
                            <Pill tone="info" active size="sm">S5</Pill>,
                            '玩法深度 + 长留存',
                            '炸弹 + 彩虹道具 + 周末转盘 + 皮肤剧情图鉴',
                            '~9d',
                            '商业化路径完整',
                        ],
                        [
                            <Pill tone="warning" active size="sm">S6+</Pill>,
                            '社交 / 大工程',
                            '每日大师题 / 异步 PK / 角色养成 / 棋谱回放',
                            '~20d+',
                            '分阶段评估',
                        ],
                    ]}
                />
            </Stack>

            <Divider />

            {/* ───── 决策辅助 ───── */}
            <Stack gap={10}>
                <H2>下一步决策</H2>
                <Row gap={8} wrap>
                    <Pill tone="success" size="sm">建议先冲 S1：4 项 P0，~7d 全可上线，玩家感知最强烈</Pill>
                </Row>
                <Text tone="secondary" size="small">
                    如需就某项展开技术方案、API 草图、数据埋点、商业化漏斗等细节，告诉我具体编号即可。也可针对"哪些 P1 / P2 应提前 / 推迟"做权衡分析。
                </Text>
            </Stack>
        </Stack>
    );
}
