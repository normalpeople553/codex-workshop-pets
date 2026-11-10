# Codex Workshop Pets

给 Codex 桌面端的输入框加一排小宠物。每条正在工作的本地聊天各有一只，按开工顺序从左往右排。开工就会瞪着漩涡眼猛砸键盘，汗滴和键帽一起飞，整条任务完成后才闭眼松一口气。鼠标悬停可以看聊天标题，点击宠物可以跳回对应聊天。

![疯狂干活儿和干完了两种动画](media/pet-preview.gif)

## 在 Codex 里使用

需要 macOS、安装在「应用程序」中的 ChatGPT 桌面端，以及 Node.js 22 或更新版本。先在 Codex 中打开或创建一条本地聊天，再运行下面的命令。

```sh
git clone https://github.com/normalpeople553/codex-workshop-pets.git
cd codex-workshop-pets
./Launch.command
```

也可以在 Finder 双击 `Launch.command`。启动器提示等待时，切回 ChatGPT 按 **⌘Q**，它会重新打开。回到任意本地 Codex 聊天，保留启动器的终端窗口。想测试动作，可以给 Codex 发一条任务。两条本地聊天同时工作时，就能看到两只宠物。

结束时在启动器终端按 **Ctrl+C**，宠物会消失。要结束演示模式，按 **⌘Q** 退出 ChatGPT，再从 Dock 正常打开。

## 设计你自己的宠物

1. 打开 [art/pet.svg](art/pet.svg)，画出角色身体、表情、爪子和道具。可以用 Figma、Inkscape 或任意文本编辑器。
2. 在 [art/pet.css](art/pet.css) 调动作、节奏和配色。保留 SVG 里的动作类名，现有动画就会作用到你的新图形。
3. 运行 `npm run preview`，打开终端给出的本地地址。页面可切换「疯狂干活儿」和「干完了」，也能预览两只并排。改完素材刷新页面即可。
4. 如果桌面演示已经开着，保存 SVG 或 CSS 就会热更新，聊天可以继续开着。

[从空白图形做到会干活的小宠物](docs/design.md)

## 事件和兼容性

桥接在本机读取 Codex 桌面端的聊天事件和标题。任务开始时显示「疯狂干活儿」，任务完成后短暂显示「干完了」，随后收起。手动中止时直接收起。当前实现针对本地桌面聊天，依赖 Codex 的本地事件格式和输入框结构，应用升级后可能需要更新选择器或事件解析。

启动器只在本机回环地址打开临时调试端口，用来把宠物画进窗口。桥接不改应用包，也不把聊天内容发到网络。预览页只加载仓库里的美术文件，使用示例状态。

代码和随附素材按 [Apache-2.0](LICENSE) 分发。窗口内渲染参考了 [Codex Styler](https://github.com/xuhuanstudio/codex-styler)。这是非官方项目，与 OpenAI 无隶属关系。
