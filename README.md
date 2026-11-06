# b24

`b24` is a WireCat command-line tool, started from
[cli-template](https://github.com/WireCatLabs/cli-template). Its design is in
[docs/dev/DESIGN.md](docs/dev/DESIGN.md).

## Quick start

```sh
pnpm install
pnpm build
node dist/bin/b24.js doctor
```

`doctor` needs no profile. Every command that uses an account starts with one, a name you choose: `b24 personal config show`.
