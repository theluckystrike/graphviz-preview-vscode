'use strict';
// Writes generated sample graphs for tests, screenshots and the release check.
// usage: node scripts/make-samples.js <outDir>
const fs = require('fs');
const path = require('path');

const out = path.resolve(process.argv[2] || 'samples');
fs.mkdirSync(out, { recursive: true });
const w = (name, text) => fs.writeFileSync(path.join(out, name), text);

w('architecture.dot', `// Order service: request flow
digraph architecture {
  rankdir=LR;
  node [shape=box, style=rounded, fontname="Helvetica"];
  edge [fontname="Helvetica", fontsize=10];

  subgraph cluster_edge {
    label="Edge";
    gateway [label="API gateway"];
    auth [label="Auth"];
  }

  subgraph cluster_core {
    label="Core services";
    orders [label="Orders"];
    payments [label="Payments", color="#2a9d8f", penwidth=2];
    inventory [label="Inventory"];
  }

  db [shape=cylinder, label="orders DB"];
  queue [shape=parallelogram, label="events queue"];
  mailer [label="Mailer"];

  client -> gateway [label="HTTPS"];
  gateway -> auth [label="verify"];
  gateway -> orders;
  orders -> payments [label="charge"];
  orders -> inventory [label="reserve"];
  orders -> db;
  orders -> queue [label="order.created"];
  queue -> mailer;
  payments -> queue [style=dashed];
}
`);

w('state-machine.gv', `digraph order_states {
  layout=circo;
  node [shape=circle, fixedsize=true, width=1.1];
  new [shape=doublecircle];
  new -> paid [label="pay"];
  paid -> packed [label="pack"];
  packed -> shipped [label="ship"];
  shipped -> delivered [label="deliver"];
  delivered -> closed;
  paid -> refunded [label="refund"];
  new -> cancelled [label="cancel"];
  refunded -> closed;
  cancelled -> closed;
}
`);

w('network.gv', `graph network {
  layout=neato;
  overlap=false;
  splines=true;
  node [shape=box, style="rounded,filled", fillcolor="#e9f1fb"];
  router -- switch1 -- { pc1 pc2 pc3 };
  router -- switch2 -- { server nas printer };
  router -- firewall -- internet;
  switch1 -- switch2 [style=dotted];
}
`);

w('broken.dot', `digraph broken {
  start -> parse;
  parse -> check;
  check -> ;
  check -> done;
}
`);

w('hostile.dot', `digraph hostile {
  a [label="<script>alert(1)</script>", URL="javascript:alert(2)"];
  b [label=<<b>bold</b> &amp; safe>, href="https://example.com/x"];
  c [image="/etc/passwd"];
  a -> b -> c;
}
`);

// a larger graph: a layered package dependency graph
let big = 'digraph deps {\n  rankdir=LR;\n  node [shape=box, fontsize=10];\n';
let seed = 7;
const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const N = 400;
for (let i = 0; i < N; i++) big += `  pkg${i} [label="pkg-${i}"];\n`;
for (let i = 1; i < N; i++) {
  const deps = 1 + rnd(3);
  for (let d = 0; d < deps; d++) big += `  pkg${i} -> pkg${rnd(i)};\n`;
}
big += '}\n';
w('dependencies-400.dot', big);

w('design-notes.md', `# Checkout design notes

The checkout flow has two parts. The first is the request path:

\`\`\`dot
digraph checkout {
  rankdir=LR;
  node [shape=box, style=rounded];
  cart -> checkout -> payment -> confirmation;
  payment -> retry [label="declined"];
  retry -> payment;
}
\`\`\`

The second is the retry policy for the payment provider:

\`\`\`graphviz
digraph retry {
  node [shape=ellipse];
  attempt1 -> wait1s -> attempt2 -> wait5s -> attempt3 -> give_up;
  attempt1 -> ok; attempt2 -> ok; attempt3 -> ok;
  ok [shape=doublecircle];
}
\`\`\`

Plain code blocks stay as they are:

\`\`\`js
console.log('not a graph');
\`\`\`
`);

console.log('samples written to ' + out);
