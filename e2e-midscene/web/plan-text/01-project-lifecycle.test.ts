import { describe, it } from "vitest";
import { WebTest } from "../../context";
import { withFreshProject } from "../../support/fresh-project";

const targetUrl = process.env.MIDSCENE_APP_URL ?? "http://127.0.0.1:1423";

describe.sequential("Preshot 文案组件 Midscene UI Automation", () => {
  const ctx = WebTest.setup(targetUrl, {
    viewport: { width: 1440, height: 900 },
    agentOptions: {
      aiActionContext: "你是熟悉中文摄影工作台的 Web UI 测试专家。只操作当前唯一的 UIAUTO 测试项目；所有确认基于用户可见界面，并等待自动保存完成后再继续。",
    },
  });

  it("M01 新项目、插入文案、编辑保存与清理", async () => {
    await withFreshProject(ctx.page, ctx.agent, "M01", async ({ evidence }) => {
      await ctx.agent.aiAct("点击画布上方的“插入组件”，在菜单中选择“文案”。确认出现一张文案卡片，卡片内有常驻格式工具栏和可编辑正文，并且右上角 X 完全位于卡片内部。");
      await evidence.checkpoint("text-inserted");
      await ctx.agent.aiAct("点击文案卡片正文，将正文全部替换为两行内容：第一行“Midscene 自动化标题”，第二行“PRESHOT-M01-SAVED”。完成后点击正文外的画布空白，并等待顶部保存状态显示“已保存所有更改”。");
      await evidence.checkpoint("text-saved");
      await ctx.agent.aiAct("确认文案卡片中清晰显示“Midscene 自动化标题”和“PRESHOT-M01-SAVED”，格式工具栏仍可见，页面没有错误提示。不要修改内容。");
    });
  });

  it("M02 块类型、字号、行内格式与对齐", async () => {
    await withFreshProject(ctx.page, ctx.agent, "M02", async ({ evidence }) => {
      await ctx.agent.aiAct("插入一个文案组件。把正文全部替换为四行：第一行“一级标题测试”，第二行“二级标题测试”，第三行“段落格式测试”，第四行“行内格式测试”。等待编辑完成。");
      await ctx.agent.aiAct("选中第一行“一级标题测试”，通过段落类型菜单设置为一级标题，确认工具栏字号显示 32；再选中第二行设置为二级标题，确认字号显示 24；第三行保持段落并确认字号显示 16。");
      await evidence.checkpoint("heading-sizes");
      await ctx.agent.aiAct("选中第四行“行内格式测试”，依次点击加粗、斜体、下划线、删除线，再点击居中。确认文字同时显示这些格式并位于中央。然后点击同一行右侧空白，确认选中高亮消失。");
      await ctx.agent.aiAct("打开字号下拉菜单，然后点击正文以外的画布空白，确认字号菜单自动关闭。确认页面没有错误提示。");
      await evidence.checkpoint("inline-formatting");
    });
  });

  it("M03 主题色、自定义色盘、RGB 与链接", async () => {
    await withFreshProject(ctx.page, ctx.agent, "M03", async ({ evidence }) => {
      await ctx.agent.aiAct("插入一个文案组件，把正文全部替换为一行“颜色与链接测试”。选中整行，打开文字颜色菜单并选择功能青，确认文字立即显示为青色。");
      await ctx.agent.aiAct("再次选中整行“颜色与链接测试”，打开文字颜色菜单并点击“更多颜色...”。确认自定义颜色面板已打开，保持这行文字为选中状态。");
      await ctx.agent.aiAct("在自定义颜色面板中把明度设为 100，在圆形色盘靠近最右侧边缘的位置点击。确认预览是接近纯红的颜色，R 为 255，G 和 B 都不超过 20。暂时不要点击应用。");
      await ctx.agent.aiAct("在自定义颜色面板中把 R、G、B 输入精确修改为 255、0、0，确认预览为纯红色且显示 #FF0000。暂时不要点击应用。");
      await evidence.record("before-red-apply", await ctx.page.evaluate(() => ({
        selectedText: window.getSelection()?.toString() ?? "",
        selectionCollapsed: window.getSelection()?.isCollapsed ?? true,
        editorHtml: document.querySelector('[contenteditable="true"]')?.innerHTML ?? null,
      })));
      await ctx.agent.aiAct("点击自定义颜色面板右下角的“应用”按钮，然后等待自动保存完成。不要执行其他操作。");
      await evidence.record("after-red-apply", await ctx.page.evaluate(() => {
        const editor = document.querySelector('[contenteditable="true"]');
        const colored = editor?.querySelector<HTMLElement>('[style*="color"]');
        return {
          selectedText: window.getSelection()?.toString() ?? "",
          selectionCollapsed: window.getSelection()?.isCollapsed ?? true,
          computedColor: colored ? getComputedStyle(colored).color : null,
          editorHtml: editor?.innerHTML ?? null,
        };
      }));
      await ctx.agent.aiAct("确认“颜色与链接测试”文字现在为纯红色，并且选中高亮已经消失。不要点击任何控件。");
      await evidence.checkpoint("wheel-color");
      await ctx.agent.aiAct("再次选中整行，打开更多颜色，把 R、G、B 分别输入 194、56、92，确认显示 #C2385C，然后点击应用并确认文字变成浆果红。");
      await ctx.agent.aiAct("选中“颜色与链接测试”，点击添加链接，输入 example.com 并应用。确认文字显示链接样式；再次打开链接编辑，把地址清空后应用，确认链接样式被移除且页面无错误提示。");
      await evidence.checkpoint("rgb-link");
    });
  });

  it("M04 列表、嵌套、引用与代码块", async () => {
    await withFreshProject(ctx.page, ctx.agent, "M04", async ({ evidence }) => {
      await ctx.agent.aiAct("插入一个文案组件，把正文全部替换为四行：第一项、第二项、引用内容、const answer = 42。选中前两行，通过段落类型菜单设置为无序列表，确认每项前有圆点。");
      await ctx.agent.aiAct("把无序列表切换为有序列表，确认显示数字序号。把光标放在第二项，打开更多格式并点击嵌套，确认第二项向右缩进；再点击取消嵌套，确认恢复原层级。");
      await evidence.checkpoint("lists-nesting");
      await ctx.agent.aiAct("选中“引用内容”这一行，通过段落类型菜单设置为引用，确认出现引用视觉边线。选中“const answer = 42”这一行，打开更多格式并设置为代码块，确认显示等宽代码区域。");
      await ctx.agent.aiAct("打开更多格式，确认里面没有重复的左对齐、居中、右对齐按钮，并且页面没有错误提示。");
      await evidence.checkpoint("quote-code");
    });
  });

  it("M05 递归拆分、独立编辑、删除与撤销", async () => {
    await withFreshProject(ctx.page, ctx.agent, "M05", async ({ evidence }) => {
      await ctx.agent.aiAct("插入一个文案组件。将鼠标悬停在正文区域，点击“左右拆分当前文案”，确认出现左右两个独立正文框。");
      await ctx.agent.aiAct("在右侧正文框上点击“上下拆分当前文案”，确认总共有三个正文框，形成左侧一个、右侧上下两个的混合布局。分别输入“左叶内容”“右上叶内容”“右下叶内容”。");
      await evidence.checkpoint("recursive-split");
      await ctx.agent.aiAct("只选中右上叶的文字并点击加粗。确认右上叶文字加粗，而左叶和右下叶没有被加粗；三个正文框都没有标题输入框或内部滚动条。");
      await ctx.agent.aiAct("悬停右下叶，点击删除当前子文案，在确认框先取消；再次删除并确认。确认右下叶消失。按 Ctrl+Z，确认右下叶恢复；再次执行删除并确认，确认剩余布局自动填满空间。");
      await evidence.checkpoint("leaf-delete-undo");
    });
  });

  it("M06 排序、Resize、窄工具栏与关闭按钮", async () => {
    await withFreshProject(ctx.page, ctx.agent, "M06", async ({ evidence }) => {
      await ctx.agent.aiAct("连续插入两个文案组件。确认有两张文案卡片；使用第一张卡片旁的下移按钮把它移动到第二个位置，再用上移按钮恢复，确认顺序变化且没有拖动残影。");
      await ctx.agent.aiAct("拖动第一张文案卡片右边缘向左缩窄，直到出现“内容已达到最小尺寸”提示。确认右上角 X 始终完全位于卡片内部且不遮挡格式工具栏。再向右拖宽，确认限制提示消失。");
      await evidence.checkpoint("resize-limits");
      await ctx.agent.aiAct("再次把第一张卡片缩窄到工具栏无法一次显示全部按钮。把鼠标移入工具栏，使用右侧滚动箭头向右移动，再确认左侧滚动箭头出现并可用。");
      await ctx.agent.aiAct("选中正文中的一行文字，然后点击卡片最右侧透明 resize 区域，确认文字选择高亮立即消失。点击第二张卡片右上角 X，在确认框先取消，再次点击并确认删除，确认只剩一张文案卡片。");
      await evidence.checkpoint("toolbar-close-selection");
    });
  });

  it("M07 自动保存、刷新、撤销与重做", async () => {
    await withFreshProject(ctx.page, ctx.agent, "M07", async ({ evidence }) => {
      await ctx.agent.aiAct("插入一个文案组件，把正文全部替换为两行：第一行“持久化标题”，第二行“PRESHOT-MIDSCENE-M07”。确认两行文字都已显示。");
      await ctx.agent.aiAct("选中第一行“持久化标题”，通过段落类型菜单设置为一级标题。确认它显示为一级标题且工具栏字号为 32。");
      await ctx.agent.aiAct("选中第二行“PRESHOT-MIDSCENE-M07”，打开字号菜单并设置为 24。确认工具栏字号显示 24。");
      await ctx.agent.aiAct("保持第二行“PRESHOT-MIDSCENE-M07”为选中状态，打开文字颜色菜单并应用主题色“浆果红”。确认文字显示为浆果红。");
      await ctx.agent.aiAct("将鼠标悬停在当前文案正文，点击“左右拆分当前文案”。确认出现两个独立正文框，然后等待顶部显示“已保存所有更改”。");
      await evidence.checkpoint("before-reload");
      await ctx.agent.aiAct("刷新当前页面并等待项目重新打开。确认仍显示项目中的文案组件、左右拆分布局、“持久化标题”和“PRESHOT-MIDSCENE-M07”，且可见字号与颜色格式仍保留。");
      await ctx.agent.aiAct("按 Ctrl+Z，确认最近一次可撤销的编辑发生回退；再按 Ctrl+Shift+Z，确认该编辑恢复。等待顶部重新显示“已保存所有更改”，并确认没有错误提示。");
      await evidence.checkpoint("reload-undo-redo");
    });
  });

  it("M08 PDF 导出、组件删除与项目清理", async () => {
    await withFreshProject(ctx.page, ctx.agent, "M08", async ({ evidence }) => {
      await ctx.agent.aiAct("插入一个文案组件，把正文全部替换为三行：第一行“PDF 自动化测试”，第二行“导出列表项目”，第三行“console.log('Preshot')”。确认三行都已显示。");
      await ctx.agent.aiAct("选中第一行“PDF 自动化测试”并设置为一级标题。再选中第二行“导出列表项目”并设置为无序列表，确认前面有圆点。");
      await ctx.agent.aiAct("选中第三行“console.log('Preshot')”，打开更多格式并设置为代码块。确认显示等宽代码区域，然后等待保存完成。");
      await evidence.checkpoint("pdf-content");
      await ctx.agent.aiAct("点击页面顶部“导出”按钮，在菜单中选择“导出 PDF”，等待导出过程完成。确认按钮恢复为“导出”，页面没有错误提示，并且文案卡片仍完整显示标题、列表圆点和代码块。");
      await evidence.checkpoint("pdf-exported");
      await ctx.agent.aiAct("点击文案卡片右上角 X，在确认对话框中确认删除。确认画布恢复为空并重新显示“插入组件”按钮，顶部最终显示“已保存所有更改”。");
      await evidence.checkpoint("component-deleted");
    });
  });
});
