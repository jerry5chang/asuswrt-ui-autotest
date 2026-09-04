/**
 * i18n.token -- find translation placeholders that were never substituted.
 * ASUSWRT templates carry <#KEY#> tokens which httpd replaces from the
 * language dictionary. A token surviving into the DOM means a missing key.
 */
window.__AUT__.suite('i18n.token', async function (t) {
    const TOKEN = /<#([A-Za-z0-9_.\-]{1,60})#>/g;
    const found = new Map();

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent) continue;
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
        let m;
        TOKEN.lastIndex = 0;
        while ((m = TOKEN.exec(node.nodeValue || ''))) {
            if (!found.has(m[1])) found.set(m[1], tag.toLowerCase());
        }
    }

    // Also check the attributes users actually see.
    for (const el of t.$$('[title], [placeholder], [value], [alt]')) {
        for (const attr of ['title', 'placeholder', 'value', 'alt']) {
            const v = el.getAttribute(attr);
            if (!v) continue;
            TOKEN.lastIndex = 0;
            let m;
            while ((m = TOKEN.exec(v))) {
                if (!found.has(m[1])) found.set(m[1], `@${attr}`);
            }
        }
    }

    if (found.size === 0) return t.pass('no untranslated tokens');

    for (const [key, where] of found) {
        t.fail(`untranslated token <#${key}#>`, { where });
    }
});
