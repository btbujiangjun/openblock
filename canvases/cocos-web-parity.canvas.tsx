import {
  Stack,
  Row,
  Grid,
  H1,
  H2,
  Text,
  Pill,
  Stat,
  Table,
  Toggle,
  Checkbox,
  Callout,
  Divider,
  Spacer,
  UsageBar,
  useCanvasState,
  useHostTheme,
} from "cursor/canvas";

type Status = "done" | "partial" | "missing" | "arch";
type Prio = "P0" | "P1" | "P2" | "-";

interface Item {
  id: string;
  name: string;
  note?: string;
  web: string;
  cocos: string;
  status: Status;
  prio: Prio;
}

interface Category {
  key: string;
  title: string;
  items: Item[];
}

// track = 可作为「追平任务」勾选的项（差距项）；done / arch 不计入。
const isTrackable = (it: Item) => it.status === "partial" || it.status === "missing";

const CATEGORIES: Category[] = [
  {
    key: "render",
    title: "渲染与外观",
    items: [
      { id: "pipeline", name: "渲染管线", note: "架构性差异，非缺口", web: "DOM + CSS + Canvas", cocos: "引擎程序化绘制", status: "arch", prio: "-" },
      { id: "art", name: "美术资源（图片/贴图/动画）", note: "ROADMAP Phase 2 待接资源", web: "CSS 精修视觉", cocos: "全代码画方块，无图片", status: "missing", prio: "P1" },
      { id: "skins", name: "皮肤色板 / icon（34 套）", web: "34 套", cocos: "34 套已移植", status: "done", prio: "-" },
      { id: "skintheme", name: "皮肤 DOM 主题（水印/cssVars/UI 色）", note: "cocos 仅消费渲染字段", web: "有", cocos: "未消费", status: "partial", prio: "P2" },
      { id: "festival", name: "节日皮肤（愚人节 emoji 覆盖）", web: "有", cocos: "无", status: "missing", prio: "P2" },
      { id: "weather", name: "天气 / 季节强调特效", web: "有 weather 层", cocos: "仅季节默认皮", status: "partial", prio: "P2" },
      { id: "splash", name: "启动闪屏", web: "有", cocos: "有 Splash", status: "done", prio: "-" },
    ],
  },
  {
    key: "ia",
    title: "屏幕 / 信息架构",
    items: [
      { id: "menu", name: "主菜单首屏", note: "cocos 直接进棋盘", web: "menu screen", cocos: "无", status: "missing", prio: "P1" },
      { id: "modesel", name: "模式选择", web: "有", cocos: "ModeSelect(Modal)", status: "done", prio: "-" },
      { id: "editor", name: "关卡编辑器", web: "level-editor", cocos: "无", status: "missing", prio: "P2" },
      { id: "replay", name: "回放（列表 + 回看）", web: "replay 双屏", cocos: "无", status: "missing", prio: "P2" },
      { id: "ops", name: "运营 / 调试面板", note: "内部工具", web: "ops / db debug", cocos: "无", status: "missing", prio: "P2" },
    ],
  },
  {
    key: "core",
    title: "核心玩法（基本同源）",
    items: [
      { id: "scoring", name: "计分 / 形状池 / 消行 / RNG", web: "真源", cocos: "移植自 core", status: "done", prio: "-" },
      { id: "engine", name: "出块引擎", note: "engine/* 原样生成，100% 同源", web: "真源", cocos: "engineSpawn 已接", status: "done", prio: "-" },
      { id: "adaptive", name: "自适应难度", web: "derivePbCurve", cocos: "忠实移植 + 回退", status: "done", prio: "-" },
      { id: "modes", name: "玩法模式 classic/zen/lightning", note: "web 派生层另有 sprint 等变体", web: "≥3", cocos: "3 种", status: "done", prio: "-" },
      { id: "skills", name: "技能体系（hint/undo/bomb/rainbow/freeze/reroll…）", web: "全量", cocos: "全量", status: "done", prio: "-" },
    ],
  },
  {
    key: "meta",
    title: "元系统 / 留存",
    items: [
      { id: "checkin", name: "签到 / 任务 / 赛季", web: "有", cocos: "core/meta + daily", status: "done", prio: "-" },
      { id: "revive", name: "续命 revive", web: "有", cocos: "GameModel.revive", status: "done", prio: "-" },
      { id: "chest", name: "结算开箱 + 幸运转盘", web: "有", cocos: "core/rewards + Wheel", status: "done", prio: "-" },
      { id: "progress", name: "等级经验 + 成就", web: "有", cocos: "progression/achievements", status: "done", prio: "-" },
      { id: "welcome", name: "回流 welcomeBack + 首日礼包", web: "有", cocos: "maybeWelcomeBack", status: "done", prio: "-" },
      { id: "remote", name: "远程配置 / featureFlags", web: "有", cocos: "core/remoteConfig", status: "done", prio: "-" },
    ],
  },
  {
    key: "money",
    title: "商业化",
    items: [
      { id: "rv", name: "激励视频（revive/翻倍/转盘/reroll）", note: "两端都缺真实广告网络", web: "ad 决策", cocos: "契约就绪（填 adUnitId）", status: "partial", prio: "P0" },
      { id: "iap", name: "IAP 商品表 / 结算", note: "套壳/原生计费均缺 → 合规风险", web: "paymentManager", cocos: "商品表 + 适配", status: "partial", prio: "P0" },
      { id: "wechat", name: "微信广告 / 支付适配", web: "—", cocos: "WechatAdapters 就绪", status: "partial", prio: "P1" },
      { id: "nativesdk", name: "原生 iOS/Android 广告 & IAP SDK 桥接", note: "mobile 套壳 + cocos 均未接", web: "无原生 SDK", cocos: "无", status: "missing", prio: "P0" },
    ],
  },
  {
    key: "social",
    title: "社交 / 数据",
    items: [
      { id: "share", name: "分享裂变", web: "有", cocos: "platform/Share", status: "done", prio: "-" },
      { id: "cloud", name: "云存档 + 离线队列", web: "有", cocos: "CloudSync", status: "done", prio: "-" },
      { id: "analytics", name: "埋点上报", web: "有", cocos: "analytics + Sink", status: "done", prio: "-" },
      { id: "rl", name: "RL 出块 / 玩家画像下沉", note: "接缝就绪，当前用中性 context", web: "完整画像", cocos: "spawnModel 接缝", status: "partial", prio: "P2" },
      { id: "pk", name: "asyncPK / 好友 / 公会", note: "需服务器", web: "有", cocos: "脚手架 + 契约", status: "partial", prio: "P2" },
    ],
  },
  {
    key: "exclusive",
    title: "Web 独有 · cocos 未移植",
    items: [
      { id: "companion", name: "伙伴系统 companion", web: "有", cocos: "无", status: "missing", prio: "P2" },
      { id: "lore", name: "皮肤故事 lore", web: "有", cocos: "无", status: "missing", prio: "P2" },
    ],
  },
];

const ALL_ITEMS = CATEGORIES.flatMap((c) => c.items);
const TRACKABLE = ALL_ITEMS.filter(isTrackable);

function statusTone(s: Status): "success" | "warning" | "deleted" | "neutral" {
  if (s === "done") return "success";
  if (s === "partial") return "warning";
  if (s === "missing") return "deleted";
  return "neutral";
}
function statusLabel(s: Status): string {
  if (s === "done") return "已对齐";
  if (s === "partial") return "子集/占位";
  if (s === "missing") return "缺失";
  return "架构差异";
}
function prioTone(p: Prio): "deleted" | "warning" | "info" | "neutral" {
  if (p === "P0") return "deleted";
  if (p === "P1") return "warning";
  if (p === "P2") return "info";
  return "neutral";
}

export default function CocosWebParity() {
  const theme = useHostTheme();
  const [checks, setChecks] = useCanvasState<Record<string, boolean>>("parityChecks", {});
  const [prioFilter, setPrioFilter] = useCanvasState<string>("prioFilter", "all");
  const [hideDone, setHideDone] = useCanvasState<boolean>("hideDone", false);

  const toggle = (id: string, v: boolean) => setChecks((p) => ({ ...p, [id]: v }));

  const doneCount = ALL_ITEMS.filter((i) => i.status === "done").length;
  const gapCount = TRACKABLE.length;
  const checkedCount = TRACKABLE.filter((i) => checks[i.id]).length;
  const p0Open = TRACKABLE.filter((i) => i.prio === "P0" && !checks[i.id]).length;

  const prios = ["all", "P0", "P1", "P2"];

  const visible = (it: Item) => {
    if (prioFilter !== "all" && it.prio !== prioFilter) return false;
    if (hideDone) {
      // 隐藏「已对齐 / 架构差异 / 已勾选完成」，只看剩余差距
      if (!isTrackable(it)) return false;
      if (checks[it.id]) return false;
    }
    return true;
  };

  return (
    <Stack gap={20} style={{ padding: 24, maxWidth: 1180, margin: "0 auto" }}>
      <Stack gap={6}>
        <H1>cocos 追平 web 功能清单</H1>
        <Text tone="secondary">
          对照对象：<Text as="span" weight="semibold">cocos</Text>（Cocos 引擎原生重写）vs{" "}
          <Text as="span" weight="semibold">web</Text>（= mobile 套壳所加载的完整产品）。勾选用于跟踪「已追平」进度，状态随 IDE 重启保留。
        </Text>
      </Stack>

      <Callout tone="info" title="为什么体感像两个 app">
        mobile 是把 web 整个塞进 WebView 的套壳（所见即 web）；cocos 是只复用 core 逻辑、表现层 100% 重画的原生端，目前是「核心玩法已基本对齐，外观/信息架构/部分大模块仍是子集」。
      </Callout>

      <Grid columns={4} gap={16}>
        <Stat value={doneCount} label="已对齐能力" tone="success" />
        <Stat value={gapCount} label="待追平差距" tone="warning" />
        <Stat value={`${checkedCount}/${gapCount}`} label="已勾选完成" />
        <Stat value={p0Open} label="未完成 P0" tone={p0Open > 0 ? "danger" : "success"} />
      </Grid>

      <Stack gap={8}>
        <UsageBar
          total={gapCount}
          topLeftLabel={`追平进度 ${gapCount ? Math.round((checkedCount / gapCount) * 100) : 0}%`}
          topRightLabel={`${checkedCount} / ${gapCount} 差距项已勾选`}
          segments={[{ id: "done", value: checkedCount, color: "green" }]}
        />
      </Stack>

      <Row gap={10} align="center" wrap>
        <Text tone="tertiary" size="small">优先级</Text>
        {prios.map((p) => (
          <Pill key={p} active={prioFilter === p} onClick={() => setPrioFilter(p)}>
            {p === "all" ? "全部" : p}
          </Pill>
        ))}
        <Spacer />
        <Text tone="tertiary" size="small">只看待追平</Text>
        <Toggle checked={hideDone} onChange={setHideDone} />
      </Row>

      <Divider />

      {CATEGORIES.map((cat) => {
        const items = cat.items.filter(visible);
        if (items.length === 0) return null;
        const catGap = cat.items.filter(isTrackable).length;
        const catDone = cat.items.filter((i) => isTrackable(i) && checks[i.id]).length;

        const rows = items.map((it) => [
          <Stack gap={2}>
            <Text weight="semibold">{it.name}</Text>
            {it.note ? <Text size="small" tone="tertiary">{it.note}</Text> : null}
          </Stack>,
          <Text size="small" tone="secondary">{it.web}</Text>,
          <Row gap={8} align="center">
            <Pill size="sm" tone={statusTone(it.status)} active>
              {statusLabel(it.status)}
            </Pill>
            <Text size="small" tone="tertiary">{it.cocos}</Text>
          </Row>,
          it.prio === "-" ? (
            <Text tone="quaternary">—</Text>
          ) : (
            <Pill size="sm" tone={prioTone(it.prio)}>{it.prio}</Pill>
          ),
          isTrackable(it) ? (
            <Checkbox checked={!!checks[it.id]} onChange={(v) => toggle(it.id, v)} />
          ) : (
            <Text tone="quaternary">—</Text>
          ),
        ]);

        const rowTone = items.map((it) =>
          it.status === "missing" ? ("danger" as const)
            : it.status === "partial" ? ("warning" as const)
            : undefined,
        );

        return (
          <Stack key={cat.key} gap={10}>
            <Row align="center" gap={10}>
              <H2 style={{ margin: 0 }}>{cat.title}</H2>
              <Spacer />
              {catGap > 0 ? (
                <Text size="small" tone="tertiary">
                  追平 {catDone}/{catGap}
                </Text>
              ) : (
                <Text size="small" tone="tertiary" style={{ color: theme.accent.primary }}>
                  全部对齐
                </Text>
              )}
            </Row>
            <Table
              headers={["能力", "Web", "Cocos 现状", "优先级", "完成"]}
              columnAlign={["left", "left", "left", "center", "center"]}
              rows={rows}
              rowTone={rowTone}
              striped
            />
          </Stack>
        );
      })}
    </Stack>
  );
}
