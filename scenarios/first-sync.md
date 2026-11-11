---
title: First sync and the pipeline board
goal: Copy your deals and leads into the local store and see where each one stands.
steps:
  - run: b24 session start
    why: paste the portal's incoming webhook address; it is checked against the portal and kept in the keyring
  - run: b24 session status --check
    why: the employee the webhook acts as, and whether they are a Bitrix24 administrator
  - run: b24 users list
    why: your own user id and the ids of the colleagues whose deals you want
  - run: b24 config set crm.bitrix24:example.bitrix24.ru.unassigned 1
    why: whose deals and leads to copy, by user id, comma-separated; until you choose, a sync copies nothing
  - run: b24 sync
    why: copies the chosen users' deals and leads and their clients; the next sync takes only the changes
  - run: b24 pipelines show Sales
    why: the pipeline as a board, how many deals stand in each stage and how many reached it
  - run: b24 deals list status:open
    why: the open deals with stage, amount and owner, from the store, offline too
look:
  - scope in the sync answer, which says whose deals and leads it copied
  - issues in the sync answer, such as a user it could not take or a scope the webhook lacks
  - the stage where most deals wait
---

`example.bitrix24.ru` stands for your portal's host, and `1` for the ids you chose. A webhook is often a colleague's,
so b24 never picks whose deals you copy.
