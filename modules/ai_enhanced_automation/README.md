# AI Enhanced Automation Module

使用AI智能分析并创建Home Assistant自动化的模块。

## 功能特性

- ✅ AI智能分析用户输入
- ✅ 自动解析trigger、condition和action
- ✅ 生成完整的Home Assistant自动化配置
- ✅ 支持多种AI提供商（Claude、OpenAI、Gemini、DeepSeek）
- ✅ 完整的自动化管理（创建、删除、启用、禁用）

## 工作流程

1. 接收用户输入和设备匹配结果
2. 调用AI分析并生成自动化配置
3. 将配置发送到Home Assistant创建自动化
4. 返回创建结果和AI分析

## API接口

### 创建自动化
```
POST /api/ai_enhanced_automation/create
```

输入数据格式：
```json
{
  "intent": "Set Automation",
  "user_input": "电视房没人的时候把灯关了",
  "matched_devices": [
    {
      "entity_id": "binary_sensor.motion_sensor_1",
      "service": "binary_sensor.state",
      "service_data": {"state": "off"},
      "automation": "trigger"
    },
    {
      "entity_id": "light.color_light_3",
      "service": "light.turn_off",
      "service_data": {},
      "automation": "action"
    }
  ],
  "automation": {
    "automation_name": "电视房无人关灯",
    "automation_name_en": "tv_room_no_one_turn_off_lights",
    "operation": "add",
    "description": "当电视房没人的时候自动关灯"
  }
}
```

### 列出所有自动化
```
GET /api/ai_enhanced_automation/list
```

### 获取自动化详情
```
GET /api/ai_enhanced_automation/get/:id
```

### 删除自动化
```
DELETE /api/ai_enhanced_automation/delete/:id
```

### 启用自动化
```
POST /api/ai_enhanced_automation/enable/:id
```

### 禁用自动化
```
POST /api/ai_enhanced_automation/disable/:id
```

## 配置选项

- `aiProvider`: AI提供商 (auto/claude/openai/gemini/deepseek)
- `defaultMode`: 默认自动化模式 (single/restart/queued/parallel)
- `enableConditions`: 是否启用条件判断

## Prompt自定义

可以通过编辑以下文件来自定义AI提示词：
- `data/create_automation_prompt.txt`: 创建自动化的提示词
- `data/update_automation_prompt.txt`: 更新自动化的提示词

## 依赖模块

- `home_assistant`: Home Assistant API调用
- AI Provider (claude/openai/gemini/deepseek): AI分析能力

## 示例

### 示例1: 无人关灯
```json
{
  "user_input": "电视房没人的时候把灯关了",
  "matched_devices": [
    {"entity_id": "binary_sensor.motion_sensor_1", "automation": "trigger", "service_data": {"state": "off"}},
    {"entity_id": "light.living_room", "automation": "action", "service": "light.turn_off"}
  ]
}
```

生成的自动化配置：
```json
{
  "trigger": [
    {"platform": "state", "entity_id": "binary_sensor.motion_sensor_1", "to": "off"}
  ],
  "action": [
    {"service": "light.turn_off", "target": {"entity_id": "light.living_room"}}
  ]
}
```

### 示例2: 定时场景
```json
{
  "user_input": "每天晚上6点开启回家模式",
  "matched_devices": [
    {"entity_id": "scene.home_mode", "automation": "action", "service": "scene.turn_on"}
  ]
}
```

生成的自动化配置：
```json
{
  "trigger": [
    {"platform": "time", "at": "18:00:00"}
  ],
  "action": [
    {"service": "scene.turn_on", "target": {"entity_id": "scene.home_mode"}}
  ]
}
```

## 注意事项

1. 确保Home Assistant模块已正确配置
2. 确保至少有一个AI提供商模块可用
3. Trigger和Action至少各需要一个
4. Condition是可选的
5. 建议使用英文ID作为automation_name_en，避免特殊字符

