# Intention 模块多语言字段说明更新

## 更新日期
2025-11-04

## 更新内容

### 问题
原有的字段描述中将 `floor_name`、`room_name`、`device_name` 标注为"中文"，但实际上这些字段应该支持多语言（中文、日文、韩文等），不做特定语言限制。

### 解决方案
更新了所有相关文档和系统提示词中的字段描述，将"中文名称"改为"本地语言"，并添加多语言示例。

## 修改的文件

### 1. INTENTION-FIELD-UPDATE.md
更新了字段描述：
- `floor_name`: ~~楼层名称（中文）~~ → **楼层名称（本地语言）**
- `room_name`: ~~房间名称（中文）~~ → **房间名称（本地语言）**
- `device_name`: ~~设备名称（中文）~~ → **设备名称（本地语言）**

并添加了说明：
> **注意**: `floor_name`、`room_name`、`device_name` 字段支持多语言（中文、日文、韩文等），不做特定语言限制。`_en` 后缀的字段用于英文名称。

### 2. modules/intention/IntentionModule.js
更新了系统提示词中的 JSON 输出格式说明（第 690-698 行）：

**更新前：**
```javascript
{
  "floor_name": "楼层名称（如：一楼、二楼）",
  "room_name": "房间中文名称",
  "device_name": "设备中文名称",
  ...
}
```

**更新后：**
```javascript
{
  "floor_name": "楼层名称（本地语言，如：一楼、二楼、1階、1층）",
  "room_name": "房间名称（本地语言，如：客厅、リビング、거실）",
  "device_name": "设备名称（本地语言，如：吊灯、シーリングライト、천장 조명）",
  ...
}
```

## 支持的语言示例

### 楼层名称 (floor_name)
- 🇨🇳 中文：一楼、二楼、三楼
- 🇯🇵 日文：1階、2階、3階
- 🇰🇷 韩文：1층、2층、3층
- 🇬🇧 英文：First Floor、Second Floor（使用 floor_name_en）

### 房间名称 (room_name)
- 🇨🇳 中文：客厅、卧室、厨房
- 🇯🇵 日文：リビング、寝室、キッチン
- 🇰🇷 韩文：거실、침실、부엌
- 🇬🇧 英文：living_room、bedroom、kitchen（使用 room_name_en）

### 设备名称 (device_name)
- 🇨🇳 中文：吊灯、空调、电视
- 🇯🇵 日文：シーリングライト、エアコン、テレビ
- 🇰🇷 韩文：천장 조명、에어컨、TV
- 🇬🇧 英文：ceiling_light、air_conditioner、tv（使用 device_name_en）

## 字段命名约定

### 本地语言字段（不带后缀）
- `floor_name` - 使用用户的本地语言
- `room_name` - 使用用户的本地语言
- `device_name` - 使用用户的本地语言

### 英文字段（_en 后缀）
- `floor_name_en` - 英文或标准化标识符
- `room_name_en` - 英文或标准化标识符
- `device_name_en` - 英文或标准化标识符

### 类型代码字段（_type 后缀）
- `floor_type` - 标准化类型代码（如：first_floor、second_floor）
- `room_type` - 标准化类型代码（如：living_room、bedroom）
- `device_type` - Home Assistant 域名（如：light、climate）

## 设计原则

1. **多语言友好**：本地语言字段不限制特定语言
2. **标准化支持**：英文字段提供标准化标识符
3. **类型代码**：类型字段使用统一的英文代码便于程序处理
4. **灵活性**：AI 可以根据用户输入的语言自动填充相应字段

## 使用场景示例

### 中文用户
```json
{
  "floor_name": "二楼",
  "floor_name_en": "Second Floor",
  "floor_type": "second_floor",
  "room_name": "主卧",
  "room_name_en": "master_bedroom",
  "room_type": "master_bedroom"
}
```

### 日文用户
```json
{
  "floor_name": "2階",
  "floor_name_en": "Second Floor",
  "floor_type": "second_floor",
  "room_name": "主寝室",
  "room_name_en": "master_bedroom",
  "room_type": "master_bedroom"
}
```

### 韩文用户
```json
{
  "floor_name": "2층",
  "floor_name_en": "Second Floor",
  "floor_type": "second_floor",
  "room_name": "안방",
  "room_name_en": "master_bedroom",
  "room_type": "master_bedroom"
}
```

## 影响范围
- **文档**: INTENTION-FIELD-UPDATE.md
- **代码**: modules/intention/IntentionModule.js（系统提示词）
- **接口**: `/api/intention/intention/process`
- **兼容性**: 完全向后兼容，仅更新描述，不影响功能

## 总结
这次更新使 Intention 模块的字段描述更加准确和国际化，明确了对多语言的支持，同时保持了系统的灵活性和标准化能力。

