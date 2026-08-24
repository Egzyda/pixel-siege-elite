// ============================================================
// game-data.js — ユニット / ウェーブ / ボス / ショップ商品の定義
// ============================================================

// 攻撃タイプの表示名（ショップカードのバッジで使用）
const TYPE_LABELS = {
    melee:  '近接',
    ranged: '遠距離',
    aoe:    '範囲',
    healer: '回復',
    tank:   'タンク'
};

// ------------------------------------------------------------
// ステータス表示用のヘルパー
// 「近接／遠距離」と「範囲攻撃かどうか」は本来別の性質なので、
// type ひとつにまとめず個別に判定できるようにしている。
// （例: メイジは遠距離かつ範囲、オークは近接かつ範囲）
// ------------------------------------------------------------

// 近接か遠距離か
function reachLabel(def) {
    return (def.type === 'melee' || def.type === 'tank') ? '近接' : '遠距離';
}

// 範囲攻撃の半径（0 なら単体攻撃）
function splashRadius(def) {
    return def.splash || def.meleeSplash || 0;
}

// 役割バッジ（近接/遠距離とは別に持たせたい肩書き）
function roleLabel(def) {
    if(def.type === 'healer') return '回復';
    if(def.type === 'tank') return 'タンク';
    return null;
}

// スケルトンの矢を受けた相手を鈍足にする効果（打たれ弱く火力も低いぶん、
// 長射程を活かした足止め役としての個性を持たせる）
const SKELETON_SLOW_MULT = 0.5;      // 移動速度を半分にする
const SKELETON_SLOW_DURATION = 180;  // 効果時間（フレーム。3秒）

// ============================================================
// ユニット定義
//   cost   … 購入に必要なゴールド
//   hp     … 体力
//   dmg    … 攻撃力（マイナスは回復量）
//   range  … 攻撃射程(px)
//   speed  … 移動速度
//   rate   … 攻撃間隔（フレーム / 小さいほど速い）
//   mass   … 質量（ノックバックの受けにくさ）
//   kb     … ノックバック力
// ============================================================
const UNIT_DEFS = {
    // --- プレイヤーが購入できるユニット ---
    knight: {
        name:'ナイト', cost:20, hp:240, dmg:24, range:26, speed:0.80, rate:45,
        type:'melee', mass:1.4, kb:0, sprite:SPRITES.knight, pal:PALETTES.knight,
        comment:'安価で並べられる基本歩兵。押し返さずその場で受け止める壁役'
    },
    archer: {
        name:'アーチャー', cost:30, hp:100, dmg:16, range:150, speed:0.50, rate:50,
        type:'ranged', mass:0.8, kb:0, sprite:SPRITES.archer, pal:PALETTES.archer,
        comment:'安全な距離から弓で攻撃する'
    },
    wizard: {
        name:'メイジ', cost:55, hp:95, dmg:38, range:135, speed:0.42, rate:80,
        type:'aoe', mass:0.7, kb:8, splash:46, sprite:SPRITES.wizard, pal:PALETTES.wizard,
        comment:'広範囲の魔法攻撃。群れに有効'
    },
    healer: {
        name:'クレリック', cost:45, hp:140, dmg:-22, range:115, speed:0.50, rate:55,
        type:'healer', mass:0.8, kb:0, sprite:SPRITES.cleric, pal:PALETTES.healer,
        comment:'味方ユニットのHPを回復する'
    },
    giant: {
        name:'ゴーレム', cost:90, hp:1200, dmg:58, range:36, speed:0.34, rate:115,
        type:'tank', mass:5.0, kb:30, sprite:SPRITES.giant, pal:PALETTES.giant,
        comment:'圧倒的な耐久と引き換えに火力は控えめな純粋な盾役'
    },

    // --- 敵ユニット（AI 対戦モードでは AI も購入する） ---
    goblin: {
        name:'ゴブリン', cost:10, hp:45, dmg:11, range:20, speed:0.95, rate:32,
        type:'melee', mass:0.5, kb:0, sprite:SPRITES.goblin, pal:PALETTES.goblin,
        comment:'最安・最速の物量ユニット。数を並べた時の総火力はナイトを上回るが打たれ弱く、範囲攻撃に弱い'
    },
    orc: {
        name:'オーク', cost:36, hp:300, dmg:14, range:28, speed:0.48, rate:72,
        type:'melee', mass:2.0, kb:2, sprite:SPRITES.orc, pal:PALETTES.orc,
        meleeSplash:36, meleeSplashRate:0.55,
        comment:'薙ぎ払いで周囲も巻き込む近接アタッカー。ゴーレムより打たれ弱い'
    },
    skeleton: {
        name:'スケルトン', cost:22, hp:36, dmg:9, range:185, speed:0.34, rate:80,
        type:'ranged', mass:0.4, kb:0, sprite:SPRITES.skeleton, pal:PALETTES.skeleton,
        slowDuration: SKELETON_SLOW_DURATION,
        comment:'アーチャーを凌ぐ超長射程の狙撃役。命中した相手を鈍足にする呪いの矢を放つ。打たれ弱く動きも遅い'
    },

    // --- 戦術で召喚される特殊ユニット（ショップには並ばない） ---
    angel: {
        name:'エンジェル', cost:0, hp:900, dmg:70, range:130, speed:0.64, rate:40,
        type:'ranged', mass:2.0, kb:5, sprite:SPRITES.angel, pal:PALETTES.angel,
        comment:'戦術で召喚される守護天使'
    },

    // --- エリートユニット（SURVIVAL / VERSUS 限定で購入可能） ---
    // ストーリーのボスと同じスプライトを縮小して流用するが、能力は通常ユニットと
    // 同水準に収め、1体だけ個性の際立つ特徴を持たせている。
    warlord: {
        name:'ウォーロード', cost:70, hp:600, dmg:45, range:30, speed:0.42, rate:70,
        type:'melee', mass:3.0, kb:14, scale:2.4, sprite:SPRITES.boss_orc.idle, pal:PALETTES.boss_goblin,
        comment:'重量級の指揮官。一撃は重く、敵を大きく突き飛ばす'
    },
    lich: {
        name:'リッチ', cost:65, hp:180, dmg:26, range:160, speed:0.36, rate:60,
        type:'ranged', mass:0.9, kb:0, lifesteal:0.35, scale:2.3, sprite:SPRITES.boss_skeleton.idle, pal:PALETTES.boss_assassin,
        comment:'ドレイン: 与えたダメージの35%を自分のHPに変換する死霊術師'
    },
    drake: {
        name:'ドレイク', cost:85, hp:340, dmg:30, range:120, speed:0.44, rate:75,
        type:'aoe', mass:1.5, kb:3, splash:52, scale:2.4, sprite:SPRITES.boss_dragon.idle, pal:PALETTES.boss_drake,
        comment:'上空から範囲攻撃を叩き込む小型の竜'
    },
    imp: {
        name:'インプ', cost:55, hp:130, dmg:34, range:24, speed:0.90, rate:40,
        type:'melee', mass:1.0, kb:8, scale:2.2, sprite:SPRITES.boss_demon.idle, pal:PALETTES.boss_titan,
        comment:'圧倒的な速さで急襲する俊敏な小悪魔。打たれ弱い'
    }
};

// ショップに並べるユニット（表示順）
// ボス以外はプレイヤー・AI ともに全種類を購入できる
const SHOP_UNITS = ['knight', 'archer', 'wizard', 'healer', 'giant', 'goblin', 'orc', 'skeleton'];

// SURVIVAL / VERSUS 限定で追加購入できるエリートユニット
// （ストーリーの世界観を保つため、ストーリーモードには出さない）
const ELITE_UNITS = ['warlord', 'lich', 'drake', 'imp'];

// 現在のモードで購入できるユニット一覧を返す
function shopUnitsFor(mode) {
    return (mode === 'story') ? SHOP_UNITS : SHOP_UNITS.concat(ELITE_UNITS);
}

// 同時に配置できるユニット数の上限（モード別）
// SURVIVAL は「無制限」だが、描画・処理が破綻しないよう安全上限だけ設けている
const MAX_UNITS = 15;
const MAX_UNITS_SURVIVAL = 60;

function maxUnitsFor(mode) {
    // VERSUS / SURVIVAL は物量ビルド（安いユニットで押す）が15体の枠で
    // 頭打ちになってしまわないよう、実質無制限（安全上限のみ）にする。
    // STORY は全7ステージの難易度を15体前提で調整済みのため据え置き。
    return mode === 'story' ? MAX_UNITS : MAX_UNITS_SURVIVAL;
}

// ============================================================
// 予算テーブル（ラウンド開始時に配布されるゴールド）
// 8 ラウンド目以降（AI 対戦モードの延長戦）は EXTRA_BUDGET_STEP ずつ増える
// ============================================================
const BUDGETS = [80, 110, 140, 180, 220, 270, 320];
const EXTRA_BUDGET_STEP = 60;

function budgetForRound(round) {
    if(round <= BUDGETS.length) return BUDGETS[round - 1];
    return BUDGETS[BUDGETS.length - 1] + (round - BUDGETS.length) * EXTRA_BUDGET_STEP;
}

// ============================================================
// ステージ（STORY）モードのウェーブ構成
// delay はひとつ前の集団が出現してからのフレーム数
// ============================================================
const WAVE_CONFIGS = {
    1: { enemyWaves: [
        { enemies: [{type:'goblin', count:2}], delay: 60 },
        { enemies: [{type:'goblin', count:2}], delay: 300 },
        { enemies: [{type:'goblin', count:3}], delay: 300 }
    ]},
    2: { enemyWaves: [
        { enemies: [{type:'goblin', count:3}], delay: 60 },
        { enemies: [{type:'goblin', count:2}, {type:'orc', count:1}], delay: 300 },
        { enemies: [{type:'orc', count:2}], delay: 300 }
    ]},
    3: { enemyWaves: [
        { enemies: [{type:'skeleton', count:2}, {type:'goblin', count:2}], delay: 60 },
        { enemies: [{type:'skeleton', count:2}, {type:'orc', count:1}], delay: 300 },
        { enemies: [{type:'skeleton', count:3}, {type:'orc', count:1}], delay: 300 }
    ]},
    4: { enemyWaves: [
        { enemies: [{type:'goblin', count:5}, {type:'skeleton', count:2}], delay: 60 },
        { enemies: [{type:'orc', count:1}, {type:'skeleton', count:2}], delay: 300 },
        { enemies: [{type:'orc', count:2}, {type:'skeleton', count:2}], delay: 300 }
    ]},
    5: { enemyWaves: [
        { enemies: [{type:'skeleton', count:4}, {type:'orc', count:2}], delay: 60 },
        { enemies: [{type:'skeleton', count:3}, {type:'orc', count:2}], delay: 280 },
        { enemies: [{type:'skeleton', count:4}, {type:'orc', count:2}, {type:'goblin', count:5}], delay: 280 }
    ]},
    6: { enemyWaves: [
        { enemies: [{type:'orc', count:1}, {type:'skeleton', count:2}], delay: 60 },
        { enemies: [{type:'orc', count:2}, {type:'skeleton', count:2}], delay: 280 },
        { enemies: [{type:'orc', count:2}, {type:'skeleton', count:2}, {type:'goblin', count:5}], delay: 280 }
    ]},
    7: { enemyWaves: [
        { enemies: [{type:'goblin', count:10}, {type:'orc', count:2}], delay: 60 },
        { enemies: [{type:'orc', count:3}, {type:'skeleton', count:5}], delay: 280 },
        { enemies: [{type:'orc', count:4}, {type:'skeleton', count:5}], delay: 280 }
    ]}
};

const STORY_LAST_WAVE = 7;

// ============================================================
// ボス定義（ステージごとに 1 体）
// ============================================================
const BOSS_DEFS = {
    1: {
        name:'ゴブリン大王', hp:500, dmg:22, speed:0.56, special:'summon',
        palette:PALETTES.boss_goblin, sprite:SPRITES.boss_orc,
        summonType:'goblin', summonCount:2, summonInterval:300
    },
    2: {
        name:'ストーンゴーレム', hp:850, dmg:34, speed:0.32, special:'armor',
        palette:PALETTES.boss_golem, sprite:SPRITES.giant,
        armorReduction:0.55 // 被ダメージを 55% に軽減
    },
    3: {
        name:'シャドウアサシン', hp:1150, dmg:42, speed:0.88, special:'teleport',
        palette:PALETTES.boss_assassin, sprite:SPRITES.boss_skeleton,
        teleportInterval:260
    },
    4: {
        name:'フレイムドレイク', hp:2200, dmg:48, speed:0.48, special:'fire',
        palette:PALETTES.boss_drake, sprite:SPRITES.boss_dragon,
        fireInterval:170, fireDamage:38, fireRadius:100
    },
    5: {
        name:'ネクロロード', hp:2900, dmg:52, speed:0.40, special:'revive',
        palette:PALETTES.boss_necro, sprite:SPRITES.boss_skeleton,
        reviveInterval:260, reviveCount:3
    },
    6: {
        name:'エンシェントコンストラクト', hp:3400, dmg:66, speed:0.24, special:'laser',
        palette:PALETTES.boss_construct, sprite:SPRITES.giant,
        laserInterval:280, laserDamage:95
    },
    7: {
        name:'カオスタイタン', hp:6200, dmg:95, speed:0.36, special:'phases',
        palette:PALETTES.boss_titan, sprite:SPRITES.boss_demon,
        phases: [
            { hpThreshold:1.0,  speedMult:1.0, damageMult:1.0 },
            { hpThreshold:0.66, speedMult:1.3, damageMult:1.2 },
            { hpThreshold:0.33, speedMult:1.6, damageMult:1.5 }
        ]
    }
};

// ============================================================
// 強化（ショップの「強化」タブ）
// 恒久効果。購入するたびに価格が上がり、効果は累積する。
// ============================================================
// 価格の伸び率は効果の伸び率（複利）とほぼ揃えてあるので、後から積んでも
// 「支払った額に対する効果」が急に悪くなることはない（＝いつ注ぎ込んでも損しない）
const UPGRADE_PRICE_SCALE = 1.12;

const UPGRADE_DEFS = {
    atk_boost:   { name:'攻撃強化', icon:'⚔️', cost:40, desc:'全ユニットの攻撃力 +15%' },
    hp_boost:    { name:'装甲強化', icon:'❤️', cost:40, desc:'全ユニットのHP +18%' },
    atk_speed:   { name:'速射訓練', icon:'⚡', cost:45, desc:'攻撃間隔 -10%（攻撃が速くなる）' },
    speed_boost: { name:'進軍訓練', icon:'💨', cost:35, desc:'全ユニットの移動速度 +16%' },
    range_ext:   { name:'射程延長', icon:'🎯', cost:40, desc:'遠距離・範囲ユニットの射程 +14%' },
    fortified:   { name:'城壁補強', icon:'🏰', cost:45, desc:'自拠点の最大HP +250' },
    regen:       { name:'自動修復', icon:'🔧', cost:40, desc:'自拠点のHPが毎秒5回復' },
    thorns:      { name:'反射装甲', icon:'🛡️', cost:40, desc:'味方が受けたダメージの20%を反射（上限75%）' },
    vampire:     { name:'吸血の紋章', icon:'🧛', cost:40, desc:'与えたダメージの10%を自己回復（上限50%）' }
};

// atk_boost 等は複利で伸びるため、thorns/vampire と同様に上限を設ける
// （fortified/regen は加算のみで際限なく伸びないため対象外）
const ATK_MULT_CAP  = 3.0;  // 攻撃力 最大 +200%
const HP_MULT_CAP   = 3.5;  // HP 最大 +250%
const RATE_MULT_MIN = 0.35; // 攻撃間隔は最短でも元の35%まで
const MOVE_MULT_CAP = 2.2;  // 移動速度 最大 +120%
const RANGE_MULT_CAP = 2.0; // 射程 最大 +100%

// ============================================================
// ユニット個別レベルアップ（ショップのユニットカードから購入）
// 特定のユニット種を強化すると、そのユニット全員（既に配置済み/今後購入分の
// 両方）が恩恵を受ける。
//
// 【注意】レベルアップは「そのユニット全員」に効くため、価格を購入価格
// 基準の定額にすると「1体だけ持っている状態で安く強化してから量産する」
// ことで安く大量の強化ユニットを作れてしまう（例: ナイト1体を20Gで強化
// して2倍にしてから増やすと、80Gの予算で2倍ナイトが3体作れてしまい、
// 素のナイト4体より遥かに強くなる）。これを防ぐため、価格は購入価格だけ
// でなく「そのユニットを何体持っているか(count)」にも比例させる。
// count 体持っている状態で2倍にするコストは、その count 体を通常仕様の
// まま同じ数だけ増やす（＝もう count 体買う）のとほぼ同額になるよう
// 設計してあるため、いつ・何体持った状態で注ぎ込んでも大きく得はしない。
// また、レベルアップ後の新規購入も unitBuyCost() 側で割高になる
// （game.js）ため、「安いうちに1体だけ強化してから量産する」という
// 抜け道も塞いである。
// ============================================================
const UNIT_LEVEL_STAT_GAIN   = 0.15; // レベルごとの HP・攻撃力 上昇率（複利）。5回で約2倍
const UNIT_LEVEL_COST_BASE   = 0.15; // 初回レベルアップ価格 = 購入価格 × 所持数 × これ
const UNIT_LEVEL_COST_GROWTH = 1.15; // レベルが上がるごとに価格 × これ（複利）
const UNIT_LEVEL_MULT_CAP    = 4;    // ステータス倍率の上限（約10回の強化で到達）

function unitLevelCost(key, level, count) {
    const n = Math.max(1, count || 0);
    return Math.max(2, Math.ceil(UNIT_DEFS[key].cost * n * UNIT_LEVEL_COST_BASE * Math.pow(UNIT_LEVEL_COST_GROWTH, level)));
}

// ============================================================
// 戦術（ショップの「戦術」タブ）
// バトルは完全自動のため、購入した戦術はクールダウンごとに自動発動する。
// cd は秒数。
// ============================================================
const TACTIC_DEFS = {
    meteor:   { name:'メテオストーム', icon:'☄️', cost:150, cd:20, desc:'敵全体に120ダメージ（自動発動）' },
    heal:     { name:'マスヒール',     icon:'💚', cost:120, cd:24, desc:'味方全体のHPを35%回復（自動発動）' },
    timewarp: { name:'タイムワープ',   icon:'⏰', cost:110, cd:22, desc:'敵の移動速度を6秒間半減（自動発動）' },
    angel:    { name:'守護天使',       icon:'👼', cost:180, cd:30, summons:true, desc:'守護天使を20秒間召喚（自動発動）' }
};

// ============================================================
// AI 対戦モードの難易度プリセット
//   budgetMult … AI に配られる予算の倍率
//   pool       … 購入候補と抽選ウェイト
// ============================================================
// budgetMult       … AI に配られる予算の倍率
// powerStep        … ラウンドごとに AI ユニットが強くなる割合（プレイヤーの「強化」に相当）
// counterStrength  … プレイヤー編成を見て対策する度合い（0 = 対策しない）
// levelInvestRatio … VERSUS限定。毎ラウンドの予算のうち、主力ユニットの
//                    個別レベルアップに回す割合（0 = レベルアップしない）
// pool             … 購入候補と抽選ウェイト
const AI_PRESETS = {
    easy: {
        label:'EASY', desc:'安くて数の多い編成',
        budgetMult:1.5, powerStep:0.02, counterStrength:0, levelInvestRatio:0,
        pool:[{key:'goblin', w:6}, {key:'orc', w:2}, {key:'skeleton', w:2}, {key:'imp', w:1}]
    },
    normal: {
        label:'NORMAL', desc:'バランス型。こちらの編成も見てくる',
        budgetMult:0.92, powerStep:0.02, counterStrength:0.3, levelInvestRatio:0.2,
        pool:[{key:'knight', w:3}, {key:'archer', w:3}, {key:'orc', w:2},
              {key:'skeleton', w:2}, {key:'goblin', w:2}, {key:'wizard', w:1},
              {key:'warlord', w:1}, {key:'lich', w:1}, {key:'imp', w:1}]
    },
    hard: {
        label:'HARD', desc:'高コスト特化。徹底的に対策してくる',
        budgetMult:1.05, powerStep:0.04, counterStrength:0.65, levelInvestRatio:0.35,
        pool:[{key:'wizard', w:3}, {key:'giant', w:2}, {key:'knight', w:2},
              {key:'archer', w:2}, {key:'healer', w:1}, {key:'orc', w:1},
              {key:'warlord', w:2}, {key:'lich', w:2}, {key:'drake', w:2}, {key:'imp', w:1}]
    }
};

// ============================================================
// AI の対策編成ルール（2 ラウンド目以降に適用）
// 直前のラウンド終了時点のプレイヤー編成を分析し、刺さるユニットの
// 抽選ウェイトを引き上げる。note は準備フェーズのヒント表示に使う。
// ============================================================
const AI_COUNTER_RULES = [
    {
        when: c => c.swarmRatio >= 0.5 && c.count >= 5,
        boost: { wizard: 2.4, orc: 1.4 },
        note: '物量編成には範囲攻撃で対抗してきた'
    },
    {
        when: c => c.tankRatio >= 0.22,
        boost: { knight: 1.9, goblin: 1.6 },
        note: '重装編成には手数で対抗してきた'
    },
    {
        when: c => c.rangedRatio >= 0.45,
        boost: { goblin: 2.1, knight: 1.7 },
        note: '遠距離編成には突撃役を増やしてきた'
    },
    {
        when: c => c.meleeRatio >= 0.55,
        boost: { archer: 2.0, skeleton: 1.8 },
        note: '近接編成には射撃で対抗してきた'
    },
    {
        when: c => c.hasHealer,
        boost: { wizard: 1.8, archer: 1.3 },
        note: '回復役を火力で押し切る編成にしてきた'
    }
];

// ============================================================
// AI の「好み」。VERSUS / SURVIVAL の対戦開始時にランダムで1つ選ばれ、
// 試合中は変わらない。対策編成（プレイヤー編成への反応）とは独立して
// 常時ウェイトに乗る、AI 自身の一貫したクセ。プレイヤーから見ても
// パターンとして学習・対策できるよう、開始時にヒント表示する。
// EASY は挙動をシンプルに保つため対象外。
// ============================================================
const AI_PERSONALITIES = [
    { name:'物量型',   note:'安いユニットを並べる物量型で挑んできた', bias:{ goblin:1.9, skeleton:1.5, imp:1.4 } },
    { name:'重装型',   note:'重量級中心の重装型で挑んできた',         bias:{ giant:1.9, orc:1.6, warlord:1.7 } },
    { name:'遠距離型', note:'遠距離火力に寄せた編成で挑んできた',     bias:{ archer:1.6, wizard:1.8, skeleton:1.5, lich:1.7, drake:1.6 } },
    { name:'バランス型', note:'偏りのないバランス編成で挑んできた',   bias:{} }
];

// 対策編成の“ブレ”設定（difficulty ごと）。
//   skipChance       … 対策条件を満たしても見送る確率（ワンパターン化防止）
//   varianceMin/Max  … 対策が発動した時の補正の強さのブレ幅
// HARD は skipChance を低く抑え、対策の信頼性（弱いプレイにしない）を優先する
const AI_COUNTER_VARIANCE = {
    easy:   { skipChance: 0,    varianceMin: 1,    varianceMax: 1 },
    normal: { skipChance: 0.25, varianceMin: 0.7,  varianceMax: 1.3 },
    hard:   { skipChance: 0.08, varianceMin: 0.85, varianceMax: 1.25 }
};

// AI が余らせた予算を編成強化に変換する設定
// 掛け算で積むと指数的に膨れ上がるため、加算 + 上限で頭打ちにする
const AI_POWER_UNIT = 60;     // このゴールドごとに
const AI_POWER_GAIN = 0.04;   // +4%（加算）
const AI_POWER_MAX = {        // モード別の上限倍率
    versus: 1.7,              // 対戦は互角に近い勝負にする
    survival: 99              // サバイバルは上限なし（いずれ必ず押し負ける）
};

// ============================================================
// VS 対戦モード（決着がつく対戦）
// 拠点 HP とは別に「プレイヤー体力」を持ち、ラウンドに負けた側が
// 勝った側の生き残りユニットのコスト合計に応じたダメージを受ける。
// ============================================================
const VERSUS_LIFE = 100;        // 初期体力
const VERSUS_DMG_COEF = 0.18;   // 生存ユニットのコスト合計に掛ける係数
const VERSUS_DMG_MIN = 8;       // 最低ダメージ
const VERSUS_DMG_MAX = 26;      // 最大ダメージ（連敗時に一気に詰みにくくする）

// ラウンドごとの制限時間（フレーム）
const BATTLE_TIME = {
    story: 180 * 60,
    survival: 120 * 60,
    versus: 120 * 60
};

// 拠点の基本ステータス
const BASE_HP = 1500;      // 拠点の最大HP
const BASE_RADIUS = 26;    // 拠点の当たり判定半径（この距離まで近づくと攻撃できる）

// ============================================================
// 敵側ユニット用の赤系パレットを自動生成する。
// プレイヤーも敵ユニット（goblin・エリートユニットなど）を購入できるため、
// 全ユニットぶんの敵カラーを用意して陣営を一目で見分けられるようにする。
// エリートユニットはボス用パレットを流用しているので、キー名ではなく
// UNIT_DEFS 側の実際のパレットを起点に赤系へ寄せる。
// ============================================================
const ENEMY_PALETTES = {};
Object.keys(UNIT_DEFS).forEach(k => {
    ENEMY_PALETTES[k] = tintPalette(UNIT_DEFS[k].pal, '#dc2626', 0.5);
});
