import { readFileSync } from "node:fs";

const guidePath = new URL("../docs/USER_GUIDE.md", import.meta.url);
const repoDocs = "https://github.com/MegaNoob75/Pi-MFX/blob/dev/docs/";
const escape = text => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const headingId = text => text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");

function screenshotReference(line) {
    // Bundle only local screenshot names referenced by the guide, never paths
    // supplied through a browser request or unrelated documentation assets.
    return /^!\[([^\]]*)\]\((images\/[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp))\)\s*$/.exec(line);
}

function guideScreenshots(markdown) {
    return [...new Set(markdown.replace(/\r/g, "").split("\n")
        .map(line => screenshotReference(line)?.[2]).filter(Boolean))];
}

const screenshotFile = path => new URL(`../docs/${path}`, import.meta.url);
const screenshotType = path => path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";

function inline(text) {
    const codes = [];
    let html = escape(text).replace(/`([^`]+)`/g, (_, code) => `\u0000${codes.push(`<code>${code}</code>`) - 1}\u0000`);
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
        if (href.startsWith("#")) return `<a href="${href}">${label}</a>`;
        if (/^[A-Z_]+\.md(?:#[\w-]+)?$/.test(href)) href = repoDocs + href;
        return /^https?:\/\//.test(href) ? `<a href="${href}" rel="noopener noreferrer">${label}</a>` : label;
    }).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return html.replace(/\u0000(\d+)\u0000/g, (_, index) => codes[Number(index)]);
}

// Deliberately small renderer for the guide's Markdown subset. All source text
// is escaped; no raw HTML, remote scripts, or network assets are executed.
export function renderGuide(markdown) {
    const lines = markdown.replace(/\r/g, "").split("\n");
    let body = "", section = false;
    for (let i = 0; i < lines.length;) {
        const line = lines[i];
        if (!line.trim()) { i++; continue; }
        const heading = /^(#{1,4}) (.+)$/.exec(line);
        if (heading) {
            const [, marks, title] = heading;
            if (marks.length === 2) {
                if (section) body += "</section>";
                body += `<section data-chapter="${headingId(title)}">`; section = true;
            }
            body += `<h${marks.length} id="${headingId(title)}">${inline(title)}</h${marks.length}>`; i++; continue;
        }
        if (line.startsWith("![")) {
            const screenshot = screenshotReference(line);
            if (screenshot) {
                const [, caption, path] = screenshot;
                body += `<figure><img src="${path}" alt="${escape(caption)}" width="1024" height="600" decoding="async"><figcaption>${escape(caption)}</figcaption></figure>`;
            }
            i++; continue;
        }
        if (line.startsWith("```")) {
            const code = []; i++;
            while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
            body += `<pre><code>${escape(code.join("\n"))}</code></pre>`; i++; continue;
        }
        if (line.startsWith("|")) {
            const rows = [];
            while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
            body += '<div class="table-wrap"><table>';
            rows.forEach((row, index) => {
                if (/^\|[\s:|-]+\|$/.test(row)) return;
                const cell = index === 0 ? "th" : "td";
                body += `<tr>${row.split("|").slice(1, -1).map(value => `<${cell}>${inline(value.trim())}</${cell}>`).join("")}</tr>`;
            });
            body += "</table></div>"; continue;
        }
        const list = /^(?:- |\d+\. )/.exec(line);
        if (list) {
            const ordered = /^\d/.test(line), tag = ordered ? "ol" : "ul";
            const pattern = ordered ? /^\d+\. / : /^- /;
            body += `<${tag}>`;
            while (i < lines.length && pattern.test(lines[i])) {
                let item = lines[i++].replace(pattern, "");
                while (i < lines.length && /^ {2,}\S/.test(lines[i])) item += " " + lines[i++].trim();
                body += `<li>${inline(item)}</li>`;
            }
            body += `</${tag}>`; continue;
        }
        const paragraph = [lines[i++]];
        while (i < lines.length && lines[i].trim() && !/^(?:#|!\[|\||```|- |\d+\. )/.test(lines[i])) paragraph.push(lines[i++]);
        body += `<p>${inline(paragraph.join(" "))}</p>`;
    }
    if (section) body += "</section>";
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pi-MFX User Guide</title>
<style>
:root{color-scheme:dark;--bg:#12151c;--panel:#202631;--text:#e9edf4;--link:#82dce7}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:17px/1.65 system-ui,sans-serif}header{position:sticky;top:0;z-index:2;background:var(--panel);padding:10px max(14px,calc((100% - 1100px)/2));display:flex;gap:12px;align-items:center;flex-wrap:wrap}a{color:var(--link)}header a,button{padding:8px 12px;border:1px solid #677487;border-radius:7px;background:transparent;color:inherit;text-decoration:none;font:inherit;cursor:pointer}input{flex:1;min-width:180px;padding:10px;border-radius:7px;border:1px solid #677487;background:var(--bg);color:inherit;font:inherit}main{max-width:1000px;margin:auto;padding:20px}h1,h2,h3{line-height:1.3;scroll-margin-top:125px}h2{border-top:1px solid #526075;padding-top:28px;margin-top:40px}h3{margin-top:30px}li{margin:7px 0}code{background:var(--panel);padding:2px 5px;border-radius:4px}pre{overflow:auto;padding:14px;background:var(--panel)}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%}th,td{padding:10px;border:1px solid #526075;text-align:left;vertical-align:top}figure{margin:20px 0}img{max-width:100%;height:auto;border-radius:8px}figcaption{font-size:14px;color:#aab7c8}[hidden]{display:none!important}#found{font-size:14px}footer{margin-top:40px;padding:20px;border-top:1px solid #526075}@media print{header{display:none}body{background:white;color:black;font-size:11pt}main{max-width:none}a{color:inherit}h2{break-before:page}img,table{break-inside:avoid}code,pre{background:#eee}}
</style><header><a href="#contents">Contents</a><label for="find">Find</label><input id="find" type="search" placeholder="Search chapters" autocomplete="off"><span id="found" role="status"></span><button id="print" type="button">Print / PDF</button></header><main>${body}<footer><a href="#contents">Back to contents</a> · Pi-MFX User Guide · Works offline from your Pi.</footer></main>
<script>
const search=document.querySelector('#find'),chapters=[...document.querySelectorAll('[data-chapter]')],found=document.querySelector('#found');
function filter(){const query=search.value.trim().toLocaleLowerCase();let count=0;for(const chapter of chapters){const match=!query||chapter.textContent.toLocaleLowerCase().includes(query);chapter.hidden=chapter.dataset.chapter!=='contents'&&!match;if(match&&chapter.dataset.chapter!=='contents')count++}found.textContent=query?count+' matching chapters':''}
search.addEventListener('input',filter);document.addEventListener('click',event=>{if(event.target.closest('a[href^="#"]')){search.value='';filter()}});document.querySelector('#print').onclick=()=>{search.value='';filter();window.print()};window.addEventListener('beforeprint',()=>{for(const chapter of chapters)chapter.hidden=false});window.addEventListener('afterprint',filter);
</script></html>`;
}

export function userGuidePlugin() {
    return {
        name: "pimfx-offline-user-guide",
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const path = (request.url || "").split("?")[0];
                if (path === "/help") {
                    response.statusCode = 302;
                    response.setHeader("Location", "/help/");
                    response.end(); return;
                }
                const document = path === "/help/" || path === "/help/index.html";
                if (!document && !path.startsWith("/help/images/")) return next();
                try {
                    const markdown = readFileSync(guidePath, "utf8");
                    const image = path.slice("/help/".length);
                    if (!document && !guideScreenshots(markdown).includes(image)) {
                        response.statusCode = 404;
                        response.end("Guide screenshot not found"); return;
                    }
                    response.setHeader("Content-Type", document ? "text/html; charset=utf-8" : screenshotType(image));
                    response.end(document ? renderGuide(markdown) : readFileSync(screenshotFile(image)));
                } catch (error) { next(error); }
            });
        },
        generateBundle() {
            const markdown = readFileSync(guidePath, "utf8");
            this.emitFile({ type: "asset", fileName: "help/index.html", source: renderGuide(markdown) });
            for (const image of guideScreenshots(markdown))
                this.emitFile({ type: "asset", fileName: `help/${image}`, source: readFileSync(screenshotFile(image)) });
        }
    };
}
