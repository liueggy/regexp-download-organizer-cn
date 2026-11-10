import moment from './js/moment-es.js';

const RULE_FIELDS = ['mime', 'tabUrl', 'referrer', 'url', 'finalUrl', 'filename'];

/** 规则对象中允许保存的全部字段（远程规则加载时据此清洗，schema 与 manager.js 约定保持不变） */
const REMOTE_RULE_FIELDS = ['pattern', 'description', 'enabled', 'conflict-action'].concat(RULE_FIELDS);

const FIELD_LABELS = {
    'mime': 'MIME 类型',
    'tabUrl': 'Tab URL',
    'referrer': '来源页 URL',
    'url': '下载 URL',
    'finalUrl': '最终下载 URL',
    'filename': '文件名',
};

const DEFAULT_RULES = [
    { "description": "Windows 安装包（.exe/.msi）", "mime": "application/(x-msdownload|x-ms-installer|x-msi|exe)", "pattern": "installers/", "enabled": true },
    { "description": "Linux 安装包（.deb/.rpm）", "mime": "application/(x-debian-package|x-redhat-package-manager|x-rpm)", "pattern": "installers/", "enabled": true },
    { "description": "Mac 安装包（.dmg）", "mime": "application/x-apple-diskimage", "pattern": "installers/", "enabled": true },
    { "description": "zip/gzip 压缩包", "mime": "application/(zip|gzip|x-gzip)", "pattern": "archives/", "enabled": true },
    { "description": "图片", "mime": "image/.*", "pattern": "images/", "enabled": true },
    { "description": "BT 种子", "mime": "application/x-bittorrent", "pattern": "torrents/", "enabled": true },
    { "description": "按来源域名建文件夹存放下载", "pattern": "site/${referrer:1}/", "referrer": ".+?://([^/]+)/.*", "enabled": false },
    { "description": "其余文件按日期归类", "mime": ".*", "pattern": "other/${date:YYYY-MM-DD}/", "enabled": false }
];

/** 「新建规则」下拉里的模板 */
const RULE_TEMPLATES = {
    blank: {},
    ext: {
        description: '按扩展名分类',
        filename: '\\.(exe|zip)$',
        pattern: '文件夹/',
    },
    mime: {
        description: '按 MIME 类型分类',
        mime: 'image/(png|jpeg)',
        pattern: '文件夹/',
    },
    site: {
        description: '按网站分类',
        referrer: '.+?://([^/]+)/.*',
        pattern: '网站/${referrer:1}/',
    },
};

/* ---------- 小工具 ---------- */

function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined && text !== null) {
        node.textContent = text;
    }
    return node;
}

var icons = {
    folder: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>',
    up: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>',
    down: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
};

function iconButton(svg, className, title) {
    var btn = el('button', 'icon-btn ' + (className || ''));
    btn.type = 'button';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = svg;
    return btn;
}

var toastTimer = null;
function toast(message) {
    var node = document.getElementById('toast');
    node.textContent = message;
    node.hidden = false;
    if (toastTimer) {
        clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(function () {
        node.hidden = true;
        toastTimer = null;
    }, 2600);
}

/* ---------- 存取 ---------- */

var rulesets = [];
/** 当前展开的规则下标集合 */
var openRules = new Set();

var saveTimer = null;
function saveRules() {
    return chrome.storage.local.set({ 'rulesets': rulesets });
}

function queueSave() {
    if (saveTimer) {
        clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(function () {
        saveTimer = null;
        saveRules();
    }, 250);
}

async function resetRules() {
    await chrome.storage.local.set({ 'rulesets': DEFAULT_RULES });
    rulesets = structuredClone(DEFAULT_RULES);
}

async function syncRulesToCloud() {
    await chrome.storage.sync.set({ 'config': { 'rulesets': rulesets } });
}

async function syncRulesFromCloud() {
    var result = await chrome.storage.sync.get(['config']);
    if (!result.config || !result.config.rulesets) {
        toast('云端没有已备份的规则');
        return;
    }
    rulesets = structuredClone(result.config.rulesets);
    await saveRules();
    await renderRules();
    toast('已从云端同步规则');
}

function hasDisabledRules() {
    return rulesets.some(function (rule) { return rule.enabled === false; });
}

function hasEnabledTabUrlRules() {
    return rulesets.some(function (rule) {
        return rule.enabled !== false && rule.tabUrl;
    });
}

async function updateAlerts() {
    var hasPermission = await chrome.permissions.contains({ permissions: ['tabs'] });
    document.getElementById('disabled-rules-alert').hidden = !hasDisabledRules();
    document.getElementById('taburl-permission-alert').hidden = !(hasEnabledTabUrlRules() && !hasPermission);
}

/* ---------- 渲染 ---------- */

async function renderRules() {
    var container = document.getElementById('rules-container');
    container.textContent = '';

    if (!rulesets.length) {
        var empty = el('div', 'rules-empty');
        empty.appendChild(el('strong', null, '还没有规则！'));
        empty.appendChild(document.createTextNode('点「新建规则」添加一条，或从上面的模板快速创建。'));
        container.appendChild(empty);
    }

    rulesets.forEach(function (rule, idx) {
        container.appendChild(buildRuleCard(rule, idx));
    });

    await updateAlerts();
}

function badgesSummary(rule) {
    var matchKeys = RULE_FIELDS.filter(function (key) { return rule[key]; });
    if (!(rule.pattern && matchKeys.length)) {
        return null;
    }
    var line = el('span', 'rule-summary-line');
    RULE_FIELDS.forEach(function (key) {
        var isActive = !!rule[key];
        var badge = el('span', 'badge badge-' + key.toLowerCase() + (isActive ? '' : ' badge-off'), key.substr(0, 1).toUpperCase());
        if (isActive) {
            badge.setAttribute('title', key + ': ' + rule[key]);
        } else {
            badge.setAttribute('title', FIELD_LABELS[key] + ': 未填写');
        }
        line.appendChild(badge);
    });
    var icon = el('span', 'folder-icon', '');
    icon.innerHTML = icons.folder;
    line.appendChild(icon);
    line.appendChild(el('strong', 'rule-path', rule.pattern));
    if (rule.description) {
        line.appendChild(el('small', 'rule-desc', rule.description));
    }
    return line;
}

function fillSummary(summaryEl, rule) {
    summaryEl.textContent = '';
    var line = badgesSummary(rule);
    if (line) {
        summaryEl.appendChild(line);
    } else {
        summaryEl.appendChild(el('span', 'rule-custom-name', '空规则 — 点击展开编辑'));
    }
}

function refreshCardSummary(card, rule) {
    fillSummary(card.querySelector('.rule-summary'), rule);
}

function buildRuleCard(rule, idx) {
    var card = el('article', 'rule-card' + (rule.enabled === false ? ' rule-disabled' : ''));
    card.dataset.idx = String(idx);

    /* 顶行：开关 + 摘要 + 操作 */
    var wrapper = el('div', 'rule-wrapper');

    var open = openRules.has(idx);

    var label = el('label', 'switch');
    var checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.field = 'enabled';
    checkbox.checked = rule.enabled !== false;
    checkbox.title = checkbox.checked ? '已启用' : '已停用';
    var track = el('span', 'switch-track');
    label.appendChild(checkbox);
    label.appendChild(track);
    checkbox.addEventListener('change', function () {
        rule.enabled = checkbox.checked;
        checkbox.title = checkbox.checked ? '已启用' : '已停用';
        card.classList.toggle('rule-disabled', !checkbox.checked);
        saveRules().then(updateAlerts);
    });
    wrapper.appendChild(label);

    var summary = el('button', 'rule-summary');
    summary.type = 'button';
    fillSummary(summary, rule);
    summary.setAttribute('aria-expanded', String(open));
    summary.addEventListener('click', function () {
        var i = Number(card.dataset.idx);
        var editor = card.querySelector('.rule-editor');
        if (openRules.has(i)) {
            openRules.delete(i);
            editor.hidden = true;
            summary.setAttribute('aria-expanded', 'false');
        } else {
            openRules.add(i);
            editor.hidden = false;
            summary.setAttribute('aria-expanded', 'true');
        }
    });

    wrapper.appendChild(label);
    wrapper.appendChild(summary);

    var actions = el('div', 'rule-actions');
    var upBtn = iconButton(icons.up, '', '上移');
    var downBtn = iconButton(icons.down, '', '下移');
    var shareBtn = iconButton(icons.copy, '', '复制规则 JSON');
    var deleteBtn = iconButton(icons.trash, 'icon-danger', '删除');

    upBtn.disabled = idx === 0;
    downBtn.disabled = idx + 1 === rulesets.length;

    upBtn.addEventListener('click', function () { moveRule(idx, -1); });
    downBtn.addEventListener('click', function () { moveRule(idx, +1); });
    deleteBtn.addEventListener('click', function () { deleteRule(idx); });
    shareBtn.addEventListener('click', function () {
        var json = JSON.stringify(rule, null, 2);
        navigator.clipboard.writeText(json).then(function () {
            toast('整条规则 JSON 已复制到剪贴板');
        }, function () {
            toast('复制失败，请手动复制');
        });
    });

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(shareBtn);
    actions.appendChild(deleteBtn);
    wrapper.appendChild(actions);

    card.appendChild(wrapper);

    /* 编辑区 */
    var editor = buildRuleEditor(rule, card);
    editor.hidden = !open;
    card.appendChild(editor);

    return card;
}

function buildRuleEditor(rule, card) {
    var editor = el('div', 'rule-editor');

    function addField(parentRow, labelText, field, opts) {
        opts = opts || {};
        var row = parentRow || el('div', 'editor-row');
        if (labelText) {
            var lbl = el('label', 'field-label');
            lbl.setAttribute('for', '');
            lbl.textContent = labelText;
            row.appendChild(lbl);
        }
        var input;
        if (opts.selectOptions) {
            input = el('select', 'input');
            opts.selectOptions.forEach(function (opt) {
                var option = el('option', null, opt[1]);
                option.value = opt[0];
                input.appendChild(option);
            });
            input.value = rule[field] || opts.selectOptions[0][0];
            input.dataset.field = field;
            input.addEventListener('change', function () {
                var val = input.value;
                if (val && val.length) {
                    rule[field] = val;
                } else {
                    delete rule[field];
                }
                queueSave();
            });
        } else {
            input = el(opts.tag || 'input', 'input' + (opts.large ? ' input-lg' : ''));
            if (opts.tag !== 'textarea') {
                input.type = 'text';
            }
            input.dataset.field = field;
            input.value = rule[field] || '';
            if (opts.placeholder) {
                input.placeholder = opts.placeholder;
            }
            input.addEventListener('input', function () {
                var val = input.value;
                if (val && val.length) {
                    rule[field] = val;
                } else {
                    delete rule[field];
                }
                queueSave();
                refreshCardSummary(card, rule);
            });
        }
        row.appendChild(input);
        if (opts.hint) {
            row.appendChild(el('div', 'field-inline', opts.hint));
        }
        if (!parentRow) {
            editor.appendChild(row);
        }
        return row;
    }

    /* 描述 */
    addField(null, '描述', 'description', { placeholder: '给这条规则写个易懂的描述' });

    /* 常用：文件名匹配 + 目标路径 */
    addField(null, '文件名匹配', 'filename', {
        large: true,
        placeholder: '例如 \\.(exe|zip)$',
        hint: '仅匹配文件名部分（如 download.zip）',
    });
    addField(null, '目标路径', 'pattern', {
        large: true,
        placeholder: '例如 images/${referrer:1}/${filename}',
        hint: '目录分隔符用正斜杠 “/”；路径以 / 结尾时，将自动在末尾追加原文件名',
    });

    /* 高级选项 */
    var details = el('details', 'adv');
    details.appendChild(el('summary', null, '高级选项'));

    var advBody = el('div', 'adv-body');
    var grid = el('div', 'adv-grid');

    function addCompactField(fieldName, label, placeholder) {
        var lbl = el('label', null, label);
        if (placeholder) {
            lbl.title = placeholder;
        }
        grid.appendChild(lbl);
        var row = el('div');
        var input = el('input', 'input');
        input.type = 'text';
        input.dataset.field = fieldName;
        input.value = rule[fieldName] || '';
        input.placeholder = placeholder || '';
        input.addEventListener('input', function () {
            var val = input.value;
            if (val && val.length) {
                rule[fieldName] = val;
            } else {
                delete rule[fieldName];
            }
            queueSave();
            refreshCardSummary(card, rule);
        });
        row.appendChild(input);
        grid.appendChild(row);
    }

    addCompactField('mime', 'MIME 类型', '例如 image/jpeg（可用 | 表示「或」，如 image/jpeg|image/png，也可用正则通配，如 image/.*）');
    addCompactField('tabUrl', 'Tab URL', '匹配当前页面 URL，例如 .*\\.instagram\\.com.*');
    addCompactField('url', '下载 URL', '例如 .*\\.instagram\\.com');
    addCompactField('finalUrl', '最终下载 URL（全部重定向后的地址）', '例如 .*\\.instagram\\.com');
    addCompactField('referrer', '来源页 URL', '例如 drive\\.google\\.com（大网站常把文件放在 CDN 上，可用本字段代替下载 URL 来匹配）');

    advBody.appendChild(grid);

    var conflictRow = el('div', 'conflict-row');
    conflictRow.appendChild(el('label', null, '同名冲突处理:'));
    var select = el('select', 'input');
    select.dataset.field = 'conflict-action';
    [
        ['uniquify', '自动重命名'],
        ['overwrite', '覆盖'],
        ['prompt', '逐次询问（“另存为...”）'],
    ].forEach(function (opt) {
        var option = el('option', null, opt[1]);
        option.value = opt[0];
        select.appendChild(option);
    });
    select.value = rule['conflict-action'] || 'uniquify';
    select.addEventListener('change', function () {
        var val = select.value;
        if (val && val.length) {
            rule['conflict-action'] = val;
        } else {
            delete rule['conflict-action'];
        }
        queueSave();
    });
    conflictRow.appendChild(select);
    advBody.appendChild(conflictRow);

    details.appendChild(advBody);
    editor.appendChild(details);

    return editor;
}

/* ---------- 结构性操作 ---------- */

function adjustOpenRulesFor(op, index) {
    var adjusted = new Set();
    openRules.forEach(function (i) {
        var j = i;
        if (op === 'unshift') {
            j += 1;
        } else if (op === 'splice' && index !== undefined) {
            if (i === index) {
                return; // 被删除的那条不再保持展开
            }
            if (i > index) {
                j -= 1;
            }
        }
        adjusted.add(j);
    });
    openRules = adjusted;
}

async function reloadAll() {
    await saveRules();
    await renderRules();
}

function moveRule(idx, delta) {
    var target = idx + delta;
    if (target < 0 || target >= rulesets.length) {
        return;
    }
    var tmp = rulesets[idx];
    rulesets[idx] = rulesets[target];
    rulesets[target] = tmp;
    adjustOpenRulesForMove(idx, target);
    reloadAll();
}

function adjustOpenRulesForMove(a, b) {
    var adjusted = new Set();
    openRules.forEach(function (i) {
        if (i === a) {
            adjusted.add(b);
        } else if (i === b) {
            adjusted.add(a);
        } else {
            adjusted.add(i);
        }
    });
    openRules = adjusted;
}

function deleteRule(idx) {
    rulesets.splice(idx, 1);
    adjustOpenRulesFor('splice', idx);
    reloadAll();
    toast('已删除规则');
}

/* ---------- 对话框通用 ---------- */

function openDialog(dialog, onOpen) {
    if (onOpen) {
        onOpen();
    }
    dialog.showModal();
}

function closeDialog(dialog) {
    dialog.close();
}

function initDialogCloseButtons() {
    document.querySelectorAll('.dlg [data-close]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            closeDialog(btn.closest('dialog'));
        });
    });
}

function showErrorIn(containerId, message) {
    var box = document.getElementById(containerId);
    box.textContent = message;
    box.hidden = false;
}

function hideErrorIn(containerId) {
    var box = document.getElementById(containerId);
    box.textContent = '';
    box.hidden = true;
}

/* ---------- 从文本新建 / 导入 ---------- */

function initAddRuleFromText() {
    var dialog = document.getElementById('add-rule-text-dialog');
    var textarea = document.getElementById('add-rule-text-textarea');
    var openBtn = document.getElementById('add-rule-from-text-btn');
    var createBtn = document.getElementById('add-rule-text-create-btn');

    openBtn.addEventListener('click', function () {
        if (document.getElementById('add-rule-menu').hidden === false) {
            document.getElementById('add-rule-menu').hidden = true;
        }
        openDialog(dialog, function () {
            textarea.value = '';
            hideErrorIn('add-rule-text-error');
            textarea.focus();
        });
    });

    createBtn.addEventListener('click', function () {
        var rule;
        try {
            rule = JSON.parse(textarea.value);
            if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
                throw { 'message': '应为一个 JSON 对象' };
            }
        } catch (e) {
            showErrorIn('add-rule-text-error', '规则格式错误：' + (e.message || String(e)));
            return;
        }
        closeDialog(dialog);
        adjustOpenRulesFor('unshift');
        rulesets.unshift(rule);
        reloadAll();
        toast('已添加新规则');
    });
}

function initImportRules() {
    var dialog = document.getElementById('import-rules-dialog');
    var textarea = document.getElementById('import-rules-textarea');
    var fileInput = document.getElementById('import-rules-file-input');
    var replaceCheckbox = document.getElementById('import-rules-replace-existing-ckbx');
    var submitBtn = document.getElementById('import-rules-submit-btn');
    var openBtn = document.getElementById('import-rules-btn');

    var reader = new FileReader();
    reader.onload = function () {
        textarea.value = reader.result;
        hideErrorIn('import-rules-error');
    };
    fileInput.addEventListener('change', function () {
        if (!this.files || !this.files[0]) {
            return;
        }
        reader.readAsText(this.files[0]);
    });

    openBtn.addEventListener('click', function () {
        openDialog(dialog, function () {
            textarea.value = '';
            fileInput.value = '';
            replaceCheckbox.checked = false;
            hideErrorIn('import-rules-error');
            textarea.focus();
        });
    });

    submitBtn.addEventListener('click', function () {
        var rules;
        try {
            rules = JSON.parse(textarea.value);
            if (!(rules instanceof Array)) {
                throw { 'message': '应为 JSON 数组' };
            }
        } catch (e) {
            showErrorIn('import-rules-error', '格式错误：' + (e.message || String(e)));
            return;
        }
        closeDialog(dialog);
        if (replaceCheckbox.checked) {
            rulesets = rules;
        } else {
            rulesets = rulesets.concat(rules);
        }
        reloadAll();
        toast('已导入 ' + rules.length + ' 条规则');
    });
}

/* ---------- 云端规则（gist / URL 加载） ---------- */

function showCloudStatus(message, isError) {
    var box = document.getElementById('cloud-status');
    box.textContent = message;
    box.classList.toggle('is-error', !!isError);
    box.classList.toggle('is-ok', !isError);
    box.hidden = false;
}

function setCloudLoading(loading) {
    var btn = document.getElementById('load-cloud-rules-btn');
    if (loading) {
        btn.disabled = true;
        btn.textContent = '加载中…';
    } else {
        btn.disabled = false;
        btn.textContent = '加载';
    }
}

/** 校验并清洗远程规则数组，失败抛出带具体原因的中文 Error */
function validateRemoteRules(data) {
    if (!Array.isArray(data)) {
        throw new Error('返回内容不是 JSON 数组（gist 内应保存规则 JSON 数组，如 [ {"pattern": "文件夹/"}, … ]）');
    }
    if (!data.length) {
        throw new Error('规则数组为空，没有可加载的规则');
    }
    return data.map(function (item, idx) {
        var no = idx + 1;
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            throw new Error('第 ' + no + ' 条不是对象，应为 { …, "pattern": "文件夹/" } 形式');
        }
        if (typeof item.pattern !== 'string' || !item.pattern) {
            throw new Error('第 ' + no + ' 条缺少 pattern（目标路径）字段');
        }
        var cleaned = { 'pattern': item.pattern };
        REMOTE_RULE_FIELDS.forEach(function (field) {
            if (field === 'pattern' || !(field in item)) {
                return;
            }
            var val = item[field];
            if (val === undefined || val === null) {
                return;
            }
            if (field === 'enabled') {
                cleaned.enabled = val === true || val === 'true';
                return;
            }
            if (typeof val !== 'string') {
                return; // 忽略类型不符的字段
            }
            if (field === 'description' && !val) {
                return;
            }
            cleaned[field] = val;
        });
        return cleaned;
    });
}

function initCloudRules() {
    var urlInput = document.getElementById('cloud-url-input');
    var loadBtn = document.getElementById('load-cloud-rules-btn');
    var dialog = document.getElementById('cloud-preview-dialog');
    var previewList = document.getElementById('cloud-preview-list');

    var pendingRules = [];

    loadBtn.addEventListener('click', async function () {
        hideErrorIn('cloud-status');
        var urlStr = urlInput.value.trim();
        if (!urlStr) {
            showCloudStatus('请先粘贴规则 URL（gist raw 链接或任意返回规则 JSON 数组的网址）', true);
            urlInput.focus();
            return;
        }

        var url;
        try {
            url = new URL(urlStr);
        } catch (e) {
            showCloudStatus('URL 格式无效：' + urlStr, true);
            return;
        }
        if (!/^https?:$/.test(url.protocol)) {
            showCloudStatus('仅支持 http(s) 链接，当前协议为 ' + url.protocol, true);
            return;
        }

        var origin = url.origin;

        /* 1. 请求该来源的主机权限 */
        var granted = false;
        try {
            granted = await chrome.permissions.request({ origins: [origin + '/*'] });
        } catch (e) {
            showCloudStatus('权限请求失败：' + (e.message || String(e)), true);
            return;
        }
        if (!granted) {
            showCloudStatus('您拒绝了 ' + origin + ' 的访问权限，无法从该地址加载规则。', true);
            return;
        }

        /* 2. 拉取内容 */
        setCloudLoading(true);
        showCloudStatus('正在从 ' + origin + ' 加载规则…', false);
        var text;
        try {
            var resp = await fetch(urlStr);
            if (!resp.ok) {
                throw new Error('HTTP ' + resp.status + ' ' + (resp.statusText || ''));
            }
            text = await resp.text();
        } catch (e) {
            setCloudLoading(false);
            showCloudStatus('下载失败：' + (e.message || String(e)) + '。请确认链接可公开访问（gist raw 链接须指向具体版本）。', true);
            return;
        }
        setCloudLoading(false);

        /* 3. 解析 */
        var data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            showCloudStatus('返回内容不是有效 JSON：' + (e.message || String(e)) + '。gist 中保存的应是规则 JSON 数组，请粘贴「Raw」链接。', true);
            return;
        }

        /* 4. 校验 */
        var rules;
        try {
            rules = validateRemoteRules(data);
        } catch (e) {
            showCloudStatus('规则校验失败：' + (e.message || String(e)), true);
            return;
        }

        /* 5. 预览 */
        pendingRules = rules;
        document.getElementById('cloud-preview-title').textContent = '云端规则预览（来源：' + origin + '，共 ' + rules.length + ' 条）';
        previewList.textContent = '';
        rules.forEach(function (rule, idx) {
            var item = el('div', 'cloud-preview-item');
            item.appendChild(el('span', 'cloud-preview-num', String(idx + 1) + '.'));
            var main = el('div', 'cloud-preview-main');
            var path = el('div', 'cloud-preview-path');
            var icon = el('span', 'folder-icon');
            icon.innerHTML = icons.folder;
            path.appendChild(icon);
            path.appendChild(document.createTextNode(rule.pattern));
            path.title = rule.pattern;
            main.appendChild(path);
            if (rule.description) {
                main.appendChild(el('div', 'cloud-preview-desc', rule.description));
            }
            item.appendChild(main);
            previewList.appendChild(item);
        });
        showCloudStatus('加载成功，共 ' + rules.length + ' 条规则，请在预览中选择应用方式。', false);
        openDialog(dialog);
    });

    document.getElementById('cloud-preview-cancel-btn').addEventListener('click', function () {
        closeDialog(dialog);
    });

    function apply(merge) {
        if (merge) {
            rulesets = rulesets.concat(pendingRules);
        } else {
            rulesets = structuredClone(pendingRules);
        }
        closeDialog(dialog);
        reloadAll();
        showCloudStatus('已' + (merge ? '合并' : '替换') + ' ' + pendingRules.length + ' 条云端规则到本地。', false);
        toast('已' + (merge ? '合并' : '替换') + ' ' + pendingRules.length + ' 条云端规则');
    }

    document.getElementById('cloud-preview-merge-btn').addEventListener('click', function () {
        apply(true);
    });
    document.getElementById('cloud-preview-replace-btn').addEventListener('click', function () {
        apply(false);
    });
}

/* ---------- 工具栏：新建 / 模板 / 其余按钮 ---------- */

function initToolbar() {
    var anchor = document.getElementById('add-rule-menu-anchor');
    var menu = document.getElementById('add-rule-menu');
    var menuBtn = document.getElementById('add-rule-menu-btn');

    function closeMenu() {
        menu.hidden = true;
        menuBtn.setAttribute('aria-expanded', 'false');
    }

    menuBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var willShow = menu.hidden;
        menu.hidden = !willShow;
        menuBtn.setAttribute('aria-expanded', String(willShow));
        if (willShow) {
            menu.querySelector('.menu-item').focus();
        }
    });
    document.addEventListener('click', function (e) {
        if (!menu.hidden && !anchor.contains(e.target)) {
            closeMenu();
        }
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !menu.hidden) {
            closeMenu();
            menuBtn.focus();
        }
    });

    document.getElementById('add-rule-btn').addEventListener('click', function () {
        adjustOpenRulesFor('unshift');
        rulesets.unshift({ enabled: true });
        openRules.clear();
        openRules.add(0);
        reloadAll();
    });

    menu.querySelectorAll('.menu-item[data-template]').forEach(function (item) {
        item.addEventListener('click', function () {
            var template = structuredClone(RULE_TEMPLATES[item.dataset.template] || {});
            var rule = Object.assign({ enabled: true }, template);
            adjustOpenRulesFor('unshift');
            rulesets.unshift(rule);
            openRules.clear();
            openRules.add(0);
            closeMenu();
            reloadAll();
        });
    });

    document.getElementById('export-rules-btn').addEventListener('click', function () {
        var pom = document.createElement('a');
        pom.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(JSON.stringify(rulesets, null, '  ')));
        pom.setAttribute('download', 'download_rules.json');
        pom.click();
        toast('已导出 download_rules.json');
    });

    document.getElementById('sync-rules-to-cloud-btn').addEventListener('click', function () {
        if (confirm('把规则同步到云端？')) {
            syncRulesToCloud().then(function () {
                toast('已把规则同步到云端');
            });
        }
    });

    document.getElementById('sync-rules-from-cloud-btn').addEventListener('click', function () {
        if (confirm('从云端同步规则？现有规则将被全部覆盖。')) {
            syncRulesFromCloud();
        }
    });

    document.getElementById('reset-rules-btn').addEventListener('click', function () {
        if (confirm('确定要重置规则？当前规则将被默认规则覆盖。')) {
            resetRules().then(function () {
                openRules.clear();
                return renderRules();
            });
        }
    });

    document.getElementById('request-tabs-permission-btn').addEventListener('click', async function () {
        try {
            var granted = await chrome.permissions.request({ permissions: ['tabs'] });
            if (granted) {
                await updateAlerts();
            }
        } catch (err) {
            console.error('Failed to request tabs permission:', err);
        }
    });
}

/* ---------- 帮助对话框 ---------- */

function initHelp() {
    var dialog = document.getElementById('help-dialog');
    var openBtn = document.getElementById('help-btn');

    openBtn.addEventListener('click', function () {
        openDialog(dialog);
    });
}

/* ---------- 启动 ---------- */

const storageData = await chrome.storage.local.get('rulesets');
if (storageData.rulesets) {
    rulesets = structuredClone(storageData.rulesets) || [];
} else {
    await resetRules();
}

document.getElementById('version').textContent = 'version ' + chrome.runtime.getManifest().version;

chrome.storage.local.get(['showChangelog'], function ({ showChangelog }) {
    if (showChangelog) {
        var badge = document.getElementById('newBadge');
        badge.hidden = false;
        chrome.storage.local.remove('showChangelog');
    }
});

document.querySelectorAll('.date-format-example').forEach(function (node) {
    node.textContent = moment().format(node.getAttribute('data-value'));
});

initDialogCloseButtons();
initHelp();
initToolbar();
initAddRuleFromText();
initImportRules();
initCloudRules();

await renderRules();
