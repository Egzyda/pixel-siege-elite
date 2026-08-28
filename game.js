// ============================================================
// game.js — ゲーム本体
//   準備フェーズ（購入・配置）→ バトルフェーズ（全自動）→ 結果 → ショップ
//   というサイクルで進行するカジュアルオートバトラー。
// ============================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const SAVE_KEY = 'pixelSiegeElite_v3';
const RECORDS_KEY = 'pixelSiegeElite_records_v1';

// ============================================================
// ゲーム状態
// ============================================================
const state = {
    w: 0, h: 0,               // フィールドの論理サイズ（CSS ピクセル）
    scene: 'title',           // title / mode / prep / battle / result
    mode: 'story',            // story（ステージ） / survival（クリア制・全10ステージ） / versus（体力制対戦）
    difficulty: 'normal',     // AI 対戦モードの難易度
    storyExtra: false,        // STORY EXTRA（初回全クリア後に解禁される高難度周回）中か
    round: 1,                 // ウェーブ番号 / ラウンド番号
    gold: 0,                  // 残予算

    roster: [],               // プレイヤー編成 [{id, key, x, y}]
    aiRoster: [],             // AI 編成 [{id, key, x, y}]
    storyEnemies: [],         // STORY: そのステージの雑魚の出現位置 [{key, x, y}]（準備フェーズから表示）
    aiGold: 0,                // AI の残予算（繰り越し用）
    aiPower: 1,               // AI が余剰予算で得た編成強化倍率
    aiPersonality: null,      // AI の「好み」（試合開始時に抽選、試合中は固定）
    aiUnitLevels: {},         // AI が投資したユニット個別レベル {key: レベル}（VERSUS限定）
    nextId: 1,

    units: [],                // バトル中のユニット実体
    projs: [], fx: [], popups: [],
    playerCorpses: [],        // 戦死した味方の種類キュー（ロードの蘇生用）
    enemyCorpses: [],         // 戦死した敵の種類キュー（敵ロードの蘇生用）
    boss: null,
    playerBase: null,
    enemyBase: null,

    upgrades: {},             // 購入済みの強化 {key: 個数}
    unitLevels: {},           // ユニット種別ごとのレベル {key: レベル}
    tactics: {},              // 購入済みの戦術 {key: true}
    tacticTimers: {},         // 戦術のクールダウン残り（フレーム）

    selectedMode: 'story',    // モード選択画面で選択中のモード（STARTボタンで決定）
    shopTab: 'units',         // ショップの表示タブ
    selected: null,           // 選択中のショップユニット
    drag: null,               // ドラッグ中の配置ユニット
    undoStack: [],            // このラウンドの購入/売却操作の履歴（ひとつ戻す用）

    bossCleared: false,

    battleTimer: 0,           // 残り時間（フレーム）
    speed: 1,                 // 観戦速度倍率
    paused: false,            // バトルの一時停止
    timeWarp: 0,              // タイムワープ残り（フレーム）
    shake: 0,
    hitstop: 0,               // 演出用の一時停止残り（フレーム。ボスのフェーズ移行など）
    bossClearDelay: 0,        // ボス撃破後、結果画面に切り替わるまでの余韻（フレーム）
    kills: 0,
    snapshot: null,           // ラウンド開始時の状態（やり直し用）
    result: null,             // 直前のバトル結果

    playerLife: 0,            // VERSUS モードのプレイヤー体力
    aiLife: 0,                // VERSUS モードの AI 体力
    enemySiege: false,        // 敵の防衛ユニットが全滅し、拠点が急速に崩壊中
    playerSiege: false,       // 自分の防衛ユニットが全滅し、拠点が急速に崩壊中
    aiNote: '',               // AI がどう対策してきたかのヒント文
    records: null             // プレイ記録（localStorage に永続化）
};

// AI と戦うモードかどうか（敵拠点と AI 編成が存在する）
const isVsMode = () => state.mode === 'survival' || state.mode === 'versus';

// ============================================================
// ユーティリティ
// ============================================================
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const randRange = (min, max) => min + Math.random() * (max - min);

// ユニットの描画スケール（UNIT_DEFS 側で個別指定がなければ既定値を使う）
const unitScale = key => UNIT_DEFS[key].scale || (key === 'giant' ? 3 : 2);

// ノックバックは「軽く後ずさる」程度に留める（壁役が吹き飛ばないように）
const KNOCKBACK_MULT = 0.3;
const KNOCKBACK_CAP = 4;

// 攻撃対象のロックオン距離。この範囲内に相手がいる限り、より近い別の敵が
// 現れても目移りせず狙い続ける（タンクやノックバックで足止めする意味を保つため）
const TARGET_LOCK_RANGE = 210;

// 溜め攻撃（ウォーロードなど）の予備動作演出。攻撃までの残りがこのフレーム数
// 以下になったら、力を溜めているのが見て分かるよう火花を発生させ始める
const CHARGE_TELL_FRAMES = 45;

// 継続照射(セントリーなど)のダメージ表示間隔（フレーム）。
// 毎フレーム細かくtakeDmgすると「0」ばかりのポップアップが大量に出て
// HPバーが見えなくなるため、この間隔でまとめて反映・表示する
const BEAM_TICK_INTERVAL = 15;

// ダメージ表示などのポップアップ
function spawnPop(x, y, text, color) {
    state.popups.push({ x, y, text, color, life: 1.0, rise: 0 });
}

// 画面シェイク（バイブレーションも併用）
function addShake(v) {
    state.shake = Math.max(state.shake, v);
    if(navigator.vibrate) navigator.vibrate(Math.min(40, v * 6));
}

// トースト表示（alert/confirm の代わり）
let toastTimer = null;
function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    // ボトムシートが開いているときは、シートに隠れない上部に表示する
    el.classList.toggle('high', !!document.querySelector('.sheet-backdrop.show'));
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

// ============================================================
// 強化（アップグレード）の効果計算
// ============================================================
const upCount     = k => state.upgrades[k] || 0;
const rateMult    = () => Math.max(RATE_MULT_MIN, 1 - 0.10 * upCount('atk_speed'));
const moveMult    = () => Math.min(MOVE_MULT_CAP, 1 + 0.10 * upCount('speed_boost'));
const rangeMult   = () => Math.min(RANGE_MULT_CAP, 1 + 0.10 * upCount('range_ext'));
const baseBonusHp = () => 250 * upCount('fortified');
const baseRegen   = () => 5 * upCount('regen');
const thornsRate  = () => Math.min(0.75, 0.15 * upCount('thorns'));
const vampireRate = () => Math.min(0.5, 0.10 * upCount('vampire'));

// 強化タブのうち上限がある5項目について、現在値・上限・到達済みかを
// まとめる（fortified/regenは加算のみで上限が無いためnullを返す）。
// ショップ表示と購入時の上限チェックの両方で同じ値を使う
function upgradeStatus(key) {
    switch(key) {
        case 'atk_speed':   return { pct: Math.round((1 - rateMult()) * 100), cap: Math.round((1 - RATE_MULT_MIN) * 100), maxed: rateMult() <= RATE_MULT_MIN + 1e-9 };
        case 'speed_boost': return { pct: Math.round((moveMult() - 1) * 100), cap: Math.round((MOVE_MULT_CAP - 1) * 100), maxed: moveMult() >= MOVE_MULT_CAP - 1e-9 };
        case 'range_ext':   return { pct: Math.round((rangeMult() - 1) * 100), cap: Math.round((RANGE_MULT_CAP - 1) * 100), maxed: rangeMult() >= RANGE_MULT_CAP - 1e-9 };
        case 'thorns':      return { pct: Math.round(thornsRate() * 100), cap: 75, maxed: thornsRate() >= 0.75 - 1e-9 };
        case 'vampire':     return { pct: Math.round(vampireRate() * 100), cap: 50, maxed: vampireRate() >= 0.5 - 1e-9 };
        default:            return null;
    }
}

// 召喚ユニットが購入元ユニットのレベルをそのまま引き継ぐためのエイリアス
// （ミニストーンはショップに並ばず個別レベルを持たないため、ストーンの
// レベルをそのまま参照する）
const SUMMON_LEVEL_ALIAS = { miniStone: 'stoneGuardian' };

// ユニット個別レベル（キーごとの購入回数）
// 複利のまま無制限だと1種に注ぎ込み続けた際に際限なく強くなるため上限を設ける
const unitLevel     = k => (state.unitLevels && state.unitLevels[SUMMON_LEVEL_ALIAS[k] || k]) || 0;
const unitLevelMult = k => Math.min(UNIT_LEVEL_MULT_CAP, Math.pow(1 + UNIT_LEVEL_STAT_GAIN, unitLevel(k)));

// このユニット種のレベルアップが意味を持つ上限。攻撃力・HPの育成は
// ユニット個別レベルのみが担うため、単独上限がそのまま実効上限になる
const effectiveUnitLevelCap = key => UNIT_LEVEL_MULT_CAP;

// AI（VERSUS限定）が投資したユニット個別レベル。計算式はプレイヤーと共通
const aiUnitLevel     = k => (state.aiUnitLevels && state.aiUnitLevels[SUMMON_LEVEL_ALIAS[k] || k]) || 0;
const aiUnitLevelMult = k => Math.min(UNIT_LEVEL_MULT_CAP, Math.pow(1 + UNIT_LEVEL_STAT_GAIN, aiUnitLevel(k)));
// AIの実際の購入価格。プレイヤー側のunitBuyCost()と同じ考え方で、
// レベルアップ済みの種類は新規購入も割高になる
const aiUnitBuyCost = key => Math.round(UNIT_DEFS[key].cost * aiUnitLevelMult(key));

// プレイヤーが現在編成に持っているそのユニット種の数
const unitOwnedCount = key => state.roster.filter(r => r.key === key).length;

// 実際の購入価格。ユニット個別レベルで強化済みなほど新規購入も割高になる
// （そうしないと「1体だけ安く強化してから量産する」ことで価格設計を
// 踏み倒せてしまうため。強化コストが所持数に比例するのと合わせて、
// 後から買い足しても損得が生じないようにしてある）
const unitBuyCost = key => Math.round(UNIT_DEFS[key].cost * unitLevelMult(key));

// AI 対戦モードで敵ユニットに掛かる強化倍率
// （ラウンド進行によるスケーリング + AI が余剰予算を注ぎ込んだ分）
// STORY は固定ウェーブを攻略する楽しさが核のため、プレイヤーの育成度に応じて
// 敵を動的スケーリングすることはしない（常に1倍。詳細はCLAUDE.md参照）
function enemyPowerMult() {
    if(!isVsMode()) return 1;
    const p = AI_PRESETS[state.difficulty];
    return (state.aiPower || 1) * (1 + p.powerStep * (state.round - 1));
}

// 強化・戦術の現在価格（強化は買うたびに高くなる）
function upgradePrice(key) {
    return Math.round(UPGRADE_DEFS[key].cost * Math.pow(UPGRADE_PRICE_SCALE, upCount(key)));
}

// ============================================================
// フィールドのレイアウト計算
// ============================================================
// SURVIVAL / VERSUS は画面上部に体力ゲージを表示するため、その高さぶん敵陣を下げる
function topInset() {
    return (state.mode === 'versus' || state.mode === 'survival') ? 34 : 0;
}

function layout() {
    const top = topInset();
    return {
        deployTop: state.h * 0.55,           // プレイヤーが配置できる上端
        deployBottom: state.h - 54,          // プレイヤーが配置できる下端（拠点の手前）
        enemyTop: 112 + top,                 // 敵の出現エリア上端
        enemyBottom: state.h * 0.34 + top    // 敵の出現エリア下端
    };
}

// ============================================================
// 拠点（城）
// x, y は「狙われる中心座標」。描画は y + 16 を足元として行う。
// ============================================================
class Base {
    constructor(isP) {
        this.isP = isP;
        this.maxHp = BASE_HP + (isP ? baseBonusHp() : 0);
        this.hp = this.maxHp;
        this.radius = BASE_RADIUS;
        this.def = { mass: 999 };
        this.isBase = true;
        this.flash = 0;
        this.shake = 0;
        this.scale = 3;

        // 拠点も射程内の敵ユニットに向けて弱いながら応戦する
        // （プレイヤー自身の火力源ではなく、丸腰に見えないための最低限の抑止力）
        this.dmg = 14;
        this.range = 95;
        this.rate = 55;
        this.cd = randRange(0, this.rate); // 初弾のタイミングをずらす

        this.reposition();
    }

    reposition() {
        this.x = state.w / 2;
        this.y = this.isP ? state.h - 22 : 72 + topInset();
    }

    takeDmg(v, attacker) {
        if(this.hp <= 0) return;
        this.hp = Math.max(0, this.hp - v);
        this.flash = 8;
        this.shake = 6;
        addShake(4);

        // 反射装甲（自拠点のみ）
        if(this.isP && attacker && thornsRate() > 0 && attacker.takeDmg) {
            attacker.takeDmg(v * thornsRate(), null);
        }
    }

    heal(v) {
        this.hp = Math.min(this.maxHp, this.hp + v);
    }

    update(dt) {
        dt = dt || 1;
        if(this.flash > 0) this.flash--;
        if(this.shake > 0) this.shake *= 0.86;
        if(this.hp <= 0) return;

        // 射程内の最も近い敵ユニットへ弱い援護射撃を行う
        if(this.cd > 0) { this.cd -= dt; return; }

        let target = null, bd = Infinity;
        for(const u of state.units) {
            if(u.isP === this.isP || u.hp <= 0 || u.invisible) continue;
            const d = dist(u, this);
            if(d < bd && d <= this.range) { bd = d; target = u; }
        }
        if(target) {
            this.cd = this.rate;
            state.projs.push({
                x: this.x, y: this.y - 20,
                target, dmg: this.dmg, def: { type: 'ranged' },
                isP: this.isP, owner: this, active: true
            });
        }
    }

    draw(ctx) {
        const pal = this.isP ? PALETTES.castle_player : PALETTES.castle_enemy;
        const sx = this.shake > 0.2 ? randRange(-this.shake, this.shake) : 0;
        const footY = this.y + 16;

        drawShadow(ctx, SPRITES.castle, this.x + sx, footY, this.scale, 0.4);
        drawSprite(ctx, SPRITES.castle, pal, this.x + sx, footY, this.scale, { flash: this.flash > 0 });

        // 拠点の HP バー（拠点オブジェクトの上に表示）
        const box = getSpriteBox(SPRITES.castle);
        const topY = footY - box.h * this.scale - 10;
        drawHpBar(ctx, this.x + sx, topY, 54, 6, this.hp / this.maxHp, this.isP ? '#10b981' : '#ef4444');
    }
}

// HP バー描画（中央揃え）
function drawHpBar(ctx, cx, y, w, h, ratio, color) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(cx - w / 2, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(cx - w / 2 + 1, y + 1, (w - 2) * clamp(ratio, 0, 1), h - 2);
}

// ============================================================
// ユニット
// ============================================================
class Unit {
    constructor(key, isP, x, y, opts) {
        const o = opts || {};
        this.key = key;
        this.def = UNIT_DEFS[key];
        this.isP = isP;
        this.x = x;
        this.y = y;
        this.rid = o.rid || 0;              // 編成データとの対応 ID

        // プレイヤー側はユニット個別レベルの効果を受ける。
        // 敵側はSTORYではプレイヤーの育成度に応じたenemyPowerMult()、
        // VERSUSではAIが投資したユニット個別レベルの効果を受ける
        // （SURVIVALではaiUnitLevelsが空のまま=常に等倍）
        const ep = isP ? 1 : enemyPowerMult();
        const lm = isP ? unitLevelMult(key) : aiUnitLevelMult(key);
        const mult = isP ? lm : ep * lm; // 攻撃力・HPともこの倍率で伸びる
        const rm = isP ? rateMult() : 1;
        const sm = isP ? moveMult() : 1;
        const gm = isP ? rangeMult() : 1;

        this.max = Math.round(this.def.hp * mult);
        this.hp = this.max;
        this.dmg = this.def.dmg * mult;
        this.rate = this.def.rate * rm;
        this.speed = this.def.speed * sm;
        this.range = this.def.range * (this.def.type === 'ranged' || this.def.type === 'aoe' || this.def.type === 'healer' || this.def.type === 'beam' ? gm : 1);
        this.scale = unitScale(key);

        this.cd = Math.random() * 10;
        this.vx = 0; this.vy = 0;
        this.anim = Math.random() * 10;
        this.flash = 0;
        this.lifetime = o.lifetime || 0;    // 0 なら寿命なし
        this.pal = isP ? this.def.pal : (ENEMY_PALETTES[key] || this.def.pal);
        this.radius = 7;
        this.target = null;                 // ロックオン中の攻撃対象
        this.slowTimer = 0;                 // スケルトンの鈍足効果の残りフレーム
        this.beamTime = 0;                  // 継続照射(セントリーなど)の連続照射時間
        this.beamDmgAccum = 0;              // 継続照射のダメージ表示をまとめるための積算
        this.beamTickTimer = 0;
        this.summonTimer = 0;               // 定期召喚(ストーンなど)の経過フレーム
        this.reviveCd = 0;                  // 蘇生(ロードなど)のクールタイム。0なら発動可能
        this.invisible = !!this.def.stealthUntilEngage; // 接敵するまで敵から狙われない透明化(インプなど)
        this.auraMult = 1;                  // 攻撃力オーラ(リッチなど)による倍率。毎フレームupdate()で再計算
    }

    // 攻撃対象を探す
    findTarget() {
        // 回復役は最も HP 割合の低い味方を狙う。
        // 負傷者がいない場合は最寄りの味方に追従するだけで、敵は狙わない。
        if(this.def.type === 'healer') {
            let best = null, worst = 1;
            for(const u of state.units) {
                if(u.isP !== this.isP || u === this) continue;
                const r = u.hp / u.max;
                if(r < worst && r < 0.999) { worst = r; best = u; }
            }
            if(best) return best;

            let ally = null, ad = Infinity;
            for(const u of state.units) {
                if(u.isP !== this.isP || u === this) continue;
                const d = dist(u, this);
                if(d < ad) { ad = d; ally = u; }
            }
            return ally;
        }

        let best = null, bd = Infinity;
        for(const u of state.units) {
            if(u.isP === this.isP || u.hp <= 0 || u.invisible) continue;
            const d = dist(u, this);
            if(d < bd) { bd = d; best = u; }
        }
        // ボスはプレイヤー側の攻撃対象
        if(this.isP && state.boss && state.boss.hp > 0) {
            const d = dist(state.boss, this);
            if(d < bd) { bd = d; best = state.boss; }
        }

        // 近くに敵がいなければ敵拠点を目標にする
        const foeBase = this.isP ? state.enemyBase : state.playerBase;
        if((!best || bd > TARGET_LOCK_RANGE) && foeBase && foeBase.hp > 0) return foeBase;
        return best;
    }

    update(dt) {
        if(this.flash > 0) this.flash--;
        if(this.cd > 0) this.cd -= dt;
        this.anim += dt * 0.15;

        // 定期召喚（ストーンなど）。戦闘状況によらず、生きている限り一定間隔で発動する
        if(this.def.summonType) {
            this.summonTimer += dt;
            if(this.summonTimer > this.def.summonInterval) {
                this.summonTimer = 0;
                const n = this.def.summonCount || 1;
                for(let i = 0; i < n; i++) {
                    const a = (Math.PI * 2 / n) * i;
                    state.units.push(new Unit(this.def.summonType, this.isP,
                        clamp(this.x + Math.cos(a) * 30, 20, state.w - 20),
                        clamp(this.y + Math.sin(a) * 30 + 16, 24, state.h - 14)));
                }
                spawnPop(this.x, this.y - 40, '+' + n, '#a3e635');
            }
        }

        // 蘇生（ロードなど）。倒れた味方がいなければ何もしない。
        // reviveCd は初期値0なので、味方が倒れた直後にクールタイム待ちでなければ
        // 即座に発動する。一度発動すると reviveInterval の間は再発動しない。
        // プレイヤー・敵どちらが購入しても同じように機能させるため、
        // 自陣営(this.isP)の死体プールを見る
        if(this.def.reviveAlly) {
            const corpses = this.isP ? state.playerCorpses : state.enemyCorpses;
            if(this.reviveCd > 0) this.reviveCd -= dt;
            if(this.reviveCd <= 0 && corpses.length > 0) {
                const key = corpses.shift();
                state.units.push(new Unit(key, this.isP,
                    clamp(this.x + randRange(-30, 30), 20, state.w - 20),
                    clamp(this.y - 20, 24, state.h - 14)));
                this.reviveCd = this.def.reviveInterval;
                spawnPop(this.x, this.y - 40, 'REVIVE!', '#a855f7');
            }
        }

        // 溜め演出（ウォーロードなど）。攻撃直前の一定フレームだけ、力を
        // 溜めているのが見た目で分かるように周囲へ火花を発生させる
        if(this.def.chargeAttack && this.cd > 0 && this.cd <= CHARGE_TELL_FRAMES) {
            const a = Math.random() * Math.PI * 2;
            const r = 10 + Math.random() * 8;
            state.fx.push({
                x: this.x + Math.cos(a) * r, y: this.y - 16 + Math.sin(a) * r * 0.6,
                vx: -Math.cos(a) * 1.2, vy: -Math.sin(a) * 1.2 - 0.3, life: 16,
                color: this.isP ? '#fbbf24' : '#f87171'
            });
        }

        // 攻撃力オーラ（リッチなど）。自陣営でdef.auraRadiusを持つユニットの
        // 範囲内に入っていればauraBuffの倍率を受ける。複数体の範囲に同時に
        // 入っても最大値を採用するだけで重複(掛け算)はしない
        this.auraMult = 1;
        for(const u of state.units) {
            if(u.isP !== this.isP || !u.def.auraRadius || u.hp <= 0) continue;
            if(dist(u, this) <= u.def.auraRadius) this.auraMult = Math.max(this.auraMult, u.def.auraBuff);
        }

        // ノックバックの慣性
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.vx *= 0.85;
        this.vy *= 0.85;

        // タイムワープ中は敵の移動速度が半減する
        let spd = this.speed;
        if(!this.isP && state.timeWarp > 0) spd *= 0.5;

        // スケルトンの矢を受けると一定時間、移動速度が鈍る
        if(this.slowTimer > 0) {
            this.slowTimer -= dt;
            spd *= SKELETON_SLOW_MULT;
        }

        // 攻撃対象の解決。回復役は毎フレーム最も負傷した味方を選び直すが、
        // それ以外は一度ロックした敵ユニット/ボスを、死ぬか大きく引き離される
        // (TARGET_LOCK_RANGE 超）まで狙い続ける。毎フレーム最寄り優先で選び
        // 直すと、狙っていたタンクより後から近くに現れた雑魚に目移りして
        // しまい、タンクやノックバックによる足止めが機能しなくなるため。
        // 拠点への攻め込み（敵不在時の暫定目標）は敵の出現に反応できるよう
        // ロック対象に含めない。
        const locked = this.target && this.target.hp > 0 && !this.target.isBase &&
                       dist(this.target, this) <= TARGET_LOCK_RANGE;
        if(this.def.type === 'healer' || !locked) {
            // ビーム系(セントリーなど)は、せっかく育てたランプをボスの召喚した
            // 雑魚に奪われないよう、射程内にボスがいれば雑魚より優先して狙う
            if(this.def.type === 'beam' && this.isP && state.boss && state.boss.hp > 0 &&
               dist(state.boss, this) <= this.range) {
                this.target = state.boss;
            } else {
                this.target = this.findTarget();
            }
        }
        const target = this.target;

        if(target) {
            const d = dist(target, this);
            const reach = this.range + (target.radius || 0);

            // 接敵(射程内到達)すると透明化が解ける(インプなど)
            if(this.invisible && d <= reach) this.invisible = false;

            if(d <= reach) {
                if(this.def.type === 'beam') {
                    // 継続照射（セントリーなど）: ロックオン中の相手を狙い続けるほど
                    // ダメージが増える。ロックが外れて対象が変わると威力はリセットされる
                    if(this.beamTarget !== target) {
                        // 対象切り替え時、まだ表示していない蓄積ダメージを反映してから切り替える
                        if(this.beamDmgAccum > 0 && this.beamTarget && this.beamTarget.hp > 0) {
                            this.beamTarget.takeDmg(this.beamDmgAccum, this);
                        }
                        this.beamTarget = target; this.beamTime = 0;
                        this.beamDmgAccum = 0; this.beamTickTimer = 0;
                    }
                    this.beamTime += dt;
                    const rampMult = Math.min(this.def.beamRampCap, 1 + this.def.beamRampRate * this.beamTime);
                    this.beamDmgAccum += this.dmg * rampMult * dt / 60;
                    this.beamTickTimer += dt;
                    if(this.beamTickTimer >= BEAM_TICK_INTERVAL) {
                        this.beamTickTimer = 0;
                        target.takeDmg(this.beamDmgAccum, this);
                        this.beamDmgAccum = 0;
                    }
                    state.fx.push({
                        type:'laser', x1:this.x, y1:this.y - 14, x2:target.x, y2:target.y - 8,
                        life:14, width:2.5, color: this.isP ? '#60a5fa' : '#f87171'
                    });
                } else if(this.cd <= 0) {
                    this.cd = this.rate;
                    this.attack(target);
                }
            } else {
                const a = Math.atan2(target.y - this.y, target.x - this.x);
                this.x += Math.cos(a) * spd * dt;
                this.y += Math.sin(a) * spd * dt;
            }
        } else {
            // 目標が無い場合（次のウェーブ待ちなど）は前進せずその場にとどまる。
            // 敵がいないのに奥へ進み続けると不自然に見えるため。
        }

        // ユニット同士の押し合い
        for(const u of state.units) {
            if(u === this) continue;
            const dx = this.x - u.x, dy = this.y - u.y;
            const d = Math.hypot(dx, dy);
            if(d < 14 && d > 0.001) {
                const f = (14 - d) * 0.08;
                this.x += (dx / d) * f;
                this.y += (dy / d) * f;
            }
        }

        // フィールドの左右は見えない壁として扱う。
        // 単純な固定マージンだとゴーレムなど大きいスプライトが壁からはみ出すため、
        // 実際のスプライト幅から必要な余白を計算し、壁に当たったら勢いを止める。
        const wallMargin = Math.ceil(getSpriteBox(this.def.sprite).w * this.scale / 2) + 2;
        if(this.x < wallMargin) { this.x = wallMargin; if(this.vx < 0) this.vx = 0; }
        if(this.x > state.w - wallMargin) { this.x = state.w - wallMargin; if(this.vx > 0) this.vx = 0; }
        this.y = clamp(this.y, 24, state.h - 14);
    }

    attack(t) {
        if(this.def.type === 'healer') {
            // 回復（対象は味方ユニットのみ。拠点や敵は対象外）
            if(!t || t.isBase || t.isP !== this.isP || t.hp >= t.max) return;
            const heal = Math.abs(this.dmg);
            t.hp = Math.min(t.max, t.hp + heal);
            spawnPop(t.x, t.y - 18, '+' + Math.floor(heal), '#34d399');
            state.fx.push({ type:'heal', x:t.x, y:t.y - 10, life:24, color:'#34d399' });
            return;
        }

        // 攻撃力オーラ（リッチなど）による倍率。回復は対象外のためここで適用する
        const dmg = this.dmg * (this.auraMult || 1);

        if(this.def.type === 'ranged' || this.def.type === 'aoe') {
            state.projs.push({
                x: this.x, y: this.y - 14,
                target: t, dmg: dmg, def: this.def,
                isP: this.isP, owner: this, active: true
            });
        } else {
            t.takeDmg(dmg, this);
            // ノックバック（「壁の外まで吹き飛ぶ」ことがないよう、
            // 一撃あたりの勢いに上限を設けて「軽く後ずさる」程度に抑える。
            // ウォーロードなどdef.knockbackCapを持つユニットは、この上限自体を
            // 通常より高くすることで「もっと吹き飛ばす」個性を表現する）
            if(t.vx !== undefined) {
                const a = Math.atan2(t.y - this.y, t.x - this.x);
                const cap = this.def.knockbackCap || KNOCKBACK_CAP;
                const k = Math.min(cap, (this.def.kb / (t.def && t.def.mass ? t.def.mass : 2)) * KNOCKBACK_MULT);
                t.vx += Math.cos(a) * k;
                t.vy += Math.sin(a) * k;
            }

            // 薙ぎ払い（オークなど）: 主目標の周囲にいる敵にも波及ダメージ
            if(this.def.meleeSplash) {
                const splashDmg = dmg * (this.def.meleeSplashRate || 0.6);
                state.units.forEach(u => {
                    if(u === t || u.isP === this.isP || u.hp <= 0) return;
                    if(dist(u, t) <= this.def.meleeSplash) u.takeDmg(splashDmg, this);
                });
                for(let i = 0; i < 6; i++) {
                    const a2 = (Math.PI * 2 / 6) * i;
                    state.fx.push({
                        x: t.x + Math.cos(a2) * 10, y: t.y + Math.sin(a2) * 10,
                        vx: Math.cos(a2) * 2, vy: Math.sin(a2) * 2, life: 14, color: '#a78bfa'
                    });
                }
            }
        }
    }

    takeDmg(v, attacker) {
        if(this.hp <= 0) return;
        // 装甲（ストーンガーディアンなど。被ダメージを一定割合軽減する）
        if(this.def.armor) v *= this.def.armor;
        this.hp -= v;
        this.flash = 6;

        // 吸血（プレイヤー側の攻撃のみ）
        if(attacker && attacker.isP && !attacker.isBase && vampireRate() > 0 && attacker.hp !== undefined) {
            attacker.hp = Math.min(attacker.max, attacker.hp + v * vampireRate());
        }
        // ユニット固有のドレイン（リッチなど。陣営を問わず発動する個性の一つ）
        applyLifesteal(attacker, v);
        // 反射装甲（プレイヤー側が受けたダメージのみ）
        if(attacker && this.isP && thornsRate() > 0 && attacker.takeDmg) {
            attacker.takeDmg(v * thornsRate(), null);
        }

        if(this.hp <= 0) {
            this.hp = 0;
            onUnitDeath(this);
        }
    }

    draw(ctx) {
        const bounce = Math.abs(Math.sin(this.anim)) * 2.5;

        // 攻撃力オーラ（リッチなど）の効果範囲を常時円で表示する（発動時だけでなく常時）
        if(this.def.auraRadius) {
            ctx.save();
            const auraColor = this.isP ? '52,211,153' : '248,113,113';
            ctx.fillStyle = `rgba(${auraColor},0.12)`;
            ctx.strokeStyle = `rgba(${auraColor},0.5)`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.def.auraRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }

        // 透明化中(インプなど)は半透明にして、観戦側からは狙われていない状態と分かるようにする
        if(this.invisible) ctx.globalAlpha = 0.4;

        drawShadow(ctx, this.def.sprite, this.x, this.y, this.scale, 0.35);

        // 陣営が一目で分かるように足元にリングを描く
        ctx.strokeStyle = this.isP ? 'rgba(16,185,129,0.75)' : 'rgba(239,68,68,0.75)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(this.x, this.y, this.scale * 5, this.scale * 2, 0, 0, Math.PI * 2);
        ctx.stroke();

        // 敵ユニットは左右反転して向かい合わせる（上下反転はしない）
        drawSprite(ctx, this.def.sprite, this.pal, this.x, this.y - bounce, this.scale, {
            flash: this.flash > 0,
            flipX: !this.isP
        });

        // HP バーはスプライトの実寸に合わせて上に配置する
        const box = getSpriteBox(this.def.sprite);
        const topY = this.y - bounce - box.h * this.scale - 6;
        drawHpBar(ctx, this.x, topY, 22, 4, this.hp / this.max, this.isP ? '#10b981' : '#ef4444');

        if(this.invisible) ctx.globalAlpha = 1;
    }
}

// ドレイン能力（lifesteal）の適用。
// 回復していることが画面上で分からないと能力を実感できないため、
// 実際に回復できた分だけ緑のポップアップとエフェクトを出す。
function applyLifesteal(attacker, dmg) {
    if(!attacker || !attacker.def || !attacker.def.lifesteal) return;
    if(attacker.hp === undefined || attacker.hp <= 0) return;

    const before = attacker.hp;
    attacker.hp = Math.min(attacker.max, attacker.hp + dmg * attacker.def.lifesteal);
    const healed = attacker.hp - before;
    if(healed >= 1) {
        spawnPop(attacker.x, attacker.y - 30, '+' + Math.floor(healed), '#34d399');
        state.fx.push({ type:'heal', x: attacker.x, y: attacker.y - 12, life: 18, color: '#34d399' });
    }
}

// ユニット撃破時の処理
function onUnitDeath(u) {
    if(!u.isP) {
        state.kills++;
        // ネクロマンサー用に死体を記録
        if(state.boss && state.boss.special === 'revive') {
            state.boss.corpses.push(u.key);
            if(state.boss.corpses.length > 12) state.boss.corpses.shift();
        }
        // 敵のロード用に死体を記録（蘇生に使う）
        state.enemyCorpses.push(u.key);
        if(state.enemyCorpses.length > 12) state.enemyCorpses.shift();
    } else {
        // 味方のロード用に死体を記録（蘇生に使う）
        state.playerCorpses.push(u.key);
        if(state.playerCorpses.length > 12) state.playerCorpses.shift();
    }
    for(let i = 0; i < 6; i++) {
        state.fx.push({
            x: u.x, y: u.y - 10,
            vx: randRange(-2, 2), vy: randRange(-2.5, 0.5),
            life: 22, color: u.isP ? '#34d399' : '#f87171'
        });
    }
}

// ============================================================
// ボス
// ============================================================
class Boss {
    constructor(waveNum) {
        this.data = currentBossDefs()[waveNum];
        this.hp = this.data.hp;
        this.maxHp = this.data.hp;
        this.dmg = this.data.dmg;
        this.speed = this.data.speed;
        this.special = this.data.special;
        this.x = state.w / 2;
        this.y = 130 + topInset();
        this.vx = 0; this.vy = 0;
        this.cd = 0;
        this.flash = 0;
        this.anim = 0;
        this.specialTimer = 0;
        this.phase = 0;
        this.beamTarget = null;
        this.beamTime = 0;
        this.beamDmgAccum = 0;
        this.beamTickTimer = 0;
        this.corpses = [];
        this.awakened = false; // 第2形態で遠距離範囲タイプへ覚醒したか(カオスタイタンなど)
        this.scale = 3.5;
        this.radius = 22;
        this.isP = false;
        this.def = { mass: 30 };
        this.sprite = this.data.sprite.idle || this.data.sprite;
        this.pal = this.data.palette;
    }

    update(dt) {
        if(this.flash > 0) this.flash--;
        if(this.cd > 0) this.cd -= dt;
        this.specialTimer += dt;
        this.anim += dt * 0.08;

        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.vx *= 0.85;
        this.vy *= 0.85;

        // フェーズ移行（カオスタイタン）
        if(this.special === 'phases' && this.data.phases) {
            // 現在のHP割合に対応するフェーズを先に特定してから、それが
            // 直前のフェーズと違う場合だけ演出を出す。
            // （以前は「しきい値を満たす && 現在のフェーズと違う」を同時に
            // 判定してbreakしていたため、フェーズ1以降ではphase0の条件
            // (ratio<=1.0は常に真)に毎フレーム再マッチしてフェーズが0に
            // 巻き戻り→また1へ…を無限に繰り返し、画面揺れが止まらなかった）
            const ratio = this.hp / this.maxHp;
            let targetPhase = 0;
            for(let i = this.data.phases.length - 1; i >= 0; i--) {
                if(ratio <= this.data.phases[i].hpThreshold) { targetPhase = i; break; }
            }
            if(targetPhase !== this.phase) {
                this.phase = targetPhase;
                this.speed = this.data.speed * this.data.phases[targetPhase].speedMult;
                this.dmg = this.data.dmg * this.data.phases[targetPhase].damageMult;

                // 第2形態(phase===1)への突入時、覚醒データを持つボスは
                // 遠距離範囲タイプへ変身する(以降ずっと維持)
                const awakening = targetPhase === 1 && this.data.awaken && !this.awakened;
                if(awakening) this.awakened = true;

                spawnPop(this.x, this.y - 60, awakening ? '覚醒!!' : `PHASE ${targetPhase + 1}!`, '#ef4444');
                addShake(16);

                // 一瞬時が止まったような間を置いてから、周囲の味方を全員吹き飛ばす
                // （フェーズ移行の节目を「見て分かる」演出にするための専用効果。
                // 通常のノックバック上限(KNOCKBACK_CAP)はここでは適用しない。
                // 覚醒時は「壁際まで弾き飛ばす」ための特別に大きな力を使う）
                state.hitstop = 18;
                state.units.forEach(u => {
                    if(!u.isP || u.vx === undefined) return;
                    const a = Math.atan2(u.y - this.y, u.x - this.x) || Math.random() * Math.PI * 2;
                    const k = awakening ? KNOCKBACK_CAP * 15 : KNOCKBACK_CAP * 3;
                    u.vx += Math.cos(a) * k;
                    u.vy += Math.sin(a) * k;
                });
                for(let i = 0; i < 24; i++) {
                    const a = (Math.PI * 2 / 24) * i;
                    state.fx.push({ x:this.x, y:this.y - 20, vx:Math.cos(a) * 4, vy:Math.sin(a) * 4, life:26, color:'#ef4444' });
                }
            }
        }

        // 最も近いプレイヤーユニットを狙い、いなければ拠点へ向かう
        let target = null, bd = Infinity;
        for(const u of state.units) {
            if(!u.isP || u.invisible) continue;
            const d = dist(u, this);
            if(d < bd) { bd = d; target = u; }
        }
        if(!target || bd > 260) target = state.playerBase;

        if(this.data.beam) {
            // 継続照射（エンシェントコンストラクトなど）: 同じ相手を狙い続けるほど
            // ダメージが増える。ロックオンはユニットの TARGET_LOCK_RANGE と同じ
            // 仕組みを流用し、対象を切り替えると威力はリセットされる
            const locked = this.beamTarget && this.beamTarget.hp > 0 &&
                           dist(this.beamTarget, this) <= TARGET_LOCK_RANGE;
            if(!locked) {
                if(this.beamDmgAccum > 0 && this.beamTarget && this.beamTarget.hp > 0) {
                    this.beamTarget.takeDmg(this.beamDmgAccum, this);
                }
                this.beamTarget = target; this.beamTime = 0;
                this.beamDmgAccum = 0; this.beamTickTimer = 0;
            }
            const bt = this.beamTarget;
            if(bt) {
                const bDist = dist(bt, this);
                const beamRange = this.data.range || 200;
                if(bDist <= beamRange) {
                    this.beamTime += dt;
                    const rampMult = Math.min(this.data.beamRampCap, 1 + this.data.beamRampRate * this.beamTime);
                    this.beamDmgAccum += this.dmg * rampMult * dt / 60;
                    this.beamTickTimer += dt;
                    if(this.beamTickTimer >= BEAM_TICK_INTERVAL) {
                        this.beamTickTimer = 0;
                        bt.takeDmg(this.beamDmgAccum, this);
                        this.beamDmgAccum = 0;
                    }
                    state.fx.push({ type:'laser', x1:this.x, y1:this.y - 18, x2:bt.x, y2:bt.y - 10, life:14, width:2.5, color:'#60a5fa' });
                    if(Math.floor(this.beamTime) % 60 === 0) addShake(2);
                } else {
                    const a = Math.atan2(bt.y - this.y, bt.x - this.x);
                    this.x += Math.cos(a) * this.speed * dt;
                    this.y += Math.sin(a) * this.speed * dt;
                }
            }
        } else if(target) {
            const d = dist(target, this);
            // 覚醒済み(カオスタイタンなど)は近接の薙ぎ払いをやめ、data.awakenの
            // 長射程・範囲攻撃タイプに切り替わる
            const awakenRange = this.awakened && this.data.awaken ? this.data.awaken.range : 0;
            // シャドウアサシンなど data.range を持つボスは近接ではなく遠距離攻撃
            // （せっかく敵陣にワープしても接触待ちで意味が薄れないように）
            const atkRange = awakenRange || this.data.range || (42 + (target.radius || 0));
            if(d <= atkRange) {
                if(this.cd <= 0) {
                    this.cd = 60;
                    if(awakenRange) {
                        // 範囲全員に素のdmgをそのまま当てると近接時より強くなって
                        // しまうため、dmgMultで1発ごとの威力を落とす
                        state.projs.push({
                            x: this.x, y: this.y - 20,
                            target, dmg: this.dmg * (this.data.awaken.dmgMult || 1),
                            def: { type:'aoe', splash: this.data.awaken.splash },
                            isP: false, owner: this, active: true
                        });
                    } else if(this.data.range) {
                        state.projs.push({
                            x: this.x, y: this.y - 20,
                            target, dmg: this.dmg, def: { type:'ranged' },
                            isP: false, owner: this, active: true
                        });
                    } else {
                        target.takeDmg(this.dmg, this);
                        addShake(5);
                        // ノックバック（重量級ボスの個性。ストーンゴーレムなど data.knockback を持つ場合のみ）
                        if(this.data.knockback && target.vx !== undefined) {
                            const a2 = Math.atan2(target.y - this.y, target.x - this.x);
                            const k = Math.min(KNOCKBACK_CAP, this.data.knockback);
                            target.vx += Math.cos(a2) * k;
                            target.vy += Math.sin(a2) * k;
                        }
                        // 与えたダメージの一部で自己回復（ネクロロードなど data.lifesteal を持つ場合のみ）
                        if(this.data.lifesteal) {
                            this.hp = Math.min(this.maxHp, this.hp + this.dmg * this.data.lifesteal);
                        }
                        // 薙ぎ払い（ゴブリンキングなど data.meleeSplash を持つ場合のみ。
                        // オークの近接範囲攻撃と同じ仕組みをボス用に大きな半径で流用）
                        if(this.data.meleeSplash) {
                            const splashDmg = this.dmg * (this.data.meleeSplashRate || 0.6);
                            state.units.forEach(u => {
                                if(u === target || !u.isP || u.hp <= 0) return;
                                if(dist(u, target) <= this.data.meleeSplash) u.takeDmg(splashDmg, this);
                            });
                            for(let i = 0; i < 10; i++) {
                                const a2 = (Math.PI * 2 / 10) * i;
                                state.fx.push({
                                    x: target.x + Math.cos(a2) * 14, y: target.y + Math.sin(a2) * 14,
                                    vx: Math.cos(a2) * 2.5, vy: Math.sin(a2) * 2.5, life: 18, color: '#f97316'
                                });
                            }
                        }
                    }
                }
            } else {
                const a = Math.atan2(target.y - this.y, target.x - this.x);
                this.x += Math.cos(a) * this.speed * dt;
                this.y += Math.sin(a) * this.speed * dt;
            }
        }

        this.useSpecial();

        const wallMargin = Math.ceil(getSpriteBox(this.sprite).w * this.scale / 2) + 4;
        if(this.x < wallMargin) { this.x = wallMargin; if(this.vx < 0) this.vx = 0; }
        if(this.x > state.w - wallMargin) { this.x = state.w - wallMargin; if(this.vx > 0) this.vx = 0; }
        this.y = clamp(this.y, 60, state.h - 70);
    }

    useSpecial() {
        const d = this.data;
        switch(this.special) {
            case 'summon':
                if(this.specialTimer > d.summonInterval) {
                    this.specialTimer = 0;
                    for(let i = 0; i < (d.summonCount || 2); i++) {
                        const a = (Math.PI * 2 / d.summonCount) * i;
                        state.units.push(new Unit(d.summonType, false,
                            clamp(this.x + Math.cos(a) * 46, 20, state.w - 20),
                            clamp(this.y + Math.sin(a) * 46, 60, state.h - 80)));
                    }
                    spawnPop(this.x, this.y - 60, 'SUMMON!', '#facc15');
                }
                break;

            case 'teleport':
                if(this.specialTimer > d.teleportInterval) {
                    this.specialTimer = 0;
                    for(let i = 0; i < 10; i++) {
                        state.fx.push({ x:this.x, y:this.y - 20, vx:randRange(-3,3), vy:randRange(-3,3), life:20, color:'#a78bfa' });
                    }
                    this.x = randRange(50, state.w - 50);
                    this.y = randRange(90, state.h * 0.6);
                    spawnPop(this.x, this.y - 60, 'WARP!', '#a78bfa');
                }
                break;

            case 'fire':
                if(this.specialTimer > d.fireInterval) {
                    this.specialTimer = 0;
                    state.units.filter(u => u.isP && dist(u, this) < d.fireRadius)
                        .forEach(u => u.takeDmg(d.fireDamage, this));
                    spawnPop(this.x, this.y - 60, 'FLAME!', '#f97316');
                    addShake(5);
                    for(let i = 0; i < 14; i++) {
                        const a = (Math.PI * 2 / 14) * i;
                        state.fx.push({ x:this.x + Math.cos(a)*30, y:this.y - 18 + Math.sin(a)*30, vx:Math.cos(a)*2.5, vy:Math.sin(a)*2.5, life:26, color:'#f97316' });
                    }
                }
                break;

            case 'revive':
                if(this.specialTimer > d.reviveInterval && this.corpses.length > 0) {
                    this.specialTimer = 0;
                    const n = Math.min(d.reviveCount || 2, this.corpses.length);
                    for(let i = 0; i < n; i++) {
                        const key = this.corpses.pop();
                        state.units.push(new Unit(key, false,
                            clamp(this.x + randRange(-40, 40), 20, state.w - 20),
                            clamp(this.y + 36, 60, state.h - 80)));
                    }
                    spawnPop(this.x, this.y - 60, 'REVIVE!', '#a855f7');
                }
                break;

        }
    }

    takeDmg(v, attacker) {
        if(this.hp <= 0) return;
        if(this.special === 'armor') {
            v *= this.data.armorReduction;
        }
        this.hp -= v;
        this.flash = 6;

        if(attacker && attacker.isP && !attacker.isBase && vampireRate() > 0 && attacker.hp !== undefined) {
            attacker.hp = Math.min(attacker.max, attacker.hp + v * vampireRate());
        }
        applyLifesteal(attacker, v);

        if(this.hp <= 0) {
            this.hp = 0;
            state.kills++;
            const colors = ['#fbbf24', '#f472b6', '#60a5fa', '#34d399'];
            for(let i = 0; i < 36; i++) {
                state.fx.push({ x:this.x, y:this.y - 24, vx:randRange(-5,5), vy:randRange(-6,1), life:50, color:colors[i % colors.length] });
            }
            addShake(14);
            spawnPop(this.x, this.y - 90, 'ボス撃破！', '#fbbf24');
            state.boss = null;
            state.bossCleared = true;
            // 結果画面へ切り替わる前に、撃破の余韻を少し見せる
            // （hitstopで一瞬止めてから、紙吹雪が舞う間だけ結果画面をディレイする）
            state.hitstop = 20;
            state.bossClearDelay = 70;
        }
    }

    draw(ctx) {
        const bounce = Math.abs(Math.sin(this.anim)) * 4;

        // 影は本体の足元（スプライト下端）に合わせる
        drawShadow(ctx, this.sprite, this.x, this.y, this.scale, 0.45);
        drawSprite(ctx, this.sprite, this.pal, this.x, this.y - bounce, this.scale, {
            flash: this.flash > 0,
            flipX: false
        });

        const box = getSpriteBox(this.sprite);
        const topY = this.y - bounce - box.h * this.scale - 10;
        drawHpBar(ctx, this.x, topY, 84, 7, this.hp / this.maxHp, '#f59e0b');
    }
}

// ============================================================
// 戦術（購入済みならバトル中に自動発動する）
// ============================================================
function resetTactics() {
    state.tacticTimers = {};
    Object.keys(state.tactics).forEach(k => {
        // 初回はクールダウンの半分で発動する
        state.tacticTimers[k] = TACTIC_DEFS[k].cd * 60 * 0.5;
    });
}

function updateTactics(dt) {
    Object.keys(state.tactics).forEach(k => {
        state.tacticTimers[k] -= dt;
        if(state.tacticTimers[k] <= 0) {
            state.tacticTimers[k] = TACTIC_DEFS[k].cd * 60;
            fireTactic(k);
        }
    });
}

function fireTactic(key) {
    const def = TACTIC_DEFS[key];
    spawnPop(state.w / 2, state.h * 0.42, def.name, '#fde68a');
    flashTacticChip(key);

    switch(key) {
        case 'meteor':
            state.units.filter(u => !u.isP).forEach(u => u.takeDmg(120, null));
            if(state.boss) state.boss.takeDmg(120, null);
            addShake(10);
            for(let i = 0; i < 22; i++) {
                state.fx.push({ x:randRange(0, state.w), y:randRange(0, state.h * 0.5), vx:0, vy:5, life:26, color:'#f59e0b' });
            }
            break;

        case 'heal':
            state.units.filter(u => u.isP).forEach(u => {
                const v = u.max * 0.35;
                u.hp = Math.min(u.max, u.hp + v);
                state.fx.push({ type:'heal', x:u.x, y:u.y - 10, life:26, color:'#34d399' });
            });
            state.playerBase.heal(state.playerBase.maxHp * 0.1);
            break;

        case 'timewarp':
            state.timeWarp = 6 * 60;
            break;

        case 'angel': {
            const lay = layout();
            state.units.push(new Unit('angel', true, state.w / 2, lay.deployBottom - 20, { lifetime: 20 * 60 }));
            break;
        }
    }
}

// ============================================================
// 編成（ロスター）まわり
// ============================================================
// 編成データからバトル用ユニットを生成する
function deployRoster() {
    state.units = [];
    state.playerCorpses = []; // ロードの蘇生用。バトル開始のたびに空にする
    state.enemyCorpses = [];  // 敵ロードの蘇生用。同上
    // 準備フェーズとバトルは常に同じfieldScaleのワールド座標を使うため、
    // 編成の座標(r.x, r.y)をそのまま使ってよい
    state.roster.forEach(r => {
        state.units.push(new Unit(r.key, true, r.x, r.y, { rid: r.id }));
    });
    state.aiRoster.forEach(r => {
        state.units.push(new Unit(r.key, false, r.x, r.y, { rid: r.id }));
    });
}

// 生き残ったユニットだけを編成に残す
// バトル結果の集計。
// ユニットは戦死しても編成からは失われず、次ラウンドは HP 全回復で再配置される
// （毎ラウンド同じ予算をもらう AI との資金差が開きすぎないようにするため）。
function collectBattleResult() {
    const alive = new Set(state.units.filter(u => u.hp > 0).map(u => u.rid));
    const valueOf = roster => roster.reduce(
        (sum, r) => alive.has(r.id) ? sum + UNIT_DEFS[r.key].cost : sum, 0);
    return {
        playerAlive: state.roster.filter(r => alive.has(r.id)).length,
        enemyAlive: state.aiRoster.filter(r => alive.has(r.id)).length,
        playerValue: valueOf(state.roster),
        enemyValue: valueOf(state.aiRoster),
        playerLost: state.roster.filter(r => !alive.has(r.id)).length
    };
}

// ------------------------------------------------------------
// プレイヤー編成の傾向を分析する（AI の対策編成に使う）
// ------------------------------------------------------------
function analyzeRoster(roster) {
    const c = {
        count: roster.length,
        meleeRatio: 0, rangedRatio: 0, tankRatio: 0, swarmRatio: 0,
        hasHealer: false, rangedX: null
    };
    if(roster.length === 0) return c;

    let melee = 0, ranged = 0, tank = 0, swarm = 0;
    let rxSum = 0, rxCount = 0;

    roster.forEach(r => {
        const def = UNIT_DEFS[r.key];
        if(def.type === 'melee') melee++;
        if(def.type === 'tank') tank++;
        if(def.type === 'ranged' || def.type === 'aoe') {
            ranged++;
            rxSum += r.x; rxCount++;
        }
        if(def.type === 'healer') c.hasHealer = true;
        if(def.hp <= 110) swarm++; // 低 HP の数押しユニット
    });

    c.meleeRatio = melee / roster.length;
    c.rangedRatio = ranged / roster.length;
    c.tankRatio = tank / roster.length;
    c.swarmRatio = swarm / roster.length;
    if(rxCount > 0) c.rangedX = rxSum / rxCount; // 遠距離ユニットの重心
    return c;
}

// プレイヤー編成に刺さるようウェイトを補正したプールを返す
function counteredPool(preset, roster) {
    const base = preset.pool.map(p => ({ key: p.key, w: p.w }));

    // AI 自身の「好み」を常時反映する（対策とは独立。EASY はシンプルに保つため対象外）
    if(state.difficulty !== 'easy' && state.aiPersonality) {
        const bias = state.aiPersonality.bias;
        Object.keys(bias).forEach(k => {
            if(!base.some(p => p.key === k)) base.push({ key: k, w: 0.6 });
        });
        base.forEach(p => { p.w *= (bias[p.key] || 1); });
    }

    const strength = preset.counterStrength || 0;

    // 1 ラウンド目や EASY は対策しない
    if(strength <= 0 || roster.length === 0) {
        state.aiNote = '';
        return base;
    }

    const comp = analyzeRoster(roster);
    const notes = [];
    const boosts = {};
    const variance = AI_COUNTER_VARIANCE[state.difficulty] || { skipChance: 0, varianceMin: 1, varianceMax: 1 };

    AI_COUNTER_RULES.forEach(rule => {
        if(!rule.when(comp)) return;
        // 条件を満たしても一定確率で見送り、ワンパターンな対策にならないようにする
        // （HARD は skipChance を低く抑えてあるため、対策の信頼性は落ちない）
        if(Math.random() < variance.skipChance) return;
        notes.push(rule.note);
        Object.keys(rule.boost).forEach(k => {
            // strength が小さいほど補正が穏やかになる。強さ自体にもブレを持たせる
            const v = randRange(variance.varianceMin, variance.varianceMax);
            const mult = 1 + (rule.boost[k] - 1) * strength * v;
            boosts[k] = (boosts[k] || 1) * mult;
        });
    });

    state.aiNote = notes.length ? notes[0] : '';

    // プールに無いユニットも、対策対象なら候補に加える
    Object.keys(boosts).forEach(k => {
        if(!base.some(p => p.key === k)) base.push({ key: k, w: 0.6 });
    });
    return base.map(p => ({ key: p.key, w: p.w * (boosts[p.key] || 1) }));
}

// AIがレベルアップ投資の対象にするユニット種を選ぶ。現在の編成の中で
// 最も数の多い種類を「主力」とみなす（同数なら「好み」のウェイトで優先）
function pickAiLevelTarget() {
    const counts = {};
    state.aiRoster.forEach(r => { counts[r.key] = (counts[r.key] || 0) + 1; });
    const keys = Object.keys(counts);
    if(keys.length === 0) return null;
    const bias = (state.aiPersonality && state.aiPersonality.bias) || {};
    keys.sort((a, b) => (counts[b] * (bias[b] || 1)) - (counts[a] * (bias[a] || 1)));
    return keys[0];
}

// AI の編成を組む（難易度プリセット + プレイヤー編成への対策）
function buildAiRoster() {
    // SURVIVAL は「メカベラム方式」: 前ラウンドの編成を引き継がず、その時点で
    // 持っているはずの資金全額で毎ラウンド編成を新しく組み直す。
    // （プレイヤーと全く同じ条件を保つ必要があるのは VERSUS だけなので、
    // 編成を引き継ぐ現行方式は VERSUS のみ残す）
    if(state.mode === 'survival') {
        state.aiRoster.forEach(r => { state.aiGold += UNIT_DEFS[r.key].cost; });
        state.aiRoster = [];
    }

    const preset = AI_PRESETS[state.difficulty];
    let roundIncome;
    if(state.mode === 'survival') {
        // SURVIVAL専用の予算テーブル。VERSUSと違い意図的に非対称にしてあり
        // (EASY<プレイヤー、NORMAL=同額、HARD>プレイヤー)、「配置は全部ガチ」
        // という要望のため、ラウンド経過での緩和はせず初手からこの倍率で来る
        const mult = SURVIVAL_AI_BUDGET_MULT[state.difficulty];
        roundIncome = Math.round(survivalBudgetForRound(state.round) * mult);
    } else {
        // VERSUSはプレイヤーと全く同じ条件を保つ必要があるため、
        // 資金の水増し/カットは一切行わず、収入は常にbudgetForRound()そのまま
        // (=プレイヤーと同額)にする
        roundIncome = budgetForRound(state.round);
    }
    state.aiGold += roundIncome;

    // VERSUS限定: プレイヤーと同じユニット個別レベルアップの仕組みをAIにも
    // 使わせる。対象は現在の編成で最も多い（＝主力の）種類とし、毎ラウンドの
    // 収入の一部を注ぎ込む。1ラウンド目はまだ編成が無いため対象なし
    if(state.mode === 'versus' && preset.levelInvestRatio > 0) {
        let levelBudget = Math.round(roundIncome * preset.levelInvestRatio);
        const target = pickAiLevelTarget();
        if(target) {
            while(levelBudget > 0 && state.aiGold > 0 && aiUnitLevelMult(target) < UNIT_LEVEL_MULT_CAP) {
                const n = state.aiRoster.filter(r => r.key === target).length;
                const cost = unitLevelCost(target, aiUnitLevel(target), n);
                if(cost > levelBudget || cost > state.aiGold) break;
                state.aiGold -= cost;
                levelBudget -= cost;
                state.aiUnitLevels[target] = aiUnitLevel(target) + 1;
            }
        }
    }

    // 2 ラウンド目以降は直前のプレイヤー編成を見て刺さるユニットを選ぶ
    let pool = counteredPool(preset, state.round > 1 ? state.roster : []);
    // SURVIVAL: 5ステージ目以降、敵専用の精鋭ユニットが抽選候補に混じるようになる
    if(state.mode === 'survival' && state.round >= SURVIVAL_ELITE_UNLOCK_STAGE) {
        pool = pool.concat(SURVIVAL_ELITE_MOOKS.map(key => ({ key, w: SURVIVAL_ELITE_WEIGHT })));
    }
    const comp = analyzeRoster(state.roster);

    const cap = maxUnitsFor(state.mode);

    // まず購入だけを行う（配置は全種類が出揃ってから決める）
    const purchased = [];
    let guard = 400;
    while(guard-- > 0 && purchased.length < cap) {
        const affordable = pool.filter(p => aiUnitBuyCost(p.key) <= state.aiGold);
        if(affordable.length === 0) break;

        // ウェイト付き抽選
        const total = affordable.reduce((sum, p) => sum + p.w, 0);
        let r = Math.random() * total;
        let pick = affordable[affordable.length - 1];
        for(const p of affordable) { r -= p.w; if(r <= 0) { pick = p; break; } }

        state.aiGold -= aiUnitBuyCost(pick.key);
        purchased.push(pick.key);
    }

    placeAiRoster(purchased, comp);

    // 配置上限に達して予算が余った場合は編成強化に回す（プレイヤーの「強化」に相当）
    const powerMax = AI_POWER_MAX[state.mode] || 2.0;
    while(state.aiGold >= AI_POWER_UNIT && state.aiPower < powerMax) {
        state.aiGold -= AI_POWER_UNIT;
        state.aiPower = Math.min(powerMax, state.aiPower + AI_POWER_GAIN);
    }
}

// AI編成の配置を決める。近接・タンクは前列、遠距離・回復は後列、という
// だけでは前衛と後衛のX座標が無関係になり、「タンクが右で回復役が左」の
// ような噛み合わない布陣になってしまう。前衛をいくつかの縦レーンに割り振り、
// 後衛は必ずそのレーンのどれかの真後ろにつけることで、前衛が受けている間に
// 後衛が安全に攻撃できる実戦的な布陣にする
function placeAiRoster(purchased, comp) {
    const lay = layout();
    const band = lay.enemyBottom - lay.enemyTop;
    const front = purchased.filter(k => { const t = UNIT_DEFS[k].type; return t === 'melee' || t === 'tank'; });
    const back = purchased.filter(k => { const t = UNIT_DEFS[k].type; return t !== 'melee' && t !== 'tank'; });

    // 前衛を配置するレーン(X座標)を用意する。プレイヤーの遠距離ユニットが
    // 固まっている側へ寄せることが多いが、たまに外して読まれにくくする
    const laneCount = Math.max(1, Math.min(front.length || 1, 5));
    const lanes = [];
    for(let i = 0; i < laneCount; i++) {
        const x = (comp.rangedX !== null && Math.random() < 0.7)
            ? clamp(comp.rangedX + randRange(-50, 50), 28, state.w - 28)
            : randRange(28, state.w - 28);
        lanes.push(x);
    }

    front.forEach((key, i) => {
        state.aiRoster.push({
            id: state.nextId++, key,
            x: clamp(lanes[i % lanes.length] + randRange(-18, 18), 28, state.w - 28),
            y: randRange(lay.enemyTop + band * 0.55, lay.enemyBottom)
        });
    });
    // 後衛は前衛と同じレーンの真後ろへ。前衛が1体もいない場合だけ
    // レーンに根拠が無いので範囲内でランダムにする
    back.forEach((key, i) => {
        const x = front.length > 0
            ? clamp(lanes[i % lanes.length] + randRange(-25, 25), 28, state.w - 28)
            : randRange(28, state.w - 28);
        state.aiRoster.push({
            id: state.nextId++, key, x,
            y: randRange(lay.enemyTop, lay.enemyTop + band * 0.45)
        });
    });
}

// AI 編成の配置を画面サイズに合わせて収める
function clampRosters() {
    const lay = layout();
    state.roster.forEach(r => {
        r.x = clamp(r.x, 16, state.w - 16);
        r.y = clamp(r.y, lay.deployTop, lay.deployBottom);
    });
    state.aiRoster.forEach(r => {
        r.x = clamp(r.x, 16, state.w - 16);
        r.y = clamp(r.y, lay.enemyTop, lay.enemyBottom);
    });
}

// ============================================================
// シーン制御
// ============================================================
// 下部バーの表示切り替え
function showPrepBar() {
    document.getElementById('prep-bar').style.display = 'flex';
    document.getElementById('battle-bar').style.display = 'none';
    document.getElementById('tactic-hud').classList.remove('show');
}

function showBattleBar() {
    document.getElementById('prep-bar').style.display = 'none';
    document.getElementById('battle-bar').style.display = 'flex';
}

function showScreen(id) {
    ['screen-title', 'screen-mode', 'screen-result'].forEach(s => {
        document.getElementById(s).classList.toggle('show', s === id);
    });
}
function hideScreens() { showScreen(''); }

// 準備フェーズへ
function enterPrep() {
    state.scene = 'prep';
    state.selected = null;
    state.drag = null;
    state.undoStack = [];
    state.boss = null;
    state.bossCleared = false;
    state.units = [];
    state.projs = [];
    state.fx = [];
    state.popups = [];
    state.timeWarp = 0;
    state.hitstop = 0;
    state.bossClearDelay = 0;
    state.kills = 0;
    state.speed = 1;

    // 拠点は毎ラウンド全回復した状態で始まる
    state.playerBase = new Base(true);
    state.enemyBase = isVsMode() ? new Base(false) : null;

    if(isVsMode()) buildAiRoster();
    if(state.mode === 'story') buildStoryEnemyPreview();
    clampRosters();

    // やり直し用のスナップショットを保存
    state.snapshot = JSON.stringify({
        round: state.round, gold: state.gold,
        roster: state.roster, aiRoster: state.aiRoster, aiGold: state.aiGold,
        aiPower: state.aiPower, aiUnitLevels: state.aiUnitLevels,
        playerLife: state.playerLife, aiLife: state.aiLife,
        upgrades: state.upgrades, unitLevels: state.unitLevels, tactics: state.tactics, nextId: state.nextId,
        storyEnemies: state.storyEnemies
    });

    hideScreens();
    closePauseModal();
    closeShop();
    hideUnitInfo();
    showPrepBar();
    resize();
    renderShop();
    updatePrepUI();
    updateHud();
    updateVersusHud();
    saveGame();

    // AI がこちらの編成に対策してきた場合はヒントを出す
    if(isVsMode() && state.round > 1 && state.aiNote) {
        setTimeout(() => toast('敵の動き: ' + state.aiNote), 350);
    }
}

// バトルフェーズへ
function startBattle() {
    if(state.roster.length === 0) {
        toast('ユニットを1体以上配置してください');
        return;
    }

    state.scene = 'battle';
    state.selected = null;
    state.drag = null;
    state.kills = 0;
    state.enemySiege = false;
    state.playerSiege = false;
    // シーンをbattleにしてからresizeすることで、STORYならここでワールドが
    // 拡大された状態になる（以降のdeployRoster/spawnStoryStageが正しい
    // ワールド座標を使えるようにするため、他の処理より先に行う）
    resize();
    deployRoster();
    resetTactics();

    if(state.mode === 'story') {
        spawnStoryStage(state.round);
    }
    state.battleTimer = BATTLE_TIME[state.mode] || 120 * 60;
    state.paused = false;

    hideUnitInfo();
    showBattleBar();
    setSpeed(1);
    updateHud();
}

// バトル終了 → 結果表示
// VERSUS モードは体力バーが減る演出を見せてから結果画面を出す
// （結果画面はフィールド全体を覆ってしまうため、先に演出を挟まないと
//   体力が一瞬で減った瞬間が見えないまま隠れてしまう）
function endBattle(win, reason) {
    if(state.scene !== 'battle') return;
    state.scene = 'result';
    state.paused = false;
    closePauseModal();

    const tally = collectBattleResult();
    const isDraw = (win === null);
    const isFinalStory = (state.mode === 'story' && win === true && state.round >= STORY_LAST_WAVE);
    // SURVIVAL / VERSUS は共通で「拠点とは別の体力」を持つ対戦形式
    const isLifeMode = (state.mode === 'versus' || state.mode === 'survival');
    const isFinalSurvivalStage = (state.mode === 'survival' && state.round >= SURVIVAL_STAGES);

    let lifeDmg = 0, matchOver = false, matchWin = false, survivalEndReason = null;

    if(isLifeMode && !isDraw) {
        // 負けた側が「勝った側の生き残りユニットのコスト合計」に応じたダメージを受ける
        const winnerValue = win ? tally.playerValue : tally.enemyValue;
        lifeDmg = clamp(Math.round(winnerValue * VERSUS_DMG_COEF), VERSUS_DMG_MIN, VERSUS_DMG_MAX);
        const nextPlayerLife = win ? state.playerLife : Math.max(0, state.playerLife - lifeDmg);
        const nextAiLife = win ? Math.max(0, state.aiLife - lifeDmg) : state.aiLife;

        if(state.mode === 'versus') {
            matchOver = (nextPlayerLife <= 0 || nextAiLife <= 0);
            matchWin = (nextAiLife <= 0 && nextPlayerLife > 0);
        } else {
            // SURVIVAL: 相手の体力を削り切っても最終ステージ以外では終わらせない。
            // 「最終ステージは実際に勝たないとクリアにならない」という仕様のため、
            // 決着は「プレイヤーの体力が尽きた」か「最終ステージの決着がついた」時のみ
            const lifeZero = nextPlayerLife <= 0;
            matchOver = lifeZero || isFinalSurvivalStage;
            matchWin = isFinalSurvivalStage && win === true;
            if(matchOver) survivalEndReason = lifeZero ? 'lifeZero' : (matchWin ? 'cleared' : 'finalStageFailed');
        }
    } else if(state.mode === 'survival' && isDraw && isFinalSurvivalStage) {
        // 最終ステージの相打ちも「勝ってはいない」ためクリア扱いにはしない
        matchOver = true;
        matchWin = false;
        survivalEndReason = 'finalStageFailed';
    }

    state.result = { win, reason, isFinalStory, isDraw, tally, lifeDmg, matchOver, matchWin, survivalEndReason, stage: state.round };

    // 次ラウンドの予算を配布
    // （SURVIVAL / VERSUS はラウンドに負けても、体力が残っていれば試合は続く）
    if(isLifeMode) {
        if(!matchOver) {
            state.round++;
            state.gold += (state.mode === 'survival' ? survivalBudgetForRound(state.round) : budgetForRound(state.round));
        } else {
            deleteSave();
        }
    } else if(win || isDraw) {
        if(isFinalStory) {
            deleteSave();
        } else {
            state.round++;
            state.gold += budgetForRound(state.round);
        }
    }

    updateRecords();

    if(isLifeMode && !isDraw) {
        playVersusLifeAnimation(win, lifeDmg, showResultScreen);
    } else {
        updateVersusHud();
        showResultScreen();
    }
}

// VERSUS の体力ゲージが減る演出。
// 1) 減る前の体力をいったん表示 → 2) 一呼吸置いてから減らして CSS
//    トランジションで滑らかに動かす → 3) 演出が終わってから結果画面を出す
function playVersusLifeAnimation(win, lifeDmg, done) {
    updateVersusHud(); // ダメージ適用前の体力をまず見せる

    // 崩れた拠点から、体力ゲージへ向かって衝撃弾を飛ばす。
    // 「拠点が壊れた → だから体力が減った」という因果を目で追えるようにする。
    const fromBase = win ? state.enemyBase : state.playerBase;
    // 体力ゲージは #versus-hud（stage 上端から約 30px）の左右に並んでいる
    const targetX = win ? state.w * 0.72 : state.w * 0.28;
    const targetY = 40;
    const travelFrames = 34;

    if(fromBase) {
        // 拠点が砕けるエフェクト
        for(let i = 0; i < 14; i++) {
            const a = (Math.PI * 2 / 14) * i;
            state.fx.push({
                x: fromBase.x, y: fromBase.y,
                vx: Math.cos(a) * randRange(1.5, 3.5), vy: Math.sin(a) * randRange(1.5, 3.5) - 1,
                life: 26, color: win ? '#fbbf24' : '#f87171'
            });
        }
        state.fx.push({
            type: 'lifeshot', t: 0, dur: travelFrames, trail: [],
            x0: fromBase.x, y0: fromBase.y - 10, x: fromBase.x, y: fromBase.y - 10,
            tx: targetX, ty: targetY,
            life: 999, color: win ? '#34d399' : '#ef4444'
        });
        addShake(7);
    }

    // 弾がゲージに着弾したタイミングで体力を減らす
    const travelMs = travelFrames * (1000 / 60) + 120;
    setTimeout(() => {
        if(win) state.aiLife = Math.max(0, state.aiLife - lifeDmg);
        else    state.playerLife = Math.max(0, state.playerLife - lifeDmg);

        // 着弾の炸裂
        for(let i = 0; i < 12; i++) {
            const a = (Math.PI * 2 / 12) * i;
            state.fx.push({
                x: targetX, y: targetY,
                vx: Math.cos(a) * 2.5, vy: Math.sin(a) * 2.5,
                life: 22, color: '#ef4444'
            });
        }
        spawnPop(targetX, targetY + 16, '-' + lifeDmg, '#ef4444');
        addShake(6);
        updateVersusHud(); // ここで CSS の width トランジションが走る

        setTimeout(done, 750);
    }, travelMs);
}

function showResultScreen() {
    const r = state.result;
    const title = document.getElementById('result-title');
    const msg = document.getElementById('result-msg');
    const stats = document.getElementById('result-stats');
    const btnNext = document.getElementById('btn-result-next');
    const btnRetry = document.getElementById('btn-result-retry');

    const baseRatio = Math.round((state.playerBase.hp / state.playerBase.maxHp) * 100);
    const rows = [];
    let showNext = false, showRetry = true;

    if(state.mode === 'versus') {
        // --- VERSUS: 体力制の対戦 ---
        if(r.matchOver) {
            title.textContent = r.matchWin ? 'YOU WIN' : 'YOU LOSE';
            title.className = 'result-title ' + (r.matchWin ? 'win' : 'lose');
            msg.textContent = r.matchWin
                ? `${state.round} ラウンドで相手の体力を削り切った！`
                : `${state.round} ラウンドで力尽きた…`;
            showNext = false;
            showRetry = false;
        } else if(r.isDraw) {
            title.textContent = 'DRAW';
            title.className = 'result-title';
            msg.textContent = '互角 — どちらの体力も減らなかった';
            showNext = true;
        } else {
            title.textContent = r.win ? 'ROUND WIN' : 'ROUND LOSE';
            title.className = 'result-title ' + (r.win ? 'win' : 'lose');
            msg.textContent = r.win
                ? '相手の体力を削った！'
                : (r.reason || '拠点を落とされた');
            showNext = true;
        }
        if(!r.isDraw) rows.push([r.win ? '相手に与えたダメージ' : '受けたダメージ', `${r.lifeDmg}`, 'dmg']);
        rows.push(['自分の体力', `${state.playerLife}`]);
        rows.push(['相手の体力', `${state.aiLife}`]);
        rows.push(['生き残り', `味方 ${r.tally.playerAlive} / 敵 ${r.tally.enemyAlive}`]);

    } else if(state.mode === 'survival') {
        // --- SURVIVAL: VERSUSと同じ体力制。ただし最終(SURVIVAL_STAGES)ステージ
        // だけは実際に勝たないとクリア扱いにならない ---
        if(r.matchOver) {
            if(r.survivalEndReason === 'cleared') {
                title.textContent = 'ALL CLEAR';
                title.className = 'result-title win';
                msg.textContent = `全${SURVIVAL_STAGES}ステージを制覇した！`;
            } else if(r.survivalEndReason === 'finalStageFailed') {
                title.textContent = 'NO CLEAR';
                title.className = 'result-title lose';
                msg.textContent = `最終ステージ(${SURVIVAL_STAGES})を突破できなかった…`;
            } else {
                title.textContent = 'GAME OVER';
                title.className = 'result-title lose';
                msg.textContent = `ステージ ${r.stage} で力尽きた…`;
            }
            showNext = false;
            showRetry = false;
        } else if(r.isDraw) {
            title.textContent = 'DRAW';
            title.className = 'result-title';
            msg.textContent = '互角 — どちらの体力も減らなかった';
            showNext = true;
        } else {
            title.textContent = r.win ? 'STAGE CLEAR' : 'STAGE LOSE';
            title.className = 'result-title ' + (r.win ? 'win' : 'lose');
            msg.textContent = r.win
                ? `ステージ ${r.stage} 突破！`
                : (r.reason || '拠点を落とされた');
            showNext = true;
        }
        if(!r.isDraw) rows.push([r.win ? '相手に与えたダメージ' : '受けたダメージ', `${r.lifeDmg}`, 'dmg']);
        rows.push(['ステージ', `${r.stage} / ${SURVIVAL_STAGES}`]);
        rows.push(['自分の体力', `${state.playerLife}`]);
        rows.push(['相手の体力', `${state.aiLife}`]);
        rows.push(['生き残り', `味方 ${r.tally.playerAlive} / 敵 ${r.tally.enemyAlive}`]);

    } else {
        // --- STORY ---
        if(r.isFinalStory) {
            title.textContent = 'ALL CLEAR';
            title.className = 'result-title win';
            msg.textContent = state.storyExtra
                ? `EXTRA全${STORY_LAST_WAVE}ステージ制覇！ 強化された台本を攻略した。`
                : `全${STORY_LAST_WAVE}ステージ制覇！ 見事な采配だ。`;
            showRetry = false;
        } else if(r.win || r.isDraw) {
            title.textContent = r.isDraw ? 'DRAW' : 'VICTORY';
            title.className = 'result-title win';
            msg.textContent = `STAGE ${state.round - 1} クリア！`;
            showNext = true;
        } else {
            title.textContent = 'DEFEAT';
            title.className = 'result-title lose';
            msg.textContent = r.reason || '拠点が破壊された';
        }
        rows.push(['撃破数', `${state.kills}`]);
        rows.push(['生き残り', `${r.tally.playerAlive} / ${state.roster.length} 体`]);
        rows.push(['拠点HP', `${baseRatio}%`]);
    }

    if(showNext) rows.push(['次の予算', `${state.gold}G`]);
    if(r.tally.playerLost > 0) {
        // 「編成には残ります」は次ラウンドがある場合のみ正しい表記。
        // 敗北時やストーリー全クリア時(showNext=false)はそのまま継続しないため付けない
        rows.push(['戦死したユニット', `${r.tally.playerLost} 体` + (showNext ? '（編成には残ります）' : '')]);
    }

    stats.innerHTML = rows.map(x =>
        `<div class="result-row${x[2] ? ' ' + x[2] : ''}"><span>${x[0]}</span><span>${x[1]}</span></div>`).join('');

    btnNext.style.display = showNext ? '' : 'none';
    btnNext.textContent = '次のラウンドへ';
    btnRetry.style.display = showRetry ? '' : 'none';
    btnRetry.textContent = (r.win || r.isDraw) ? 'このラウンドをやり直す' : 'もう一度挑戦する';

    document.getElementById('prep-bar').style.display = 'none';
    document.getElementById('battle-bar').style.display = 'none';
    showScreen('screen-result');
}

// ============================================================
// プレイ記録（localStorage に永続化）
// ============================================================
function defaultRecords() {
    return {
        story: { cleared: false, bestWave: 0, clearCount: 0, extraCleared: false, extraBestWave: 0, extraClearCount: 0 },
        // SURVIVALはクリア制(全SURVIVAL_STAGES)になったため、STORYと同じ
        // {cleared, bestStage, clearCount} の形を難易度ごとに持つ
        survival: {
            easy:   { cleared: false, bestStage: 0, clearCount: 0 },
            normal: { cleared: false, bestStage: 0, clearCount: 0 },
            hard:   { cleared: false, bestStage: 0, clearCount: 0 }
        },
        versus: { easy: { win: 0, lose: 0 }, normal: { win: 0, lose: 0 }, hard: { win: 0, lose: 0 } }
    };
}

function loadRecords() {
    try {
        const raw = localStorage.getItem(RECORDS_KEY);
        const base = defaultRecords();
        if(!raw) return base;
        const saved = JSON.parse(raw);
        // survivalは旧仕様(難易度ごとの単なる到達ラウンド数値)から新仕様
        // (オブジェクト)へ形が変わったため、旧形式のデータは互換を取らず
        // 初期値から始める
        const survival = {};
        ['easy', 'normal', 'hard'].forEach(d => {
            const sv = saved.survival && saved.survival[d];
            survival[d] = (sv && typeof sv === 'object')
                ? Object.assign({}, base.survival[d], sv)
                : base.survival[d];
        });
        return {
            story: Object.assign(base.story, saved.story || {}),
            survival,
            versus: Object.assign(base.versus, saved.versus || {})
        };
    } catch(e) {
        return defaultRecords();
    }
}

function saveRecords() {
    try { localStorage.setItem(RECORDS_KEY, JSON.stringify(state.records)); } catch(e) { /* 無視 */ }
}

// プレイ記録の消去。誤タップで即消えると事故になるため、
// 1回目のタップでは確認トーストを出すだけにし、一定時間内の2回目のタップで実行する
// （alert/confirm は使用禁止のため、トースト経由の2段階確認にしている）
let clearRecordsArmed = false;
function onClearRecordsClick() {
    if(!clearRecordsArmed) {
        clearRecordsArmed = true;
        toast('もう一度押すとプレイ記録を消去します');
        setTimeout(() => { clearRecordsArmed = false; }, 3000);
        return;
    }
    clearRecordsArmed = false;
    state.records = defaultRecords();
    saveRecords();
    renderRecords();
    toast('プレイ記録を消去しました');
}

// バトル結果を記録に反映する
function updateRecords() {
    const rec = state.records;
    const r = state.result;
    if(!rec || !r) return;

    if(state.mode === 'story') {
        const reached = r.win ? state.round : state.round;
        if(state.storyExtra) {
            rec.story.extraBestWave = Math.max(rec.story.extraBestWave, Math.min(STORY_LAST_WAVE, reached));
            if(r.isFinalStory) {
                rec.story.extraCleared = true;
                rec.story.extraClearCount++;
            }
        } else {
            rec.story.bestWave = Math.max(rec.story.bestWave, Math.min(STORY_LAST_WAVE, reached));
            if(r.isFinalStory) {
                rec.story.cleared = true;
                rec.story.clearCount++;
            }
        }
    } else if(state.mode === 'survival') {
        // state.round はこの時点で既に「継続する場合だけ」次ステージへ進んでいる
        // (STORYと同じタイミング)ため、勝敗どちらでも到達段階として扱ってよい
        const sv = rec.survival[state.difficulty];
        sv.bestStage = Math.max(sv.bestStage, Math.min(SURVIVAL_STAGES, state.round));
        if(r.matchOver && r.matchWin) {
            sv.cleared = true;
            sv.clearCount++;
        }
    } else if(state.mode === 'versus' && r.matchOver) {
        const v = rec.versus[state.difficulty];
        if(r.matchWin) v.win++; else v.lose++;
    }
    saveRecords();
}

// タイトル画面の記録パネルとモード選択のバッジを描画する
function renderRecords() {
    const rec = state.records || defaultRecords();
    const panel = document.getElementById('records-panel');

    // SURVIVALはクリア制になったため、STORYと同様にクリア済みかどうかを優先し、
    // 未クリアなら最高到達ステージがどの難易度でのものかも分かるようにする
    const DIFF_LABEL = { easy: 'EASY', normal: 'NORMAL', hard: 'HARD' };
    let survBest = 0, survBestDiff = null, survClearedAny = false, survClearCount = 0;
    ['hard', 'normal', 'easy'].forEach(d => {
        const sv = rec.survival[d] || { bestStage: 0, cleared: false, clearCount: 0 };
        if(sv.cleared) { survClearedAny = true; survClearCount += sv.clearCount || 0; }
        if((sv.bestStage || 0) > survBest) { survBest = sv.bestStage || 0; survBestDiff = d; }
    });

    // VERSUSは勝敗数をまとめて出す(勝った数だけでは戦績が分からないため)
    const vsWin = ['easy', 'normal', 'hard'].reduce((n, d) => n + (rec.versus[d].win || 0), 0);
    const vsLose = ['easy', 'normal', 'hard'].reduce((n, d) => n + (rec.versus[d].lose || 0), 0);

    const storyText = rec.story.extraCleared
        ? `<span class="crown">★ EXTRA全クリア${rec.story.extraClearCount > 1 ? ' ×' + rec.story.extraClearCount : ''}</span>`
        : rec.story.cleared
            ? `<span class="crown">★ 全クリア${rec.story.clearCount > 1 ? ' ×' + rec.story.clearCount : ''}</span>`
            : (rec.story.bestWave > 0 ? `STAGE ${rec.story.bestWave} 到達` : '未プレイ');
    const survText = survClearedAny
        ? `<span class="crown">★ 全クリア${survClearCount > 1 ? ' ×' + survClearCount : ''}</span>`
        : (survBest > 0 ? `STAGE ${survBest} 到達 <small>(${DIFF_LABEL[survBestDiff]})</small>` : '未プレイ');
    const vsText = (vsWin + vsLose) > 0 ? `${vsWin}勝${vsLose}敗` : '未プレイ';

    panel.innerHTML = `
        <div class="records-title">PLAY RECORD</div>
        <div class="rec-row"><span>STORY</span><span>${storyText}</span></div>
        <div class="rec-row"><span>SURVIVAL</span><span>${survText}</span></div>
        <div class="rec-row"><span>VERSUS 戦績</span><span>${vsText}</span></div>`;

    // モード選択のバッジ
    const bs = document.getElementById('badge-story');
    if(bs) bs.innerHTML = rec.story.extraCleared ? '★ EXTRA CLEAR'
        : (rec.story.cleared ? '★ CLEAR' : (rec.story.bestWave ? 'W' + rec.story.bestWave : ''));
    const bv = document.getElementById('badge-survival');
    if(bv) bv.innerHTML = survClearedAny ? '★ CLEAR' : (survBest > 0 ? 'STAGE ' + survBest : '');
    const bt = document.getElementById('badge-versus');
    if(bt) bt.textContent = vsWin > 0 ? vsWin + ' WIN' : '';

    // 難易度ボタンのクリアマーク
    ['easy', 'normal', 'hard'].forEach(d => {
        const el = document.getElementById('diff-mark-' + d);
        if(!el) return;
        const marks = [];
        if(rec.versus[d].win > 0) marks.push('★' + rec.versus[d].win);
        const sv = rec.survival[d];
        if(sv && sv.cleared) marks.push('★S');
        else if(sv && sv.bestStage > 0) marks.push('S' + sv.bestStage);
        el.textContent = marks.join(' ');
    });

    // STORY EXTRAのクリア回数マーク
    const extraMark = document.getElementById('story-extra-mark');
    if(extraMark) extraMark.textContent = rec.story.extraClearCount > 0 ? '★' + rec.story.extraClearCount : '';

    // 解禁状況・選択中モードに応じて、難易度セレクタ／STORY EXTRAトグルの表示を更新
    syncModeSelectExtras();
}

// ============================================================
// VERSUS モードの体力ゲージ表示
// ============================================================
function updateVersusHud() {
    const hud = document.getElementById('versus-hud');
    const isLifeMode = (state.mode === 'versus' || state.mode === 'survival');
    if(!isLifeMode || state.scene === 'title' || state.scene === 'mode') {
        hud.classList.remove('show');
        return;
    }
    const lifeMax = state.mode === 'survival' ? SURVIVAL_LIFE : VERSUS_LIFE;
    hud.classList.add('show');
    document.getElementById('life-p-val').textContent = state.playerLife;
    document.getElementById('life-e-val').textContent = state.aiLife;
    document.getElementById('life-p-fill').style.width = (state.playerLife / lifeMax * 100) + '%';
    document.getElementById('life-e-fill').style.width = (state.aiLife / lifeMax * 100) + '%';
}

// ラウンドをやり直す（準備フェーズ開始時の状態に戻す）
function retryRound() {
    if(!state.snapshot) return;
    const s = JSON.parse(state.snapshot);
    state.round = s.round;
    state.gold = s.gold;
    state.roster = s.roster;
    state.aiRoster = s.aiRoster;
    state.aiGold = s.aiGold;
    state.aiPower = s.aiPower || 1;
    state.aiUnitLevels = s.aiUnitLevels || {};
    state.playerLife = s.playerLife;
    state.aiLife = s.aiLife;
    state.upgrades = s.upgrades;
    state.unitLevels = s.unitLevels || {};
    state.tactics = s.tactics;
    state.nextId = s.nextId;
    state.storyEnemies = s.storyEnemies || [];

    // enterPrep で AI 編成を再抽選しないように、このラウンド分は購入済み扱いにする
    state.scene = 'prep';
    state.selected = null;
    state.undoStack = [];
    state.units = [];
    state.projs = [];
    state.fx = [];
    state.popups = [];
    state.boss = null;
    state.bossCleared = false;
    state.timeWarp = 0;
    state.hitstop = 0;
    state.bossClearDelay = 0;
    state.kills = 0;
    state.playerBase = new Base(true);
    state.enemyBase = isVsMode() ? new Base(false) : null;
    clampRosters();

    hideScreens();
    closePauseModal();
    closeShop();
    hideUnitInfo();
    showPrepBar();
    resize();
    renderShop();
    updatePrepUI();
    updateHud();
    updateVersusHud();
}

// 新規ゲーム開始
function startNewGame(mode) {
    state.mode = mode;
    if(mode !== 'story') state.storyExtra = false; // EXTRAはSTORY専用のフラグ
    state.round = 1;
    state.gold = mode === 'survival' ? survivalBudgetForRound(1) : budgetForRound(1);
    state.roster = [];
    state.aiRoster = [];
    state.storyEnemies = [];
    state.aiGold = 0;
    state.aiPower = 1;
    state.aiUnitLevels = {};
    state.aiNote = '';
    // AI の「好み」を試合開始時に1つ抽選する（試合中は固定。STORYは対象外）
    state.aiPersonality = (mode === 'story') ? null
        : AI_PERSONALITIES[Math.floor(Math.random() * AI_PERSONALITIES.length)];
    state.nextId = 1;
    state.upgrades = {};
    state.unitLevels = {};
    state.tactics = {};
    state.playerLife = mode === 'survival' ? SURVIVAL_LIFE : VERSUS_LIFE;
    state.aiLife = state.playerLife;
    deleteSave();
    enterPrep();

    const diff = AI_PRESETS[state.difficulty].label;
    if(mode === 'story') toast(state.storyExtra ? 'STORY EXTRA 開始 — 固定ウェーブが強化された高難度版' : 'STORY モード開始');
    else if(mode === 'survival') toast(`SURVIVAL 開始（${diff}）— 全${SURVIVAL_STAGES}ステージ・体力 ${SURVIVAL_LIFE}`);
    else toast(`VERSUS 開始（${diff}）— 体力 ${VERSUS_LIFE} / 配置上限なし`);

    // AI自身の編成の傾向（対策とは別のクセ）を知らせる。対策ヒントと同じ
    // ディレイを使い、開始直後のトーストと表示が入れ替わるようにする
    if(state.aiPersonality && state.difficulty !== 'easy') {
        setTimeout(() => toast('敵の傾向: ' + state.aiPersonality.note), 350);
    }
}

function backToTitle() {
    state.scene = 'title';
    state.paused = false;
    state.units = [];
    state.projs = [];
    state.fx = [];
    state.popups = [];
    state.boss = null;
    state.hitstop = 0;
    state.bossClearDelay = 0;
    state.shopTab = 'units';
    closePauseModal();
    closeShop();
    closeCodex();
    hideUnitInfo();
    showPrepBar();
    updateVersusHud();
    document.getElementById('btn-continue').style.display = hasSave() ? '' : 'none';
    renderRecords();
    showScreen('screen-title');
}

// ============================================================
// セーブ / ロード
// ============================================================
function saveGame() {
    try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({
            mode: state.mode, difficulty: state.difficulty, storyExtra: state.storyExtra,
            round: state.round, gold: state.gold,
            roster: state.roster, aiRoster: state.aiRoster, aiGold: state.aiGold,
            aiPower: state.aiPower, aiUnitLevels: state.aiUnitLevels,
            playerLife: state.playerLife, aiLife: state.aiLife,
            aiPersonalityName: state.aiPersonality ? state.aiPersonality.name : null,
            upgrades: state.upgrades, unitLevels: state.unitLevels, tactics: state.tactics, nextId: state.nextId,
            storyEnemies: state.storyEnemies
        }));
    } catch(e) { /* 保存できない環境では何もしない */ }
}

function hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch(e) { return false; }
}

function deleteSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch(e) { /* 無視 */ }
}

function loadGame() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if(!raw) { toast('セーブデータがありません'); return; }
        const s = JSON.parse(raw);
        state.mode = s.mode;
        state.difficulty = s.difficulty || 'normal';
        state.storyExtra = s.storyExtra || false;
        state.round = s.round;
        state.gold = s.gold;
        state.roster = s.roster || [];
        state.aiRoster = s.aiRoster || [];
        state.aiGold = s.aiGold || 0;
        state.aiPower = s.aiPower || 1;
        state.aiUnitLevels = s.aiUnitLevels || {};
        state.playerLife = s.playerLife === undefined ? VERSUS_LIFE : s.playerLife;
        state.aiLife = s.aiLife === undefined ? VERSUS_LIFE : s.aiLife;
        state.aiPersonality = AI_PERSONALITIES.find(p => p.name === s.aiPersonalityName) || null;
        state.upgrades = s.upgrades || {};
        state.unitLevels = s.unitLevels || {};
        state.tactics = s.tactics || {};
        state.nextId = s.nextId || 1;
        state.storyEnemies = s.storyEnemies || [];

        // セーブ地点は準備フェーズの開始時。AI 編成・STORYの敵配置は再抽選しない
        state.scene = 'prep';
        state.selected = null;
        state.undoStack = [];
        state.units = [];
        state.projs = [];
        state.fx = [];
        state.popups = [];
        state.boss = null;
        state.bossCleared = false;
        state.hitstop = 0;
        state.bossClearDelay = 0;
        state.playerBase = new Base(true);
        state.enemyBase = isVsMode() ? new Base(false) : null;
        clampRosters();

        state.snapshot = JSON.stringify({
            round: state.round, gold: state.gold,
            roster: state.roster, aiRoster: state.aiRoster, aiGold: state.aiGold,
            aiPower: state.aiPower, aiUnitLevels: state.aiUnitLevels,
            playerLife: state.playerLife, aiLife: state.aiLife,
            upgrades: state.upgrades, unitLevels: state.unitLevels, tactics: state.tactics, nextId: state.nextId,
            storyEnemies: state.storyEnemies
        });

        hideScreens();
        showPrepBar();
        renderShop();
        updatePrepUI();
        updateHud();
        updateVersusHud();
        toast('つづきから再開しました');
    } catch(e) {
        toast('セーブデータを読み込めませんでした');
    }
}

// ============================================================
// ショップ UI
// ============================================================
// ユニットのアイコン。enemy を指定すると敵側の赤系パレットで描く
// （フィールド上の見た目と説明カードの色を一致させるため）
function spriteIconCanvas(sprite, pal) {
    const c = document.createElement('canvas');
    c.className = 'card-icon';
    c.width = 40; c.height = 40;
    const g = c.getContext('2d');
    const box = getSpriteBox(sprite);
    const s = Math.floor(Math.min(40 / box.w, 40 / box.h));
    const ox = (40 - box.w * s) / 2 - box.minC * s;
    const oy = (40 - box.h * s) / 2 - box.minR * s;
    for(let r = box.minR; r <= box.maxR; r++) {
        for(let col = box.minC; col <= box.maxC; col++) {
            const idx = sprite[r][col];
            if(idx > 0) {
                g.fillStyle = pal[idx];
                g.fillRect(ox + col * s, oy + r * s, s, s);
            }
        }
    }
    return c;
}

function unitIconCanvas(key, enemy) {
    const def = UNIT_DEFS[key];
    const pal = enemy ? (ENEMY_PALETTES[key] || def.pal) : def.pal;
    return spriteIconCanvas(def.sprite, pal);
}

// ------------------------------------------------------------
// ユニットカードの共通生成
// ショップ / ユニット図鑑 / フィールドのタップ説明で同じ見た目を使う
// ------------------------------------------------------------
function buildUnitCard(key, opts) {
    const o = opts || {};
    const def = UNIT_DEFS[key];
    const splash = splashRadius(def);

    // レベルアップ済みなら、表示するステータスにもその分を反映する（上限あり）。
    // 敵側はVERSUSでAIが投資した分を反映する（それ以外のモードは常に0）。
    // 図鑑のプレビューモードでは実際の所持レベルではなく、閲覧用に
    // その場で上下できる仮のレベル(previewLevel)を使う
    const lvl = o.previewLevel !== undefined ? o.previewLevel : (o.enemy ? aiUnitLevel(key) : unitLevel(key));
    const lvlMult = o.previewLevel !== undefined
        ? Math.min(UNIT_LEVEL_MULT_CAP, Math.pow(1 + UNIT_LEVEL_STAT_GAIN, o.previewLevel))
        : (o.enemy ? aiUnitLevelMult(key) : unitLevelMult(key));
    const dispHp = Math.round(def.hp * lvlMult);
    const dispDmg = Math.round(Math.abs(def.dmg) * lvlMult) * (def.dmg < 0 ? -1 : 1);

    const card = document.createElement('div');
    card.className = 'shop-card';

    const head = document.createElement('div');
    head.className = 'card-head';
    head.appendChild(unitIconCanvas(key, o.enemy));

    const role = roleLabel(def);
    const id = document.createElement('div');
    id.className = 'card-id';
    id.innerHTML = `
        <div class="card-name">${def.name}</div>
        <div class="card-sub">
            <span class="card-type">${reachLabel(def)}</span>
            ${splash ? '<span class="card-type splash">範囲</span>' : ''}
            ${role ? `<span class="card-type">${role}</span>` : ''}
            <span class="card-lv">Lv.${lvl + 1}</span>
            ${o.owned ? `<span class="card-own">×${o.owned}</span>` : ''}
        </div>`;
    head.appendChild(id);

    if(o.showCost) {
        const cost = document.createElement('div');
        cost.className = 'card-cost';
        // 図鑑のプレビューモードでは、実際の所持レベル(state.unitLevels。
        // タイトル画面なので前回セーブの値が残っている)ではなく、
        // プレビューレベルに応じた価格を表示する
        const dispCost = o.previewLevel !== undefined
            ? Math.round(def.cost * lvlMult)
            : unitBuyCost(key);
        cost.textContent = dispCost + 'G';
        head.appendChild(cost);
    }

    const body = document.createElement('div');
    body.innerHTML = `
        <div class="card-stats">
            <span><b>体力</b>${dispHp}</span>
            <span><b>攻撃力</b>${dispDmg < 0 ? '回復' + Math.abs(dispDmg) : dispDmg}</span>
            <span><b>攻撃間隔</b>${def.type === 'beam' ? '常時照射' : (def.rate / 60).toFixed(2) + '秒'}</span>
            <span><b>移動速度</b>${Math.round(def.speed * 100)}</span>
            <span><b>射程</b>${def.range}</span>
            <span><b>範囲攻撃</b>${splash ? '半径' + splash : 'なし'}</span>
        </div>
        <div class="card-comment">${def.comment}</div>`;

    // ユニット購入に関わる表示(アイコン・ステータス等)をまとめておく。
    // 配置上限などで購入できない時にここだけを薄くし、下の強化欄まで
    // 薄く見えて操作できないと誤解させないようにするため
    const buyable = document.createElement('div');
    buyable.className = 'card-buyable';
    buyable.appendChild(head);
    buyable.appendChild(body);
    card.appendChild(buyable);

    // ショップのユニットタブでのみ、そのユニット種のレベルアップ購入を出す
    if(o.canLevelUp) {
        const lvup = document.createElement('div');
        lvup.className = 'card-lvup';
        if(!o.owned) {
            // 所持数0だとレベルアップ価格の計算基準が定まらず、先に購入した
            // 場合より割高になる抜け道があったため、配置するまではロックする
            lvup.innerHTML = `<span class="lvup-maxed">配置すると強化できます</span>`;
        } else if(lvlMult >= effectiveUnitLevelCap(key)) {
            lvup.innerHTML = `<span class="lvup-maxed">★ 最大まで強化済み</span>`;
        } else {
            lvup.innerHTML = `
                <button class="lvup-btn" type="button">▲ 強化する</button>
                <span class="lvup-cost">${unitLevelCost(key, lvl, o.owned)}G</span>`;
            lvup.querySelector('.lvup-btn').addEventListener('click', e => {
                e.stopPropagation();
                buyUnitLevel(key);
            });
        }
        card.appendChild(lvup);
    } else if(o.previewMode) {
        // 図鑑用のレベルプレビュー。実際のゴールドや所持数とは無関係に、
        // ステータスが何倍まで伸びるかその場で確認できるだけの機能
        const lvup = document.createElement('div');
        lvup.className = 'card-lvup';
        const atCap = lvlMult >= UNIT_LEVEL_MULT_CAP - 1e-9;
        lvup.innerHTML = `
            <button class="lvup-btn lvup-step" type="button" data-dir="-1" ${lvl <= 0 ? 'disabled' : ''}>▼ Lv</button>
            <span class="lvup-cost">${atCap ? '上限' : ''}</span>
            <button class="lvup-btn lvup-step" type="button" data-dir="1" ${atCap ? 'disabled' : ''}>▲ Lv</button>`;
        lvup.querySelectorAll('.lvup-step').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                adjustCodexPreviewLevel(key, Number(btn.dataset.dir));
            });
        });
        card.appendChild(lvup);
    }

    return card;
}

// ボスの特殊能力を、実際のデータ(BOSS_DEFS)から組み立てて説明文にする。
// special の種類ごとに書き分けつつ、knockback/lifesteal/meleeSplashのような
// 特殊に依らず持ちうる個性も併記する（ステージ4は summon と meleeSplash を両方持つ、等）
function bossAbilityDesc(d) {
    const parts = [];
    if(d.special === 'summon') parts.push('定期的に手下を呼び出す');
    if(d.special === 'armor') parts.push('被ダメージを軽減する重装備');
    if(d.special === 'teleport') parts.push('ワープで位置を変えつつ遠距離攻撃');
    if(d.special === 'fire') parts.push('周囲に炎の範囲攻撃');
    if(d.special === 'revive') parts.push('倒れた味方を蘇生する');
    if(d.special === 'beam') parts.push('狙い続けた相手ほどダメージが増す継続照射');
    if(d.special === 'phases') parts.push('HPが減ると形態が変化し強化される');
    if(d.knockback) parts.push('攻撃にノックバック');
    if(d.lifesteal) parts.push(`与ダメージの${Math.round(d.lifesteal * 100)}%を自己回復`);
    if(d.meleeSplash) parts.push('広範囲の薙ぎ払い');
    if(d.awaken) parts.push('第2形態で味方を弾き飛ばし、長射程の範囲攻撃タイプに覚醒する');
    return parts.length ? parts.join('・') : '特殊能力なし';
}

// フィールドのボスをタップした際の説明カード（通常ユニットとはデータ形が
// 異なる=BOSS_DEFS のため、buildUnitCard とは別に組み立てる）。
// バトル中は実際に稼働中の Boss インスタンス（現在HPを反映）、
// 準備フェーズのプレビューでは BOSS_DEFS の素の値を渡す
function buildBossCard() {
    const boss = state.boss;
    const d = boss ? boss.data : currentBossDefs()[state.round];
    const hp = boss ? Math.max(0, Math.round(boss.hp)) : d.hp;
    const maxHp = boss ? boss.maxHp : d.hp;
    const dmg = boss ? boss.dmg : d.dmg;
    const sprite = boss ? boss.sprite : (d.sprite.idle || d.sprite);
    const pal = boss ? boss.pal : d.palette;

    const card = document.createElement('div');
    card.className = 'shop-card';

    const head = document.createElement('div');
    head.className = 'card-head';
    head.appendChild(spriteIconCanvas(sprite, pal));
    const id = document.createElement('div');
    id.className = 'card-id';
    id.innerHTML = `
        <div class="card-name">${d.name}</div>
        <div class="card-sub"><span class="card-type">ボス</span></div>`;
    head.appendChild(id);

    const body = document.createElement('div');
    body.innerHTML = `
        <div class="card-stats">
            <span><b>体力</b>${hp}/${maxHp}</span>
            <span><b>攻撃力</b>${Math.round(dmg)}</span>
            <span><b>移動速度</b>${Math.round(d.speed * 100)}</span>
            <span><b>間合い</b>${d.range ? '遠距離' : '近接'}</span>
        </div>
        <div class="card-comment">${bossAbilityDesc(d)}</div>`;

    card.appendChild(head);
    card.appendChild(body);
    return card;
}

// ユニット種別レベルアップの購入
function buyUnitLevel(key) {
    // 1体も配置していない種類は先にレベルを上げられないようにする。
    // これを許すと「所持数0のうちに安くレベルを上げてから量産する」ことで
    // 先に購入してからレベルを上げる場合より安上がりになってしまっていた
    // （所持数0のレベルアップ価格は所持数1相当で計算されるが、後から
    // まとめ買いする分にはその「1体ぶんの前払い」が反映されないため）
    if(unitOwnedCount(key) === 0) { toast('先にユニットを配置してください'); return; }
    if(unitLevelMult(key) >= effectiveUnitLevelCap(key)) { toast('これ以上は強化できません'); return; }
    const lvl = unitLevel(key);
    const cost = unitLevelCost(key, lvl, unitOwnedCount(key));
    if(state.gold < cost) { toast('ゴールドが足りません'); return; }
    pushUndo();
    state.gold -= cost;
    const newLvl = lvl + 1;
    state.unitLevels[key] = newLvl;
    // カード表示は内部レベル(0始まり)+1を「Lv.1」始まりとして見せているため、
    // トーストも同じ表記(newLvl+1)に合わせる
    toast(`${UNIT_DEFS[key].name} が Lv.${newLvl + 1} に強化された`);
    renderShop();
    saveGame();
}

function renderShop() {
    // タブボタンの表示は常にstate.shopTabに同期させる。backToTitle()などで
    // state.shopTabを直接書き換えた場合でもズレないよう、renderShop()側で
    // 毎回揃える(タブは選択中なのに中身が違う、という表示崩れの防止)
    document.getElementById('tab-units').classList.toggle('active', state.shopTab === 'units');
    document.getElementById('tab-upgrades').classList.toggle('active', state.shopTab === 'upgrades');
    document.getElementById('tab-tactics').classList.toggle('active', state.shopTab === 'tactics');

    const list = document.getElementById('shop-list');
    list.innerHTML = '';
    list.classList.toggle('single-col', state.shopTab !== 'units');

    const legend = document.createElement('div');
    legend.className = 'shop-legend';

    if(state.shopTab === 'units') {
        legend.textContent = '攻撃間隔は低いほど速い。タップで選択 → フィールドに配置。';
        list.appendChild(legend);

        shopUnitsFor(state.mode).forEach(key => {
            const owned = state.roster.filter(r => r.key === key).length;
            const card = buildUnitCard(key, { owned, showCost: true, canLevelUp: true });
            card.dataset.key = key;
            card.addEventListener('click', () => selectShopUnit(key));
            list.appendChild(card);
        });

    } else if(state.shopTab === 'upgrades') {
        legend.textContent = '強化は永続効果。購入するたびに価格が上がります。';
        list.appendChild(legend);

        Object.keys(UPGRADE_DEFS).forEach(key => {
            const def = UPGRADE_DEFS[key];
            const price = upgradePrice(key);
            const owned = upCount(key);
            const status = upgradeStatus(key);
            const maxed = !!(status && status.maxed);
            const card = document.createElement('div');
            card.className = 'shop-card';
            card.dataset.upgrade = key;
            // 上限がある項目は「現在○%（上限○%）」を表示し、上限に達したら
            // ユニット個別レベルと同じ「★ 最大まで強化済み」表示にする。
            // ボタン部分(.card-lvup)は maxed になっても常に同じ構造で描画し、
            // 高さが変わって連打中にボタン位置がズレる(押しミスの原因)ことを防ぐ
            const progressLine = status
                ? `<div class="card-comment" style="margin-top:2px">現在 ${status.pct}%（上限 ${status.cap}%）</div>` : '';
            card.innerHTML = `
                <div class="card-head">
                    <div class="card-emoji">${def.icon}</div>
                    <div class="card-id">
                        <div class="card-name">${def.name}</div>
                        <div class="card-sub"><span class="card-own">Lv.${owned}</span></div>
                    </div>
                </div>
                <div class="card-comment" style="margin-top:4px">${def.desc}</div>
                ${progressLine}
                <div class="card-lvup">${maxed
                    ? `<span class="lvup-maxed">★ 最大まで強化済み</span>`
                    : `<button class="lvup-btn" type="button">▲ 強化する</button><span class="lvup-cost">${price}G</span>`}</div>`;
            if(!maxed) {
                card.querySelector('.lvup-btn').addEventListener('click', e => {
                    e.stopPropagation();
                    buyUpgrade(key);
                });
            }
            list.appendChild(card);
        });

    } else {
        legend.textContent = 'バトル中は操作できないため、戦術はクールダウンごとに自動発動します。';
        list.appendChild(legend);

        Object.keys(TACTIC_DEFS).forEach(key => {
            const def = TACTIC_DEFS[key];
            const owned = !!state.tactics[key];
            const card = document.createElement('div');
            card.className = 'shop-card' + (owned ? ' owned-tactic' : '');
            card.dataset.tactic = key;
            card.innerHTML = `
                <div class="card-head">
                    <div class="card-emoji">${def.icon}</div>
                    <div class="card-id">
                        <div class="card-name">${def.name}</div>
                        <div class="card-sub">${owned ? '<span class="card-own">習得済み</span>' : `<span class="card-type">CD ${def.cd}秒</span>`}</div>
                    </div>
                    <div class="card-cost">${owned ? '—' : def.cost + 'G'}</div>
                </div>
                <div class="card-comment" style="margin-top:4px">${def.desc}</div>
                <div class="card-note">クールダウンごとに自動発動</div>`;
            card.addEventListener('click', () => buyTactic(key));
            list.appendChild(card);
        });
    }

    updatePrepUI();
}

// ------------------------------------------------------------
// ユニット説明ポップアップ
// フィールド上のユニット（特に敵）をタップすると、その場で
// ショップと同じ説明カードを出す。色違いで判別しづらい問題への対応。
// ------------------------------------------------------------
// sellEntry を渡すと（準備フェーズで自ユニットをタップした場合）
// カードの下に売却ボタンを追加する
function showUnitInfo(key, isP, sx, sy, sellEntry) {
    const box = document.getElementById('unit-info');
    box.innerHTML = '';

    const side = document.createElement('div');
    side.className = 'info-side ' + (isP ? 'mine' : 'foe');
    side.textContent = isP ? '▲ 味方ユニット' : (key === '__boss__' ? '▼ ボス' : '▼ 敵ユニット');
    box.appendChild(side);
    box.appendChild(key === '__boss__' ? buildBossCard() : buildUnitCard(key, { showCost: false, enemy: !isP }));

    if(sellEntry) {
        const sell = document.createElement('button');
        sell.className = 'info-sell-btn';
        sell.type = 'button';
        sell.textContent = `売却する（+${unitBuyCost(key)}G）`;
        sell.addEventListener('click', () => {
            sellRosterEntry(sellEntry);
            hideUnitInfo();
        });
        box.appendChild(sell);
    } else if(isP && state.scene === 'prep') {
        // 準備フェーズで自ユニットをタップしたが売却できない
        // （前ラウンド以前から編成にいるユニットは売却対象外）場合の説明
        const note = document.createElement('div');
        note.className = 'card-note';
        note.textContent = '前ラウンド以前から編成にいるユニットは売却できません';
        box.appendChild(note);
    }

    box.classList.add('show');

    // タップ位置の近くに出しつつ、フィールドからはみ出さないよう収める
    const stage = document.getElementById('stage').getBoundingClientRect();
    const w = box.offsetWidth, h = box.offsetHeight;
    let left = sx - w / 2;
    let top = sy - h - 22;               // まずはユニットの上に出す
    if(top < 4) top = sy + 26;           // 上に収まらなければ下へ
    box.style.left = clamp(left, 6, stage.width - w - 6) + 'px';
    box.style.top = clamp(top, 4, stage.height - h - 6) + 'px';
}

function hideUnitInfo() {
    document.getElementById('unit-info').classList.remove('show');
}

// ボス（バトル中の実体、または準備フェーズのプレビュー固定位置）への
// タップ判定。スプライトの実寸(足元アンカー)から矩形で判定する
function bossHitAt(sprite, scale, cx, cy, x, y) {
    const box = getSpriteBox(sprite);
    const halfW = box.w * scale / 2;
    const h = box.h * scale;
    return Math.abs(cx - x) <= halfW && (cy - y) >= -8 && (cy - y) <= h + 8;
}

// 指定座標にいるユニット（準備フェーズは編成データ、バトル中は実体）を探す
function unitAtPoint(x, y) {
    // バトル中は実際に動いているユニットから探す
    if(state.scene === 'battle') {
        if(state.boss && bossHitAt(state.boss.sprite, state.boss.scale, state.boss.x, state.boss.y, x, y)) {
            return { key: '__boss__', isP: false };
        }
        let hit = null, bd = 26;
        state.units.forEach(u => {
            const d = Math.hypot(u.x - x, u.y - y - 12);
            if(d < bd) { bd = d; hit = { key: u.key, isP: u.isP }; }
        });
        return hit;
    }
    // 準備フェーズ: STORYはボスのプレビュー（固定位置）もタップ対象に含める
    if(state.mode === 'story' && currentBossDefs()[state.round]) {
        const d = currentBossDefs()[state.round];
        const sprite = d.sprite.idle || d.sprite;
        if(bossHitAt(sprite, 3.5, state.w / 2, 130 + topInset(), x, y)) {
            return { key: '__boss__', isP: false };
        }
    }
    // 敵（AI編成 / STORYの敵プレビュー）のみ対象。味方のタップは売却に使うため
    let hit = null, bd = 26;
    state.aiRoster.concat(state.storyEnemies).forEach(r => {
        const d = Math.hypot(r.x - x, r.y - y - 10);
        if(d < bd) { bd = d; hit = { key: r.key, isP: false }; }
    });
    return hit;
}

// ------------------------------------------------------------
// ユニット図鑑（タイトル画面から開く一覧）
// ------------------------------------------------------------
// 図鑑で「レベルを上げるとどれだけ伸びるか」をその場で確認できる、
// 実際のゴールド・所持数とは無関係な閲覧専用のプレビューレベル
let codexPreviewLevels = {};

function openCodex() {
    const scrollTop = document.getElementById('codex-list').scrollTop;
    const list = document.getElementById('codex-list');
    list.innerHTML = '';

    // カテゴリ分けはせず、全ユニットを同列の1グループとして並べる
    const keys = [...SHOP_UNITS, ...ELITE_UNITS, 'angel', 'miniStone'];
    keys.forEach(key => list.appendChild(buildUnitCard(key,
        { showCost: true, previewMode: true, previewLevel: codexPreviewLevels[key] || 0 })));
    list.scrollTop = scrollTop;

    document.getElementById('codex-sheet').classList.add('show');
}

// 図鑑のプレビューレベルを+1/-1する（実際のゴールドや所持数は一切変更しない）
function adjustCodexPreviewLevel(key, dir) {
    const capLevel = Math.ceil(Math.log(UNIT_LEVEL_MULT_CAP) / Math.log(1 + UNIT_LEVEL_STAT_GAIN));
    const cur = codexPreviewLevels[key] || 0;
    codexPreviewLevels[key] = clamp(cur + dir, 0, capLevel);
    openCodex();
}

function closeCodex() {
    document.getElementById('codex-sheet').classList.remove('show');
    codexPreviewLevels = {}; // 次に開いたときは毎回Lv.1からのプレビューに戻す
}

// ------------------------------------------------------------
// ショップ（ボトムシート）の開閉
// ------------------------------------------------------------
function openShop() {
    if(state.scene !== 'prep') return;
    renderShop();
    document.getElementById('shop-sheet').classList.add('show');
}

function closeShop() {
    document.getElementById('shop-sheet').classList.remove('show');
}

function selectShopUnit(key) {
    const cap = maxUnitsFor(state.mode);
    if(state.roster.length >= cap) { toast(`配置できるのは ${cap} 体までです`); return; }
    if(state.gold < unitBuyCost(key)) { toast('ゴールドが足りません'); return; }
    state.selected = (state.selected === key) ? null : key;
    if(state.selected) {
        closeShop();
        toast(`${UNIT_DEFS[key].name} を選択中 — 緑のエリアをタップして配置`);
    }
    updatePrepUI();
}

function buyUpgrade(key) {
    const status = upgradeStatus(key);
    if(status && status.maxed) { toast('これ以上は強化できません'); return; }
    const price = upgradePrice(key);
    if(state.gold < price) { toast('ゴールドが足りません'); return; }
    pushUndo();
    state.gold -= price;
    state.upgrades[key] = upCount(key) + 1;

    // 拠点強化はその場で反映する
    if(key === 'fortified') {
        state.playerBase.maxHp += 400;
        state.playerBase.hp += 400;
    }
    toast(`${UPGRADE_DEFS[key].name} を購入`);
    renderShop();
    saveGame();
}

function buyTactic(key) {
    if(state.tactics[key]) { toast('すでに習得しています'); return; }
    const def = TACTIC_DEFS[key];
    if(state.gold < def.cost) { toast('ゴールドが足りません'); return; }
    pushUndo();
    state.gold -= def.cost;
    state.tactics[key] = true;
    toast(`${def.name} を習得`);
    renderShop();
    saveGame();
}

function updatePrepUI() {
    const cap = maxUnitsFor(state.mode);
    document.getElementById('gold-val').textContent = state.gold;
    document.getElementById('sheet-gold').textContent = state.gold;
    const dep = document.getElementById('deploy-box');
    dep.textContent = (state.mode === 'story')
        ? `配置 ${state.roster.length}/${cap}`
        : `配置 ${state.roster.length}体（上限なし）`;
    dep.classList.toggle('full', state.roster.length >= cap);

    document.querySelectorAll('#shop-list .shop-card').forEach(card => {
        const key = card.dataset.key;
        if(key) {
            card.classList.toggle('selected', state.selected === key);
            card.classList.toggle('cant-buy', state.gold < unitBuyCost(key) || state.roster.length >= cap);
            // レベルアップの可否はユニット本体の購入可否とは独立して判定する
            const lvupBtn = card.querySelector('.lvup-btn');
            if(lvupBtn) lvupBtn.disabled = state.gold < unitLevelCost(key, unitLevel(key), unitOwnedCount(key));
        } else if(card.dataset.upgrade) {
            const key = card.dataset.upgrade;
            const status = upgradeStatus(key);
            card.classList.toggle('cant-buy', !(status && status.maxed) && state.gold < upgradePrice(key));
        } else if(card.dataset.tactic) {
            const t = card.dataset.tactic;
            card.classList.toggle('cant-buy', !state.tactics[t] && state.gold < TACTIC_DEFS[t].cost);
        }
    });

    document.getElementById('btn-start-battle').disabled = state.roster.length === 0;
    updateUndoButton();
}

function setTab(tab) {
    state.shopTab = tab;
    state.selected = null;
    renderShop(); // タブボタンのactive表示もrenderShop内で同期される
}

// ------------------------------------------------------------
// アンドゥ（このラウンド中の購入・売却・強化・戦術習得を一手ずつ戻す）
//
// 「全解除」で編成を一括リセットできると、AI の対策編成（直前ラウンドの
// プレイヤー編成を分析する仕組み）を無意味に潰せてしまうため廃止し、
// 一手ずつしか戻せないアンドゥに置き換えている。連打すればラウンド開始
// 時点まで戻せるが、その分の手間はかかる。
// ------------------------------------------------------------
function pushUndo() {
    state.undoStack.push(JSON.stringify({
        gold: state.gold,
        roster: state.roster,
        upgrades: state.upgrades,
        unitLevels: state.unitLevels,
        tactics: state.tactics
    }));
    if(state.undoStack.length > 200) state.undoStack.shift(); // 念のため上限
    updateUndoButton();
}

function undoLastAction() {
    if(state.undoStack.length === 0) { toast('これ以上は戻せません'); return; }
    const snap = JSON.parse(state.undoStack.pop());
    state.gold = snap.gold;
    state.roster = snap.roster;
    state.upgrades = snap.upgrades;
    state.unitLevels = snap.unitLevels || {};
    state.tactics = snap.tactics;
    state.selected = null;

    // 拠点強化(fortified)の反映数もアップグレード数に合わせて再計算する
    state.playerBase.maxHp = BASE_HP + baseBonusHp();
    state.playerBase.hp = Math.min(state.playerBase.hp, state.playerBase.maxHp);

    toast('ひとつ前の状態に戻しました');
    renderShop();
    updateUndoButton();
    saveGame();
}

function updateUndoButton() {
    const disabled = state.undoStack.length === 0;
    const btn = document.getElementById('btn-undo');
    if(btn) btn.disabled = disabled;
    // ショップシート側にも同じアンドゥボタンを置いているので合わせて更新する
    const shopBtn = document.getElementById('btn-undo-shop');
    if(shopBtn) shopBtn.disabled = disabled;
}

// ============================================================
// 入力（準備フェーズのみ操作可能）
// ============================================================
function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - r.left) * (state.w / r.width),
        y: (e.clientY - r.top) * (state.h / r.height)
    };
}

function rosterAt(x, y) {
    let hit = null, bd = 22;
    state.roster.forEach(r => {
        const d = Math.hypot(r.x - x, r.y - y - 10);
        if(d < bd) { bd = d; hit = r; }
    });
    return hit;
}

function onPointerDown(e) {
    // バトル中でも「説明を見る」だけは許可する（操作ではなく情報表示のため）
    if(state.scene === 'battle') {
        const bp = canvasPos(e);
        const info = unitAtPoint(bp.x, bp.y);
        if(info) showUnitInfo(info.key, info.isP, bp.x, bp.y);
        else hideUnitInfo();
        return;
    }

    if(state.scene !== 'prep') return;
    const p = canvasPos(e);
    const lay = layout();
    hideUnitInfo();

    // 敵ユニットをタップしたら説明を表示する（配置・売却の対象にはしない）
    if(!state.selected) {
        const foe = unitAtPoint(p.x, p.y);
        if(foe) { showUnitInfo(foe.key, foe.isP, p.x, p.y); return; }
    }

    // ユニット選択中 → 配置
    if(state.selected) {
        const cost = unitBuyCost(state.selected);
        if(p.y < lay.deployTop || p.y > lay.deployBottom) {
            toast('緑色の配置エリア内をタップしてください');
            return;
        }
        if(state.gold < cost) { toast('ゴールドが足りません'); state.selected = null; updatePrepUI(); return; }
        const cap = maxUnitsFor(state.mode);
        if(state.roster.length >= cap) { toast(`配置できるのは ${cap} 体までです`); return; }

        pushUndo();
        state.gold -= cost;
        state.roster.push({
            id: state.nextId++,
            key: state.selected,
            x: clamp(p.x, 16, state.w - 16),
            y: clamp(p.y, lay.deployTop, lay.deployBottom),
            boughtRound: state.round // このラウンド購入分だけ売却可能にするための記録
        });
        if(state.gold < cost) state.selected = null; // もう買えないなら選択解除
        renderShop();
        saveGame();
        return;
    }

    // 配置済みユニットを掴む（ドラッグで移動 / タップで売却）
    const hit = rosterAt(p.x, p.y);
    if(hit) {
        state.drag = { entry: hit, moved: false, startX: p.x, startY: p.y };
        canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    }
}

function onPointerMove(e) {
    if(state.scene !== 'prep' || !state.drag) return;
    const p = canvasPos(e);
    const lay = layout();
    if(Math.hypot(p.x - state.drag.startX, p.y - state.drag.startY) > 6) state.drag.moved = true;
    if(state.drag.moved) {
        state.drag.entry.x = clamp(p.x, 16, state.w - 16);
        state.drag.entry.y = clamp(p.y, lay.deployTop, lay.deployBottom);
    }
}

// 配置済みユニットを1体売却して全額返金する
function sellRosterEntry(entry) {
    pushUndo();
    const def = UNIT_DEFS[entry.key];
    const refund = unitBuyCost(entry.key);
    state.roster = state.roster.filter(r => r !== entry);
    state.gold += refund;
    toast(`${def.name} を売却 (+${refund}G)`);
    renderShop();
    saveGame();
}

function onPointerUp(e) {
    if(state.scene !== 'prep' || !state.drag) return;
    const d = state.drag;
    state.drag = null;

    if(!d.moved) {
        // タップだけなら即売却はせず、説明カードを開いて売却ボタンで選ばせる
        // （移動のつもりでタップした際に誤って売れてしまうのを防ぐため）
        // 売却できるのは今ラウンドに購入した分のみ（前ラウンド以前から編成に
        // いるユニットは、全回復して使い続けられる代わりに売却対象外にする）
        const p = canvasPos(e);
        const sellable = d.entry.boughtRound === state.round;
        showUnitInfo(d.entry.key, true, p.x, p.y, sellable ? d.entry : null);
    } else {
        saveGame();
    }
}

// ============================================================
// バトル進行
// ============================================================
// STORY: そのステージの雑魚とボスを、戦闘開始と同時に全員フィールドへ配置する。
// タイマーで小出しにする代わりに、奥行き(depth)に応じてY座標を散らすことで、
// 手前の敵から順に交戦が始まる自然な時間差を生む（ボスは最奥・最ノロマ）
// STORY: そのステージの雑魚の出現位置を計算する。準備フェーズの時点で
// 配置が見えるよう、ラウンド開始時(buildStoryEnemyPreview)に一度だけ
// 決めてstate.storyEnemiesへ保存し、プレビュー表示と実際の戦闘開始時の
// 配置(spawnStoryStage)の両方で同じ座標を使う（作り直すと見た目と
// 実際の配置がずれてしまうため）
function buildStoryEnemyPreview() {
    const conf = currentStoryStages()[state.round];
    const lay = layout();
    const spawnFar = 150 + topInset();       // 奥（ボスに近い側）
    const spawnNear = lay.deployTop - 20;    // 手前（配置エリアのすぐ上）
    const span = spawnNear - spawnFar;

    state.storyEnemies = [];
    conf.enemies.forEach(g => {
        for(let i = 0; i < g.count; i++) {
            const depth = clamp(g.depth + randRange(-0.06, 0.06), 0, 1);
            state.storyEnemies.push({
                key: g.type,
                x: randRange(26, state.w - 26),
                y: spawnFar + span * depth
            });
        }
    });
}

// STORY: 準備フェーズで表示していた配置(state.storyEnemies)をそのまま
// 実体化し、ボスも同時に登場させる
function spawnStoryStage(stageNum) {
    state.storyEnemies.forEach(e => {
        state.units.push(new Unit(e.key, false, e.x, e.y));
    });

    state.boss = new Boss(stageNum);
    spawnPop(state.w / 2, 150 + topInset() + 20, state.boss.data.name + ' 出現！', '#f59e0b');
    addShake(6);
    updateHud();
}

function updateProjectiles(dt) {
    state.projs.forEach(p => {
        if(!p.active) return;
        const t = p.target;
        // 対象が消えた場合は着弾扱いにする
        if(!t || t.hp <= 0) { p.active = false; return; }

        const dx = t.x - p.x, dy = (t.y - 12) - p.y;
        const d = Math.hypot(dx, dy);
        if(d < 9) {
            p.active = false;
            if(p.def.type === 'aoe') {
                state.units.forEach(u => {
                    if(u.isP !== p.isP && Math.hypot(u.x - p.x, u.y - p.y) < p.def.splash) {
                        u.takeDmg(p.dmg, p.owner);
                        // ノックバックはp.def.kbを持つ場合のみ(近接と同じmass基準の式に統一)。
                        // 遠距離・範囲ユニットはkb:0なので、ここで固定値を足すと
                        // 「ノックバックなし」の設定を無視してしまうバグになっていた
                        if(p.def.kb && u.vx !== undefined) {
                            const a = Math.atan2(u.y - p.y, u.x - p.x);
                            const k = Math.min(KNOCKBACK_CAP, (p.def.kb / (u.def && u.def.mass ? u.def.mass : 2)) * KNOCKBACK_MULT);
                            u.vx += Math.cos(a) * k;
                            u.vy += Math.sin(a) * k;
                        }
                    }
                });
                if(p.isP && state.boss && Math.hypot(state.boss.x - p.x, state.boss.y - p.y) < p.def.splash) {
                    state.boss.takeDmg(p.dmg, p.owner);
                }
                const foeBase = p.isP ? state.enemyBase : state.playerBase;
                if(foeBase && Math.hypot(foeBase.x - p.x, foeBase.y - p.y) < p.def.splash) {
                    foeBase.takeDmg(p.dmg, p.owner);
                }
                for(let i = 0; i < 8; i++) {
                    const a = (Math.PI * 2 / 8) * i;
                    state.fx.push({ x:p.x, y:p.y, vx:Math.cos(a)*2.5, vy:Math.sin(a)*2.5, life:18, color:'#f59e0b' });
                }
                addShake(2);
            } else {
                t.takeDmg(p.dmg, p.owner);
                // スケルトンの矢が命中した相手を一定時間鈍足にする（拠点・ボスは対象外）
                if(p.def.slowDuration && !t.isBase && t.slowTimer !== undefined) {
                    t.slowTimer = Math.max(t.slowTimer, p.def.slowDuration);
                }
            }
        } else {
            const sp = 7 * dt;
            p.x += (dx / d) * sp;
            p.y += (dy / d) * sp;
        }
    });
    state.projs = state.projs.filter(p => p.active);
}

function updateFx(dt) {
    if(state.shake > 0.1) state.shake *= 0.88; else state.shake = 0;

    state.popups.forEach(p => { p.rise += dt; p.life -= 0.018 * dt; });
    state.popups = state.popups.filter(p => p.life > 0);

    state.fx.forEach(f => {
        if(f.type === 'laser' || f.type === 'heal') { f.life -= dt; return; }
        if(f.type === 'lifeshot') {
            // 破壊された拠点から体力ゲージへ向かう弾（緩やかに加速させる）
            f.t = Math.min(1, f.t + dt / f.dur);
            const e = f.t * f.t;
            f.x = f.x0 + (f.tx - f.x0) * e;
            f.y = f.y0 + (f.ty - f.y0) * e;
            f.trail.push({ x: f.x, y: f.y });
            if(f.trail.length > 10) f.trail.shift();
            if(f.t >= 1) f.life = 0;
            return;
        }
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.vy += 0.06 * dt;
        f.life -= dt;
    });
    state.fx = state.fx.filter(f => f.life > 0);
}

// バトル 1 フレーム分の更新
function updateBattle(dt) {
    updateTactics(dt);
    if(state.timeWarp > 0) state.timeWarp -= dt;

    state.units.forEach(u => {
        u.update(dt);
        if(u.lifetime > 0) {
            u.lifetime -= dt;
            if(u.lifetime <= 0) { u.hp = 0; onUnitDeath(u); }
        }
    });

    if(state.boss) state.boss.update(dt);
    updateProjectiles(dt);
    updateFx(dt);

    state.playerBase.update(dt);
    if(state.enemyBase) state.enemyBase.update(dt);
    updateSiegeCollapse(dt);

    // 拠点の自動修復
    if(baseRegen() > 0) state.playerBase.heal(baseRegen() / 60 * dt);

    // 死亡したユニットを取り除く（編成同期のため実体は残さない）
    state.units = state.units.filter(u => u.hp > 0);

    state.battleTimer -= dt;
    checkBattleEnd();
}

// 防衛ユニットが 1 体もいなくなった拠点は、そのまま守り切れないのが自明なので
// 通常のちまちました削り合いを待たず一気に崩壊させる
// （1 体だけ生き残った状態で拠点を延々つつく間延びを避けるため）。
function updateSiegeCollapse(dt) {
    if(!isVsMode()) return;

    const enemyDefenders = state.units.some(u => !u.isP);
    // 守護天使などの召喚系戦術がクールダウン待ちで一時的に不在なだけの場合は
    // 「防衛ユニットが全滅した」扱いにしない（すぐ復帰する見込みがあるため）
    const playerDefenders = state.units.some(u => u.isP) || hasPendingSummon();
    const collapseFrames = 90; // 約1.5秒で陥落する速度

    if(!enemyDefenders && playerDefenders && state.enemyBase && state.enemyBase.hp > 0) {
        if(!state.enemySiege) {
            state.enemySiege = true;
            spawnPop(state.enemyBase.x, state.enemyBase.y - 10, '防衛崩壊！', '#f87171');
            addShake(4);
        }
        state.enemyBase.hp = Math.max(0, state.enemyBase.hp - (state.enemyBase.maxHp / collapseFrames) * dt);
    } else if(enemyDefenders) {
        state.enemySiege = false;
    }

    if(!playerDefenders && enemyDefenders && state.playerBase.hp > 0) {
        if(!state.playerSiege) {
            state.playerSiege = true;
            spawnPop(state.playerBase.x, state.playerBase.y - 10, '防衛崩壊！', '#f87171');
            addShake(4);
        }
        state.playerBase.hp = Math.max(0, state.playerBase.hp - (state.playerBase.maxHp / collapseFrames) * dt);
    } else if(playerDefenders) {
        state.playerSiege = false;
    }
}

// 味方が全滅しても、召喚系の戦術が残っていれば盤面はまだ動く
function hasPendingSummon() {
    return Object.keys(state.tactics).some(k => TACTIC_DEFS[k] && TACTIC_DEFS[k].summons);
}

function checkBattleEnd() {
    if(state.scene !== 'battle') return;

    if(state.playerBase.hp <= 0) { endBattle(false, '自拠点が破壊された'); return; }

    const alliesAlive = state.units.some(u => u.isP);
    const foesAlive = state.units.some(u => !u.isP) || !!state.boss;

    if(state.mode === 'story') {
        if(state.bossCleared) {
            // 撃破直後の余韻演出(紙吹雪など)が終わるまで結果画面への切り替えを少し待つ
            if(state.bossClearDelay > 0) { state.bossClearDelay--; return; }
            endBattle(true);
            return;
        }

        // 味方が全滅し、召喚の見込みもない場合は勝ち目が無いので即敗北にする
        // （拠点だけが残って延々と削られるのを待たせない）
        if(!alliesAlive && !hasPendingSummon()) {
            endBattle(false, '味方が全滅した');
            return;
        }
        if(state.battleTimer <= 0) { endBattle(false, '制限時間内に討伐できなかった'); return; }
    } else {
        if(!state.enemyBase) return;
        if(state.enemyBase.hp <= 0) { endBattle(true); return; }

        // 相打ちで両軍が全滅した場合、以降は誰も拠点を攻撃できないので
        // 時間切れを待たずにその場で判定する
        if(!alliesAlive && !foesAlive && !hasPendingSummon()) {
            judgeTimeout('wipeout');
            return;
        }
        if(state.battleTimer <= 0) {
            judgeTimeout();
            return;
        }
    }
}

// 時間切れの判定
// 1) 拠点 HP の割合が高いほうが勝ち
// 2) 同率なら生き残った戦力（コスト合計）が多いほうが勝ち
// 3) それも同じなら引き分け
// 決着がつかなかった場合の判定。
// 時間切れと「相打ちで両軍全滅」の両方から呼ばれるため、
// 理由の文言だけ切り替えられるようにしている。
function judgeTimeout(cause) {
    const label = (cause === 'wipeout') ? '相打ち' : '時間切れ';
    const mine = state.playerBase.hp / state.playerBase.maxHp;
    const foe = state.enemyBase.hp / state.enemyBase.maxHp;

    if(Math.abs(mine - foe) > 0.001) {
        if(mine > foe) endBattle(true, `${label}（拠点HP判定で勝利）`);
        else endBattle(false, `${label}（拠点HP判定で敗北）`);
        return;
    }

    const tally = collectBattleResult();
    if(tally.playerValue !== tally.enemyValue) {
        const win = tally.playerValue > tally.enemyValue;
        endBattle(win, win ? `${label}（残存戦力で勝利）` : `${label}（残存戦力で敗北）`);
        return;
    }

    endBattle(null, `${label}（引き分け）`);
}

// ============================================================
// 画面上部の情報表示
// ============================================================
function updateHud() {
    const left = document.getElementById('hud-left');
    const boss = document.getElementById('hud-boss');
    const right = document.getElementById('hud-right');

    const diff = AI_PRESETS[state.difficulty].label;
    if(state.mode === 'story') {
        left.textContent = `STORY${state.storyExtra ? ' EXTRA' : ''}  STAGE ${state.round}/${STORY_LAST_WAVE}`;
    } else if(state.mode === 'survival') {
        left.textContent = `SURVIVAL  STAGE ${state.round}/${SURVIVAL_STAGES}  ${diff}`;
    } else {
        left.textContent = `VERSUS  R${state.round}  ${diff}`;
    }

    if(state.boss) {
        boss.style.display = '';
        boss.textContent = state.boss.data.name;
    } else {
        boss.style.display = 'none';
    }

    if(state.scene === 'battle') {
        right.style.display = '';
        right.textContent = Math.max(0, Math.ceil(state.battleTimer / 60)) + 's';
    } else {
        right.style.display = 'none';
    }
}

function updateBattlePanel() {
    const mine = state.units.filter(u => u.isP).length;
    const foe = state.units.filter(u => !u.isP).length + (state.boss ? 1 : 0);
    document.getElementById('bs-allies').textContent = mine;
    document.getElementById('bs-enemies').textContent = foe;
    document.getElementById('bs-kills').textContent = state.kills;
    document.getElementById('bs-time').textContent = Math.max(0, Math.ceil(state.battleTimer / 60)) + 's';
    updateTacticHud();
}

// 戦術のクールダウンをフィールド左下にチップで表示する
function updateTacticHud() {
    const box = document.getElementById('tactic-hud');
    const keys = Object.keys(state.tactics);

    if(keys.length === 0 || state.scene !== 'battle') {
        box.classList.remove('show');
        return;
    }
    box.classList.add('show');

    if(box.children.length !== keys.length) {
        box.innerHTML = keys.map(k => `
            <div class="t-chip" data-t="${k}">
                <span class="t-ico">${TACTIC_DEFS[k].icon}</span>
                <span class="t-bar"><span class="t-fill"></span></span>
                <span class="t-sec">--</span>
            </div>`).join('');
    }

    keys.forEach(k => {
        const chip = box.querySelector(`.t-chip[data-t="${k}"]`);
        if(!chip) return;
        const total = TACTIC_DEFS[k].cd * 60;
        const left = Math.max(0, state.tacticTimers[k] || 0);
        const sec = Math.ceil(left / 60);
        chip.querySelector('.t-fill').style.width = Math.round((1 - left / total) * 100) + '%';
        chip.querySelector('.t-sec').textContent = sec <= 0 ? 'NOW' : sec + 's';
        chip.classList.toggle('ready', left <= total * 0.12);
    });
}

// 戦術が発動したときにチップを光らせる
function flashTacticChip(key) {
    const chip = document.querySelector(`#tactic-hud .t-chip[data-t="${key}"]`);
    if(!chip) return;
    chip.classList.remove('fired');
    void chip.offsetWidth; // アニメーションを再生させるための再描画
    chip.classList.add('fired');
}

function setSpeed(v) {
    state.speed = v;
    document.querySelectorAll('.speed-btn').forEach(b => {
        b.classList.toggle('active', Number(b.dataset.speed) === v);
    });
}

// ============================================================
// 描画
// ============================================================
function draw() {
    const sx = state.shake ? randRange(-state.shake, state.shake) : 0;
    const sy = state.shake ? randRange(-state.shake, state.shake) : 0;

    ctx.save();
    ctx.translate(sx, sy);

    // 背景（上＝敵陣、下＝自陣）
    const g = ctx.createLinearGradient(0, 0, 0, state.h);
    g.addColorStop(0, '#3b1220');
    g.addColorStop(0.42, '#1e293b');
    g.addColorStop(0.58, '#1e293b');
    g.addColorStop(1, '#0b2d24');
    ctx.fillStyle = g;
    ctx.fillRect(-10, -10, state.w + 20, state.h + 20);

    // グリッド
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for(let x = 0; x < state.w; x += 39) { ctx.moveTo(x, 0); ctx.lineTo(x, state.h); }
    for(let y = 0; y < state.h; y += 39) { ctx.moveTo(0, y); ctx.lineTo(state.w, y); }
    ctx.stroke();

    // 中央ライン
    ctx.strokeStyle = 'rgba(148,163,184,0.18)';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, state.h / 2);
    ctx.lineTo(state.w, state.h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const lay = layout();

    // 準備フェーズ：配置エリアの表示
    if(state.scene === 'prep') {
        ctx.fillStyle = state.selected ? 'rgba(16,185,129,0.14)' : 'rgba(16,185,129,0.07)';
        ctx.fillRect(0, lay.deployTop, state.w, lay.deployBottom - lay.deployTop);
        ctx.strokeStyle = 'rgba(16,185,129,0.55)';
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(0, lay.deployTop);
        ctx.lineTo(state.w, lay.deployTop);
        ctx.moveTo(0, lay.deployBottom);
        ctx.lineTo(state.w, lay.deployBottom);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(16,185,129,0.7)';
        ctx.font = '700 9px Futura, sans-serif';
        ctx.fillText('DEPLOY AREA', 8, lay.deployTop + 12);
    }

    // 拠点
    if(state.enemyBase) state.enemyBase.draw(ctx);
    if(state.playerBase) state.playerBase.draw(ctx);

    // エフェクト（下層）
    state.fx.forEach(f => {
        if(f.type === 'laser') {
            ctx.strokeStyle = f.color;
            ctx.globalAlpha = clamp(f.life / 22, 0, 1);
            ctx.lineWidth = f.width || 10;
            ctx.beginPath();
            ctx.moveTo(f.x1, f.y1);
            ctx.lineTo(f.x2, f.y2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    });

    // 準備フェーズは編成データをそのまま描画（プレビュー）
    if(state.scene === 'prep') {
        drawRosterPreview();
    } else {
        if(state.boss) state.boss.draw(ctx);
        state.units.slice().sort((a, b) => a.y - b.y).forEach(u => u.draw(ctx));
    }

    // 弾
    state.projs.forEach(p => {
        if(p.def.type === 'aoe') {
            ctx.fillStyle = '#f59e0b';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(251,191,36,0.6)';
            ctx.lineWidth = 2;
            ctx.stroke();
        } else {
            ctx.fillStyle = p.isP ? '#e2e8f0' : '#fca5a5';
            ctx.fillRect(p.x - 1.5, p.y - 4, 3, 8);
        }
    });

    // エフェクト（上層）
    state.fx.forEach(f => {
        if(f.type === 'laser') return;

        // 拠点 → 体力ゲージへ飛ぶ衝撃弾（尾を引かせて視線を誘導する）
        if(f.type === 'lifeshot') {
            f.trail.forEach((pt, i) => {
                ctx.globalAlpha = (i / f.trail.length) * 0.5;
                ctx.fillStyle = f.color;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 2 + i * 0.35, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(f.x, f.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = f.color;
            ctx.lineWidth = 3;
            ctx.stroke();
            return;
        }

        ctx.globalAlpha = clamp(f.life / 26, 0, 1);
        if(f.type === 'heal') {
            ctx.strokeStyle = f.color;
            ctx.lineWidth = 3;
            const s = 6;
            ctx.beginPath();
            ctx.moveTo(f.x - s, f.y); ctx.lineTo(f.x + s, f.y);
            ctx.moveTo(f.x, f.y - s); ctx.lineTo(f.x, f.y + s);
            ctx.stroke();
        } else {
            ctx.fillStyle = f.color;
            ctx.beginPath();
            ctx.arc(f.x, f.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    });

    // ダメージ表示
    ctx.textAlign = 'center';
    ctx.font = '900 13px Futura, sans-serif';
    ctx.lineWidth = 3;
    state.popups.forEach(p => {
        ctx.globalAlpha = clamp(p.life, 0, 1);
        ctx.strokeStyle = 'rgba(2,6,23,0.9)';
        ctx.strokeText(p.text, p.x, p.y - p.rise * 0.5);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y - p.rise * 0.5);
        ctx.globalAlpha = 1;
    });
    ctx.textAlign = 'left';

    // タイムワープ中の演出
    if(state.timeWarp > 0) {
        ctx.fillStyle = 'rgba(96,165,250,0.14)';
        ctx.fillRect(0, 0, state.w, state.h);
    }

    ctx.restore();
}

// 準備フェーズのユニット表示（実体を作らずに編成データから描く）
function drawRosterPreview() {
    const t = performance.now() / 400;
    const all = state.roster.map(r => ({ r, isP: true }))
        .concat(state.aiRoster.map(r => ({ r, isP: false })))
        .concat(state.mode === 'story' ? state.storyEnemies.map((r, i) => ({ r: { ...r, id: i }, isP: false })) : []);
    all.sort((a, b) => a.r.y - b.r.y);

    all.forEach(({ r, isP }) => {
        const def = UNIT_DEFS[r.key];
        const scale = unitScale(r.key);
        const bounce = Math.abs(Math.sin(t + r.id)) * 2;
        drawShadow(ctx, def.sprite, r.x, r.y, scale, 0.35);
        ctx.strokeStyle = isP ? 'rgba(16,185,129,0.75)' : 'rgba(239,68,68,0.75)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, scale * 5, scale * 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        drawSprite(ctx, def.sprite, isP ? def.pal : (ENEMY_PALETTES[r.key] || def.pal),
            r.x, r.y - bounce, scale, { flipX: !isP });

        // ドラッグ中のユニットを強調
        if(state.drag && state.drag.entry === r) {
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(r.x, r.y, scale * 6, scale * 2.6, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
    });

    // STORY: ボスも準備フェーズの時点で見えるようにする
    if(state.mode === 'story') drawStoryBossPreview(t);
}

// STORY: 準備フェーズでのボスのプレビュー表示（実際の出現位置・見た目と一致させる）
function drawStoryBossPreview(t) {
    const data = currentBossDefs()[state.round];
    if(!data) return;
    const x = state.w / 2, y = 130 + topInset();
    const sprite = data.sprite.idle || data.sprite;
    const scale = 3.5;
    const bounce = Math.abs(Math.sin(t)) * 4;

    drawShadow(ctx, sprite, x, y, scale, 0.45);
    ctx.strokeStyle = 'rgba(239,68,68,0.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x, y, scale * 5, scale * 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    drawSprite(ctx, sprite, data.palette, x, y - bounce, scale, {});

    ctx.fillStyle = 'rgba(245,158,11,0.9)';
    ctx.font = '700 10px Futura, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(data.name, x, y - scale * 14);
    ctx.textAlign = 'left';
}

// ============================================================
// 一時停止
// ============================================================
function openPauseModal() {
    if(state.scene !== 'battle') return;
    state.paused = true;
    document.getElementById('pause-modal').classList.add('show');
}

function closePauseModal() {
    document.getElementById('pause-modal').classList.remove('show');
}

function resumeBattle() {
    state.paused = false;
    closePauseModal();
}

// ============================================================
// あそびかた
// ============================================================
function openHowto() { document.getElementById('howto-sheet').classList.add('show'); }
function closeHowto() { document.getElementById('howto-sheet').classList.remove('show'); }

// ============================================================
// 最新版へ更新（Service Worker のキャッシュを破棄して読み込み直す）
// ============================================================
async function forceUpdate() {
    toast('最新版を確認しています…');
    try {
        if(window.caches) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
        }
        if('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
        }
    } catch(e) {
        // キャッシュ操作に失敗しても読み込み直しは行う
    }
    // クエリを付けて確実にサーバから取り直す
    location.replace(location.pathname + '?u=' + Date.now());
}

// ============================================================
// タイトル画面のドット絵アート（プレイヤーユニットを並べて表示）
// ============================================================
function drawTitleArt() {
    const c = document.getElementById('title-art');
    if(!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(200, Math.round(rect.width));
    const h = Math.round(rect.height) || 96;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const cast = ['giant', 'knight', 'archer', 'wizard', 'healer'];
    const t = performance.now() / 400;
    const step = w / (cast.length + 1);

    cast.forEach((key, i) => {
        const def = UNIT_DEFS[key];
        const scale = unitScale(key);
        const x = step * (i + 1);
        const y = h - 10;
        const bounce = Math.abs(Math.sin(t + i * 0.7)) * 3;
        drawShadow(g, def.sprite, x, y, scale, 0.3);
        drawSprite(g, def.sprite, def.pal, x, y - bounce, scale, {});
    });
}

// ============================================================
// メインループ
// ============================================================
let hudTick = 0;

function loop() {
    if(state.scene === 'battle' && !state.paused) {
        if(state.hitstop > 0) {
            // 演出用の一時停止中はロジックを進めず、シェイクや粒子だけ動かす
            state.hitstop--;
            updateFx(1);
        } else {
            for(let i = 0; i < state.speed; i++) {
                if(state.scene !== 'battle') break;
                updateBattle(1);
            }
        }
        if(++hudTick % 6 === 0) { updateHud(); updateBattlePanel(); }
    } else {
        updateFx(1);
    }

    if(state.scene === 'title') drawTitleArt();
    draw();
    requestAnimationFrame(loop);
}

// ============================================================
// 初期化
// ============================================================
// ワールド座標(state.w/state.h)を実画面より大きく取り、描画だけ均一に
// 縮小してぴったり収める。拠点間の距離が伸びる一方でスクロールは発生せず、
// 当たり判定・移動・ポインタ入力は全てこの広いワールド座標のまま行われる
// ので他のロジックは変更不要。モード・シーンによって値を変えると準備
// フェーズとバトルでユニットの位置がずれて見えるため、常に同じ倍率を使う
function fieldScale() {
    return FIELD_SCALE;
}

function resize() {
    const rect = document.getElementById('stage').getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const viewW = Math.max(240, Math.round(rect.width));
    const viewH = Math.max(320, Math.round(rect.height));
    const fs = fieldScale();
    state.w = Math.round(viewW / fs);
    state.h = Math.round(viewH / fs);
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    ctx.setTransform(dpr * fs, 0, 0, dpr * fs, 0, 0);
    ctx.imageSmoothingEnabled = false;

    if(state.playerBase) state.playerBase.reposition();
    if(state.enemyBase) state.enemyBase.reposition();
    if(state.scene === 'prep') clampRosters();
}

// モード選択画面で、選択中のモードに応じた追加セクションの表示を切り替える。
// ・難易度セレクタ(EASY/NORMAL/HARD): STORYには影響しないため、STORY選択中は非表示
// ・STORY EXTRAトグル: STORYを選択中、かつ通常STORYを全クリア済みの場合のみ表示
function syncModeSelectExtras() {
    document.getElementById('diff-section').style.display =
        state.selectedMode === 'story' ? 'none' : '';
    const rec = state.records || defaultRecords();
    const extraUnlocked = state.selectedMode === 'story' && rec.story.cleared;
    document.getElementById('story-extra-section').style.display = extraUnlocked ? '' : 'none';
}

function bindEvents() {
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 120));

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', () => { state.drag = null; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // タイトル
    document.getElementById('btn-newgame').addEventListener('click', () => {
        renderRecords();
        // モード選択ボタンの見た目をstate.selectedModeに同期させる
        // （ショップタブと同種のズレ防止。前回選んだモードを覚えたまま
        // 表示だけタイトルへ戻る前の状態に取り残されないようにする）
        document.querySelectorAll('.menu-btn[data-mode]').forEach(x => {
            x.classList.toggle('selected', x.dataset.mode === state.selectedMode);
        });
        // STORY EXTRAトグルの見た目もstate.storyExtraに同期させる（同上の理由）
        document.querySelectorAll('#story-extra-row .diff-btn').forEach(x => {
            x.classList.toggle('active', (x.dataset.storyExtra === 'true') === !!state.storyExtra);
        });
        showScreen('screen-mode');
    });
    document.getElementById('btn-continue').addEventListener('click', loadGame);
    document.getElementById('btn-howto').addEventListener('click', openHowto);
    document.getElementById('btn-close-howto').addEventListener('click', closeHowto);
    document.getElementById('btn-howto-done').addEventListener('click', closeHowto);
    document.getElementById('btn-codex').addEventListener('click', openCodex);
    document.getElementById('btn-close-codex').addEventListener('click', closeCodex);
    document.getElementById('btn-codex-done').addEventListener('click', closeCodex);
    document.getElementById('codex-sheet').addEventListener('click', e => {
        if(e.target.id === 'codex-sheet') closeCodex();
    });
    // 説明ポップアップ自体をタップしたら閉じる
    document.getElementById('unit-info').addEventListener('click', hideUnitInfo);
    document.getElementById('btn-update').addEventListener('click', forceUpdate);
    document.getElementById('btn-clear-records').addEventListener('click', onClearRecordsClick);

    // モード選択（難易度と同じく「選択してからSTART」方式。誤タップで
    // 即開始してしまわないように、モードボタンは選択のみを行う）
    document.querySelectorAll('.menu-btn[data-mode]').forEach(b => {
        b.addEventListener('click', () => {
            state.selectedMode = b.dataset.mode;
            document.querySelectorAll('.menu-btn[data-mode]').forEach(x => x.classList.toggle('selected', x === b));
            syncModeSelectExtras();
        });
    });
    document.getElementById('btn-mode-start').addEventListener('click', () => startNewGame(state.selectedMode || 'story'));
    document.getElementById('btn-mode-back').addEventListener('click', backToTitle);
    document.getElementById('btn-home').addEventListener('click', backToTitle);
    document.querySelectorAll('#diff-row .diff-btn').forEach(b => {
        b.addEventListener('click', () => {
            state.difficulty = b.dataset.diff;
            document.querySelectorAll('#diff-row .diff-btn').forEach(x => x.classList.toggle('active', x === b));
            toast(`難易度: ${AI_PRESETS[state.difficulty].label} — ${AI_PRESETS[state.difficulty].desc}`);
        });
    });
    // STORY EXTRA（通常STORY全クリア後のみ表示される高難度周回）の切り替え
    document.querySelectorAll('#story-extra-row .diff-btn').forEach(b => {
        b.addEventListener('click', () => {
            state.storyExtra = b.dataset.storyExtra === 'true';
            document.querySelectorAll('#story-extra-row .diff-btn').forEach(x => x.classList.toggle('active', x === b));
            toast(state.storyExtra
                ? 'STORY EXTRA — 固定ウェーブがすべて強化された高難度版'
                : '通常のSTORY');
        });
    });

    // 準備フェーズ（ショップはボトムシート）
    document.getElementById('btn-open-shop').addEventListener('click', openShop);
    document.getElementById('btn-close-shop').addEventListener('click', closeShop);
    document.getElementById('btn-sheet-done').addEventListener('click', closeShop);
    document.getElementById('tab-units').addEventListener('click', () => setTab('units'));
    document.getElementById('tab-upgrades').addEventListener('click', () => setTab('upgrades'));
    document.getElementById('tab-tactics').addEventListener('click', () => setTab('tactics'));
    document.getElementById('btn-undo').addEventListener('click', undoLastAction);
    document.getElementById('btn-undo-shop').addEventListener('click', undoLastAction);
    document.getElementById('btn-start-battle').addEventListener('click', startBattle);

    // 背景をタップしてシートを閉じる
    document.getElementById('shop-sheet').addEventListener('click', e => {
        if(e.target.id === 'shop-sheet') closeShop();
    });
    document.getElementById('howto-sheet').addEventListener('click', e => {
        if(e.target.id === 'howto-sheet') closeHowto();
    });

    // バトル中
    document.getElementById('btn-pause').addEventListener('click', openPauseModal);
    document.getElementById('btn-resume').addEventListener('click', resumeBattle);
    document.getElementById('btn-pause-retry').addEventListener('click', () => {
        closePauseModal();
        state.paused = false;
        retryRound();
    });
    document.getElementById('btn-pause-title').addEventListener('click', backToTitle);
    document.querySelectorAll('.speed-btn').forEach(b => {
        b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));
    });

    // 結果画面
    document.getElementById('btn-result-next').addEventListener('click', enterPrep);
    document.getElementById('btn-result-retry').addEventListener('click', retryRound);
    document.getElementById('btn-result-title').addEventListener('click', backToTitle);
}

function init() {
    state.records = loadRecords();
    resize();
    bindEvents();
    renderRecords();
    document.getElementById('btn-continue').style.display = hasSave() ? '' : 'none';
    showScreen('screen-title');
    requestAnimationFrame(loop);

    // PWA: Service Worker 登録（オフライン起動用）
    if('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch(() => { /* 失敗しても動作に影響なし */ });
        });
    }
}

init();
