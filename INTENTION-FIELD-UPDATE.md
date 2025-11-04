# Intention 模块设备字段标准化更新

## 更新日期
2025-11-04

## 更新内容

### 问题描述
Intention 模块的 `/api/intention/intention/process` 接口返回的设备数据可能缺少某些字段，导致下游系统处理时出现问题。

### 解决方案
在 `IntentionModule.js` 的 `processIntention` 方法中添加了设备字段标准化逻辑，确保每个设备对象都包含完整的字段结构。

### 修改文件
- `modules/intention/IntentionModule.js` (第 437-452 行)

### 标准化字段列表
每个设备对象现在都保证包含以下完整字段：

```javascript
{
  "floor_name": "",          // 楼层名称（本地语言）
  "floor_name_en": "",       // 楼层名称（英文）
  "floor_type": "",          // 楼层类型（如：first_floor）
  "room_type": "",           // 房间类型（如：living_room）
  "room_name": "",           // 房间名称（本地语言）
  "room_name_en": "",        // 房间名称（英文）
  "device_type": "",         // 设备类型（如：light）
  "device_name": "",         // 设备名称（本地语言）
  "device_name_en": "",      // 设备名称（英文）
  "service": "",             // 服务名称（如：light.turn_on）
  "service_data": {}         // 服务参数对象
}
```

**注意**: `floor_name`、`room_name`、`device_name` 字段支持多语言（中文、日文、韩文等），不做特定语言限制。`_en` 后缀的字段用于英文名称。

### 实现逻辑
```javascript
// Ensure all device objects have complete field structure
if (intentResult && Array.isArray(intentResult.devices)) {
    intentResult.devices = intentResult.devices.map(device => ({
        floor_name: device.floor_name || "",
        floor_name_en: device.floor_name_en || "",
        floor_type: device.floor_type || "",
        room_type: device.room_type || "",
        room_name: device.room_name || "",
        room_name_en: device.room_name_en || "",
        device_type: device.device_type || "",
        device_name: device.device_name || "",
        device_name_en: device.device_name_en || "",
        service: device.service || "",
        service_data: device.service_data || {}
    }));
}
```

### 特性
- **向后兼容**：保留 AI 返回的所有原始数据
- **缺失字段填充**：缺失的字段自动填充为空字符串（`""`）或空对象（`{}`）
- **字段顺序一致**：所有设备对象的字段顺序保持一致
- **类型安全**：`service_data` 始终为对象类型，避免 null/undefined 问题

### 测试验证
已通过测试验证，确保：
1. 所有 11 个必需字段都存在于输出中
2. 原有字段值保持不变
3. 缺失字段正确填充默认值
4. 多设备场景正常工作

### 使用示例

#### 输入（AI 可能返回不完整的数据）
```json
{
  "devices": [
    {
      "room_type": "living_room",
      "device_type": "light",
      "service": "light.turn_on"
    }
  ]
}
```

#### 输出（标准化后）
```json
{
  "devices": [
    {
      "floor_name": "",
      "floor_name_en": "",
      "floor_type": "",
      "room_type": "living_room",
      "room_name": "",
      "room_name_en": "",
      "device_type": "light",
      "device_name": "",
      "device_name_en": "",
      "service": "light.turn_on",
      "service_data": {}
    }
  ]
}
```

### 影响范围
- **接口**: `/api/intention/intention/process`
- **模块**: intention
- **影响**: 只影响输出格式，不影响现有功能
- **兼容性**: 完全向后兼容

### 注意事项
1. 此更改只在 `processIntention` 方法中生效
2. `classifyIntention` 方法不受影响（该方法不返回设备数据）
3. 历史记录中也会保存标准化后的数据

## 其他修改

### manage-service.sh
修复了启动脚本路径问题：
- 修改前：`nohup ./start-with-telegram.sh`
- 修改后：`nohup ./start.sh`

## 部署说明
1. 重启服务：`./manage-service.sh restart`
2. 验证接口：调用 `/api/intention/intention/process` 并检查返回的设备字段

## 相关文档
- API-REFERENCE.md
- modules/intention/README.md

