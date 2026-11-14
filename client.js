window.__ModuleLoader__.load({
  id: 'dsh-rsa',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useRef } = React;

    let currentLang = 'zh';
    const langListeners = new Set();
    function setLangGlobal(next) {
      currentLang = next;
      langListeners.forEach((fn) => {
        try { fn(); } catch {}
      });
    }
    function useLang() {
      const [lang, setLangState] = useState(currentLang);
      useEffect(() => {
        const fn = () => setLangState(currentLang);
        langListeners.add(fn);
        return () => langListeners.delete(fn);
      }, []);
      return lang;
    }

    function detectDark() {
      try {
        const el = document.documentElement;
        const body = document.body;
        const ds = (el && el.getAttribute('data-ds-dark-theme')) || (body && body.getAttribute('data-ds-dark-theme'));
        if (ds !== null && ds !== undefined && ds !== 'false' && ds !== '0') return true;
        const marker = ((el && (el.getAttribute('data-theme') || el.getAttribute('data-color-scheme') || el.className)) || (body && body.className) || '').toString();
        if (/dark/i.test(marker)) return true;
        if (/light/i.test(marker)) return false;
        if (window.matchMedia) return window.matchMedia('(prefers-color-scheme: dark)').matches;
      } catch {}
      return false;
    }

    function useDarkMode() {
      const [dark, setDark] = useState(detectDark);
      useEffect(() => {
        const update = () => setDark(detectDark());
        const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
        if (mq) {
          if (mq.addEventListener) mq.addEventListener('change', update);
          else if (mq.addListener) mq.addListener(update);
        }
        const el = document.documentElement;
        const observer = new MutationObserver(update);
        try {
          observer.observe(el, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-color-scheme', 'data-ds-dark-theme', 'style'] });
        } catch {}
        return () => {
          if (mq) {
            if (mq.removeEventListener) mq.removeEventListener('change', update);
            else if (mq.removeListener) mq.removeListener(update);
          }
          observer.disconnect();
        };
      }, []);
      return dark;
    }

    const themeModes = ['system', 'light', 'dark'];
    const creditPositions = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
    const taglineEffects = ['rise', 'fade', 'none'];
    const ringStyles = ['band', 'dots', 'breathe'];
    const blobMotions = ['float', 'still'];

    async function api(path, options) {
      const res = await fetch('/rsa' + path, {
        headers: { 'content-type': 'application/json' },
        ...options,
      });
      const data = await res.json().catch(() => ({ ok: false, error: 'bad json' }));
      return data;
    }

    const TEXT = {
      zh: {
        lang: '中文',
        switchLang: 'English',
        title: '真实启动动画',
        subtitle: 'DSH 冷启动时显示在窗口出现之前的启动画面。',
        previewLight: '预览：浅色',
        previewDark: '预览：深色',
        previewBoth: '预览：并排',
        tagLight: '浅色',
        tagDark: '深色',
        restore: '恢复默认',
        save: '保存',
        deploy: '深度部署',
        saveOnly: '仅保存',
        loading: '加载中…',
        saved: '已保存。',
        restored: '已恢复默认设置。',
        deploying: '正在准备部署…',
        deployed: '部署文件已生成。退出 DSH 时自动替换 app.asar，下次启动即显示新画面（不会自动重启）。',
        saveFirst: '请先保存，再部署。',
        logo: 'Logo',
        logoWidth: 'Logo 缩放（倍率）',
        logoWidthHint: '1× = 320 px 基准宽，0.1–5×；等比缩放，铺满窗口时自动封顶。',
        logoTop: 'Logo 距顶部',
        logoTopHint: 'logo 在卡片内的垂直位置（像素）。',
        logoLight: '自定义浅色 PNG',
        logoLightHint: '留空使用内置 logo；可填绝对路径的 PNG。',
        logoDark: '自定义深色 PNG',
        logoDarkHint: '深色主题下使用；留空则使用内置反色 logo。',
        tagline: '中心文字',
        taglineText: '文字内容',
        taglineTextHint: '启动画面中间的标语，例如 I Want I Make。',
        taglineSize: '字号',
        taglineSizeHint: '单位像素；26 左右比较协调。',
        taglineFamily: '字体',
        taglineFamilyHint: '系统字体名，如 Segoe UI。',
        taglineEffect: '动效',
        taglineEffectHint: 'rise = 逐字浮现；fade = 整体淡入；none = 不播放。',
        taglineTop: '文字顶部位置',
        taglineTopHint: '距卡片顶部的像素位置。',
        taglineItalic: '斜体',
        taglineItalicHint: '让中间的标语倾斜显示。',
        credit: '署名',
        creditText: '署名文字',
        creditTextHint: '显示在卡片角落的小字。',
        creditPosition: '位置',
        creditPositionHint: '选择四个角之一。',
        creditVisible: '显示',
        creditVisibleHint: '关闭后不显示署名。',
        window: '窗口与主题',
        windowWidth: '卡片宽度',
        windowWidthHint: '启动画面窗口宽度（像素）。',
        windowHeight: '卡片高度',
        windowHeightHint: '启动画面窗口高度（像素）。',
        windowRadius: '圆角',
        windowRadiusHint: '卡片圆角半径；窗口会被裁成同样的圆角。',
        themeMode: '主题',
        themeModeHint: '跟随系统会自动检测深浅色。',
        themeLightAlpha: '浅色不透明度',
        themeLightAlphaHint: '浅色卡片背景透明度，越低越透。',
        themeDarkAlpha: '深色不透明度',
        themeDarkAlphaHint: '深色卡片背景透明度，越低越透。',
        blobs: '背景光球',
        blobsEnabled: '启用',
        blobsEnabledHint: '卡片内的两团柔和光斑。',
        blobsMotion: '动效',
        blobsMotionHint: 'float = 缓慢漂移并呼吸；still = 静止。',
        blobsSpeed: '速度',
        blobsSpeedHint: '漂移速度倍率。',
        ring: '进度光环',
        ringEnabled: '启用',
        ringEnabledHint: '沿卡片边缘旋转的高亮光带。',
        ringStyle: '样式',
        ringStyleHint: 'band = 圆头光带；dots = 点状；breathe = 呼吸。',
        ringLength: '光带长度',
        ringLengthHint: '光带占周长的像素长度；越长越显眼。',
        ringPeriod: '一圈耗时',
        ringPeriodHint: '光带绕卡片一圈的秒数。',
        ringTail: '拖尾',
        ringTailHint: '在光带后面加逐段淡出的尾巴。',
        noticeTitle: '风险与差异',
        notice1: '本插件通过把 splash 模块写入已安装的 app.asar 实现深度部署；不签名、不触碰账号数据，首次部署前会保留一份备份（app.asar.rsa-backup）。',
        notice2: '深度部署不会自动重启 DSH：生成部署文件后，退出 DeepSeek Harness 时插件会自动替换 app.asar，下次启动即显示新的启动画面；若被强杀或文件被占用，会在再下一次启动时补上。',
        notice3: 'DSH 升级会覆盖 app.asar，升级后启动画面会消失；重新点一次部署即可恢复（插桩会自动重新注入，不需要额外安装器）。',
        statusHook: 'Splash 插桩',
        statusHookOk: '已存在',
        statusHookMissing: '缺失',
        statusHookAuto: '首次部署时自动注入',
        statusAsar: 'asar 大小',
        statusBackup: '备份',
        statusBackupYes: '已存在',
        statusBackupNo: '还没有',
        statusLastDeploy: '上次部署',
        statusPending: '待替换（退出 DSH 时生效）',
        statusStale: '已过期，需重新部署',
        deployHint: '部署文件生成后不会自动重启：退出 DSH 时替换，下次启动生效。DSH 升级后需重新部署。',
        bannerFirst: '首次使用：请先运行一次兼容性检查，确认当前 DSH 版本可以安全部署。',
        bannerUpdated: '检测到 DSH 已更新（上次检查针对 {from}，当前 {to}）：请重新运行兼容性检查，通过后再部署。',
        bannerFailed: '上次兼容性检查未通过：修复前不要部署，否则下次可能无法启动。',
        bannerNoHost: '找不到已安装的 app.asar：深度部署不可用。',
        bannerRun: '立即检查',
        bannerRunning: '检查中…',
        bannerRetry: '重新检查',
        confirmTitle: '确认深度部署？',
        confirmBody: '即将改写 DSH 的 app.asar，退出 DSH 时替换、下次启动生效。若新版本无法启动，请运行下面的回滚脚本还原。',
        confirmRollback: '回滚脚本（务必记下这个位置）',
        confirmOk: '确认部署',
        confirmCancel: '取消',
        confirmChecked: '兼容性检查已通过 · 宿主 {host}',
        compat: '兼容性与回滚',
        compatHint: '部署前先跑一遍检查：确认 app.asar 头部自洽、整包完整性、原样重打包后字节一致。检查不通过时不要部署。',
        compatRun: '运行兼容性检查',
        compatRunning: '检查中…（要重打包一次，约数秒）',
        compatOk: '兼容：可以安全部署',
        compatWarn: '兼容（有提醒）：可以部署，但主机版本不在插件的测试清单内',
        compatFail: '不兼容：请勿部署',
        compatHost: '主机版本',
        compatTested: '测试清单',
        compatCheckedAt: '检查时间',
        compatNever: '还没有运行过兼容性检查',
        compatCheckFile: '找到 app.asar',
        compatCheckHeader: '头部长度字段自洽',
        compatCheckLayout: 'payload 偏移与原文件对齐',
        compatCheckIntegrity: '全量 SHA256 校验',
        compatCheckEntry: '主入口可解析',
        compatCheckRoundtrip: '原样重打包字节一致',
        compatCheckVersion: '主机版本在测试清单内',
        rollbackTitle: '回滚脚本',
        rollbackHint: '随插件一起安装。DSH 起不来时双击它即可把 app.asar 恢复成官方原版（会先确认 DSH 未在运行）。',
        rollbackYes: '已安装',
        rollbackNo: '尚未生成（插件首次加载后自动生成）',
        statusLastApply: '上次换入',
        statusLastApplyNone: '还没有换入记录',
      },
      en: {
        lang: 'English',
        switchLang: '中文',
        title: 'Real startup animation',
        subtitle: 'The splash shown before the DSH window appears on a cold start.',
        previewLight: 'Preview: light',
        previewDark: 'Preview: dark',
        previewBoth: 'Preview: side by side',
        tagLight: 'light',
        tagDark: 'dark',
        restore: 'Restore defaults',
        save: 'Save',
        deploy: 'Deploy (deep)',
        saveOnly: 'Save only',
        loading: 'Loading…',
        saved: 'Saved.',
        restored: 'Defaults restored.',
        deploying: 'Preparing deployment…',
        deployed: 'Deployment files prepared. They are swapped in when DSH exits, so the splash shows on the next launch (no automatic restart).',
        saveFirst: 'Save first, then deploy.',
        logo: 'Logo',
        logoWidth: 'Logo scale (×)',
        logoWidthHint: '1× = 320 px base width, 0.1–5×; vector art keeps its aspect and caps at the card width.',
        logoTop: 'Logo top',
        logoTopHint: 'Vertical position inside the card, in pixels.',
        logoLight: 'Custom light PNG',
        logoLightHint: 'Leave empty to use the built-in logo; absolute PNG path otherwise.',
        logoDark: 'Custom dark PNG',
        logoDarkHint: 'Used in dark theme; empty uses the built-in inverted logo.',
        tagline: 'Center text',
        taglineText: 'Text',
        taglineTextHint: 'The slogan in the middle, e.g. I Want I Make.',
        taglineSize: 'Size',
        taglineSizeHint: 'Pixels; around 26 looks balanced.',
        taglineFamily: 'Font family',
        taglineFamilyHint: 'A system font name such as Segoe UI.',
        taglineEffect: 'Effect',
        taglineEffectHint: 'rise = per-letter float in; fade = whole line fade; none = off.',
        taglineTop: 'Text top',
        taglineTopHint: 'Pixel offset from the card top.',
        taglineItalic: 'Italic',
        taglineItalicHint: 'Render the slogan in italic.',
        credit: 'Credit',
        creditText: 'Credit text',
        creditTextHint: 'Small text shown in one corner of the card.',
        creditPosition: 'Position',
        creditPositionHint: 'Pick one of the four corners.',
        creditVisible: 'Visible',
        creditVisibleHint: 'Turn off to hide the credit.',
        window: 'Window & theme',
        windowWidth: 'Card width',
        windowWidthHint: 'Splash window width in pixels.',
        windowHeight: 'Card height',
        windowHeightHint: 'Splash window height in pixels.',
        windowRadius: 'Corner radius',
        windowRadiusHint: 'Card corner radius; the window itself is clipped to the same radius.',
        themeMode: 'Theme',
        themeModeHint: 'System follows the OS light/dark setting.',
        themeLightAlpha: 'Light opacity',
        themeLightAlphaHint: 'Background opacity of the light card; lower is more transparent.',
        themeDarkAlpha: 'Dark opacity',
        themeDarkAlphaHint: 'Background opacity of the dark card; lower is more transparent.',
        blobs: 'Background blobs',
        blobsEnabled: 'Enabled',
        blobsEnabledHint: 'Two soft blurred blobs inside the card.',
        blobsMotion: 'Motion',
        blobsMotionHint: 'float = slow drift with breathing; still = static.',
        blobsSpeed: 'Speed',
        blobsSpeedHint: 'Drift speed multiplier.',
        ring: 'Progress ring',
        ringEnabled: 'Enabled',
        ringEnabledHint: 'A highlight band running along the card border.',
        ringStyle: 'Style',
        ringStyleHint: 'band = round band; dots = dotted; breathe = pulsing.',
        ringLength: 'Band length',
        ringLengthHint: 'Arc length in pixels; longer is more prominent.',
        ringPeriod: 'Lap period (s)',
        ringPeriodHint: 'Seconds for one full lap around the card.',
        ringTail: 'Tail',
        ringTailHint: 'Adds a fading tail behind the band.',
        noticeTitle: 'Risk & differences',
        notice1: 'Deep deployment writes the splash module into the installed app.asar; it does not sign anything or touch your account data, and keeps a one-time backup (app.asar.rsa-backup) before the first deploy.',
        notice2: 'Deep deployment does not restart DSH automatically. After the deployment files are prepared, the plugin swaps app.asar in when DSH exits, so the new splash shows on the next launch; if DSH is force-killed or the file is locked, the swap is retried on the following start.',
        notice3: 'A DSH update replaces app.asar, so the splash disappears after an upgrade — deploy again. The hook is re-injected automatically, no separate installer is needed.',
        statusHook: 'Splash hook',
        statusHookOk: 'installed',
        statusHookMissing: 'missing',
        statusHookAuto: 'auto on first deploy',
        statusAsar: 'asar size',
        statusBackup: 'backup',
        statusBackupYes: 'present',
        statusBackupNo: 'none yet',
        statusLastDeploy: 'last deploy',
        statusPending: 'pending (applied when DSH exits)',
        statusStale: 'stale — redeploy',
        deployHint: 'Deployment does not restart DSH automatically: it is swapped in on exit and shows on the next launch; a DSH update resets app.asar, so deploy again after upgrading.',
        bannerFirst: 'First run: run the compatibility check once to confirm this DSH build can be deployed safely.',
        bannerUpdated: 'DSH was updated (last check was for {from}, now {to}): run the compatibility check again before deploying.',
        bannerFailed: 'The last compatibility check did not pass: do not deploy until it does, or the next launch may fail.',
        bannerNoHost: 'No installed app.asar was found, so deep deployment is unavailable.',
        bannerRun: 'Check now',
        bannerRunning: 'Checking…',
        bannerRetry: 'Check again',
        confirmTitle: 'Deploy into app.asar?',
        confirmBody: 'This rewrites the DSH app.asar. It is swapped in when DSH exits and shows on the next launch. If the new build will not start, run the rollback script below.',
        confirmRollback: 'Rollback script (note this path)',
        confirmOk: 'Deploy now',
        confirmCancel: 'Cancel',
        confirmChecked: 'Compatibility check passed · host {host}',
        compat: 'Compatibility and rollback',
        compatHint: 'Runs before every deploy: it checks that the app.asar header is self-consistent, that the whole archive verifies, and that re-packing it unchanged yields identical bytes. Do not deploy when a check fails.',
        compatRun: 'Run compatibility check',
        compatRunning: 'Checking… (one re-pack, a few seconds)',
        compatOk: 'Compatible: safe to deploy',
        compatWarn: 'Compatible with a warning: deployable, but this host version is not on the tested list',
        compatFail: 'Not compatible: do not deploy',
        compatHost: 'Host version',
        compatTested: 'Tested',
        compatCheckedAt: 'Checked',
        compatNever: 'The compatibility check has not been run yet',
        compatCheckFile: 'app.asar found',
        compatCheckHeader: 'Header length fields agree',
        compatCheckLayout: 'Payload offset matches the original file',
        compatCheckIntegrity: 'Full SHA256 verification',
        compatCheckEntry: 'Main entry parses',
        compatCheckRoundtrip: 'Unchanged re-pack is byte-identical',
        compatCheckVersion: 'Host version is on the tested list',
        rollbackTitle: 'Rollback script',
        rollbackHint: 'Installed together with this plugin. If DSH stops starting, double-click it to restore the original app.asar (it first makes sure DSH is not running).',
        rollbackYes: 'installed',
        rollbackNo: 'not generated yet (created when the plugin first loads)',
        statusLastApply: 'Last swap',
        statusLastApplyNone: 'no swap recorded yet',
      },
    };

    const S = {
      root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontSize: 13, lineHeight: 1.55 },
      bar: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px 8px', flex: '0 0 auto', flexWrap: 'wrap' },
      title: { fontSize: 15, fontWeight: 600, margin: 0, flex: '1 1 auto' },
      subtitle: { fontSize: 12, opacity: 0.6, padding: '0 16px 8px', flex: '0 0 auto' },
      previewSticky: {
        position: 'sticky',
        top: 0,
        zIndex: 6,
        flex: '0 0 auto',
        padding: '0 16px 10px',
      },
      previewFrame: {
        position: 'relative',
        width: '100%',
        maxWidth: 720,
        margin: '0 auto',
        aspectRatio: '520 / 308',
        overflow: 'hidden',
        borderRadius: 14,
        border: 'none',
        background: 'transparent',
      },
      previewRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 10 },
      previewCol: { flex: '1 1 0', minWidth: 0, maxWidth: 380 },
      previewLabel: { fontSize: 11, lineHeight: 1.4, opacity: 0.6, textAlign: 'center', marginBottom: 4 },
      previewIframe: {
        position: 'absolute',
        left: 0,
        top: 0,
        width: 520,
        height: 308,
        border: 0,
        transformOrigin: 'top left',
        background: 'transparent',
        pointerEvents: 'none',
      },
      scroll: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '4px 16px 24px' },
      section: { margin: '14px 0 0', padding: '12px 14px 14px', borderRadius: 12, border: '1px solid rgba(128,128,128,.22)', background: 'rgba(128,128,128,.05)' },
      h3: { fontSize: 13, fontWeight: 600, margin: '0 0 10px', paddingBottom: 8, borderBottom: '1px solid rgba(128,128,128,.18)', opacity: 0.9 },
      row: { display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0', minHeight: 30 },
      label: { width: 132, flex: '0 0 132px', opacity: 0.78 },
      input: { flex: '1 1 auto', minWidth: 0, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,.38)', background: 'transparent', color: 'inherit', fontSize: 13 },
      number: { width: 86, flex: '0 0 86px', padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,.38)', background: 'transparent', color: 'inherit', fontSize: 13 },
      select: { padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,.38)', background: 'transparent', color: 'inherit', fontSize: 13 },
      seg: { display: 'flex', flexWrap: 'wrap', gap: 4 },
      segBtn: { padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(128,128,128,.38)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
      segBtnOn: { padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(128,128,128,.55)', background: 'rgba(128,128,128,.20)', color: 'inherit', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
      range: { flex: '1 1 auto', accentColor: '#3b82f6' },
      hint: { opacity: 0.55, fontSize: 12, margin: '-2px 0 8px 142px' },
      btn: { padding: '6px 14px', borderRadius: 7, border: '1px solid rgba(128,128,128,.4)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13 },
      primary: { padding: '7px 16px', borderRadius: 7, border: 0, background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
      notice: { padding: '10px 12px', borderRadius: 8, background: 'rgba(234,179,8,.12)', border: '1px solid rgba(234,179,8,.35)', fontSize: 12, lineHeight: 1.6, margin: '16px 0 8px' },
      status: { fontSize: 12, opacity: 0.7, marginTop: 8, whiteSpace: 'pre-wrap' },
      mono: { fontFamily: 'Consolas, ui-monospace, monospace', fontSize: 12, opacity: 0.85, userSelect: 'all', wordBreak: 'break-all', lineHeight: 1.5 },
      check: { fontSize: 12, lineHeight: 1.6 },
      checkFail: { fontSize: 12, lineHeight: 1.6, fontWeight: 600 },
      footer: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' },
      banner: {
        flex: '0 0 auto',
        margin: '0 16px 8px',
        padding: '9px 12px',
        borderRadius: 8,
        border: '1px solid rgba(208,69,69,.55)',
        background: 'rgba(208,69,69,.10)',
        color: '#d04545',
        fontSize: 12.5,
        fontWeight: 600,
        lineHeight: 1.55,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
      },
      bannerText: { flex: '1 1 260px', minWidth: 0 },
      bannerBtn: {
        padding: '4px 12px',
        borderRadius: 6,
        border: '1px solid rgba(208,69,69,.65)',
        background: 'transparent',
        color: '#d04545',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 600,
      },
      confirm: {
        margin: '12px 0 4px',
        padding: '12px 14px',
        borderRadius: 10,
        border: '1px solid rgba(208,69,69,.5)',
        background: 'rgba(208,69,69,.08)',
      },
      confirmTitle: { fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#d04545' },
      confirmBody: { fontSize: 12, lineHeight: 1.6, opacity: 0.85 },
      confirmPath: {
        margin: '8px 0 10px',
        padding: '8px 10px',
        borderRadius: 7,
        border: '1px dashed rgba(208,69,69,.45)',
        fontFamily: 'Consolas, ui-monospace, monospace',
        fontSize: 12,
        userSelect: 'all',
        wordBreak: 'break-all',
        lineHeight: 1.5,
      },
      confirmActions: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      danger: { padding: '6px 14px', borderRadius: 7, border: 0, background: '#d04545', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
    };

    function Preview(props) {
      const boxRef = useRef(null);
      const iframeRef = useRef(null);
      const [html, setHtml] = useState('');

      useEffect(() => {
        const box = boxRef.current;
        if (!box) return undefined;
        const apply = () => {
          const w = box.clientWidth || 520;
          if (iframeRef.current) iframeRef.current.style.transform = 'scale(' + w / 520 + ')';
        };
        apply();
        const ro = new ResizeObserver(apply);
        ro.observe(box);
        return () => ro.disconnect();
      }, []);

      useEffect(() => {
        let alive = true;
        const timer = setTimeout(() => {
          fetch('/rsa/preview', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ config: props.config, theme: props.theme }),
          })
            .then((res) => res.text())
            .then((text) => {
              if (alive) setHtml(text);
            })
            .catch(() => {});
        }, 180);
        return () => {
          alive = false;
          clearTimeout(timer);
        };
      }, [props.config, props.theme]);

      return h(
        'div',
        { ref: boxRef, style: S.previewFrame },
        h('iframe', {
          frameBorder: 0,
          ref: iframeRef,
          style: S.previewIframe,
          srcDoc: html,
          title: 'RSA preview',
          sandbox: 'allow-same-origin allow-scripts',
        }),
      );
    }

    function Field(props) {
      const t = props.t;
      return h(
        'div',
        null,
        h(
          'div',
          { style: S.row },
          h('div', { style: S.label }, props.label),
          props.children,
        ),
        props.hint ? h('div', { style: S.hint }, props.hint) : null,
      );
    }

    function NumberField(props) {
      return h('input', {
        style: S.number,
        type: 'number',
        value: props.value,
        min: props.min,
        max: props.max,
        step: props.step || 1,
        onChange: (e) => props.onChange(Number(e.target.value)),
      });
    }

    function SliderField(props) {
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto', minWidth: 0 } },
        h('input', {
          style: S.range,
          type: 'range',
          value: props.value,
          min: props.min,
          max: props.max,
          step: props.step || 1,
          onChange: (e) => props.onChange(Number(e.target.value)),
        }),
        h('span', { style: { width: 48, textAlign: 'right', opacity: 0.65, fontSize: 12 } }, String(props.value)),
      );
    }

    function SelectField(props) {
      return h(
        'div',
        { style: S.seg },
        props.options.map((opt) =>
          h(
            'button',
            {
              key: opt,
              type: 'button',
              style: opt === props.value ? S.segBtnOn : S.segBtn,
              onClick: () => props.onChange(opt),
            },
            opt,
          ),
        ),
      );
    }

    function TextField(props) {
      return h('input', {
        style: S.input,
        type: 'text',
        value: props.value,
        placeholder: props.placeholder,
        onChange: (e) => props.onChange(e.target.value),
      });
    }

    function Toggle(props) {
      return h(
        'label',
        { style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' } },
        h('input', { type: 'checkbox', checked: props.value, onChange: (e) => props.onChange(e.target.checked) }),
      );
    }

    function Section(props) {
      return h('div', { style: S.section }, h('h3', { style: S.h3 }, props.title), props.children);
    }

    const CHECK_LABEL = {
      file: 'compatCheckFile',
      header: 'compatCheckHeader',
      layout: 'compatCheckLayout',
      integrity: 'compatCheckIntegrity',
      entry: 'compatCheckEntry',
      roundtrip: 'compatCheckRoundtrip',
      version: 'compatCheckVersion',
      error: 'compatFail',
    };

    function SettingsPage() {
      const [config, setConfig] = useState(null);
      const [info, setInfo] = useState(null);
      const [paths, setPaths] = useState(null);
      const [compat, setCompat] = useState(null);
      const [notice, setNotice] = useState(null);
      const [confirming, setConfirming] = useState(false);
      const [checking, setChecking] = useState(false);
      const lang = useLang();
      // 'both' shows light and dark side by side (half the height of one big
      // frame, which is what the settings form needs); the other two zoom in on
      // a single theme for inspecting detail.
      const [previewMode, setPreviewMode] = useState('both');
      const isDark = useDarkMode();
      const [busy, setBusy] = useState(false);
      const [message, setMessage] = useState('');
      const [error, setError] = useState('');
      const t = TEXT[lang] || TEXT.zh;

      const runCompat = useCallback(async () => {
        setChecking(true);
        setError('');
        setMessage('');
        const res = await api('/compat');
        setChecking(false);
        if (res.ok) {
          setCompat(res.report);
          if (res.compat) setNotice(res.compat);
        } else setError(res.error || 'Compatibility check failed');
        return res;
      }, []);

      useEffect(() => {
        let alive = true;
        api('/state').then((data) => {
          if (!alive) return;
          if (data.ok) {
            setConfig(data.config);
            setInfo(data.inspect);
            setPaths(data.paths || null);
            setNotice(data.compat || null);
            // First install or a host update: check once by itself so the banner
            // can report a verdict instead of just asking the user to do it.
            if (data.compat && data.compat.needed) runCompat();
          } else setError(data.error || 'Failed to load RSA state');
        });
        return () => {
          alive = false;
        };
      }, [runCompat]);

      const patch = useCallback((section, key, value) => {
        setConfig((prev) => {
          if (!prev) return prev;
          if (key === undefined) return { ...prev, [section]: value };
          return { ...prev, [section]: { ...prev[section], [key]: value } };
        });
      }, []);

      const save = useCallback(async () => {
        setBusy(true);
        setError('');
        setMessage('');
        const res = await api('/config', { method: 'POST', body: JSON.stringify(config) });
        setBusy(false);
        if (res.ok) {
          setConfig(res.config);
          setMessage(t.saved);
        } else setError(res.error || 'Save failed');
      }, [config, t]);

      const reset = useCallback(async () => {
        setBusy(true);
        setError('');
        setMessage('');
        const res = await api('/reset', { method: 'POST' });
        setBusy(false);
        if (res.ok) {
          setConfig(res.config);
          setMessage(t.restored);
        } else setError(res.error || 'Reset failed');
      }, [t]);

      const checkLabel = useCallback((id) => t[CHECK_LABEL[id]] || id, [t]);

      // Step 1: prove the archive is safe to rewrite, then ask for confirmation.
      // Nothing touches app.asar until step 2.
      const requestDeploy = useCallback(async () => {
        setBusy(true);
        setError('');
        setMessage('');
        const res = await runCompat();
        setBusy(false);
        if (!res || !res.ok || !res.report || !res.report.ok) {
          if (res && res.report) setCompat(res.report);
          setConfirming(false);
          setError(res && res.report && res.report.ok === false ? t.compatFail : (res && res.error) || 'Compatibility check failed');
          return;
        }
        setConfirming(true);
      }, [runCompat, t]);

      // Step 2: the user has seen the rollback path and pressed confirm.
      const deploy = useCallback(async () => {
        setBusy(true);
        setError('');
        setMessage(t.deploying);
        setConfirming(false);
        const res = await api('/deploy', { method: 'POST', body: JSON.stringify({ config, confirmed: true }) });
        setBusy(false);
        if (res.ok) {
          setMessage(t.deployed + (res.pending ? '\n' + res.pending : ''));
          if (res.state) setInfo((prev) => ({ ...(prev || {}), lastDeployAt: res.state.lastDeployAt }));
        } else {
          setMessage('');
          setError(res.error || 'Deployment failed');
        }
        if (res.report) setCompat(res.report);
        if (res.compat) setNotice(res.compat);
      }, [config, t]);

      // The red banner at the top of the page. It appears on first install and
      // whenever the host build changed under us, because a check recorded
      // against an older app.asar says nothing about the current one.
      let bannerText = null;
      if (notice && notice.needed) {
        if (notice.reason === "host-updated") {
          bannerText = t.bannerUpdated
            .replace("{from}", (notice.last && notice.last.hostVersion) || "?")
            .replace("{to}", notice.hostVersion || "?");
        } else if (notice.reason === "last-failed") bannerText = t.bannerFailed;
        else if (notice.reason === "no-host") bannerText = t.bannerNoHost;
        else bannerText = t.bannerFirst;
      }

      if (!config) return h('div', { style: { ...S.root, padding: 16 } }, h('div', { style: S.status }, error || t.loading));

      return h(
        'div',
        { style: { ...S.root, colorScheme: isDark ? 'dark' : 'light' } },
        h(
          'div',
          { style: S.bar },
          h('h2', { style: S.title }, t.title),
          h('button', { style: S.btn, onClick: () => setLangGlobal(lang === 'zh' ? 'en' : 'zh') }, t.switchLang),
          h('button', { style: S.btn, onClick: () => setPreviewMode((v) => (v === 'both' ? 'light' : v === 'light' ? 'dark' : 'both')) }, previewMode === 'light' ? t.previewLight : previewMode === 'dark' ? t.previewDark : t.previewBoth),
          h('button', { style: S.btn, onClick: reset, disabled: busy }, t.restore),
          h('button', { style: S.primary, onClick: save, disabled: busy }, t.save),
        ),
        bannerText
          ? h(
              'div',
              { style: S.banner },
              h('span', { style: S.bannerText }, bannerText),
              h(
                'button',
                { style: S.bannerBtn, onClick: runCompat, disabled: checking || busy },
                checking ? t.bannerRunning : (notice && notice.last && notice.last.at ? t.bannerRetry : t.bannerRun),
              ),
            )
          : null,
        h('div', { style: S.subtitle }, t.subtitle),
        h(
          'div',
          { style: S.previewSticky },
          previewMode === 'both'
            ? h(
                'div',
                { style: S.previewRow },
                h('div', { style: S.previewCol }, h('div', { style: S.previewLabel }, t.tagLight), h(Preview, { theme: 'light', config: config })),
                h('div', { style: S.previewCol }, h('div', { style: S.previewLabel }, t.tagDark), h(Preview, { theme: 'dark', config: config })),
              )
            : h(Preview, { theme: previewMode, config: config }),
        ),
        h(
          'div',
          { style: S.scroll },
          h(
            Section,
            { title: t.logo },
            h(Field, { label: t.logoWidth, hint: t.logoWidthHint }, h(SliderField, { value: config.logo.scale, min: 0.1, max: 5, step: 0.05, onChange: (v) => patch('logo', 'scale', v) })),
            h(Field, { label: t.logoTop, hint: t.logoTopHint }, h(SliderField, { value: config.logo.top, min: 10, max: 240, onChange: (v) => patch('logo', 'top', v) })),
            h(Field, { label: t.logoLight, hint: t.logoLightHint }, h(TextField, { value: config.logo.customLight, placeholder: 'C:\\path\\logo-light.png', onChange: (v) => patch('logo', 'customLight', v) })),
            h(Field, { label: t.logoDark, hint: t.logoDarkHint }, h(TextField, { value: config.logo.customDark, placeholder: 'C:\\path\\logo-dark.png', onChange: (v) => patch('logo', 'customDark', v) })),
          ),
          h(
            Section,
            { title: t.tagline },
            h(Field, { label: t.taglineText, hint: t.taglineTextHint }, h(TextField, { value: config.tagline.text, onChange: (v) => patch('tagline', 'text', v) })),
            h(Field, { label: t.taglineSize, hint: t.taglineSizeHint }, h(SliderField, { value: config.tagline.size, min: 12, max: 72, onChange: (v) => patch('tagline', 'size', v) })),
            h(Field, { label: t.taglineFamily, hint: t.taglineFamilyHint }, h(TextField, { value: config.tagline.family, onChange: (v) => patch('tagline', 'family', v) })),
            h(Field, { label: t.taglineEffect, hint: t.taglineEffectHint }, h(SelectField, { value: config.tagline.effect, options: taglineEffects, onChange: (v) => patch('tagline', 'effect', v) })),
            h(Field, { label: t.taglineTop, hint: t.taglineTopHint }, h(SliderField, { value: config.tagline.top, min: 60, max: 260, onChange: (v) => patch('tagline', 'top', v) })),
            h(Field, { label: t.taglineItalic, hint: t.taglineItalicHint }, h(Toggle, { value: config.tagline.italic, onChange: (v) => patch('tagline', 'italic', v) })),
          ),
          h(
            Section,
            { title: t.credit },
            h(Field, { label: t.creditText, hint: t.creditTextHint }, h(TextField, { value: config.credit.text, onChange: (v) => patch('credit', 'text', v) })),
            h(Field, { label: t.creditPosition, hint: t.creditPositionHint }, h(SelectField, { value: config.credit.position, options: creditPositions, onChange: (v) => patch('credit', 'position', v) })),
            h(Field, { label: t.creditVisible, hint: t.creditVisibleHint }, h(Toggle, { value: config.credit.visible, onChange: (v) => patch('credit', 'visible', v) })),
          ),
          h(
            Section,
            { title: t.window },
            h(Field, { label: t.windowWidth, hint: t.windowWidthHint }, h(SliderField, { value: config.window.width, min: 360, max: 900, onChange: (v) => patch('window', 'width', v) })),
            h(Field, { label: t.windowHeight, hint: t.windowHeightHint }, h(SliderField, { value: config.window.height, min: 220, max: 620, onChange: (v) => patch('window', 'height', v) })),
            h(Field, { label: t.windowRadius, hint: t.windowRadiusHint }, h(SliderField, { value: config.window.radius, min: 0, max: 60, onChange: (v) => patch('window', 'radius', v) })),
            h(Field, { label: t.themeMode, hint: t.themeModeHint }, h(SelectField, { value: config.theme.mode, options: themeModes, onChange: (v) => patch('theme', 'mode', v) })),
            h(Field, { label: t.themeLightAlpha, hint: t.themeLightAlphaHint }, h(SliderField, { value: config.theme.lightAlpha, min: 0.2, max: 1, step: 0.02, onChange: (v) => patch('theme', 'lightAlpha', v) })),
            h(Field, { label: t.themeDarkAlpha, hint: t.themeDarkAlphaHint }, h(SliderField, { value: config.theme.darkAlpha, min: 0.2, max: 1, step: 0.02, onChange: (v) => patch('theme', 'darkAlpha', v) })),
          ),
          h(
            Section,
            { title: t.blobs },
            h(Field, { label: t.blobsEnabled, hint: t.blobsEnabledHint }, h(Toggle, { value: config.blobs.enabled, onChange: (v) => patch('blobs', 'enabled', v) })),
            h(Field, { label: t.blobsMotion, hint: t.blobsMotionHint }, h(SelectField, { value: config.blobs.motion, options: blobMotions, onChange: (v) => patch('blobs', 'motion', v) })),
            h(Field, { label: t.blobsSpeed, hint: t.blobsSpeedHint }, h(SliderField, { value: config.blobs.speed, min: 0.2, max: 3, step: 0.1, onChange: (v) => patch('blobs', 'speed', v) })),
          ),
          h(
            Section,
            { title: t.ring },
            h(Field, { label: t.ringEnabled, hint: t.ringEnabledHint }, h(Toggle, { value: config.ring.enabled, onChange: (v) => patch('ring', 'enabled', v) })),
            h(Field, { label: t.ringStyle, hint: t.ringStyleHint }, h(SelectField, { value: config.ring.style, options: ringStyles, onChange: (v) => patch('ring', 'style', v) })),
            h(Field, { label: t.ringLength, hint: t.ringLengthHint }, h(SliderField, { value: config.ring.length, min: 20, max: 800, onChange: (v) => patch('ring', 'length', v) })),
            h(Field, { label: t.ringPeriod, hint: t.ringPeriodHint }, h(NumberField, { value: config.ring.period, min: 0.8, max: 30, step: 0.1, onChange: (v) => patch('ring', 'period', v) })),
            h(Field, { label: t.ringTail, hint: t.ringTailHint }, h(Toggle, { value: config.ring.tail, onChange: (v) => patch('ring', 'tail', v) })),
          ),
          h(
            Section,
            { title: t.compat },
            h('div', { style: { fontSize: 12, opacity: 0.62, lineHeight: 1.6, marginBottom: 8 } }, t.compatHint),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
              h('button', { style: S.btn, onClick: runCompat, disabled: busy || checking }, checking ? t.compatRunning : t.compatRun),
              compat
                ? h('span', { style: { fontSize: 12, fontWeight: 600 } }, compat.ok ? (compat.checks.some((c) => c.warn) ? t.compatWarn : t.compatOk) : t.compatFail)
                : h('span', { style: { fontSize: 12, opacity: 0.6 } }, t.compatNever),
            ),
            compat
              ? h(
                  'div',
                  { style: { marginTop: 8 } },
                  h('div', { style: S.status }, t.compatHost + ': ' + (compat.hostVersion || '?') + ' · ' + t.compatTested + ': ' + (compat.testedVersions || []).join(', ')),
                  compat.checks.map((c, i) =>
                    h(
                      'div',
                      { key: c.id || i, style: c.ok ? S.check : S.checkFail },
                      (c.ok ? '✓ ' : c.warn ? '! ' : '✗ ') + checkLabel(c.id) + (c.detail ? ' — ' + c.detail : ''),
                    ),
                  ),
                )
              : null,
            h(
              'div',
              { style: { marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(128,128,128,.18)' } },
              h('div', { style: { fontSize: 12, opacity: 0.78 } }, t.rollbackTitle + ' · ' + (paths && paths.rollbackExists ? t.rollbackYes : t.rollbackNo)),
              h('div', { style: S.mono }, (paths && paths.rollback) || '?'),
              h('div', { style: { fontSize: 12, opacity: 0.62, lineHeight: 1.6, marginTop: 4 } }, t.rollbackHint),
            ),
          ),
          h(
            'div',
            { style: S.notice },
            h('strong', null, t.noticeTitle),
            h('div', null, t.notice1),
            h('div', null, t.notice2),
            h('div', null, t.notice3),
          ),
          confirming
            ? h(
                'div',
                { style: S.confirm },
                h('div', { style: S.confirmTitle }, t.confirmTitle),
                h('div', { style: S.confirmBody }, t.confirmBody),
                h('div', { style: { fontSize: 12, fontWeight: 600, marginTop: 10 } }, t.confirmRollback),
                h('div', { style: S.confirmPath }, (paths && paths.rollback) || '?'),
                compat
                  ? h('div', { style: { fontSize: 12, opacity: 0.72, marginBottom: 10 } }, t.confirmChecked.replace('{host}', compat.hostVersion || '?'))
                  : null,
                h(
                  'div',
                  { style: S.confirmActions },
                  h('button', { style: S.danger, onClick: deploy, disabled: busy }, busy ? '…' : t.confirmOk),
                  h('button', { style: S.btn, onClick: () => setConfirming(false), disabled: busy }, t.confirmCancel),
                ),
              )
            : null,
          h(
            'div',
            { style: S.footer },
            h('button', { style: S.primary, onClick: requestDeploy, disabled: busy }, busy ? '…' : t.deploy),
            h('button', { style: S.btn, onClick: save, disabled: busy }, t.saveOnly),
            h('span', { style: { opacity: 0.6, fontSize: 12 } }, t.deployHint),
          ),
          message ? h('div', { style: S.status }, message) : null,
          error ? h('div', { style: { ...S.status, color: '#d04545' } }, error) : null,
          info && info.error ? h('div', { style: { ...S.status, color: '#d04545' } }, 'Inspect: ' + info.error) : null,
          info && info.ok
            ? h(
                'div',
                { style: S.status },
                t.statusHook + ': ' + (info.installed ? (info.stale ? t.statusStale : t.statusHookOk) : info.hooked ? t.statusHookMissing : t.statusHookAuto) +
                  ' · ' + t.statusAsar + ': ' + (info.asarSize ? Math.round(info.asarSize / 1024 / 1024) + ' MB' : '?') +
                  ' · ' + t.statusBackup + ': ' + (info.backupExists ? t.statusBackupYes : t.statusBackupNo) +
                  (info.pendingExists ? ' · ' + t.statusPending : '') +
                  (info.lastDeployAt ? ' · ' + t.statusLastDeploy + ' ' + info.lastDeployAt : '') +
                  ' · ' + t.statusLastApply + ' ' + (info.lastApplyResult ? info.lastApplyResult + (info.lastAppliedAt ? ' ' + info.lastAppliedAt : '') : t.statusLastApplyNone),
              )
            : null,
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'rsa',
              order: 100,
              label: 'RSA 启动画面',
            },
            SettingsPage,
          ),
        );
      },
    };
  },
});
