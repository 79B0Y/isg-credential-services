#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
智能设备匹配系统 - TF-IDF + 余弦相似度实现
适用于 Termux Proot Ubuntu 环境
"""

import re
import json
import os
import sys
import requests
from typing import List, Dict, Any, Tuple
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# ===================== 配置常量 =====================

# 权重配置
WEIGHTS = {
    "F": 0.15,  # Floor（楼层）权重
    "R": 0.40,  # Room（房间）权重 - 最重要
    "N": 0.30,  # Name（设备名）权重
    "T": 0.15   # Type（类型）权重
}

# 阈值配置（默认值，可以被输入的 config 覆盖）
THRESHOLDS = {
    "floor": 0.70,
    "room": 0.70,
    "type": 0.65,
    "name": 0.45  # ⭐ 降低设备名称阈值以支持 lamp/light 等同义词匹配
}

# 其他配置
BEST_K = 100  # 返回Top K个结果
DISAMBIG_GAP = 0.08  # 歧义判断阈值
LOCATION_BONUS = 0.4  # 位置匹配奖励

# 泛指设备名词典
GENERIC_DEVICE_NAMES = {
    # 灯光类
    "light", "lights", "lamp", "lamps", "deng", "灯", "灯光", "灯具", "照明",
    # 开关/插座类
    "switch", "switches", "kaiguan", "开关",
    "socket", "sockets", "chazuo", "插座", "outlet", "plug",
    # 空调类
    "ac", "aircon", "kongtiao", "空调", "冷气", "climate",
    # 风扇类
    "fan", "fans", "fengshan", "风扇",
    # 窗帘类
    "cover", "covers", "chuanglian", "窗帘", "curtain", "blind",
    # 锁类
    "lock", "locks", "suo", "锁", "门锁",
    # 摄像头类
    "camera", "cameras", "cam", "shexiangtou", "摄像头", "监控",
    # 传感器类
    "sensor", "sensors", "chuanganqi", "传感器",
    "temperature", "temp", "wendu", "温度", "temperaturesensor", "温度传感器",
    "humidity", "shidu", "湿度", "湿度传感器",
    "motion", "renti", "人体"
}

# 楼层别名映射
FLOOR_ALIASES = {
    "1": ["一楼", "1楼", "yilou", "first", "firstfloor", "first_floor", "ground"],
    "2": ["二楼", "2楼", "erlou", "second", "secondfloor", "second_floor"],
    "3": ["三楼", "3楼", "sanlou", "third", "thirdfloor", "third_floor"]
}

# 房间别名映射（可动态更新）
ROOM_ALIASES = {
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
}

# HA 域别名映射
HA_DOMAIN_ALIASES = {
    "light": ["light", "lights", "lamp", "deng", "灯"],
    "switch": ["switch", "kaiguan", "开关", "socket", "chazuo", "插座"],
    "climate": ["climate", "ac", "aircon", "kongtiao", "空调"],
    "fan": ["fan", "fengshan", "风扇"],
    "cover": ["cover", "chuanglian", "窗帘"],
    "camera": ["camera", "cam", "shexiangtou", "摄像头"],
    "sensor": ["sensor", "chuanganqi", "传感器"],
    "binary_sensor": ["binary_sensor", "binarysensor", "presence", "存在", "在家"],
    # ⭐ occupancy 和 motion 作为独立的设备类型
    "occupancy": ["occupancy", "occupied", "占用", "占用传感器"],
    "motion": ["motion", "运动", "运动传感器", "人体传感器"]
}


# ===================== 文本规范化函数 =====================

def normalize_text(text: str) -> str:
    """
    规范化文本：移除空格、下划线、大小写，只保留字母、数字、中文
    """
    if not text:
        return ""
    text = str(text).lower()
    text = re.sub(r'\s+', '', text)  # 移除空格
    text = re.sub(r'[_-]', '', text)  # 移除下划线和连字符
    text = re.sub(r'[^a-z0-9\u4e00-\u9fa5]', '', text)  # 只保留字母、数字、中文
    return text.strip()


def fuzzy_match(a: str, b: str) -> bool:
    """
    模糊匹配：规范化后完全相等
    """
    if not a or not b:
        return False
    return normalize_text(a) == normalize_text(b)


# ===================== 别名规范化函数 =====================

def normalize_floor(input_text: str) -> str:
    """
    楼层规范化：将各种表达方式转换为标准楼层编号
    """
    if not input_text:
        return ""
    normalized = normalize_text(input_text)

    # 如果已经是纯数字，直接返回
    if normalized.isdigit():
        return normalized

    # 在别名表中查找
    for level, aliases in FLOOR_ALIASES.items():
        if normalized == level:
            return level
        for alias in aliases:
            if normalized == normalize_text(alias):
                return level

    return normalized


def normalize_room(input_text: str) -> str:
    """
    房间规范化：将各种表达方式转换为标准房间类型
    """
    if not input_text:
        return ""
    normalized = normalize_text(input_text)

    # 在别名表中查找
    for room_type, aliases in ROOM_ALIASES.items():
        if normalized == normalize_text(room_type):
            return room_type
        for alias in aliases:
            if normalized == normalize_text(alias):
                return room_type

    return normalized


def normalize_domain(input_text: str) -> str:
    """
    域规范化：将各种表达方式转换为标准 HA 域
    """
    if not input_text:
        return ""
    normalized = normalize_text(input_text)

    # 在别名表中查找
    for domain, aliases in HA_DOMAIN_ALIASES.items():
        if normalized == normalize_text(domain):
            return domain
        for alias in aliases:
            if normalized == normalize_text(alias):
                return domain

    return input_text.lower()


def is_generic_device_name(name: str) -> bool:
    """
    判断是否为泛指设备名
    """
    if not name:
        return False
    return normalize_text(name) in GENERIC_DEVICE_NAMES


# ===================== TF-IDF 相似度计算 =====================

def calculate_tfidf_similarity(query: str, candidates: List[str]) -> List[float]:
    """
    使用 TF-IDF + 余弦相似度计算文本相似度

    Args:
        query: 查询文本
        candidates: 候选文本列表

    Returns:
        相似度得分列表
    """
    if not query or not candidates:
        return [0.0] * len(candidates)

    # 过滤空候选
    valid_candidates = [c if c else "" for c in candidates]

    # 如果所有候选都为空，返回0分
    if all(not c for c in valid_candidates):
        return [0.0] * len(candidates)

    # 准备文本列表：查询 + 所有候选
    all_texts = [query] + valid_candidates

    try:
        # 创建 TF-IDF 向量化器（字符级 n-gram，适合中文）
        vectorizer = TfidfVectorizer(
            analyzer='char',
            ngram_range=(1, 3),  # 1-3 字符的 n-gram
            max_features=1000    # 限制特征数量以提高性能
        )

        # 计算 TF-IDF 向量
        tfidf_matrix = vectorizer.fit_transform(all_texts)

        # 计算余弦相似度
        query_vector = tfidf_matrix[0:1]
        candidate_vectors = tfidf_matrix[1:]
        similarities = cosine_similarity(query_vector, candidate_vectors)[0]

        return similarities.tolist()

    except Exception as e:
        print(f"TF-IDF 计算错误: {e}", file=sys.stderr)
        return [0.0] * len(candidates)


def slot_similarity(query: str, *candidates) -> Dict[str, Any]:
    """
    计算查询文本与候选文本的最佳相似度

    Args:
        query: 查询文本
        *candidates: 可变数量的候选文本

    Returns:
        {"score": 最佳得分, "hit": 最佳匹配文本}
    """
    q = normalize_text(query or "")
    if not q:
        return {"score": 0.0, "hit": ""}

    # 过滤有效候选
    valid_candidates = [c for c in candidates if c]
    if not valid_candidates:
        return {"score": 0.0, "hit": ""}

    # 首先检查完全匹配
    for cand in valid_candidates:
        c = normalize_text(str(cand))
        if not c:
            continue
        if q == c:
            return {"score": 1.0, "hit": cand}

    # 使用 TF-IDF 计算相似度
    candidate_texts = [normalize_text(str(c)) for c in valid_candidates]
    similarities = calculate_tfidf_similarity(q, candidate_texts)

    # 找到最佳匹配
    best_idx = int(np.argmax(similarities))
    best_score = float(similarities[best_idx])
    best_hit = valid_candidates[best_idx]

    return {"score": best_score, "hit": best_hit}


# ===================== 位置提取功能 =====================

def extract_location_from_name(device_name: str) -> Tuple[bool, str]:
    """
    从设备名中提取位置信息

    Returns:
        (是否包含位置, 提取的房间类型)
    """
    if not device_name:
        return False, ""

    normalized_name = normalize_text(device_name)

    # 检查是否包含房间名称
    for room_type, aliases in ROOM_ALIASES.items():
        # 检查房间类型本身
        if normalize_text(room_type) in normalized_name:
            return True, room_type

        # 检查所有别名
        for alias in aliases:
            if normalize_text(alias) in normalized_name:
                return True, room_type

    return False, ""


# ===================== 核心匹配评分函数 =====================

def score_entity(device: Dict[str, Any], entity: Dict[str, Any]) -> Dict[str, Any]:
    """
    计算设备请求与实体的匹配得分

    Args:
        device: 设备请求（intent中的device对象）
        entity: 实体对象

    Returns:
        {"score": 得分, "ev": 各字段评估结果, "warnings": 警告列表}
    """
    ev = {}
    warnings = []

    # ========== 楼层匹配 ==========
    # ⭐ 优先使用 _en 字段以提高匹配准确性
    floor_q = device.get("floor_name_en") or device.get("floor_type") or device.get("floor_name") or ""
    e_floor_name = entity.get("floor_name") or ""
    e_floor_name_en = entity.get("floor_name_en") or ""
    e_floor_type = entity.get("floor_type") or ""
    e_level = str(entity.get("level", "")) if entity.get("level") is not None else ""

    floor_score = 0.0
    if floor_q:
        # 首先尝试模糊匹配
        if (fuzzy_match(floor_q, e_floor_name) or
            fuzzy_match(floor_q, e_floor_name_en) or
            fuzzy_match(floor_q, e_floor_type) or
            fuzzy_match(floor_q, e_level)):
            floor_score = 1.0
        else:
            # 规范化后匹配
            norm_floor_q = normalize_floor(floor_q)
            norm_e_floor_name = normalize_floor(e_floor_name)
            norm_e_floor_name_en = normalize_floor(e_floor_name_en)
            norm_e_floor_type = normalize_floor(e_floor_type)

            if (norm_floor_q == norm_e_floor_name or
                norm_floor_q == norm_e_floor_name_en or
                norm_floor_q == norm_e_floor_type or
                norm_floor_q == e_level):
                floor_score = 1.0
            else:
                # 相似度匹配
                sim = slot_similarity(floor_q, e_floor_name, e_floor_name_en, e_floor_type, e_level)
                floor_score = sim["score"]

    ev["floor"] = {
        "text": floor_q,
        "hit": (e_floor_name_en or e_floor_name or e_floor_type) if floor_score >= 0.9 else "",
        "score": floor_score
    }

    # ========== 房间匹配 ==========
    # ⭐ 优先使用 _en 字段以提高匹配准确性
    room_q = device.get("room_name_en") or device.get("room_type") or device.get("room_name") or ""
    e_room_name = entity.get("room_name") or ""
    e_room_name_en = entity.get("room_name_en") or ""
    e_room_type = entity.get("room_type") or ""

    room_score = 0.0
    if room_q:
        # 首先尝试模糊匹配
        if (fuzzy_match(room_q, e_room_name) or
            fuzzy_match(room_q, e_room_name_en) or
            fuzzy_match(room_q, e_room_type)):
            room_score = 1.0
        else:
            # 规范化后匹配
            norm_room_q = normalize_room(room_q)
            norm_e_room_name = normalize_room(e_room_name)
            norm_e_room_name_en = normalize_room(e_room_name_en)
            norm_e_room_type = normalize_room(e_room_type)

            if (norm_room_q == norm_e_room_name or
                norm_room_q == norm_e_room_name_en or
                norm_room_q == norm_e_room_type):
                room_score = 1.0
            else:
                # 相似度匹配
                sim = slot_similarity(room_q, e_room_name, e_room_name_en, e_room_type)
                room_score = sim["score"]

    ev["room"] = {
        "text": room_q,
        "hit": (e_room_name_en or e_room_name or e_room_type) if room_score >= 0.9 else "",
        "score": room_score
    }

    # ========== 设备名匹配 ==========
    # ⭐ 优先使用 _en 字段以提高匹配准确性（避免中英文跨语言匹配）
    name_q = device.get("device_name_en") or device.get("device_name") or ""
    e_device_name = entity.get("device_name") or ""
    e_friendly_name = entity.get("attributes", {}).get("friendly_name") or entity.get("friendly_name") or ""

    name_sim = slot_similarity(name_q, e_device_name, e_friendly_name)

    # 位置提取功能
    name_contains_location = False
    extracted_location = ""
    location_match_bonus = 0.0

    if name_q:
        name_contains_location, extracted_location = extract_location_from_name(name_q)

        # 如果设备名包含位置，检查位置是否匹配
        if name_contains_location and extracted_location:
            norm_e_room_name = normalize_room(e_room_name)
            norm_e_room_name_en = normalize_room(e_room_name_en)
            norm_e_room_type = normalize_room(e_room_type)

            if (extracted_location == norm_e_room_name or
                extracted_location == norm_e_room_name_en or
                extracted_location == norm_e_room_type):
                location_match_bonus = LOCATION_BONUS

    ev["device_name"] = {
        "text": name_q,
        "hit": name_sim["hit"],
        "score": name_sim["score"]
    }

    # ========== 设备类型匹配 ==========
    type_q = (device.get("device_type") or "").lower()
    if not type_q and device.get("service"):
        type_q = device["service"].split(".")[0].lower()

    e_type = (entity.get("device_type") or "").lower()
    e_domain = entity.get("entity_id", "").split(".")[0] if entity.get("entity_id") else ""

    norm_type_q = normalize_domain(type_q)
    norm_e_domain = normalize_domain(e_domain)
    norm_e_type = normalize_domain(e_type)

    type_score = 0.0
    if norm_type_q:
        # ⭐ 优先匹配精确的 device_type
        if (norm_type_q == norm_e_type or
            normalize_text(type_q) == normalize_text(e_type)):
            type_score = 1.0
        # 对于独立类型（如 occupancy, motion），不应该只匹配域名
        elif norm_type_q in ['occupancy', 'motion']:
            # 独立类型必须精确匹配 device_type
            type_score = 0.0
        # 通用类型可以匹配域名
        elif (norm_type_q == norm_e_domain or
              fuzzy_match(type_q, e_domain) or
              fuzzy_match(type_q, e_type)):
            type_score = 1.0
        else:
            # 相似度匹配
            sim = slot_similarity(norm_type_q, norm_e_domain, e_type)
            type_score = sim["score"]

    ev["device_type"] = {
        "text": type_q,
        "hit": (norm_e_type or norm_e_domain or e_type) if type_score >= 0.9 else "",
        "score": type_score
    }

    # ========== 场景判断 ==========
    is_all_devices = not floor_q and not room_q and not name_q and type_q

    # 所有设备模式
    if is_all_devices:
        if type_q and type_score >= 0.90:
            return {"score": 0.80, "ev": ev, "warnings": warnings}
        else:
            return {"score": -1, "ev": ev, "warnings": warnings}

    # ========== 阈值检查 ==========
    floor_pass = floor_score >= THRESHOLDS["floor"] if floor_q else True
    room_pass = room_score >= THRESHOLDS["room"] if room_q else True
    name_pass = name_sim["score"] >= THRESHOLDS["name"] if name_q else True
    type_pass = type_score >= 0.90 if type_q else True

    is_generic_name = is_generic_device_name(name_q)

    # 楼层模式（只有楼层+类型，无房间名）
    floor_only_mode = floor_q and not room_q and not name_q and type_q
    if floor_only_mode:
        if not floor_pass or not type_pass or type_score < 0.95:
            return {"score": -1, "ev": ev, "warnings": warnings}

    # 具体设备名模式
    elif name_q and not is_generic_name:
        if not room_pass or not name_pass or not type_pass:
            return {"score": -1, "ev": ev, "warnings": warnings}
        if floor_q and not floor_pass:
            return {"score": -1, "ev": ev, "warnings": warnings}

    # 泛指设备名或无设备名模式
    else:
        if not room_pass or not type_pass:
            return {"score": -1, "ev": ev, "warnings": warnings}
        if floor_q and not floor_pass:
            return {"score": -1, "ev": ev, "warnings": warnings}

    # ========== 计算综合得分 ==========
    floor_score_weight = floor_score if floor_q else 0.90
    name_score_val = name_sim["score"] if (name_q and not is_generic_name) else 0.85

    base_score = (WEIGHTS["F"] * floor_score_weight +
                  WEIGHTS["R"] * room_score +
                  WEIGHTS["N"] * name_score_val +
                  WEIGHTS["T"] * type_score)

    # 添加位置匹配奖励
    base_score += location_match_bonus

    # ========== 精确匹配奖励 ==========
    if room_q and room_score >= 0.98:
        base_score += 0.10
    if name_q and not is_generic_name and name_sim["score"] >= 0.98:
        base_score += 0.05
    if floor_q and floor_score >= 0.98:
        base_score += 0.03

    # ========== 域一致性检查 ==========
    if device.get("service"):
        svc_domain = device["service"].split(".")[0].lower()
        norm_svc_domain = normalize_domain(svc_domain)
        if norm_svc_domain and norm_e_domain:
            if norm_svc_domain == norm_e_domain:
                base_score += 0.03
            else:
                warnings.append(f"Service domain mismatch for {entity.get('entity_id', 'unknown')}")

    return {"score": base_score, "ev": ev, "warnings": warnings}


# ===================== 主匹配函数 =====================

def match_entities(intent_data: Dict[str, Any], entities: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    主匹配函数：将 intent 中的设备请求与实体列表进行匹配

    Args:
        intent_data: intent 对象，包含 devices 数组
        entities: 实体列表

    Returns:
        匹配结果字典
    """
    result = {
        "intent": intent_data.get("intent"),
        "user_input": intent_data.get("user_input"),
        "actions": [],
        "matched_devices": []
    }

    devices = intent_data.get("devices", [])
    if not isinstance(devices, list):
        devices = []

    for device in devices:
        # 确定设备类型/域
        svc_domain = ""
        if device.get("service"):
            svc_domain = device["service"].split(".")[0].lower()
        elif device.get("device_type"):
            svc_domain = device["device_type"].lower()

        norm_svc_domain = normalize_domain(svc_domain)

        # 过滤实体池
        def entity_filter(e):
            if not norm_svc_domain:
                return True
            e_domain = e.get("entity_id", "").split(".")[0] if e.get("entity_id") else ""
            e_type = (e.get("device_type") or "").lower()
            norm_e_domain = normalize_domain(e_domain)
            norm_e_type = normalize_domain(e_type)
            
            # ⭐ 优先匹配精确的 device_type
            if norm_svc_domain == norm_e_type or normalize_text(svc_domain) == normalize_text(e_type):
                return True  # device_type 精确匹配
            
            # 如果 device_type 不匹配，检查域名是否匹配
            # 但如果查询的类型有独立定义（如 occupancy, motion），则不应匹配到其他类型
            if norm_svc_domain == norm_e_domain:
                # 检查查询类型是否是独立类型（非通用域名）
                is_independent_type = norm_svc_domain in ['occupancy', 'motion']
                if is_independent_type:
                    # 独立类型必须精确匹配 device_type
                    return norm_svc_domain == norm_e_type or normalize_text(svc_domain) == normalize_text(e_type)
                return True  # 通用域名匹配
            
            # 如果有设备名称，也允许通过
            return bool(device.get("device_name")) or bool(device.get("device_name_en"))

        entity_pool = [e for e in entities if entity_filter(e)]

        # 对每个实体评分
        scored_entities = []
        for entity in entity_pool:
            score_result = score_entity(device, entity)
            if score_result["score"] >= 0:
                scored_entities.append({
                    "entity": entity,
                    "score": score_result["score"],
                    "ev": score_result["ev"],
                    "warnings": score_result["warnings"]
                })

        # 按得分排序
        scored_entities.sort(key=lambda x: x["score"], reverse=True)
        top_k = scored_entities[:BEST_K]

        # 收集警告
        all_warnings = []
        for item in top_k:
            all_warnings.extend(item["warnings"])

        # 添加到匹配设备列表
        for item in top_k:
            result["matched_devices"].append({
                "entity_id": item["entity"].get("entity_id"),
                "service": device.get("service"),
                "service_data": device.get("service_data", {})
            })

        # 如果没有匹配结果，生成建议
        suggestions = []
        if not top_k:
            # 使用宽松权重重新计算
            loose_scored = []
            for entity in entity_pool:
                floor_q = device.get("floor_name") or device.get("floor_name_en") or device.get("floor_type") or ""
                room_q = device.get("room_name") or device.get("room_name_en") or device.get("room_type") or ""
                name_q = device.get("device_name") or device.get("device_name_en") or ""
                type_q = (device.get("device_type") or "").lower()
                if not type_q and device.get("service"):
                    type_q = device["service"].split(".")[0].lower()

                e_type = (entity.get("device_type") or "").lower()

                score = (0.15 * slot_similarity(floor_q, entity.get("floor_name"), entity.get("floor_name_en"), entity.get("floor_type"))["score"] +
                        0.40 * slot_similarity(room_q, entity.get("room_name"), entity.get("room_name_en"), entity.get("room_type"))["score"] +
                        0.30 * slot_similarity(name_q, entity.get("device_name"), entity.get("attributes", {}).get("friendly_name"))["score"] +
                        0.15 * slot_similarity(type_q, e_type)["score"])

                loose_scored.append({"entity": entity, "score": score})

            loose_scored.sort(key=lambda x: x["score"], reverse=True)

            for item in loose_scored[:3]:
                e = item["entity"]
                suggestions.append({
                    "entity_id": e.get("entity_id"),
                    "device_name": e.get("device_name") or e.get("attributes", {}).get("friendly_name") or "",
                    "room": e.get("room_name_en") or e.get("room_name") or "",
                    "floor": e.get("floor_name_en") or e.get("floor_name") or "",
                    "reason_score": round(item["score"], 3)
                })

        # 构建 action 对象
        # ⭐ 优先使用 _en 字段（与匹配逻辑保持一致）
        action = {
            "request": {
                "floor": device.get("floor_name_en") or device.get("floor_type") or device.get("floor_name"),
                "room": device.get("room_name_en") or device.get("room_type") or device.get("room_name"),
                "device_name": device.get("device_name_en") or device.get("device_name"),
                "device_type": device.get("device_type") or (device.get("service", "").split(".")[0] if device.get("service") else None),
                "service": device.get("service"),
                "service_data": device.get("service_data", {})
            },
            "targets": [
                {
                    "entity_id": item["entity"].get("entity_id"),
                    "device_type": (item["entity"].get("device_type") or "").lower(),
                    "device_name": item["entity"].get("device_name") or item["entity"].get("attributes", {}).get("friendly_name") or "",
                    "floor": item["entity"].get("floor_name_en") or item["entity"].get("floor_name") or "",
                    "room": item["entity"].get("room_name_en") or item["entity"].get("room_name") or "",
                    "score": round(item["score"], 3),
                    "matched": {
                        "floor": item["ev"]["floor"],
                        "room": item["ev"]["room"],
                        "device_name": item["ev"]["device_name"],
                        "device_type": item["ev"]["device_type"]
                    }
                }
                for item in top_k
            ],
            "disambiguation_required": len(top_k) >= 2 and (top_k[0]["score"] - top_k[1]["score"]) < DISAMBIG_GAP,
            "warnings": all_warnings,
            "suggestions_if_empty": suggestions
        }

        result["actions"].append(action)

    return result


# ===================== LLM 调用功能 =====================

def call_llm_for_suggestions(user_query: str, entities_summary: List[Dict[str, Any]],
                             intent_devices: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    调用 LLM API 获取匹配建议和新别名

    Args:
        user_query: 用户查询
        entities_summary: 实体摘要（前20个）
        intent_devices: intent 中的设备列表

    Returns:
        {"suggestions": [...], "new_aliases": {...}}
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("警告: 未设置 OPENAI_API_KEY，跳过 LLM 调用", file=sys.stderr)
        return {"suggestions": [], "new_aliases": {}}

    # 准备提示词
    prompt = f"""你是一个智能家居设备匹配助手。用户查询没有找到匹配的设备，请分析原因并提供建议。

用户查询: {user_query}

意图解析结果:
{json.dumps(intent_devices, ensure_ascii=False, indent=2)}

可用实体（前20个）:
{json.dumps(entities_summary[:20], ensure_ascii=False, indent=2)}

请分析：
1. 为什么没有匹配到设备？
2. 建议用户如何重新表达查询？
3. 如果发现新的房间/楼层/设备别名，请提供建议的别名映射。

请以 JSON 格式返回:
{{
  "reason": "分析原因",
  "suggestions": ["建议1", "建议2"],
  "new_aliases": {{
    "room": {{"新别名": "标准房间类型"}},
    "floor": {{"新别名": "标准楼层编号"}},
    "device": {{"新别名": "标准设备类型"}}
  }}
}}
"""

    try:
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": "gpt-3.5-turbo",
                "messages": [
                    {"role": "system", "content": "你是一个智能家居设备匹配助手。"},
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.7,
                "max_tokens": 500
            },
            timeout=10
        )

        if response.status_code == 200:
            result = response.json()
            content = result["choices"][0]["message"]["content"]

            # 尝试解析 JSON
            try:
                llm_result = json.loads(content)

                # 更新 ROOM_ALIASES
                if "new_aliases" in llm_result and "room" in llm_result["new_aliases"]:
                    for alias, room_type in llm_result["new_aliases"]["room"].items():
                        if room_type in ROOM_ALIASES:
                            if alias not in ROOM_ALIASES[room_type]:
                                ROOM_ALIASES[room_type].append(alias)
                                print(f"添加新房间别名: {alias} -> {room_type}", file=sys.stderr)

                return llm_result

            except json.JSONDecodeError:
                print(f"LLM 返回内容无法解析为 JSON: {content}", file=sys.stderr)
                return {"suggestions": [content], "new_aliases": {}}

        else:
            print(f"LLM API 调用失败: {response.status_code} {response.text}", file=sys.stderr)
            return {"suggestions": [], "new_aliases": {}}

    except Exception as e:
        print(f"LLM 调用异常: {e}", file=sys.stderr)
        return {"suggestions": [], "new_aliases": {}}


# ===================== 主入口函数 =====================

def main():
    """
    命令行入口函数：从 stdin 读取 JSON，输出匹配结果
    """
    try:
        # 从 stdin 读取输入
        input_data = json.load(sys.stdin)

        # 解析输入
        intent_data = input_data.get("intent", {})
        entities = input_data.get("entities", [])
        user_query = input_data.get("user_query", "")

        # 执行匹配
        result = match_entities(intent_data, entities)

        # 检查是否有空匹配，如果有则调用 LLM
        for action in result["actions"]:
            if not action["targets"] and user_query:
                # 准备实体摘要
                entities_summary = [
                    {
                        "entity_id": e.get("entity_id"),
                        "device_name": e.get("device_name") or e.get("friendly_name"),
                        "room": e.get("room_name") or e.get("room_name_en"),
                        "floor": e.get("floor_name") or e.get("floor_name_en"),
                        "device_type": e.get("device_type")
                    }
                    for e in entities[:20]
                ]

                # 调用 LLM
                llm_result = call_llm_for_suggestions(user_query, entities_summary, intent_data.get("devices", []))

                # 添加 LLM 建议
                if llm_result.get("suggestions"):
                    action["llm_suggestions"] = llm_result["suggestions"]
                if llm_result.get("reason"):
                    action["llm_reason"] = llm_result["reason"]

        # 输出结果
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    except Exception as e:
        error_result = {"error": str(e), "type": type(e).__name__}
        print(json.dumps(error_result, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
