# 图片组“原图 / 视图 / PDF / PPT 所见即所得”设计

**状态：** In progress / 画布与 PDF 已实现，PPT 待实现  
**目标：** 图片在画布中经过视图框 resize、裁切和构图调整后，PDF 和 PPT 都使用同一视图结果；原图文件始终不变。

## 术语

- **原图（source）**：导入项目的不可变图片文件及其真实像素尺寸。
- **视图（view）**：用户在图片组中看到的结果，由视图框尺寸和原图裁切矩形共同定义。
- **导出渲染图（rendered view）**：从原图按 view 裁切后生成的结果；PDF 和 PPT 都使用它，必须与画布视图一致。

## 当前问题

schema-v10 图片曾只保存：

```ts
{
  file,
  aspectRatio,
  frameWidth,
  frameHeight
}
```

该版本的画布使用 `object-cover` 居中裁切，而 PDF 使用 `containSize()` 显示完整原图并留白。schema-v11 已加入 crop/source dimensions，并让画布与 PDF 共享裁切规格；PPT adapter 尚未实现。

## 数据模型

schema-v11 让裁切数据独立于屏幕像素：

```ts
interface ReferenceImage {
  id: string;
  file: string;
  sourceWidth?: number;  // 原图像素
  sourceHeight?: number;
  aspectRatio: number;  // sourceWidth / sourceHeight
  frameWidth?: number;  // 画布逻辑 pt
  frameHeight?: number;
  crop?: {
    x: number;          // 原图归一化坐标 0..1
    y: number;
    width: number;
    height: number;
  };
}
```

`crop` 表示原图中真正可见的矩形。它不依赖画布缩放、显示器 DPR、PPT 尺寸或导出分辨率。

### 不变量

```text
0 <= x,y <= 1
0 < width,height <= 1
x + width <= 1
y + height <= 1
(crop.width * sourceWidth) / (crop.height * sourceHeight)
  == frameWidth / frameHeight
```

## 交互语义

| 操作 | 修改内容 | 不修改内容 |
|---|---|---|
| 拖动图片卡片 | 图片顺序 | view/crop |
| 拖动视图四边 | frameWidth/frameHeight，并以当前焦点重算 crop | 原图 |
| 在视图内部拖动 | crop.x/crop.y | frame、原图 |
| 缩放滑杆 | crop.width/crop.height | frame、原图 |
| 查看原图 | 只打开 source lightbox | view |
| 恢复原图 | frame 恢复原图比例，crop = 全图 | 原图文件 |

普通点击仍用于选择；双击查看完整原图。建议只有进入“调整视图”模式后，图片内部拖动才解释为平移裁切，避免与图片排序冲突。

## 迁移

schema-v10 → 新 schema 时：

1. 保留 `file/aspectRatio/frameWidth/frameHeight`；
2. 根据原图比例和 frame 比例计算**居中 cover crop**；
3. 迁移后画布视觉必须与迁移前当前 `object-cover` 完全一致；
4. 原图尺寸解码完成后持久化 `sourceWidth/sourceHeight`；
5. 解码失败时以 aspectRatio 建立虚拟 source 坐标，不能静默改成 contain。

## 统一渲染规格

领域层提供唯一纯函数：

```ts
interface ImageViewRenderSpec {
  source: { x: number; y: number; width: number; height: number }; // source px
  destination: { width: number; height: number };                  // target units
}

viewRenderSpec(image, destinationWidth, destinationHeight)
```

画布、PDF、PPT 都调用它。各 adapter 不得自行选择 `contain`、`cover` 或重新居中。

## 统一导出管线

```text
source file + persisted view
  -> viewRenderSpec(source pixels, normalized crop, destination ratio)
  -> renderViewBitmap(target pixel density)
  -> PDF adapter embeds bitmap at slot x/y/w/h
  -> PPT adapter embeds the same bitmap at shape x/y/w/h
```

- PDF 不再调用当前 `referenceImageDrawBox(...containSize...)`；
- PDF slot 与 PPT shape 只决定目标尺寸，不决定 crop；
- 两个 adapter 可以按各自 DPI 生成不同分辨率 bitmap，但 source crop 必须相同；
- PDF/PPT 的图像压缩只能改变编码质量，不能改变可见区域；
- 如果直接使用 PDF `drawImage` 裁切或 OOXML `srcRect`，必须通过同一个 `viewRenderSpec` 生成参数，并用像素测试验证与 bitmap 路径等价。

## PPT 输出

建议使用 `pptxgenjs` 作为 PPTX adapter，并优先采用确定性视图渲染：

1. `viewRenderSpec` 将归一化 crop 转成原图像素 `sx/sy/sw/sh`；
2. 使用 Canvas/Sharp 按目标 PPT 框的 2× 像素密度生成 view bitmap；
3. PPTX 中按精确 `x/y/w/h` 添加该 bitmap，不再二次裁切；
4. 同一 render pipeline 供 PDF adapter 使用，消除当前 `contain` 差异；
5. 原图仍保留在项目中供 lightbox 和后续重新构图。

若后续确认 PptxGenJS/OOXML `a:srcRect` 对所有目标 Office 版本都稳定，可直接映射 crop，避免重编码；两种实现必须共享 `viewRenderSpec`。

## 验收

- 原图 2000×1200，视图可为 1:1、4:5、16:9 等任意比例；
- 画布、PDF 页面截图、PowerPoint 实际打开截图的 crop 一致；
- 主体焦点位置误差不超过 1 px（按比较截图尺寸）；
- resize、pan、zoom、reset、reload、undo/redo 均保持 view；
- 拖动排序不改变 crop；
- 双击始终展示完整原图；
- v10 迁移前后画布截图无视觉变化；
- PDF/PPT 都不出现 contain 留白或重新居中。

## 测试分层

- Domain：cover crop、clamp、resize-preserve-center、source-pixel mapping；
- Component：四边 resize、调整视图模式、pan/zoom/reset、lightbox 原图；
- Adapter：同一 `ImageViewRenderSpec` 输出 canvas/PDF/PPT；
- E2E：保存/reload；PDF 用 PDFium/Playwright 渲染页面截图；PPT 用 PowerPoint/LibreOffice 渲染为图片；两者都与画布视图截图做像素差异检查。
