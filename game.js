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
    mode: 'story',            // story（ステージ） / survival（無限） / versus（体力制対戦）
    difficulty: 'normal',     // AI 対戦モードの難易度
    round: 1,                 // ウェーブ番号 / ラウンド番号
    gold: 0,                  // 残予算

    roster: [],               // プレイヤー編成 [{id, key, x, y}]
    aiRoster: [],             // AI 編成 [{id, key, x, y}]
    aiGold: 0,                // AI の残予算（繰り越し用）
    aiPower: 1,               // AI が余剰予算で得た編成強化倍率
    nextId: 1,

    units: [],                // バトル中のユニット実体
    projs: [], fx: [], popups: [],
    boss: null,
    playerBase: null,
    enemyBase: null,

    upgrades: {},             // 購入済みの強化 {key: 個数}
    unitLevels: {},           // ユニット種別ごとのレベル {key: レベル}
    tactics: {},              // 購入済みの戦術 {key: true}
    tacticTimers: {},         // 戦術のクールダウン残り（フレーム）

    shopTab: 'units',         // ショップの表示タブ
    selected: null,           // 選択中のショップユニット
    drag: null,               // ドラッグ中の配置ユニット
    undoStack: [],            // このラウンドの購入/売却操作の履歴（ひとつ戻す用）

    spawnQueue: [],           // 未出現の敵集団（ステージモード）
    spawnTimer: 0,
    bossDelay: -1,            // ボス出現までのカウントダウン
    bossCleared: false,

    battleTimer: 0,           // 残り時間（フレーム）
    speed: 1,                 // 観戦速度倍率
    paused: false,            // バトルの一時停止
    timeWarp: 0,              // タイムワープ残り（フレーム）
    shake: 0,
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
const atkMult     = () => Math.pow(1.08, upCount('atk_boost'));
const hpMult      = () => Math.pow(1.10, upCount('hp_boost'));
const rateMult    = () => Math.pow(0.94, upCount('atk_speed'));
const moveMult    = () => Math.pow(1.10, upCount('speed_boost'));
const rangeMult   = () => Math.pow(1.08, upCount('range_ext'));
const baseBonusHp = () => 250 * upCount('fortified');
const baseRegen   = () => 5 * upCount('regen');
const thornsRate  = () => Math.min(0.75, 0.15 * upCount('thorns'));
const vampireRate = () => Math.min(0.5, 0.06 * upCount('vampire'));

// ユニット個別レベル（キーごとの購入回数）
const unitLevel     = k => (state.unitLevels && state.unitLevels[k]) || 0;
const unitLevelMult = k => Math.pow(1 + UNIT_LEVEL_STAT_GAIN, unitLevel(k));

// AI 対戦モードで敵ユニットに掛かる強化倍率
// （ラウンド進行によるスケーリング + AI が余剰予算を注ぎ込んだ分）
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
// VERSUS モードは画面上部に体力ゲージを表示するため、その高さぶん敵陣を下げる
function topInset() {
    return state.mode === 'versus' ? 34 : 0;
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
        spawnPop(this.x + randRange(-14, 14), this.y - 10, Math.floor(v), '#ef4444');

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
            if(u.isP === this.isP || u.hp <= 0) continue;
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

        // プレイヤー側のみ強化・ユニット個別レベルの効果を受ける
        const ep = isP ? 1 : enemyPowerMult();
        const lm = isP ? unitLevelMult(key) : 1;
        const am = (isP ? atkMult() : ep) * lm;
        const hm = (isP ? hpMult() : ep) * lm;
        const rm = isP ? rateMult() : 1;
        const sm = isP ? moveMult() : 1;
        const gm = isP ? rangeMult() : 1;

        this.max = Math.round(this.def.hp * hm);
        this.hp = this.max;
        this.dmg = this.def.dmg * am;
        this.rate = this.def.rate * rm;
        this.speed = this.def.speed * sm;
        this.range = this.def.range * (this.def.type === 'ranged' || this.def.type === 'aoe' || this.def.type === 'healer' ? gm : 1);
        this.scale = unitScale(key);

        this.cd = Math.random() * 10;
        this.vx = 0; this.vy = 0;
        this.anim = Math.random() * 10;
        this.flash = 0;
        this.lifetime = o.lifetime || 0;    // 0 なら寿命なし
        this.pal = isP ? this.def.pal : (ENEMY_PALETTES[key] || this.def.pal);
        this.radius = 7;
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
            if(u.isP === this.isP || u.hp <= 0) continue;
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
        if((!best || bd > 210) && foeBase && foeBase.hp > 0) return foeBase;
        return best;
    }

    update(dt) {
        if(this.flash > 0) this.flash--;
        if(this.cd > 0) this.cd -= dt;
        this.anim += dt * 0.15;

        // ノックバックの慣性
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.vx *= 0.85;
        this.vy *= 0.85;

        // タイムワープ中は敵の移動速度が半減する
        let spd = this.speed;
        if(!this.isP && state.timeWarp > 0) spd *= 0.5;

        const target = this.findTarget();

        if(target) {
            const d = dist(target, this);
            const reach = this.range + (target.radius || 0);

            if(d <= reach) {
                if(this.cd <= 0) {
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

        if(this.def.type === 'ranged' || this.def.type === 'aoe') {
            state.projs.push({
                x: this.x, y: this.y - 14,
                target: t, dmg: this.dmg, def: this.def,
                isP: this.isP, owner: this, active: true
            });
        } else {
            t.takeDmg(this.dmg, this);
            // ノックバック（「壁の外まで吹き飛ぶ」ことがないよう、
            // 一撃あたりの勢いに上限を設けて「軽く後ずさる」程度に抑える）
            if(t.vx !== undefined) {
                const a = Math.atan2(t.y - this.y, t.x - this.x);
                const k = Math.min(KNOCKBACK_CAP, (this.def.kb / (t.def && t.def.mass ? t.def.mass : 2)) * KNOCKBACK_MULT);
                t.vx += Math.cos(a) * k;
                t.vy += Math.sin(a) * k;
            }

            // 薙ぎ払い（オークなど）: 主目標の周囲にいる敵にも波及ダメージ
            if(this.def.meleeSplash) {
                const splashDmg = this.dmg * (this.def.meleeSplashRate || 0.6);
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
        this.hp -= v;
        this.flash = 6;
        spawnPop(this.x, this.y - 22, Math.floor(v), '#ffffff');

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
        this.data = BOSS_DEFS[waveNum];
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
        this.corpses = [];
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
            const ratio = this.hp / this.maxHp;
            for(let i = this.data.phases.length - 1; i >= 0; i--) {
                if(ratio <= this.data.phases[i].hpThreshold && this.phase !== i) {
                    this.phase = i;
                    this.speed = this.data.speed * this.data.phases[i].speedMult;
                    this.dmg = this.data.dmg * this.data.phases[i].damageMult;
                    spawnPop(this.x, this.y - 60, `PHASE ${i + 1}!`, '#ef4444');
                    addShake(8);
                    break;
                }
            }
        }

        // 最も近いプレイヤーユニットを狙い、いなければ拠点へ向かう
        let target = null, bd = Infinity;
        for(const u of state.units) {
            if(!u.isP) continue;
            const d = dist(u, this);
            if(d < bd) { bd = d; target = u; }
        }
        if(!target || bd > 260) target = state.playerBase;

        if(target) {
            const d = dist(target, this);
            const reach = 42 + (target.radius || 0);
            if(d <= reach) {
                if(this.cd <= 0) {
                    this.cd = 60;
                    target.takeDmg(this.dmg, this);
                    addShake(5);
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

            case 'laser':
                if(this.specialTimer > d.laserInterval) {
                    this.specialTimer = 0;
                    const b = state.playerBase;
                    state.units.filter(u => u.isP && Math.abs(u.x - b.x) < 34)
                        .forEach(u => u.takeDmg(d.laserDamage, this));
                    b.takeDmg(d.laserDamage, this);
                    state.fx.push({ type:'laser', x1:this.x, y1:this.y - 18, x2:b.x, y2:b.y, life:22, color:'#60a5fa' });
                    spawnPop(this.x, this.y - 60, 'LASER!', '#60a5fa');
                    addShake(10);
                }
                break;
        }
    }

    takeDmg(v, attacker) {
        if(this.hp <= 0) return;
        if(this.special === 'armor') {
            v *= this.data.armorReduction;
            if(Math.random() < 0.25) spawnPop(this.x, this.y - 50, 'ARMOR!', '#d4d4d8');
        }
        this.hp -= v;
        this.flash = 6;
        spawnPop(this.x + randRange(-10, 10), this.y - 46, Math.floor(v), '#ffffff');

        if(attacker && attacker.isP && !attacker.isBase && vampireRate() > 0 && attacker.hp !== undefined) {
            attacker.hp = Math.min(attacker.max, attacker.hp + v * vampireRate());
        }
        applyLifesteal(attacker, v);

        if(this.hp <= 0) {
            this.hp = 0;
            state.kills++;
            for(let i = 0; i < 24; i++) {
                state.fx.push({ x:this.x, y:this.y - 24, vx:randRange(-4,4), vy:randRange(-5,1), life:40, color:'#fbbf24' });
            }
            addShake(14);
            state.boss = null;
            state.bossCleared = true;
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
    const strength = preset.counterStrength || 0;

    // 1 ラウンド目や EASY は対策しない
    if(strength <= 0 || roster.length === 0) {
        state.aiNote = '';
        return base;
    }

    const comp = analyzeRoster(roster);
    const notes = [];
    const boosts = {};

    AI_COUNTER_RULES.forEach(rule => {
        if(!rule.when(comp)) return;
        notes.push(rule.note);
        Object.keys(rule.boost).forEach(k => {
            // strength が小さいほど補正が穏やかになる
            const mult = 1 + (rule.boost[k] - 1) * strength;
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

// AI の編成を組む（難易度プリセット + プレイヤー編成への対策）
function buildAiRoster() {
    const preset = AI_PRESETS[state.difficulty];
    // 序盤にいきなり差がつかないよう、予算補正は数ラウンドかけて効いてくる
    const ramp = 1 + (preset.budgetMult - 1) * Math.min(1, state.round / 3);
    state.aiGold += Math.round(budgetForRound(state.round) * ramp);

    // 2 ラウンド目以降は直前のプレイヤー編成を見て刺さるユニットを選ぶ
    const pool = counteredPool(preset, state.round > 1 ? state.roster : []);
    const comp = analyzeRoster(state.roster);

    const lay = layout();
    const cap = maxUnitsFor(state.mode);
    let guard = 400;
    while(guard-- > 0 && state.aiRoster.length < cap) {
        const affordable = pool.filter(p => UNIT_DEFS[p.key].cost <= state.aiGold);
        if(affordable.length === 0) break;

        // ウェイト付き抽選
        const total = affordable.reduce((sum, p) => sum + p.w, 0);
        let r = Math.random() * total;
        let pick = affordable[affordable.length - 1];
        for(const p of affordable) { r -= p.w; if(r <= 0) { pick = p; break; } }

        state.aiGold -= UNIT_DEFS[pick.key].cost;

        // 近接・タンクは前列、遠距離・回復は後列に配置する
        const t = UNIT_DEFS[pick.key].type;
        const isFront = (t === 'melee' || t === 'tank');
        const band = lay.enemyBottom - lay.enemyTop;

        // 前衛はプレイヤーの遠距離ユニットが固まっている側へ寄せる
        let x;
        if(isFront && comp.rangedX !== null && Math.random() < 0.7) {
            x = clamp(comp.rangedX + randRange(-45, 45), 28, state.w - 28);
        } else {
            x = randRange(28, state.w - 28);
        }

        state.aiRoster.push({
            id: state.nextId++,
            key: pick.key,
            x: x,
            y: isFront
                ? randRange(lay.enemyTop + band * 0.55, lay.enemyBottom)
                : randRange(lay.enemyTop, lay.enemyTop + band * 0.45)
        });
    }

    // 配置上限に達して予算が余った場合は編成強化に回す（プレイヤーの「強化」に相当）
    const powerMax = AI_POWER_MAX[state.mode] || 2.0;
    while(state.aiGold >= AI_POWER_UNIT && state.aiPower < powerMax) {
        state.aiGold -= AI_POWER_UNIT;
        state.aiPower = Math.min(powerMax, state.aiPower + AI_POWER_GAIN);
    }
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
    state.kills = 0;
    state.speed = 1;

    // 拠点は毎ラウンド全回復した状態で始まる
    state.playerBase = new Base(true);
    state.enemyBase = isVsMode() ? new Base(false) : null;

    if(isVsMode()) buildAiRoster();
    clampRosters();

    // やり直し用のスナップショットを保存
    state.snapshot = JSON.stringify({
        round: state.round, gold: state.gold,
        roster: state.roster, aiRoster: state.aiRoster, aiGold: state.aiGold,
        aiPower: state.aiPower, playerLife: state.playerLife, aiLife: state.aiLife,
        upgrades: state.upgrades, unitLevels: state.unitLevels, tactics: state.tactics, nextId: state.nextId
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
    deployRoster();
    resetTactics();

    if(state.mode === 'story') {
        const conf = WAVE_CONFIGS[state.round];
        state.spawnQueue = conf.enemyWaves.map(w => ({
            delay: w.delay,
            enemies: w.enemies.map(e => ({ type: e.type, count: e.count }))
        }));
        state.spawnTimer = 0;
        state.bossDelay = -1;
        // 最初の集団はバトル開始と同時に配置済みにする（唐突に湧いて見えないように）
        if(state.spawnQueue.length > 0) spawnEnemyGroup(state.spawnQueue.shift());
    } else {
        state.spawnQueue = [];
    }
    state.battleTimer = BATTLE_TIME[state.mode] || 120 * 60;
    state.paused = false;

    hideUnitInfo();
    showBattleBar();
    resize();
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

    let lifeDmg = 0, matchOver = false, matchWin = false;

    if(state.mode === 'versus' && !isDraw) {
        // 負けた側が「勝った側の生き残りユニットのコスト合計」に応じたダメージを受ける
        const winnerValue = win ? tally.playerValue : tally.enemyValue;
        lifeDmg = clamp(Math.round(winnerValue * VERSUS_DMG_COEF), VERSUS_DMG_MIN, VERSUS_DMG_MAX);
        const nextPlayerLife = win ? state.playerLife : Math.max(0, state.playerLife - lifeDmg);
        const nextAiLife = win ? Math.max(0, state.aiLife - lifeDmg) : state.aiLife;

        matchOver = (nextPlayerLife <= 0 || nextAiLife <= 0);
        matchWin = (nextAiLife <= 0 && nextPlayerLife > 0);
    }

    state.result = { win, reason, isFinalStory, isDraw, tally, lifeDmg, matchOver, matchWin };

    // 次ラウンドの予算を配布
    // （VERSUS はラウンドに負けても、体力が残っていれば試合は続く）
    if(state.mode === 'versus') {
        if(!matchOver) {
            state.round++;
            state.gold += budgetForRound(state.round);
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
    } else if(state.mode === 'survival') {
        deleteSave(); // サバイバルは敗北で終了
    }

    updateRecords();

    if(state.mode === 'versus' && !isDraw) {
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
        // --- SURVIVAL: 負けたら終了 ---
        if(r.win || r.isDraw) {
            title.textContent = 'SURVIVED';
            title.className = 'result-title win';
            msg.textContent = `ラウンド ${state.round - 1} を突破！`;
            showNext = true;
        } else {
            title.textContent = 'GAME OVER';
            title.className = 'result-title lose';
            msg.textContent = `ラウンド ${state.round} で力尽きた（${r.reason || '敗北'}）`;
        }
        rows.push(['到達ラウンド', `${r.win ? state.round - 1 : state.round}`]);
        rows.push(['撃破数', `${state.kills}`]);
        rows.push(['戦力', `${state.roster.length} 体`]);
        rows.push(['拠点HP', `${baseRatio}%`]);

    } else {
        // --- STORY ---
        if(r.isFinalStory) {
            title.textContent = 'ALL CLEAR';
            title.className = 'result-title win';
            msg.textContent = '全7ステージ制覇！ 見事な采配だ。';
            showRetry = false;
        } else if(r.win || r.isDraw) {
            title.textContent = r.isDraw ? 'DRAW' : 'VICTORY';
            title.className = 'result-title win';
            msg.textContent = `WAVE ${state.round - 1} クリア！`;
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
        rows.push(['戦死したユニット', `${r.tally.playerLost} 体（編成には残ります）`]);
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
        story: { cleared: false, bestWave: 0, clearCount: 0 },
        survival: { easy: 0, normal: 0, hard: 0 },
        versus: { easy: { win: 0, lose: 0 }, normal: { win: 0, lose: 0 }, hard: { win: 0, lose: 0 } }
    };
}

function loadRecords() {
    try {
        const raw = localStorage.getItem(RECORDS_KEY);
        const base = defaultRecords();
        if(!raw) return base;
        const saved = JSON.parse(raw);
        return {
            story: Object.assign(base.story, saved.story || {}),
            survival: Object.assign(base.survival, saved.survival || {}),
            versus: Object.assign(base.versus, saved.versus || {})
        };
    } catch(e) {
        return defaultRecords();
    }
}

function saveRecords() {
    try { localStorage.setItem(RECORDS_KEY, JSON.stringify(state.records)); } catch(e) { /* 無視 */ }
}

// バトル結果を記録に反映する
function updateRecords() {
    const rec = state.records;
    const r = state.result;
    if(!rec || !r) return;

    if(state.mode === 'story') {
        const reached = r.win ? state.round : state.round;
        rec.story.bestWave = Math.max(rec.story.bestWave, Math.min(STORY_LAST_WAVE, reached));
        if(r.isFinalStory) {
            rec.story.cleared = true;
            rec.story.clearCount++;
        }
    } else if(state.mode === 'survival') {
        const reached = state.round - 1;
        rec.survival[state.difficulty] = Math.max(rec.survival[state.difficulty] || 0, Math.max(0, reached));
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

    const survBest = Math.max(rec.survival.easy || 0, rec.survival.normal || 0, rec.survival.hard || 0);
    const vsWin = ['easy', 'normal', 'hard'].reduce((n, d) => n + (rec.versus[d].win || 0), 0);

    const storyText = rec.story.cleared
        ? `<span class="crown">★ 全クリア${rec.story.clearCount > 1 ? ' ×' + rec.story.clearCount : ''}</span>`
        : (rec.story.bestWave > 0 ? `WAVE ${rec.story.bestWave} 到達` : '未プレイ');

    panel.innerHTML = `
        <div class="records-title">PLAY RECORD</div>
        <div class="rec-row"><span>STORY</span><span>${storyText}</span></div>
        <div class="rec-row"><span>SURVIVAL 最高</span><span>${survBest > 0 ? 'ROUND ' + survBest : '未プレイ'}</span></div>
        <div class="rec-row"><span>VERSUS 戦績</span><span>${vsWin > 0 ? vsWin + '勝' : '未プレイ'}</span></div>`;

    // モード選択のバッジ
    const bs = document.getElementById('badge-story');
    if(bs) bs.innerHTML = rec.story.cleared ? '★ CLEAR' : (rec.story.bestWave ? 'W' + rec.story.bestWave : '');
    const bv = document.getElementById('badge-survival');
    if(bv) bv.textContent = survBest > 0 ? 'BEST R' + survBest : '';
    const bt = document.getElementById('badge-versus');
    if(bt) bt.textContent = vsWin > 0 ? vsWin + ' WIN' : '';

    // 難易度ボタンのクリアマーク
    ['easy', 'normal', 'hard'].forEach(d => {
        const el = document.getElementById('diff-mark-' + d);
        if(!el) return;
        const marks = [];
        if(rec.versus[d].win > 0) marks.push('★' + rec.versus[d].win);
        if(rec.survival[d] > 0) marks.push('R' + rec.survival[d]);
        el.textContent = marks.join(' ');
    });
}

// ============================================================
// VERSUS モードの体力ゲージ表示
// ============================================================
function updateVersusHud() {
    const hud = document.getElementById('versus-hud');
    if(state.mode !== 'versus' || state.scene === 'title' || state.scene === 'mode') {
        hud.classList.remove('show');
        return;
    }
    hud.classList.add('show');
    document.getElementById('life-p-val').textContent = state.playerLife;
    document.getElementById('life-e-val').textContent = state.aiLife;
    document.getElementById('life-p-fill').style.width = (state.playerLife / VERSUS_LIFE * 100) + '%';
    document.getElementById('life-e-fill').style.width = (state.aiLife / VERSUS_LIFE * 100) + '%';
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
    state.playerLife = s.playerLife;
    state.aiLife = s.aiLife;
    state.upgrades = s.upgrades;
    state.unitLevels = s.unitLevels || {};
    state.tactics = s.tactics;
    state.nextId = s.nextId;

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
    state.round = 1;
    state.gold = budgetForRound(1);
    state.roster = [];
    state.aiRoster = [];
    state.aiGold = 0;
    state.aiPower = 1;
    state.aiNote = '';
    state.nextId = 1;
    state.upgrades = {};
    state.unitLevels = {};
    state.tactics = {};
    state.playerLife = VERSUS_LIFE;
    state.aiLife = VERSUS_LIFE;
    deleteSave();
    enterPrep();

    const diff = AI_PRESETS[state.difficulty].label;
    if(mode === 'story') toast('STORY モード開始');
    else if(mode === 'survival') toast(`SURVIVAL 開始（${diff}）— 配置上限なし`);
    else toast(`VERSUS 開始（${diff}）— 体力 ${VERSUS_LIFE}`);
}

function backToTitle() {
    state.scene = 'title';
    state.paused = false;
    state.units = [];
    state.projs = [];
    state.fx = [];
    state.popups = [];
    state.boss = null;
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
            mode: state.mode, difficulty: state.difficulty,
            round: state.round, gold: state.gold,
            roster: state.roster, aiRoster: state.aiRoster, aiGold: state.aiGold,
            aiPower: state.aiPower, playerLife: state.playerLife, aiLife: state.aiLife,
            upgrades: state.upgrades, unitLevels: state.unitLevels, tactics: state.tactics, nextId: state.nextId
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
        state.round = s.round;
        state.gold = s.gold;
        state.roster = s.roster || [];
        state.aiRoster = s.aiRoster || [];
        state.aiGold = s.aiGold || 0;
        state.aiPower = s.aiPower || 1;
        state.playerLife = s.playerLife === undefined ? VERSUS_LIFE : s.playerLife;
        state.aiLife = s.aiLife === undefined ? VERSUS_LIFE : s.aiLife;
        state.upgrades = s.upgrades || {};
        state.unitLevels = s.unitLevels || {};
        state.tactics = s.tactics || {};
        state.nextId = s.nextId || 1;

        // セーブ地点は準備フェーズの開始時。AI 編成は再抽選しない
        state.scene = 'prep';
        state.selected = null;
        state.undoStack = [];
        state.units = [];
        state.projs = [];
        state.fx = [];
        state.popups = [];
        state.boss = null;
        state.bossCleared = false;
        state.playerBase = new Base(true);
        state.enemyBase = isVsMode() ? new Base(false) : null;
        clampRosters();

        state.snapshot = JSON.stringify({
            round: state.round, gold: state.gold,
            roster: state.roster, aiRoster: state.aiRoster, aiGold: state.aiGold,
            upgrades: state.upgrades, unitLevels: state.unitLevels, tactics: state.tactics, nextId: state.nextId
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
function unitIconCanvas(key, enemy) {
    const def = UNIT_DEFS[key];
    const pal = enemy ? (ENEMY_PALETTES[key] || def.pal) : def.pal;
    const c = document.createElement('canvas');
    c.className = 'card-icon';
    c.width = 40; c.height = 40;
    const g = c.getContext('2d');
    const box = getSpriteBox(def.sprite);
    const s = Math.floor(Math.min(40 / box.w, 40 / box.h));
    const ox = (40 - box.w * s) / 2 - box.minC * s;
    const oy = (40 - box.h * s) / 2 - box.minR * s;
    for(let r = box.minR; r <= box.maxR; r++) {
        for(let col = box.minC; col <= box.maxC; col++) {
            const idx = def.sprite[r][col];
            if(idx > 0) {
                g.fillStyle = pal[idx];
                g.fillRect(ox + col * s, oy + r * s, s, s);
            }
        }
    }
    return c;
}

// ------------------------------------------------------------
// ユニットカードの共通生成
// ショップ / ユニット図鑑 / フィールドのタップ説明で同じ見た目を使う
// ------------------------------------------------------------
function buildUnitCard(key, opts) {
    const o = opts || {};
    const def = UNIT_DEFS[key];
    const splash = splashRadius(def);

    // レベルアップ済みなら、表示するステータスにもその分を反映する
    const lvl = o.enemy ? 0 : unitLevel(key);
    const lvlMult = Math.pow(1 + UNIT_LEVEL_STAT_GAIN, lvl);
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
            ${lvl > 0 ? `<span class="card-lv">Lv.${lvl}</span>` : ''}
            ${o.owned ? `<span class="card-own">×${o.owned}</span>` : ''}
        </div>`;
    head.appendChild(id);

    if(o.showCost) {
        const cost = document.createElement('div');
        cost.className = 'card-cost';
        cost.textContent = def.cost + 'G';
        head.appendChild(cost);
    }

    const body = document.createElement('div');
    body.innerHTML = `
        <div class="card-stats">
            <span><b>体力</b>${dispHp}</span>
            <span><b>攻撃力</b>${dispDmg < 0 ? '回復' + Math.abs(dispDmg) : dispDmg}</span>
            <span><b>攻撃間隔</b>${(def.rate / 60).toFixed(2)}秒</span>
            <span><b>移動速度</b>${Math.round(def.speed * 100)}</span>
            <span><b>射程</b>${def.range}</span>
            <span><b>範囲攻撃</b>${splash ? '半径' + splash : 'なし'}</span>
        </div>
        <div class="card-comment">${def.comment}</div>`;

    card.appendChild(head);
    card.appendChild(body);

    // ショップのユニットタブでのみ、そのユニット種のレベルアップ購入を出す
    if(o.canLevelUp) {
        const lvup = document.createElement('div');
        lvup.className = 'card-lvup';
        lvup.innerHTML = `
            <button class="lvup-btn" type="button">▲ 強化する</button>
            <span class="lvup-cost">${unitLevelCost(key, lvl)}G</span>`;
        lvup.querySelector('.lvup-btn').addEventListener('click', e => {
            e.stopPropagation();
            buyUnitLevel(key);
        });
        card.appendChild(lvup);
    }

    return card;
}

// ユニット種別レベルアップの購入
function buyUnitLevel(key) {
    const lvl = unitLevel(key);
    const cost = unitLevelCost(key, lvl);
    if(state.gold < cost) { toast('ゴールドが足りません'); return; }
    pushUndo();
    state.gold -= cost;
    state.unitLevels[key] = lvl + 1;
    toast(`${UNIT_DEFS[key].name} が Lv.${lvl + 1} に強化された`);
    renderShop();
    saveGame();
}

function renderShop() {
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
            const card = document.createElement('div');
            card.className = 'shop-card';
            card.dataset.upgrade = key;
            card.innerHTML = `
                <div class="card-head">
                    <div class="card-emoji">${def.icon}</div>
                    <div class="card-id">
                        <div class="card-name">${def.name}</div>
                        <div class="card-sub">${owned ? `<span class="card-own">Lv.${owned}</span>` : '<span class="card-type">永続</span>'}</div>
                    </div>
                    <div class="card-cost">${price}G</div>
                </div>
                <div class="card-comment" style="margin-top:4px">${def.desc}</div>`;
            card.addEventListener('click', () => buyUpgrade(key));
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
    side.textContent = isP ? '▲ 味方ユニット' : '▼ 敵ユニット';
    box.appendChild(side);
    box.appendChild(buildUnitCard(key, { showCost: false, enemy: !isP }));

    if(sellEntry) {
        const def = UNIT_DEFS[key];
        const sell = document.createElement('button');
        sell.className = 'info-sell-btn';
        sell.type = 'button';
        sell.textContent = `売却する（+${def.cost}G）`;
        sell.addEventListener('click', () => {
            sellRosterEntry(sellEntry);
            hideUnitInfo();
        });
        box.appendChild(sell);
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

// 指定座標にいるユニット（準備フェーズは編成データ、バトル中は実体）を探す
function unitAtPoint(x, y) {
    // バトル中は実際に動いているユニットから探す
    if(state.scene === 'battle') {
        let hit = null, bd = 26;
        state.units.forEach(u => {
            const d = Math.hypot(u.x - x, u.y - y - 12);
            if(d < bd) { bd = d; hit = { key: u.key, isP: u.isP }; }
        });
        return hit;
    }
    // 準備フェーズは敵（AI編成）のみ対象。味方のタップは売却に使うため
    let hit = null, bd = 26;
    state.aiRoster.forEach(r => {
        const d = Math.hypot(r.x - x, r.y - y - 10);
        if(d < bd) { bd = d; hit = { key: r.key, isP: false }; }
    });
    return hit;
}

// ------------------------------------------------------------
// ユニット図鑑（タイトル画面から開く一覧）
// ------------------------------------------------------------
function openCodex() {
    const list = document.getElementById('codex-list');
    list.innerHTML = '';

    const groups = [
        { label: '基本ユニット（全モード）', keys: SHOP_UNITS },
        { label: 'エリートユニット（SURVIVAL / VERSUS 限定）', keys: ELITE_UNITS },
        { label: '戦術で召喚', keys: ['angel'] }
    ];
    groups.forEach(g => {
        const head = document.createElement('div');
        head.className = 'codex-group';
        head.textContent = g.label;
        list.appendChild(head);
        g.keys.forEach(key => list.appendChild(buildUnitCard(key, { showCost: true })));
    });

    document.getElementById('codex-sheet').classList.add('show');
}

function closeCodex() {
    document.getElementById('codex-sheet').classList.remove('show');
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
    const def = UNIT_DEFS[key];
    const cap = maxUnitsFor(state.mode);
    if(state.roster.length >= cap) { toast(`配置できるのは ${cap} 体までです`); return; }
    if(state.gold < def.cost) { toast('ゴールドが足りません'); return; }
    state.selected = (state.selected === key) ? null : key;
    if(state.selected) {
        closeShop();
        toast(`${def.name} を選択中 — 緑のエリアをタップして配置`);
    }
    updatePrepUI();
}

function buyUpgrade(key) {
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
    dep.textContent = state.mode === 'survival'
        ? `配置 ${state.roster.length}体（上限なし）`
        : `配置 ${state.roster.length}/${cap}`;
    dep.classList.toggle('full', state.roster.length >= cap);

    document.querySelectorAll('#shop-list .shop-card').forEach(card => {
        const key = card.dataset.key;
        if(key) {
            card.classList.toggle('selected', state.selected === key);
            card.classList.toggle('cant-buy', state.gold < UNIT_DEFS[key].cost || state.roster.length >= cap);
            // レベルアップの可否はユニット本体の購入可否とは独立して判定する
            const lvupBtn = card.querySelector('.lvup-btn');
            if(lvupBtn) lvupBtn.disabled = state.gold < unitLevelCost(key, unitLevel(key));
        } else if(card.dataset.upgrade) {
            card.classList.toggle('cant-buy', state.gold < upgradePrice(card.dataset.upgrade));
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
    document.getElementById('tab-units').classList.toggle('active', tab === 'units');
    document.getElementById('tab-upgrades').classList.toggle('active', tab === 'upgrades');
    document.getElementById('tab-tactics').classList.toggle('active', tab === 'tactics');
    state.selected = null;
    renderShop();
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
    const btn = document.getElementById('btn-undo');
    if(btn) btn.disabled = state.undoStack.length === 0;
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
        const def = UNIT_DEFS[state.selected];
        if(p.y < lay.deployTop || p.y > lay.deployBottom) {
            toast('緑色の配置エリア内をタップしてください');
            return;
        }
        if(state.gold < def.cost) { toast('ゴールドが足りません'); state.selected = null; updatePrepUI(); return; }
        const cap = maxUnitsFor(state.mode);
        if(state.roster.length >= cap) { toast(`配置できるのは ${cap} 体までです`); return; }

        pushUndo();
        state.gold -= def.cost;
        state.roster.push({
            id: state.nextId++,
            key: state.selected,
            x: clamp(p.x, 16, state.w - 16),
            y: clamp(p.y, lay.deployTop, lay.deployBottom)
        });
        if(state.gold < def.cost) state.selected = null; // もう買えないなら選択解除
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
    state.roster = state.roster.filter(r => r !== entry);
    state.gold += def.cost;
    toast(`${def.name} を売却 (+${def.cost}G)`);
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
        const p = canvasPos(e);
        showUnitInfo(d.entry.key, true, p.x, p.y, d.entry);
    } else {
        saveGame();
    }
}

// ============================================================
// バトル進行
// ============================================================
function spawnEnemyGroup(group) {
    const lay = layout();
    group.enemies.forEach(g => {
        for(let i = 0; i < g.count; i++) {
            state.units.push(new Unit(g.type, false,
                randRange(26, state.w - 26),
                randRange(lay.enemyTop, lay.enemyBottom)));
        }
    });
    spawnPop(state.w / 2, lay.enemyBottom + 20, 'ENEMY WAVE!', '#ef4444');
    addShake(3);
}

function updateSpawner(dt) {
    if(state.mode !== 'story') return;

    if(state.spawnQueue.length > 0) {
        state.spawnTimer += dt;
        if(state.spawnTimer >= state.spawnQueue[0].delay) {
            state.spawnTimer = 0;
            spawnEnemyGroup(state.spawnQueue.shift());
        }
        return;
    }

    // 雑魚を全滅させたらボスが出現する
    if(!state.boss && !state.bossCleared && state.bossDelay < 0) {
        if(state.units.filter(u => !u.isP).length === 0) state.bossDelay = 60;
    }
    if(state.bossDelay > 0) {
        state.bossDelay -= dt;
        if(state.bossDelay <= 0) {
            state.bossDelay = -1;
            state.boss = new Boss(state.round);
            spawnPop(state.w / 2, 150, 'BOSS APPEARS!', '#f59e0b');
            addShake(10);
            updateHud();
        }
    }
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
                        const a = Math.atan2(u.y - p.y, u.x - p.x);
                        u.vx += Math.cos(a) * 3;
                        u.vy += Math.sin(a) * 3;
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
    updateSpawner(dt);
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
    const playerDefenders = state.units.some(u => u.isP);
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
        if(state.bossCleared) { endBattle(true); return; }

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
        left.textContent = `STORY  WAVE ${state.round}/${STORY_LAST_WAVE}`;
    } else if(state.mode === 'survival') {
        left.textContent = `SURVIVAL  R${state.round}  ${diff}`;
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
            ctx.lineWidth = 10;
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
        .concat(state.aiRoster.map(r => ({ r, isP: false })));
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
        for(let i = 0; i < state.speed; i++) {
            if(state.scene !== 'battle') break;
            updateBattle(1);
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
function resize() {
    const rect = document.getElementById('stage').getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    state.w = Math.max(240, Math.round(rect.width));
    state.h = Math.max(320, Math.round(rect.height));
    canvas.width = Math.round(state.w * dpr);
    canvas.height = Math.round(state.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    if(state.playerBase) state.playerBase.reposition();
    if(state.enemyBase) state.enemyBase.reposition();
    if(state.scene === 'prep') clampRosters();
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

    // モード選択
    document.getElementById('btn-mode-story').addEventListener('click', () => startNewGame('story'));
    document.getElementById('btn-mode-survival').addEventListener('click', () => startNewGame('survival'));
    document.getElementById('btn-mode-versus').addEventListener('click', () => startNewGame('versus'));
    document.getElementById('btn-mode-back').addEventListener('click', backToTitle);
    document.querySelectorAll('.diff-btn').forEach(b => {
        b.addEventListener('click', () => {
            state.difficulty = b.dataset.diff;
            document.querySelectorAll('.diff-btn').forEach(x => x.classList.toggle('active', x === b));
            toast(`難易度: ${AI_PRESETS[state.difficulty].label} — ${AI_PRESETS[state.difficulty].desc}`);
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
