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
        // 初期予算(80G)で組める編成の幅が狭すぎるとの指摘を受け30→15に値下げ。
        // ステータスは据え置きのため単体火力のコスパはメイジを上回るが、メイジは
        // 範囲攻撃(splash)を持つため上位互換にはならない
        name:'アーチャー', cost:15, hp:100, dmg:16, range:150, speed:0.50, rate:50,
        type:'ranged', mass:0.8, kb:0, sprite:SPRITES.archer, pal:PALETTES.archer,
        comment:'安全な距離から弓で攻撃する'
    },
    wizard: {
        name:'メイジ', cost:55, hp:95, dmg:38, range:135, speed:0.42, rate:80,
        type:'aoe', mass:0.7, kb:0, splash:46, sprite:SPRITES.wizard, pal:PALETTES.wizard,
        comment:'広範囲の魔法攻撃。群れに有効'
    },
    healer: {
        name:'クレリック', cost:45, hp:140, dmg:-22, range:115, speed:0.50, rate:55,
        type:'healer', mass:0.8, kb:0, sprite:SPRITES.cleric, pal:PALETTES.healer,
        comment:'味方ユニットのHPを回復する'
    },
    giant: {
        name:'ゴーレム', cost:65, hp:1300, dmg:58, range:36, speed:0.34, rate:115,
        type:'tank', mass:5.0, kb:30, sprite:SPRITES.giant, pal:PALETTES.giant,
        comment:'圧倒的な耐久と引き換えに火力は控えめな純粋な盾役'
    },

    // --- 敵ユニット（AI 対戦モードでは AI も購入する） ---
    goblin: {
        name:'ゴブリン', cost:10, hp:45, dmg:11, range:20, speed:0.95, rate:32,
        type:'melee', mass:0.5, kb:0, sprite:SPRITES.goblin, pal:PALETTES.goblin,
        comment:'最安・最速の物量ユニット。数を並べて押し込む物量戦が持ち味だが打たれ弱く、範囲攻撃に弱い'
    },
    orc: {
        name:'オーク', cost:36, hp:300, dmg:14, range:28, speed:0.48, rate:72,
        type:'melee', mass:2.0, kb:2, sprite:SPRITES.orc, pal:PALETTES.orc,
        meleeSplash:46, meleeSplashRate:0.55,
        comment:'薙ぎ払いで周囲も巻き込む近接アタッカー。打たれ弱く長くは耐えられない'
    },
    skeleton: {
        // 元々コスパが最も悪いユニットだったため22→10に値下げ
        name:'スケルトン', cost:10, hp:36, dmg:9, range:185, speed:0.34, rate:80,
        type:'ranged', mass:0.4, kb:0, sprite:SPRITES.skeleton, pal:PALETTES.skeleton,
        slowDuration: SKELETON_SLOW_DURATION,
        comment:'超長射程の狙撃役。命中した相手を鈍足にする呪いの矢を放つ。打たれ弱く動きも遅い'
    },

    // --- 戦術で召喚される特殊ユニット（ショップには並ばない） ---
    angel: {
        name:'エンジェル', cost:0, hp:900, dmg:70, range:130, speed:0.64, rate:40,
        type:'ranged', mass:2.0, kb:0, sprite:SPRITES.angel, pal:PALETTES.angel,
        comment:'戦術で召喚される守護天使'
    },

    // --- エリートユニット（SURVIVAL / VERSUS 限定で購入可能） ---
    // ストーリーのボスと同じスプライトを縮小して流用するが、能力は通常ユニットと
    // 同水準に収め、1体だけ個性の際立つ特徴を持たせている。
    warlord: {
        // 攻撃間隔を大幅に伸ばす代わりに一撃を極端に重くした、溜め型の重量級。
        // knockbackCapで通常のKNOCKBACK_CAPより大きく吹き飛ばせるようにしてある
        name:'ウォーロード', cost:85, hp:600, dmg:260, range:30, speed:0.42, rate:180,
        type:'melee', mass:3.0, kb:28, knockbackCap:12, chargeAttack:true,
        scale:2.4, sprite:SPRITES.boss_orc.idle, pal:PALETTES.boss_goblin,
        comment:'長い溜めの代わりに一撃が非常に重く、同格の敵なら一撃で沈める重量級の指揮官。攻撃前に力を溜める予備動作があり、ノックバックも大きい'
    },
    lich: {
        // ドレイン(自己回復)を廃止し、周囲の味方の攻撃力を底上げする支援型に再設計。
        // 攻撃速度ではなく攻撃力を上げる方式にしたのは、範囲攻撃/薙ぎ払いを持つ
        // ユニットで攻撃速度バフを重ねると手数が増えた分だけ範囲ダメージも
        // 倍増して暴れやすいため（攻撃力バフなら単純な倍率で済み調整しやすい）。
        // auraRadius内では何体重なっても倍率は重複しない(Unit.update()参照)
        name:'リッチ', cost:75, hp:180, dmg:14, range:160, speed:0.36, rate:70,
        type:'ranged', mass:0.9, kb:0, auraRadius:110, auraBuff:1.25,
        scale:2.3, sprite:SPRITES.boss_skeleton.idle, pal:PALETTES.boss_assassin,
        comment:'周囲の味方の攻撃力を25%高める支援型の死霊術師(重複なし)。自身の遠距離攻撃は弱め'
    },
    drake: {
        name:'ドレイク', cost:85, hp:340, dmg:30, range:120, speed:0.44, rate:75,
        type:'aoe', mass:1.5, kb:0, splash:52, scale:2.4, sprite:SPRITES.boss_dragon.idle, pal:PALETTES.boss_drake,
        comment:'上空から範囲攻撃を叩き込む小型の竜'
    },
    imp: {
        name:'インプ', cost:55, hp:130, dmg:34, range:24, speed:0.90, rate:40,
        type:'melee', mass:1.0, kb:8, scale:2.2, sprite:SPRITES.boss_demon.idle, pal:PALETTES.boss_titan,
        stealthUntilEngage:true, // 接敵(射程内到達)するまで敵から狙われない透明化状態
        comment:'接敵するまで透明化しており、敵から狙われない。圧倒的な速さで急襲する俊敏な小悪魔。打たれ弱い'
    },
    stoneGuardian: {
        // ゴーレムとの役割被りを避けるため、単体性能は抑えて「数秒ごとにミニストーンを
        // 生み出す」召喚役に振り直した。前線に置きっぱなしで無限に増援を出し続けられると
        // 壊れてしまうため、本体はかなり脆くしてある（タンクではなく壊れやすい召喚拠点）
        name:'ストーン', cost:60, hp:90, dmg:10, range:30, speed:0.26, rate:110,
        type:'melee', mass:1.0, kb:0, scale:2.0, sprite:SPRITES.giant, pal:PALETTES.boss_golem,
        summonType:'miniStone', summonInterval:240, summonCount:1,
        comment:'4秒ごとに自分の周りにミニストーンを1体生み出す。本体はかなり脆く、前線に置くとすぐ倒れる。後方で守りながら運用したい'
    },
    miniStone: {
        // ストーンが生み出す増援。ショップには並ばず購入不可(cost:0)
        name:'ミニストーン', cost:0, hp:45, dmg:11, range:20, speed:0.70, rate:32,
        type:'melee', mass:0.6, kb:0, scale:1.1, sprite:SPRITES.giant, pal:PALETTES.boss_golem,
        comment:'ストーンが生み出す小さな増援'
    },
    graveLord: {
        // リッチ(boss_skeleton形状)と見分けづらかったため、杖を持つ形状(wizardの
        // スプライトを流用)に変更。移動せず短射程の弱い攻撃しかできない代わりに、
        // 倒れた味方を蘇生する後方支援役に再設計した
        name:'ロード', cost:70, hp:380, dmg:18, range:70, speed:0, rate:75,
        type:'ranged', mass:1.6, kb:0, scale:2.1, sprite:SPRITES.wizard, pal:PALETTES.boss_necro,
        reviveAlly:true, reviveInterval:600,
        comment:'その場から動かず短射程の弱い攻撃しかできない代わりに、倒れた味方がいれば蘇生する死霊術師。倒れた味方がいない間は何もしない。初回は即座に発動し、以降は10秒のクールタイムを置く'
    },
    sentry: {
        // 「値段が高いだけで雑魚も倒せない」との声を受けて強化。
        // 基礎火力・射程を底上げし、ランプ上限も撤廃(狙い続ける限り際限なく伸びる)。
        // ただしSTORYのボスのように移動が遅くロックが外れにくい相手に対しては、
        // 無制限ランプだと単体で瞬殺できてしまう(60秒ロックし続けるだけで
        // 数千〜万単位のダメージに達する)ため、ボス限定でbeamRampCapVsBossの
        // 有限上限を適用する(雑魚戦の無制限ランプはそのまま。Unit.update()参照)
        name:'セントリー', cost:90, hp:500, dmg:26, range:230, speed:0.26, rate:60,
        type:'beam', mass:2.0, kb:0, beamRampRate:0.015, beamRampCap:Infinity, beamRampCapVsBoss:5,
        scale:2.6, sprite:SPRITES.sentry, pal:PALETTES.boss_construct,
        comment:'狙いを外さず照射し続けるほどダメージが増す長射程ビーム。対象を切り替えると威力はリセットされる'
    }
};

// ショップに並べるユニット（表示順）
// ボス以外はプレイヤー・AI ともに全種類を購入できる
const SHOP_UNITS = ['knight', 'archer', 'wizard', 'healer', 'giant', 'goblin', 'orc', 'skeleton'];

// エリートユニット（元は SURVIVAL / VERSUS 限定だったが、STORY含む全モードで購入可能）
const ELITE_UNITS = ['warlord', 'lich', 'drake', 'imp', 'stoneGuardian', 'graveLord', 'sentry'];

// 現在のモードで購入できるユニット一覧を返す（全モード共通ラインナップ）
function shopUnitsFor(mode) {
    return SHOP_UNITS.concat(ELITE_UNITS);
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

// STORY EXTRAも予算はSTORY通常と共通（プレイヤーの自由度を削る形の難易度調整は
// しない方針。難易度は敵数・ボス性能の強化のみで担う）
function budgetForRound(round) {
    if(round <= BUDGETS.length) return BUDGETS[round - 1];
    return BUDGETS[BUDGETS.length - 1] + (round - BUDGETS.length) * EXTRA_BUDGET_STEP;
}

// ============================================================
// ステージ（STORY）モードのウェーブ構成
// delay はひとつ前の集団が出現してからのフレーム数
// ============================================================
// ============================================================
// STORYステージの敵構成。
// タイマー式ウェーブは廃止し、そのステージの敵を戦闘開始と同時に全員
// フィールドへ配置する（ボスも含め、最初から全部見えている）。
// depth は出現エリア内での奥行き位置（0=最奥・ボスに近い側、
// 1=最前列・プレイヤー拠点に近い側）。奥にいる敵ほど到達が遅れるため、
// タイマーを使わずに「手前から順に交戦が始まる」時間差が自然に生まれる。
// ============================================================
const STORY_STAGES = {
    // --- 1〜3: 準備期間。ゴブリンのみが相手で、数・強さは据え置き ---
    1: { enemies: [
        { type:'goblin', count:2, depth:0.85 },
        { type:'goblin', count:2, depth:0.50 },
        { type:'goblin', count:3, depth:0.15 }
    ]},
    2: { enemies: [
        { type:'goblin', count:3, depth:0.85 },
        { type:'goblin', count:3, depth:0.50 },
        { type:'goblin', count:4, depth:0.15 }
    ]},
    3: { enemies: [
        { type:'goblin', count:4, depth:0.85 },
        { type:'goblin', count:4, depth:0.50 },
        { type:'goblin', count:5, depth:0.15 }
    ]},

    // --- 4〜10: 本編。旧STORY(全7ステージ)相当の構成をそのまま踏襲しつつ、
    //     終盤は他ユニットも敵として登場させ幅を持たせる ---
    4: { enemies: [
        { type:'goblin', count:2, depth:0.85 },
        { type:'goblin', count:2, depth:0.50 },
        { type:'goblin', count:3, depth:0.15 }
    ]},
    5: { enemies: [
        { type:'goblin', count:3, depth:0.85 },
        { type:'goblin', count:2, depth:0.55 }, { type:'orc', count:1, depth:0.55 },
        { type:'orc', count:2, depth:0.15 }
    ]},
    6: { enemies: [
        { type:'skeleton', count:2, depth:0.85 }, { type:'goblin', count:2, depth:0.85 },
        { type:'skeleton', count:2, depth:0.50 }, { type:'orc', count:1, depth:0.50 },
        { type:'skeleton', count:3, depth:0.15 }, { type:'orc', count:1, depth:0.15 }
    ]},
    7: { enemies: [
        { type:'goblin', count:5, depth:0.85 }, { type:'skeleton', count:2, depth:0.85 },
        { type:'orc', count:1, depth:0.50 }, { type:'skeleton', count:2, depth:0.50 }, { type:'imp', count:1, depth:0.50 },
        { type:'orc', count:2, depth:0.15 }, { type:'skeleton', count:2, depth:0.15 }, { type:'archer', count:2, depth:0.10 }
    ]},
    8: { enemies: [
        { type:'skeleton', count:4, depth:0.85 }, { type:'orc', count:2, depth:0.85 },
        { type:'skeleton', count:3, depth:0.50 }, { type:'orc', count:2, depth:0.50 },
        { type:'skeleton', count:4, depth:0.15 }, { type:'orc', count:2, depth:0.15 }, { type:'goblin', count:5, depth:0.15 },
        { type:'wizard', count:1, depth:0.08 }, { type:'stoneGuardian', count:1, depth:0.08 }
    ]},
    9: { enemies: [
        { type:'orc', count:1, depth:0.85 }, { type:'skeleton', count:2, depth:0.85 },
        { type:'orc', count:2, depth:0.50 }, { type:'skeleton', count:2, depth:0.50 }, { type:'healer', count:1, depth:0.50 }, { type:'lich', count:1, depth:0.50 },
        { type:'orc', count:2, depth:0.15 }, { type:'skeleton', count:2, depth:0.15 }, { type:'goblin', count:5, depth:0.15 },
        { type:'giant', count:1, depth:0.08 }
    ]},
    10: { enemies: [
        { type:'goblin', count:10, depth:0.85 }, { type:'orc', count:2, depth:0.85 }, { type:'knight', count:2, depth:0.85 },
        { type:'orc', count:3, depth:0.50 }, { type:'skeleton', count:5, depth:0.50 }, { type:'warlord', count:1, depth:0.50 },
        { type:'orc', count:4, depth:0.15 }, { type:'skeleton', count:5, depth:0.15 },
        { type:'archer', count:2, depth:0.08 }, { type:'wizard', count:1, depth:0.08 }, { type:'sentry', count:1, depth:0.08 }
    ]}
};

const STORY_LAST_WAVE = 10;

// ============================================================
// STORY EXTRA（初回全クリア後に解禁されるNG+的な高難度周回）
// 適応難易度（プレイヤーの育成度を見て動的に敵を強くする仕組み）は過去に
// 撤回済みのため導入しない。あくまで固定ウェーブ側の敵数・ボス性能・予算を
// あらかじめ底上げした「もう1本の固定台本」として用意し、プレイヤーの
// 状態は一切参照しない（誰がプレイしても同じ内容になる）
// ============================================================
// 雑魚の数。STORY_STAGESの大半のグループは1〜3体と少人数のため、
// Math.round()だと端数が四捨五入で消えて増加0のグループが大半になり、
// 「通常と差が分からない」原因になっていた。Math.ceil()に変えることで
// count>=1のグループには必ず最低+1体が乗るようにしてある
// 「後半(6以降)はもっと強くていい、5ステージくらいまではいい」というユーザーの
// 要望を反映し、6ステージ以降はより高い倍率を適用する（終盤の締めとして強化）
const STORY_EXTRA_ENEMY_MULT = 1.2;
const STORY_EXTRA_ENEMY_MULT_LATE = 1.5;
const STORY_EXTRA_LATE_STAGE_FROM = 6;

const STORY_STAGES_EXTRA = {};
Object.keys(STORY_STAGES).forEach(k => {
    const mult = Number(k) >= STORY_EXTRA_LATE_STAGE_FROM ? STORY_EXTRA_ENEMY_MULT_LATE : STORY_EXTRA_ENEMY_MULT;
    STORY_STAGES_EXTRA[k] = {
        enemies: STORY_STAGES[k].enemies.map(e => ({
            ...e, count: Math.max(e.count, Math.ceil(e.count * mult))
        }))
    };
});
// BOSS_DEFS_EXTRA・テーブル解決ヘルパーはBOSS_DEFS定義後（このファイル末尾側）で追加する

// フィールドを縦横均一に拡大する（見た目は縮小表示になり、画面のスクロールは
// 発生しない）。準備フェーズとバトルでサイズが変わるとユニットの位置が
// ずれて見えるため、モード・シーンを問わず常にこの倍率を使う。
// 1.0 なら伸ばさない。詳細はresize()内のfieldScale()を参照
const FIELD_SCALE = 0.7;

// ============================================================
// ボス定義（ステージごとに1体。戦闘開始と同時に雑魚と並行して登場する）
// 移動速度は雑魚との戦いに時間を使えるよう大幅に低く設定してある
// ============================================================
const BOSS_DEFS = {
    // --- 1〜3: 準備期間のボス。ゴブリンの上位種という位置づけで、
    //     4のゴブリンキングにつながる小さな前振り ---
    1: {
        name:'ゴブリンの偵察隊長', hp:120, dmg:10, speed:0.20, special:null,
        palette:PALETTES.boss_goblin, sprite:SPRITES.goblin
    },
    2: {
        name:'ゴブリンの戦隊長', hp:200, dmg:14, speed:0.20, special:null,
        palette:PALETTES.boss_goblin, sprite:SPRITES.goblin
    },
    3: {
        name:'ゴブリンの将軍', hp:300, dmg:18, speed:0.20, special:'summon',
        palette:PALETTES.boss_goblin, sprite:SPRITES.goblin,
        summonType:'goblin', summonCount:1, summonInterval:400
    },

    // --- 4〜10: 本編のボス。旧STORY(全7ステージ)のボスをそのまま踏襲しつつ、
    //     移動速度を落とした分(ノロマ化)、雑魚を片付けた後も一方的に
    //     殴られるだけの的にならないよう、耐久・攻撃力を底上げしてある ---
    4: {
        name:'ゴブリンキング', hp:3500, dmg:100, speed:0.18, special:'summon',
        palette:PALETTES.boss_goblin, sprite:SPRITES.boss_orc,
        // 召喚間隔300→450(5秒→7.5秒)に緩和。ボス3(1体/6.67秒)より濃い召喚レート
        // だったため、「本編最初のボスが一番きつい」と感じる主因になっていた。
        // 本体のHP・攻撃力・薙ぎ払いは据え置き(弱体化しすぎないため)
        summonType:'goblin', summonCount:2, summonInterval:450,
        meleeSplash:110, meleeSplashRate:0.7 // 大振りの薙ぎ払い。密集した壁ユニットを咎める広範囲攻撃
    },
    5: {
        name:'ストーンゴーレム', hp:4800, dmg:140, speed:0.12, special:'armor',
        palette:PALETTES.boss_golem, sprite:SPRITES.giant,
        armorReduction:0.55, // 被ダメージを 55% に軽減
        knockback:4 // 重量級らしく殴った相手を弾き飛ばす
    },
    6: {
        name:'シャドウアサシン', hp:6200, dmg:175, speed:0.28, special:'teleport',
        palette:PALETTES.boss_assassin, sprite:SPRITES.boss_skeleton,
        teleportInterval:260,
        range:150 // 近接ではなく遠距離攻撃。ワープで裏をかいて撃ってくる
    },
    7: {
        name:'フレイムドレイク', hp:9200, dmg:180, speed:0.16, special:'fire',
        palette:PALETTES.boss_drake, sprite:SPRITES.boss_dragon,
        // 「影が薄い」との指摘を受け、攻撃範囲(fireRadius)を100→130に拡大
        fireInterval:170, fireDamage:100, fireRadius:130
    },
    8: {
        // 「影が薄い」との指摘を受け、蘇生(倒れた雑魚を呼び戻す。序盤は
        // 雑魚の死体が無く空振りしがちで存在感が薄かった)から、いつでも
        // 確実に脅威になる召喚(スケルトン5体)に変更
        name:'ネクロロード', hp:11500, dmg:190, speed:0.14, special:'summon',
        palette:PALETTES.boss_necro, sprite:SPRITES.boss_skeleton,
        summonType:'skeleton', summonCount:5, summonInterval:500,
        lifesteal:0.3 // 与えたダメージの30%を自己回復する死霊術師らしい個性
    },
    9: {
        // dmg は継続照射の基礎DPS(ランプ倍率1倍時、1本あたり)として扱う
        name:'エンシェントコンストラクト', hp:7700, dmg:70, speed:0.10, special:'beam',
        palette:PALETTES.boss_construct, sprite:SPRITES.giant,
        // 継続照射: 同じ相手(拠点含む)を狙い続けるほどダメージが増える。
        // 対象を切り替えられると威力はリセットされるため、粘着させないことが重要になる。
        // 弱いとの指摘を受け、同時に3体まで照射できるように強化し(beamTargetCount)、
        // 射程も200→240に伸ばした
        beam:true, range:240, beamTargetCount:3, beamRampRate:0.0056, beamRampCap:3
    },
    10: {
        name:'カオスタイタン', hp:14000, dmg:270, speed:0.13, special:'phases',
        palette:PALETTES.boss_titan, sprite:SPRITES.boss_demon,
        // 覚醒前(第1形態)は広範囲の薙ぎ払いを持つ近接タイプ。
        // dmgがゴブリンキング(100)よりずっと高い(270)ため、meleeSplashRateは
        // 低めにして「主目標は激痛・巻き添えは広く浅く」の塩梅に調整してある
        meleeSplash:150, meleeSplashRate:0.35,
        // HP66%以下(第2形態)に入ると、味方を壁際まで弾き飛ばしたうえで
        // 長射程の範囲攻撃タイプへ覚醒する(以降ずっと維持。Boss.update()参照)。
        // dmgMultで爆発1発ごとの威力を落とす(素のdmgをそのまま範囲全員に
        // 当てると、近接の薙ぎ払いよりむしろ火力が上がってしまうため)
        awaken: { range:200, splash:90, dmgMult:0.4 },
        phases: [
            { hpThreshold:1.0,  speedMult:1.0, damageMult:1.0 },
            { hpThreshold:0.66, speedMult:1.3, damageMult:1.2 },
            { hpThreshold:0.33, speedMult:1.6, damageMult:1.5 }
        ]
    }
};

// STORY EXTRA用にHP・攻撃力を底上げしたボス版（STORY_STAGES_EXTRAの解説を参照）
// こちらも雑魚数と同様、6以降のボスはより高い倍率を適用する
const STORY_EXTRA_BOSS_MULT = 1.25;
const STORY_EXTRA_BOSS_MULT_LATE = 1.6;
const BOSS_DEFS_EXTRA = {};
Object.keys(BOSS_DEFS).forEach(k => {
    const d = BOSS_DEFS[k];
    const mult = Number(k) >= STORY_EXTRA_LATE_STAGE_FROM ? STORY_EXTRA_BOSS_MULT_LATE : STORY_EXTRA_BOSS_MULT;
    BOSS_DEFS_EXTRA[k] = {
        ...d,
        hp: Math.round(d.hp * mult),
        dmg: Math.round(d.dmg * mult),
        fireDamage: d.fireDamage ? Math.round(d.fireDamage * mult) : d.fireDamage
    };
});
// カオスタイタン(ラスボス)はEXTRA限定でさらに個別調整する。ユーザーから
// 「ロードの蘇生でナイトの壁が保守され続け、カオスタイタンの処理が追いつかない」
// との指摘を受け、割合ダメージ的な特殊メカニクスの代案として提示された
// 「攻撃範囲と速度をもう少し広げる」を採用。覚醒後(第2形態以降)の範囲攻撃の
// 半径と射程を広げ、攻撃間隔も短くして、蘇生し続ける壁を捌ける火力に引き上げる。
// 通常STORYのラスボスは現状の調整のままとし、EXTRA側だけを強化する
BOSS_DEFS_EXTRA[10] = {
    ...BOSS_DEFS_EXTRA[10],
    awaken: {
        ...BOSS_DEFS_EXTRA[10].awaken,
        range: Math.round(BOSS_DEFS_EXTRA[10].awaken.range * 1.3), // 200→260
        splash: Math.round(BOSS_DEFS_EXTRA[10].awaken.splash * 1.3), // 90→117
        atkRate: 40 // 覚醒後は攻撃間隔60→40（約1.5倍速）
    }
};

// 現在のモード/state.storyExtraに応じて使うべきテーブルを返す
function currentStoryStages() {
    return (state.mode === 'story' && state.storyExtra) ? STORY_STAGES_EXTRA : STORY_STAGES;
}
function currentBossDefs() {
    return (state.mode === 'story' && state.storyExtra) ? BOSS_DEFS_EXTRA : BOSS_DEFS;
}

// ============================================================
// 強化（ショップの「強化」タブ）
// 恒久効果。購入するたびに価格が上がり、効果は累積する。
// ============================================================
// 価格の伸び率は効果の伸び率（複利）とほぼ揃えてあるので、後から積んでも
// 「支払った額に対する効果」が急に悪くなることはない（＝いつ注ぎ込んでも損しない）
const UPGRADE_PRICE_SCALE = 1.12;

// 攻撃力・HPの育成はユニット個別レベル（下記）に一本化してある。
// 「強化」タブは、個別レベルと重複しない項目（速度・射程・拠点系）のみを扱う
const UPGRADE_DEFS = {
    atk_speed:   { name:'速射訓練', icon:'⚡', cost:45, desc:'攻撃間隔 -10%（上限-50%。攻撃が速くなる）' },
    speed_boost: { name:'進軍訓練', icon:'💨', cost:35, desc:'全ユニットの移動速度 +10%（上限+60%）' },
    range_ext:   { name:'射程延長', icon:'🎯', cost:40, desc:'遠距離・範囲ユニットの射程 +10%（上限+50%）' },
    fortified:   { name:'城壁補強', icon:'🏰', cost:45, desc:'自拠点の最大HP +250' },
    regen:       { name:'自動修復', icon:'🔧', cost:40, desc:'自拠点のHPが毎秒5回復' },
    thorns:      { name:'反射装甲', icon:'🛡️', cost:40, desc:'味方が受けたダメージの15%を反射（上限75%）' },
    vampire:     { name:'吸血の紋章', icon:'🧛', cost:40, desc:'与えたダメージの10%を自己回復（上限50%）' }
};

// 複利で伸びる項目は thorns/vampire と同様に上限を設ける
// （fortified/regen は加算のみで際限なく伸びないため対象外）
const RATE_MULT_MIN = 0.5;  // 攻撃間隔は最短でも元の50%まで
const MOVE_MULT_CAP = 1.6;  // 移動速度 最大 +60%
const RANGE_MULT_CAP = 1.5; // 射程 最大 +50%

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
// SURVIVAL（クリア制・全10ステージ）
// メカベラム風に「毎回相手が盤面を組み直してくる」対戦形式。VERSUSと
// 同じ体力制を使い、ラウンドに負けても体力が残っていれば続行できるが、
// 最終(10)ステージだけは実際に勝たないとクリア扱いにならない。
// ============================================================
const SURVIVAL_STAGES = 10;
const SURVIVAL_LIFE = 100;
const SURVIVAL_START_GOLD = 300;
const SURVIVAL_BUDGET_STEP = 50;

function survivalBudgetForRound(round) {
    const r = Math.max(1, Math.min(SURVIVAL_STAGES, round));
    return SURVIVAL_START_GOLD + (r - 1) * SURVIVAL_BUDGET_STEP;
}

// 難易度ごとのAI資金倍率。VERSUS(プレイヤーと完全同条件)とは違い、
// SURVIVALは意図的に非対称にする: EASYはプレイヤーよりやや少なく、
// NORMALは互角、HARDはプレイヤーより格上の資金を持つ。「配置は全部ガチ」
// という要望のため、ラウンド経過での緩和は行わず初手からこの倍率で来る
const SURVIVAL_AI_BUDGET_MULT = { easy: 0.85, normal: 1.0, hard: 1.2 };

// SURVIVAL 5ステージ目以降にAIが購入できるようになる、敵専用の精鋭「雑魚」。
// ショップには並ばない(SHOP_UNITS/ELITE_UNITSのどちらにも含めない)。
// 「ナイトを大型化し、ステータス上限(UNIT_LEVEL_MULT_CAP)まで個別レベルを
// 注ぎ込みきったのと同等」の性能にし、価格は「プレイヤーが同じ倍率まで
// unitLevelCost()で課金した場合の実勢コスト」から逆算した
// (専用ユニットだからと経済を無視した強さにしないための調整)
const SURVIVAL_ELITE_UNLOCK_STAGE = 5;
const SURVIVAL_ELITE_WEIGHT = 2;
const SURVIVAL_ELITE_MOOK_CAP_LEVEL = Math.ceil(Math.log(UNIT_LEVEL_MULT_CAP) / Math.log(1 + UNIT_LEVEL_STAT_GAIN));

// 元になるユニットの性質(射程・範囲攻撃の有無など)はそのまま引き継ぎ、
// cost/hp/dmg/mass/scaleだけを差し替える。近接・遠距離・範囲攻撃と
// タイプの異なる精鋭を複数用意し、同じ顔ぶれで飽きさせないようにする
function makeSurvivalElite(baseKey, name, comment) {
    const base = UNIT_DEFS[baseKey];
    let cost = base.cost;
    for(let lv = 0; lv < SURVIVAL_ELITE_MOOK_CAP_LEVEL; lv++) cost += unitLevelCost(baseKey, lv, 1);
    return Object.assign({}, base, {
        name, comment,
        cost: Math.round(cost),
        hp: Math.round(base.hp * UNIT_LEVEL_MULT_CAP),
        dmg: Math.round(base.dmg * UNIT_LEVEL_MULT_CAP),
        mass: base.mass * 1.6,
        scale: (base.scale || 2) * 1.5
    });
}

UNIT_DEFS.eliteGuard = makeSurvivalElite('knight', '重装親衛兵',
    'SURVIVAL専用の精鋭。並のナイトを遥かに凌ぐ耐久と火力を持つ巨兵');
UNIT_DEFS.eliteArcher = makeSurvivalElite('archer', '精鋭狙撃兵',
    'SURVIVAL専用の精鋭。並のアーチャーを遥かに凌ぐ射程外からの火力を持つ狙撃手');
UNIT_DEFS.eliteMage = makeSurvivalElite('wizard', '大魔導士',
    'SURVIVAL専用の精鋭。並のメイジを遥かに凌ぐ広範囲魔法を放つ強力な魔導士');

const SURVIVAL_ELITE_MOOKS = ['eliteGuard', 'eliteArcher', 'eliteMage'];

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
        purchaseConcentration:1, upgradeInvestRatio:0,
        pool:[{key:'goblin', w:6}, {key:'orc', w:2}, {key:'skeleton', w:2}, {key:'imp', w:1}]
    },
    normal: {
        label:'NORMAL', desc:'バランス型。こちらの編成も見てくる',
        budgetMult:0.92, powerStep:0.02, counterStrength:0.3, levelInvestRatio:0.2,
        // 主力ユニット(レベル投資対象)の購入ウェイトを底上げする倍率。
        // 「レベルを上げた得意ユニットを追加購入せず新しい種類を出し続けて
        // 非効率」という指摘を受け、購入を主力へ寄せる(HARDより控えめ)
        purchaseConcentration:2.2,
        // 全体強化(強化タブ)への投資比率。NORMALにも一部反映。
        // VERSUSの収入(80〜320G+)基準では0.08だと最安の強化(35G)にすら
        // 何ラウンドも届かず実質使われなかったため0.15に引き上げた
        upgradeInvestRatio:0.15,
        pool:[{key:'knight', w:3}, {key:'archer', w:3}, {key:'orc', w:2},
              {key:'skeleton', w:2}, {key:'goblin', w:2}, {key:'wizard', w:1},
              {key:'warlord', w:1}, {key:'lich', w:1}, {key:'imp', w:1},
              {key:'stoneGuardian', w:1}, {key:'graveLord', w:1}, {key:'sentry', w:1}]
    },
    hard: {
        label:'HARD', desc:'理論上最強。主力ユニットに集中投資し、全体強化も使いこなす',
        budgetMult:1.3, powerStep:0.06,
        // 「対策しようとしすぎて非効率」との指摘を受け0.8→0.6に緩和。
        // 対策自体は残しつつ、purchaseConcentrationによる主力集中を上回って
        // 編成を薄めてしまわない程度に強さを落とした
        counterStrength:0.6, levelInvestRatio:0.45,
        purchaseConcentration:4,
        upgradeInvestRatio:0.18,
        pool:[{key:'wizard', w:3}, {key:'giant', w:2}, {key:'knight', w:2},
              {key:'archer', w:2}, {key:'healer', w:1}, {key:'orc', w:1},
              {key:'warlord', w:2}, {key:'lich', w:2}, {key:'drake', w:2}, {key:'imp', w:1},
              {key:'stoneGuardian', w:1}, {key:'graveLord', w:2}, {key:'sentry', w:2}]
    }
};

// AIが全体強化(強化タブ)を買う際の優先度。どの編成にも効く速射・射程を
// 優先し、状況依存の反射装甲・吸血は控えめにする(理論上の汎用性重視)
const AI_UPGRADE_PRIORITY = [
    { key:'atk_speed',   w:3 },
    { key:'range_ext',   w:2.5 },
    { key:'speed_boost', w:1.5 },
    { key:'fortified',   w:1 },
    { key:'regen',       w:1 },
    { key:'thorns',      w:0.8 },
    { key:'vampire',     w:0.8 }
];

// ============================================================
// VERSUSラウンド1限定の「開始パターン」
// まだ編成が無い状態でのランダム抽選+レベル投資の組み合わせは「編成が1体だけ」
// のような事故編成になることがあったため、NORMAL/HARDのラウンド1(収入は
// 常に80G固定)だけはこの固定パターンから1つ抽選してそのまま配置する
// (EASYはlevelInvestRatioが0でこの事故が起きないため対象外のまま)。
// levels は「購入直後にそのユニット種へ何回レベルアップを注ぎ込むか」
// ============================================================
const AI_OPENING_PATTERNS = [
    { units:[{key:'knight', count:3}], levels:{knight:2} },              // ナイト3+2強化 = 80G
    { units:[{key:'knight', count:2}, {key:'archer', count:2}] },        // ナイト+アーチャー = 70G
    { units:[{key:'giant', count:1}, {key:'archer', count:1}] },         // ゴーレム+アーチャー = 80G
    { units:[{key:'giant', count:1}, {key:'skeleton', count:1}] },       // ゴーレム+スケルトン = 75G
    { units:[{key:'archer', count:5}] }                                 // アーチャー物量 = 75G
];

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
    hard:   { skipChance: 0.02, varianceMin: 0.9,  varianceMax: 1.3  }
};

// AI が余らせた予算を編成強化に変換する設定
// 掛け算で積むと指数的に膨れ上がるため、加算 + 上限で頭打ちにする
const AI_POWER_UNIT = 60;     // このゴールドごとに
const AI_POWER_GAIN = 0.04;   // +4%（加算）
const AI_POWER_MAX = {        // モード別の上限倍率
    versus: 1.7,              // 対戦は互角に近い勝負にする
    survival: 1.8             // クリア制(全10ステージ)になったため、こちらも頭打ちを設ける
};

// ============================================================
// VS 対戦モード（決着がつく対戦）
// 拠点 HP とは別に「プレイヤー体力」を持ち、ラウンドに負けた側が
// 勝った側の生き残りユニットのコスト合計に応じたダメージを受ける。
// ============================================================
const VERSUS_LIFE = 100;        // 初期体力
const VERSUS_DMG_COEF = 0.18;   // 生存ユニットのコスト合計に掛ける係数
const VERSUS_DMG_MIN = 8;       // 最低ダメージ
// 最大ダメージ（連敗時に一気に詰みにくくする）。実測では編成が揃うラウンド2〜3
// 以降ほぼ毎回この上限に張り付き、体力100が26ダメージ×4回弱で溶けて「盛り上がった
// 直後に決着がつく」体感の主因になっていたため、26→20に引き下げて終盤を1〜2ラウンド延ばす
const VERSUS_DMG_MAX = 20;

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
