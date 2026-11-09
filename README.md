# RegExp 下载整理器（汉化版）

一款 Chrome 扩展：按你自定义的**正则规则**，把下载的文件自动归类到默认下载目录下的子文件夹。
汉化并美化自 [unintended/download-organizer-chrome-extension](https://github.com/unintended/download-organizer-chrome-extension)，零依赖、纯静态，无需构建。

## 功能

- 下载文件按规则自动重命名、归类到子文件夹
- 匹配条件：MIME 类型、下载 URL、最终下载 URL、来源页 URL、Tab URL、文件名，全部支持正则（捕获组）
- 目标路径支持 `${字段:捕获组}` 占位符和 `${date:YYYY-MM-DD}` 日期占位符
- 规则启用开关、上下排序、描述、同名冲突处理（自动重命名 / 覆盖 / 询问）
- 规则导入、导出、从文本新建、云端同步（chrome.storage.sync）、从 gist/URL 加载
- 深浅色跟随系统，完全离线可用

## 安装（开发者模式加载已解包）

1. 下载本仓库并解压（或 `git clone`）
2. 打开 Chrome，进入 `chrome://extensions/`
3. 打开右上角的「开发者模式」
4. 点「加载已解压的扩展程序」，选择本仓库的文件夹（含 `manifest.json` 的那层）
5. 安装成功后，扩展的「选项/详情」页即下载规则管理器

## 使用说明

- 每次开始下载时，规则按顺序逐条应用：第一条所有非空匹配条件都命中的规则生效，决定文件的保存路径
- 「新建规则」下拉里有模板：**空白规则**、**按扩展名分类**、**按 MIME 类型分类**、**按网站 URL 分类**，选一个把示例值改成自己的就能用
- 两条最常用的字段直接放在编辑表单顶部：**文件名匹配**（如 `\.(exe|zip)$`）和**目标路径**（如 `软件/${filename}`，以 `/` 结尾会自动追加原文件名）
- 其余匹配条件与同名冲突处理折叠在「高级选项」里
- 所有正则不区分大小写；目录分隔符请用 `/`；Chrome 限定文件必须落在默认下载目录内

## 从 gist / URL 加载规则

选项页的「云端规则」区域可以从任意 URL 拉取规则：

1. URL 输入框粘贴规则链接，点「加载」
2. 首次会请求访问该域名的权限，同意后扩展会抓取、解析、校验
3. 校验通过会弹出预览，选择**替换现有**或**合并到现有**

### 造一个规则 gist

1. 新建一个 gist：<https://gist.github.com/>（单一文件即可，文件名随意，比如 `rules.json`）
2. 文件内容是**规则 JSON 数组**，例如：

    ```json
    [
      { "description": "图片", "mime": "image/.*", "pattern": "images/", "enabled": true },
      { "description": "按来源域名分组", "referrer": ".+?://([^/]+)/.*", "pattern": "site/${referrer:1}/", "enabled": true }
    ]
    ```

    字段说明（`pattern` 必填，其余可选）：

    | 字段 | 含义 |
    --- | ---
    | `pattern` | 目标路径模式（必填），如 `文件夹/` |
    | `mime` / `tabUrl` / `referrer` / `url` / `finalUrl` / `filename` | 各匹配条件（正则） |
    | `description` | 人类可读的描述 |
    | `enabled` | 是否启用（`true` / `false`） |
    | `conflict-action` | 同名冲突处理：`uniquify` / `overwrite` / `prompt` |

3. 点文件右上角的 **Raw** 按钮，浏览器地址栏里的 raw 链接（形如 `https://gist.githubusercontent.com/用户名/gist-id/raw/文件名`，建议用固定版本的那条）就是可粘贴的「规则 URL」

> 注意：raw 链接不带提交哈希时指向最新版本，编辑 gist 后会实时变化；两种链接都能用。

## 故障排查

1. 打开 `chrome://extensions/`，在扩展卡片上点「服务工作进程 / Service Worker」查看控制台
2. 随便下载一个文件，控制台会打印 `Downloading item %o`——里面的字段值就是规则可以匹配的内容
3. 没有万能规则，不同站点的链接结构不同；把控制台里的下载项信息贴到 [问题反馈](https://github.com/unintended/download-organizer-chrome-extension/issues) 里有助定位

## 目录结构

```
manifest.json     # 扩展清单（MV3）
manager.js        # 下载拦截与规则匹配（service worker）
options.html/.js  # 选项页（下载规则管理器）
styles.css        # 选项页样式
js/moment-es.js   # 日期占位符依赖
offscreen.html + migration.js  # 旧版 localStorage 数据迁移
_locales/ icons/ LICENSE
```

## License

见 [LICENSE](LICENSE)。
