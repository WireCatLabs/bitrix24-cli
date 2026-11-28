---
title: Let an agent change the CRM without surprises
goal: Give an agent your CRM over MCP while the writes that reach clients or cannot be undone stay yours.
steps:
  - run: b24 work config set permissions.deals.move readonly
    why: a stage change can start the portal's robots, which write to clients. Over MCP nobody answers ask, so only readonly stops the move
  - run: b24 work config set permissions.deals.delete deny
    why: no agent deletes a deal, whatever it is asked
  - run: b24 work mcp add claude-code --permission leads.delete=deny --allow-writes
    why: adds this profile to Claude Code. This server also refuses lead deletes, and --allow-writes says you accept the writes it still offers
  - run: b24 work config show
    why: each permission with its level and where it came from
  - run: b24 work runs list
    why: what the agent ran, refused writes too
look:
  - the levels of deals.move, deals.delete and leads.delete in config show
  - refused runs in runs list, and which command asked
---

At a terminal `ask` still asks before the write. Over MCP nobody is there to answer, so a write at `ask` goes ahead.
Set `readonly` or `deny`, or turn on approval of `b24_write` in the agent client.
