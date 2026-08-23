// ============================================================
// game-data.js — ユニット / ウェーブ / ボス / ショップ商品の定義
// ============================================================

// 攻撃タイプの表示名（ショップカードの TYPE 欄で使用）
const TYPE_LABELS = {
    melee:  '近接',
    ranged: '遠距離',
    aoe:    '範囲',
    healer: '回復',
    tank:   'タンク'
};

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
        name:'KNIGHT', cost:20, hp:240, dmg:24, range:26, speed:0.85, rate:45,
        type:'melee', mass:1.4, kb:3, sprite:SPRITES.knight, pal:PALETTES.knight,
        comment:'重装甲の前衛。敵を力強く押し返す'
    },
    archer: {
        name:'ARCHER', cost:30, hp:100, dmg:16, range:150, speed:0.75, rate:50,
        type:'ranged', mass:0.8, kb:1, sprite:SPRITES.archer, pal:PALETTES.archer,
        comment:'安全な距離から弓で攻撃する'
    },
    wizard: {
        name:'MAGE', cost:55, hp:95, dmg:38, range:135, speed:0.6, rate:80,
        type:'aoe', mass:0.7, kb:8, splash:46, sprite:SPRITES.wizard, pal:PALETTES.wizard,
        comment:'広範囲の魔法攻撃。群れに有効'
    },
    healer: {
        name:'CLERIC', cost:45, hp:140, dmg:-22, range:115, speed:0.7, rate:55,
        type:'healer', mass:0.8, kb:0.5, sprite:SPRITES.cleric, pal:PALETTES.healer,
        comment:'味方ユニットのHPを回復する'
    },
    giant: {
        name:'GOLEM', cost:90, hp:1200, dmg:75, range:36, speed:0.35, rate:115,
        type:'tank', mass:5.0, kb:30, sprite:SPRITES.giant, pal:PALETTES.giant,
        comment:'超高耐久の盾役。圧倒的な存在感'
    },

    // --- 敵ユニット（AI 対戦モードでは AI も購入する） ---
    goblin: {
        name:'GOBLIN', cost:12, hp:70, dmg:12, range:22, speed:0.75, rate:48,
        type:'melee', mass:0.6, kb:1, sprite:SPRITES.goblin, pal:PALETTES.goblin,
        comment:'数で押し寄せる小型の斥候'
    },
    orc: {
        name:'ORC', cost:26, hp:150, dmg:24, range:26, speed:0.5, rate:58,
        type:'melee', mass:1.6, kb:3, sprite:SPRITES.orc, pal:PALETTES.orc,
        comment:'鈍重だが打撃力の高い戦士'
    },
    skeleton: {
        name:'SKELETON', cost:18, hp:55, dmg:10, range:105, speed:0.6, rate:65,
        type:'ranged', mass:0.5, kb:1, sprite:SPRITES.skeleton, pal:PALETTES.skeleton,
        comment:'脆いが射程の長い不死の射手'
    },

    // --- 戦術で召喚される特殊ユニット（ショップには並ばない） ---
    angel: {
        name:'ANGEL', cost:0, hp:900, dmg:70, range:130, speed:0.8, rate:40,
        type:'ranged', mass:2.0, kb:5, sprite:SPRITES.angel, pal:PALETTES.angel,
        comment:'戦術で召喚される守護天使'
    }
};

// ショップに並べるユニット（表示順）
const SHOP_UNITS = ['knight', 'archer', 'wizard', 'healer', 'giant'];

// 同時に配置できるユニット数の上限（画面が埋まりすぎないための制限）
const MAX_UNITS = 15;

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
        { enemies: [{type:'goblin', count:4}, {type:'skeleton', count:2}], delay: 60 },
        { enemies: [{type:'orc', count:2}, {type:'skeleton', count:2}], delay: 300 },
        { enemies: [{type:'orc', count:3}, {type:'skeleton', count:2}], delay: 300 }
    ]},
    5: { enemyWaves: [
        { enemies: [{type:'skeleton', count:5}, {type:'orc', count:3}], delay: 60 },
        { enemies: [{type:'skeleton', count:4}, {type:'orc', count:4}], delay: 280 },
        { enemies: [{type:'skeleton', count:5}, {type:'orc', count:4}, {type:'goblin', count:4}], delay: 280 }
    ]},
    6: { enemyWaves: [
        { enemies: [{type:'orc', count:4}, {type:'skeleton', count:4}], delay: 60 },
        { enemies: [{type:'orc', count:5}, {type:'skeleton', count:4}], delay: 280 },
        { enemies: [{type:'orc', count:5}, {type:'skeleton', count:4}, {type:'goblin', count:5}], delay: 280 }
    ]},
    7: { enemyWaves: [
        { enemies: [{type:'goblin', count:8}, {type:'orc', count:5}], delay: 60 },
        { enemies: [{type:'orc', count:7}, {type:'skeleton', count:6}], delay: 280 },
        { enemies: [{type:'orc', count:8}, {type:'skeleton', count:8}], delay: 280 }
    ]}
};

const STORY_LAST_WAVE = 7;

// ============================================================
// ボス定義（ステージごとに 1 体）
// ============================================================
const BOSS_DEFS = {
    1: {
        name:'Goblin Warchief', hp:500, dmg:22, speed:0.7, special:'summon',
        palette:PALETTES.boss_goblin, sprite:SPRITES.boss_orc,
        summonType:'goblin', summonCount:2, summonInterval:300
    },
    2: {
        name:'Stone Golem', hp:850, dmg:34, speed:0.4, special:'armor',
        palette:PALETTES.boss_golem, sprite:SPRITES.giant,
        armorReduction:0.55 // 被ダメージを 55% に軽減
    },
    3: {
        name:'Shadow Assassin', hp:1150, dmg:42, speed:1.1, special:'teleport',
        palette:PALETTES.boss_assassin, sprite:SPRITES.boss_skeleton,
        teleportInterval:260
    },
    4: {
        name:'Flame Drake', hp:2200, dmg:48, speed:0.6, special:'fire',
        palette:PALETTES.boss_drake, sprite:SPRITES.boss_dragon,
        fireInterval:170, fireDamage:38, fireRadius:100
    },
    5: {
        name:'Necro Lord', hp:2900, dmg:52, speed:0.5, special:'revive',
        palette:PALETTES.boss_necro, sprite:SPRITES.boss_skeleton,
        reviveInterval:260, reviveCount:3
    },
    6: {
        name:'Ancient Construct', hp:3800, dmg:76, speed:0.3, special:'laser',
        palette:PALETTES.boss_construct, sprite:SPRITES.giant,
        laserInterval:250, laserDamage:120
    },
    7: {
        name:'Chaos Titan', hp:6200, dmg:95, speed:0.45, special:'phases',
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
const UPGRADE_PRICE_SCALE = 1.6;

const UPGRADE_DEFS = {
    atk_boost:   { name:'攻撃強化', icon:'⚔️', cost:70, desc:'全ユニットの攻撃力 +15%' },
    hp_boost:    { name:'装甲強化', icon:'❤️', cost:70, desc:'全ユニットのHP +20%' },
    atk_speed:   { name:'速射訓練', icon:'⚡', cost:80, desc:'攻撃間隔 -12%（攻撃が速くなる）' },
    speed_boost: { name:'進軍訓練', icon:'💨', cost:60, desc:'全ユニットの移動速度 +20%' },
    range_ext:   { name:'射程延長', icon:'🎯', cost:65, desc:'遠距離・範囲ユニットの射程 +15%' },
    fortified:   { name:'城壁補強', icon:'🏰', cost:80, desc:'自拠点の最大HP +400' },
    regen:       { name:'自動修復', icon:'🔧', cost:70, desc:'自拠点のHPが毎秒8回復' },
    thorns:      { name:'反射装甲', icon:'🛡️', cost:75, desc:'味方が受けたダメージの25%を反射' },
    vampire:     { name:'吸血の紋章', icon:'🧛', cost:75, desc:'与えたダメージの10%を自己回復' }
};

// ============================================================
// 戦術（ショップの「戦術」タブ）
// バトルは完全自動のため、購入した戦術はクールダウンごとに自動発動する。
// cd は秒数。
// ============================================================
const TACTIC_DEFS = {
    meteor:   { name:'メテオストーム', icon:'☄️', cost:150, cd:20, desc:'敵全体に120ダメージ（自動発動）' },
    heal:     { name:'マスヒール',     icon:'💚', cost:120, cd:24, desc:'味方全体のHPを35%回復（自動発動）' },
    timewarp: { name:'タイムワープ',   icon:'⏰', cost:110, cd:22, desc:'敵の移動速度を6秒間半減（自動発動）' },
    angel:    { name:'守護天使',       icon:'👼', cost:180, cd:30, desc:'守護天使を20秒間召喚（自動発動）' }
};

// ============================================================
// AI 対戦モードの難易度プリセット
//   budgetMult … AI に配られる予算の倍率
//   pool       … 購入候補と抽選ウェイト
// ============================================================
// budgetMult … AI に配られる予算の倍率
// powerStep  … ラウンドごとに AI ユニットが強くなる割合（プレイヤーの「強化」に相当）
const AI_PRESETS = {
    easy: {
        label:'EASY', desc:'安くて数の多い編成',
        budgetMult:1.5, powerStep:0.03,
        pool:[{key:'goblin', w:6}, {key:'orc', w:2}, {key:'skeleton', w:2}]
    },
    normal: {
        label:'NORMAL', desc:'バランス型の編成',
        budgetMult:1.15, powerStep:0.07,
        pool:[{key:'knight', w:3}, {key:'archer', w:3}, {key:'orc', w:2}, {key:'skeleton', w:2}]
    },
    hard: {
        label:'HARD', desc:'高コスト特化の編成',
        budgetMult:1.25, powerStep:0.09,
        pool:[{key:'wizard', w:3}, {key:'giant', w:2}, {key:'knight', w:2}, {key:'archer', w:2}]
    }
};

// AI が余らせた予算を編成強化に変換する単位（このゴールドごとに +6%）
const AI_POWER_UNIT = 60;
const AI_POWER_GAIN = 1.06;

// 拠点の基本ステータス
const BASE_HP = 1500;      // 拠点の最大HP
const BASE_RADIUS = 26;    // 拠点の当たり判定半径（この距離まで近づくと攻撃できる）
