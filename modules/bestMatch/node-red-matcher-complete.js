/****************************************************
 * Node-RED Function: Intent × Entities Best Matcher (STABLE v5)
 * Version: 稳定版 - 完全兼容 Node-RED
 * 核心特性：
 * 1. 完整的中英文支持
 * 2. 楼层和房间别名映射
 * 3. 模糊匹配（忽略空格、下划线、大小写）
 * 4. 支持所有 HA 域和设备类型
 ****************************************************/

/* ===================== Payload normalizer ===================== */
function isArrayLikeObject(o) {
    if (!o || typeof o !== "object") return false;
    var keys = Object.keys(o);
    if (keys.length === 0) return false;
    var numericKeys = keys.filter(function(k) { return /^\d+$/.test(k); }).map(function(k) { return Number(k); }).sort(function(a,b) { return a-b; });
    if (numericKeys.length < 2) return false;
    for (var i = 0; i < numericKeys.length; i++) {
        if (numericKeys[i] !== i) return false;
    }
    return true;
}

function extractFirstBracketBlock(s) {
    var start = s.indexOf('[');
    var end = s.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return s;
    return s.slice(start, end + 1);
}

function normalizePayload(x) {
    if (Array.isArray(x)) return x;
    if (typeof x === "string") {
        var onlyJson = extractFirstBracketBlock(x.replace(/\r/g, "").replace(/\n[ \t]+/g, "\n").trim());
        try { var a = JSON.parse(onlyJson); if (Array.isArray(a)) return a; } catch(e) {}
        try { var o = JSON.parse(onlyJson); if (o && o.intent && o.entities) return [o.intent, o.entities]; } catch(e) {}
    }
    if (x && typeof x === "object" && x.intent && x.entities) {
        return [x.intent, x.entities];
    }
    if (isArrayLikeObject(x)) {
        var arr = [];
        var i = 0;
        while (String(i) in x) { arr.push(x[String(i)]); i++; }
        return arr;
    }
    var cand = (x && (x.data || x.payload || x.body)) || null;
    if (cand != null) return normalizePayload(cand);
    return null;
}

var payload = normalizePayload(msg.payload);
if (!Array.isArray(payload) || payload.length < 2) {
    node.error("payload must be [intent, entities]");
    msg.payload = { error: "payload must be [intent, entities]" };
    return msg;
}

var intent = payload[0];
var entities = payload[1];

if (typeof intent === "string") { try { intent = JSON.parse(intent); } catch(e) {} }
if (typeof entities === "string") { try { entities = JSON.parse(entities); } catch(e) {} }

if (Array.isArray(entities) && entities.length === 1 && Array.isArray(entities[0])) {
    entities = entities[0];
}

if (!intent || typeof intent !== "object") { 
    msg.payload = { error: "intent is not an object" }; 
    return msg; 
}
if (!Array.isArray(entities)) { 
    msg.payload = { error: "entities is not an array" }; 
    return msg; 
}

/* ===================== Normalization & Similarity ===================== */
function norm(s) {
    if (!s) return "";
    var result = String(s).toLowerCase();
    result = result.replace(/\s+/g, "");
    result = result.replace(/[_-]/g, "");
    result = result.replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");
    return result.trim();
}

function fuzzyMatch(a, b) {
    if (!a || !b) return false;
    return norm(a) === norm(b);
}

function jaroWinkler(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    var md = Math.floor(Math.max(a.length, b.length) / 2) - 1;
    var aM = new Array(a.length).fill(false);
    var bM = new Array(b.length).fill(false);
    var m = 0, t = 0;
    
    for (var i = 0; i < a.length; i++) {
        var start = Math.max(0, i - md);
        var end = Math.min(i + md + 1, b.length);
        for (var j = start; j < end; j++) {
            if (bM[j]) continue;
            if (a[i] !== b[j]) continue;
            aM[i] = true; bM[j] = true; m++; break;
        }
    }
    if (m === 0) return 0;
    var k = 0;
    for (var i = 0; i < a.length; i++) {
        if (!aM[i]) continue;
        while (!bM[k]) k++;
        if (a[i] !== b[k]) t++;
        k++;
    }
    var jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
    var p = 0; 
    var maxP = 4;
    for (var i = 0; i < Math.min(maxP, a.length, b.length); i++) {
        if (a[i] === b[i]) p++; else break;
    }
    return jaro + p * 0.1 * (1 - jaro);
}

function slotSim(queryText) {
    var args = Array.prototype.slice.call(arguments, 1);
    var q = norm(queryText || "");
    if (!q) return { score: 0, hit: "" };
    var validCands = args.filter(Boolean).map(String);
    if (validCands.length === 0) return { score: 0, hit: "" };
    var bestScore = 0;
    var bestHit = "";
    for (var i = 0; i < validCands.length; i++) {
        var cand = validCands[i];
        var c = norm(cand);
        if (!c) continue;
        if (q === c) {
            return { score: 1.0, hit: cand };
        }
        var score = jaroWinkler(q, c);
        if (score > bestScore) {
            bestScore = score;
            bestHit = cand;
        }
    }
    return { score: bestScore, hit: bestHit };
}

/* ===================== 泛指设备名词典 ===================== */
var GENERIC_DEVICE_NAMES = {
    "light": true, "lights": true, "lamp": true, "lamps": true, "deng": true, "灯": true, "灯光": true, "灯具": true, "照明": true,
    "switch": true, "switches": true, "kaiguan": true, "开关": true,
    "socket": true, "sockets": true, "chazuo": true, "插座": true, "outlet": true, "plug": true,
    "ac": true, "aircon": true, "kongtiao": true, "空调": true, "冷气": true, "climate": true,
    "fan": true, "fans": true, "fengshan": true, "风扇": true,
    "cover": true, "covers": true, "chuanglian": true, "窗帘": true, "curtain": true, "blind": true,
    "lock": true, "locks": true, "suo": true, "锁": true, "门锁": true,
    "camera": true, "cameras": true, "cam": true, "shexiangtou": true, "摄像头": true, "监控": true,
    "sensor": true, "sensors": true, "chuanganqi": true, "传感器": true,
    "temperature": true, "temp": true, "wendu": true, "温度": true, "temperaturesensor": true, "温度传感器": true,
    "humidity": true, "shidu": true, "湿度": true, "湿度传感器": true,
    "motion": true, "renti": true, "人体": true
};

/* ===================== 房间别名映射 ===================== */
var ROOM_ALIASES = {
    "living_room": ["客厅", "keting", "living", "livingroom", "living_room", "lounge"],
    "bedroom": ["卧室", "woshi", "bedroom", "bed_room"],
    "master_bedroom": ["主卧", "zhuwo", "master", "masterbedroom", "master_bedroom"],
    "kitchen": ["厨房", "chufang", "kitchen"],
    "bathroom": ["浴室", "卫生间", "yushi", "weishengjian", "bathroom", "washroom"],
    "study": ["书房", "shufang", "study", "office"],
    "dining_room": ["餐厅", "canting", "dining", "diningroom", "dining_room"],
    "garage": ["车库", "cheku", "garage"],
    "garden": ["花园", "后院", "huayuan", "houyuan", "garden", "backyard", "yard"],
    "balcony": ["阳台", "yangtai", "balcony"],
    "entertainment": ["娱乐室", "影音室", "yuleshi", "entertainment", "tvroom", "tv_room"]
};

function normalizeRoom(input) {
    if (!input) return "";
    var normalized = norm(input);
    for (var roomType in ROOM_ALIASES) {
        if (normalized === norm(roomType)) return roomType;
        var aliases = ROOM_ALIASES[roomType];
        for (var i = 0; i < aliases.length; i++) {
            if (normalized === norm(aliases[i])) return roomType;
        }
    }
    return normalized;
}

/* ===================== 楼层别名映射 ===================== */
var FLOOR_ALIASES = {
    "1": ["一楼", "1楼", "yilou", "first", "firstfloor", "first_floor", "ground"],
    "2": ["二楼", "2楼", "erlou", "second", "secondfloor", "second_floor"],
    "3": ["三楼", "3楼", "sanlou", "third", "thirdfloor", "third_floor"]
};

function normalizeFloor(input) {
    if (!input) return "";
    var normalized = norm(input);
    if (/^\d+$/.test(normalized)) return normalized;
    for (var level in FLOOR_ALIASES) {
        if (normalized === level) return level;
        var aliases = FLOOR_ALIASES[level];
        for (var i = 0; i < aliases.length; i++) {
            if (normalized === norm(aliases[i])) return level;
        }
    }
    return normalized;
}

/* ===================== HA 域映射 ===================== */
var HA_DOMAIN_ALIASES = {
    "light": ["light", "lights", "lamp", "deng", "灯"],
    "switch": ["switch", "kaiguan", "开关", "socket", "chazuo", "插座"],
    "climate": ["climate", "ac", "aircon", "kongtiao", "空调"],
    "fan": ["fan", "fengshan", "风扇"],
    "cover": ["cover", "chuanglian", "窗帘"],
    "camera": ["camera", "cam", "shexiangtou", "摄像头"],
    "sensor": ["sensor", "chuanganqi", "传感器"]
};

function normalizeDomain(input) {
    if (!input) return "";
    var normalized = norm(input);
    for (var domain in HA_DOMAIN_ALIASES) {
        if (normalized === norm(domain)) return domain;
        var aliases = HA_DOMAIN_ALIASES[domain];
        for (var i = 0; i < aliases.length; i++) {
            if (normalized === norm(aliases[i])) return domain;
        }
    }
    return input.toLowerCase();
}

function isGenericDeviceName(name) {
    if (!name) return false;
    return GENERIC_DEVICE_NAMES[norm(name)] === true;
}

/* ===================== Thresholds / Weights ===================== */
var TH = { 
    floor: 0.70,
    room: 0.70,
    type: 0.65,
    name: 0.45  // ⭐ 降低设备名称阈值以支持 lamp/light 等同义词匹配
};

var W = { 
    F: 0.15,
    R: 0.40,
    N: 0.30,
    T: 0.15
};

var BEST_K = 100;
var DISAMBIG_GAP = 0.08;

/* ===================== Triplet Scoring ===================== */
function scoreTriplet(dev, e) {
    var ev = {};
    
    // Floor matching - ⭐ 优先使用 _en 字段
    var floorQ = dev.floor_name_en || dev.floor_type || dev.floor_name || "";
    var eFloorName = e.floor_name || "";
    var eFloorNameEn = e.floor_name_en || "";
    var eFloorType = e.floor_type || "";
    var eLevel = (e.level != null ? String(e.level) : "");
    
    var floorScore = 0;
    if (floorQ) {
        if (fuzzyMatch(floorQ, eFloorName) || fuzzyMatch(floorQ, eFloorNameEn) || 
            fuzzyMatch(floorQ, eFloorType) || fuzzyMatch(floorQ, eLevel)) {
            floorScore = 1.0;
        } else {
            var normalizedFloorQ = normalizeFloor(floorQ);
            var normalizedEFloorName = normalizeFloor(eFloorName);
            var normalizedEFloorNameEn = normalizeFloor(eFloorNameEn);
            var normalizedEFloorType = normalizeFloor(eFloorType);
            
            if (normalizedFloorQ === normalizedEFloorName ||
                normalizedFloorQ === normalizedEFloorNameEn ||
                normalizedFloorQ === normalizedEFloorType ||
                normalizedFloorQ === eLevel) {
                floorScore = 1.0;
            } else {
                var sim = slotSim(floorQ, eFloorName, eFloorNameEn, eFloorType, eLevel);
                floorScore = sim.score;
            }
        }
    }
    ev.floor = { text: floorQ, hit: floorScore >= 0.9 ? (eFloorNameEn || eFloorName || eFloorType) : "", score: floorScore };
    
    // Room matching - ⭐ 优先使用 _en 字段
    var roomQ = dev.room_name_en || dev.room_type || dev.room_name || "";
    var eRoomName = e.room_name || "";
    var eRoomNameEn = e.room_name_en || "";
    var eRoomType = e.room_type || "";
    
    var roomScore = 0;
    if (roomQ) {
        if (fuzzyMatch(roomQ, eRoomName) || fuzzyMatch(roomQ, eRoomNameEn) || fuzzyMatch(roomQ, eRoomType)) {
            roomScore = 1.0;
        } else {
            var normalizedRoomQ = normalizeRoom(roomQ);
            var normalizedERoomName = normalizeRoom(eRoomName);
            var normalizedERoomNameEn = normalizeRoom(eRoomNameEn);
            var normalizedERoomType = normalizeRoom(eRoomType);
            
            if (normalizedRoomQ === normalizedERoomName ||
                normalizedRoomQ === normalizedERoomNameEn ||
                normalizedRoomQ === normalizedERoomType) {
                roomScore = 1.0;
            } else {
                var sim = slotSim(roomQ, eRoomName, eRoomNameEn, eRoomType);
                roomScore = sim.score;
            }
        }
    }
    ev.room = { text: roomQ, hit: roomScore >= 0.9 ? (eRoomNameEn || eRoomName || eRoomType) : "", score: roomScore };
    
    // Device name matching - ⭐ 优先使用 _en 字段
    var nameQ = dev.device_name_en || dev.device_name || "";
    var nameSim = slotSim(nameQ, e.device_name, e.attributes && e.attributes.friendly_name ? e.attributes.friendly_name : null);
    
    // ✅ 声明所有变量
    var nameContainsLocation = false;
    var extractedLocation = "";
    var locationMatchBonus = 0;
    
    // ✅ 特殊处理：检查设备名是否包含位置信息
    if (nameQ) {
        var normalizedNameQ = norm(nameQ);
        // 检查是否包含房间名称
        for (var roomType in ROOM_ALIASES) {
            if (normalizedNameQ.indexOf(norm(roomType)) !== -1) {
                nameContainsLocation = true;
                extractedLocation = roomType;
                break;
            }
            var aliases = ROOM_ALIASES[roomType];
            for (var i = 0; i < aliases.length; i++) {
                if (normalizedNameQ.indexOf(norm(aliases[i])) !== -1) {
                    nameContainsLocation = true;
                    extractedLocation = roomType;
                    break;
                }
            }
            if (nameContainsLocation) break;
        }
    }
    
    // ✅ 如果设备名包含位置，检查位置是否匹配
    if (nameContainsLocation && extractedLocation) {
        var locNormalizedERoomName = normalizeRoom(eRoomName);
        var locNormalizedERoomNameEn = normalizeRoom(eRoomNameEn);
        var locNormalizedERoomType = normalizeRoom(eRoomType);
        
        if (extractedLocation === locNormalizedERoomName ||
            extractedLocation === locNormalizedERoomNameEn ||
            extractedLocation === locNormalizedERoomType) {
            locationMatchBonus = 0.4;
        }
    }
    
    ev.device_name = { text: nameQ, hit: nameSim.hit, score: nameSim.score };
    
    // Type matching
    var typeQ = (dev.device_type || "").toLowerCase() || (dev.service ? dev.service.split(".")[0].toLowerCase() : "");
    var eType = (e.device_type || "").toLowerCase();
    var eDomain = e.entity_id ? e.entity_id.split(".")[0] : "";
    
    var normalizedTypeQ = normalizeDomain(typeQ);
    var normalizedEDomain = normalizeDomain(eDomain);
    
    var typeScore = 0;
    if (normalizedTypeQ) {
        if (normalizedTypeQ === normalizedEDomain || normalizedTypeQ === norm(eType) || 
            fuzzyMatch(typeQ, eDomain) || fuzzyMatch(typeQ, eType)) {
            typeScore = 1.0;
        } else {
            var sim1 = jaroWinkler(norm(normalizedTypeQ), norm(normalizedEDomain));
            var sim2 = jaroWinkler(norm(normalizedTypeQ), norm(eType));
            typeScore = Math.max(sim1, sim2);
        }
    }
    ev.device_type = { text: typeQ, hit: typeScore >= 0.9 ? (normalizedEDomain || eType) : "", score: typeScore };
    
    // All devices scenario
    var isAllDevices = !floorQ && !roomQ && !nameQ && typeQ;
    if (isAllDevices) {
        if (typeQ && typeScore >= 0.90) {
            return { score: 0.80, ev: ev, warnings: [] };
        } else {
            return { score: -1, ev: ev, warnings: [] };
        }
    }
    
    // Threshold checks
    var floorPass = floorQ ? floorScore >= TH.floor : true;
    var roomPass = roomQ ? roomScore >= TH.room : true;
    var namePass = nameQ ? nameSim.score >= TH.name : true;
    var typePass = typeQ ? typeScore >= 0.90 : true;
    
    var isGenericName = isGenericDeviceName(nameQ);
    
    // Floor only mode
    var floorOnlyMode = floorQ && !roomQ && !nameQ && typeQ;
    if (floorOnlyMode) {
        if (!floorPass || !typePass || typeScore < 0.95) {
            return { score: -1, ev: ev, warnings: [] };
        }
    } else if (nameQ && !isGenericName) {
        if (!roomPass || !namePass || !typePass) {
            return { score: -1, ev: ev, warnings: [] };
        }
        if (floorQ && !floorPass) {
            return { score: -1, ev: ev, warnings: [] };
        }
    } else {
        if (!roomPass || !typePass) {
            return { score: -1, ev: ev, warnings: [] };
        }
        if (floorQ && !floorPass) {
            return { score: -1, ev: ev, warnings: [] };
        }
    }
    
    // Calculate score
    var floorScoreWeight = floorQ ? floorScore : 0.90;
    var nameScore = (nameQ && !isGenericName && !shouldUseLocationMatching) ? nameSim.score : 0.85;
    
    var base = W.F * floorScoreWeight + W.R * roomScore + W.N * nameScore + W.T * typeScore;
    
    // ✅ 添加位置匹配奖励
    base += locationMatchBonus;
    
    var warnings = [];
    
    // Bonuses
    if (roomQ && roomScore >= 0.98) base += 0.10;
    if (nameQ && !isGenericName && nameSim.score >= 0.98) base += 0.05;
    if (floorQ && floorScore >= 0.98) base += 0.03;
    
    // Domain check
    if (dev.service) {
        var svcDomain = dev.service.split(".")[0].toLowerCase();
        var normalizedSvcDomain = normalizeDomain(svcDomain);
        if (normalizedSvcDomain && normalizedEDomain) {
            if (normalizedSvcDomain === normalizedEDomain) {
                base += 0.03;
            } else {
                warnings.push("Service domain mismatch for " + e.entity_id);
            }
        }
    }
    
    return { score: base, ev: ev, warnings: warnings };
}

/* ===================== Matching Pipeline ===================== */
function matchEntities(intent, allEntities) {
    var out = {
        intent: intent.intent,
        user_input: intent.user_input,
        actions: [],
        matched_devices: []
    };
    
    var devices = Array.isArray(intent.devices) ? intent.devices : [];
    
    for (var d = 0; d < devices.length; d++) {
        var dev = devices[d];
        var svcDomain = dev.service ? dev.service.split(".")[0].toLowerCase() : ((dev.device_type || "").toLowerCase());
        var normalizedSvcDomain = normalizeDomain(svcDomain);
        
        var pool = allEntities.filter(function(e) {
            if (!normalizedSvcDomain) return true;
            var eDomain = e.entity_id ? e.entity_id.split(".")[0] : "";
            var eType = (e.device_type || "").toLowerCase();
            var normalizedEDomain = normalizeDomain(eDomain);
            return (normalizedEDomain === normalizedSvcDomain) || !!dev.device_name || !!dev.device_name_en;
        });
        
        var scored = pool.map(function(e) {
            var result = scoreTriplet(dev, e);
            return { e: e, score: result.score, ev: result.ev, warnings: result.warnings };
        }).filter(function(x) { return x.score >= 0; });
        
        scored.sort(function(a, b) { return b.score - a.score; });
        var topK = scored.slice(0, BEST_K);
        
        var warnings = [];
        for (var i = 0; i < topK.length; i++) {
            for (var j = 0; j < topK[i].warnings.length; j++) {
                warnings.push(topK[i].warnings[j]);
            }
        }
        
        if (topK.length > 0) {
            for (var i = 0; i < topK.length; i++) {
                out.matched_devices.push({
                    entity_id: topK[i].e.entity_id,
                    service: dev.service || null,
                    service_data: dev.service_data || {}
                });
            }
        }
        
        var suggestions = [];
        if (topK.length === 0) {
            var floorQ = dev.floor_name || dev.floor_name_en || dev.floor_type || "";
            var roomQ = dev.room_name || dev.room_name_en || dev.room_type || "";
            var nameQ = dev.device_name || dev.device_name_en || "";
            var typeQ = (dev.device_type || "").toLowerCase() || (dev.service ? dev.service.split(".")[0].toLowerCase() : "");
            
            var loose = pool.map(function(e) {
                var eType = (e.device_type || "").toLowerCase();
                var s = 0.15 * slotSim(floorQ, e.floor_name, e.floor_name_en, e.floor_type).score +
                        0.40 * slotSim(roomQ, e.room_name, e.room_name_en, e.room_type).score +
                        0.30 * slotSim(nameQ, e.device_name, e.attributes && e.attributes.friendly_name ? e.attributes.friendly_name : null).score +
                        0.15 * slotSim(typeQ, eType).score;
                return { e: e, s: s };
            }).sort(function(a, b) { return b.s - a.s; }).slice(0, 3);
            
            suggestions = loose.map(function(x) {
                return {
                    entity_id: x.e.entity_id,
                    device_name: x.e.device_name || (x.e.attributes && x.e.attributes.friendly_name) || "",
                    room: x.e.room_name_en || x.e.room_name || "",
                    floor: x.e.floor_name_en || x.e.floor_name || "",
                    reason_score: Number(x.s.toFixed(3))
                };
            });
        }
        
        out.actions.push({
            request: {
                floor: dev.floor_name_en || dev.floor_type || dev.floor_name || null,
                room: dev.room_name_en || dev.room_type || dev.room_name || null,
                device_name: dev.device_name_en || dev.device_name || null,
                device_type: (dev.device_type || (dev.service ? dev.service.split(".")[0] : null)) || null,
                service: dev.service || null,
                service_data: dev.service_data || {}
            },
            targets: topK.map(function(item) {
                return {
                    entity_id: item.e.entity_id,
                    device_type: (item.e.device_type || "").toLowerCase(),
                    device_name: item.e.device_name || (item.e.attributes && item.e.attributes.friendly_name) || "",
                    floor: item.e.floor_name_en || item.e.floor_name || "",
                    room: item.e.room_name_en || item.e.room_name || "",
                    score: Number(item.score.toFixed(3)),
                    matched: {
                        floor: item.ev.floor,
                        room: item.ev.room,
                        device_name: item.ev.device_name,
                        device_type: item.ev.device_type
                    }
                };
            }),
            disambiguation_required: topK.length >= 2 && (topK[0].score - topK[1].score) < DISAMBIG_GAP,
            warnings: warnings,
            suggestions_if_empty: suggestions
        });
    }
    
    if (!Array.isArray(out.matched_devices)) out.matched_devices = [];
    return out;
}

/* ===================== Execute ===================== */
try {
    var result = matchEntities(intent, entities);
    msg.payload = result;
    return msg;
} catch (err) {
    node.error(err.message || String(err), err);
    msg.payload = { error: String(err) };
    return msg;
}