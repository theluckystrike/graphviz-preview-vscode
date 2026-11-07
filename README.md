# Graphviz Viewer & DOT Viewer (Live Preview)

![License MIT](https://img.shields.io/badge/license-MIT-blue)
![Works offline](https://img.shields.io/badge/network-none-success)
![Graphviz 16.1](https://img.shields.io/badge/Graphviz-16.1%20(wasm)-informational)

See your Graphviz graph beside the `.dot` file as you type, click a node to jump to its line, and export it to SVG or PNG, with no Graphviz install.

![A .dot file of an order service on the left. On the right, the preview draws it with two clusters named Edge and Core services, in the editor's dark colors. The toolbar shows the engine picker, Find node, zoom at 79%, Fit, 1:1, SVG and PNG, and the status reads 9 nodes, 9 edges, dot, 10 ms](https://github.com/theluckystrike/graphviz-preview-vscode/raw/HEAD/images/preview-dark.png)

*Real output from VS Code 1.142 on macOS. The file is `architecture.dot` from `scripts/make-samples.js`, opened from the installed .vsix and captured through the debug port.*

- Nothing to install. Graphviz 16.1 ships inside the extension as WebAssembly, so it works on a locked-down laptop, in a container and on a plane. Layouts run in a separate thread with a time limit, so a huge graph can't freeze VS Code.
- Errors land on the right line. A syntax error is underlined in the editor and listed in Problems, and the preview keeps the last good drawing while you fix it.
- It reads like part of VS Code. Default black lines and text take your theme's colors in dark mode, and colors you set in the graph stay as they are.

## Quick start

1. Install Graphviz Preview & DOT Viewer.
2. Open a `.dot` or `.gv` file and click the preview icon in the editor title, or press Cmd+K V (Ctrl+K V on Windows and Linux).

"Graphviz: Get Started" in the Command Palette opens a short tour.

## What it does

The preview redraws 300 ms after you stop typing. You don't need to save. The status line shows the node and edge count, the engine and the layout time.

![broken.dot with "check -> ;" on line 4. The editor underlines the semicolon and the status bar shows 1 error. The preview shows a red banner that reads "Line 4: syntax error near ';'"](https://github.com/theluckystrike/graphviz-preview-vscode/raw/HEAD/images/error-line.png)

Click the banner line to put the cursor on the error. Warnings, such as an unknown shape, show in the same banner in yellow and in Problems.

### Pan, zoom, find and jump

Drag to pan. The mouse wheel and trackpad also pan, and Cmd or Ctrl plus the wheel zooms at the pointer. Fit and 1:1 reset the view, and the keys `+`, `-`, `0` and `1` do the same when the graph has focus.

Type in Find node to light up every node whose name or label matches. The rest fade out. Enter moves to the next match and centers it, and Shift+Enter goes back. Click any node, edge or cluster to put the cursor where it's written in the source. For a node that is the line where it's declared with attributes, or else its first edge.

![The word "pay" in Find node. Payments is outlined and every other node is faded. The source shows the cursor on line 16, where payments is declared](https://github.com/theluckystrike/graphviz-preview-vscode/raw/HEAD/images/find-node.png)

### Layout engines

Pick dot, neato, fdp, sfdp, circo or twopi from the toolbar. "auto" uses the `layout=` attribute of the graph, or dot when there is none. A `layout=` in the file wins over the picker, and the status line says so. Set the default for new previews with `graphvizPreview.defaultEngine`.

### Dot blocks in Markdown

Fenced blocks with the language `dot`, `graphviz` or `gv` are drawn in VS Code's own Markdown preview. Run "Graphviz: Open Preview to the Side" in a Markdown file to get the full preview for one block. It follows the block under your cursor, and a picker lists them all.

![design-notes.md with a dot block and a graphviz block. The built-in Markdown preview on the right draws both graphs between the paragraphs](https://github.com/theluckystrike/graphviz-preview-vscode/raw/HEAD/images/markdown-preview.png)

### Export

SVG saves the Graphviz output. PNG saves it at 2x on a white background. Both use the original Graphviz colors, not the dark-theme colors, so the file looks right in a document or a wiki. The save dialog starts next to the source file.

![The order-state machine laid out with circo in a light theme, black on white as Graphviz draws it](https://github.com/theluckystrike/graphviz-preview-vscode/raw/HEAD/images/light-theme.png)

## Settings

| Setting | Default | What it does |
|---|---|---|
| `graphvizPreview.defaultEngine` | `auto` | Engine for new previews |
| `graphvizPreview.updateDelayMs` | `300` | Wait after typing before redrawing |
| `graphvizPreview.renderTimeoutSeconds` | `15` | A longer layout is stopped and the preview says so |
| `graphvizPreview.maxSourceKB` | `4096` | Bigger graphs are not laid out |
| `graphvizPreview.theme` | `auto` | `auto`, `light`, `dark` or `original` colors |
| `graphvizPreview.markdownPreview` | `true` | Draw dot blocks in the Markdown preview |
| `graphvizPreview.markdownMaxBlockKB` | `256` | Bigger blocks are not drawn in the Markdown preview |
| `graphvizPreview.askForRating` | `true` | Ask one time for a Marketplace rating after a few days of use |
| `graphvizPreview.showSupportLinks` | `true` | Show the small Sponsor and More free viewers links under the graph |

## Privacy and safety

The extension makes no network calls and has no telemetry. The preview runs under a strict Content Security Policy with no remote sources. Graphviz output is cleaned before it's shown, which removes scripts, external links (`URL` and `href` attributes) and images. Label text is always shown as text. Graphviz runs on a virtual file system inside WebAssembly, so an `image=` attribute can't read files from your disk.

## Limits

- One preview per file. Previews are not restored after a restart.
- Diagnostics come from the open preview. Close it and the problems for that file go away.
- `image=` attributes and HTML labels with `<IMG>` draw no picture, by design.
- Very large or dense graphs can take a while with dot. sfdp is usually much faster for thousands of nodes.

## Support Zovo

Zovo extensions are free, with no ads and no tracking. They are made by [theluckystrike](https://github.com/theluckystrike) on GitHub. If this one saves you time, you can support the work:

- [Sponsor on GitHub](https://github.com/sponsors/theluckystrike)
- [Follow theluckystrike on GitHub](https://github.com/theluckystrike)

## More tools by Zovo

- [Large JSON Viewer & JSON Tree](https://marketplace.visualstudio.com/items?itemName=zovo.zovo-json-tree-viewer) shows large JSON files as a searchable tree, copies JSONPath and turns arrays of objects into a table.
- [PDF Viewer & PDF Reader with Dark Mode](https://marketplace.visualstudio.com/items?itemName=zovo.pdf-viewer-dark) reads PDFs with a real dark mode, search, an outline and thumbnails.
- [DOCX Viewer & Word Viewer with Dark Mode](https://marketplace.visualstudio.com/items?itemName=zovo.docx-viewer-vscode) previews Word and ODT files with dark mode, an outline and search.
- [PPTX Viewer & PowerPoint Viewer](https://marketplace.visualstudio.com/items?itemName=zovo.pptx-slide-viewer) shows PowerPoint slides, thumbnails and speaker notes.
- [SQLite Viewer & DB Viewer (Read-Only)](https://marketplace.visualstudio.com/items?itemName=zovo.sqlite-table-viewer) browses SQLite tables read-only and runs SELECT queries.

See [all Zovo extensions on the Marketplace](https://marketplace.visualstudio.com/publishers/zovo).

## License

MIT. The bundled [@viz-js/viz](https://github.com/mdaines/viz-js) is MIT and contains Graphviz (Eclipse Public License 1.0). See THIRD-PARTY-NOTICES.md.
