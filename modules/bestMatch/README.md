# Best Match Module - 智能设备匹配系统

## 📖 概述

Best Match 模块是一个智能设备匹配系统，使用 **TF-IDF + 余弦相似度算法**来匹配用户意图与设备实体。支持多语言（中文、英文、拼音）、模糊匹配、泛指设备识别和智能位置提取。

### 核心特性

- ✅ **TF-IDF 算法**：使用文本向量化技术精确计算相似度
- ✅ **多语言支持**：中文、英文、拼音全面支持
- ✅ **模糊匹配**：自动忽略空格、下划线、大小写差异
- ✅ **泛指设备识别**：智能识别"灯"、"空调"等泛指词
- ✅ **智能位置提取**：从设备名中自动提取位置信息
- ✅ **AI 智能建议**：匹配失败时调用 LLM 提供建议
- ✅ **动态别名更新**：根据 AI 建议自动添加新别名
- ✅ **轻量高效**：适用于 Termux Proot Ubuntu 等资源受限环境

---

## 🚀 快速开始

### 环境要求

- **Python 3.7+**
- **Node.js 14+**
- **操作系统**：Linux, macOS, Termux Proot Ubuntu

### 安装依赖

#### 1. Python 依赖

```bash
# 进入模块目录
cd modules/bestMatch

# 安装 Python 依赖
pip install numpy scikit-learn requests

# 或使用 requirements.txt
pip install -r requirements.txt
```

#### 2. 验证安装

```bash
# 检查 Python 环境
python3 -c "import numpy, sklearn, requests; print('✅ 所有依赖已安装')"
```

#### 3. Termux 环境特殊说明

如果在 Termux 中运行，需要先安装基础依赖：

```bash
# 更新包列表
pkg update && pkg upgrade

# 安装 Python 和依赖
pkg install python python-pip

# 安装科学计算库
pkg install python-numpy

# 安装 scikit-learn（可能需要较长时间）
pip install scikit-learn

# 如果遇到编译错误，可以尝试使用预编译版本
pip install --only-binary=:all: scikit-learn
```

---

## 📝 使用示例

### API 调用示例

```javascript
// POST /api/modules/bestMatch/match
const response = await fetch('/api/modules/bestMatch/match', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        intent_devices: [{
            floor_name: "一楼",
            room_name: "客厅",
            device_type: "light",
            service: "light.turn_on"
        }],
        entities: [{
            entity_id: "light.living_room_light",
            friendly_name: "客厅灯",
            device_type: "light",
            room_name: "living_room",
            floor_name: "first_floor"
        }],
        user_query: "打开一楼客厅灯"
    })
});

const result = await response.json();
console.log(result);
```

### Python 脚本直接调用

```python
import json
import sys

# 准备输入数据
input_data = {
    "intent": {
        "devices": [{
            "floor_name": "一楼",
            "room_name": "客厅",
            "device_type": "light"
        }]
    },
    "entities": [{
        "entity_id": "light.living_room_light",
        "friendly_name": "客厅灯",
        "device_type": "light",
        "room_name": "living_room",
        "floor_name": "first_floor"
    }],
    "user_query": "打开一楼客厅灯"
}

# 调用匹配器
import subprocess
result = subprocess.run(
    ['python3', 'matcher.py'],
    input=json.dumps(input_data),
    capture_output=True,
    text=True
)

print(result.stdout)
```

---

## 🎯 匹配场景

### 场景 1：楼层 + 房间 + 设备类型

**用户查询**："打开一楼客厅灯"

**匹配逻辑**：
- 楼层：一楼 → `first_floor` (规范化)
- 房间：客厅 → `living_room` (规范化)
- 类型：light → `light` (精确匹配)

**预期结果**：返回一楼客厅所有灯光设备

### 场景 2：房间 + 具体设备名

**用户查询**："关闭卧室吸顶灯"

**匹配逻辑**：
- 房间：卧室 → `bedroom`
- 设备名：吸顶灯（精确匹配，非泛指）

**预期结果**：返回卧室的吸顶灯设备

### 场景 3：泛指设备

**用户查询**："打开书房灯"

**匹配逻辑**：
- "灯"是泛指词，只需匹配房间和类型
- 房间：书房 → `study`
- 类型：light

**预期结果**：返回书房所有灯光设备

### 场景 4：智能位置提取

**用户查询**："打开backyard开关"

**匹配逻辑**：
- 从设备名"backyard开关"中提取位置信息
- "backyard" → `garden` (别名映射)
- 类型：switch
- 给予位置匹配奖励 +0.4

**预期结果**：返回后院的开关设备

---

## ⚙️ 配置说明

### 权重配置 (Weights)

```json
{
  "F": 0.15,  // Floor（楼层）权重
  "R": 0.40,  // Room（房间）权重 - 最重要
  "N": 0.30,  // Name（设备名）权重
  "T": 0.15   // Type（类型）权重
}
```

### 阈值配置 (Thresholds)

```json
{
  "floor": 0.70,   // 楼层匹配阈值
  "room": 0.70,    // 房间匹配阈值
  "type": 0.65,    // 类型匹配阈值
  "name": 0.80     // 设备名匹配阈值
}
```

### 其他配置

- **Top K**：100（返回前 100 个匹配结果）
- **歧义判断间隙**：0.08（当 top1 - top2 < 0.08 时标记为需要消歧）
- **位置提取奖励**：+0.4（当从设备名提取到位置并匹配时）

---

## 📊 评分系统

### 基础得分计算

```
base_score = W.F × floor_score
           + W.R × room_score
           + W.N × name_score
           + W.T × type_score
           + location_match_bonus
```

### 精确匹配奖励

- 房间精确匹配 (≥ 0.98)：+0.10
- 设备名精确匹配 (≥ 0.98)：+0.05
- 楼层精确匹配 (≥ 0.98)：+0.03
- 域一致性匹配：+0.03

### 示例计算

**查询**："打开客厅插座"

```
基础得分：
- Floor: 0.15 × 0.90 = 0.135 (未指定，默认 0.90)
- Room:  0.40 × 1.0  = 0.40  (完美匹配)
- Name:  0.30 × 0.85 = 0.255 (泛指设备，默认 0.85)
- Type:  0.15 × 1.0  = 0.15  (完美匹配)

奖励分：
+ 0.10 (房间精确匹配)
+ 0.03 (域一致性)

最终得分 = 0.94 + 0.13 = 1.07 ✅
```

---

## 🗂️ 别名字典

### 房间别名 (ROOM_ALIASES)

```json
{
  "living_room": ["客厅", "keting", "living", "lounge"],
  "bedroom": ["卧室", "woshi", "bedroom"],
  "master_bedroom": ["主卧", "zhuwo", "master"],
  "kitchen": ["厨房", "chufang", "kitchen"],
  "bathroom": ["浴室", "卫生间", "yushi", "bathroom"],
  "study": ["书房", "shufang", "study", "office"],
  "garage": ["车库", "cheku", "garage"],
  "garden": ["花园", "后院", "backyard", "yard"]
}
```

### 楼层别名 (FLOOR_ALIASES)

```json
{
  "1": ["一楼", "1楼", "yilou", "first", "ground"],
  "2": ["二楼", "2楼", "erlou", "second"],
  "3": ["三楼", "3楼", "sanlou", "third"]
}
```

### 设备类型别名 (HA_DOMAIN_ALIASES)

```json
{
  "light": ["light", "灯", "lamp", "deng"],
  "switch": ["switch", "开关", "kaiguan", "socket", "插座"],
  "climate": ["climate", "空调", "ac", "aircon", "kongtiao"],
  "fan": ["fan", "风扇", "fengshan"],
  "cover": ["cover", "窗帘", "curtain", "chuanglian"]
}
```

---

## 🔧 API 端点

### 1. 执行匹配

**端点**：`POST /api/modules/bestMatch/match`

**请求体**：
```json
{
  "intent_devices": [...],
  "entities": [...],
  "user_query": "打开一楼灯"
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "actions": [...],
    "matched_devices": [...]
  }
}
```

### 2. 获取历史记录

**端点**：`GET /api/modules/bestMatch/history?limit=50`

### 3. 获取统计信息

**端点**：`GET /api/modules/bestMatch/stats`

### 4. 管理别名

- `GET /api/modules/bestMatch/aliases` - 获取别名字典
- `POST /api/modules/bestMatch/aliases` - 更新别名字典

### 5. 清除历史

**端点**：`DELETE /api/modules/bestMatch/history`

---

## 🧪 测试

### 使用 API 文档页面

访问：`http://localhost:3000/best-match-api-docs.html`

### 使用 curl 测试

```bash
curl -X POST http://localhost:3000/api/modules/bestMatch/match \
  -H "Content-Type: application/json" \
  -d '{
    "intent_devices": [{
      "floor_name": "一楼",
      "room_name": "客厅",
      "device_type": "light"
    }],
    "entities": [{
      "entity_id": "light.living_room_light",
      "friendly_name": "客厅灯",
      "device_type": "light",
      "room_name": "living_room"
    }],
    "user_query": "打开一楼客厅灯"
  }'
```

---

## 🐛 故障排除

### 问题 1：Python 依赖缺失

**错误信息**：`ModuleNotFoundError: No module named 'numpy'`

**解决方案**：
```bash
pip install numpy scikit-learn requests
```

### 问题 2：Termux 编译错误

**错误信息**：`error: command 'gcc' failed`

**解决方案**：
```bash
# 安装编译工具
pkg install clang

# 使用预编译版本
pip install --only-binary=:all: scikit-learn
```

### 问题 3：匹配结果为空

**可能原因**：
1. 实体列表为空
2. 阈值设置过高
3. 别名映射缺失

**解决方案**：
1. 检查输入数据格式
2. 调整配置中的阈值
3. 添加新的别名映射

---

## 📚 参考文档

- [API 文档页面](http://localhost:3000/best-match-api-docs.html)
- [匹配逻辑文档](./matcher-logic-doc.md)
- [Node-RED 实现参考](./node-red-matcher-complete.js)
- [输入数据示例](./输入数据示例.pdf)

---

## 📄 许可证

ISG Credential Services - MIT License

---

## 👥 贡献

欢迎提交 Issue 和 Pull Request！

---

## 🔗 相关链接

- [Home Assistant 文档](https://www.home-assistant.io/)
- [scikit-learn 文档](https://scikit-learn.org/)
- [TF-IDF 算法](https://zh.wikipedia.org/wiki/TF-IDF)

---

**版本**：1.0.0
**最后更新**：2025-10-26
**维护者**：ISG Credential Services Team
