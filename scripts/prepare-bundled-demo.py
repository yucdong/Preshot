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
         description="场景参考：桥梁全貌交代环境，桥面线条引导视线，蓝调灯光作为收尾。实拍机位在允许停留的江岸公共步道，参考照片不是进入桥面或铁路的指引。提前 30 分钟确认日落方位、潮湿路面和背景杂物；人物与桥梁错开，避免桥柱从头部穿过。",
         gallery=gallery("demo-location-gallery", image("bridge-day.jpg", 1, (300, 200)), image("bridge-panorama.jpg", 8, (300, 200)), image("bridge-night.jpg", 9, (300, 200)))),
    dict(id="demo-model", kind="modelCard", revision=0, modelId="模特 A（虚构）", heightCm=170, weightKg=52, shoeSize="38",
         notes="虚构模特，三张原创姿态示意：① 半侧身回望，肩膀放松、下巴微收；② 沿步道小步行走，手臂自然摆动，视线看向桥梁；③ 透明伞略向后倾，伞骨避开眼睛，露出完整面部。每组先给一个动作指令，再拍静止、转身、行走三种变化；每轮回看眼神与手指姿态。",
         samples=gallery("demo-model-gallery", image("model-a.png", 2, (175, 132)), image("model-a-walking.png", 10, (175, 132)), image("model-a-umbrella.png", 11, (175, 132)))),
    dict(id="demo-umbrella", kind="prop", revision=0, title="透明伞", source="一把透明长柄伞，提前擦净伞面。人物半侧身，伞向肩后倾斜；侧逆光勾出伞沿，测光照顾面部并检查高光。拍全身、中景、手握伞柄的特写；阵风时立即收起。",
         gallery=gallery("demo-umbrella-gallery", image("transparent-umbrella.png", 3, (400, 300)))),
    dict(id="demo-bubbles", kind="prop", revision=0, title="泡泡机", source="准备电池、两瓶泡泡液与擦拭布。助手站在侧上风方向，先少量试喷，再按风向调整机位；泡泡经过镜头前方，避开人物眼睛与镜头。连续对焦配合短连拍，结束后擦净湿滑地面。",
         gallery=gallery("demo-bubbles-gallery", image("bubble-machine.png", 4, (400, 300)))),
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
    block("demo-location-block", "shootingLocation", props={"artifactId": "demo-location"}),
    block("demo-model-block", "modelCard", props={"artifactId": "demo-model"}),
    heading("demo-props-title", "02 道具与服装"),
    columns("demo-props", [block("demo-umbrella-block", "prop", props={"artifactId": "demo-umbrella"})],
            [block("demo-bubbles-block", "prop", props={"artifactId": "demo-bubbles"})]),
    block("demo-clothing-block", "clothing", props={"artifactId": "demo-clothing"}),
    heading("demo-mood-title", "03 光线与画面参考"),
    block("demo-mood-block", "imageGroup", props={"groupId": "demo-moodboard"}),
    block("demo-divider", "divider"),
    heading("demo-schedule-title", "04 拍摄流程"),
    table,
    heading("demo-techniques-title", "05 构图、曝光与动作"),
    columns("demo-techniques",
        [heading("demo-wide-title", "环境人像", 3), paragraph("demo-wide", "35mm 起步，人物放在画面三分之一处，保留江面与桥梁延伸方向。机位略低于眼睛，桥梁保持水平；人物与栏杆留出距离，先横后竖各拍一组。")],
        [heading("demo-light-title", "日落逆光", 3), paragraph("demo-light", "50–85mm，f/2.8–4；移动人物从 1/500s 起步，Auto ISO 按现场调整。用侧逆光勾勒轮廓，检查面部曝光与伞面高光；需要时用白色反光板轻补。")],
        [heading("demo-blue-title", "蓝调收尾", 3), paragraph("demo-blue", "先保住人脸和桥灯层次，允许背景略暗；静止姿态从 1/160s 起步，提高 ISO 而非让人物拖影。统一白平衡，拍一张干净桥景作为组照收尾。")]),
    paragraph("demo-shot-rhythm", "每个机位按远景交代环境 → 中景表现动作 → 特写补充情绪的顺序拍摄。先示范动作，再短连拍 3–5 张；每组回看眼睛清晰度、表情、衣摆和背景穿帮，合格后再换机位。参数仅为起点，按实际光线与焦段调整。"),
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
    paragraph("demo-weather", "阴天备用：改拍桥梁几何线条和低饱和中景，透明伞作为前景层次，不强求逆光。降雨、雷电或风力明显增大时收起道具并停止江边拍摄；当天集合时间按实际日落时间调整。"),
    paragraph("demo-delivery", "交付目标：12 张精修（环境 3、透明伞 3、泡泡 3、蓝调 3），横竖构图各保留。收工现场核查对焦与缺片，素材复制到两处后再格式化存储卡，标注入选照片与修图方向。"),
    block("demo-page-break", "pageBreak"),
    heading("demo-attachments-title", "06 动态参考与附件"),
    paragraph("demo-motion-info", "下面是由桥景照片制作的 4 秒平移动画，以及人工合成的三声准备提示音。它们用于演示离线视频与音频组件，不是实地录像或现场录音。"),
    block("demo-video", "video", props={"url": "media/bridge-motion.mp4", "name": "桥景构图移动示意.mp4", "caption": "由 Jack No1 的桥景照片制作 · CC BY 3.0", "previewWidth": 480, "showPreview": True}),
    block("demo-audio", "audio", props={"url": "media/ready-tones.wav", "name": "三声准备提示.wav", "caption": "人工合成提示音", "showPreview": True}),
    block("demo-file", "file", props={"url": "media/shot-list.txt", "name": "现场镜头清单.txt", "caption": "可下载随身携带的拍摄提醒", "showPreview": False}),
    block("demo-settings", "codeBlock", "# 起始参数示例，请按实际光线调整\nlens = 50 mm\naperture = f/2.8\nshutter = 1/500 s\nISO = Auto", {"language": "text"}),
    heading("demo-help-title", "如何修改这份样例"),
    paragraph("demo-help", "输入 / 插入组件。拖住 block 左侧六点手柄到其他 block 左右边缘即可分栏；拖动栏间分隔线调宽。图片组会等比缩放。单击图片可存入素材库；用图片组的“从素材库插入”追加图片。"),
    paragraph("demo-export", "使用右上角“导出”生成 PDF、DOCX 或长图。视频和音频在静态导出中显示附件信息；需要播放时请打开项目。长图较长时可勾选自动分割。"),
    heading("demo-credits-title", "图片来源与许可", 3),
    paragraph("demo-credits", "日间桥景：Jack No1，CC BY 3.0；全貌：Saigyouji-Noriko，CC BY-SA 4.0；夜景：Vasily Astanin，CC BY-SA 4.0，均来自 Wikimedia Commons。模特 A 的三种姿态、透明伞与泡泡机为 Preshot 原创示意图（CC BY-SA 4.0）。照片已缩放与重新编码。详见项目中的 CREDITS.md。"),
]
plan = dict(schemaVersion=16, title="南京长江大桥 · 江风与人像", document=dict(format="preshot-blocks", version=4, blocks=blocks), imageGroups=[group], artifacts=artifacts)
manifest = dict(schemaVersion=1, id="3fb391e1-ec49-42ce-9a6d-6db4e9fd4178", name="南京长江大桥 · 演示项目", createdAt="2026-09-29T00:00:00.000Z", updatedAt="2026-09-29T00:00:00.000Z", coverImage="media/bridge-cover.jpg", plan=plan)
(DEST / ".preshotproj").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(DEST / "media/shot-list.txt").write_text("南京长江大桥 · 现场镜头清单\n16:30 集合 / 踩点\n17:00 透明伞逆光\n17:30 泡泡与江风\n18:00 蓝调桥景\n收工：检查照片、备份、带走物品。\n", encoding="utf-8")
credits = (ROOT / "docs/demo/photos/credits.json").read_text(encoding="utf-8")
(DEST / "CREDITS.md").write_text("# Nanjing bridge demo credits\n\nFictional Model A and props are mock illustrations, not real participants.\nThe demo plan and generated media are CC BY-SA 4.0; photographs retain their original licenses.\nThe short video pans the daylight photo; the audio is synthesized, not recorded on location.\nOriginal illustrations: https://github.com/yucdong/Preshot/tree/main/docs/demo/illustrations\n\n```json\n" + credits + "\n```\n", encoding="utf-8")
print(f"Prepared {DEST}")
