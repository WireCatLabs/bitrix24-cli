---
title: First sync and the pipeline board
goal: Copy your deals and leads into the local store and see where each one stands.
steps:
  - run: b24 work session start
    why: paste the portal's incoming webhook address. b24 checks it against the portal and keeps it in the keyring
  - run: b24 work session status --check
    why: the employee the webhook acts as, and whether they are a Bitrix24 administrator
  - run: b24 work users list
    why: your own user id and the ids of your colleagues
  - run: b24 work config set crm.bitrix24:example.bitrix24.ru.unassigned 3327,4410
    why: optional. To copy a colleague's deals too, list their id and your own, with your portal's host in place of example.bitrix24.ru. Without this, a sync copies your own deals and leads
  - run: b24 work sync
    why: copies the deals and leads, with their clients. The next sync takes only the changes
  - run: b24 work pipelines show Sales
    why: the pipeline as a board, how many deals stand in each stage and how many reached it
  - run: b24 work deals list status:open
    why: the open deals with stage, amount and owner, from the store, offline too
look:
  - scope in the sync answer, which says whose deals and leads it copied
  - issues in the sync answer, such as a user it could not take or a scope the webhook lacks
  - the stage where most deals wait
---

`work` is the profile, the name you gave your portal's sign-in. `example.bitrix24.ru` stands for your portal's host,
and `3327,4410` for your colleague's id and your own. The list replaces your own user, so a list without your id
leaves your deals out.
