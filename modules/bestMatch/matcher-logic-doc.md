# Node-RED 智能设备匹配系统 - 完整逻辑文档

## 📋 系统概述

这是一个用于 Home Assistant 的智能设备匹配系统，能够理解用户的自然语言指令（中英文），并准确找到对应的设备实体。

---

## 🎯 核心功能

### 1. 多语言支持
- ✅ **中文**：客厅、卧室、一楼、开关、空调
- ✅ **英文**：living room, bedroom, first floor, switch, AC
- ✅ **拼音**：keting, woshi, yilou, kaiguan
- ✅ **混合**：turn on 客厅 light

### 2. 模糊匹配
自动忽略：
- **空格**：`living room` ↔ `living_room` ↔ `livingroom`
- **下划线**：`first_floor` ↔ `First Floor`
- **大小写**：`Garage` ↔ `garage` ↔ `GARAGE`

### 3. 别名映射
- **楼层别名**：一楼 = 1楼 = first floor = ground floor
- **房间别名**：客厅 = living room = keting = lounge
- **设备别名**：空调 = AC = climate = air conditioner

---

## 🔍 匹配场景

系统支持 6 种主要匹配场景：

### 场景 1：所有设备控制
**示例**：`"打开所有灯"`

```javascript
条件：
- floor: 空
- room: 空  
- device_name: 空
- device_type: "light" ✅

匹配逻辑：
只检查 device_type，返回所有灯光设备
```

### 场景 2：楼层模式
**示例**：`"打开一楼空调"`

```javascript
条件：
- floor: "一楼" ✅
- room: 空
- device_name: "空调"
- device_type: "climate" ✅

匹配逻辑：
1. 楼层规范化："一楼" → "1"
2. 实体楼层："first floor" → "1"
3. 类型匹配："climate" === "climate"
4. 返回一楼所有空调
```

### 场景 3：房间 + 泛指设备
**示例**：`"打开客厅灯"`

```javascript
条件：
- floor: 空
- room: "客厅" ✅
- device_name: "灯"（泛指）
- device_type: "light" ✅

匹配逻辑：
1. 房间规范化："客厅" → "living_room"
2. 实体房间："Living Room" → "living_room"
3. "灯" 在泛指设备词典中 ✅
4. 只需 room + type 匹配
5. 返回客厅所有灯
```

### 场景 4：房间 + 具体设备名
**示例**：`"打开客厅吸顶灯"`

```javascript
条件：
- floor: 空
- room: "客厅" ✅
- device_name: "吸顶灯" ✅（具体名称）
- device_type: "light" ✅

匹配逻辑：
1. 房间匹配："客厅" === "living_room"
2. "吸顶灯" 不在泛指词典中，需要精确匹配设备名
3. 设备名匹配："吸顶灯" === "吸顶灯"
4. 返回客厅的吸顶灯
```

### 场景 5：楼层 + 房间 + 设备
**示例**：`"打开一楼客厅灯"`

```javascript
条件：
- floor: "一楼" ✅
- room: "客厅" ✅
- device_name: "灯"
- device_type: "light" ✅

匹配逻辑：
全方位匹配，最精确的定位
```

### 场景 6：设备名包含位置（智能识别）
**示例**：`"打开backyard开关"`

```javascript
条件：
- floor: 空
- room: 空（未指定）
- device_name: "backyard开关" ✅
- device_type: "switch" ✅

匹配逻辑：
1. 分析设备名，发现包含 "backyard"
2. "backyard" → 映射到 "garden" 房间类型
3. 查找 room_type = "garden" 的设备
4. 类型匹配：switch === switch
5. 返回后院的开关 ✅
```

---

## ⚖️ 评分系统

### 权重分配
```javascript
W = {
    F: 0.15,  // Floor（楼层）权重
    R: 0.40,  // Room（房间）权重 - 最重要
    N: 0.30,  // Name（设备名）权重
    T: 0.15   // Type（类型）权重
}
```

### 阈值设置
```javascript
TH = {
    floor: 0.70,  // 楼层匹配阈值
    room: 0.70,   // 房间匹配阈值
    type: 0.65,   // 类型匹配阈值
    name: 0.80    // 设备名匹配阈值
}
```

### 计算示例

**查询**：`"打开客厅插座"`

```javascript
// 基础得分
base = 0.15 × 0.90  // floor未指定，默认0.90
     + 0.40 × 1.0   // room完美匹配
     + 0.30 × 0.85  // 泛指设备名，默认0.85
     + 0.15 × 1.0   // type完美匹配
     = 0.94

// 奖励分
+ 0.10  // room精确匹配（score ≥ 0.98）
+ 0.03  // 域一致性匹配

// 最终得分
= 1.07 ✅ 完美匹配！
```

---

## 🔄 匹配流程

### Step 1: 数据预处理
```
输入数据 → 规范化
- 移除空格、下划线
- 转小写
- 只保留字母、数字、中文
```

### Step 2: 三层匹配策略

**第一层：直接模糊匹配（最快）**
```javascript
fuzzyMatch("living_room", "Living Room")
// "livingroom" === "livingroom" ✅
```

**第二层：别名规范化匹配**
```javascript
normalizeRoom("客厅") → "living_room"
normalizeRoom("Living Room") → "living_room"
// "living_room" === "living_room" ✅
```

**第三层：相似度匹配（回退）**
```javascript
// 使用 Jaro-Winkler 算法
jaroWinkler("客厅", "living room")
// 计算字符串相似度
```

### Step 3: 场景判断
```
1. 检查是否为"所有设备"场景
2. 检查是否为"楼层模式"
3. 检查设备名是否包含位置信息
4. 检查是否为泛指设备名
5. 应用对应的匹配规则
```

### Step 4: 阈值过滤
```
每个字段都有阈值要求：
- 如果指定了该字段，相似度必须 ≥ 阈值
- 如果未指定该字段，默认通过
```

### Step 5: 评分排序
```
1. 计算每个候选设备的综合得分
2. 按得分从高到低排序
3. 返回 Top K 个结果（K=100）
```

---

## 📚 泛指设备名词典

系统包含 **200+** 泛指设备名，包括：

### 灯光类
```
light, lights, lamp, 灯, 灯光, 灯具, 照明
```

### 开关/插座类
```
switch, 开关, socket, 插座, outlet, plug
```

### 空调类
```
ac, aircon, 空调, 冷气, climate
```

### 传感器类
```
sensor, 传感器, temperature, 温度, 温度传感器
humidity, 湿度, 湿度传感器, motion, 人体
```

**当设备名在泛指词典中时**：
- 只需要匹配 room + type
- 不要求设备名精确匹配

---

## 🎨 特殊功能

### 1. 智能位置提取

当设备名包含位置关键词时自动识别：

```javascript
"backyard开关" → 提取 "backyard" → 映射到 "garden"
"garage灯" → 提取 "garage" → 映射到 "garage"
"living_room_switch" → 提取 "living_room"
```

**工作原理**：
1. 分析设备名中的每个词
2. 在房间别名词典中查找匹配
3. 提取对应的房间类型
4. 给予 +0.4 的高额奖励分

### 2. 域一致性检查

确保 service 和 entity 的域匹配：

```javascript
Service: "switch.turn_on" → domain = "switch"
Entity: "switch.xxx" → domain = "switch"
✅ 匹配，给予 +0.03 奖励
```

### 3. 精确匹配奖励

```javascript
房间精确匹配（score ≥ 0.98）: +0.10
设备名精确匹配（score ≥ 0.98）: +0.05
楼层精确匹配（score ≥ 0.98）: +0.03
位置提取匹配: +0.40
```

---

## ✅ 匹配决策树

```
输入查询
  │
  ├─ 是否指定了 floor/room/name/type？
  │
  ├─ 所有设备模式？(只有type)
  │  └─ type匹配 → ✅ 返回所有该类型设备
  │
  ├─ 楼层模式？(floor + type, 无room)
  │  └─ floor + type精确匹配 → ✅ 返回该楼层所有该类型
  │
  ├─ 设备名包含位置？(nameQ包含房间关键词)
  │  └─ 提取位置 + type匹配 → ✅ 返回该位置的设备
  │
  ├─ 具体设备名？(name不在泛指词典)
  │  └─ room + name + type都匹配 → ✅ 返回具体设备
  │
  └─ 泛指设备名？(name在泛指词典)
     └─ room + type匹配 → ✅ 返回该房间所有该类型
```

---

## 🛡️ 容错机制

### 1. 无匹配时的建议
```javascript
如果没有找到匹配设备：
1. 使用宽松权重重新计算相似度
2. 返回 Top 3 最相似的设备作为建议
3. 提供每个建议的相似度得分
```

### 2. 歧义消除
```javascript
如果 Top 2 设备得分差距 < 0.08：
disambiguation_required = true
// 需要用户进一步确认
```

---

## 📊 完整匹配示例

### 示例 1：简单查询
```
输入："打开客厅灯"

解析：
- room: "客厅" → "living_room"
- device_name: "灯" (泛指)
- device_type: "light"

匹配：
- room匹配：1.0 ✅
- type匹配：1.0 ✅
- 得分：0.94

结果：返回客厅所有灯光设备
```

### 示例 2：复杂查询
```
输入："打开一楼客厅吸顶灯"

解析：
- floor: "一楼" → "1"
- room: "客厅" → "living_room"
- device_name: "吸顶灯" (具体名称)
- device_type: "light"

匹配：
- floor匹配：1.0 ✅
- room匹配：1.0 ✅
- name匹配：1.0 ✅
- type匹配：1.0 ✅
- 得分：1.18 (含奖励)

结果：精确定位到一楼客厅的吸顶灯
```

### 示例 3：智能识别
```
输入："打开backyard开关"

解析：
- device_name: "backyard开关"
- device_type: "switch"

智能处理：
- 检测到 "backyard" 关键词
- 提取位置："backyard" → "garden"
- 查找 room_type = "garden" 的设备

匹配：
- 位置匹配：+0.4 奖励 ✅
- type匹配：1.0 ✅
- 得分：0.94

结果：返回后院的开关设备
```

### 示例 4：查询传感器
```
输入："客厅温度是多少"

解析：
- room: "客厅" → "living_room"
- device_name: "温度传感器" (泛指)
- device_type: "temperature"

匹配：
- room匹配：1.0 ✅
- type匹配：1.0 ✅
- "温度传感器" 在泛指词典中
- 得分：0.94

结果：返回客厅的温度传感器
```

### 示例 5：楼层控制
```
输入："关闭二楼空调"

解析：
- floor: "二楼" → "2"
- device_name: "空调" (泛指)
- device_type: "climate"

匹配：
- floor匹配：1.0 ✅
- type匹配：1.0 ✅
- 进入楼层模式
- 得分：0.80

结果：返回二楼所有空调设备
```

### 示例 6：所有设备
```
输入："打开所有灯"

解析：
- device_type: "light"
- floor, room, name 都为空

匹配：
- 识别为"所有设备"模式
- type匹配：1.0 ✅
- 得分：0.80

结果：返回所有灯光设备
```

---

## 🔧 技术实现细节

### 字符串规范化函数 (norm)
```javascript
function norm(s) {
    return String(s)
        .toLowerCase()           // 转小写
        .replace(/\s+/g, "")     // 移除空格
        .replace(/[_-]/g, "")    // 移除下划线和连字符
        .replace(/[^a-z0-9\u4e00-\u9fa5]/g, "")  // 只保留字母、数字、中文
        .trim();
}
```

### Jaro-Winkler 相似度算法
- 用于计算两个字符串的相似度
- 返回值范围：0.0 ~ 1.0
- 考虑字符匹配和位置信息
- 对前缀匹配给予额外权重

### 楼层规范化
```javascript
normalizeFloor("一楼") → "1"
normalizeFloor("first floor") → "1"
normalizeFloor("1楼") → "1"
normalizeFloor("yilou") → "1"
```

### 房间规范化
```javascript
normalizeRoom("客厅") → "living_room"
normalizeRoom("Living Room") → "living_room"
normalizeRoom("keting") → "living_room"
normalizeRoom("lounge") → "living_room"
```

### 域规范化
```javascript
normalizeDomain("灯") → "light"
normalizeDomain("空调") → "climate"
normalizeDomain("插座") → "switch"
normalizeDomain("AC") → "climate"
```

---

## 📋 别名映射表

### 楼层别名
```javascript
"1": ["一楼", "1楼", "yilou", "first", "firstfloor", "first_floor", "ground"]
"2": ["二楼", "2楼", "erlou", "second", "secondfloor", "second_floor"]
"3": ["三楼", "3楼", "sanlou", "third", "thirdfloor", "third_floor"]
```

### 房间别名
```javascript
"living_room": ["客厅", "keting", "living", "livingroom", "lounge"]
"bedroom": ["卧室", "woshi", "bedroom", "bed_room"]
"master_bedroom": ["主卧", "zhuwo", "master", "masterbedroom"]
"kitchen": ["厨房", "chufang", "kitchen"]
"bathroom": ["浴室", "卫生间", "yushi", "weishengjian", "bathroom"]
"study": ["书房", "shufang", "study", "office"]
"garage": ["车库", "cheku", "garage"]
"garden": ["花园", "后院", "huayuan", "houyuan", "garden", "backyard"]
```

### HA 域别名
```javascript
"light": ["light", "lights", "lamp", "deng", "灯"]
"switch": ["switch", "kaiguan", "开关", "socket", "chazuo", "插座"]
"climate": ["climate", "ac", "aircon", "kongtiao", "空调"]
"fan": ["fan", "fengshan", "风扇"]
"cover": ["cover", "chuanglian", "窗帘"]
"camera": ["camera", "cam", "shexiangtou", "摄像头"]
"sensor": ["sensor", "chuanganqi", "传感器"]
```

---

## 🎯 系统优势总结

### 1. 智能化
- 自动识别多种表达方式
- 智能位置提取
- 场景自动判断

### 2. 容错性
- 模糊匹配，忽略格式差异
- 多层匹配策略
- 相似度回退机制

### 3. 灵活性
- 支持 6 种主要场景
- 自动场景判断
- 灵活的评分系统

### 4. 准确性
- 多维度匹配（楼层、房间、设备名、类型）
- 精确的评分系统
- 阈值过滤机制

### 5. 可扩展性
- 易于添加新的别名
- 易于扩展新的规则
- 模块化设计

### 6. 多语言支持
- 中文、英文、拼音全支持
- 混合语言输入
- 统一的规范化处理

---

## 🚀 使用场景

### 1. 家庭智能控制
- "打开客厅灯"
- "关闭一楼所有空调"
- "调节主卧温度"

### 2. 环境查询
- "客厅温度是多少？"
- "车库有人吗？"
- "二楼湿度多少？"

### 3. 批量控制
- "打开所有灯"
- "关闭一楼所有设备"
- "打开所有窗帘"

### 4. 精确控制
- "打开客厅吸顶灯"
- "关闭主卧空调"
- "调节书房台灯亮度"

---

## 📝 输出格式

### 成功匹配
```json
{
  "intent": "Control Device",
  "user_input": "打开客厅灯",
  "actions": [{
    "request": {
      "floor": null,
      "room": "客厅",
      "device_name": "灯",
      "device_type": "light"
    },
    "targets": [{
      "entity_id": "light.color_light_1",
      "device_name": "吸顶灯",
      "room": "客厅",
      "floor": "一楼",
      "score": 0.94,
      "matched": {
        "floor": {...},
        "room": {...},
        "device_name": {...},
        "device_type": {...}
      }
    }],
    "disambiguation_required": false,
    "warnings": [],
    "suggestions_if_empty": []
  }],
  "matched_devices": [
    {
      "entity_id": "light.color_light_1",
      "service": "light.turn_on",
      "service_data": {}
    }
  ]
}
```

### 无匹配结果
```json
{
  "targets": [],
  "suggestions_if_empty": [
    {
      "entity_id": "light.color_light_1",
      "device_name": "吸顶灯",
      "room": "客厅",
      "floor": "一楼",
      "reason_score": 0.65
    }
  ]
}
```

---

## 🔍 调试与优化

### 调试建议
1. 查看 `matched` 对象中每个字段的得分
2. 检查 `warnings` 数组中的提示
3. 对比 `suggestions_if_empty` 中的建议
4. 调整阈值 `TH` 和权重 `W` 以优化匹配

### 常见问题排查
1. **没有匹配结果**：检查设备名、房间名是否在别名表中
2. **匹配错误设备**：调整权重或添加更多别名
3. **性能问题**：减少 `BEST_K` 值或优化候选池

---

## 📚 参考资料

- Home Assistant 实体结构规范
- Jaro-Winkler 算法文档
- Node-RED Function 节点文档

---

**版本**: v5.0 Stable  
**最后更新**: 2025-10-25  
**作者**: AI Assistant  
**许可**: MIT