"""Build the offline, editable Nanjing demo from credited repository assets.

Run with Python + Pillow. Media attachments are generated separately with FFmpeg.
This never writes to a user's profile or installed project.
"""
import json
import shutil
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "samples/nanjing-bridge"
DEST.mkdir(parents=True, exist_ok=True)
for folder in ("references", "media"):
    (DEST / folder).mkdir(exist_ok=True)

def inline(text):
    return [{"type": "text", "text": text, "styles": {}}]

def block(id, kind, text=None, props=None, children=None):
    result = dict(id=id, type=kind, props=props or {}, children=children or [])
    if text is not None:
        result["content"] = inline(text)
    return result

def paragraph(id, text):
    return block(id, "paragraph", text)

def heading(id, text, level=2):
    return block(id, "heading", text, {"level": level})

def columns(id, *contents):
    return block(id, "columnList", children=[block(f"{id}-{i}", "column", props={"width": 1}, children=children) for i, children in enumerate(contents)])

def image(name, number, frame=(900, 600)):
    source = ROOT / "docs/demo/photos" / name
    target = DEST / "references" / f"{number:04d}{source.suffix}"
    shutil.copyfile(source, target)
    width, height = Image.open(source).size
    return dict(id=f"demo-image-{number}", file=f"references/{target.name}", aspectRatio=width/height,
                sourceWidth=width, sourceHeight=height, frameWidth=frame[0], frameHeight=frame[1],
                fitMode="cover", crop=dict(x=0, y=0, width=1, height=1))

def gallery(id, *images):
    return dict(id=id, images=list(images))

artifacts = [
    dict(id="demo-location", kind="shootingLocation", revision=0, venueName="南京长江大桥", address="南京 · 长江南岸公共步道",
         description="以桥梁线条和江面为背景。日落前踩点；选择允许停留的位置，留出行人通道。",
         gallery=gallery("demo-location-gallery", image("bridge-day.jpg", 1))),
    dict(id="demo-model", kind="modelCard", revision=0, modelId="模特 A（虚构）", heightCm=170, weightKg=52, shoeSize="38",
         notes="原创人物示意图。动作：缓慢行走、侧身回望、撑伞望向江面。所有资料仅用于演示。",
         samples=gallery("demo-model-gallery", image("model-a.png", 2, (700, 920)))),
    dict(id="demo-umbrella", kind="prop", revision=0, title="透明伞", source="道具箱 · 逆光轮廓与前景",
         gallery=gallery("demo-umbrella-gallery", image("transparent-umbrella.png", 3))),
    dict(id="demo-bubbles", kind="prop", revision=0, title="泡泡机", source="道具箱 · 顺风侧放置，避免湿滑",
         gallery=gallery("demo-bubbles-gallery", image("bubble-machine.png", 4))),
    dict(id="demo-clothing", kind="clothing", revision=0, title="浅色外套与长裙", source="模特自备 · 无大面积图案",
         mainGallery=gallery("demo-clothing-gallery", image("model-a.png", 5, (700, 920))),
         tryOn=dict(expanded=False, gallery=gallery("demo-tryon-gallery"))),
]
group = dict(id="demo-moodboard", type="reference", name="桥畔光线参考", description="白天桥梁线条与蓝调灯光，左右对照取景。",
             x=0, width=1008, height=245, images=[image("bridge-day.jpg", 6, (420, 260)), image("bridge-night.jpg", 7, (420, 260))])
shutil.copyfile(ROOT / "docs/demo/photos/bridge-day.jpg", DEST / "media/bridge-cover.jpg")

table = block("demo-schedule", "table")
table["content"] = dict(type="tableContent", columnWidths=[100, 230, 280], headerRows=1, rows=[dict(cells=[inline(cell) for cell in row]) for row in [
    ["时间", "场景", "执行提示"], ["16:30", "集合 / 踩点", "确认公共步道与风向"],
    ["17:00", "透明伞逆光", "侧逆光；高光不过曝"], ["17:30", "泡泡与江风", "连续对焦；注意背景"],
    ["18:00", "蓝调桥景", "提高 ISO；人物保持静止"],
]])

blocks = [
    heading("demo-title", "南京长江大桥 · 江风与人像", 1),
    paragraph("demo-intro", "一份可直接修改的完整拍摄方案。虚构模特 A 搭配透明伞、泡泡机与浅色服装，从日落拍到蓝调时刻。"),
    block("demo-cover", "image", props={"url": "media/bridge-cover.jpg", "name": "南京长江大桥", "caption": "桥梁线条作为构图骨架 · Jack No1 / CC BY 3.0", "previewWidth": 760, "showPreview": True}),
    block("demo-concept", "quote", "让人物融入桥梁与江风；先交代环境，再靠近情绪。"),
    heading("demo-people-title", "01 地点与人物"),
    columns("demo-people", [block("demo-location-block", "shootingLocation", props={"artifactId": "demo-location"})],
            [block("demo-model-block", "modelCard", props={"artifactId": "demo-model"})]),
    heading("demo-props-title", "02 道具与服装"),
    columns("demo-props", [block("demo-umbrella-block", "prop", props={"artifactId": "demo-umbrella"})],
            [block("demo-bubbles-block", "prop", props={"artifactId": "demo-bubbles"})],
            [block("demo-clothing-block", "clothing", props={"artifactId": "demo-clothing"})]),
    heading("demo-mood-title", "03 光线与画面参考"),
    block("demo-mood-block", "imageGroup", props={"groupId": "demo-moodboard"}),
    block("demo-divider", "divider"),
    heading("demo-schedule-title", "04 拍摄流程"),
    table,
    columns("demo-lists", [heading("demo-shots-title", "镜头清单", 3),
        block("demo-shot-1", "numberedListItem", "广角：桥梁与江面的环境人像"),
        block("demo-shot-2", "numberedListItem", "中景：透明伞下侧身回望"),
        block("demo-shot-3", "numberedListItem", "特写：泡泡前景与逆光轮廓")],
        [heading("demo-checks-title", "出发检查", 3),
        block("demo-check-1", "checkListItem", "电池、存储卡与备用雨具", {"checked": True}),
        block("demo-check-2", "checkListItem", "确认集合位置与当日天气", {"checked": False}),
        block("demo-check-3", "checkListItem", "拍完检查照片并备份", {"checked": False})]),
    block("demo-safety", "toggleListItem", "现场提醒（点击箭头展开）", children=[
        block("demo-safety-1", "bulletListItem", "不进入车行道、铁路或封闭区域；沿公共步道取景。"),
        block("demo-safety-2", "bulletListItem", "大风时收伞；泡泡机避开行人；收工带走所有物品。")]),
    block("demo-page-break", "pageBreak"),
    heading("demo-attachments-title", "05 动态参考与附件"),
    paragraph("demo-motion-info", "下面是由桥景照片制作的 4 秒平移动画，以及人工合成的三声准备提示音。它们用于演示离线视频与音频组件，不是实地录像或现场录音。"),
    block("demo-video", "video", props={"url": "media/bridge-motion.mp4", "name": "桥景构图移动示意.mp4", "caption": "由 Jack No1 的桥景照片制作 · CC BY 3.0", "previewWidth": 480, "showPreview": True}),
    block("demo-audio", "audio", props={"url": "media/ready-tones.wav", "name": "三声准备提示.wav", "caption": "人工合成提示音", "showPreview": True}),
    block("demo-file", "file", props={"url": "media/shot-list.txt", "name": "现场镜头清单.txt", "caption": "可下载随身携带的拍摄提醒", "showPreview": False}),
    block("demo-settings", "codeBlock", "# 起始参数示例，请按实际光线调整\nlens = 50 mm\naperture = f/2.8\nshutter = 1/500 s\nISO = Auto", {"language": "text"}),
    heading("demo-help-title", "如何修改这份样例"),
    paragraph("demo-help", "输入 / 插入组件。拖住 block 左侧六点手柄到其他 block 左右边缘即可分栏；拖动栏间分隔线调宽。图片组会等比缩放。单击图片可存入素材库；用图片组的“从素材库插入”追加图片。"),
    paragraph("demo-export", "使用右上角“导出”生成 PDF、DOCX 或长图。视频和音频在静态导出中显示附件信息；需要播放时请打开项目。长图较长时可勾选自动分割。"),
    heading("demo-credits-title", "图片来源与许可", 3),
    paragraph("demo-credits", "日间桥景：Jack No1，CC BY 3.0；夜景：Vasily Astanin，CC BY-SA 4.0，均来自 Wikimedia Commons。模特 A、透明伞与泡泡机为 Preshot 原创示意图（CC BY-SA 4.0）。照片已缩放与重新编码。详见项目中的 CREDITS.md。"),
]
plan = dict(schemaVersion=16, title="南京长江大桥 · 江风与人像", document=dict(format="preshot-blocks", version=4, blocks=blocks), imageGroups=[group], artifacts=artifacts)
manifest = dict(schemaVersion=1, id="3fb391e1-ec49-42ce-9a6d-6db4e9fd4178", name="南京长江大桥 · 演示项目", createdAt="2026-09-29T00:00:00.000Z", updatedAt="2026-09-29T00:00:00.000Z", coverImage="media/bridge-cover.jpg", plan=plan)
(DEST / ".preshotproj").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(DEST / "media/shot-list.txt").write_text("南京长江大桥 · 现场镜头清单\n16:30 集合 / 踩点\n17:00 透明伞逆光\n17:30 泡泡与江风\n18:00 蓝调桥景\n收工：检查照片、备份、带走物品。\n", encoding="utf-8")
credits = (ROOT / "docs/demo/photos/credits.json").read_text(encoding="utf-8")
(DEST / "CREDITS.md").write_text("# Nanjing bridge demo credits\n\nFictional Model A and props are mock illustrations, not real participants.\nThe demo plan and generated media are CC BY-SA 4.0; photographs retain their original licenses.\nThe short video pans the daylight photo; the audio is synthesized, not recorded on location.\nOriginal illustrations: https://github.com/yucdong/Preshot/tree/main/docs/demo/illustrations\n\n```json\n" + credits + "\n```\n", encoding="utf-8")
print(f"Prepared {DEST}")
