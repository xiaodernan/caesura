import json, io, os
os.makedirs('src/data/json', exist_ok=True)

player = {
  "hp": 120, "stamina": 100, "poise": 60, "defense": 10,
  "moveSpeed": 4.6, "sprintSpeed": 6.8, "sprintCostPerSec": 10, "jumpSpeed": 6.4, "gravity": 19.6,
  "staminaRegen": {"hardDelay": 30, "slowPerSec": 22, "slowTicks": 72, "fastPerSec": 38},
  "guard": {"startupTicks": 6, "reduction": 0.55, "staPerDmg": 1.2, "bleedPoiseFrac": 0.25},
  "perfectBlockWindow": 5,
  "parry": {"activeTicks": 6, "whiffRecovery": 27, "poiseDamage": 25, "stunTicks": 18, "overdriveGain": 2},
  "roll": {"total": 30, "iframeStart": 9, "iframeEnd": 21, "dist": 3.2, "backDist": 2.6, "stamina": 14, "lockOnDist": 1.6, "lockOnIframes": [4, 16]},
  "execution": {"hpFrac": 0.12, "flat": 30},
  "attrs": {"str": 10, "dex": 10, "ton": 10, "vig": 10, "ovr": 10, "fis": 10},
  "attrUpCost": 1,
  "rankXpCurve": {"base": 60, "a": 8, "b": 20}
}

ms_sword = {"id": "ms_sword", "actions": {
  "l1": {"startup": 12, "activeStart": 12, "activeEnd": 18, "recovery": 30, "damage": 9, "stamina": 9, "poise": 6, "hitStopMs": 60,
         "hitbox": {"shape": "cone", "angleDeg": 100, "radius": 2.1, "height": 1.6, "offsetY": 0.9},
         "lunge": 0.35, "shake": "graze", "sfx": ["swing_1"], "vfx": ["trail_sword"], "loudness": 3, "next": "l2"},
  "l2": {"startup": 11, "activeStart": 11, "activeEnd": 17, "recovery": 29, "damage": 9, "stamina": 9, "poise": 6, "hitStopMs": 60,
         "hitbox": {"shape": "cone", "angleDeg": 100, "radius": 2.1, "height": 1.6, "offsetY": 0.9},
         "lunge": 0.35, "shake": "graze", "sfx": ["swing_2"], "vfx": ["trail_sword"], "loudness": 3, "next": "l3"},
  "l3": {"startup": 13, "activeStart": 13, "activeEnd": 20, "recovery": 34, "damage": 12, "stamina": 10, "poise": 9, "hitStopMs": 60,
         "hitbox": {"shape": "cone", "angleDeg": 110, "radius": 2.2, "height": 1.9, "offsetY": 1.0},
         "lunge": 0.4, "shake": "graze", "sfx": ["swing_1"], "vfx": ["trail_sword"], "loudness": 3, "next": "l4", "flags": ["launchSmall"]},
  "l4": {"startup": 15, "activeStart": 15, "activeEnd": 24, "recovery": 45, "damage": 18, "stamina": 12, "poise": 14, "hitStopMs": 90,
         "hitbox": {"shape": "cone", "angleDeg": 120, "radius": 2.6, "height": 1.7, "offsetY": 0.9},
         "lunge": 1.1, "shake": "normal", "sfx": ["swing_heavy_1"], "vfx": ["trail_sword", "ring_echo"], "loudness": 4, "flags": ["echo"]},
  "h": {"startup": 30, "activeStart": 30, "activeEnd": 39, "recovery": 63, "damage": 28, "stamina": 20, "poise": 24, "hitStopMs": 90,
        "hitbox": {"shape": "cone", "angleDeg": 70, "radius": 2.6, "height": 2.2, "offsetY": 1.1},
        "shake": "normal", "sfx": ["swing_heavy_2"], "vfx": ["trail_sword", "shock_small"], "loudness": 5, "flags": ["groundshock"]},
  "charged": {"startup": 20, "activeStart": 20, "activeEnd": 29, "recovery": 56, "damage": 42, "stamina": 28, "poise": 40, "hitStopMs": 120,
              "hitbox": {"shape": "cone", "angleDeg": 80, "radius": 3.0, "height": 2.4, "offsetY": 1.1},
              "lunge": 0.6, "shake": "heavy", "sfx": ["chord_slam"], "vfx": ["trail_sword", "spike_chord"], "loudness": 7, "flags": ["hyper"]},
  "run": {"startup": 20, "activeStart": 20, "activeEnd": 26, "recovery": 44, "damage": 16, "stamina": 12, "poise": 12, "hitStopMs": 90,
          "hitbox": {"shape": "cone", "angleDeg": 45, "radius": 2.8, "height": 1.5, "offsetY": 0.9},
          "lunge": 2.0, "shake": "normal", "sfx": ["thrust_1"], "vfx": ["trail_thrust"], "loudness": 4},
  "jump": {"startup": 15, "activeStart": 15, "activeEnd": 24, "recovery": 48, "damage": 18, "stamina": 14, "poise": 14, "hitStopMs": 90,
           "hitbox": {"shape": "ring", "inner": 0.4, "outer": 2.0, "forward": 0},
           "shake": "normal", "sfx": ["land_slam"], "vfx": ["ring_dust"], "loudness": 6}
}}

weapons = [{
  "id": "wp_tuning_sword", "nameKey": "weapon.tuningSword", "archetype": "straight_sword",
  "movesetId": "ms_sword", "atkBase": 12, "scaling": {"str": 0.6, "dex": 0.9},
  "swingTag": ["damage.physical", "crit.backstab2.0", "parryable"], "skill": "sk_sword_resonant_cut",
  "noiseMul": 1.0
}]

enemies = [
  {"id": "en_murkshell", "nameKey": "enemy.murkshell", "archetype": "basic",
   "hp": 45, "poise": 20, "speed": 3.0,
   "ai": {"vision": {"range": 12, "fovDeg": 80}, "vibration": {"range": 8}, "hearing": {"range": 15},
          "distBands": [{"min": 0, "max": 1.9, "actions": ["bite", "shellburst"]}, {"min": 1.9, "max": 99, "actions": ["chase"]}],
          "retreatHpFrac": 0.2, "callAlly": {"range": 14, "broadcastTicks": 36}},
   "attacks": [
     {"id": "bite", "beat": [1], "parryable": True, "reaction": "R1",
      "frames": {"startup": 24, "activeStart": 24, "activeEnd": 30, "recovery": 48, "damage": 7, "stamina": 0, "poise": 6, "hitStopMs": 60,
                 "hitbox": {"shape": "cone", "angleDeg": 60, "radius": 1.6, "height": 1.2, "offsetY": 0.6}, "lunge": 0.5, "loudness": 2, "sfx": ["gnash"]},
      "statusOnHit": {"tag": "status.fissure", "layers": 1}},
     {"id": "shellburst", "beat": [3], "parryable": True, "reaction": "R2",
      "frames": {"startup": 30, "activeStart": 30, "activeEnd": 39, "recovery": 60, "damage": 10, "stamina": 0, "poise": 10, "hitStopMs": 80,
                 "hitbox": {"shape": "ring", "inner": 0.3, "outer": 2.2, "forward": 0}, "loudness": 4, "sfx": ["burst_shell"]}}],
   "weakpoint": {"dmgMul": 1.8},
   "drops": [{"tableId": "loot_basic", "chance": 0.65}],
   "body": {"scale": 0.8, "color": 5397336, "emissive": 11178859, "coreColor": 8316080}, "tint": "shared_alert"},
  {"id": "en_driftsinger", "nameKey": "enemy.driftsinger", "archetype": "basic",
   "hp": 70, "poise": 26, "speed": 3.6,
   "ai": {"vision": {"range": 22, "fovDeg": 100}, "vibration": {"range": 5}, "hearing": {"range": 12},
          "distBands": [{"min": 0, "max": 2.2, "actions": ["claw1", "claw2", "claw3"]}, {"min": 2.2, "max": 99, "actions": ["chase"]}],
          "retreatHpFrac": 0.25, "callAlly": {"range": 18, "broadcastTicks": 36}},
   "attacks": [
     {"id": "claw1", "beat": [1], "parryable": True, "reaction": "R1",
      "frames": {"startup": 21, "activeStart": 21, "activeEnd": 27, "recovery": 46, "damage": 8, "stamina": 0, "poise": 6, "hitStopMs": 60,
                 "hitbox": {"shape": "cone", "angleDeg": 70, "radius": 1.9, "height": 1.5, "offsetY": 0.9}, "lunge": 0.4, "loudness": 2, "sfx": ["claw"]}},
     {"id": "claw2", "beat": [2], "parryable": True, "reaction": "R1",
      "frames": {"startup": 21, "activeStart": 21, "activeEnd": 27, "recovery": 46, "damage": 8, "stamina": 0, "poise": 6, "hitStopMs": 60,
                 "hitbox": {"shape": "cone", "angleDeg": 70, "radius": 1.9, "height": 1.5, "offsetY": 0.9}, "lunge": 0.4, "loudness": 2, "sfx": ["claw"]}},
     {"id": "claw3", "beat": [3], "parryable": True, "reaction": "R2",
      "frames": {"startup": 21, "activeStart": 21, "activeEnd": 27, "recovery": 65, "damage": 10, "stamina": 0, "poise": 10, "hitStopMs": 80,
                 "hitbox": {"shape": "cone", "angleDeg": 90, "radius": 2.1, "height": 1.6, "offsetY": 0.9}, "lunge": 0.6, "loudness": 3, "sfx": ["claw_heavy"]}},
     {"id": "scream", "beat": [1, 2, 3, 4], "parryable": False,
      "frames": {"startup": 36, "activeStart": 36, "activeEnd": 42, "recovery": 60, "damage": 0, "stamina": 0, "poise": 0, "hitStopMs": 0, "loudness": 9, "sfx": ["wail"]}}],
   "drops": [{"tableId": "loot_basic", "chance": 0.8}],
   "body": {"scale": 1.0, "color": 7694218, "emissive": 10078160, "coreColor": 13667327}},
  {"id": "en_tympanus", "nameKey": "enemy.tympanus", "archetype": "heavy",
   "hp": 240, "poise": 90, "speed": 1.8, "defense": 20,
   "ai": {"vision": {"range": 18, "fovDeg": 90}, "vibration": {"range": 10}, "hearing": {"range": 14},
          "distBands": [{"min": 0, "max": 3.2, "actions": ["mallet", "stomp"]}, {"min": 3.2, "max": 99, "actions": ["chase"]}],
          "callAlly": {"range": 16, "broadcastTicks": 48}},
   "attacks": [
     {"id": "mallet", "beat": [1], "parryable": True, "reaction": "R3",
      "frames": {"startup": 42, "activeStart": 42, "activeEnd": 54, "recovery": 92, "damage": 34, "stamina": 0, "poise": 30, "hitStopMs": 110,
                 "hitbox": {"shape": "cone", "angleDeg": 110, "radius": 3.4, "height": 2.4, "offsetY": 1.3}, "lunge": 0.8, "loudness": 6, "sfx": ["drum_sweep"]}},
     {"id": "stomp", "beat": [1], "parryable": False, "reaction": "R2",
      "frames": {"startup": 30, "activeStart": 30, "activeEnd": 39, "recovery": 66, "damage": 20, "stamina": 0, "poise": 18, "hitStopMs": 90,
                 "hitbox": {"shape": "ring", "inner": 1.0, "outer": 4.0, "forward": 0}, "loudness": 8, "sfx": ["drum_boom"],
                 "statusOnHit": {"tag": "status.mute", "layers": 1}}}],
   "weakpoint": {"dmgMul": 1.5},
   "drops": [{"tableId": "loot_heavy", "chance": 1}],
   "body": {"scale": 1.7, "color": 7031368, "emissive": 13658923, "coreColor": 16756320}}
]

for name, obj in [("player.json", player), ("movesets.json", [ms_sword]), ("weapons.json", weapons), ("enemies.json", enemies)]:
    with io.open(f'src/data/json/{name}', 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
print("data json written:", os.listdir('src/data/json'))
