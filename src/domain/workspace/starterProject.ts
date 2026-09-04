import type { ProjectPlanV15 } from "../plan/canvas/blockDocument";

export const STARTER_PROJECT_NAME = "Preshot 入门示例";

export function createStarterProjectPlan(): ProjectPlanV15 {
  const paragraphs = [
    "欢迎使用 Preshot。这是一份可以直接编辑的入门拍摄方案。",
    "在这里写下拍摄目标、镜头清单、时间安排和现场提醒。",
    "你可以修改或删除这些文字，也可以继续添加图片、表格和更多内容。",
  ];

  return {
    schemaVersion: 15,
    title: STARTER_PROJECT_NAME,
    document: {
      format: "preshot-blocks",
      version: 3,
      blocks: paragraphs.map((text, index) => ({
        id: `starter-intro-${index + 1}`,
        type: "paragraph",
        props: {},
        content: [{ type: "text", text, styles: {} }],
        children: [],
      })),
    },
    imageGroups: [],
    artifacts: [],
  };
}
