// Unit definitions
const UNIT_DEFS = {
    knight:  { name:'KNIGHT', cost:15, hp:200, dmg:22, range:25,  speed:0.8, rate:45, type:'melee',  mass:1.2, kb:3,   sprite: SPRITES.knight },
    archer:  { name:'ARCHER', cost:25, hp:90,  dmg:14, range:160, speed:0.7, rate:55, type:'ranged', mass:0.8, kb:1,   sprite: SPRITES.archer },
    wizard:  { name:'MAGE',   cost:45, hp:80,  dmg:40, range:130, speed:0.6, rate:85, type:'aoe',    mass:0.7, kb:12,  sprite: SPRITES.wizard, splash:50 },
    healer:  { name:'CLERIC', cost:35, hp:120, dmg:-18,range:110, speed:0.7, rate:65, type:'healer', mass:0.8, kb:0.5, sprite: SPRITES.wizard },
    giant:   { name:'GOLEM',  cost:80, hp:1000,dmg:65, range:35,  speed:0.35,rate:130,type:'tank',   mass:5.0, kb:30,  sprite: SPRITES.giant },
    // Enemy units
    goblin:   { name:'GOBLIN',   hp:60,  dmg:12, range:20,  speed:0.7, rate:50, type:'melee',  mass:0.6, kb:1, sprite: SPRITES.goblin },
    orc:      { name:'ORC',      hp:120, dmg:20, range:25,  speed:0.5, rate:60, type:'melee',  mass:1.5, kb:3, sprite: SPRITES.orc },
    skeleton: { name:'SKELETON', hp:40,  dmg:8,  range:100, speed:0.6, rate:70, type:'ranged', mass:0.5, kb:1, sprite: SPRITES.skeleton }
};

// Wave configurations - enemy waves before boss
const WAVE_CONFIGS = {
    1: {
        enemyWaves: [
            { enemies: [{type:'goblin', count:3}], delay: 0 },
            { enemies: [{type:'goblin', count:4}], delay: 180 },
            { enemies: [{type:'goblin', count:5}], delay: 180 }
        ]
    },
    2: {
        enemyWaves: [
            { enemies: [{type:'goblin', count:4}, {type:'orc', count:1}], delay: 0 },
            { enemies: [{type:'goblin', count:3}, {type:'orc', count:2}], delay: 180 },
            { enemies: [{type:'orc', count:3}], delay: 180 }
        ]
    },
    3: {
        enemyWaves: [
            { enemies: [{type:'skeleton', count:3}, {type:'goblin', count:2}], delay: 0 },
            { enemies: [{type:'skeleton', count:4}, {type:'orc', count:1}], delay: 180 },
            { enemies: [{type:'skeleton', count:3}, {type:'orc', count:2}], delay: 180 }
        ]
    },
    4: {
        enemyWaves: [
            { enemies: [{type:'goblin', count:5}, {type:'skeleton', count:3}], delay: 0 },
            { enemies: [{type:'orc', count:3}, {type:'skeleton', count:3}], delay: 180 },
            { enemies: [{type:'orc', count:4}, {type:'skeleton', count:2}], delay: 180 }
        ]
    },
    5: {
        enemyWaves: [
            { enemies: [{type:'skeleton', count:5}, {type:'orc', count:2}], delay: 0 },
            { enemies: [{type:'skeleton', count:4}, {type:'orc', count:3}], delay: 180 },
            { enemies: [{type:'skeleton', count:6}, {type:'orc', count:2}], delay: 180 }
        ]
    },
    6: {
        enemyWaves: [
            { enemies: [{type:'orc', count:5}, {type:'skeleton', count:4}], delay: 0 },
            { enemies: [{type:'orc', count:4}, {type:'skeleton', count:5}], delay: 180 },
            { enemies: [{type:'orc', count:6}, {type:'skeleton', count:3}], delay: 180 }
        ]
    },
    7: {
        enemyWaves: [
            { enemies: [{type:'goblin', count:8}, {type:'orc', count:4}], delay: 0 },
            { enemies: [{type:'orc', count:6}, {type:'skeleton', count:6}], delay: 180 },
            { enemies: [{type:'orc', count:5}, {type:'skeleton', count:8}], delay: 180 }
        ]
    }
};

// Boss Definitions
const BOSS_DEFS = {
    1: { 
        name:'Goblin Warchief', 
        hp:800, 
        dmg:30, 
        speed:0.7, 
        special:'summon', 
        palette:PALETTES.boss_goblin,
        sprite: SPRITES.boss_orc,
        summonType: 'goblin',
        summonCount: 2,
        summonInterval: 240
    },
    2: { 
        name:'Stone Golem', 
        hp:1500, 
        dmg:50, 
        speed:0.4, 
        special:'armor', 
        palette:PALETTES.boss_golem,
        sprite: SPRITES.giant,
        armorReduction: 0.5  // Takes 50% damage
    },
    3: { 
        name:'Shadow Assassin', 
        hp:1000, 
        dmg:60, 
        speed:1.2, 
        special:'teleport', 
        palette:PALETTES.boss_assassin,
        sprite: SPRITES.boss_skeleton,
        teleportInterval: 200
    },
    4: { 
        name:'Flame Drake', 
        hp:2000, 
        dmg:40, 
        speed:0.6, 
        special:'fire', 
        palette:PALETTES.boss_drake,
        sprite: SPRITES.boss_dragon,
        fireInterval: 180,
        fireDamage: 25
    },
    5: { 
        name:'Necro Lord', 
        hp:2500, 
        dmg:35, 
        speed:0.5, 
        special:'revive', 
        palette:PALETTES.boss_necro,
        sprite: SPRITES.boss_skeleton,
        reviveChance: 0.3,
        reviveInterval: 300
    },
    6: { 
        name:'Ancient Construct', 
        hp:3000, 
        dmg:70, 
        speed:0.3, 
        special:'laser', 
        palette:PALETTES.boss_construct,
        sprite: SPRITES.giant,
        laserInterval: 240,
        laserDamage: 100
    },
    7: { 
        name:'Chaos Titan', 
        hp:5000, 
        dmg:100, 
        speed:0.4, 
        special:'phases', 
        palette:PALETTES.boss_titan,
        sprite: SPRITES.boss_demon,
        phases: [
            { hpThreshold: 1.0, speedMult: 1.0, damageMult: 1.0 },
            { hpThreshold: 0.66, speedMult: 1.3, damageMult: 1.2 },
            { hpThreshold: 0.33, speedMult: 1.6, damageMult: 1.5 }
        ]
    }
};

// Skill Definitions
const SKILL_DEFS = {
    meteor: { name:'Meteor Storm', icon:'☄️', cooldown:90, effect:'全敵に150ダメージ' },
    judgment: { name:'Holy Judgment', icon:'⚡', cooldown:70, effect:'中央範囲400ダメージ' },
    heal: { name:'Mass Heal', icon:'💚', cooldown:100, effect:'全体回復+拠点+400' },
    timewarp: { name:'Time Warp', icon:'⏰', cooldown:80, effect:'敵速度50%減少8秒' },
    angel: { name:'Angel Guardian', icon:'👼', cooldown:110, effect:'強力ユニット召喚25秒' },
    surge: { name:'Mana Surge', icon:'💎', cooldown:60, effect:'マナ回復3倍15秒' }
};

// Upgrade Definitions
const UPGRADE_DEFS = {
    atk_boost: { name:'Attack Boost', icon:'⚔️', effect:'全ユニット攻撃力+20%' },
    hp_boost: { name:'Health Boost', icon:'❤️', effect:'全ユニットHP+25%' },
    speed_boost: { name:'Speed Boost', icon:'💨', effect:'全ユニット速度+30%' },
    range_ext: { name:'Range Extension', icon:'🎯', effect:'遠距離ユニット射程+20%' },
    atk_speed: { name:'Attack Speed', icon:'⚡', effect:'攻撃間隔-15%' },
    mana_flow: { name:'Mana Flow', icon:'💧', effect:'マナ回復速度+40%' },
    mana_accel: { name:'Mana Acceleration', icon:'⚡💧', effect:'マナ回復速度+60%' },
    cost_reduce: { name:'Cost Reduction', icon:'💰', effect:'配置コスト-15%' },
    start_mana: { name:'Starting Mana', icon:'🔷', effect:'初期マナ+30' },
    fortified: { name:'Fortified Base', icon:'🏰', effect:'拠点最大HP+500' },
    regen: { name:'Base Regeneration', icon:'💚', effect:'拠点HP毎秒5回復' },
    counter: { name:'Counter Strike', icon:'🛡️', effect:'拠点攻撃に50返し' },
    vampire: { name:'Vampire', icon:'🧛', effect:'与ダメ10%吸収' },
    thorns: { name:'Thorns', icon:'🌵', effect:'被ダメ30%反射' }
};
