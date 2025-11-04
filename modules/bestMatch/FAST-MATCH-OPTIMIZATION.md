# BestMatch 快速匹配函数优化文档

## 概述

本次优化基于 `node-red-matcher-complete.js` 的核心逻辑，对 `BestMatchModule` 中的 `tryFastMatch` 方法进行了全面升级，提供了更准确、更智能的设备匹配能力。

### 🚀 Termux 环境特别优化

在 **Termux proot Ubuntu** 环境下，系统会自动检测并**仅使用 JS 快速匹配**，不调用 Python matcher：

- ✅ **自动环境检测**：无需手动配置
- ✅ **输出格式统一**：与标准 BestMatch 接口完全一致
- ✅ **性能提升 10-30倍**：2-8ms vs 60-250ms
- ✅ **详细日志输出**：两阶段匹配全程可追踪

**详见**：[TERMUX-FAST-MATCH.md](./TERMUX-FAST-MATCH.md)

## 核心特性

### 1. 两阶段匹配策略

#### 第一步：空间信息 + 设备类型筛选
通过 `floor_name_en`, `floor_type`, `room_name_en`, `room_type`, `device_type` 筛选实体

- **1.1 设备类型筛选**: 通过 `device_type` 快速过滤实体池
- **1.2 空间信息筛选**: 
  - 支持 `floor_name_en`, `floor_type`, `floor_name` 楼层匹配
  - 支持 `room_name_en`, `room_type`, `room_name` 房间匹配
  - 使用别名映射和模糊匹配（如：客厅 = living_room = keting）

**日志输出**：
- 输入实体总数
- 类型筛选后的实体数量和列表
- 空间筛选后的实体数量和列表
- 步骤1总耗时

#### 第二步：设备名称匹配
通过 `device_name`, `device_name_en` 在第一步结果中进一步筛选

- 使用 `slotSim` 算法计算名称相似度
- 只处理非泛指设备名称（如：ceiling_light，非 "light"）
- 按相似度排序

**日志输出**：
- 输入实体数量
- 查询的设备名称
- 名称匹配后的实体数量和相似度分数
- 步骤2耗时

### 2. 精准打分算法

从 `node-red-matcher-complete.js` 移植的 `scoreTriplet` 打分函数：

```javascript
// 权重配置
const W = { 
    F: 0.15,  // 楼层权重
    R: 0.40,  // 房间权重（最高）
    N: 0.30,  // 名称权重
    T: 0.15   // 类型权重
};

// 阈值配置
const TH = { 
    floor: 0.70,
    room: 0.70,
    type: 0.65,
    name: 0.45  // 降低以支持同义词匹配
};
```

### 3. 高级匹配算法

#### Jaro-Winkler 距离算法
用于计算字符串相似度，特别适合短字符串和拼写变体：

```javascript
jaroWinkler("living_room", "livingroom")  // 返回高相似度
jaroWinkler("客厅", "keting")              // 通过别名映射处理
```

#### 槽位相似度匹配 (slotSim)
在多个候选值中找到最佳匹配：

```javascript
slotSim(queryText, candidate1, candidate2, ...)
// 返回: { score: 0.95, hit: "matched_value" }
```

### 4. 空间信息继承

如果1分钟内输入数据没有带空间信息，则自动沿用上一次的空间信息：

```javascript
// 第一次查询：客厅的灯
{ room_name_en: "living_room", device_type: "light" }

// 60秒内第二次查询：空调（没有指定房间）
{ device_type: "climate" }
// ✅ 自动继承 → { room_name_en: "living_room", device_type: "climate" }
```

实现机制：
- `locationHistory` 数组存储最近的空间信息（带时间戳）
- `inheritLocationInfo()` 方法自动处理继承逻辑
- `cleanLocationHistory()` 自动清理过期记录（超过1分钟）

### 5. 别名映射

#### 房间别名
```javascript
{
    "living_room": ["客厅", "keting", "living", "livingroom", "lounge"],
    "bedroom": ["卧室", "woshi", "bedroom", "bed_room"],
    "master_bedroom": ["主卧", "zhuwo", "master"],
    "kitchen": ["厨房", "chufang", "kitchen"],
    "bathroom": ["浴室", "卫生间", "yushi", "weishengjian"],
    // ...
}
```

#### 楼层别名
```javascript
{
    "1": ["一楼", "1楼", "yilou", "first", "firstfloor", "ground"],
    "2": ["二楼", "2楼", "erlou", "second", "secondfloor"],
    "3": ["三楼", "3楼", "sanlou", "third", "thirdfloor"]
}
```

#### 设备类型别名
```javascript
{
    "light": ["light", "lights", "lamp", "deng", "灯"],
    "switch": ["switch", "kaiguan", "开关", "socket", "chazuo", "插座"],
    "climate": ["climate", "ac", "aircon", "kongtiao", "空调"],
    "fan": ["fan", "fengshan", "风扇"],
    "cover": ["cover", "chuanglian", "窗帘"],
    // ...
}
```

### 6. 输出格式

完全兼容 BestMatch 标准输出格式：

```json
{
    "actions": [
        {
            "request": {
                "floor": "first_floor",
                "room": "living_room",
                "device_name": "ceiling_light",
                "device_type": "light",
                "service": "light.turn_on",
                "service_data": { "brightness": 255 }
            },
            "targets": [
                {
                    "entity_id": "light.living_room_ceiling",
                    "device_type": "light",
                    "device_name": "Living Room Ceiling Light",
                    "floor": "first_floor",
                    "room": "living_room",
                    "score": 0.956,
                    "matched": {
                        "floor": { "text": "first_floor", "hit": "first_floor", "score": 1.0 },
                        "room": { "text": "living_room", "hit": "living_room", "score": 1.0 },
                        "device_name": { "text": "ceiling_light", "hit": "Living Room Ceiling Light", "score": 0.85 },
                        "device_type": { "text": "light", "hit": "light", "score": 1.0 }
                    }
                }
            ],
            "disambiguation_required": false,
            "warnings": [],
            "suggestions_if_empty": []
        }
    ],
    "matched_devices": [
        {
            "entity_id": "light.living_room_ceiling",
            "service": "light.turn_on",
            "service_data": { "brightness": 255 }
        }
    ]
}
```

## 使用场景

### 场景1: 完整空间信息 + 设备名称
```javascript
{
    floor_name_en: "first_floor",
    room_name_en: "living_room",
    device_name: "ceiling_light",
    device_type: "light"
}
// ✅ 精确匹配到客厅的吸顶灯
```

### 场景2: 仅空间信息（泛指设备）
```javascript
{
    room_name_en: "living_room",
    device_type: "light"
}
// ✅ 匹配客厅所有灯光
```

### 场景3: 使用中文别名
```javascript
{
    room_name: "客厅",
    device_name: "灯",
    device_type: "light"
}
// ✅ 自动转换并匹配
```

### 场景4: 空间信息继承
```javascript
// 第一次请求
{ room_name_en: "bedroom", device_type: "light" }

// 60秒内第二次请求（省略房间）
{ device_type: "climate" }
// ✅ 自动继承卧室位置 → 匹配卧室空调
```

### 场景5: 全局设备类型
```javascript
{
    device_type: "light"
}
// ✅ 匹配所有灯光设备
```

## 性能优化

### 快速路径触发条件
当满足以下条件时，直接使用快速匹配（跳过 Python matcher）：
1. 所有意图设备都能找到匹配（`coverAll = true`）
2. 至少有一个设备匹配成功（`hasMatches = true`）

### 筛选策略
1. **设备类型筛选**: 首先缩小实体池范围
2. **空间筛选**: 进一步精确定位
3. **打分排序**: 只对筛选后的实体进行打分
4. **Top-K 限制**: 最多返回 100 个匹配结果

## 与原有系统的集成

### 在 matchDevices 方法中的调用
```javascript
// ⭐ 尝试快速匹配（JS 快速路径）
const fastOut = this.tryFastMatch(intentDevices, entities);
if (fastOut && fastOut.hasMatches && fastOut.coverAll) {
    // ✅ 快速路径命中，直接返回
    await this.enrichDeviceStates(fastOut.matched_devices, intentName);
    return { success: true, data: { ... } };
}

// ❌ 快速路径未能完全覆盖，回退到 Python matcher
const result = await this.callPythonMatcher(input);
```

### 空间信息继承的自动处理
```javascript
// 在 matchDevices 开始时自动调用
intentDevices = this.inheritLocationInfo(intentDevices);
```

## 配置参数

可以通过修改 `tryFastMatch` 中的参数来调整匹配行为：

```javascript
// 阈值 - 控制最低匹配要求
const TH = { 
    floor: 0.70,    // 楼层匹配阈值
    room: 0.70,     // 房间匹配阈值
    type: 0.65,     // 类型匹配阈值
    name: 0.45      // 名称匹配阈值
};

// 权重 - 控制各维度的重要性
const W = { 
    F: 0.15,  // 楼层权重
    R: 0.40,  // 房间权重
    N: 0.30,  // 名称权重
    T: 0.15   // 类型权重
};

// Top-K 限制
const BEST_K = 100;

// 消歧阈值（当前2名分数差小于此值时需要消歧）
const DISAMBIG_GAP = 0.08;
```

## 优势总结

1. ✅ **快速响应**: JS 原生实现，避免 Python 进程调用开销
2. ✅ **多语言支持**: 中英文、拼音全面支持
3. ✅ **智能继承**: 自动记忆和继承空间信息
4. ✅ **模糊匹配**: 容错性强，支持各种输入变体
5. ✅ **精确打分**: 基于权重的多维度评分机制
6. ✅ **完全兼容**: 输出格式与 BestMatch 标准一致
7. ✅ **自动降级**: 快速路径失败时自动回退到 Python matcher

## 日志输出示例

当执行快速匹配时，你将看到详细的两阶段日志输出：

```
================================================================================
[快速匹配] 设备 #1/1
  查询条件: floor="first_floor", room="living_room", type="light", name="ceiling"
================================================================================

📍 [步骤1] 通过空间信息和设备类型筛选实体...
  输入实体总数: 156
  [1.1] 设备类型筛选: 156 → 24 (2ms)
    匹配实体(前5个): light.living_room_ceiling, light.living_room_wall, light.bedroom_main, light.kitchen_counter, light.bathroom_mirror...
  [1.2] 空间信息筛选: 24 → 6 (1ms)
    匹配实体: light.living_room_ceiling, light.living_room_wall, light.living_room_floor, light.living_room_desk, light.living_room_sofa, light.living_room_tv

✅ [步骤1完成] 筛选结果: 6 个实体 (总耗时: 3ms)
  实体列表:
    1. light.living_room_ceiling - Living Room Ceiling Light (first_floor/living_room)
    2. light.living_room_wall - Living Room Wall Light (first_floor/living_room)
    3. light.living_room_floor - Living Room Floor Lamp (first_floor/living_room)
    4. light.living_room_desk - Living Room Desk Lamp (first_floor/living_room)
    5. light.living_room_sofa - Living Room Sofa Light (first_floor/living_room)
    6. light.living_room_tv - Living Room TV Backlight (first_floor/living_room)

🔍 [步骤2] 通过设备名称进一步匹配...
  输入实体数: 6
  查询名称: "ceiling"
  [2.1] 设备名称匹配: 6 → 1 (1ms)
    匹配实体:
      1. light.living_room_ceiling - Living Room Ceiling Light (相似度: 0.892)

✅ [步骤2完成] 最终匹配结果: 1 个实体 (耗时: 1ms)

🎯 [打分排序] 对 1 个实体进行综合打分...
  打分完成: 1 个有效结果 (耗时: 0ms)

📊 [最终结果] Top 1 匹配实体:
  1. light.living_room_ceiling - Living Room Ceiling Light (得分: 0.956)

⏱️  [性能统计]
  步骤1 (空间+类型筛选): 3ms
  步骤2 (名称匹配): 1ms
  打分排序: 0ms
  总耗时: 4ms
```

### 日志说明

#### 步骤1日志
- **设备类型筛选**: 显示从全部实体筛选到指定类型的数量变化
- **空间信息筛选**: 显示在类型筛选基础上按楼层和房间筛选的结果
- **实体列表**: 显示步骤1筛选后的所有实体（最多显示20个）

#### 步骤2日志
- **输入实体数**: 步骤1的输出数量
- **查询名称**: 用户指定的设备名称
- **匹配实体**: 显示名称匹配的实体和相似度分数
- **保留机制**: 如果名称匹配无结果，保留步骤1结果

#### 性能统计
- **步骤1耗时**: 类型筛选 + 空间筛选的总时间
- **步骤2耗时**: 名称匹配的时间
- **打分排序耗时**: 最终打分和排序的时间
- **总耗时**: 三个步骤的总和

## 测试建议

### 基础测试
```bash
# 完整空间信息 + 设备名称
curl -X POST http://localhost:3000/api/bestMatch/matchDevices \
  -H "Content-Type: application/json" \
  -d '{
    "intentionResult": {
      "success": true,
      "data": {
        "devices": [{
          "floor_name_en": "first_floor",
          "room_name_en": "living_room",
          "device_name": "ceiling",
          "device_type": "light"
        }]
      }
    }
  }'

# 仅空间信息（泛指设备）
curl -X POST http://localhost:3000/api/bestMatch/matchDevices \
  -H "Content-Type: application/json" \
  -d '{
    "intentionResult": {
      "success": true,
      "data": {
        "devices": [{
          "room_name_en": "living_room",
          "device_type": "light"
        }]
      }
    }
  }'

# 空间信息继承
# 1. 第一次请求（带房间）
curl -X POST ... -d '{"devices": [{"room_name_en": "bedroom", "device_type": "light"}]}'
# 2. 60秒内第二次请求（不带房间）
curl -X POST ... -d '{"devices": [{"device_type": "climate"}]}'
```

### 性能测试
监控日志中的性能统计：
```
⏱️  [性能统计]
  步骤1 (空间+类型筛选): 3ms
  步骤2 (名称匹配): 1ms
  打分排序: 0ms
  总耗时: 4ms
```

或在整体匹配中：
```
⚡ 快速路径命中: 总耗时=150ms | fast=50ms | 实体=100ms
```

## 维护说明

### 添加新的别名
修改对应的别名映射常量：
- 房间别名: `normalizeRoom()` 中的 `ROOM_ALIASES`
- 楼层别名: `normalizeFloor()` 中的 `FLOOR_ALIASES`
- 设备类型别名: `normalizeDomain()` 中的 `HA_DOMAIN_ALIASES`

### 调整匹配策略
修改 `scoreTriplet()` 方法中的逻辑，或调整 `TH` 和 `W` 参数。

### 调试技巧
启用性能日志：
```json
{
  "performanceLogging": true
}
```

查看详细匹配过程（在 `scoreTriplet` 中添加日志）。

---

**最后更新**: 2025-11-04
**版本**: 1.0
**维护者**: BestMatch 开发团队

