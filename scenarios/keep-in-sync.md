---
title: Keep the copy up to date
goal: Have the local store follow the portal on its own, and search it beside your other WireCat tools.
steps:
  - run: b24 schedule command crm --every 1h -- sync
    why: a timer on this computer that runs sync every hour; it reads only what changed
  - run: b24 schedule list
    why: the schedule, when it runs next and how its last run went
  - run: b24 store status
    why: how far each kind's sync is, how many records are stored and when it last ran
  - run: b24 search all kitchen
    why: stored deals and leads beside your messages, notes and meetings from other WireCat tools
look:
  - a schedule whose last run failed
  - a kind in store status that is partial, which the next sync goes on with
---
