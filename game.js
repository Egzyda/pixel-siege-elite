class Boss {
    constructor(waveNum) {
        this.data = BOSS_DEFS[waveNum];
        this.waveNum = waveNum;
        this.hp = this.data.hp;
        this.maxHp = this.data.hp;
        this.x = state.w / 2;
        this.y = 50;
        this.dmg = this.data.dmg;
        this.speed = this.data.speed;
        this.special = this.data.special;
        this.specialTimer = 0;
        this.cd = 0;
        this.vx = 0;
        this.vy = 0;
        this.flash = 0;
        this.anim = 0;
        this.sprite = this.data.sprite;
        this.palette = this.data.palette;
        this.currentPhase = 0;
        this.deadEnemies = []; // For necromancer revive
        this.fireTimer = 0;
    }

    update(dt) {
        if(this.flash > 0) this.flash--;
        if(this.cd > 0) this.cd -= dt;
        this.specialTimer += dt;
        this.fireTimer += dt;

        // Phase system for Chaos Titan
        if(this.special === 'phases' && this.data.phases) {
            const hpPercent = this.hp / this.maxHp;
            for(let i = this.data.phases.length - 1; i >= 0; i--) {
                if(hpPercent <= this.data.phases[i].hpThreshold && this.currentPhase !== i) {
                    this.currentPhase = i;
                    const phase = this.data.phases[i];
                    this.speed = this.data.speed * phase.speedMult;
                    this.dmg = this.data.dmg * phase.damageMult;
                    spawnPop(this.x, this.y - 30, `PHASE ${i + 1}!`, '#ef4444');
                    addShake(8);
                    break;
                }
            }
        }

        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.vx *= 0.85;
        this.vy *= 0.85;

        // Find nearest player unit
        let target = null;
        let minD = 9999;
        state.units.filter(u => u.isP).forEach(u => {
            const d = Math.hypot(u.x - this.x, u.y - this.y);
            if(d < minD) {
                minD = d;
                target = u;
            }
        });

        const attackRange = 40;

        if(target && minD < 300) {
            // Move toward player units
            const angle = Math.atan2(target.y - this.y, target.x - this.x);
            this.y += Math.sin(angle) * this.speed * dt;
            this.x += Math.cos(angle) * this.speed * dt;

            // Attack if in range
            if(minD <= attackRange && this.cd <= 0) {
                this.cd = 60;
                target.takeDmg(this.dmg, this);
                addShake(4);
            }
        } else {
            // No player units, move toward base
            const targetY = state.h - 40;
            const dy = targetY - this.y;

            if(Math.abs(dy) > 50) {
                this.y += Math.sign(dy) * this.speed * dt;
            } else {
                // Attack base
                if(this.cd <= 0) {
                    this.cd = 60;
                    state.pHP -= this.dmg;
                    addShake(6);
                    spawnPop(this.x, state.h - 40, this.dmg, '#ef4444');
                    
                    // Counter Strike upgrade
                    if(state.upgrades.includes('counter')) {
                        this.takeDmg(50, null);
                        spawnPop(this.x, this.y, 'COUNTER!', '#fbbf24');
                    }
                }
            }
        }

        // Special ability triggers
        this.useSpecial();

        // Bounds
        this.x = Math.max(30, Math.min(state.w - 30, this.x));
        this.y = Math.max(50, Math.min(state.h - 100, this.y));
    }

    useSpecial() {
        switch(this.special) {
            case 'summon':
                if(this.specialTimer > this.data.summonInterval) {
                    this.specialTimer = 0;
                    const summonType = this.data.summonType;
                    const count = this.data.summonCount || 2;
                    
                    for(let i = 0; i < count; i++) {
                        const def = UNIT_DEFS[summonType];
                        const angle = (Math.PI * 2 / count) * i;
                        const dist = 60;
                        
                        const enemy = {
                            key: summonType,
                            def: def,
                            isP: false,
                            x: this.x + Math.cos(angle) * dist,
                            y: this.y + Math.sin(angle) * dist,
                            hp: def.hp,
                            max: def.hp,
                            dmg: def.dmg,
                            speed: def.speed,
                            rate: def.rate,
                            range: def.range,
                            cd: 0,
                            vx: 0, vy: 0,
                            anim: Math.random() * 10,
                            flash: 0,
                            pal: PALETTES[summonType],
                            update: Unit.prototype.update,
                            attack: Unit.prototype.attack,
                            takeDmg: Unit.prototype.takeDmg,
                            draw: Unit.prototype.draw
                        };
                        state.units.push(enemy);
                    }
                    spawnPop(this.x, this.y - 20, 'SUMMON!', '#f59e0b');
                }
                break;
                
            case 'teleport':
                if(this.specialTimer > this.data.teleportInterval) {
                    this.specialTimer = 0;
                    this.x = Math.random() * (state.w - 100) + 50;
                    this.y = Math.random() * 150 + 50;
                    spawnPop(this.x, this.y, 'WARP!', '#8b5cf6');
                }
                break;
                
            case 'fire':
                if(this.fireTimer > this.data.fireInterval) {
                    this.fireTimer = 0;
                    // AOE fire damage to nearby player units
                    const fireRadius = 100;
                    state.units.filter(u => u.isP && Math.hypot(u.x - this.x, u.y - this.y) < fireRadius).forEach(u => {
                        u.takeDmg(this.data.fireDamage, this);
                    });
                    spawnPop(this.x, this.y, 'FLAME!', '#f97316');
                    addShake(5);
                    
                    // Visual effect
                    for(let i = 0; i < 12; i++) {
                        const angle = (Math.PI * 2 / 12) * i;
                        state.fx.push({
                            x: this.x + Math.cos(angle) * 40,
                            y: this.y + Math.sin(angle) * 40,
                            vx: Math.cos(angle) * 3,
                            vy: Math.sin(angle) * 3,
                            life: 30,
                            color: '#f97316'
                        });
                    }
                }
                break;
                
            case 'revive':
                if(this.specialTimer > this.data.reviveInterval && this.deadEnemies.length > 0) {
                    this.specialTimer = 0;
                    const toRevive = Math.min(2, this.deadEnemies.length);
                    
                    for(let i = 0; i < toRevive; i++) {
                        const deadUnit = this.deadEnemies.pop();
                        const def = UNIT_DEFS['skeleton'];
                        
                        const revived = {
                            key: 'skeleton',
                            def: def,
                            isP: false,
                            x: this.x + (Math.random() - 0.5) * 80,
                            y: this.y + 40,
                            hp: def.hp,
                            max: def.hp,
                            dmg: def.dmg,
                            speed: def.speed,
                            rate: def.rate,
                            range: def.range,
                            cd: 0,
                            vx: 0, vy: 0,
                            anim: Math.random() * 10,
                            flash: 0,
                            pal: PALETTES.skeleton,
                            update: Unit.prototype.update,
                            attack: Unit.prototype.attack,
                            takeDmg: Unit.prototype.takeDmg,
                            draw: Unit.prototype.draw
                        };
                        state.units.push(revived);
                    }
                    spawnPop(this.x, this.y - 20, 'REVIVE!', '#8b5cf6');
                }
                break;
                
            case 'laser':
                if(this.specialTimer > this.data.laserInterval) {
                    this.specialTimer = 0;
                    // Laser beam at player base
                    const laserX = state.w / 2;
                    const laserY = state.h - 40;
                    const laserWidth = 60;
                    
                    state.units.filter(u => u.isP && Math.abs(u.x - laserX) < laserWidth).forEach(u => {
                        u.takeDmg(this.data.laserDamage, this);
                    });
                    
                    state.pHP -= this.data.laserDamage;
                    spawnPop(laserX, laserY, 'LASER!', '#3b82f6');
                    addShake(10);
                    
                    // Laser visual
                    state.fx.push({
                        type: 'laser',
                        x1: this.x,
                        y1: this.y,
                        x2: laserX,
                        y2: laserY,
                        life: 20,
                        color: '#3b82f6'
                    });
                }
                break;
        }
    }

    takeDmg(v, attacker) {
        if(this.special === 'armor') {
            v *= this.data.armorReduction;
            if(Math.random() < 0.3) {
                spawnPop(this.x, this.y - 20, 'ARMOR!', '#78716c');
            }
        }

        this.hp -= v;
        this.flash = 6;
        spawnPop(this.x, this.y - 20, Math.floor(v), '#fff');

        // Vampire healing for attacker
        if(attacker && attacker.isP && state.upgrades.includes('vampire')) {
            const heal = Math.abs(v) * 0.1;
            attacker.hp = Math.min(attacker.max, attacker.hp + heal);
        }

        if(this.hp <= 0) {
            this.hp = 0;
            onBossDefeated();
        }
    }

    draw(ctx) {
        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.ellipse(this.x, this.y, 40, 15, 0, 0, Math.PI * 2);
        ctx.fill();

        // Bounce animation
        this.anim += 0.1;
        const by = Math.abs(Math.sin(this.anim)) * 5;

        ctx.save();
        ctx.translate(this.x, this.y - by);
        ctx.scale(1, -1); // Flip sprite to face downward

        const px = 3; // Boss sprite scale
        const sprite = this.sprite.idle || this.sprite;
        ctx.translate(-7 * px, -12 * px);

        for(let r = 0; r < 14; r++) {
            for(let c = 0; c < 16; c++) {
                const idx = sprite[r][c];
                if(idx > 0) {
                    ctx.fillStyle = this.flash > 0 ? '#fff' : this.palette[idx];
                    ctx.fillRect(c * px, r * px, px, px);
                }
            }
        }
        ctx.restore();

        // HP Bar
        const w = 100;
        ctx.fillStyle = 'black';
        ctx.fillRect(this.x - w/2, this.y - 60, w, 7);
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(this.x - w/2 + 1, this.y - 59, (w - 2) * (this.hp / this.maxHp), 5);
    }
}

/**
 * --- GAME STATE ---
 */
let state = {
    w: 0, h: 0,
    scene: 'title',
    wave: 1,
    deck: [],
    skill: null,
    upgrades: [],
    mana: 50, maxMana: 100, manaRate: 1.0,
    pHP: 1500, maxHP: 1500,
    units: [], fx: [], projs: [], popups: [],
    boss: null,
    sel: null, shake: 0,
    rewardOptions: [],
    // Upgrade multipliers
    atkMult: 1.0,
    hpMult: 1.0,
    speedMult: 1.0,
    rangeMult: 1.0,
    rateMult: 1.0,
    costMult: 1.0,
    baseRegen: 0,
    summonY: 0,
    // Wave spawning
    waveSpawner: null,
    currentWaveIndex: 0,
    spawnTimer: 0,
    waitingForBoss: false,
    // Skill effects
    timeWarpActive: false,
    timeWarpTimer: 0,
    manaSurgeActive: false,
    manaSurgeTimer: 0
};

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });

/**
 * --- UNIT CLASS ---
 */
class Unit {
    constructor(k, isP, x, y) {
        this.key = k;
        this.def = UNIT_DEFS[k];
        this.isP = isP;
        this.x = x;
        this.y = y;

        // Apply upgrades
        this.hp = this.def.hp * state.hpMult;
        this.max = this.hp;
        this.dmg = this.def.dmg * state.atkMult;
        this.speed = this.def.speed * state.speedMult;
        this.rate = this.def.rate * state.rateMult;
        this.range = this.def.range * (this.def.type === 'ranged' || this.def.type === 'aoe' ? state.rangeMult : 1);

        this.cd = 0;
        this.vx = 0;
        this.vy = 0;
        this.anim = Math.random() * 10;
        this.flash = 0;
        this.pal = k === 'healer' ? PALETTES.healer : PALETTES[k];
    }

    update(dt) {
        if(this.flash > 0) this.flash--;
        if(this.cd > 0) this.cd -= dt;
        this.anim += dt * 0.15;

        // Apply time warp slow to enemies
        let effectiveSpeed = this.speed;
        if(!this.isP && state.timeWarpActive) {
            effectiveSpeed *= 0.5;
        }

        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.vx *= 0.85;
        this.vy *= 0.85;

        let target = null;
        let minD = 9999;

        if(this.def.type === 'healer') {
            state.units.filter(u => u.isP === this.isP && u !== this).forEach(a => {
                if(a.hp < a.max && (a.hp / a.max) < minD) {
                    minD = a.hp / a.max;
                    target = a;
                }
            });
            if(target) minD = Math.hypot(target.x - this.x, target.y - this.y);
            else minD = 9999;
        } else {
            if(this.isP && state.boss && state.boss.hp > 0) {
                target = state.boss;
                minD = Math.hypot(target.x - this.x, target.y - this.y);
            } else {
                state.units.filter(u => u.isP !== this.isP).forEach(e => {
                    const d = Math.hypot(e.x - this.x, e.y - this.y);
                    if(d < minD) {
                        minD = d;
                        target = e;
                    }
                });
            }
        }

        const atTarget = target && minD <= this.range;

        if(atTarget) {
            if(this.cd <= 0) {
                this.cd = this.rate;
                this.attack(target);
            }
        } else if(target && minD < 300) {
            const angle = Math.atan2(target.y - this.y, target.x - this.x);
            this.x += Math.cos(angle) * effectiveSpeed * dt;
            this.y += Math.sin(angle) * effectiveSpeed * dt;
        } else {
            // Move toward enemy base
            const targetY = this.isP ? 40 : state.h - 40;
            const dy = targetY - this.y;

            if(Math.abs(dy) > 50) {
                const angle = this.isP ? -Math.PI / 2 : Math.PI / 2;
                this.x += Math.cos(angle) * effectiveSpeed * dt * 0.5;
                this.y += Math.sin(angle) * effectiveSpeed * dt;
            } else {
                // Attack enemy base
                if(this.cd <= 0) {
                    this.cd = this.rate;
                    if(this.isP) {
                        // Player unit attacking enemy base (shouldn't happen now)
                    } else {
                        // Enemy unit attacking player base
                        state.pHP -= this.dmg;
                        addShake(3);
                        spawnPop(this.x, state.h - 40, this.dmg, '#ef4444');
                        
                        // Counter Strike upgrade
                        if(state.upgrades.includes('counter')) {
                            this.takeDmg(50, null);
                            spawnPop(this.x, this.y, 'COUNTER!', '#fbbf24');
                        }
                    }
                }
            }
        }

        state.units.forEach(u => {
            if(u === this) return;
            const d = Math.hypot(u.x - this.x, u.y - this.y);
            if(d < 14) {
                const a = Math.atan2(this.y - u.y, this.x - u.x);
                const f = (14 - d) * 0.08;
                this.x += Math.cos(a) * f;
                this.y += Math.sin(a) * f;
            }
        });

        this.x = Math.max(20, Math.min(state.w - 20, this.x));
        const margin = 50;
        if(this.y < margin) this.y = margin;
        if(this.y > state.h - margin) this.y = state.h - margin;
    }

    attack(t) {
        if(this.def.type === 'ranged' || this.def.type === 'aoe') {
            state.projs.push({ x: this.x, y: this.y, t: t, dmg: this.dmg, def: this.def, isP: this.isP, owner: this, active: true });
        } else {
            t.takeDmg(this.dmg, this);
            const a = Math.atan2(t.y - this.y, t.x - this.x);
            const k = (this.def.kb / (t.def?.mass || 2)) * 2;
            t.vx += Math.cos(a) * k;
            t.vy += Math.sin(a) * k;
        }
    }

    takeDmg(v, attacker) {
        this.hp -= v;
        this.flash = 6;
        spawnPop(this.x, this.y - 15, Math.floor(Math.abs(v)), v < 0 ? '#10b981' : '#fff');

        // Vampire healing
        if(attacker && attacker.isP && state.upgrades.includes('vampire')) {
            const heal = Math.abs(v) * 0.1;
            attacker.hp = Math.min(attacker.max, attacker.hp + heal);
        }

        // Thorns damage
        if(attacker && this.isP && state.upgrades.includes('thorns')) {
            const reflect = Math.abs(v) * 0.3;
            attacker.takeDmg(reflect, null);
        }

        if(this.hp > this.max) this.hp = this.max;
        
        // Track dead enemies for necromancer
        if(this.hp <= 0 && !this.isP && state.boss && state.boss.special === 'revive') {
            state.boss.deadEnemies.push({key: this.key, x: this.x, y: this.y});
            if(state.boss.deadEnemies.length > 10) {
                state.boss.deadEnemies.shift();
            }
        }
    }

    draw(ctx) {
        const s = this.key === 'giant' ? 3 : 2;
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.ellipse(this.x, this.y, 7 * s, 3 * s, 0, 0, Math.PI * 2);
        ctx.fill();

        const by = Math.abs(Math.sin(this.anim)) * 3;

        ctx.save();
        ctx.translate(this.x, this.y - by);
        if(!this.isP) ctx.scale(1, -1);

        const px = s;
        const sprite = this.def.sprite;
        ctx.translate(-7 * px, -12 * px);

        for(let r = 0; r < 14; r++) {
            for(let c = 0; c < 16; c++) {
                const idx = sprite[r][c];
                if(idx > 0) {
                    ctx.fillStyle = this.flash > 0 ? '#fff' : this.pal[idx];
                    ctx.fillRect(c * px, r * px, px, px);
                }
            }
        }
        ctx.restore();

        const w = 24;
        ctx.fillStyle = 'black';
        ctx.fillRect(this.x - w / 2, this.y - 30, w, 4);
        ctx.fillStyle = this.isP ? '#10b981' : '#ef4444';
        ctx.fillRect(this.x - w / 2 + 1, this.y - 29, (w - 2) * (Math.max(0, this.hp) / this.max), 2);
    }
}

/**
 * --- SYSTEMS ---
 */
function spawnPop(x, y, v, c) {
    state.popups.push({ x, y, v, c, l: 1.0, z: 0 });
}

function addShake(v) {
    state.shake = v;
    if(navigator.vibrate) navigator.vibrate(v * 8);
}

function updateFX(dt) {
    if(state.shake > 0) state.shake *= 0.9;
    state.popups.forEach(p => {
        p.z += 1;
        p.l -= 0.02;
    });
    state.popups = state.popups.filter(p => p.l > 0);

    state.fx.forEach(fx => {
        if(fx.type === 'laser') {
            fx.life--;
        } else {
            fx.x += fx.vx;
            fx.y += fx.vy;
            fx.life--;
        }
    });
    state.fx = state.fx.filter(fx => fx.life > 0);

    state.projs.forEach(p => {
        if(!p.active) return;
        const dx = p.t.x - p.x, dy = p.t.y - p.y;
        const d = Math.hypot(dx, dy);
        if(d < 10 || p.t.hp <= 0) {
            p.active = false;
            if(p.def.type === 'aoe') {
                state.units.forEach(u => {
                    if(u.isP !== p.isP && Math.hypot(u.x - p.x, u.y - p.y) < p.def.splash) {
                        u.takeDmg(p.dmg, p.owner);
                        const a = Math.atan2(u.y - p.y, u.x - p.x);
                        u.vx += Math.cos(a) * 5;
                        u.vy += Math.sin(a) * 5;
                    }
                });
                if(state.boss && Math.hypot(state.boss.x - p.x, state.boss.y - p.y) < p.def.splash) {
                    state.boss.takeDmg(p.dmg, p.owner);
                }
                addShake(2);
            } else {
                p.t.takeDmg(p.dmg, p.owner);
            }
        } else {
            p.x += (dx / d) * 7;
            p.y += (dy / d) * 7;
        }
    });
    state.projs = state.projs.filter(p => p.active);

    // Base regeneration
    if(state.baseRegen > 0) {
        state.pHP = Math.min(state.maxHP, state.pHP + state.baseRegen / 60);
    }
    
    // Time warp effect
    if(state.timeWarpActive) {
        state.timeWarpTimer--;
        if(state.timeWarpTimer <= 0) {
            state.timeWarpActive = false;
        }
    }
    
    // Mana surge effect
    if(state.manaSurgeActive) {
        state.manaSurgeTimer--;
        if(state.manaSurgeTimer <= 0) {
            state.manaSurgeActive = false;
        }
    }
}

/**
 * --- WAVE SPAWNER ---
 */
function spawnEnemyWave(waveConfig) {
    const spawnY = 80; // Spawn near top
    const spawnWidth = state.w - 100;
    const spawnCenterX = state.w / 2;
    
    waveConfig.enemies.forEach(enemyGroup => {
        const { type, count } = enemyGroup;
        const def = UNIT_DEFS[type];
        
        for(let i = 0; i < count; i++) {
            const spreadX = (Math.random() - 0.5) * spawnWidth;
            const spreadY = Math.random() * 40;
            
            const enemy = {
                key: type,
                def: def,
                isP: false,
                x: spawnCenterX + spreadX,
                y: spawnY + spreadY,
                hp: def.hp,
                max: def.hp,
                dmg: def.dmg,
                speed: def.speed,
                rate: def.rate,
                range: def.range,
                cd: 0,
                vx: 0, vy: 0,
                anim: Math.random() * 10,
                flash: 0,
                pal: PALETTES[type],
                update: Unit.prototype.update,
                attack: Unit.prototype.attack,
                takeDmg: Unit.prototype.takeDmg,
                draw: Unit.prototype.draw
            };
            state.units.push(enemy);
        }
    });
}

function updateWaveSpawner(dt) {
    if(!state.waveSpawner || state.boss) return;
    
    state.spawnTimer += dt;
    
    const currentWave = state.waveSpawner[state.currentWaveIndex];
    if(!currentWave) {
        // All waves spawned, wait for enemies to be cleared
        state.waitingForBoss = true;
        return;
    }
    
    if(state.spawnTimer >= currentWave.delay) {
        state.spawnTimer = 0;
        spawnEnemyWave(currentWave);
        state.currentWaveIndex++;
        
        // Visual feedback
        spawnPop(state.w / 2, 100, 'ENEMY WAVE!', '#ef4444');
        addShake(3);
    }
}

function checkBossSpawn() {
    if(state.waitingForBoss && !state.boss) {
        // Check if all enemies are cleared
        const enemiesAlive = state.units.filter(u => !u.isP).length;
        if(enemiesAlive === 0) {
            state.waitingForBoss = false;
            setTimeout(() => {
                spawnBoss(state.wave);
                spawnPop(state.w / 2, 100, 'BOSS APPEARS!', '#f59e0b');
                addShake(8);
            }, 1000);
        }
    }
}

/**
 * --- SKILL SYSTEM ---
 */
function useSkill() {
    if(!state.skill || state.skill.cooldown > 0) return;

    state.skill.cooldown = state.skill.maxCooldown;

    switch(state.skill.id) {
        case 'meteor':
            state.units.filter(u => !u.isP).forEach(u => u.takeDmg(150, null));
            if(state.boss) state.boss.takeDmg(150, null);
            addShake(10);
            spawnPop(state.w / 2, state.h / 2, 'METEOR!', '#f59e0b');
            
            // Visual effect
            for(let i = 0; i < 20; i++) {
                state.fx.push({
                    x: Math.random() * state.w,
                    y: Math.random() * state.h / 2,
                    vx: 0,
                    vy: 5,
                    life: 30,
                    color: '#f59e0b'
                });
            }
            break;

        case 'judgment':
            const cx = state.w / 2, cy = state.h / 2;
            state.units.filter(u => !u.isP && Math.hypot(u.x - cx, u.y - cy) < 120).forEach(u => {
                u.takeDmg(400, null);
            });
            if(state.boss && Math.hypot(state.boss.x - cx, state.boss.y - cy) < 120) {
                state.boss.takeDmg(400, null);
            }
            addShake(8);
            spawnPop(cx, cy, 'JUDGMENT!', '#fbbf24');
            
            // Visual effect
            for(let i = 0; i < 16; i++) {
                const angle = (Math.PI * 2 / 16) * i;
                state.fx.push({
                    x: cx,
                    y: cy,
                    vx: Math.cos(angle) * 5,
                    vy: Math.sin(angle) * 5,
                    life: 40,
                    color: '#fbbf24'
                });
            }
            break;

        case 'heal':
            state.units.filter(u => u.isP).forEach(u => {
                u.hp = u.max;
                spawnPop(u.x, u.y, 'HEAL', '#10b981');
            });
            state.pHP = Math.min(state.maxHP, state.pHP + 400);
            spawnPop(state.w / 2, state.h - 40, '+400', '#10b981');
            break;

        case 'timewarp':
            state.timeWarpActive = true;
            state.timeWarpTimer = 8 * 60; // 8 seconds at 60fps
            spawnPop(state.w / 2, state.h / 2, 'TIME WARP!', '#60a5fa');
            break;

        case 'angel':
            state.units.push({
                key: 'angel',
                def: { hp: 800, dmg: 70, range: 120, speed: 0.8, rate: 40, type: 'ranged', mass: 2, kb: 5, sprite: SPRITES.angel },
                isP: true,
                x: state.w / 2,
                y: state.h - 100,
                hp: 800,
                max: 800,
                dmg: 70 * state.atkMult,
                speed: 0.8 * state.speedMult,
                rate: 40 * state.rateMult,
                range: 120 * state.rangeMult,
                cd: 0,
                vx: 0, vy: 0,
                anim: 0,
                flash: 0,
                pal: PALETTES.angel,
                update: Unit.prototype.update,
                attack: Unit.prototype.attack,
                takeDmg: Unit.prototype.takeDmg,
                draw: Unit.prototype.draw,
                lifetime: 25 * 60 // 25 seconds
            });
            spawnPop(state.w / 2, state.h - 100, 'ANGEL!', '#fef3c7');
            break;

        case 'surge':
            state.manaSurgeActive = true;
            state.manaSurgeTimer = 15 * 60; // 15 seconds at 60fps
            spawnPop(state.w / 2, 100, 'SURGE!', '#3b82f6');
            break;
    }
}

/**
 * --- SAVE/LOAD SYSTEM ---
 */
function saveGame() {
    const saveData = {
        wave: state.wave,
        pHP: state.pHP,
        maxHP: state.maxHP,
        mana: state.mana,
        maxMana: state.maxMana,
        deck: state.deck,
        skill: state.skill,
        upgrades: state.upgrades,
        atkMult: state.atkMult,
        hpMult: state.hpMult,
        speedMult: state.speedMult,
        rangeMult: state.rangeMult,
        rateMult: state.rateMult,
        costMult: state.costMult,
        manaRate: state.manaRate,
        baseRegen: state.baseRegen
    };
    localStorage.setItem('pixelSiegeEliteSave', JSON.stringify(saveData));
}

function loadGame() {
    const saveStr = localStorage.getItem('pixelSiegeEliteSave');
    if(!saveStr) return false;

    try {
        const saveData = JSON.parse(saveStr);

        document.getElementById('title-screen').classList.add('hidden');

        // Restore state
        state.wave = saveData.wave;
        state.pHP = saveData.pHP;
        state.maxHP = saveData.maxHP;
        state.mana = saveData.mana;
        state.maxMana = saveData.maxMana;
        state.deck = saveData.deck;
        state.skill = saveData.skill;
        state.upgrades = saveData.upgrades;
        state.atkMult = saveData.atkMult;
        state.hpMult = saveData.hpMult;
        state.speedMult = saveData.speedMult;
        state.rangeMult = saveData.rangeMult;
        state.rateMult = saveData.rateMult;
        state.costMult = saveData.costMult;
        state.manaRate = saveData.manaRate;
        state.baseRegen = saveData.baseRegen;

        state.scene = 'battle';
        state.units = [];
        state.projs = [];
        state.popups = [];
        state.fx = [];
        state.boss = null;
        state.waitingForBoss = false;

        startWave(state.wave);
        createControls();
        updateUI();

        return true;
    } catch(e) {
        console.error('Failed to load save:', e);
        return false;
    }
}

function hasSavedGame() {
    return !!localStorage.getItem('pixelSiegeEliteSave');
}

function deleteSave() {
    localStorage.removeItem('pixelSiegeEliteSave');
}

/**
 * --- GAME FLOW ---
 */
function startGame() {
    deleteSave(); // Clear any existing save when starting new game
    document.getElementById('title-screen').classList.add('hidden');

    const allUnits = ['knight', 'archer', 'wizard', 'healer', 'giant'];
    const shuffled = allUnits.sort(() => Math.random() - 0.5);
    state.deck = shuffled.slice(0, 3);

    state.scene = 'battle';
    state.wave = 1;
    state.mana = 50;
    state.pHP = 1500;
    state.maxHP = 1500;
    state.units = [];
    state.projs = [];
    state.popups = [];
    state.fx = [];
    state.skill = null;
    state.upgrades = [];
    state.boss = null;
    state.waitingForBoss = false;

    // Reset multipliers
    state.atkMult = 1.0;
    state.hpMult = 1.0;
    state.speedMult = 1.0;
    state.rangeMult = 1.0;
    state.rateMult = 1.0;
    state.costMult = 1.0;
    state.manaRate = 1.0;
    state.baseRegen = 0;

    startWave(1);
    createControls();
    updateUI();
}

function startWave(waveNum) {
    state.wave = waveNum;
    state.units = [];
    state.projs = [];
    state.boss = null;
    state.waveSpawner = WAVE_CONFIGS[waveNum].enemyWaves;
    state.currentWaveIndex = 0;
    state.spawnTimer = 0;
    state.waitingForBoss = false;
    
    document.getElementById('boss-hp-container').classList.remove('active');
    
    // Show wave start notification
    spawnPop(state.w / 2, state.h / 2, `WAVE ${waveNum}`, '#fbbf24');
    addShake(5);
}

function spawnBoss(waveNum) {
    state.boss = new Boss(waveNum);
    state.waveSpawner = null;
    document.getElementById('boss-hp-container').classList.add('active');
    document.getElementById('boss-name').innerText = state.boss.data.name;
}

function onBossDefeated() {
    state.boss = null;
    document.getElementById('boss-hp-container').classList.remove('active');

    if(state.wave === 7) {
        setTimeout(() => {
            endGame(true);
        }, 1000);
    } else {
        setTimeout(() => {
            showRewardScreen();
        }, 1000);
    }
}

function showRewardScreen() {
    state.scene = 'reward';
    const rewards = [];

    if(state.wave === 1 || state.wave === 2) {
        // New units
        const available = ['knight', 'archer', 'wizard', 'healer', 'giant'].filter(k => !state.deck.includes(k));
        const shuffled = available.sort(() => Math.random() - 0.5);
        rewards.push(...shuffled.slice(0, 3).map(k => ({
            type: 'unit',
            key: k,
            data: UNIT_DEFS[k]
        })));
    } else if(state.wave === 3) {
        // Skills
        const allSkills = Object.keys(SKILL_DEFS);
        const shuffled = allSkills.sort(() => Math.random() - 0.5);
        rewards.push(...shuffled.slice(0, 3).map(k => ({
            type: 'skill',
            key: k,
            data: SKILL_DEFS[k]
        })));
    } else {
        // Upgrades
        const allUpgrades = Object.keys(UPGRADE_DEFS);
        const shuffled = allUpgrades.sort(() => Math.random() - 0.5);
        rewards.push(...shuffled.slice(0, 3).map(k => ({
            type: 'upgrade',
            key: k,
            data: UPGRADE_DEFS[k]
        })));
    }

    state.rewardOptions = rewards;

    const container = document.getElementById('reward-cards');
    container.innerHTML = '';

    rewards.forEach((reward, idx) => {
        const card = document.createElement('div');
        card.className = `reward-card ${reward.type}-reward`;

        if(reward.type === 'unit') {
            card.innerHTML = `
                <div class="reward-card-name">${reward.data.name}</div>
                <div class="reward-card-desc">
                    HP: ${reward.data.hp} | DMG: ${reward.data.dmg}<br>
                    RANGE: ${reward.data.range} | COST: ${reward.data.cost}
                </div>
            `;
        } else if(reward.type === 'skill') {
            card.innerHTML = `
                <div style="font-size:32px;margin-bottom:8px;">${reward.data.icon}</div>
                <div class="reward-card-name">${reward.data.name}</div>
                <div class="reward-card-desc">
                    ${reward.data.effect}<br>
                    CD: ${reward.data.cooldown}秒
                </div>
            `;
        } else {
            card.innerHTML = `
                <div style="font-size:32px;margin-bottom:8px;">${reward.data.icon}</div>
                <div class="reward-card-name">${reward.data.name}</div>
                <div class="reward-card-desc">${reward.data.effect}</div>
            `;
        }

        card.onclick = () => selectReward(idx);
        container.appendChild(card);
    });

    document.getElementById('reward-screen').style.display = 'flex';
}

function selectReward(idx) {
    const reward = state.rewardOptions[idx];

    if(reward.type === 'unit') {
        state.deck.push(reward.key);
    } else if(reward.type === 'skill') {
        state.skill = {
            id: reward.key,
            data: reward.data,
            cooldown: 0,
            maxCooldown: reward.data.cooldown * 60
        };
        document.getElementById('skill-icon').innerText = reward.data.icon;
        document.getElementById('skill-name').innerText = reward.data.name;
    } else if(reward.type === 'upgrade') {
        state.upgrades.push(reward.key);
        applyUpgrade(reward.key);
    }

    document.getElementById('reward-screen').style.display = 'none';

    state.wave++;
    if(state.wave <= 7) {
        state.scene = 'battle';
        state.mana = 50 + (state.upgrades.filter(u => u === 'start_mana').length * 30);
        startWave(state.wave);
        createControls();
        updateUI();
        saveGame(); // Auto-save after choosing reward
    } else {
        endGame(true);
    }
}

function applyUpgrade(key) {
    switch(key) {
        case 'atk_boost': state.atkMult *= 1.2; break;
        case 'hp_boost': state.hpMult *= 1.25; break;
        case 'speed_boost': state.speedMult *= 1.3; break;
        case 'range_ext': state.rangeMult *= 1.2; break;
        case 'atk_speed': state.rateMult *= 0.85; break;
        case 'mana_flow': state.manaRate *= 1.4; break;
        case 'mana_accel': state.manaRate *= 1.6; break;
        case 'cost_reduce': state.costMult *= 0.85; break;
        case 'start_mana': break;
        case 'fortified': state.maxHP += 500; state.pHP += 500; break;
        case 'regen': state.baseRegen += 5; break;
        case 'counter': break;
        case 'vampire': break;
        case 'thorns': break;
    }
}

function endGame(win) {
    state.scene = 'gameover';
    deleteSave(); // Clear save when game ends
    const m = document.getElementById('modal');
    m.style.display = 'flex';
    const t = document.getElementById('modal-title');

    if(win) {
        t.innerText = "VICTORY";
        t.className = "text-6xl font-black italic mb-2 text-transparent bg-clip-text bg-gradient-to-br from-green-400 to-blue-500";
        document.getElementById('modal-msg').innerText = "ALL WAVES CLEARED";
    } else {
        t.innerText = "GAME OVER";
        t.className = "text-6xl font-black italic mb-2 text-transparent bg-clip-text bg-gradient-to-br from-orange-400 to-red-500";
        document.getElementById('modal-msg').innerText = "BASE DESTROYED";
    }
}

function backToTitle() {
    document.getElementById('modal').style.display = 'none';
    document.getElementById('title-screen').classList.remove('hidden');
    state.scene = 'title';
    state.wave = 1;
    state.deck = [];
    state.boss = null;
    state.skill = null;
    state.upgrades = [];

    // Update Continue button visibility
    const continueBtn = document.getElementById('btn-continue');
    if(continueBtn) {
        continueBtn.style.display = hasSavedGame() ? 'block' : 'none';
    }
}

/**
 * --- MAIN LOOP ---
 */
function init() {
    window.addEventListener('resize', resize);
    resize();

    // Show/hide Continue button based on save data
    const continueBtn = document.getElementById('btn-continue');
    if(continueBtn && hasSavedGame()) {
        continueBtn.style.display = 'block';
    }

    requestAnimationFrame(loop);
}

function resize() {
    const el = canvas.parentElement;
    state.w = canvas.width = el.clientWidth;
    state.h = canvas.height = el.clientHeight;
    state.summonY = state.h * 0.7;
}

function createControls() {
    const deck = document.getElementById('unit-deck');
    deck.innerHTML = '';

    state.deck.forEach(k => {
        const u = UNIT_DEFS[k];
        if(!u) return;

        const btn = document.createElement('div');
        btn.className = 'unit-card';
        btn.id = `btn-${k}`;

        btn.onclick = () => {
            state.sel = state.sel === k ? null : k;
            updateUI();
        };

        const icn = document.createElement('canvas');
        icn.className = 'unit-icon';
        icn.width = 32;
        icn.height = 32;
        const ctx2 = icn.getContext('2d');
        const s = u.sprite;
        const p = k === 'healer' ? PALETTES.healer : PALETTES[k];
        for(let r = 0; r < 14; r++) {
            for(let c = 0; c < 16; c++) {
                if(s[r][c] > 0) {
                    ctx2.fillStyle = p[s[r][c]];
                    ctx2.fillRect(c * 2, r * 2, 2, 2);
                }
            }
        }

        const cost = Math.ceil(u.cost * state.costMult);
        btn.innerHTML = `<div class="unit-cost">${cost}</div>`;
        btn.appendChild(icn);
        deck.appendChild(btn);
    });
}

function updateUI() {
    document.getElementById('mana-val').innerText = Math.floor(state.mana);
    document.getElementById('mana-bar').style.width = (state.mana / state.maxMana * 100) + '%';
    document.getElementById('wave-num').innerText = state.wave;
    document.getElementById('player-hp').style.width = (Math.max(0, state.pHP) / state.maxHP * 100) + '%';

    if(state.boss) {
        document.getElementById('boss-hp').style.width = (Math.max(0, state.boss.hp) / state.boss.maxHp * 100) + '%';
    }

    state.deck.forEach(k => {
        const b = document.getElementById(`btn-${k}`);
        if(b) {
            const cost = Math.ceil(UNIT_DEFS[k].cost * state.costMult);
            b.classList.toggle('active', state.sel === k);
            b.classList.toggle('disabled', state.mana < cost);
        }
    });

    // Skill UI
    const skillBtn = document.getElementById('skill-icon').parentElement;
    if(state.skill) {
        skillBtn.classList.remove('disabled');
        skillBtn.classList.toggle('ready', state.skill.cooldown <= 0);
        const cdPercent = state.skill.cooldown / state.skill.maxCooldown;
        document.getElementById('skill-cd-bar').style.width = (cdPercent * 100) + '%';

        if(state.skill.cooldown > 0) {
            const seconds = Math.ceil(state.skill.cooldown / 60);
            document.getElementById('skill-timer').innerText = seconds + 's';
        } else {
            document.getElementById('skill-timer').innerText = 'READY';
        }
    } else {
        skillBtn.classList.add('disabled');
        document.getElementById('skill-timer').innerText = '--';
    }
}

function loop(t) {
    const dt = 1;

    if(state.scene === 'battle') {
        const manaBoost = state.manaSurgeActive ? 3 : 1;
        state.mana = Math.min(state.maxMana, state.mana + 0.08 * state.manaRate * manaBoost);

        updateWaveSpawner(dt);
        checkBossSpawn();

        if(state.boss) {
            state.boss.update(dt);
        }

        state.units.forEach(u => {
            u.update(dt);
            // Remove timed summons (angel)
            if(u.lifetime !== undefined) {
                u.lifetime--;
                if(u.lifetime <= 0) u.hp = 0;
            }
        });
        updateFX(dt);
        state.units = state.units.filter(u => u.hp > 0);

        // Skill cooldown
        if(state.skill && state.skill.cooldown > 0) {
            state.skill.cooldown--;
        }

        if(state.pHP <= 0) {
            endGame(false);
        }

        updateUI();
    }

    draw();
    requestAnimationFrame(loop);
}

function draw() {
    const sx = (Math.random() - 0.5) * state.shake;
    const sy = (Math.random() - 0.5) * state.shake;

    ctx.save();
    ctx.translate(sx, sy);

    const g = ctx.createLinearGradient(0, 0, 0, state.h);
    g.addColorStop(0, '#1e293b');
    g.addColorStop(0.5, '#334155');
    g.addColorStop(1, '#1e293b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, state.w, state.h);

    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for(let i = 0; i < state.w; i += 40) {
        ctx.moveTo(i, 0);
        ctx.lineTo(i, state.h);
    }
    for(let i = 0; i < state.h; i += 40) {
        ctx.moveTo(0, i);
        ctx.lineTo(state.w, i);
    }
    ctx.stroke();

    // Draw summon zone
    if(state.sel) {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.1)';
        const zoneY = state.summonY;
        ctx.fillRect(0, zoneY, state.w, state.h - zoneY);
        ctx.beginPath();
        ctx.moveTo(0, zoneY);
        ctx.lineTo(state.w, zoneY);
        ctx.strokeStyle = '#10b981';
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Base
    ctx.fillStyle = '#047857';
    ctx.fillRect(0, state.h - 30, state.w, 30);

    // Draw effects
    state.fx.forEach(fx => {
        if(fx.type === 'laser') {
            ctx.strokeStyle = fx.color;
            ctx.lineWidth = 8;
            ctx.globalAlpha = fx.life / 20;
            ctx.beginPath();
            ctx.moveTo(fx.x1, fx.y1);
            ctx.lineTo(fx.x2, fx.y2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        } else {
            ctx.fillStyle = fx.color;
            ctx.globalAlpha = fx.life / 30;
            ctx.beginPath();
            ctx.arc(fx.x, fx.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    });

    if(state.boss) {
        state.boss.draw(ctx);
    }

    state.units.sort((a, b) => a.y - b.y);
    state.units.forEach(u => u.draw(ctx));

    state.projs.forEach(p => {
        ctx.fillStyle = p.def.type === 'aoe' ? '#f59e0b' : '#fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
    });

    state.popups.forEach(p => {
        ctx.font = '900 14px Futura';
        ctx.fillStyle = 'black';
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.globalAlpha = p.l;
        ctx.strokeText(p.v, p.x, p.y - p.z);
        ctx.fillStyle = p.c;
        ctx.fillText(p.v, p.x, p.y - p.z);
        ctx.globalAlpha = 1;
    });

    // Time warp indicator
    if(state.timeWarpActive) {
        ctx.fillStyle = 'rgba(96, 165, 250, 0.2)';
        ctx.fillRect(0, 0, state.w, state.h);
        ctx.fillStyle = '#60a5fa';
        ctx.font = '16px Futura';
        ctx.fillText('TIME WARP', 10, 30);
    }

    // Mana surge indicator
    if(state.manaSurgeActive) {
        ctx.fillStyle = '#3b82f6';
        ctx.font = '16px Futura';
        ctx.fillText('MANA SURGE', 10, 50);
    }

    ctx.restore();
}

// Input
canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    handleInput(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });
canvas.addEventListener('mousedown', e => handleInput(e.clientX, e.clientY));

function handleInput(cx, cy) {
    if(state.scene !== 'battle' || !state.sel) return;
    const r = canvas.getBoundingClientRect();
    const x = (cx - r.left) * (state.w / r.width);
    const y = (cy - r.top) * (state.h / r.height);

    if(y > state.summonY) {
        const u = UNIT_DEFS[state.sel];
        const cost = Math.ceil(u.cost * state.costMult);
        if(state.mana >= cost) {
            state.mana -= cost;
            state.units.push(new Unit(state.sel, true, x, y));
        }
    }
}

init();
