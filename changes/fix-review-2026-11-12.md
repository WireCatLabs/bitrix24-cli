### Fixed

- `sync` keeps a deal's or lead's amount as the portal wrote it. From about 10 billion with kopecks or cents, the old
  rounding added digits such as `98765432109.869995`, and the copy then left that deal out. An amount the copy cannot
  hold, more than about 90 trillion or with more decimals than its currency has, is still named in `sync`'s issues
  and left out, as before.
- Two profiles on one portal now share one request pace. Bitrix24 counts requests per portal, so before, they could
  go twice as fast as the portal allows and get refused.
- A write the portal refused because of its request limit is sent again after the wait the portal asks for, as a read
  is. The portal refuses such a request before doing anything, so it is not made twice. A write that got no answer is
  still never sent again.
- `sync` hands every phone and e-mail of a contact to the copy, not only the first, so a call or chat from any of
  them can be matched to the contact.
