# BestMatch 两阶段匹配快速参考

## 匹配流程

```
输入数据 (Intent Devices)
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 步骤1: 空间信息 + 设备类型筛选                                │
│                                                               │
│  [1.1] 设备类型筛选                                          │
│   • 使用 device_type                                         │
│   • 支持域名别名 (light/lamp/deng/灯)                       │
│   • 全部实体 → 指定类型实体                                  │
│                                                               │
│  [1.2] 空间信息筛选                                          │
│   • 使用 floor_name_en, floor_type, room_name_en, room_type │
│   • 支持别名映射 (living_room/客厅/keting)                  │
│   • 模糊匹配 + 标准化匹配                                    │
│   • 指定类型实体 → 目标空间实体                              │
│                                                               │
│  输出: step1Pool (空间内该类型的所有实体)                     │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 步骤2: 设备名称匹配                                          │
│                                                               │
│  [2.1] 名称相似度计算                                        │
│   • 使用 device_name, device_name_en                         │
│   • Jaro-Winkler 算法计算相似度                              │
│   • 阈值: 0.45 (支持同义词匹配)                              │
│   • 跳过泛指名称 (light/灯/lamp 等)                          │
│                                                               │
│  输出: step2Pool (名称匹配的实体 或 step1Pool)               │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 步骤3: 综合打分与排序                                        │
│                                                               │
│  • scoreTriplet() 多维度打分                                 │
│  • 权重: Room(40%) > Name(30%) > Floor(15%) = Type(15%)     │
│  • 排序后取 Top K (最多100个)                                │
│                                                               │
│  输出: 最终匹配结果 (带分数)                                 │
└─────────────────────────────────────────────────────────────┘
```

## 关键字段优先级

### 空间信息
```
楼层: floor_name_en > floor_type > floor_name > level
房间: room_name_en > room_type > room_name
```

### 设备信息
```
名称: device_name_en > device_name > friendly_name
类型: device_type > entity_id.domain
```

## 日志输出结构

```
================================================================================
[快速匹配] 设备 #N/M
  查询条件: floor="...", room="...", type="...", name="..."
================================================================================

📍 [步骤1] 通过空间信息和设备类型筛选实体...
  输入实体总数: X
  [1.1] 设备类型筛选: X → Y (Tms)
    匹配实体: entity_id_1, entity_id_2, ...
  [1.2] 空间信息筛选: Y → Z (Tms)
    匹配实体: entity_id_1, entity_id_2, ...

✅ [步骤1完成] 筛选结果: Z 个实体 (总耗时: Tms)
  实体列表:
    1. entity_id - device_name (floor/room)
    2. ...

🔍 [步骤2] 通过设备名称进一步匹配...
  输入实体数: Z
  查询名称: "device_name"
  [2.1] 设备名称匹配: Z → N (Tms)
    匹配实体:
      1. entity_id - device_name (相似度: 0.XXX)
      2. ...

✅ [步骤2完成] 最终匹配结果: N 个实体 (耗时: Tms)

🎯 [打分排序] 对 N 个实体进行综合打分...
  打分完成: N 个有效结果 (耗时: Tms)

📊 [最终结果] Top K 匹配实体:
  1. entity_id - device_name (得分: 0.XXX)
  2. ...

⏱️  [性能统计]
  步骤1 (空间+类型筛选): Xms
  步骤2 (名称匹配): Yms
  打分排序: Zms
  总耗时: Tms
```

## 匹配模式示例

### 模式1: 完整信息 → 精确匹配
```javascript
{
    floor_name_en: "first_floor",
    room_name_en: "living_room",
    device_name: "ceiling_light",
    device_type: "light"
}
```
**结果**: 单个精确匹配的实体

### 模式2: 空间 + 类型 → 批量匹配
```javascript
{
    room_name_en: "living_room",
    device_type: "light"
}
```
**结果**: 客厅所有灯光设备

### 模式3: 仅类型 → 全局匹配
```javascript
{
    device_type: "light"
}
```
**结果**: 全部灯光设备

### 模式4: 泛指名称 → 忽略名称
```javascript
{
    room_name_en: "living_room",
    device_name: "light",  // 泛指，被忽略
    device_type: "light"
}
```
**结果**: 等同于模式2

## 性能特点

| 阶段 | 操作 | 典型耗时 | 输出数量 |
|------|------|----------|----------|
| 步骤1.1 | 类型筛选 | 1-3ms | 10-50个 |
| 步骤1.2 | 空间筛选 | 1-2ms | 1-20个 |
| 步骤2 | 名称匹配 | 0-2ms | 0-10个 |
| 打分排序 | 综合评分 | 0-1ms | 1-5个 |
| **总计** | | **2-8ms** | **1-5个** |

## 别名映射参考

### 房间类型
- `living_room`: 客厅, keting, living, lounge
- `bedroom`: 卧室, woshi
- `kitchen`: 厨房, chufang
- `bathroom`: 浴室, 卫生间, yushi, weishengjian

### 楼层
- `1`: 一楼, 1楼, yilou, first, ground
- `2`: 二楼, 2楼, erlou, second
- `3`: 三楼, 3楼, sanlou, third

### 设备类型
- `light`: light, lights, lamp, deng, 灯
- `switch`: switch, kaiguan, 开关
- `climate`: climate, ac, aircon, kongtiao, 空调
- `fan`: fan, fengshan, 风扇
- `cover`: cover, chuanglian, 窗帘

## 故障排查

### 问题1: 步骤1筛选结果为0
**原因**: 
- 设备类型不存在
- 空间信息不匹配

**解决**: 
- 检查 `device_type` 是否正确
- 检查楼层和房间名称是否在别名映射中
- 查看步骤1.1的输出，确认类型筛选是否成功

### 问题2: 步骤2筛选结果为0（步骤1有结果）
**原因**: 
- 设备名称相似度低于阈值 (0.45)
- 名称完全不匹配

**解决**: 
- 系统会自动保留步骤1结果
- 检查 `device_name` 拼写
- 考虑使用泛指名称或不指定名称

### 问题3: 匹配了错误的实体
**原因**: 
- 空间信息不够精确
- 多个实体名称相似

**解决**: 
- 添加更详细的楼层信息
- 使用更具体的设备名称
- 检查实体的 `room_name_en` 和 `floor_name_en` 是否正确

## 配置调整

在 `tryFastMatch` 方法中可以调整以下参数：

```javascript
// 阈值配置
const TH = { 
    floor: 0.70,   // 楼层匹配最低分数
    room: 0.70,    // 房间匹配最低分数
    type: 0.65,    // 类型匹配最低分数
    name: 0.45     // 名称匹配最低分数 ⭐ 降低以支持同义词
};

// 权重配置
const W = { 
    F: 0.15,  // 楼层权重
    R: 0.40,  // 房间权重 ⭐ 最重要
    N: 0.30,  // 名称权重
    T: 0.15   // 类型权重
};

// 结果数量
const BEST_K = 100;  // 最多返回的实体数

// 消歧阈值
const DISAMBIG_GAP = 0.08;  // Top 2 分数差小于此值时需要消歧
```

---

**最后更新**: 2025-11-04  
**版本**: 2.0 (两阶段匹配)  
**参考**: [FAST-MATCH-OPTIMIZATION.md](./FAST-MATCH-OPTIMIZATION.md)

