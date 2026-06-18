/* 自动生成 —— 请勿手改。源：web/src/onboarding/newbieVillageStrings.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * newbieVillageStrings.js — 新手村文案多语言字典（独立集中维护，三端共享）
 *
 * 设计取舍：
 *   - **独立于 web/cocos/miniprogram 各自 i18n 框架**：新手村文案量大（5 课 × 3 段 + UI ~15 段），
 *     直接注入各端 i18n 字典会让 19 语言包各膨胀 ~50 key，维护、跨端同步成本极高。
 *     这里把全部文案集中在一个 ESM 文件里，三端按 locale 直接取，最小耦合。
 *   - 语言回退：缺译时回退至 'en'，再回退 'zh-CN'（与 web i18n 体系兜底链对齐）。
 *   - 占位符 {{n}}：与 web i18n.t 相同的简易 mustache 风格。
 *
 * 同步策略：
 *   - web 原始文件；scripts/sync-core.sh + sync-cocos-engine.mjs 同步到 miniprogram / cocos。
 *
 * 翻译覆盖：
 *   - zh-CN + en：精译；
 *   - 其它 17 语言：当前仅 UI 关键文案（ui.title/ui.skip/ui.cta/ui.score/ui.subTitle/ui.subHook/
 *     reward.title/reward.hint/reward.undo/reward.coin/skill.* / graduate.title/graduate.subtitle）
 *     提供本地化；教程长文 (scenario.coach/reveal) 暂时回退 en。后续由人工补译。
 */

 

const zhCN = {
    // ── 入口与全局 UI ────────────────────────────────────────────────
    'ui.title': '🏕️ 新手村',
    'ui.skip': '跳过引导',
    'ui.totalScore': '总分 {{n}}',
    'ui.ariaLabel': '新手村教程',

    // 实时反馈横幅
    'banner.perfect': 'PERFECT 清屏',
    'banner.combo': '连击 ×{{n}}',
    'banner.mono': '同花 BONUS ×{{n}}',
    'banner.multi': '多消 ×{{n}}',

    // ── 5 课教程（coach / reveal）─────────────────────────────────────
    'scenario.single.coach.title': '第 1 课 · 单消',
    'scenario.single.coach.body': '按住下方发光的方块拖到闪烁缺口松手落子。这是一条「1×4」候选块——填满一整行即可消除，基础分 = 20 × 行列数²。',
    'scenario.single.reveal.title': '单消达成！',
    'scenario.single.reveal.body': '消除 1 条线，基础分 = 20 × 1² = 20。每消一行/列都会立即结算并飘出「+分数」。',

    'scenario.multi.coach.title': '第 2 课 · 多消',
    'scenario.multi.coach.body': '这是「2×2」方块。放进右下角缺口，会**一手同时填满两行**！多消基础分按数量平方放大：20 × 2² = 80。',
    'scenario.multi.reveal.title': '多消 ×2！',
    'scenario.multi.reveal.body': '一次落子清掉 2 条线，基础分 = 20 × 2² = 80。这就是「多消」的平方奖励——消得越多越值。',

    'scenario.mono.coach.title': '第 3 课 · 同花消除',
    'scenario.mono.coach.body': '这是「4×1」竖条。把它补进左侧同色列，让**整列颜色一致** —— 触发「同花」奖励，该列得分 ×5！',
    'scenario.mono.reveal.title': '同花 BONUS！',
    'scenario.mono.reveal.body': '整列同色触发同花：该线得分 ×5（20 → 100）。凑同色是高分的关键技巧之一。',

    'scenario.combo.coach.title': '第 4 课 · 连击 Combo',
    'scenario.combo.coach.body': '连续多手都消行会点燃 combo（♥N）：♥3 起得分 ×2、♥4 ×3、♥5+ ×4！连放 3 条「1×4」横条，逐行补满。',
    'scenario.combo.reveal.title': '连击 ♥3 ×2！',
    'scenario.combo.reveal.body': 'combo 在整局里持续累积：连续清线越多，♥N 越高、倍率越大。这一手已经吃到 ×2 加成。',

    'scenario.perfect.coach.title': '第 5 课 · 清屏 Perfect',
    'scenario.perfect.coach.body': '终极爽点：用这枚「2×3」方块补满最后两行，把**整个棋盘清空** —— 触发 PERFECT，全部得分 ×10！',
    'scenario.perfect.reveal.title': 'PERFECT 清屏！',
    'scenario.perfect.reveal.body': '盘面被彻底清空，触发完美清屏：全部得分 ×10。这是冲击高分的最强一击！',

    // ── 结业页 ──────────────────────────────────────────────────────
    'graduate.title': '出师啦！',
    'graduate.subtitle': '— 新手训练全部完成 —',
    'graduate.scoreLabel': '训练得分',
    'graduate.skill.single': '单消',
    'graduate.skill.multi': '多消',
    'graduate.skill.mono': '同花',
    'graduate.skill.combo': '连击',
    'graduate.skill.perfect': '清屏',
    'graduate.reward.title': '🎁 新手礼包',
    'graduate.reward.hint': '提示 ×2',
    'graduate.reward.undo': '撤销 ×1',
    'graduate.reward.coin': '金币 ×100',
    'graduate.cta': '🚀  开始挑战',
    'graduate.ctaHint': '正式对局规则一致 · PB 等你刷新 🏆',
    // 用于 web 旧版渲染的整段文案（HTML 含 <b> 标签）
    'graduate.bodyHtml': '你已掌握 <b>单消 / 多消 / 同花 / 连击 / 清屏</b>，训练赛累计得分 <b>{{n}}</b>。真实对局采用同样的计分规则，去冲击最高分吧！',
};

const en = {
    'ui.title': '🏕️ Newbie Village',
    'ui.skip': 'Skip tutorial',
    'ui.totalScore': 'Total {{n}}',
    'ui.ariaLabel': 'Newbie Village tutorial',

    'banner.perfect': 'PERFECT clear',
    'banner.combo': 'Combo ×{{n}}',
    'banner.mono': 'Royal flush BONUS ×{{n}}',
    'banner.multi': '{{n}}x clear',

    'scenario.single.coach.title': 'Lesson 1 · Single clear',
    'scenario.single.coach.body': 'Press and drag the glowing block below into the flashing gap to drop it. This is a "1×4" piece — fill a whole row to clear it. Base score = 20 × lines².',
    'scenario.single.reveal.title': 'Single clear!',
    'scenario.single.reveal.body': '1 line cleared, base score = 20 × 1² = 20. Every cleared row/column scores immediately with a floating "+points".',

    'scenario.multi.coach.title': 'Lesson 2 · Multi clear',
    'scenario.multi.coach.body': 'This "2×2" piece drops into the bottom-right gap and **fills two rows in one move**! Multi-clear base score scales by the square of lines: 20 × 2² = 80.',
    'scenario.multi.reveal.title': 'Multi clear ×2!',
    'scenario.multi.reveal.body': 'One drop cleared 2 lines, base = 20 × 2² = 80. The "multi" squared bonus — more clears, more value.',

    'scenario.mono.coach.title': 'Lesson 3 · Royal flush',
    'scenario.mono.coach.body': 'This "4×1" vertical bar fits the left same-color column to make **the whole column one color** — triggering "royal flush" for ×5 column score!',
    'scenario.mono.reveal.title': 'Royal flush BONUS!',
    'scenario.mono.reveal.body': 'Whole column same color triggers royal flush: that line scores ×5 (20 → 100). Color-matching is a key high-score skill.',

    'scenario.combo.coach.title': 'Lesson 4 · Combo',
    'scenario.combo.coach.body': 'Consecutive clears ignite combos (♥N): ♥3 = ×2, ♥4 = ×3, ♥5+ = ×4! Place 3 "1×4" bars in a row, filling each line.',
    'scenario.combo.reveal.title': 'Combo ♥3 ×2!',
    'scenario.combo.reveal.body': 'Combos build through the run: more consecutive clears, higher ♥N, bigger multiplier. This move already gets ×2.',

    'scenario.perfect.coach.title': 'Lesson 5 · Perfect clear',
    'scenario.perfect.coach.body': 'The ultimate thrill: use this "2×3" piece to fill the last two rows and **empty the entire board** — triggering PERFECT for ×10 to all scores!',
    'scenario.perfect.reveal.title': 'PERFECT clear!',
    'scenario.perfect.reveal.body': 'Board completely cleared, perfect clear triggered: all scores ×10. The strongest single move for high scores!',

    'graduate.title': 'Graduated!',
    'graduate.subtitle': '— Newbie training complete —',
    'graduate.scoreLabel': 'Training score',
    'graduate.skill.single': 'Single',
    'graduate.skill.multi': 'Multi',
    'graduate.skill.mono': 'Flush',
    'graduate.skill.combo': 'Combo',
    'graduate.skill.perfect': 'Perfect',
    'graduate.reward.title': '🎁 Welcome pack',
    'graduate.reward.hint': 'Hint ×2',
    'graduate.reward.undo': 'Undo ×1',
    'graduate.reward.coin': 'Coin ×100',
    'graduate.cta': '🚀  Start challenge',
    'graduate.ctaHint': 'Same rules as real games · Beat your PB 🏆',
    'graduate.bodyHtml': 'You\'ve mastered <b>Single / Multi / Flush / Combo / Perfect</b>, total training score <b>{{n}}</b>. Real games use the same scoring rules — go for your high score!',
};

/**
 * 17 个其它语言 —— 只本地化「关键 UI 短文案」（按钮、标题、礼包项），
 * 教程长文（scenario.coach / reveal）暂时缺译，运行时回退 en。
 *
 * 这是一种刻意的范围控制：保证非中英母语玩家能识别按钮和奖励，
 * 而教程长文留待后续人工/翻译团队按语言批次补译。
 *
 * 各语言的关键键命名规则：与 zh-CN / en 一致。
 */

const ja = {
    'ui.title': '🏕️ 初心者の村',
    'ui.skip': 'チュートリアルをスキップ',
    'ui.totalScore': '合計 {{n}}',
    'ui.ariaLabel': '初心者の村チュートリアル',
    'graduate.title': '卒業！',
    'graduate.subtitle': '— 初心者トレーニング完了 —',
    'graduate.scoreLabel': 'トレーニング得点',
    'graduate.skill.single': 'シングル',
    'graduate.skill.multi': 'マルチ',
    'graduate.skill.mono': 'フラッシュ',
    'graduate.skill.combo': 'コンボ',
    'graduate.skill.perfect': 'パーフェクト',
    'graduate.reward.title': '🎁 初心者パック',
    'graduate.reward.hint': 'ヒント ×2',
    'graduate.reward.undo': 'やり直し ×1',
    'graduate.reward.coin': 'コイン ×100',
    'graduate.cta': '🚀  チャレンジ開始',
    'graduate.ctaHint': '本番と同じルール · PBに挑め 🏆',
};

const ko = {
    'ui.title': '🏕️ 신입 마을',
    'ui.skip': '튜토리얼 건너뛰기',
    'ui.totalScore': '합계 {{n}}',
    'ui.ariaLabel': '신입 마을 튜토리얼',
    'graduate.title': '졸업!',
    'graduate.subtitle': '— 신입 훈련 완료 —',
    'graduate.scoreLabel': '훈련 점수',
    'graduate.skill.single': '싱글',
    'graduate.skill.multi': '멀티',
    'graduate.skill.mono': '플러시',
    'graduate.skill.combo': '콤보',
    'graduate.skill.perfect': '퍼펙트',
    'graduate.reward.title': '🎁 신입 패키지',
    'graduate.reward.hint': '힌트 ×2',
    'graduate.reward.undo': '되돌리기 ×1',
    'graduate.reward.coin': '코인 ×100',
    'graduate.cta': '🚀  도전 시작',
    'graduate.ctaHint': '실전과 동일한 규칙 · PB를 갱신해 🏆',
};

const fr = {
    'ui.title': '🏕️ Village des débutants',
    'ui.skip': 'Passer le tutoriel',
    'ui.totalScore': 'Total {{n}}',
    'ui.ariaLabel': 'Tutoriel du village des débutants',
    'graduate.title': 'Diplômé !',
    'graduate.subtitle': '— Entraînement terminé —',
    'graduate.scoreLabel': 'Score d\'entraînement',
    'graduate.skill.single': 'Simple',
    'graduate.skill.multi': 'Multi',
    'graduate.skill.mono': 'Couleur',
    'graduate.skill.combo': 'Combo',
    'graduate.skill.perfect': 'Parfait',
    'graduate.reward.title': '🎁 Pack débutant',
    'graduate.reward.hint': 'Indice ×2',
    'graduate.reward.undo': 'Annuler ×1',
    'graduate.reward.coin': 'Pièce ×100',
    'graduate.cta': '🚀  Commencer le défi',
    'graduate.ctaHint': 'Mêmes règles qu\'en partie · Battez votre PB 🏆',
};

const de = {
    'ui.title': '🏕️ Anfängerdorf',
    'ui.skip': 'Tutorial überspringen',
    'ui.totalScore': 'Gesamt {{n}}',
    'ui.ariaLabel': 'Anfängerdorf-Tutorial',
    'graduate.title': 'Geschafft!',
    'graduate.subtitle': '— Anfängertraining abgeschlossen —',
    'graduate.scoreLabel': 'Trainingspunkte',
    'graduate.skill.single': 'Einzel',
    'graduate.skill.multi': 'Multi',
    'graduate.skill.mono': 'Flush',
    'graduate.skill.combo': 'Combo',
    'graduate.skill.perfect': 'Perfekt',
    'graduate.reward.title': '🎁 Anfängerpaket',
    'graduate.reward.hint': 'Hinweis ×2',
    'graduate.reward.undo': 'Rückgängig ×1',
    'graduate.reward.coin': 'Münze ×100',
    'graduate.cta': '🚀  Herausforderung starten',
    'graduate.ctaHint': 'Gleiche Regeln wie im Spiel · Schlage deinen PB 🏆',
};

const es = {
    'ui.title': '🏕️ Aldea de novatos',
    'ui.skip': 'Saltar tutorial',
    'ui.totalScore': 'Total {{n}}',
    'ui.ariaLabel': 'Tutorial de la aldea de novatos',
    'graduate.title': '¡Graduado!',
    'graduate.subtitle': '— Entrenamiento completado —',
    'graduate.scoreLabel': 'Puntos de entrenamiento',
    'graduate.skill.single': 'Simple',
    'graduate.skill.multi': 'Múltiple',
    'graduate.skill.mono': 'Color',
    'graduate.skill.combo': 'Combo',
    'graduate.skill.perfect': 'Perfecto',
    'graduate.reward.title': '🎁 Pack de novato',
    'graduate.reward.hint': 'Pista ×2',
    'graduate.reward.undo': 'Deshacer ×1',
    'graduate.reward.coin': 'Moneda ×100',
    'graduate.cta': '🚀  Comenzar desafío',
    'graduate.ctaHint': 'Mismas reglas que en partida · Supera tu PB 🏆',
};

const it = {
    'ui.title': '🏕️ Villaggio dei novizi',
    'ui.skip': 'Salta tutorial',
    'ui.totalScore': 'Totale {{n}}',
    'ui.ariaLabel': 'Tutorial del villaggio dei novizi',
    'graduate.title': 'Diplomato!',
    'graduate.subtitle': '— Allenamento completato —',
    'graduate.scoreLabel': 'Punti allenamento',
    'graduate.skill.single': 'Singolo',
    'graduate.skill.multi': 'Multi',
    'graduate.skill.mono': 'Colore',
    'graduate.skill.combo': 'Combo',
    'graduate.skill.perfect': 'Perfetto',
    'graduate.reward.title': '🎁 Pacchetto novizio',
    'graduate.reward.hint': 'Suggerimento ×2',
    'graduate.reward.undo': 'Annulla ×1',
    'graduate.reward.coin': 'Moneta ×100',
    'graduate.cta': '🚀  Inizia sfida',
    'graduate.ctaHint': 'Stesse regole della partita · Batti il tuo PB 🏆',
};

const ptBR = {
    'ui.title': '🏕️ Vila dos iniciantes',
    'ui.skip': 'Pular tutorial',
    'ui.totalScore': 'Total {{n}}',
    'ui.ariaLabel': 'Tutorial da vila dos iniciantes',
    'graduate.title': 'Formado!',
    'graduate.subtitle': '— Treinamento completo —',
    'graduate.scoreLabel': 'Pontos de treino',
    'graduate.skill.single': 'Único',
    'graduate.skill.multi': 'Múltiplo',
    'graduate.skill.mono': 'Cor',
    'graduate.skill.combo': 'Combo',
    'graduate.skill.perfect': 'Perfeito',
    'graduate.reward.title': '🎁 Pacote iniciante',
    'graduate.reward.hint': 'Dica ×2',
    'graduate.reward.undo': 'Desfazer ×1',
    'graduate.reward.coin': 'Moeda ×100',
    'graduate.cta': '🚀  Iniciar desafio',
    'graduate.ctaHint': 'Mesmas regras do jogo · Bata seu PB 🏆',
};

const nl = {
    'ui.title': '🏕️ Beginnersdorp',
    'ui.skip': 'Tutorial overslaan',
    'ui.totalScore': 'Totaal {{n}}',
    'ui.ariaLabel': 'Beginnersdorp tutorial',
    'graduate.title': 'Geslaagd!',
    'graduate.subtitle': '— Training voltooid —',
    'graduate.scoreLabel': 'Trainingsscore',
    'graduate.skill.single': 'Enkel',
    'graduate.skill.multi': 'Multi',
    'graduate.skill.mono': 'Kleur',
    'graduate.skill.combo': 'Combo',
    'graduate.skill.perfect': 'Perfect',
    'graduate.reward.title': '🎁 Beginnerspakket',
    'graduate.reward.hint': 'Tip ×2',
    'graduate.reward.undo': 'Ongedaan ×1',
    'graduate.reward.coin': 'Munt ×100',
    'graduate.cta': '🚀  Start uitdaging',
    'graduate.ctaHint': 'Zelfde regels als in het spel · Verbreek je PB 🏆',
};

const ru = {
    'ui.title': '🏕️ Деревня новичков',
    'ui.skip': 'Пропустить обучение',
    'ui.totalScore': 'Всего {{n}}',
    'ui.ariaLabel': 'Обучение деревни новичков',
    'graduate.title': 'Выпуск!',
    'graduate.subtitle': '— Обучение завершено —',
    'graduate.scoreLabel': 'Очки обучения',
    'graduate.skill.single': 'Один',
    'graduate.skill.multi': 'Мульти',
    'graduate.skill.mono': 'Флеш',
    'graduate.skill.combo': 'Комбо',
    'graduate.skill.perfect': 'Идеально',
    'graduate.reward.title': '🎁 Пакет новичка',
    'graduate.reward.hint': 'Подсказка ×2',
    'graduate.reward.undo': 'Отменить ×1',
    'graduate.reward.coin': 'Монета ×100',
    'graduate.cta': '🚀  Начать вызов',
    'graduate.ctaHint': 'Те же правила, что и в игре · Побей свой ПБ 🏆',
};

const uk = {
    'ui.title': '🏕️ Село новачків',
    'ui.skip': 'Пропустити навчання',
    'ui.totalScore': 'Усього {{n}}',
    'ui.ariaLabel': 'Навчання села новачків',
    'graduate.title': 'Випуск!',
    'graduate.subtitle': '— Тренування завершено —',
    'graduate.scoreLabel': 'Очки тренування',
    'graduate.skill.single': 'Один',
    'graduate.skill.multi': 'Мульті',
    'graduate.skill.mono': 'Флеш',
    'graduate.skill.combo': 'Комбо',
    'graduate.skill.perfect': 'Ідеально',
    'graduate.reward.title': '🎁 Пакет новачка',
    'graduate.reward.hint': 'Підказка ×2',
    'graduate.reward.undo': 'Скасувати ×1',
    'graduate.reward.coin': 'Монета ×100',
    'graduate.cta': '🚀  Почати виклик',
    'graduate.ctaHint': 'Ті самі правила, що в грі · Побий свій ПБ 🏆',
};

const pl = {
    'ui.title': '🏕️ Wioska nowicjuszy',
    'ui.skip': 'Pomiń samouczek',
    'ui.totalScore': 'Razem {{n}}',
    'ui.ariaLabel': 'Samouczek wioski nowicjuszy',
    'graduate.title': 'Ukończone!',
    'graduate.subtitle': '— Trening zakończony —',
    'graduate.scoreLabel': 'Punkty treningu',
    'graduate.skill.single': 'Pojedyncze',
    'graduate.skill.multi': 'Multi',
    'graduate.skill.mono': 'Kolor',
    'graduate.skill.combo': 'Combo',
    'graduate.skill.perfect': 'Perfekt',
    'graduate.reward.title': '🎁 Pakiet startowy',
    'graduate.reward.hint': 'Podpowiedź ×2',
    'graduate.reward.undo': 'Cofnij ×1',
    'graduate.reward.coin': 'Moneta ×100',
    'graduate.cta': '🚀  Rozpocznij wyzwanie',
    'graduate.ctaHint': 'Te same zasady co w grze · Pobij swój PB 🏆',
};

const tr = {
    'ui.title': '🏕️ Acemi köyü',
    'ui.skip': 'Eğitimi atla',
    'ui.totalScore': 'Toplam {{n}}',
    'ui.ariaLabel': 'Acemi köyü eğitimi',
    'graduate.title': 'Mezun oldun!',
    'graduate.subtitle': '— Eğitim tamamlandı —',
    'graduate.scoreLabel': 'Eğitim puanı',
    'graduate.skill.single': 'Tek',
    'graduate.skill.multi': 'Çoklu',
    'graduate.skill.mono': 'Renk',
    'graduate.skill.combo': 'Kombo',
    'graduate.skill.perfect': 'Mükemmel',
    'graduate.reward.title': '🎁 Başlangıç paketi',
    'graduate.reward.hint': 'İpucu ×2',
    'graduate.reward.undo': 'Geri al ×1',
    'graduate.reward.coin': 'Para ×100',
    'graduate.cta': '🚀  Meydan okumayı başlat',
    'graduate.ctaHint': 'Oyunla aynı kurallar · Rekorunu kır 🏆',
};

const vi = {
    'ui.title': '🏕️ Làng tân thủ',
    'ui.skip': 'Bỏ qua hướng dẫn',
    'ui.totalScore': 'Tổng {{n}}',
    'ui.ariaLabel': 'Hướng dẫn làng tân thủ',
    'graduate.title': 'Tốt nghiệp!',
    'graduate.subtitle': '— Huấn luyện hoàn tất —',
    'graduate.scoreLabel': 'Điểm huấn luyện',
    'graduate.skill.single': 'Đơn',
    'graduate.skill.multi': 'Đa',
    'graduate.skill.mono': 'Đồng màu',
    'graduate.skill.combo': 'Combo',
    'graduate.skill.perfect': 'Hoàn hảo',
    'graduate.reward.title': '🎁 Gói tân thủ',
    'graduate.reward.hint': 'Gợi ý ×2',
    'graduate.reward.undo': 'Hoàn tác ×1',
    'graduate.reward.coin': 'Xu ×100',
    'graduate.cta': '🚀  Bắt đầu thử thách',
    'graduate.ctaHint': 'Cùng luật chơi · Phá kỷ lục cá nhân 🏆',
};

const th = {
    'ui.title': '🏕️ หมู่บ้านมือใหม่',
    'ui.skip': 'ข้ามบทเรียน',
    'ui.totalScore': 'รวม {{n}}',
    'ui.ariaLabel': 'บทเรียนหมู่บ้านมือใหม่',
    'graduate.title': 'จบการศึกษา!',
    'graduate.subtitle': '— ฝึกซ้อมเสร็จสมบูรณ์ —',
    'graduate.scoreLabel': 'คะแนนฝึกซ้อม',
    'graduate.skill.single': 'เดี่ยว',
    'graduate.skill.multi': 'หลายแถว',
    'graduate.skill.mono': 'สีเดียว',
    'graduate.skill.combo': 'คอมโบ',
    'graduate.skill.perfect': 'สมบูรณ์แบบ',
    'graduate.reward.title': '🎁 ชุดมือใหม่',
    'graduate.reward.hint': 'คำใบ้ ×2',
    'graduate.reward.undo': 'เลิกทำ ×1',
    'graduate.reward.coin': 'เหรียญ ×100',
    'graduate.cta': '🚀  เริ่มท้าทาย',
    'graduate.ctaHint': 'กฎเดียวกับเกมจริง · ทำลายสถิติของคุณ 🏆',
};

const id = {
    'ui.title': '🏕️ Desa pemula',
    'ui.skip': 'Lewati tutorial',
    'ui.totalScore': 'Total {{n}}',
    'ui.ariaLabel': 'Tutorial desa pemula',
    'graduate.title': 'Lulus!',
    'graduate.subtitle': '— Pelatihan selesai —',
    'graduate.scoreLabel': 'Skor pelatihan',
    'graduate.skill.single': 'Tunggal',
    'graduate.skill.multi': 'Multi',
    'graduate.skill.mono': 'Warna',
    'graduate.skill.combo': 'Kombo',
    'graduate.skill.perfect': 'Sempurna',
    'graduate.reward.title': '🎁 Paket pemula',
    'graduate.reward.hint': 'Petunjuk ×2',
    'graduate.reward.undo': 'Urungkan ×1',
    'graduate.reward.coin': 'Koin ×100',
    'graduate.cta': '🚀  Mulai tantangan',
    'graduate.ctaHint': 'Aturan sama dengan game · Pecahkan rekormu 🏆',
};

const ar = {
    'ui.title': '🏕️ قرية المبتدئين',
    'ui.skip': 'تخطي البرنامج التعليمي',
    'ui.totalScore': 'المجموع {{n}}',
    'ui.ariaLabel': 'البرنامج التعليمي لقرية المبتدئين',
    'graduate.title': 'تخرجت!',
    'graduate.subtitle': '— اكتمل التدريب —',
    'graduate.scoreLabel': 'نقاط التدريب',
    'graduate.skill.single': 'فردي',
    'graduate.skill.multi': 'متعدد',
    'graduate.skill.mono': 'لون',
    'graduate.skill.combo': 'كومبو',
    'graduate.skill.perfect': 'مثالي',
    'graduate.reward.title': '🎁 حزمة المبتدئين',
    'graduate.reward.hint': 'تلميح ×2',
    'graduate.reward.undo': 'تراجع ×1',
    'graduate.reward.coin': 'عملة ×100',
    'graduate.cta': '🚀  ابدأ التحدي',
    'graduate.ctaHint': 'نفس قواعد اللعبة · حطم رقمك القياسي 🏆',
};

const el = {
    'ui.title': '🏕️ Χωριό αρχαρίων',
    'ui.skip': 'Παράκαμψη οδηγού',
    'ui.totalScore': 'Σύνολο {{n}}',
    'ui.ariaLabel': 'Οδηγός χωριού αρχαρίων',
    'graduate.title': 'Αποφοίτησες!',
    'graduate.subtitle': '— Η εκπαίδευση ολοκληρώθηκε —',
    'graduate.scoreLabel': 'Βαθμοί εκπαίδευσης',
    'graduate.skill.single': 'Μονός',
    'graduate.skill.multi': 'Πολλαπλός',
    'graduate.skill.mono': 'Χρώμα',
    'graduate.skill.combo': 'Combo',
    'graduate.skill.perfect': 'Τέλειο',
    'graduate.reward.title': '🎁 Πακέτο αρχαρίου',
    'graduate.reward.hint': 'Υπόδειξη ×2',
    'graduate.reward.undo': 'Αναίρεση ×1',
    'graduate.reward.coin': 'Νόμισμα ×100',
    'graduate.cta': '🚀  Έναρξη πρόκλησης',
    'graduate.ctaHint': 'Ίδιοι κανόνες με το παιχνίδι · Σπάσε το PB σου 🏆',
};

const PACKS = {
    'zh-CN': zhCN,
    en,
    ja,
    ko,
    fr,
    de,
    es,
    it,
    'pt-BR': ptBR,
    nl,
    ru,
    uk,
    pl,
    tr,
    vi,
    th,
    id,
    ar,
    el,
};

/**
 * 翻译指定 key —— 三级回退：当前 locale → en → zh-CN → fallback → key 字符串。
 * 支持 {{name}} 占位符替换。
 *
 * @param {string} locale  当前语言代码（如 'zh-CN' / 'en' / 'ja'）
 * @param {string} key     文案键
 * @param {Record<string, string | number>} [vars]
 * @param {string} [fallback] 字典都未命中时回退的兜底字符串（如 SCENARIO 内嵌中文原文）
 * @returns {string}
 */
export function nvT(locale, key, vars, fallback) {
    const pack = PACKS[locale] || PACKS.en;
    let str = pack[key];
    if (str === undefined) str = PACKS.en[key];
    if (str === undefined) str = PACKS['zh-CN'][key];
    if (str === undefined) str = fallback;
    if (str === undefined) return String(key);
    if (vars && typeof str === 'string') {
        str = str.replace(/\{\{(\w+)\}\}/g, (_, k) => {
            const v = vars[k];
            return v !== undefined && v !== null ? String(v) : '';
        });
    }
    return str;
}

/** 列出所有已支持的语言代码 */
export function nvAvailableLocales() {
    return Object.keys(PACKS);
}

/** 暴露字典本体（仅供测试 / 调试 / 离线翻译工具读取，不要在运行时直接改） */
export const NV_LOCALE_PACKS = PACKS;
