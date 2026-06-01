# @puppet.fund/templates

Scaffolds an autonomous trading operator on [Puppet](https://puppet.fund). Run it and pick a venue:

```bash
bunx @puppet.fund/templates my-operator gmx
cd my-operator
bun install
bun run dev
```

`bun run dev` prints a pairing link — open it on the site and approve, and the operator receives
your session key and the site's endpoints over the tunnel (key stays in memory, never written).
The scaffolded project depends on [`@puppet.fund/operator`](https://www.npmjs.com/package/@puppet.fund/operator),
which handles signing, fee quoting, the matchmaker connection, and the venue call shapes.

Available venues: `gmx`.

> Requires [Bun](https://bun.sh). The scaffolder bin runs under Bun, not Node.
